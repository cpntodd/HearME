package models

// Artist represents a music artist or band.
type Artist struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Genres     []string `json:"genres"`
	ImageURL   string   `json:"imageUrl,omitempty"`
	Popularity int      `json:"popularity,omitempty"` // 0-100
	Bio        string   `json:"bio,omitempty"`
}

// Tour represents an upcoming concert or tour date.
type Tour struct {
	ID          string `json:"id"`
	ArtistName  string `json:"artistName"`
	TourName    string `json:"tourName,omitempty"`
	Date        string `json:"date"` // ISO 8601
	City        string `json:"city"`
	Venue       string `json:"venue"`
	Country     string `json:"country"`
	CountryCode string `json:"countryCode"` // ISO 3166-1 alpha-2
	TicketURL   string `json:"ticketUrl,omitempty"`
	ImageURL    string `json:"imageUrl,omitempty"`
	Source      string `json:"source"` // "bandsintown", "songkick", "ticketmaster", "rss"
}

// ArtistRelation links two artists with a relationship type and score.
type ArtistRelation struct {
	Artist       Artist  `json:"artist"`
	RelationType string  `json:"relationType"` // "similar", "collaboration", "member_of", "influenced_by"
	Score        float64 `json:"score"`        // 0.0-1.0
}

// GraphData holds a complete graph of nodes and edges for the frontend.
type GraphData struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// GraphNode is a single vertex in the artist relationship graph.
type GraphNode struct {
	ID       string  `json:"id"`
	Artist   Artist  `json:"artist"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Selected bool    `json:"selected"`
	Expanded bool    `json:"expanded"`
}

// GraphEdge is a connection between two graph nodes.
type GraphEdge struct {
	Source string `json:"source"` // Node ID
	Target string `json:"target"` // Node ID
	Type   string `json:"type"`   // "similar", "collaboration", etc.
}

// ArtistMatch is a candidate from artist disambiguation.
type ArtistMatch struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Disambiguation string   `json:"disambiguation,omitempty"`
	Genres         []string `json:"genres,omitempty"`
	Country        string   `json:"country,omitempty"`
	Score          int      `json:"score"` // MusicBrainz search score
}

// Release represents an album, EP, single, or other release by an artist.
type Release struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Type     string `json:"type"` // "album", "ep", "single", "live", "compilation"
	Year     int    `json:"year"`
	Date     string `json:"date,omitempty"` // ISO date if available
	ImageURL string `json:"imageUrl,omitempty"`
}

// AlbumDetail contains full album info including tracklist.
type AlbumDetail struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Artist    string   `json:"artist"`
	Type      string   `json:"type"`
	Year      int      `json:"year"`
	Date      string   `json:"date,omitempty"`
	Label     string   `json:"label,omitempty"`
	ImageURL  string   `json:"imageUrl,omitempty"`
	Genres    []string `json:"genres,omitempty"`
	PlayCount int      `json:"playCount,omitempty"`
	Tracks    []Track  `json:"tracks"`
}

// Track represents a single track on an album.
type Track struct {
	Number   int    `json:"number"`
	Title    string `json:"title"`
	Duration string `json:"duration,omitempty"` // "4:32"
	Lyrics   string `json:"lyrics,omitempty"`
}
