package tours

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/hearme/app/internal/models"
)

// Ticketmaster provides tour data from the Ticketmaster Discovery API.
// Requires a paid API key.
type Ticketmaster struct {
	client  *http.Client
	apiKey  string
	baseURL string
}

// NewTicketmaster creates a new Ticketmaster provider.
func NewTicketmaster(apiKey string) *Ticketmaster {
	return &Ticketmaster{
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		apiKey:  apiKey,
		baseURL: "https://app.ticketmaster.com/discovery/v2",
	}
}

func (t *Ticketmaster) Name() string  { return "Ticketmaster" }
func (t *Ticketmaster) Enabled() bool { return t.apiKey != "" }

// GetTours fetches upcoming events for a list of artist names.
func (t *Ticketmaster) GetTours(ctx context.Context, artistNames []string) ([]models.Tour, error) {
	var all []models.Tour

	for _, name := range artistNames {
		events, err := t.getArtistEvents(ctx, name)
		if err != nil {
			continue // Individual failures are non-fatal
		}
		all = append(all, events...)
	}

	return all, nil
}

func (t *Ticketmaster) getArtistEvents(ctx context.Context, artistName string) ([]models.Tour, error) {
	params := url.Values{}
	params.Set("keyword", artistName)
	params.Set("apikey", t.apiKey)
	params.Set("size", "20")
	params.Set("sort", "date,asc")

	u := fmt.Sprintf("%s/events.json?%s", t.baseURL, params.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("ticketmaster: create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := t.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ticketmaster: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("ticketmaster: HTTP %d: %s", resp.StatusCode, string(body))
	}

	var result tmEventSearch
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("ticketmaster: decode: %w", err)
	}

	tours := make([]models.Tour, 0)
	for _, event := range result.Embedded.Events {
		tour := models.Tour{
			ID:         event.ID,
			ArtistName: artistName,
			TourName:   event.Name,
			Venue:      event.Embedded.Venues[0].Name,
			City:       event.Embedded.Venues[0].City.Name,
			Country:    event.Embedded.Venues[0].Country.Name,
			Source:     "ticketmaster",
		}

		// Country code
		tour.CountryCode = event.Embedded.Venues[0].Country.CountryCode

		// Date
		if event.Dates.Start.LocalDate != "" {
			tour.Date = event.Dates.Start.LocalDate
		}

		// Ticket URL
		if event.URL != "" {
			tour.TicketURL = event.URL
		}

		// Image
		if len(event.Images) > 0 {
			tour.ImageURL = event.Images[0].URL
		}

		tours = append(tours, tour)
	}

	return tours, nil
}

// --- Ticketmaster JSON types ---

type tmEventSearch struct {
	Embedded struct {
		Events []tmEvent `json:"events"`
	} `json:"_embedded"`
}

type tmEvent struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	URL      string    `json:"url"`
	Images   []tmImage `json:"images"`
	Dates    tmDates   `json:"dates"`
	Embedded struct {
		Venues []tmVenue `json:"venues"`
	} `json:"_embedded"`
}

type tmDates struct {
	Start struct {
		LocalDate string `json:"localDate"`
	} `json:"start"`
}

type tmVenue struct {
	Name string `json:"name"`
	City struct {
		Name string `json:"name"`
	} `json:"city"`
	Country struct {
		Name        string `json:"name"`
		CountryCode string `json:"countryCode"`
	} `json:"country"`
}

type tmImage struct {
	URL string `json:"url"`
}
