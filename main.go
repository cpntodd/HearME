package main

import (
	"embed"
	"io/fs"
	"log"
	"net"
	"os"
	"os/exec"
	"time"

	"github.com/hearme/app/config"
	"github.com/hearme/app/internal/provider/artists"
	"github.com/hearme/app/internal/provider/tours"
	"github.com/hearme/app/internal/server"
)

//go:embed web
var webDir embed.FS

func main() {
	// Load .env file if present (env vars take precedence)
	config.LoadDotEnv(".env")

	cfg := config.Load()

	// Single-instance: if port is already in use, another instance is running.
	// Just open the browser to it and exit (handles .desktop re-launch).
	if !canBind(cfg.Addr()) {
		url := "http://" + cfg.Addr()
		log.Printf("another instance already running on %s, opening browser", cfg.Addr())
		openBrowser(url)
		os.Exit(0)
	}

	webFS, err := fs.Sub(webDir, "web")
	if err != nil {
		log.Fatalf("failed to create web sub-filesystem: %v", err)
	}

	artistAgg := artists.NewAggregator(cfg)
	tourAgg := tours.NewAggregator(cfg)
	srv := server.New(cfg, webFS, artistAgg, tourAgg)

	log.Printf("HearME v0.1.0")
	log.Printf("Tour providers: %v", providerStatus(cfg))
	log.Printf("Artist providers: %v", artistStatus(cfg))

	// Auto-open browser when launched from .desktop (no terminal attached)
	// or when --open flag is passed. Delayed to let the server start first.
	if isDesktopLaunch() {
		url := "http://" + cfg.Addr()
		go func() {
			time.Sleep(500 * time.Millisecond)
			openBrowser(url)
		}()
	}

	if err := srv.Run(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

// canBind checks if the given address can be bound (port is free).
func canBind(addr string) bool {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return false
	}
	ln.Close()
	return true
}

// isDesktopLaunch returns true if the app was likely launched from a .desktop
// file (no terminal attached) or if --open flag was passed.
func isDesktopLaunch() bool {
	for _, arg := range os.Args[1:] {
		if arg == "--open" || arg == "-o" {
			return true
		}
	}
	// If stdin is not a terminal, assume desktop launch
	if stat, err := os.Stdin.Stat(); err == nil {
		return (stat.Mode() & os.ModeCharDevice) == 0
	}
	return false
}

// openBrowser opens the given URL in the system's default browser.
func openBrowser(url string) {
	cmd := exec.Command("xdg-open", url)
	if err := cmd.Start(); err != nil {
		log.Printf("could not open browser: %v", err)
		return
	}
	// Don't wait — xdg-open detaches itself
	cmd.Process.Release()
}

func providerStatus(cfg *config.Config) string {
	enabled := []string{}
	if cfg.BandsintownAppID != "" {
		enabled = append(enabled, "Bandsintown")
	}
	if cfg.SongkickAPIKey != "" {
		enabled = append(enabled, "Songkick")
	}
	if cfg.TicketmasterKey != "" {
		enabled = append(enabled, "Ticketmaster")
	}
	if len(enabled) == 0 {
		return "none configured"
	}
	return stringsJoin(enabled, ", ")
}

func artistStatus(cfg *config.Config) string {
	enabled := []string{"MusicBrainz (free)"}
	if cfg.LastFMAPIKey != "" {
		enabled = append(enabled, "Last.fm")
	}
	return stringsJoin(enabled, ", ")
}

func stringsJoin(parts []string, sep string) string {
	if len(parts) == 0 {
		return ""
	}
	result := parts[0]
	for i := 1; i < len(parts); i++ {
		result += sep + parts[i]
	}
	return result
}
