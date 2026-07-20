package tours

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/hearme/app/internal/models"
)

// Bandsintown provides tour data from the Bandsintown API.
// Requires a free app_id. Rate limit: ~100 req/min.
type Bandsintown struct {
	client  *http.Client
	appID   string
	baseURL string
}

// NewBandsintown creates a new Bandsintown provider.
func NewBandsintown(appID string) *Bandsintown {
	return &Bandsintown{
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		appID:   appID,
		baseURL: "https://rest.bandsintown.com",
	}
}

func (b *Bandsintown) Name() string  { return "Bandsintown" }
func (b *Bandsintown) Enabled() bool { return b.appID != "" }

// GetTours fetches upcoming events for a list of artist names.
// Bandsintown requires one request per artist, so we fan out concurrently.
func (b *Bandsintown) GetTours(ctx context.Context, artistNames []string) ([]models.Tour, error) {
	var (
		mu  sync.Mutex
		all []models.Tour
		wg  sync.WaitGroup
		sem = make(chan struct{}, 3) // max 3 concurrent requests to Bandsintown
	)

	for _, name := range artistNames {
		wg.Add(1)
		go func(artistName string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			events, err := b.getArtistEvents(ctx, artistName)
			if err != nil {
				// Log but don't fail — some artists may not be on Bandsintown
				return
			}
			mu.Lock()
			all = append(all, events...)
			mu.Unlock()
		}(name)
	}
	wg.Wait()

	return all, nil
}

func (b *Bandsintown) getArtistEvents(ctx context.Context, artistName string) ([]models.Tour, error) {
	// Bandsintown uses the artist name in the URL path.
	// Must be URL-encoded, but Bandsintown expects spaces as %20 not +
	encoded := url.PathEscape(strings.ToLower(artistName))
	u := fmt.Sprintf("%s/artists/%s/events?app_id=%s&date=upcoming",
		b.baseURL, encoded, b.appID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("bandsintown: create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := b.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("bandsintown: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		// Artist not found on Bandsintown — not an error
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("bandsintown: HTTP %d: %s", resp.StatusCode, string(body))
	}

	var events []btEvent
	if err := json.NewDecoder(resp.Body).Decode(&events); err != nil {
		return nil, fmt.Errorf("bandsintown: decode: %w", err)
	}

	tours := make([]models.Tour, 0, len(events))
	for _, e := range events {
		tour := models.Tour{
			ID:         e.ID,
			ArtistName: artistName,
			Date:       e.DateTime,
			City:       e.Venue.City,
			Venue:      e.Venue.Name,
			Country:    e.Venue.Country,
			Source:     "bandsintown",
		}

		// Extract country code from venue location if available
		if e.Venue.Latitude != "" && e.Venue.Longitude != "" {
			tour.CountryCode = "" // Would need geocoding; skip for now
		}

		// Get ticket URL from offers
		for _, offer := range e.Offers {
			if offer.Type == "Tickets" && offer.URL != "" {
				tour.TicketURL = offer.URL
				break
			}
		}

		// Get image from artist info in the event
		if e.Artist.ImageURL != "" {
			tour.ImageURL = e.Artist.ImageURL
		}

		// Use description as tour name if present
		if e.Title != "" {
			tour.TourName = e.Title
		}

		// Try to extract a country code from the country name
		tour.CountryCode = guessCountryCode(tour.Country)

		tours = append(tours, tour)
	}

	return tours, nil
}

// --- Bandsintown JSON types ---

type btEvent struct {
	ID       string    `json:"id"`
	DateTime string    `json:"datetime"`
	Title    string    `json:"title"`
	Venue    btVenue   `json:"venue"`
	Offers   []btOffer `json:"offers"`
	Lineup   []string  `json:"lineup"`
	Artist   btArtist  `json:"artist"`
}

type btVenue struct {
	Name      string `json:"name"`
	City      string `json:"city"`
	Country   string `json:"country"`
	Latitude  string `json:"latitude"`
	Longitude string `json:"longitude"`
}

type btOffer struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

type btArtist struct {
	Name     string `json:"name"`
	ImageURL string `json:"image_url"`
}

// guessCountryCode maps common country names to ISO 3166-1 alpha-2 codes.
func guessCountryCode(country string) string {
	codes := map[string]string{
		"united states": "US", "united kingdom": "GB", "canada": "CA",
		"australia": "AU", "germany": "DE", "france": "FR", "japan": "JP",
		"brazil": "BR", "mexico": "MX", "italy": "IT", "spain": "ES",
		"netherlands": "NL", "sweden": "SE", "norway": "NO", "denmark": "DK",
		"finland": "FI", "belgium": "BE", "austria": "AT", "switzerland": "CH",
		"portugal": "PT", "ireland": "IE", "poland": "PL", "new zealand": "NZ",
		"argentina": "AR", "chile": "CL", "colombia": "CO", "peru": "PE",
		"south korea": "KR", "china": "CN", "india": "IN", "russia": "RU",
		"south africa": "ZA", "turkey": "TR", "indonesia": "ID",
		"philippines": "PH", "thailand": "TH", "malaysia": "MY",
		"singapore": "SG", "hong kong": "HK", "taiwan": "TW",
		"czech republic": "CZ", "hungary": "HU", "romania": "RO",
		"greece": "GR", "croatia": "HR", "serbia": "RS", "ukraine": "UA",
		"iceland": "IS", "luxembourg": "LU", "united arab emirates": "AE",
		"israel": "IL", "egypt": "EG", "morocco": "MA",
	}
	if code, ok := codes[strings.ToLower(strings.TrimSpace(country))]; ok {
		return code
	}
	return ""
}
