package tours

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/hearme/app/config"
	"github.com/hearme/app/internal/models"
	"github.com/hearme/app/internal/provider"
)

// Aggregator fans out tour queries to all enabled providers and merges results.
type Aggregator struct {
	providers []provider.TourProvider
}

// NewAggregator creates an Aggregator with all enabled tour providers.
func NewAggregator(cfg *config.Config) *Aggregator {
	agg := &Aggregator{}

	if cfg.BandsintownAppID != "" {
		agg.providers = append(agg.providers, NewBandsintown(cfg.BandsintownAppID))
	}
	if cfg.SongkickAPIKey != "" {
		agg.providers = append(agg.providers, NewSongkick(cfg.SongkickAPIKey))
	}
	if cfg.TicketmasterKey != "" {
		agg.providers = append(agg.providers, NewTicketmaster(cfg.TicketmasterKey))
	}

	names := make([]string, len(agg.providers))
	for i, p := range agg.providers {
		names[i] = p.Name()
	}
	if len(names) > 0 {
		log.Printf("tour providers: %v", names)
	} else {
		log.Printf("tour providers: none configured")
	}

	return agg
}

// GetTours fetches upcoming tours for the given artists from all enabled providers.
func (a *Aggregator) GetTours(ctx context.Context, artistNames []string) ([]models.Tour, error) {
	if len(a.providers) == 0 {
		return nil, fmt.Errorf("no tour providers configured")
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var (
		mu       sync.Mutex
		all      []models.Tour
		wg       sync.WaitGroup
		firstErr error
	)

	for _, p := range a.providers {
		wg.Add(1)
		go func(p provider.TourProvider) {
			defer wg.Done()
			results, err := p.GetTours(ctx, artistNames)
			if err != nil {
				log.Printf("[%s] getTours error: %v", p.Name(), err)
				mu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
				return
			}
			mu.Lock()
			all = append(all, results...)
			mu.Unlock()
		}(p)
	}
	wg.Wait()

	if len(all) == 0 && firstErr != nil {
		return nil, fmt.Errorf("all providers failed: %w", firstErr)
	}

	return deduplicateTours(all), nil
}

// HasProviders returns true if at least one tour provider is configured.
func (a *Aggregator) HasProviders() bool {
	return len(a.providers) > 0
}

func deduplicateTours(tours []models.Tour) []models.Tour {
	seen := make(map[string]bool)
	var result []models.Tour
	for _, t := range tours {
		key := t.ID
		if key == "" {
			key = fmt.Sprintf("%s|%s|%s|%s", t.ArtistName, t.Date, t.Venue, t.City)
		}
		if !seen[key] {
			seen[key] = true
			result = append(result, t)
		}
	}
	return result
}
