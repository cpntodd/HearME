package artists

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/hearme/app/internal/models"
)

// MusicBrainz provides artist data from the MusicBrainz API.
// Free, no API key required. Rate limit: ~1 req/sec.
type MusicBrainz struct {
	client  *http.Client
	baseURL string
	// Simple rate limiter
	lastRequest time.Time
}

// NewMusicBrainz creates a new MusicBrainz provider.
func NewMusicBrainz() *MusicBrainz {
	return &MusicBrainz{
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		baseURL: "https://musicbrainz.org/ws/2",
	}
}

func (m *MusicBrainz) Name() string  { return "MusicBrainz" }
func (m *MusicBrainz) Enabled() bool { return true }

// Search finds artists matching a query.
func (m *MusicBrainz) Search(ctx context.Context, query string) ([]models.ArtistMatch, error) {
	m.throttle()

	u := fmt.Sprintf("%s/artist/?query=artist:%s&fmt=json&limit=10",
		m.baseURL, url.QueryEscape(query))

	var result struct {
		Artists []mbArtist `json:"artists"`
	}

	if err := m.doWithRetry(ctx, u, &result); err != nil {
		return nil, err
	}

	matches := make([]models.ArtistMatch, 0, len(result.Artists))
	for _, a := range result.Artists {
		if a.Name == "" {
			continue
		}
		tags := make([]string, 0, len(a.Tags))
		for _, t := range a.Tags {
			if t.Name != "" {
				tags = append(tags, t.Name)
			}
		}
		matches = append(matches, models.ArtistMatch{
			ID:             a.ID,
			Name:           a.Name,
			Disambiguation: a.Disambiguation,
			Genres:         tags,
			Country:        a.Country,
			Score:          a.Score,
		})
	}

	return matches, nil
}

// GetRelated returns artists related to the given artist via MusicBrainz relations.
func (m *MusicBrainz) GetRelated(ctx context.Context, artist models.Artist) ([]models.ArtistRelation, error) {
	if artist.ID == "" || strings.HasPrefix(artist.ID, "local_") {
		// Need to resolve the MusicBrainz ID first
		resolved, err := m.resolveID(ctx, artist.Name)
		if err != nil || resolved == "" {
			return nil, fmt.Errorf("musicbrainz: cannot resolve artist ID for %q", artist.Name)
		}
		artist.ID = resolved
	}

	m.throttle()

	u := fmt.Sprintf("%s/artist/%s?inc=artist-rels+tags&fmt=json",
		m.baseURL, artist.ID)

	var result mbArtistDetail
	if err := m.doWithRetry(ctx, u, &result); err != nil {
		return nil, err
	}

	relations := make([]models.ArtistRelation, 0, len(result.Relations))
	for _, rel := range result.Relations {
		if rel.Artist.ID == "" || rel.Artist.Name == "" {
			continue
		}
		if rel.Type == "" {
			continue
		}

		// Only include musically meaningful relations between bands/artists.
		// Exclude: band members, producers, engineers, cover artists, tribute acts, etc.
		relationType, include := classifyRelation(rel.Type, rel.Direction, rel.Artist.Type)
		if !include {
			continue
		}

		// Skip non-musical entity types (releases, labels, etc.)
		if rel.Artist.Type != "" && rel.Artist.Type != "Group" && rel.Artist.Type != "Person" &&
			rel.Artist.Type != "Orchestra" && rel.Artist.Type != "Choir" && rel.Artist.Type != "Other" {
			continue
		}

		// Skip if the related entity is a person unless it's a strong musical connection
		// (solo artists who collaborate, side projects, etc. are valid)
		if rel.Artist.Type == "Person" && relationType != "collaboration" && relationType != "side_project" {
			continue
		}

		// Filter by name quality
		lowerName := strings.ToLower(rel.Artist.Name)
		hostLower := strings.ToLower(artist.Name)

		// Skip tribute/cover/parody acts by keyword
		if strings.Contains(lowerName, "tribute") ||
			strings.Contains(lowerName, "cover band") ||
			strings.Contains(lowerName, "parody") ||
			strings.Contains(lowerName, "karaoke") {
			continue
		}

		// Skip if the related name contains the host artist name but isn't the same
		// (catches "An Evening of Radiohead", "Deftones Tribute", etc.)
		if lowerName != hostLower && strings.Contains(lowerName, hostLower) {
			continue
		}

		// Skip if the name is suspiciously short (likely an album/song title, not an artist)
		if len(strings.TrimSpace(rel.Artist.Name)) <= 3 {
			continue
		}

		// Skip obvious non-artist names (common words that are likely album titles)
		commonNonArtistNames := map[string]bool{
			"amnesiac": true, "the bends": true, "head up": true, "there, there": true,
			"ok computer": true, "kid a": true, "in rainbows": true, "hail to the thief": true,
			"around the fur": true, "white pony": true, "koi no yokan": true,
			"diamond eyes": true, "gore": true, "ohms": true, "adrenaline": true,
		}
		if commonNonArtistNames[lowerName] {
			continue
		}

		tags := make([]string, 0, len(rel.Artist.Tags))
		for _, t := range rel.Artist.Tags {
			tags = append(tags, t.Name)
		}

		relations = append(relations, models.ArtistRelation{
			Artist: models.Artist{
				ID:     rel.Artist.ID,
				Name:   rel.Artist.Name,
				Genres: tags,
			},
			RelationType: relationType,
			Score:        0.7,
		})
	}

	return relations, nil
}

