package lyrics

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Provider fetches song lyrics from an external API.
type Provider struct {
	client *http.Client
	source string // "lyricsovh" or "genius"
	apiKey string // for Genius, etc.
}

// New creates a lyrics provider with the given source.
// source: "lyricsovh" (free, no key), "genius" (needs key)
func New(source, apiKey string) *Provider {
	return &Provider{
		client: &http.Client{Timeout: 10 * time.Second},
		source: source,
		apiKey: apiKey,
	}
}

// GetLyrics fetches lyrics for a given artist and track.
func (p *Provider) GetLyrics(ctx context.Context, artist, track string) (string, error) {
	switch p.source {
	case "lyricsovh":
		return p.lyricsOVH(ctx, artist, track)
	case "genius":
		return p.genius(ctx, artist, track)
	default:
		return "", fmt.Errorf("unknown lyrics source: %s", p.source)
	}
}

func (p *Provider) lyricsOVH(ctx context.Context, artist, track string) (string, error) {
	// Clean names for URL
	artist = strings.TrimSpace(artist)
	track = strings.TrimSpace(track)

	u := fmt.Sprintf("https://api.lyrics.ovh/v1/%s/%s",
		url.PathEscape(artist), url.PathEscape(track))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("lyrics.ovh: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return "", nil // No lyrics found — not an error
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("lyrics.ovh: HTTP %d", resp.StatusCode)
	}

	var result struct {
		Lyrics string `json:"lyrics"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("lyrics.ovh: decode: %w", err)
	}

	return result.Lyrics, nil
}

func (p *Provider) genius(ctx context.Context, artist, track string) (string, error) {
	if p.apiKey == "" {
		return "", fmt.Errorf("genius: API key not configured")
	}

	// Genius search endpoint
	query := fmt.Sprintf("%s %s", artist, track)
	u := fmt.Sprintf("https://api.genius.com/search?q=%s", url.QueryEscape(query))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("genius: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return "", fmt.Errorf("genius: HTTP %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Response struct {
			Hits []struct {
				Result struct {
					URL string `json:"url"`
				} `json:"result"`
			} `json:"hits"`
		} `json:"response"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("genius: decode: %w", err)
	}

	if len(result.Response.Hits) == 0 {
		return "", nil
	}

	// Return Genius URL (full lyrics scraping requires more work)
	return fmt.Sprintf("https://genius.com%s", result.Response.Hits[0].Result.URL), nil
}
