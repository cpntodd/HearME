package server

import (
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/hearme/app/config"
	"github.com/hearme/app/internal/cache"
	"github.com/hearme/app/internal/lyrics"
	"github.com/hearme/app/internal/models"
	"github.com/hearme/app/internal/provider/artists"
	"github.com/hearme/app/internal/provider/jellyfin"
	"github.com/hearme/app/internal/provider/tours"
	"github.com/hearme/app/internal/scraper"
)

// Server wraps the HTTP server and application state.
type Server struct {
	cfg      *config.Config
	http     *http.Server
	Cache    *cache.Cache
	artists  *artists.Aggregator
	tours    *tours.Aggregator
	scraper  *scraper.Engine
	lyrics   *lyrics.Provider
	jellyfin *jellyfin.Client
	mu       sync.Mutex // protects provider reconfiguration
}

// New creates a new Server. webFS is the embedded frontend filesystem passed from main.
func New(cfg *config.Config, webFS fs.FS, artistAgg *artists.Aggregator, tourAgg *tours.Aggregator) *Server {
	c := cache.New(1 * time.Hour)
	s := &Server{
		cfg:      cfg,
		Cache:    c,
		artists:  artistAgg,
		tours:    tourAgg,
		scraper:  scraper.New(cfg, c),
		lyrics:   lyrics.New("lyricsovh", ""),
		jellyfin: jellyfin.NewClient(cfg.JellyfinURL, cfg.JellyfinAPIKey),
	}

	// Init Jellyfin client if configured
	if s.jellyfin.Enabled() {
		if id, err := s.jellyfin.GetUserID(); err != nil {
			log.Printf("jellyfin: user lookup failed: %v (library browse may still work)", err)
		} else {
			log.Printf("jellyfin: connected to %s (user %s)", cfg.JellyfinURL, id)
		}
	}

	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/tours", s.handleTours)
	mux.HandleFunc("/api/artists/", s.handleArtists)
	mux.HandleFunc("/api/artists/discography/", s.handleDiscography)
	mux.HandleFunc("/api/albums/", s.handleAlbumInfo)
	mux.HandleFunc("/api/lyrics/", s.handleLyrics)
	mux.HandleFunc("/api/image", s.handleImageProxy)
	mux.HandleFunc("/api/graph/expand/", s.handleGraphExpand)
	mux.HandleFunc("/api/scraper/feeds/", s.handleScraperFeeds)
	mux.HandleFunc("/api/scraper/tours/", s.handleScraperTours)
	mux.HandleFunc("/api/settings", s.handleSettings)
	mux.HandleFunc("/api/cache/clear", s.handleCacheClear)
	mux.HandleFunc("/api/jellyfin/search", s.handleJellyfinSearch)
	mux.HandleFunc("/api/jellyfin/stream/", s.handleJellyfinStream)
	mux.HandleFunc("/api/jellyfin/status", s.handleJellyfinStatus)
	mux.HandleFunc("/api/jellyfin/library/artists", s.handleJellyfinArtists)
	mux.HandleFunc("/api/jellyfin/library/albums", s.handleJellyfinAlbums)
	mux.HandleFunc("/api/jellyfin/library/tracks", s.handleJellyfinTracks)

	// Static file server for embedded frontend
	mux.Handle("/", http.FileServer(http.FS(webFS)))

	s.http = &http.Server{
		Addr:         cfg.Addr(),
		Handler:      withLogging(mux),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	return s
}

// Run starts the server and blocks until a shutdown signal is received.
func (s *Server) Run() error {
	s.Cache.Start()
	defer s.Cache.Stop()
	s.scraper.Start()
	defer s.scraper.Stop()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("HearME starting on http://%s", s.cfg.Addr())
		if err := s.http.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-stop
	log.Println("shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return s.http.Shutdown(ctx)
}

// withLogging wraps an http.Handler with request logging.
func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, wrapped.statusCode, time.Since(start))
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// --- Handlers ---

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	s.writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"time":   time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleTours(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		s.writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Artists []string `json:"artists"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSONError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if len(req.Artists) == 0 {
		s.writeJSON(w, http.StatusOK, []any{})
		return
	}

	if !s.tours.HasProviders() {
		s.writeJSON(w, http.StatusOK, []any{})
		return
	}

	tours, err := s.tours.GetTours(r.Context(), req.Artists)
	if err != nil {
		log.Printf("tour fetch error: %v", err)
		s.writeJSON(w, http.StatusOK, []any{})
		return
	}

	s.writeJSON(w, http.StatusOK, tours)
}

func (s *Server) handleArtists(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	name := strings.TrimPrefix(r.URL.Path, "/api/artists/")
	if name == "" {
		s.writeJSONError(w, http.StatusBadRequest, "artist name required")
		return
	}

	// Search across all enabled providers
	matches, err := s.artists.Search(r.Context(), name)
	if err != nil {
		log.Printf("artist search error: %v", err)
		// Return a basic result so the frontend can still add the artist
		s.writeJSON(w, http.StatusOK, map[string]any{
			"name":    name,
			"genres":  []string{},
			"matches": []models.ArtistMatch{},
		})
		return
	}

	if len(matches) == 0 {
		s.writeJSON(w, http.StatusOK, map[string]any{
			"name":    name,
			"genres":  []string{},
			"matches": []models.ArtistMatch{},
		})
		return
	}

	// Return top match + all candidates for disambiguation
	top := matches[0]
	s.writeJSON(w, http.StatusOK, map[string]any{
		"id":      top.ID,
		"name":    top.Name,
		"genres":  top.Genres,
		"matches": matches,
	})
}

func (s *Server) handleDiscography(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	name := strings.TrimPrefix(r.URL.Path, "/api/artists/discography/")
	if name == "" {
		s.writeJSONError(w, http.StatusBadRequest, "artist name required")
		return
	}

	artist, err := s.artists.GetMetadata(r.Context(), name)
	if err != nil {
		s.writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	releases, err := s.artists.GetDiscography(r.Context(), *artist)
	if err != nil {
		log.Printf("discography error for %q: %v", name, err)
		releases = []models.Release{}
	}

	s.writeJSON(w, http.StatusOK, map[string]any{
		"artist":   artist,
		"releases": releases,
	})
}

func (s *Server) handleAlbumInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Path: /api/albums/{artist}/{album}
	path := strings.TrimPrefix(r.URL.Path, "/api/albums/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		s.writeJSONError(w, http.StatusBadRequest, "path must be /api/albums/{artist}/{album}")
		return
	}

	artistName := parts[0]
	albumName := parts[1]

	album, err := s.artists.GetAlbumInfo(r.Context(), artistName, albumName)
	if err != nil {
		log.Printf("album info error for %q - %q: %v", artistName, albumName, err)
		s.writeJSONError(w, http.StatusNotFound, "album not found")
		return
	}

	// Fetch lyrics for each track (best-effort, concurrent)
	var wg sync.WaitGroup
	for i := range album.Tracks {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			lyric, err := s.lyrics.GetLyrics(r.Context(), artistName, album.Tracks[idx].Title)
			if err == nil && lyric != "" {
				album.Tracks[idx].Lyrics = lyric
			}
		}(i)
	}
	wg.Wait()

	s.writeJSON(w, http.StatusOK, album)
}

func (s *Server) handleLyrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Path: /api/lyrics/{artist}/{track}
	path := strings.TrimPrefix(r.URL.Path, "/api/lyrics/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) != 2 {
		s.writeJSONError(w, http.StatusBadRequest, "path must be /api/lyrics/{artist}/{track}")
		return
	}

	lyric, err := s.lyrics.GetLyrics(r.Context(), parts[0], parts[1])
	if err != nil {
		s.writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]string{"lyrics": lyric})
}

func (s *Server) handleImageProxy(w http.ResponseWriter, r *http.Request) {
	imageURL := r.URL.Query().Get("url")
	if imageURL == "" {
		s.writeJSONError(w, http.StatusBadRequest, "url parameter required")
		return
	}

	// Only allow known safe domains
	if !strings.HasPrefix(imageURL, "https://coverartarchive.org/") &&
		!strings.HasPrefix(imageURL, "https://lastfm.freetls.fastly.net/") {
		s.writeJSONError(w, http.StatusBadRequest, "unsupported image source")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		s.writeJSONError(w, http.StatusInternalServerError, "failed to create request")
		return
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		s.writeJSONError(w, http.StatusBadGateway, "failed to fetch image")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		s.writeJSONError(w, http.StatusNotFound, "image not found")
		return
	}

	// Copy headers
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.WriteHeader(http.StatusOK)
	io.Copy(w, resp.Body)
}

func (s *Server) handleGraphExpand(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	name := strings.TrimPrefix(r.URL.Path, "/api/graph/expand/")
	if name == "" {
		s.writeJSONError(w, http.StatusBadRequest, "artist name required")
		return
	}

	// First get artist metadata, then fetch related artists
	artist, err := s.artists.GetMetadata(r.Context(), name)
	if err != nil {
		log.Printf("graph expand: getMetadata error: %v", err)
		s.writeJSON(w, http.StatusOK, map[string]any{
			"nodes": []any{},
			"edges": []any{},
		})
		return
	}

	relations, err := s.artists.GetRelated(r.Context(), *artist)
	if err != nil {
		log.Printf("graph expand: getRelated error: %v", err)
		s.writeJSON(w, http.StatusOK, map[string]any{
			"nodes": []any{},
			"edges": []any{},
		})
		return
	}

	// Convert relations to graph nodes
	nodes := make([]map[string]any, 0, len(relations))
	for _, rel := range relations {
		nodes = append(nodes, map[string]any{
			"artist":       rel.Artist,
			"relationType": rel.RelationType,
			"score":        rel.Score,
		})
	}

	s.writeJSON(w, http.StatusOK, map[string]any{
		"nodes": nodes,
		"edges": []any{},
	})
}

func (s *Server) handleScraperFeeds(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		s.writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	name := strings.TrimPrefix(r.URL.Path, "/api/scraper/feeds/")
	if name == "" {
		s.writeJSONError(w, http.StatusBadRequest, "artist name required")
		return
	}

	if r.Method == http.MethodPost {
		// Trigger feed discovery for this artist
		feeds, err := s.scraper.AddArtist(r.Context(), name)
		if err != nil {
			log.Printf("scraper discovery error for %q: %v", name, err)
		}
		s.writeJSON(w, http.StatusOK, map[string]any{
			"artist": name,
			"feeds":  feeds,
		})
		return
	}

	// GET: return known feeds
	feeds := s.scraper.GetFeeds(name)
	s.writeJSON(w, http.StatusOK, map[string]any{
		"artist": name,
		"feeds":  feeds,
	})
}

func (s *Server) handleScraperTours(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	name := strings.TrimPrefix(r.URL.Path, "/api/scraper/tours/")
	if name == "" {
		s.writeJSONError(w, http.StatusBadRequest, "artist name required")
		return
	}

	tours := s.scraper.GetTours(name)
	if tours == nil {
		tours = []models.Tour{}
	}
	s.writeJSON(w, http.StatusOK, tours)
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.writeJSON(w, http.StatusOK, map[string]any{
			"providers": map[string]any{
				"bandsintown":  s.cfg.BandsintownAppID != "",
				"songkick":     s.cfg.SongkickAPIKey != "",
				"ticketmaster": s.cfg.TicketmasterKey != "",
				"musicbrainz":  true,
				"lastfm":       s.cfg.LastFMAPIKey != "",
			},
			"jellyfin": map[string]any{
				"url":    s.cfg.JellyfinURL,
				"hasKey": s.cfg.JellyfinAPIKey != "",
			},
			"scraper": map[string]any{
				"enabled":  s.cfg.ScraperEnabled,
				"interval": s.cfg.ScraperInterval.String(),
			},
			"cache": map[string]any{
				"entries": s.Cache.Len(),
			},
		})

	case http.MethodPost:
		var req struct {
			ScraperEnabled  *bool   `json:"scraperEnabled"`
			ScraperInterval *string `json:"scraperInterval"`
			LastFMKey       *string `json:"lastfmKey"`
			BandsintownKey  *string `json:"bandsintownKey"`
			SongkickKey     *string `json:"songkickKey"`
			TicketmasterKey *string `json:"ticketmasterKey"`
			JellyfinURL     *string `json:"jellyfinUrl"`
			JellyfinKey     *string `json:"jellyfinKey"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.writeJSONError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		reconfigure := false

		if req.ScraperEnabled != nil {
			s.cfg.ScraperEnabled = *req.ScraperEnabled
			if *req.ScraperEnabled {
				s.scraper.Start()
			} else {
				s.scraper.Stop()
			}
		}
		if req.ScraperInterval != nil {
			if d, err := time.ParseDuration(*req.ScraperInterval); err == nil {
				s.cfg.ScraperInterval = d
			}
		}

		// API keys — update config and flag for provider reconfiguration
		if req.LastFMKey != nil {
			s.cfg.LastFMAPIKey = *req.LastFMKey
			reconfigure = true
		}
		if req.BandsintownKey != nil {
			s.cfg.BandsintownAppID = *req.BandsintownKey
			reconfigure = true
		}
		if req.SongkickKey != nil {
			s.cfg.SongkickAPIKey = *req.SongkickKey
			reconfigure = true
		}
		if req.TicketmasterKey != nil {
			s.cfg.TicketmasterKey = *req.TicketmasterKey
			reconfigure = true
		}

		// Jellyfin settings (no provider reconfiguration needed — just config)
		if req.JellyfinURL != nil {
			s.cfg.JellyfinURL = *req.JellyfinURL
		}
		if req.JellyfinKey != nil {
			s.cfg.JellyfinAPIKey = *req.JellyfinKey
		}

		if reconfigure {
			s.reconfigureProviders()
		}

		s.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})

	default:
		s.writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleCacheClear(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		s.writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	s.Cache.Clear()
	log.Printf("cache cleared")
	s.writeJSON(w, http.StatusOK, map[string]string{"status": "cleared"})
}

