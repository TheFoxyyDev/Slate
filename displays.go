package main

import (
	"os/exec"
	"regexp"
	"strconv"
)

type Display struct {
	Name string `json:"name"`
	X    int    `json:"x"`
	Y    int    `json:"y"`
	W    int    `json:"w"`
	H    int    `json:"h"`
}

var monitorLine = regexp.MustCompile(`^\s*\d+:\s+\S*?([\w.-]+)\s+(\d+)/\d+x(\d+)/\d+\+(-?\d+)\+(-?\d+)`)

func detectDisplays() []Display {
	out, err := exec.Command("xrandr", "--listmonitors").Output()
	if err != nil {
		return nil
	}
	var displays []Display
	for _, line := range splitLines(string(out)) {
		m := monitorLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		w, _ := strconv.Atoi(m[2])
		h, _ := strconv.Atoi(m[3])
		x, _ := strconv.Atoi(m[4])
		y, _ := strconv.Atoi(m[5])
		displays = append(displays, Display{Name: m[1], X: x, Y: y, W: w, H: h})
	}
	return displays
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

func boundingBox(displays []Display) (minX, minY, w, h float64) {
	if len(displays) == 0 {
		return 0, 0, 0, 0
	}
	x0, y0 := displays[0].X, displays[0].Y
	x1, y1 := displays[0].X+displays[0].W, displays[0].Y+displays[0].H
	for _, d := range displays[1:] {
		x0 = min(x0, d.X)
		y0 = min(y0, d.Y)
		x1 = max(x1, d.X+d.W)
		y1 = max(y1, d.Y+d.H)
	}
	return float64(x0), float64(y0), float64(x1 - x0), float64(y1 - y0)
}