// GetDiscography returns the artist's releases sorted by year.
func (m *MusicBrainz) GetDiscography(ctx context.Context, artist models.Artist) ([]models.Release, error) {
	if artist.ID == "" || strings.HasPrefix(artist.ID, "local_") {
		resolved, err := m.resolveID(ctx, artist.Name)
		if err != nil || resolved == "" {
			return nil, fmt.Errorf("musicbrainz: cannot resolve artist ID for %q", artist.Name)
		}
		artist.ID = resolved
	}

	m.throttle()

	u := fmt.Sprintf("%s/artist/%s?inc=release-groups&fmt=json&limit=50",
		m.baseURL, artist.ID)

	var result struct {
		ReleaseGroups []mbReleaseGroup `json:"release-groups"`
	}
	if err := m.doWithRetry(ctx, u, &result); err != nil {
		return nil, err
	}

	releases := make([]models.Release, 0, len(result.ReleaseGroups))
	for _, rg := range result.ReleaseGroups {
		if rg.Title == "" {
			continue
		}
		year := 0
		if rg.FirstReleaseDate != "" {
			if t, err := time.Parse("2006-01-02", rg.FirstReleaseDate); err == nil {
				year = t.Year()
			} else if t, err := time.Parse("2006", rg.FirstReleaseDate); err == nil {
				year = t.Year()
			}
		}
		releaseType := strings.ToLower(rg.PrimaryType)
		if releaseType == "" {
			releaseType = "album"
		}

		releases = append(releases, models.Release{
			ID:       rg.ID,
			Title:    rg.Title,
			Type:     releaseType,
			Year:     year,
			Date:     rg.FirstReleaseDate,
			ImageURL: fmt.Sprintf("https://coverartarchive.org/release-group/%s/front", rg.ID),
		})
	}

	// Sort by year descending (newest first)
	sort.Slice(releases, func(i, j int) bool {
		return releases[i].Year > releases[j].Year
	})

	return releases, nil
}

