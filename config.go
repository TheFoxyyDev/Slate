package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
)

// Area is a rectangle expressed as fractions (0..1) of some surface.
type Area struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

type Config struct {
	// Fraction of the screen the tablet maps onto.
	ScreenArea Area `json:"screen_area"`
	// Fraction of the tablet surface that is "live"; outside is clamped.
	TabletArea Area `json:"tablet_area"`
	// Resolution of the virtual device's absolute axes. 32767 matches what
	// most real tablets report.
	AbsRange int `json:"abs_range"`
}

func defaultConfig() Config {
	return Config{
		ScreenArea: Area{0, 0, 1, 1},
		TabletArea: Area{0, 0, 1, 1},
		AbsRange:   32767,
	}
}

// configPath returns the global config location, e.g.
// $XDG_CONFIG_HOME/slate/config.json (defaulting to ~/.config/... on Linux).
func configPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "slate", "config.json"), nil
}

// loadConfig reads the config file, falling back to defaults for a missing
// file or any missing keys. Unmarshalling over a defaults-seeded struct means
// keys absent from the file keep their default value.
func loadConfig() Config {
	cfg := defaultConfig()

	path, err := configPath()
	if err != nil {
		log.Printf("[warn] cannot determine config dir (%v), using defaults", err)
		return cfg
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[warn] failed to read %s (%v), using defaults", path, err)
		}
		return cfg
	}

	if err := json.Unmarshal(data, &cfg); err != nil {
		log.Printf("[warn] failed to parse %s (%v), using defaults", path, err)
		return defaultConfig()
	}
	return cfg
}

func saveConfig(cfg Config) error {
	path, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
