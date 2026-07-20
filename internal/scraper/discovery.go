package scraper

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// DiscoverFeeds attempts to find RSS/Atom feeds for an artist.
// Tries known platform URL patterns and website auto-discovery.
func DiscoverFeeds(ctx context.Context, client *http.Client, artistName string) ([]string, error) {
	var feeds []string

	// Generate candidate slugs from artist name
	slugs := generateSlugs(artistName)

	// Try Bandcamp
	for _, slug := range slugs {
		bandcampURL := fmt.Sprintf("https://%s.bandcamp.com/feed", slug)
		if feedExists(ctx, client, bandcampURL) {
			feeds = append(feeds, bandcampURL)
			break // First working Bandcamp URL is sufficient
		}
	}

	// Try BigCartel
	for _, slug := range slugs {
		bigcartelURL := fmt.Sprintf("https://%s.bigcartel.com/products.rss", slug)
		if feedExists(ctx, client, bigcartelURL) {
			feeds = append(feeds, bigcartelURL)
			break
		}
	}

	// If no feeds found from known platforms, try the artist's website
	if len(feeds) == 0 {
		// Try common website patterns
		for _, slug := range slugs {
			websiteURL := fmt.Sprintf("https://%s.com", slug)
			discovered, err := discoverFromWebsite(ctx, client, websiteURL)
			if err == nil && len(discovered) > 0 {
				feeds = append(feeds, discovered...)
				break
			}
		}
	}

	return feeds, nil
}

// generateSlugs produces common URL slug variations from an artist name.
func generateSlugs(name string) []string {
	name = strings.ToLower(strings.TrimSpace(name))
	// Remove special characters except spaces and hyphens
	name = regexp.MustCompile(`[^a-z0-9\s\-]`).ReplaceAllString(name, "")

	var slugs []string

	// Hyphenated version
	slug := regexp.MustCompile(`\s+`).ReplaceAllString(name, "-")
	slugs = append(slugs, slug)

	// Without hyphens (some artists use a single word)
	noSpace := regexp.MustCompile(`\s+`).ReplaceAllString(name, "")
	if noSpace != slug {
		slugs = append(slugs, noSpace)
	}

	// Remove "the" prefix variation
	if strings.HasPrefix(slug, "the-") {
		slugs = append(slugs, strings.TrimPrefix(slug, "the-"))
	}

	// Deduplicate
	seen := make(map[string]bool)
	var unique []string
	for _, s := range slugs {
		if s != "" && !seen[s] {
			seen[s] = true
			unique = append(unique, s)
		}
	}
	return unique
}

// feedExists checks if a URL returns a 200 with XML-like content.
func feedExists(ctx context.Context, client *http.Client, feedURL string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return false
	}
	req.Header.Set("User-Agent", "HearME/0.1 ( Feed Discovery )")

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false
	}

	// Peek at content to verify it looks like a feed
	buf := make([]byte, 512)
	n, _ := io.ReadFull(resp.Body, buf)
	if n == 0 {
		return false
	}
	content := strings.ToLower(string(buf[:n]))
	return strings.Contains(content, "<rss") || strings.Contains(content, "<feed") ||
		strings.Contains(content, "xmlns")
}

// discoverFromWebsite fetches a website homepage and looks for RSS/Atom link tags.
func discoverFromWebsite(ctx context.Context, client *http.Client, websiteURL string) ([]string, error) {
	parsed, err := url.Parse(websiteURL)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme == "" {
		parsed.Scheme = "https"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "HearME/0.1 ( Feed Discovery )")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<19)) // 512KB limit
	if err != nil {
		return nil, err
	}

	return extractFeedLinks(string(body), parsed), nil
}

// extractFeedLinks finds <link rel="alternate" type="application/rss+xml"> tags in HTML.
func extractFeedLinks(html string, baseURL *url.URL) []string {
	var feeds []string

	// Pattern: <link ... rel="alternate" ... href="..." ... type="application/rss+xml">
	patterns := []string{
		`<link[^>]*type\s*=\s*["']application/(?:rss|atom)\+xml["'][^>]*href\s*=\s*["']([^"']+)["']`,
		`<link[^>]*href\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']application/(?:rss|atom)\+xml["']`,
	}

	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		matches := re.FindAllStringSubmatch(html, -1)
		for _, m := range matches {
			if len(m) > 1 {
				href := m[1]
				// Resolve relative URLs
				parsed, err := url.Parse(href)
				if err != nil {
					continue
				}
				resolved := baseURL.ResolveReference(parsed)
				feeds = append(feeds, resolved.String())
			}
		}
	}

	return feeds
}
