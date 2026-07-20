package artists

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/hearme/app/internal/models"
)

// LastFM provides artist data from the Last.fm API.
// Requires a free API key. Rate limit: ~5 req/sec.
type LastFM struct {
	client  *http.Client
	apiKey  string
	baseURL string
}

// NewLastFM creates a new Last.fm provider.
func NewLastFM(apiKey string) *LastFM {
	return &LastFM{
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		apiKey:  apiKey,
		baseURL: "https://ws.audioscrobbler.com/2.0/",
	}
}

func (l *LastFM) Name() string  { return "Last.fm" }
func (l *LastFM) Enabled() bool { return l.apiKey != "" }

// Search finds artists on Last.fm.
func (l *LastFM) Search(ctx context.Context, query string) ([]models.ArtistMatch, error) {
	params := url.Values{}
	params.Set("method", "artist.search")
	params.Set("artist", query)
	params.Set("api_key", l.apiKey)
	params.Set("format", "json")
	params.Set("limit", "10")

	var result struct {
		Results struct {
			ArtistMatches struct {
				Artist []lfArtistSearch `json:"artist"`
			} `json:"artistmatches"`
		} `json:"results"`
	}

	if err := l.call(ctx, params, &result); err != nil {
		return nil, err
	}

	matches := make([]models.ArtistMatch, 0, len(result.Results.ArtistMatches.Artist))
	for _, a := range result.Results.ArtistMatches.Artist {
		matches = append(matches, models.ArtistMatch{
			ID:     a.MBID,
			Name:   a.Name,
			Genres: nil, // Last.fm search doesn't include tags
			Score:  parseIntOrZero(a.Listeners),
		})
	}
	return matches, nil
}

// GetRelated returns similar artists from Last.fm.
func (l *LastFM) GetRelated(ctx context.Context, artist models.Artist) ([]models.ArtistRelation, error) {
	params := url.Values{}
	params.Set("method", "artist.getsimilar")
	params.Set("artist", artist.Name)
	params.Set("api_key", l.apiKey)
	params.Set("format", "json")
	params.Set("limit", "10")
	params.Set("autocorrect", "1")

	var result struct {
		SimilarArtists struct {
			Artist []lfSimilarArtist `json:"artist"`
		} `json:"similarartists"`
	}

	if err := l.call(ctx, params, &result); err != nil {
		return nil, err
	}

	relations := make([]models.ArtistRelation, 0, len(result.SimilarArtists.Artist))
	for _, a := range result.SimilarArtists.Artist {
		if a.Name == "" {
			continue
		}
		relations = append(relations, models.ArtistRelation{
			Artist: models.Artist{
				ID:         a.MBID,
				Name:       a.Name,
				ImageURL:   getBestImage(a.Images),
				Popularity: 0,
			},
			RelationType: "similar",
			Score:        parseFloatOrZero(a.Match),
		})
	}
	return relations, nil
}

// GetMetadata enriches an artist with genres, image, and popularity.
func (l *LastFM) GetMetadata(ctx context.Context, name string) (*models.Artist, error) {
	params := url.Values{}
	params.Set("method", "artist.getinfo")
	params.Set("artist", name)
	params.Set("api_key", l.apiKey)
	params.Set("format", "json")
	params.Set("autocorrect", "1")

	var result struct {
		Artist lfArtistInfo `json:"artist"`
	}

	if err := l.call(ctx, params, &result); err != nil {
		return nil, err
	}

	a := result.Artist
	if a.Name == "" {
		return nil, fmt.Errorf("lastfm: artist not found: %q", name)
	}

	genres := make([]string, 0, len(a.Tags.Tag))
	for _, t := range a.Tags.Tag {
		if t.Name != "" {
			genres = append(genres, t.Name)
		}
	}

	popularity := 0
	if a.Stats.Listeners != "" {
		if n, err := strconv.Atoi(a.Stats.Listeners); err == nil {
			// Normalize to 0-100 scale
			if n > 1000000 {
				popularity = 90 + (n/1000000)%10
			} else if n > 100000 {
				popularity = 70 + (n/100000)%10
			} else if n > 10000 {
				popularity = 50 + (n/10000)%10
			} else if n > 1000 {
				popularity = 30 + (n/1000)%10
			} else {
				popularity = n / 100
			}
			if popularity > 100 {
				popularity = 100
			}
		}
	}

	imageURL := ""
	for _, img := range a.Images {
		if img.Size == "large" || img.Size == "extralarge" || img.Size == "mega" {
			imageURL = img.URL
		}
	}

	return &models.Artist{
		ID:         a.MBID,
		Name:       a.Name,
		Genres:     genres,
		ImageURL:   imageURL,
		Popularity: popularity,
		Bio:        lastfmStripHTML(a.Bio.Summary),
	}, nil
}