// GetAlbumInfo returns album details from MusicBrainz (fallback when Last.fm fails).
func (m *MusicBrainz) GetAlbumInfo(ctx context.Context, artistName, albumName string) (*models.AlbumDetail, error) {
	// MusicBrainz release lookup: search for the release group, then get the first release
	query := fmt.Sprintf("release:\"%s\" AND artist:\"%s\"", albumName, artistName)
	u := fmt.Sprintf("%s/release/?query=%s&fmt=json&limit=3",
		m.baseURL, url.QueryEscape(query))

	var result struct {
		Releases []mbRelease `json:"releases"`
	}
	if err := m.doWithRetry(ctx, u, &result); err != nil {
		return nil, err
	}

	if len(result.Releases) == 0 {
		return nil, fmt.Errorf("musicbrainz: release not found: %q - %q", artistName, albumName)
	}

	r := result.Releases[0]
	year := 0
	if r.Date != "" {
		if t, err := time.Parse("2006-01-02", r.Date); err == nil {
			year = t.Year()
		} else if t, err := time.Parse("2006", r.Date); err == nil {
			year = t.Year()
		}
	}

	tracks := make([]models.Track, 0, len(r.Media))
	for _, media := range r.Media {
		for _, track := range media.Tracks {
			duration := ""
			if track.Length > 0 {
				mins := track.Length / 60000
				secs := (track.Length % 60000) / 1000
				duration = fmt.Sprintf("%d:%02d", mins, secs)
			}
			tracks = append(tracks, models.Track{
				Number:   track.Position,
				Title:    track.Title,
				Duration: duration,
			})
		}
	}

	return &models.AlbumDetail{
		ID:     r.ID,
		Title:  r.Title,
		Artist: artistName,
		Type:   strings.ToLower(r.Status),
		Year:   year,
		Date:   r.Date,
		Tracks: tracks,
	}, nil
}

// GetMetadata enriches an artist with genres and other metadata.
func (m *MusicBrainz) GetMetadata(ctx context.Context, name string) (*models.Artist, error) {
	matches, err := m.Search(ctx, name)
	if err != nil {
		return nil, err
	}
	if len(matches) == 0 {
		return nil, fmt.Errorf("musicbrainz: no match for %q", name)
	}

	best := matches[0]
	return &models.Artist{
		ID:         best.ID,
		Name:       best.Name,
		Genres:     best.Genres,
		Popularity: best.Score,
	}, nil
}

// resolveID searches MusicBrainz for an artist and returns their MBID.
func (m *MusicBrainz) resolveID(ctx context.Context, name string) (string, error) {
	matches, err := m.Search(ctx, name)
	if err != nil {
		return "", err
	}
	if len(matches) == 0 {
		return "", fmt.Errorf("no match")
	}
	return matches[0].ID, nil
}

// doWithRetry performs an HTTP GET with up to 2 retries on transient errors.
func (m *MusicBrainz) doWithRetry(ctx context.Context, url string, result any) error {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			// Exponential backoff: 500ms, 1s
			time.Sleep(time.Duration(500*(1<<(attempt-1))) * time.Millisecond)
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return fmt.Errorf("musicbrainz: create request: %w", err)
		}
		req.Header.Set("User-Agent", "HearME/0.1 ( music-discovery-app )")
		req.Header.Set("Accept", "application/json")

		resp, err := m.client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("musicbrainz: request failed: %w", err)
			continue // Retry on connection errors (EOF, timeout, etc.)
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("musicbrainz: read body: %w", err)
			continue
		}

		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("musicbrainz: HTTP %d", resp.StatusCode)
			continue // Retry on rate limit or server errors
		}

		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("musicbrainz: HTTP %d: %s", resp.StatusCode, string(body[:min(len(body), 200)]))
		}

		if err := json.Unmarshal(body, result); err != nil {
			return fmt.Errorf("musicbrainz: decode: %w", err)
		}
		return nil
	}
	return lastErr
}

// throttle enforces a simple rate limit of ~1 request per second.
func (m *MusicBrainz) throttle() {
	elapsed := time.Since(m.lastRequest)
	if elapsed < 1*time.Second {
		time.Sleep(1*time.Second - elapsed)
	}
	m.lastRequest = time.Now()
}