// reconfigureProviders recreates artist and tour aggregators with updated config keys.
func (s *Server) reconfigureProviders() {
	s.mu.Lock()
	defer s.mu.Unlock()

	log.Printf("reconfiguring providers with updated API keys")
	s.artists = artists.NewAggregator(s.cfg)
	s.tours = tours.NewAggregator(s.cfg)
	s.jellyfin = jellyfin.NewClient(s.cfg.JellyfinURL, s.cfg.JellyfinAPIKey)
	if s.jellyfin.Enabled() {
		if _, err := s.jellyfin.GetUserID(); err != nil {
			log.Printf("jellyfin: auth failed after reconfig: %v", err)
		}
	}
}

// --- Jellyfin handlers ---

func (s *Server) handleJellyfinStatus(w http.ResponseWriter, r *http.Request) {
	if !s.jellyfin.Enabled() {
		s.writeJSON(w, http.StatusOK, map[string]any{"connected": false, "message": "Jellyfin not configured"})
		return
	}
	id, err := s.jellyfin.GetUserID()
	if err != nil {
		s.writeJSON(w, http.StatusOK, map[string]any{"connected": false, "message": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"connected": true, "userId": id})
}

func (s *Server) handleJellyfinSearch(w http.ResponseWriter, r *http.Request) {
	if !s.jellyfin.Enabled() {
		s.writeJSONError(w, http.StatusServiceUnavailable, "Jellyfin not configured")
		return
	}
	q := r.URL.Query().Get("q")
	if q == "" {
		s.writeJSONError(w, http.StatusBadRequest, "query parameter 'q' required")
		return
	}
	items, err := s.jellyfin.Search(q)
	if err != nil {
		s.writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	type result struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		Artist   string `json:"artist"`
		Album    string `json:"album"`
		Duration int    `json:"duration"` // seconds
		ImageURL string `json:"imageUrl,omitempty"`
	}
	results := make([]result, 0, len(items))
	for _, item := range items {
		dur := int(item.RunTimeTicks / 10000000) // ticks to seconds
		artist := item.AlbumArtist
		if artist == "" && len(item.Artists) > 0 {
			artist = item.Artists[0]
		}
		imgURL := ""
		if len(item.ImageTags) > 0 {
			imgURL = s.jellyfin.ImageURL(item.AlbumID)
		}
		results = append(results, result{
			ID: item.ID, Title: item.Name, Artist: artist,
			Album: item.Album, Duration: dur, ImageURL: imgURL,
		})
	}
	s.writeJSON(w, http.StatusOK, results)
}

func (s *Server) handleJellyfinStream(w http.ResponseWriter, r *http.Request) {
	if !s.jellyfin.Enabled() {
		s.writeJSONError(w, http.StatusServiceUnavailable, "Jellyfin not configured")
		return
	}
	// Path: /api/jellyfin/stream/{itemId}
	itemID := strings.TrimPrefix(r.URL.Path, "/api/jellyfin/stream/")
	if itemID == "" {
		s.writeJSONError(w, http.StatusBadRequest, "item ID required")
		return
	}
	streamURL := s.jellyfin.StreamURL(itemID)
	http.Redirect(w, r, streamURL, http.StatusTemporaryRedirect)
}

func (s *Server) handleJellyfinArtists(w http.ResponseWriter, r *http.Request) {
	if !s.jellyfin.Enabled() {
		s.writeJSONError(w, http.StatusServiceUnavailable, "Jellyfin not configured")
		return
	}
	items, err := s.jellyfin.GetArtists()
	if err != nil {
		s.writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	type artistResult struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		ImageURL string `json:"imageUrl,omitempty"`
	}
	results := make([]artistResult, 0, len(items))
	for _, item := range items {
		imgURL := ""
		if len(item.ImageTags) > 0 {
			imgURL = s.jellyfin.ImageURL(item.ID)
		}
		results = append(results, artistResult{
			ID: item.ID, Name: item.Name, ImageURL: imgURL,
		})
	}
	s.writeJSON(w, http.StatusOK, results)
}

func (s *Server) handleJellyfinAlbums(w http.ResponseWriter, r *http.Request) {
	if !s.jellyfin.Enabled() {
		s.writeJSONError(w, http.StatusServiceUnavailable, "Jellyfin not configured")
		return
	}
	artistID := r.URL.Query().Get("artistId")
	items, err := s.jellyfin.GetAlbums(artistID)
	if err != nil {
		s.writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	type albumResult struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Artist   string `json:"artist"`
		Year     int    `json:"year"`
		ImageURL string `json:"imageUrl,omitempty"`
	}
	results := make([]albumResult, 0, len(items))
	for _, item := range items {
		imgURL := ""
		if len(item.ImageTags) > 0 {
			imgURL = s.jellyfin.ImageURL(item.ID)
		}
		results = append(results, albumResult{
			ID: item.ID, Name: item.Name, Artist: item.AlbumArtist,
			Year: item.ProductionYear, ImageURL: imgURL,
		})
	}
	s.writeJSON(w, http.StatusOK, results)
}

func (s *Server) handleJellyfinTracks(w http.ResponseWriter, r *http.Request) {
	if !s.jellyfin.Enabled() {
		s.writeJSONError(w, http.StatusServiceUnavailable, "Jellyfin not configured")
		return
	}
	albumID := r.URL.Query().Get("albumId")
	if albumID == "" {
		s.writeJSONError(w, http.StatusBadRequest, "albumId parameter required")
		return
	}
	items, err := s.jellyfin.GetTracks(albumID)
	if err != nil {
		s.writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	type trackResult struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		Artist   string `json:"artist"`
		Album    string `json:"album"`
		TrackNum int    `json:"trackNum"`
		Duration int    `json:"duration"`
	}
	results := make([]trackResult, 0, len(items))
	for _, item := range items {
		dur := int(item.RunTimeTicks / 10000000)
		artist := item.AlbumArtist
		if artist == "" && len(item.Artists) > 0 {
			artist = item.Artists[0]
		}
		results = append(results, trackResult{
			ID: item.ID, Title: item.Name, Artist: artist,
			Album: item.Album, TrackNum: item.IndexNumber, Duration: dur,
		})
	}
	s.writeJSON(w, http.StatusOK, results)
}

// --- JSON helpers ---

func (s *Server) writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("json encode error: %v", err)
	}
}

func (s *Server) writeJSONError(w http.ResponseWriter, status int, message string) {
	s.writeJSON(w, status, map[string]string{"error": message})
}
