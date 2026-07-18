package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"sync"

	"github.com/coder/websocket"
	qrcode "github.com/skip2/go-qrcode"
)

//go:embed static
var staticFS embed.FS

// Bridge holds the shared server state guarded for concurrent access from the
// HTTP handlers and WebSocket connections.
type Bridge struct {
	port int

	mu  sync.RWMutex
	cfg Config

	dev     *Device
	devLock sync.Mutex // serialises event emission to the uinput device
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

// mapPoint maps a raw normalized tablet coordinate (0..1) through the active
// tablet_area crop, into the target screen_area, and finally into absolute
// device units.
func mapPoint(nx, ny float64, cfg Config) (int32, int32) {
	ta := cfg.TabletArea
	relX := clamp((nx-ta.X)/max(ta.W, 1e-6), 0, 1)
	relY := clamp((ny-ta.Y)/max(ta.H, 1e-6), 0, 1)

	sa := cfg.ScreenArea
	outX := clamp(sa.X+relX*sa.W, 0, 1)
	outY := clamp(sa.Y+relY*sa.H, 0, 1)

	absMax := float64(cfg.AbsRange)
	return int32(outX * absMax), int32(outY * absMax)
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

		b.mu.RLock()
		cfg := b.cfg
		b.mu.RUnlock()

		x, y := mapPoint(msg.X, msg.Y, cfg)

		// Movement-only for now: press/drag data just relocates the cursor. We
		// never emit BTN_LEFT here on purpose -- clicking is handled separately
		// (e.g. a keyboard key, and soon a pen button).
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
	b.mu.Lock()
	// Decode over the current config so only the mapping areas are updated;
	// abs_range stays fixed at what the device was created with.
	updated := b.cfg
	absRange := b.cfg.AbsRange
	if err := json.NewDecoder(r.Body).Decode(&updated); err != nil {
		b.mu.Unlock()
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	updated.AbsRange = absRange
	b.cfg = updated
	cfg := b.cfg
	b.mu.Unlock()

	if err := saveConfig(cfg); err != nil {
		log.Printf("[warn] failed to save config: %v", err)
	}
	writeJSON(w, cfg)
}

func (b *Bridge) handleInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"ip": getLocalIP(), "port": b.port})
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

	b := &Bridge{port: *port, cfg: cfg, dev: dev}

	staticSub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatal(err)
	}
	fileServer := http.FileServer(http.FS(staticSub))

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
	mux.Handle("/static/", http.StripPrefix("/static/", fileServer))
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
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
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