// lastfmStripHTML removes HTML tags from Last.fm bio text.
func lastfmStripHTML(s string) string {
	// Simple tag stripping
	var b strings.Builder
	inTag := false
	for _, c := range s {
		if c == '<' {
			inTag = true
		} else if c == '>' {
			inTag = false
		} else if !inTag {
			b.WriteRune(c)
		}
	}
	// Collapse whitespace
	result := strings.TrimSpace(b.String())
	// Replace common entities
	result = strings.ReplaceAll(result, "&amp;", "&")
	result = strings.ReplaceAll(result, "&quot;", "\"")
	result = strings.ReplaceAll(result, "&#39;", "'")
	return result
}

// GetDiscography returns top albums from Last.fm.
func (l *LastFM) GetDiscography(ctx context.Context, artist models.Artist) ([]models.Release, error) {
	params := url.Values{}
	params.Set("method", "artist.gettopalbums")
	params.Set("artist", artist.Name)
	params.Set("api_key", l.apiKey)
	params.Set("format", "json")
	params.Set("limit", "50")
	params.Set("autocorrect", "1")

	var result struct {
		TopAlbums struct {
			Album []lfAlbum `json:"album"`
		} `json:"topalbums"`
	}

	if err := l.call(ctx, params, &result); err != nil {
		return nil, err
	}

	releases := make([]models.Release, 0, len(result.TopAlbums.Album))
	for _, a := range result.TopAlbums.Album {
		if a.Name == "" {
			continue
		}

		releaseType := "album"
		lowerName := strings.ToLower(a.Name)
		if strings.Contains(lowerName, "ep") || strings.Contains(lowerName, "single") {
			releaseType = "single"
		}

		releases = append(releases, models.Release{
			ID:       a.MBID,
			Title:    a.Name,
			Type:     releaseType,
			ImageURL: getBestImage(a.Images),
		})
	}

	return releases, nil
}

// GetAlbumInfo returns full album details from Last.fm.
func (l *LastFM) GetAlbumInfo(ctx context.Context, artistName, albumName string) (*models.AlbumDetail, error) {
	params := url.Values{}
	params.Set("method", "album.getinfo")
	params.Set("artist", artistName)
	params.Set("album", albumName)
	params.Set("api_key", l.apiKey)
	params.Set("format", "json")
	params.Set("autocorrect", "1")

	var result struct {
		Album lfAlbumDetail `json:"album"`
	}

	if err := l.call(ctx, params, &result); err != nil {
		return nil, err
	}

	log.Printf("[lastfm] album.getInfo: name=%q tracks=%d images=%d playcount=%q",
		result.Album.Name, len(result.Album.Tracks.Track), len(result.Album.Images), result.Album.PlayCount)

	a := result.Album
	if a.Name == "" {
		return nil, fmt.Errorf("lastfm: album not found: %q - %q", artistName, albumName)
	}

	genres := make([]string, 0)
	for _, t := range a.Tags.Tag {
		if t.Name != "" {
			genres = append(genres, t.Name)
		}
	}

	tracks := make([]models.Track, 0, len(a.Tracks.Track))
	for _, t := range a.Tracks.Track {
		duration := ""
		if t.Duration > 0 {
			mins := t.Duration / 60
			secs := t.Duration % 60
			duration = fmt.Sprintf("%d:%02d", mins, secs)
		}
		tracks = append(tracks, models.Track{
			Number:   t.Attr.Rank,
			Title:    t.Name,
			Duration: duration,
		})
	}

	year := 0
	if a.Wiki.Published != "" {
		if d, err := time.Parse("2 Jan 2006, 15:04", a.Wiki.Published); err == nil {
			year = d.Year()
		}
	}

	imageURL := ""
	for _, img := range a.Images {
		if img.Size == "extralarge" || img.Size == "mega" {
			imageURL = img.URL
		}
	}

	return &models.AlbumDetail{
		ID:        a.MBID,
		Title:     a.Name,
		Artist:    a.Artist,
		Year:      year,
		ImageURL:  imageURL,
		Genres:    genres,
		PlayCount: parseIntOrZero(a.PlayCount),
		Tracks:    tracks,
	}, nil
}

