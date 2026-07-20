package scraper

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/hearme/app/config"
	"github.com/hearme/app/internal/cache"
	"github.com/hearme/app/internal/models"
)

// Engine manages RSS feed discovery, fetching, and tour extraction.
type Engine struct {
	cfg     *config.Config
	cache   *cache.Cache
	client  *http.Client
	feeds   map[string][]string // artist name → feed URLs
	mu      sync.RWMutex
	stopCh  chan struct{}
	running bool
}

// New creates a new scraper Engine.
func New(cfg *config.Config, c *cache.Cache) *Engine {
	return &Engine{
		cfg:    cfg,
		cache:  c,
		client: &http.Client{Timeout: 15 * time.Second},
		feeds:  make(map[string][]string),
		stopCh: make(chan struct{}),
	}
}

// AddArtist discovers feeds for an artist and stores them for background polling.
// Returns the discovered feed URLs.
func (e *Engine) AddArtist(ctx context.Context, name string) ([]string, error) {
	feeds, err := DiscoverFeeds(ctx, e.client, name)
	if err != nil {
		return nil, fmt.Errorf("discover feeds for %q: %w", name, err)
	}

	e.mu.Lock()
	e.feeds[name] = feeds
	e.mu.Unlock()

	// Immediately fetch once to populate initial data
	go e.fetchArtist(name, feeds)

	return feeds, nil
}

// RemoveArtist stops tracking an artist's feeds.
func (e *Engine) RemoveArtist(name string) {
	e.mu.Lock()
	delete(e.feeds, name)
	e.mu.Unlock()
	// Clear cached tours for this artist
	e.cache.Delete("scraper:tours:" + strings.ToLower(name))
}

// GetTours returns scraped tours for an artist from the cache.
func (e *Engine) GetTours(name string) []models.Tour {
	key := "scraper:tours:" + strings.ToLower(name)
	val, ok := e.cache.Get(key)
	if !ok {
		return nil
	}
	tours, _ := val.([]models.Tour)
	return tours
}

// Start begins the background polling worker.
func (e *Engine) Start() {
	if !e.cfg.ScraperEnabled {
		return
	}
	e.running = true
	go e.worker()
}

// Stop terminates the background worker.
func (e *Engine) Stop() {
	if e.running {
		close(e.stopCh)
		e.running = false
	}
}

// GetFeeds returns the tracked feeds for an artist.
func (e *Engine) GetFeeds(name string) []string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.feeds[name]
}

// ListArtists returns all tracked artist names.
func (e *Engine) ListArtists() []string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	names := make([]string, 0, len(e.feeds))
	for name := range e.feeds {
		names = append(names, name)
	}
	return names
}

func (e *Engine) worker() {
	interval := e.cfg.ScraperInterval
	if interval <= 0 {
		interval = 30 * time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			e.pollAll()
		case <-e.stopCh:
			return
		}
	}
}

func (e *Engine) pollAll() {
	e.mu.RLock()
	// Copy to avoid holding lock during network I/O
	feedsCopy := make(map[string][]string, len(e.feeds))
	for k, v := range e.feeds {
		feedsCopy[k] = v
	}
	e.mu.RUnlock()

	for artist, urls := range feedsCopy {
		e.fetchArtist(artist, urls)
	}
}

func (e *Engine) fetchArtist(artist string, feedURLs []string) {
	var allTours []models.Tour

	for _, feedURL := range feedURLs {
		tours, err := e.fetchAndParse(feedURL, artist)
		if err != nil {
			continue // Individual feed failures are non-fatal
		}
		allTours = append(allTours, tours...)
	}

	if len(allTours) > 0 {
		key := "scraper:tours:" + strings.ToLower(artist)
		e.cache.SetTTL(key, allTours, 1*time.Hour)
	}
}

func (e *Engine) fetchAndParse(feedURL, artistName string) ([]models.Tour, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "HearME/0.1 ( RSS Scraper )")
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml")

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch feed %s: %w", feedURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("feed %s returned HTTP %d", feedURL, resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1MB limit
	if err != nil {
		return nil, fmt.Errorf("read feed %s: %w", feedURL, err)
	}

	return parseFeed(string(body), artistName, feedURL)
}

