# HearME — Design Document

## Overview

A self-contained, single-binary desktop web application for music discovery and playback. Features include a Spotify-style media library (Jellyfin-integrated), Winamp-inspired audio player with 10-band EQ and visualizers, force-directed artist relationship graph, and upcoming tour grid — all from one static binary.

**Motto:** Your music. Their tours. One binary.

**Key features (v0.1.0):**
- 🎧 Audio player: Web Audio API engine, 6 visualizer presets, 10-band EQ, VU meters, VFD display
- 📚 Media library: Spotify-like browsing (Home/Artists/Albums/Tracks), Jellyfin integration for streaming
- 🕸️ Artist graph: Force-directed canvas, import from Jellyfin library, owned badges, pinning, orbital gravity
- 🎫 Tour grid: Bandsintown/Songkick/Ticketmaster aggregation, sortable, offline cache
- ⚙️ Settings: Data sources, API keys, Jellyfin, appearance (zoom/font/graph limits), audio player (EQ/visualizer/lyrics)
- 💾 Full persistence: localStorage for artists, settings, cached tours, graph state

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  Go Binary (hearme)               │
│                                                   │
│  ┌─────────────────┐  ┌────────────────────────┐ │
│  │  HTTP Server     │  │  RSS Scraper Engine     │ │
│  │  (net/http)      │  │  (background goroutine) │ │
│  │                  │  │                         │ │
│  │  /api/tours      │  │  • Bandcamp discovery   │ │
│  │  /api/artists    │  │  • Custom feeds          │ │
│  │  /api/graph      │  │  • Date/location parser  │ │
│  │  /api/health     │  └────────────────────────┘ │
│  └────────┬─────────┘                             │
│           │                                       │
│  ┌────────┴─────────────────────────────────────┐ │
│  │  Provider Layer (unified interface)           │ │
│  │                                               │ │
│  │  Tour Providers:          Artist Providers:   │ │
│  │  • Bandsintown (free)     • MusicBrainz (free)│ │
│  │  • Songkick (paid)        • Last.fm (free)    │ │
│  │  • Ticketmaster (paid)    • Spotify (paid)    │ │
│  └────────┬──────────────────────────────────────┘ │
│           │                                       │
│  ┌────────┴────────┐                              │
│  │  In-Memory Cache │  TTL per provider            │
│  │  (sync.Map)      │  Tours: 1hr | Graph: 24hr    │
│  └─────────────────┘                              │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │  Embedded Frontend (//go:embed)              │ │
│  │                                               │ │
│  │  index.html  +  css/winamp.css                │ │
│  │  js/app.js   +  js/graph.js + js/grid.js     │ │
│  │  js/api.js   +  js/store.js                   │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

**Key principles:**
- **Single binary.** `go build` produces one file. No npm, no pip, no runtime.
- **API keys never touch the browser.** All third-party API calls go through the Go backend.
- **Zero frontend dependencies.** No React, no jQuery, no CSS framework. Vanilla JS + hand-rolled CSS.
- **Embedded assets.** `//go:embed` bakes HTML/CSS/JS into the binary at compile time.
- **localStorage for persistence.** Artist list, all settings (audio player, graph, appearance, API keys via backend), cached tours, and graph state persist across sessions. Settings include: UI zoom, font size, visualizer preset, EQ preset, default volume, lyrics toggle, crossfade, replay gain, gapless playback, scrobbling, max graph nodes, auto-expand count.

---

## Project Structure

```
HearME/
├── main.go                    # Entry point: parse flags, load config, start server
├── go.mod
├── go.sum
├── .env.example               # Template for API keys
├── DESIGN.md                  # This file
├── config/
│   └── config.go              # Config struct, .env loading, flag parsing
├── internal/
│   ├── server/
│   │   ├── server.go          # HTTP server setup, routing, middleware
│   │   └── handlers.go        # Request handlers
│   ├── provider/
│   │   ├── provider.go        # Common interfaces (TourProvider, ArtistProvider)
│   │   ├── tours/
│   │   │   ├── tours.go       # Tour aggregator (fan-out to all enabled providers)
│   │   │   ├── bandsintown.go # Bandsintown API integration
│   │   │   ├── songkick.go    # Songkick API integration (paid, optional)
│   │   │   └── ticketmaster.go# Ticketmaster API integration (paid, optional)
│   │   └── artists/
│   │       ├── artists.go     # Artist aggregator
│   │       ├── musicbrainz.go # MusicBrainz API (relationships, tags, genres)
│   │       └── lastfm.go      # Last.fm API (similar artists, top tags)
│   ├── scraper/
│   │   ├── scraper.go         # RSS/Atom feed fetcher + parser
│   │   ├── discovery.go       # Auto-discovery of feeds from known platforms
│   │   └── parser.go          # Date/location extraction from unstructured text
│   ├── cache/
│   │   └── cache.go           # Generic TTL cache backed by sync.Map
│   └── models/
│       └── models.go          # Shared types: Artist, Tour, GraphNode, GraphEdge
├── web/
│   ├── index.html             # SPA shell
│   ├── css/
│   │   └── winamp.css         # Retro Winamp/Windows 9x theme
│   ├── js/
│   │   ├── app.js             # App initialization, tab switching, event bus
│   │   ├── graph.js           # Canvas-based force-directed node graph
│   │   ├── grid.js            # Tour grid view (table/list)
│   │   ├── api.js             # Fetch wrapper for backend API calls
│   │   ├── store.js           # localStorage read/write for artist list + prefs
│   │   └── components.js      # Reusable UI components (buttons, panels, dialogs)
│   └── assets/
│       └── fonts/
│           └── pixel.woff2    # Embedded pixel font (optional, may use system fonts)
└── build/
    └── Dockerfile             # Optional: containerized build
```

---

## Backend Design

### Configuration (`.env` file)

```env
# Server
HEARME_PORT=8080
HEARME_HOST=localhost

# Tour Providers (uncomment to enable)
HEARME_BANDSINTOWN_APP_ID=your_app_id_here
# HEARME_SONGKICK_API_KEY=sk_xxx        # paid
# HEARME_TICKETMASTER_API_KEY=tm_xxx    # paid

# Artist Providers
# HEARME_LASTFM_API_KEY=lf_xxx          # free key recommended
# HEARME_SPOTIFY_CLIENT_ID=sp_xxx       # paid, OAuth
# HEARME_SPOTIFY_CLIENT_SECRET=sp_xxx

# RSS Scraper
HEARME_SCRAPER_ENABLED=true
HEARME_SCRAPER_INTERVAL=30m
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/tours` | Get upcoming tours for a list of artist names |
| `GET` | `/api/artists/:name` | Get artist metadata (genres, bio, image from all providers) |
| `GET` | `/api/artists/:name/discography` | Get discography (albums, EPs, singles, live, compilations) |
| `GET` | `/api/albums/:artist/:album` | Get album detail with tracklist |
| `GET` | `/api/lyrics/:artist/:title` | Get song lyrics from Lyrics.ovh |
| `GET` | `/api/graph/expand/:name` | Get related artists for graph expansion |
| `GET` | `/api/image?url=...` | Image proxy to bypass Cover Art Archive ORB/CORS blocking |
| `GET` | `/api/scraper/feeds/:name` | Discover RSS feeds for an artist |
| `POST` | `/api/scraper/tours/:name` | Get scraped tours for an artist |
| `GET` | `/api/settings` | Get current server-side settings and provider status |
| `POST` | `/api/settings` | Update API keys (reconfigures providers live) |
| `POST` | `/api/cache/clear` | Clear server-side cache |

### Provider Interface

```go
type TourProvider interface {
    Name() string
    Enabled() bool
    GetTours(ctx context.Context, artistNames []string) ([]Tour, error)
}

type ArtistProvider interface {
    Name() string
    Enabled() bool
    Search(ctx context.Context, query string) ([]ArtistMatch, error)
    GetRelated(ctx context.Context, artistName string, depth int) ([]ArtistRelation, error)
    GetMetadata(ctx context.Context, artistName string) (*ArtistMetadata, error)
    GetDiscography(ctx context.Context, artistName string) ([]Release, error)
    GetAlbumInfo(ctx context.Context, artistName, albumName string) (*AlbumDetail, error)
}
```

The aggregator fans out requests to all enabled providers concurrently, merges results, and deduplicates. GetMetadata merges bios from Last.fm with genres from all sources. GetDiscography deduplicates by title + release type and sorts by year descending.

### Caching

- Generic TTL cache using `sync.Map` + background cleanup goroutine.
- Key format: `provider:endpoint:params` → cached response.
- Tour data TTL: 1 hour. Artist relationship data TTL: 24 hours. RSS data TTL: 30 minutes.

---

## RSS Scraper Design

### Auto-Discovery

When a user adds an artist, the scraper attempts to discover feeds:

1. **Bandcamp:** Try `https://{artist-slug}.bandcamp.com/feed` — construct slug from artist name (lowercase, hyphens).
2. **Known platform patterns:** Configurable list of URL templates.
3. **OpenSearch/auto-discovery:** Parse the artist's website homepage for `<link rel="alternate" type="application/rss+xml">` tags.

### Feed Parsing

- Supports RSS 2.0 and Atom formats via Go's `encoding/xml`.
- Each feed entry is scanned for:
  - **Date patterns:** ISO dates, "Jan 2, 2026", "next Friday", relative dates.
  - **Location patterns:** "at The Troubadour, Los Angeles", "London, UK", venue names via a configurable venue list.
  - **Tour keywords:** "on tour", "playing", "show", "live at", "tickets".
- Entries without dates or locations are discarded.
- Extracted tours are merged with API results and deduplicated.

### Background Worker

- Runs on a configurable ticker (default: every 30 minutes).
- Iterates over all artists in the cache, fetches/parses feeds.
- Results stored in cache, served via `/api/scraper/tours/:name`.

---

## Frontend Design

### Technology

- **Vanilla JavaScript (ES2020+).** No transpiler needed — modern browsers support classes, arrow functions, `async/await`, `fetch`, template literals.
- **Web Audio API** for the audio player — `AudioContext`, `AnalyserNode`, `ChannelSplitter`, `GainNode`.
- **Canvas 2D API** for the node graph AND audio visualizer (6 presets), VFD display, and VU meters.
- **Custom CSS.** No Tailwind, no Bootstrap, no 98.css. Every pixel is intentional (~1k lines of hand-crafted retro theme).
- **CSS Grid + Flexbox** for layout.
- **localStorage** for all client-side persistence (artists, settings, cached tours).
- **UI scaling** via `transform: scale()` on `#app-wrapper` + inverse percentage sizing. Font scaling via injected `<style>` with `!important` overrides.

### Views (Tabs)

The app has a Winamp-style tab bar with four views:

```
┌──────────────────────────────────────────────────────────┐
│  [Player]  [Graph Explorer]  [Tour Grid]  [Settings]      │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Main content area (switches per tab, only one visible)   │
│                                                           │
├──────────────────────────────────────────────────────────┤
│  Status bar: "Ready • 0 nodes • MusicBrainz"              │
└──────────────────────────────────────────────────────────┘
```

### View 0: Audio Player (Default)

**Layout:**
```
┌──────────┬───────────────────────────────┬──────────────┐
│ Album Art │  Visualizer Canvas             │  Playlist     │
│ Track Info│  (Canvas 2D, ~60fps)           │  Queue        │
│           │                                │               │
│ 💿        │  ┌─── VFD Display ───┐         │  • Track 1    │
│ No Track  │  │ NOW PLAYING...    │         │  • Track 2    │
│ —         │  └──────────────────┘         │  • Track 3    │
│ —         │  [VU L] [VU R]                │               │
│           │  Spectrum Wave Rad... │         │               │
├──────────┴───────────────────────────────┴──────────────┤
│ 🔀 ⏮ ▶ ⏭ 🔁  ━━━━━━●━━━━━━ 0:00   🔊 ━━━●━━ 🎚        │
└──────────────────────────────────────────────────────────┘
```

**Features:**
- **Web Audio API engine:** `AudioContext` → `MediaElementSource` → `AnalyserNode` (2048 FFT) → `ChannelSplitter` → stereo `GainNode`.
- **6 visualizer presets** rendered on Canvas 2D at ~60fps:
  1. **Spectrum** — classic frequency bars with gradient fill.
  2. **Oscilloscope** — green waveform tracing.
  3. **Circular** — radial bars emanating from center.
  4. **Particles** — particle swarm reacting to frequency bands.
  5. **Fire** — flame simulation driven by low/mid frequencies.
  6. **Bars+Beads** — bar chart with bouncing bead on peak.
- **VFD Display:** Canvas-rendered dot-matrix Vacuum Fluorescent Display with scrolling track info text.
- **VU Meters:** Dual-channel analog-style needle meters with dB scale (-60 to +3 dB) and peak hold indicators.
- **Transport controls:** Play/Pause, Previous, Next, Shuffle, Repeat (off/all/one).
- **Seek bar** with current/total time display.
- **Volume slider** controlling GainNode.
- **Playlist panel** — tracks queued from Jellyfin library.

### View 1: Graph Explorer

**Layout:**

```
┌────────────────────────────────────────────────────┐
│  [Graph Explorer]  [Tour Grid]  [Settings]          │
├──────────────┬─────────────────────────────────────┤
│  Search Bar  │                                      │
│  [________]  │                                      │
│  [+ Add]     │                                      │
│              │                                      │
│  My Artists  │        Canvas Node Graph             │
│  ─────────── │                                      │
│  • Artist A  │     •  ────────  •                   │
│  • Artist B  │      \         /                     │
│  • Artist C  │       •  ───  •                      │
│              │      /          \                    │
│  [x] Show    │     •            •                   │
│  in Tour Grid│                                      │
│              │                                      │
│  ─────────── │                                      │
│  Node Legend │                                      │
│  ● Selected  │ (green fill, click to expand)        │
│  ● Expanded  │ (orange dashed ring)                 │
│  ● Related   │ (blue default)                       │
│  ○ Owned     │ (green dashed ring = in Jellyfin)    │
│  · Pinned    │ (yellow dot, drag/dbl-click)         │
├──────────────┴─────────────────────────────────────┤
│  Status: "MusicBrainz • Last.fm • 34 nodes · 242 in library" │
└────────────────────────────────────────────────────┘
```

**Graph interactions:**
- **Click** a node → select it, show detail panel (bio, discography, album art)
- **Click** an unexpanded node → fetch + render related artists from MusicBrainz/Last.fm
- **Double-click** → toggle pin (pinned nodes hold position, exert orbital gravity on neighbors)
- **Drag** a node → auto-pins it (yellow dot indicator)
- **Right-click** → context menu: Pin/Unpin, Delete node (with connected nodes)
- **Scroll** → zoom canvas in/out
- **Drag empty space** → pan canvas
- **Green dashed ring** → artist is in your Jellyfin library (owned)
- **Orange dashed ring** → node has been expanded (relationships loaded)
- **Import from Library** button → bulk-imports all Jellyfin artists as graph nodes, auto-expands first N (configurable)

1. **Add artist** via the search bar → appears in "My Artists" list and as a center node on the canvas.
2. **Auto-expand:** On add, 1 degree of related artists is fetched and rendered around the center node.
3. **Click-to-expand:** Click any related artist node → it becomes a "selected" node and its 1-degree relations are fetched and added to the canvas.
4. **Drag nodes** to reposition. Physics simulation keeps the layout organic.
5. **Zoom/pan** via mouse wheel and drag on empty canvas space.
6. **Checkbox "Show in Tour Grid"** — any artist in "My Artists" (including discovered ones you've added) can be toggled to include in the tour grid.
7. **Node coloring** by genre (derived from MusicBrainz tags or Last.fm top tags).
8. **Node sizing** by listener count / popularity (from Last.fm).

**Canvas rendering:**

- Force-directed layout with:
  - Repulsion between all nodes (Coulomb's law).
  - Attraction along edges (Hooke's law / spring force).
  - Center gravity (pulls orphan nodes toward center).
  - Damping factor to converge.
- Runs in `requestAnimationFrame` loop.
- Only renders visible nodes (viewport culling for performance).

---

### View 2: Tour Grid

**Layout (Winamp Media Library style):**

```
┌────────────────────────────────────────────────────┐
│  [Graph Explorer]  [Tour Grid]  [Settings]          │
├────────────────────────────────────────────────────┤
│  Filters:                                           │
│  [Genre: ▼ All]  [Country: ▼ All]  [Date: ▼ Soon] │
│  [Search tours...]                                  │
├────────────────────────────────────────────────────┤
│  Artist       │ Tour Name    │ Date       │ Venue   │
│  ──────────── │ ──────────── │ ────────── │ ─────── │
│  Radiohead    │ World Tour   │ 2026-08-15 │ MSG     │
│  King Gizzard │ EU Tour 2026 │ 2026-09-01 │ Paradiso│
│  ...                                               │
├────────────────────────────────────────────────────┤
│  47 tours • Sorted by date • Bandsintown + RSS      │
└────────────────────────────────────────────────────┘
```

**Features:**
- Columns: Artist, Tour Name, Date, City, Venue, Country, Ticket Link.
- Sort by clicking column headers (date default).
- Filter by Genre (dropdown, populated from artist metadata), Country (dropdown from tour data).
- Each row has a clickable ticket link.
- Alternating row colors (Winamp playlist style).
- Poster image thumbnail (if available from API).

---

### View 3: Settings

```
┌────────────────────────────────────────────────────┐
│  [Graph Explorer]  [Tour Grid]  [Settings]          │
├────────────────────────────────────────────────────┤
│  Data Sources                                       │
│  ☑ Bandsintown (free)                              │
│  ☐ Songkick (needs API key)                        │
│  ☐ Ticketmaster (needs API key)                    │
│  ☑ MusicBrainz                                     │
│  ☑ Last.fm (needs API key)                         │
│  ☑ RSS Scraper                                     │
│                                                     │
│  API Keys                                           │
│  Bandsintown App ID: [________________]             │
│  Last.fm API Key:    [________________]             │
│  ...                                                │
│                                                     │
│  [Clear Cache]  [Export Artists]  [Import Artists]  │
│  [Reset All Data]                                   │
└────────────────────────────────────────────────────┘
```

Note: API keys set here are sent to the backend and stored server-side only (in memory for the session, or persisted to `.env` by the Go process). They never leave the machine.

---

## Theme: Retro Dark (Winamp + Windows 9x)

### Color Palette

| Name | Hex | Usage |
|------|-----|-------|
| Background | `#1a1a1a` | App background, canvas background |
| Panel | `#2d2d2d` | Panel backgrounds, card backgrounds |
| Surface | `#3a3a3a` | Input fields, list item hover |
| Chrome Light | `#c0c0c0` | Window chrome, button face |
| Chrome Dark | `#808080` | Button shadow, sunken borders |
| Winamp Green | `#22ff22` | Accents, active indicators, links |
| Winamp Green Dark | `#1a8c1a` | Pressed state, secondary accent |
| Titlebar Active | `#000080` → `#1084d0` | Gradient (Win9x active titlebar) |
| Titlebar Inactive | `#808080` → `#b5b5b5` | Gradient (Win9x inactive titlebar) |
| Text Primary | `#e0e0e0` | Main text on dark backgrounds |
| Text Secondary | `#a0a0a0` | Secondary text, metadata |
| Row Alt | `#252525` | Alternating row color (playlist style) |
| Error Red | `#ff4444` | Errors, negative states |
| Warning Yellow | `#ffaa00` | Warnings |

### Typography

- **Primary font:** System UI font stack: `"Segoe UI", "MS Sans Serif", "Microsoft Sans Serif", sans-serif`
- **Monospace font:** `"Cascadia Code", "Consolas", "Courier New", monospace`
- **Pixel font (optional):** For titlebar and decorative elements — consider embedding a small `.woff2` pixel font for authentic Winamp titlebar feel.

### UI Elements (CSS patterns)

**Raised panel (button, panel):**
```css
border: 2px solid;
border-color: #ffffff #808080 #808080 #ffffff;
box-shadow: inset 1px 1px 0 #dfdfdf, inset -1px -1px 0 #404040;
```

**Sunken panel (input, inset area):**
```css
border: 2px solid;
border-color: #808080 #ffffff #ffffff #808080;
box-shadow: inset 1px 1px 0 #404040, inset -1px -1px 0 #dfdfdf;
```

**Titlebar:**
- Gradient background (active: `#000080` → `#1084d0`, inactive: `#808080` → `#b5b5b5`).
- White text with 1px dark shadow for active.
- Icon + title left-aligned, minimize/maximize/close buttons right-aligned (square, beveled).

**Winamp tab bar:**
- Dark background tabs with green text when active.
- Classic Winamp tab shape (slanted edges or rectangular with bevel).

**Scrollbar:**
- Dark track, lighter thumb, beveled edges.
- Thin, styled with `::-webkit-scrollbar` (Firefox scrollbar-width as fallback).

**Playlist-style rows:**
- Alternating background: `#2d2d2d` / `#252525`.
- Selected row: Winamp green background with dark text.

---

## Data Models

### Shared Types (Go ↔ JSON)

```go
type Artist struct {
    ID       string   `json:"id"`       // MusicBrainz MBID or generated UUID
    Name     string   `json:"name"`
    Genres   []string `json:"genres"`
    ImageURL string   `json:"imageUrl,omitempty"`
    Popularity int    `json:"popularity,omitempty"` // 0-100
}

type Tour struct {
    ID          string   `json:"id"`
    ArtistName  string   `json:"artistName"`
    TourName    string   `json:"tourName,omitempty"`
    Date        string   `json:"date"`         // ISO 8601
    City        string   `json:"city"`
    Venue       string   `json:"venue"`
    Country     string   `json:"country"`
    CountryCode string   `json:"countryCode"`  // ISO 3166-1 alpha-2
    TicketURL   string   `json:"ticketUrl,omitempty"`
    ImageURL    string   `json:"imageUrl,omitempty"`
    Source      string   `json:"source"`       // "bandsintown", "songkick", "rss", etc.
}

type ArtistRelation struct {
    Artist     Artist `json:"artist"`
    RelationType string `json:"relationType"` // "similar", "collaboration", "member_of", "influenced_by"
    Score      float64 `json:"score"`         // 0.0-1.0 relevance
}

type GraphData struct {
    Nodes []GraphNode `json:"nodes"`
    Edges []GraphEdge `json:"edges"`
}

type GraphNode struct {
    ID       string   `json:"id"`
    Artist   Artist   `json:"artist"`
    X        float64  `json:"x"`       // Computed by layout; 0 for new nodes
    Y        float64  `json:"y"`
    Selected bool     `json:"selected"` // User has explicitly selected this node
    Expanded bool     `json:"expanded"` // Relationships already fetched
}

type GraphEdge struct {
    Source   string `json:"source"`   // Node ID
    Target   string `json:"target"`   // Node ID
    Type     string `json:"type"`     // "similar", "collaboration", etc.
}
```

---

## Node Graph: Force-Directed Layout Algorithm

Implemented in `web/js/graph.js` using Canvas 2D:

```
1. Initialize:
   - For each node: assign random (x, y) near center
   - For each edge: store source→target reference

2. Per-frame simulation loop (requestAnimationFrame):
   a. Repulsion: for every pair of nodes (i, j):
      force = k_repulsion / distance²
      apply force away from each other

   b. Attraction: for every edge:
      force = k_attraction * (distance - ideal_length)
      apply force toward each other

   c. Center gravity: for every node:
      weak force toward canvas center

   d. Apply forces to velocities, clamp max velocity
   e. Update positions
   f. Apply damping (velocity *= 0.9)

3. Rendering:
   - Clear canvas
   - Draw edges (lines, color by type)
   - Draw nodes (circles, fill by genre, radius by popularity)
   - Draw labels (truncated artist names, 12px font)
   - Draw selection ring on selected nodes

4. Interaction (event listeners on canvas):
   - mousedown: hit-test nodes → start drag or start selection
   - mousemove: drag node or pan canvas
   - mouseup: end drag; if no drag, treat as click → expand
   - wheel: zoom in/out
   - dblclick: focus on node (center + zoom)
```

**Performance considerations:**
- Use a spatial grid to avoid O(n²) repulsion calculations.
- Only render nodes within the viewport (culling).
- Throttle simulation to ~30fps when idle.
- Cap at ~500 visible nodes (warn user if exceeded).

---

## API Integration Strategy

### Provider Priority Order

**Tour data:**
1. Bandsintown (free — always on if key configured)
2. Songkick (paid — if key configured)
3. Ticketmaster (paid — if key configured)
4. RSS scraper (free — always on, supplements)

**Artist relationships:**
1. MusicBrainz (free, no key — always on)
2. Last.fm (free key — if configured)

### Bandsintown API

- **Endpoint:** `GET https://rest.bandsintown.com/artists/{artistname}/events?app_id={app_id}&date=upcoming`
- **Rate limit:** ~100 requests/minute with free app_id.
- **Returns:** Event list with datetime, venue (name, city, country, lat/lng), lineup, ticket URL, description.
- **Auth:** `app_id` query parameter (public, but we proxy to keep it out of browser).

### MusicBrainz API

- **Endpoint:** `GET https://musicbrainz.org/ws/2/artist/?query=artist:{name}&fmt=json`
- **Relationships:** Included in artist response (`relations` field) showing collaborations, group membership, influences.
- **Tags/Genres:** Included via `tags` field.
- **Rate limit:** ~1 request/second. We respect this with a client-side throttle.
- **No API key needed.** Just set a User-Agent header.

### Last.fm API

- **Endpoints:**
  - `artist.getSimilar` → similar artists with match scores.
  - `artist.getTopTags` → genre tags.
  - `artist.getInfo` → bio, image, stats (listeners, playcount).
- **Auth:** `api_key` query parameter.
- **Rate limit:** ~5 requests/second.

### RSS Scraper

- **Discovery sources:**
  - `https://{slug}.bandcamp.com/feed`
  - `https://{slug}.bigcartel.com/products.rss`
  - Artist website root (look for `<link rel="alternate">` tags)
- **Feed formats:** RSS 2.0, Atom 1.0.
- **Content parsing:** Regex patterns for date extraction, named entity recognition for venue/city patterns, tour-related keyword matching.

---

## Implementation Plan

### Phase 1: Skeleton & Theme (Day 1-2)
- [x] Go project scaffolding (`go.mod`, `main.go`, directory structure).
- [x] Config loading from `.env` + flags.
- [x] HTTP server with `//go:embed` for frontend assets.
- [x] `index.html` SPA shell with Winamp tab bar.
- [x] `winamp.css` — full retro theme implementation.
- [x] Reusable UI components in `components.js` (panels, buttons, inputs, tabs).

### Phase 2: Artist Management + Graph (Day 3-5)
- [x] `store.js` — localStorage CRUD for artist list.
- [x] MusicBrainz provider (`musicbrainz.go`).
- [x] Last.fm provider (`lastfm.go`).
- [x] Artist API endpoints (`/api/artists/:name`, `/api/graph/expand/:name`).
- [x] Canvas force-directed graph (`graph.js`).
- [x] Graph interaction (click-to-expand, drag, zoom, pan).
- [x] Artist search bar + "My Artists" sidebar.

### Phase 3: Tour Grid (Day 6-7)
- [x] Bandsintown provider (`bandsintown.go`).
- [x] Tour API endpoint (`/api/tours`).
- [x] Tour grid view with columns, sorting, filtering.
- [x] Genre + country filters.
- [x] Hybrid integration: "Show in Tour Grid" checkbox.

### Phase 4: RSS Scraper (Day 8-9)
- [x] RSS/Atom feed fetcher + parser (`scraper.go`).
- [x] Auto-discovery for Bandcamp + other platforms (`discovery.go`).
- [x] Date/location extraction from unstructured text (`parser.go`).
- [x] Background worker with configurable interval.
- [x] Scraper API endpoints.

### Phase 5: Polish & Paid Providers (Day 10-11)
- [x] Songkick provider (paid, optional).
- [x] Ticketmaster provider (paid, optional).
- [x] Settings view (provider toggles, API key management).
- [x] Cache management (TTL display, clear button).
- [x] Export/Import artist list.
- [x] Error states, loading states, empty states.
- [x] Responsive design (min-width: 1024px, desktop-first).

### Phase 6: Hardening (Day 12)
- [x] Rate limit handling (backoff, retry).
- [x] Graceful degradation (if one provider is down, others still work).
- [x] Logging (structured, to stdout).
- [x] Binary size optimization (`-ldflags="-s -w"`, `upx` optional).
- [x] Build script / Makefile for cross-platform builds.

---

## Resolved Design Decisions

1. **Node graph performance:** Hard cap at 500 visible nodes. Display a retro-styled warning dialog when the cap is hit. Users can remove artists to free node slots.
2. **Tour data refresh:** Manual "Refresh" button only. No auto-polling. The button uses a Winamp-style icon (🔄) with a pressed-state animation.
3. **Artist disambiguation:** Show a retro-styled dialog when MusicBrainz returns multiple high-scoring matches for an artist name. Dialog lists candidates with disambiguation comments and genre tags.
4. **Offline mode:** Tour data is cached to `localStorage` with timestamps. If the backend is unreachable or a provider is down, stale cached data is shown with a "last updated" timestamp and a warning indicator.

---

## Next Steps

> **STATUS: Approved. Phase 1 implementation in progress.**