// classifyRelation determines whether a MusicBrainz relation represents a
// musically meaningful connection between bands/artists.
// Returns (relationType, include). If include is false, the relation is discarded.
func classifyRelation(mbType, direction, artistType string) (string, bool) {
	mbType = strings.ToLower(mbType)

	// --- Explicitly EXCLUDED relation categories ---

	// Band members / personnel — these are individual people, not related bands
	excludedPatterns := []string{
		"member of band", "member of", "is a person", "is person",
		"conductor", "chorus master", "concertmaster",
		"producer", "production", "engineer", "engineered", "recording",
		"mix", "mixed", "mixing", "mastering", "mastered",
		"cover art", "illustration", "design", "photography",
		"tribute to", "supporting", "opening act",
		"legal", "management", "manager", "publisher", "booking",
		"married", "parent", "child", "sibling", "family",
		"dedicated to", "parody", "spoof",
	}
	for _, p := range excludedPatterns {
		if strings.Contains(mbType, p) {
			return "", false
		}
	}

	// --- INCLUDED relations (bands ↔ bands) ---

	// Side projects, spin-offs, former names
	if strings.Contains(mbType, "spin") || strings.Contains(mbType, "off") ||
		strings.Contains(mbType, "side project") || strings.Contains(mbType, "subgroup") {
		return "side_project", true
	}

	// Collaborations between artists
	if strings.Contains(mbType, "collaboration") || strings.Contains(mbType, "collab") ||
		strings.Contains(mbType, "co-founder") || strings.Contains(mbType, "co writer") {
		return "collaboration", true
	}

	// Remixer / remix relationships
	if strings.Contains(mbType, "remix") {
		return "collaboration", true
	}

	// Influence relationships
	if strings.Contains(mbType, "influenced") || strings.Contains(mbType, "influence") {
		return "influenced_by", true
	}

	// "Associated with" — broad but musically relevant
	if strings.Contains(mbType, "associated") {
		return "associated", true
	}

	// Group composition: "is a group", "is group", group relationships
	// Allow groups that have this artist as a member (direction=backward means the target is the group)
	if strings.Contains(mbType, "group") || strings.Contains(mbType, "band") ||
		strings.Contains(mbType, "ensemble") || strings.Contains(mbType, "orchestra") {
		// Only include if the related entity is itself a Group
		if artistType == "Group" || artistType == "Orchestra" || artistType == "Choir" {
			return "group", true
		}
		return "", false
	}

	// Split from / formed from
	if strings.Contains(mbType, "split from") || strings.Contains(mbType, "formed from") {
		return "side_project", true
	}

	// Catch-all: any other relation where both sides are Groups
	if artistType == "Group" {
		return "related", true
	}

	// Default: discard unknown relation types
	return "", false
}

// --- MusicBrainz JSON types ---

type mbArtist struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Disambiguation string  `json:"disambiguation"`
	Score          int     `json:"score"`
	Country        string  `json:"country"`
	Tags           []mbTag `json:"tags"`
}

type mbTag struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type mbArtistDetail struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	Relations []mbRelation `json:"relations"`
	Tags      []mbTag      `json:"tags"`
}

type mbRelation struct {
	Type      string          `json:"type"`
	Direction string          `json:"direction"`
	Artist    mbRelatedArtist `json:"artist"`
}

type mbRelatedArtist struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Type string  `json:"type"`
	Tags []mbTag `json:"tags"`
}

type mbReleaseGroup struct {
	ID               string `json:"id"`
	Title            string `json:"title"`
	PrimaryType      string `json:"primary-type"`
	FirstReleaseDate string `json:"first-release-date"`
}

type mbRelease struct {
	ID     string    `json:"id"`
	Title  string    `json:"title"`
	Date   string    `json:"date"`
	Status string    `json:"status"`
	Media  []mbMedia `json:"media"`
}

type mbMedia struct {
	Tracks []mbTrack `json:"tracks"`
}

type mbTrack struct {
	Title    string `json:"title"`
	Position int    `json:"position"`
	Length   int    `json:"length"`
}
