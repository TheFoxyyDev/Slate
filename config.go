package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
)

type Area struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

type DisplayConfig struct {
	TabletRegion Area `json:"tablet_region"`
	Enabled      bool `json:"enabled"`
}

type Config struct {
	Displays map[string]DisplayConfig `json:"displays"`
	AbsRange int                      `json:"abs_range"`
}

func defaultConfig() Config {
	return Config{
		Displays: map[string]DisplayConfig{},
		AbsRange: 32767,
	}
}

func configPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "slate", "config.json"), nil
}

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
	if cfg.Displays == nil {
		cfg.Displays = map[string]DisplayConfig{}
	}
	if cfg.AbsRange == 0 {
		cfg.AbsRange = defaultConfig().AbsRange
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
