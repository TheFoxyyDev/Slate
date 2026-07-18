package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"math"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	qrcode "github.com/skip2/go-qrcode"
)

//go:embed static
var staticFS embed.FS

const version = "v1.3"

type Bridge struct {
	port int

	mu       sync.RWMutex
	cfg      Config
	preview  *Config
	displays []Display

	dev     *Device
	devLock sync.Mutex
}

func sameDisplayMap(a, b map[string]DisplayConfig) bool {
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return bytes.Equal(ja, jb)
}

func (b *Bridge) refreshDisplays() {
	for {
		d := detectDisplays()
		b.mu.Lock()
		b.displays = d
		b.mu.Unlock()
		time.Sleep(2 * time.Second)
	}
}

func clamp(v, lo, hi float64) float64 {
	switch {
	case v < lo:
		return lo
	case v > hi:
		return hi
	default:
		return v
	}
}

func rectDist(px, py float64, r Area) float64 {
	dx := math.Max(math.Max(r.X-px, px-(r.X+r.W)), 0)
	dy := math.Max(math.Max(r.Y-py, py-(r.Y+r.H)), 0)
	return math.Hypot(dx, dy)
}

func mapPoint(nx, ny float64, cfg Config, displays []Display, prefer string) (int32, int32, string, bool) {
	bx, by, bw, bh := boundingBox(displays)
	if bw <= 0 || bh <= 0 {
		return 0, 0, "", false
	}

	emit := func(d Display, r Area) (int32, int32) {
		relX := clamp((nx-r.X)/max(r.W, 1e-6), 0, 1)
		relY := clamp((ny-r.Y)/max(r.H, 1e-6), 0, 1)
		sx := (float64(d.X) - bx) / bw
		sy := (float64(d.Y) - by) / bh
		sw := float64(d.W) / bw
		sh := float64(d.H) / bh
		outX := clamp(sx+relX*sw, 0, 1)
		outY := clamp(sy+relY*sh, 0, 1)
		absMax := float64(cfg.AbsRange)
		return int32(outX * absMax), int32(outY * absMax)
	}

	for _, d := range displays {
		dc, ok := cfg.Displays[d.Name]
		if !ok || !dc.Enabled {
			continue
		}
		r := dc.TabletRegion
		if nx >= r.X && nx <= r.X+r.W && ny >= r.Y && ny <= r.Y+r.H {
			x, y := emit(d, r)
			return x, y, d.Name, true
		}
	}

	if prefer != "" {
		if dc, ok := cfg.Displays[prefer]; ok && dc.Enabled {
			for _, d := range displays {
				if d.Name == prefer {
					x, y := emit(d, dc.TabletRegion)
					return x, y, prefer, true
				}
			}
		}
	}

	bestDist := math.MaxFloat64
	var bestD Display
	var bestR Area
	found := false
	for _, d := range displays {
		dc, ok := cfg.Displays[d.Name]
		if !ok || !dc.Enabled {
			continue
		}
		if dist := rectDist(nx, ny, dc.TabletRegion); dist < bestDist {
			bestDist, bestD, bestR, found = dist, d, dc.TabletRegion, true
		}
	}
	if !found {
		return 0, 0, "", false
	}
	x, y := emit(bestD, bestR)
	return x, y, bestD.Name, true
}

func getLocalIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "127.0.0.1"
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}

type pointerMsg struct {
	Type     string   `json:"type"`
	X        float64  `json:"x"`
	Y        float64  `json:"y"`
	Pressure *float64 `json:"pressure"`
}

func (b *Bridge) handleWS(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer c.CloseNow()

	ctx := r.Context()
	var lastRegion string
	for {
		typ, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageText {
			continue
		}

		var msg pointerMsg
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg.Type != "move" && msg.Type != "down" && msg.Type != "up" {
			continue
		}
		if msg.Type == "down" {
			lastRegion = ""
		}

		b.mu.RLock()
		cfg := b.cfg
		if b.preview != nil {
			cfg = *b.preview
		}
		displays := b.displays
		b.mu.RUnlock()

		x, y, region, ok := mapPoint(msg.X, msg.Y, cfg, displays, lastRegion)
		if !ok {
			continue
		}
		lastRegion = region

		b.devLock.Lock()
		b.dev.emit(evAbs, absX, x)
		b.dev.emit(evAbs, absY, y)
		if msg.Pressure != nil {
			b.dev.emit(evAbs, absPressure, int32(clamp(*msg.Pressure, 0, 1)*pressureMax))
		}
		b.dev.syn()
		b.devLock.Unlock()
	}
}

func (b *Bridge) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	b.mu.RLock()
	cfg := b.cfg
	b.mu.RUnlock()
	writeJSON(w, cfg)
}

func (b *Bridge) handlePostSettings(w http.ResponseWriter, r *http.Request) {
	var incoming Config
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if incoming.Displays == nil {
		incoming.Displays = map[string]DisplayConfig{}
	}

	b.mu.Lock()
	incoming.AbsRange = b.cfg.AbsRange
	b.cfg = incoming
	b.preview = nil
	cfg := b.cfg
	b.mu.Unlock()

	if err := saveConfig(cfg); err != nil {
		log.Printf("[warn] failed to save config: %v", err)
	}
	writeJSON(w, cfg)
}