func (l *LastFM) call(ctx context.Context, params url.Values, result any) error {
	u := l.baseURL + "?" + params.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return fmt.Errorf("lastfm: create request: %w", err)
	}
	req.Header.Set("User-Agent", "HearME/0.1")
	req.Header.Set("Accept", "application/json")

	resp, err := l.client.Do(req)
	if err != nil {
		return fmt.Errorf("lastfm: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("lastfm: HTTP %d: %s", resp.StatusCode, string(body))
	}

	// Read body once
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("lastfm: read body: %w", err)
	}

	// Check for Last.fm API-level errors (wrapped in 200)
	var errCheck struct {
		Error   int    `json:"error"`
		Message string `json:"message"`
	}
	if json.Unmarshal(bodyBytes, &errCheck) == nil && errCheck.Error > 0 {
		return fmt.Errorf("lastfm: API error %d: %s", errCheck.Error, errCheck.Message)
	}

	if err := json.Unmarshal(bodyBytes, result); err != nil {
		return fmt.Errorf("lastfm: decode: %w", err)
	}

	return nil
}

// --- Last.fm JSON types ---

type lfArtistSearch struct {
	Name      string `json:"name"`
	MBID      string `json:"mbid"`
	Listeners string `json:"listeners"`
}

type lfSimilarArtist struct {
	Name   string    `json:"name"`
	MBID   string    `json:"mbid"`
	Match  string    `json:"match"`
	Images []lfImage `json:"image"`
}

type lfArtistInfo struct {
	Name   string    `json:"name"`
	MBID   string    `json:"mbid"`
	Tags   lfTags    `json:"tags"`
	Stats  lfStats   `json:"stats"`
	Images []lfImage `json:"image"`
	Bio    lfBio     `json:"bio"`
}

type lfBio struct {
	Summary string `json:"summary"`
}

type lfTags struct {
	Tag []lfTag `json:"tag"`
}

type lfTag struct {
	Name string `json:"name"`
}

type lfStats struct {
	Listeners string `json:"listeners"`
	PlayCount string `json:"playcount"`
}

type lfImage struct {
	URL  string `json:"#text"`
	Size string `json:"size"`
}

func getBestImage(images []lfImage) string {
	for _, img := range images {
		if img.Size == "large" || img.Size == "extralarge" || img.Size == "mega" {
			return img.URL
		}
	}
	return ""
}

type lfAlbum struct {
	Name      string    `json:"name"`
	MBID      string    `json:"mbid"`
	PlayCount int       `json:"playcount"`
	Images    []lfImage `json:"image"`
}

type lfAlbumDetail struct {
	Name      string    `json:"name"`
	MBID      string    `json:"mbid"`
	Artist    string    `json:"artist"`
	PlayCount string    `json:"playcount"`
	Images    []lfImage `json:"image"`
	Tags      lfTags    `json:"tags"`
	Tracks    lfTracks  `json:"tracks"`
	Wiki      lfWiki    `json:"wiki"`
}

type lfTracks struct {
	Track []lfTrack `json:"track"`
}

type lfTrack struct {
	Name     string `json:"name"`
	Duration int    `json:"duration"`
	Attr     lfAttr `json:"@attr"`
}

type lfAttr struct {
	Rank int `json:"rank"`
}

type lfWiki struct {
	Published string `json:"published"`
}

func parseIntOrZero(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

func parseFloatOrZero(s string) float64 {
	f, _ := strconv.ParseFloat(s, 64)
	return f
}
