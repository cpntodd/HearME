package tours

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/hearme/app/internal/models"
)

// Songkick provides tour data from the Songkick API.
// Requires a paid API key.
type Songkick struct {
	client  *http.Client
	apiKey  string
	baseURL string
}

// NewSongkick creates a new Songkick provider.
func NewSongkick(apiKey string) *Songkick {
	return &Songkick{
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		apiKey:  apiKey,
		baseURL: "https://api.songkick.com/api/3.0",
	}
}

func (s *Songkick) Name() string  { return "Songkick" }
func (s *Songkick) Enabled() bool { return s.apiKey != "" }

// GetTours fetches upcoming events for a list of artist names.
func (s *Songkick) GetTours(ctx context.Context, artistNames []string) ([]models.Tour, error) {
	var all []models.Tour

	for _, name := range artistNames {
		events, err := s.getArtistEvents(ctx, name)
		if err != nil {
			continue // Individual artist failures are non-fatal
		}
		all = append(all, events...)
	}

	return all, nil
}

func (s *Songkick) getArtistEvents(ctx context.Context, artistName string) ([]models.Tour, error) {
	// Songkick requires artist name in the path (case-sensitive search)
	u := fmt.Sprintf("%s/search/artists.json?query=%s&apikey=%s",
		s.baseURL, url.QueryEscape(artistName), s.apiKey)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("songkick: create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("songkick: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("songkick: HTTP %d: %s", resp.StatusCode, string(body))
	}

	var result skArtistSearch
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("songkick: decode: %w", err)
	}

	if len(result.ResultsPage.Results.Artist) == 0 {
		return nil, nil
	}

	// Get the first matching artist's ID
	artistID := result.ResultsPage.Results.Artist[0].ID
	if artistID == 0 {
		return nil, nil
	}

	// Fetch the artist's calendar (upcoming events)
	return s.getArtistCalendar(ctx, artistID, artistName)
}

func (s *Songkick) getArtistCalendar(ctx context.Context, artistID int, artistName string) ([]models.Tour, error) {
	u := fmt.Sprintf("%s/artists/%d/calendar.json?apikey=%s",
		s.baseURL, artistID, s.apiKey)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("songkick calendar: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil // No upcoming events
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("songkick calendar: HTTP %d", resp.StatusCode)
	}

	var result skCalendar
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("songkick calendar: decode: %w", err)
	}

	tours := make([]models.Tour, 0)
	for _, event := range result.ResultsPage.Results.Event {
		tour := models.Tour{
			ID:         fmt.Sprintf("sk_%d", event.ID),
			ArtistName: artistName,
			Date:       event.Start.Date,
			Venue:      event.Venue.DisplayName,
			City:       event.Location.City,
			Source:     "songkick",
		}

		// Extract country from city string (e.g., "London, UK")
		parts := strings.SplitN(event.Location.City, ",", 2)
		if len(parts) == 2 {
			tour.City = strings.TrimSpace(parts[0])
			tour.Country = strings.TrimSpace(parts[1])
		} else {
			tour.City = event.Location.City
		}

		if event.TicketURI != "" {
			tour.TicketURL = event.TicketURI
		}

		// Determine tour name from event type + display name
		if event.Type == "Festival" {
			tour.TourName = event.DisplayName
		}

		tours = append(tours, tour)
	}

	return tours, nil
}

// --- Songkick JSON types ---

type skArtistSearch struct {
	ResultsPage struct {
		Results struct {
			Artist []skArtist `json:"artist"`
		} `json:"results"`
	} `json:"resultsPage"`
}

type skArtist struct {
	ID          int    `json:"id"`
	DisplayName string `json:"displayName"`
}

type skCalendar struct {
	ResultsPage struct {
		Results struct {
			Event []skEvent `json:"event"`
		} `json:"results"`
	} `json:"resultsPage"`
}

type skEvent struct {
	ID          int     `json:"id"`
	DisplayName string  `json:"displayName"`
	Type        string  `json:"type"`
	Start       skStart `json:"start"`
	Venue       skVenue `json:"venue"`
	Location    skCity  `json:"location"`
	URI         string  `json:"uri"`
	TicketURI   string  `json:"ticketUri"`
}

type skStart struct {
	Date string `json:"date"`
}

type skVenue struct {
	DisplayName string `json:"displayName"`
}

type skCity struct {
	City string `json:"city"`
}
