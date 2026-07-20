package main

import (
	"embed"
	"io/fs"
	"log"

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

	if err := srv.Run(); err != nil {
		log.Fatalf("server error: %v", err)
	}
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
