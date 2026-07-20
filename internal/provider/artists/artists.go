package artists

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/hearme/app/config"
	"github.com/hearme/app/internal/models"
	"github.com/hearme/app/internal/provider"
)

// Aggregator fans out artist queries to all enabled providers and merges results.
type Aggregator struct {
	providers []provider.ArtistProvider
}

// NewAggregator creates an Aggregator with all enabled artist providers.
func NewAggregator(cfg *config.Config) *Aggregator {
	agg := &Aggregator{}

	// MusicBrainz is always enabled (free, no key needed)
	agg.providers = append(agg.providers, NewMusicBrainz())

	// Last.fm requires an API key
	if cfg.LastFMAPIKey != "" {
		agg.providers = append(agg.providers, NewLastFM(cfg.LastFMAPIKey))
	}

	names := make([]string, len(agg.providers))
	for i, p := range agg.providers {
		names[i] = p.Name()
	}
	log.Printf("artist providers: %v", names)

	return agg
}

// Search finds artists across all enabled providers.
// Returns a deduplicated list of candidates for disambiguation.
func (a *Aggregator) Search(ctx context.Context, query string) ([]models.ArtistMatch, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	var (
		mu       sync.Mutex
		all      []models.ArtistMatch
		wg       sync.WaitGroup
		firstErr error
	)

	for _, p := range a.providers {
		wg.Add(1)
		go func(p provider.ArtistProvider) {
			defer wg.Done()
			results, err := p.Search(ctx, query)
			if err != nil {
				log.Printf("[%s] search error: %v", p.Name(), err)
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

	return deduplicateMatches(all), nil
}

// GetRelated fetches related artists from all enabled providers.
func (a *Aggregator) GetRelated(ctx context.Context, artist models.Artist) ([]models.ArtistRelation, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	var (
		mu  sync.Mutex
		all []models.ArtistRelation
		wg  sync.WaitGroup
	)

	for _, p := range a.providers {
		wg.Add(1)
		go func(p provider.ArtistProvider) {
			defer wg.Done()
			results, err := p.GetRelated(ctx, artist)
			if err != nil {
				log.Printf("[%s] getRelated error: %v", p.Name(), err)
				return
			}
			mu.Lock()
			all = append(all, results...)
			mu.Unlock()
		}(p)
	}
	wg.Wait()

	return deduplicateRelations(all), nil
}

// GetMetadata enriches an artist with genre, image, popularity, and bio data.
// Merges results from all enabled providers.
func (a *Aggregator) GetMetadata(ctx context.Context, name string) (*models.Artist, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	var merged models.Artist
	merged.Name = name
	merged.ID = "local_" + sanitizeID(name)
	found := false

	for _, p := range a.providers {
		meta, err := p.GetMetadata(ctx, name)
		if err != nil {
			log.Printf("[%s] getMetadata error: %v", p.Name(), err)
			continue
		}
		if meta == nil {
			continue
		}
		found = true
		if meta.ID != "" {
			merged.ID = meta.ID
		}
		if meta.Name != "" {
			merged.Name = meta.Name
		}
		if len(meta.Genres) > 0 {
			merged.Genres = append(merged.Genres, meta.Genres...)
		}
		if meta.ImageURL != "" {
			merged.ImageURL = meta.ImageURL
		}
		if meta.Bio != "" {
			merged.Bio = meta.Bio
		}
		if meta.Popularity > merged.Popularity {
			merged.Popularity = meta.Popularity
		}
	}

	if !found {
		return &models.Artist{ID: "local_" + sanitizeID(name), Name: name}, nil
	}

	// Deduplicate genres
	seen := make(map[string]bool)
	var uniqueGenres []string
	for _, g := range merged.Genres {
		lower := strings.ToLower(g)
		if !seen[lower] {
			seen[lower] = true
			uniqueGenres = append(uniqueGenres, g)
		}
	}
	merged.Genres = uniqueGenres

	return &merged, nil
}

// GetDiscography fetches releases from all enabled providers and merges.
func (a *Aggregator) GetDiscography(ctx context.Context, artist models.Artist) ([]models.Release, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	var (
		mu  sync.Mutex
		all []models.Release
		wg  sync.WaitGroup
	)

	for _, p := range a.providers {
		wg.Add(1)
		go func(p provider.ArtistProvider) {
			defer wg.Done()
			results, err := p.GetDiscography(ctx, artist)
			if err != nil {
				log.Printf("[%s] getDiscography error: %v", p.Name(), err)
				return
			}
			mu.Lock()
			all = append(all, results...)
			mu.Unlock()
		}(p)
	}
	wg.Wait()

	// Deduplicate by title (case insensitive)
	seen := make(map[string]bool)
	var deduped []models.Release
	for _, r := range all {
		key := strings.ToLower(r.Title)
		if !seen[key] {
			seen[key] = true
			deduped = append(deduped, r)
		}
	}

	// Sort by year descending
	sort.Slice(deduped, func(i, j int) bool {
		return deduped[i].Year > deduped[j].Year
	})

	return deduped, nil
}

// GetAlbumInfo tries all enabled providers and returns the first successful result.
func (a *Aggregator) GetAlbumInfo(ctx context.Context, artistName, albumName string) (*models.AlbumDetail, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	for _, p := range a.providers {
		album, err := p.GetAlbumInfo(ctx, artistName, albumName)
		if err != nil {
			log.Printf("[%s] getAlbumInfo error: %v", p.Name(), err)
			continue
		}
		if album != nil {
			return album, nil
		}
	}

	return nil, fmt.Errorf("album not found: %q - %q", artistName, albumName)
}

func deduplicateMatches(matches []models.ArtistMatch) []models.ArtistMatch {
	seen := make(map[string]bool)
	var result []models.ArtistMatch
	for _, m := range matches {
		key := m.ID
		if key == "" {
			key = m.Name
		}
		if !seen[key] {
			seen[key] = true
			result = append(result, m)
		}
	}
	return result
}

func deduplicateRelations(rels []models.ArtistRelation) []models.ArtistRelation {
	seen := make(map[string]bool)
	var result []models.ArtistRelation

	for _, r := range rels {
		// Deduplicate by ID first, then by case-insensitive name
		key := r.Artist.ID
		if key == "" {
			key = strings.ToLower(r.Artist.Name)
		}
		if seen[key] {
			// Already have this artist — keep the one with the higher score
			for i, existing := range result {
				existingKey := existing.Artist.ID
				if existingKey == "" {
					existingKey = strings.ToLower(existing.Artist.Name)
				}
				if existingKey == key && r.Score > existing.Score {
					result[i] = r
				}
			}
			continue
		}
		seen[key] = true

		// Also mark the lowercased name as seen to catch cross-provider duplicates
		nameKey := strings.ToLower(r.Artist.Name)
		if nameKey != key {
			seen[nameKey] = true
		}

		result = append(result, r)
	}

	// Sort by score descending, then by name
	sort.Slice(result, func(i, j int) bool {
		if result[i].Score != result[j].Score {
			return result[i].Score > result[j].Score
		}
		return result[i].Artist.Name < result[j].Artist.Name
	})

	// Limit to 20 results to keep the graph manageable
	if len(result) > 20 {
		result = result[:20]
	}

	return result
}

func sanitizeID(s string) string {
	b := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			b = append(b, c)
		} else if c >= 'A' && c <= 'Z' {
			b = append(b, c+32)
		} else if c == ' ' || c == '-' {
			b = append(b, '_')
		}
	}
	return string(b)
}
