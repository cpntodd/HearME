package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all application configuration.
type Config struct {
	Port int
	Host string

	// Tour providers
	BandsintownAppID string
	SongkickAPIKey   string
	TicketmasterKey  string

	// Artist providers
	LastFMAPIKey string

	// RSS scraper
	ScraperEnabled  bool
	ScraperInterval time.Duration
}

// Load reads configuration from environment variables.
// Call LoadDotEnv first to populate from .env file.
func Load() *Config {
	return &Config{
		Port:             getEnvInt("HEARME_PORT", 8080),
		Host:             getEnvStr("HEARME_HOST", "localhost"),
		BandsintownAppID: getEnvStr("HEARME_BANDSINTOWN_APP_ID", ""),
		SongkickAPIKey:   getEnvStr("HEARME_SONGKICK_API_KEY", ""),
		TicketmasterKey:  getEnvStr("HEARME_TICKETMASTER_API_KEY", ""),
		LastFMAPIKey:     getEnvStr("HEARME_LASTFM_API_KEY", ""),
		ScraperEnabled:   getEnvBool("HEARME_SCRAPER_ENABLED", true),
		ScraperInterval:  getEnvDuration("HEARME_SCRAPER_INTERVAL", 30*time.Minute),
	}
}

// Addr returns the listen address as "host:port".
func (c *Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

// HasAnyTourProvider returns true if at least one tour API is configured.
func (c *Config) HasAnyTourProvider() bool {
	return c.BandsintownAppID != "" || c.SongkickAPIKey != "" || c.TicketmasterKey != ""
}

// HasAnyArtistProvider returns true if at least one artist API is configured.
func (c *Config) HasAnyArtistProvider() bool {
	return c.LastFMAPIKey != ""
}

// LoadDotEnv reads a .env file and sets environment variables.
// Lines with # are comments, empty lines are skipped.
func LoadDotEnv(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		// Only set if not already set (env vars take precedence)
		if _, ok := os.LookupEnv(key); !ok {
			os.Setenv(key, val)
		}
	}
	return scanner.Err()
}

func getEnvStr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			return n
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		v = strings.TrimSpace(strings.ToLower(v))
		return v == "true" || v == "1" || v == "yes"
	}
	return fallback
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if d, err := time.ParseDuration(strings.TrimSpace(v)); err == nil {
			return d
		}
	}
	return fallback
}