func (b *Bridge) handlePreview(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Clear    bool                     `json:"clear"`
		Displays map[string]DisplayConfig `json:"displays"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	b.mu.Lock()
	if req.Clear {
		b.preview = nil
	} else {
		if req.Displays == nil {
			req.Displays = map[string]DisplayConfig{}
		}
		b.preview = &Config{Displays: req.Displays, AbsRange: b.cfg.AbsRange}
	}
	b.mu.Unlock()

	w.WriteHeader(http.StatusNoContent)
}

func (b *Bridge) handleOverlay(w http.ResponseWriter, r *http.Request) {
	b.mu.RLock()
	cfg := b.cfg
	dirty := false
	if b.preview != nil {
		dirty = !sameDisplayMap(b.cfg.Displays, b.preview.Displays)
		cfg = *b.preview
	}
	displays := b.displays
	b.mu.RUnlock()

	type region struct {
		Name string  `json:"name"`
		X    float64 `json:"x"`
		Y    float64 `json:"y"`
		W    float64 `json:"w"`
		H    float64 `json:"h"`
	}
	regions := make([]region, 0, len(displays))
	for _, d := range displays {
		dc, ok := cfg.Displays[d.Name]
		if !ok || !dc.Enabled {
			continue
		}
		r := dc.TabletRegion
		regions = append(regions, region{Name: d.Name, X: r.X, Y: r.Y, W: r.W, H: r.H})
	}

	writeJSON(w, map[string]any{"regions": regions, "dirty": dirty})
}

func (b *Bridge) handleDisplays(w http.ResponseWriter, r *http.Request) {
	b.mu.RLock()
	cfg := b.cfg
	displays := b.displays
	b.mu.RUnlock()

	bx, by, bw, bh := boundingBox(displays)

	type displayView struct {
		Display
		Enabled      bool `json:"enabled"`
		TabletRegion Area `json:"tablet_region"`
	}
	views := make([]displayView, 0, len(displays))
	for _, d := range displays {
		dc := cfg.Displays[d.Name]
		views = append(views, displayView{Display: d, Enabled: dc.Enabled, TabletRegion: dc.TabletRegion})
	}

	writeJSON(w, map[string]any{
		"displays":     views,
		"bounding_box": Area{X: bx, Y: by, W: bw, H: bh},
		"abs_range":    cfg.AbsRange,
	})
}

func (b *Bridge) handleInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"ip": getLocalIP(), "port": b.port, "version": version})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func main() {
	port := flag.Int("port", 8765, "port to listen on")
	flag.Parse()

	cfg := loadConfig()

	dev, err := newDevice("Slate", cfg.AbsRange)
	if err != nil {
		log.Fatalf("could not create virtual input device: %v", err)
	}
	defer dev.Close()

	b := &Bridge{port: *port, cfg: cfg, dev: dev, displays: detectDisplays()}
	go b.refreshDisplays()

	staticSub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatal(err)
	}
	fileServer := http.FileServer(http.FS(staticSub))
	noCache := func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			h.ServeHTTP(w, r)
		})
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		serveEmbedded(w, r, staticSub, "tablet.html")
	})
	mux.HandleFunc("/config", func(w http.ResponseWriter, r *http.Request) {
		serveEmbedded(w, r, staticSub, "config.html")
	})
	mux.Handle("/static/", http.StripPrefix("/static/", noCache(fileServer)))
	mux.HandleFunc("/ws", b.handleWS)
	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			b.handleGetSettings(w, r)
		case http.MethodPost:
			b.handlePostSettings(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/api/displays", b.handleDisplays)
	mux.HandleFunc("/api/preview", b.handlePreview)
	mux.HandleFunc("/api/overlay", b.handleOverlay)
	mux.HandleFunc("/api/info", b.handleInfo)

	ip := getLocalIP()
	tabletURL := fmt.Sprintf("http://%s:%d/", ip, *port)

	fmt.Println("Slate running.")
	fmt.Printf("  On this PC, configure: http://localhost:%d/config\n", *port)
	fmt.Printf("  On your tablet, open:  %s\n\n", tabletURL)
	fmt.Println("  Or scan this on your tablet:")
	fmt.Println()
	printQR(tabletURL)
	fmt.Println()

	srv := &http.Server{Addr: fmt.Sprintf("0.0.0.0:%d", *port), Handler: mux}
	log.Fatal(srv.ListenAndServe())
}

func serveEmbedded(w http.ResponseWriter, r *http.Request, fsys fs.FS, name string) {
	data, err := fs.ReadFile(fsys, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	data = bytes.ReplaceAll(data, []byte("__VERSION__"), []byte(version))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Write(data)
}

func printQR(text string) {
	q, err := qrcode.New(text, qrcode.Low)
	if err != nil {
		fmt.Printf("  (could not render QR: %v)\n", err)
		return
	}
	fmt.Print(q.ToSmallString(false))
}
