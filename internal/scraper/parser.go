package scraper

import (
	"regexp"
	"strings"
	"time"
)

// isTourRelated checks if text contains tour/concert/show related keywords.
func isTourRelated(text string) bool {
	text = strings.ToLower(text)
	keywords := []string{
		"on tour", "tour date", "upcoming show", "live at", "playing at",
		"concert", "tickets", "on sale", "performing", "performing at",
		"show at", "gig at", "live show", "world tour", "tour",
		"appearing at", "headlining", "supporting", "opening for",
	}
	for _, kw := range keywords {
		if strings.Contains(text, kw) {
			return true
		}
	}
	return false
}

// extractDate attempts to find a date in text or falls back to a provided date string.
func extractDate(text, dateStr string) string {
	// First try to find a date in the text
	if d := findDateInText(text); d != "" {
		return d
	}
	// Fall back to the feed-provided date
	if d := parseDateString(dateStr); d != "" {
		return d
	}
	return ""
}

// findDateInText searches for date patterns in unstructured text.
func findDateInText(text string) string {
	patterns := []struct {
		re     *regexp.Regexp
		layout string
	}{
		// ISO format: 2026-08-15
		{regexp.MustCompile(`(\d{4}-\d{2}-\d{2})`), "2006-01-02"},
		// US long: August 15, 2026
		{regexp.MustCompile(`(?i)(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})`), "January 2 2006"},
		// UK long: 15 August 2026
		{regexp.MustCompile(`(\d{1,2})(?:st|nd|rd|th)?\s+(?i)(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})`), "2 January 2006"},
		// Short US: 08/15/2026 or 8/15/2026
		{regexp.MustCompile(`(\d{1,2})/(\d{1,2})/(\d{4})`), "01/02/2006"},
		// Short with month name: Aug 15, 2026
		{regexp.MustCompile(`(?i)(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})`), "Jan 2 2006"},
	}

	for _, p := range patterns {
		matches := p.re.FindStringSubmatch(text)
		if len(matches) == 0 {
			continue
		}

		// Reconstruct the date string based on pattern
		var dateInput string
		switch len(matches) {
		case 2: // ISO: just capture group 1
			dateInput = matches[1]
		case 4: // Three capture groups: month-like, day, year
			dateInput = matches[1] + " " + matches[2] + " " + matches[3]
		}

		layout := p.layout
		// For ISO format, parse directly
		if layout == "2006-01-02" {
			if t, err := time.Parse(layout, dateInput); err == nil {
				// Ensure it's a future or recent date
				if t.Year() >= time.Now().Year()-1 {
					return t.Format("2006-01-02")
				}
			}
		} else {
			if t, err := time.Parse(layout, dateInput); err == nil {
				if t.Year() >= time.Now().Year()-1 {
					return t.Format("2006-01-02")
				}
			}
		}
	}

	return ""
}

// parseDateString tries common feed date formats.
func parseDateString(s string) string {
	if s == "" {
		return ""
	}

	formats := []string{
		time.RFC3339,  // 2006-01-02T15:04:05Z07:00
		time.RFC1123Z, // Mon, 02 Jan 2006 15:04:05 -0700
		time.RFC1123,  // Mon, 02 Jan 2006 15:04:05 MST
		time.RFC822Z,  // 02 Jan 06 15:04 -0700
		time.RFC822,   // 02 Jan 06 15:04 MST
		"2006-01-02T15:04:05-07:00",
		"2006-01-02T15:04:05",
		"2006-01-02",
		"02 Jan 2006 15:04:05 MST",
		"02 Jan 2006",
		"Jan 2, 2006",
		"January 2, 2006",
		"2 January 2006",
		"01/02/2006",
	}

	for _, format := range formats {
		if t, err := time.Parse(format, strings.TrimSpace(s)); err == nil {
			if t.Year() >= time.Now().Year()-1 {
				return t.Format("2006-01-02")
			}
		}
	}
	return ""
}

// extractLocation attempts to find city, venue, and country in text.
func extractLocation(text string) (city, venue, country string) {
	// Pattern: "at VENUE, CITY" or "at VENUE in CITY"
	venueCityPatterns := []*regexp.Regexp{
		regexp.MustCompile(`(?i)(?:at|@)\s+([A-Za-z0-9'.& ]+?)\s*[,]\s*([A-Za-z\s]+?)(?:[,.]|\s+(?:on|tickets|more|$))`),
		regexp.MustCompile(`(?i)(?:at|@)\s+(the\s+)?([A-Za-z0-9'.& ]+?)\s+in\s+([A-Za-z\s]+?)(?:[,.]|\s+(?:on|tickets|more|$))`),
		regexp.MustCompile(`(?i)([A-Za-z\s]+?)\s*[,]\s*([A-Z]{2})\b`), // City, ST (US state)
	}

	for _, re := range venueCityPatterns {
		matches := re.FindStringSubmatch(text)
		if len(matches) >= 3 {
			venue = strings.TrimSpace(matches[1])
			city = strings.TrimSpace(matches[len(matches)-1])

			// Clean up common noise
			venue = strings.TrimPrefix(venue, "the ")
			venue = strings.TrimPrefix(venue, "The ")

			// Basic validation: venue shouldn't be just a few chars or very long
			if len(venue) < 3 || len(venue) > 50 {
				venue = ""
			}
			if len(city) < 2 || len(city) > 30 {
				city = ""
			}

			if city != "" || venue != "" {
				break
			}
		}
	}

	// Country detection from known names
	country = detectCountry(text)

	return city, venue, country
}

// detectCountry checks text for known country names.
func detectCountry(text string) string {
	text = strings.ToLower(text)
	countries := []string{
		"united states", "usa", "united kingdom", "uk", "england", "canada",
		"australia", "germany", "france", "japan", "brazil", "mexico",
		"italy", "spain", "netherlands", "sweden", "norway", "denmark",
		"finland", "belgium", "austria", "switzerland", "portugal",
		"ireland", "poland", "new zealand", "argentina", "chile",
		"colombia", "peru", "south korea", "china", "india", "russia",
		"south africa", "turkey", "indonesia", "philippines", "thailand",
		"singapore", "czech republic", "hungary", "romania", "greece",
		"croatia", "serbia", "ukraine", "iceland", "luxembourg",
	}
	for _, c := range countries {
		if strings.Contains(text, c) {
			return titleCase(c)
		}
	}
	return ""
}

// titleCase capitalizes the first letter of each word.
func titleCase(s string) string {
	words := strings.Fields(s)
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}

// stripHTML removes HTML tags from a string, keeping text content.
func stripHTML(s string) string {
	// Remove HTML tags
	re := regexp.MustCompile(`<[^>]*>`)
	s = re.ReplaceAllString(s, " ")

	// Decode common entities
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	s = strings.ReplaceAll(s, "&quot;", "\"")
	s = strings.ReplaceAll(s, "&#39;", "'")
	s = strings.ReplaceAll(s, "&apos;", "'")
	s = strings.ReplaceAll(s, "&nbsp;", " ")

	// Collapse whitespace
	re = regexp.MustCompile(`\s+`)
	s = re.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

// sanitizeID creates a safe ID from an artist name.
func sanitizeID(s string) string {
	s = strings.ToLower(s)
	re := regexp.MustCompile(`[^a-z0-9]+`)
	return re.ReplaceAllString(s, "_")
}