// parseFeed attempts to parse as RSS 2.0, then Atom 1.0.
func parseFeed(content, artistName, sourceURL string) ([]models.Tour, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, fmt.Errorf("empty feed")
	}

	// Try RSS 2.0
	if tours, err := parseRSS(content, artistName, sourceURL); err == nil && len(tours) > 0 {
		return tours, nil
	}

	// Try Atom 1.0
	if tours, err := parseAtom(content, artistName, sourceURL); err == nil && len(tours) > 0 {
		return tours, nil
	}

	return nil, fmt.Errorf("could not parse feed as RSS or Atom")
}

// --- RSS 2.0 types ---

type rssFeed struct {
	XMLName xml.Name   `xml:"rss"`
	Channel rssChannel `xml:"channel"`
}

type rssChannel struct {
	Items []rssItem `xml:"item"`
}

type rssItem struct {
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	Description string `xml:"description"`
	PubDate     string `xml:"pubDate"`
	Content     string `xml:"content encoded"`
}

func parseRSS(content, artistName, sourceURL string) ([]models.Tour, error) {
	var feed rssFeed
	if err := xml.NewDecoder(strings.NewReader(content)).Decode(&feed); err != nil {
		return nil, err
	}
	return extractToursFromEntries(artistName, sourceURL, len(feed.Channel.Items),
		func(i int) (title, body, dateStr, link string) {
			item := feed.Channel.Items[i]
			body = item.Description
			if item.Content != "" {
				body = item.Content
			}
			return item.Title, body, item.PubDate, item.Link
		}), nil
}

// --- Atom 1.0 types ---

type atomFeed struct {
	XMLName xml.Name    `xml:"feed"`
	Entries []atomEntry `xml:"entry"`
}

type atomEntry struct {
	Title     string   `xml:"title"`
	Link      atomLink `xml:"link"`
	Summary   string   `xml:"summary"`
	Content   string   `xml:"content"`
	Published string   `xml:"published"`
	Updated   string   `xml:"updated"`
}

type atomLink struct {
	Href string `xml:"href,attr"`
}

func parseAtom(content, artistName, sourceURL string) ([]models.Tour, error) {
	var feed atomFeed
	if err := xml.NewDecoder(strings.NewReader(content)).Decode(&feed); err != nil {
		return nil, err
	}

	return extractToursFromEntries(artistName, sourceURL, len(feed.Entries),
		func(i int) (title, body, dateStr, link string) {
			entry := feed.Entries[i]
			body = entry.Summary
			if entry.Content != "" {
				body = entry.Content
			}
			dateStr = entry.Published
			if dateStr == "" {
				dateStr = entry.Updated
			}
			if entry.Link.Href != "" {
				link = entry.Link.Href
			}
			return entry.Title, body, dateStr, link
		}), nil
}

// extractToursFromEntries iterates feed entries and extracts tour data.
func extractToursFromEntries(artistName, sourceURL string, count int,
	getEntry func(i int) (title, body, dateStr, link string)) []models.Tour {

	var tours []models.Tour
	for i := 0; i < count; i++ {
		title, body, dateStr, link := getEntry(i)

		// Combine title + body for text analysis
		text := title
		if body != "" {
			text += " " + stripHTML(body)
		}

		// Check if this entry is tour-related
		if !isTourRelated(text) {
			continue
		}

		// Extract date
		date := extractDate(text, dateStr)
		if date == "" {
			continue // Must have a date
		}

		// Extract location
		city, venue, country := extractLocation(text)

		tour := models.Tour{
			ID:         fmt.Sprintf("rss_%s_%d", sanitizeID(artistName), i),
			ArtistName: artistName,
			TourName:   title,
			Date:       date,
			City:       city,
			Venue:      venue,
			Country:    country,
			TicketURL:  link,
			Source:     "rss",
		}
		tours = append(tours, tour)
	}
	return tours
}
