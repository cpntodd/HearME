<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)">
    <img alt="HearME" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iMTIwIiB2aWV3Qm94PSIwIDAgNjAwIDEyMCI+PGRlZnM+PGZpbHRlciBpZD0iZyI+PGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMiIvPjwvZmlsdGVyPjwvZGVmcz48cmVjdCB3aWR0aD0iNjAwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iIzFhMWExYSIvPjx0ZXh0IHg9IjMwMCIgeT0iNDUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMjgiIGZpbGw9IiMyMmZmMjIiIGZpbHRlcj0idXJsKCNnKSI+SGVhck1FPC90ZXh0Pjx0ZXh0IHg9IjMwMCIgeT0iNzUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTYiIGZpbGw9IiM0NGE2NDQiPllvdXIgbXVzaWMuIFRoZWlyIHRvdXJzLiBPbmUgYmluYXJ5LjwvdGV4dD48dGV4dCB4PSIzMDAiIHk9IjEwNSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxMiIgZmlsbD0iIzU1NSI+8J+UuiBHbyDwn6WZIFplcm8gRGVwZW5kZW5jaWVzIPCfk6cgQUdQTC0zLjA8L3RleHQ+PC9zdmc+">
  </picture>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/go-1.24%2B-00ADD8?logo=go&style=flat-square" alt="Go 1.24+">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-red?style=flat-square" alt="AGPL-3.0">
  <img src="https://img.shields.io/badge/dependencies-zero-brightgreen?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/binary-~7MB-22ff22?style=flat-square" alt="Binary ~7MB">
</p>

---

**HearME** is a single-binary desktop web app for music discovery.  
Enter the artists you love. Explore a live force-directed graph of related artists.  
See their upcoming tours. Browse discographies with album art.  
Stream your Jellyfin library through a Winamp-themed audio player with real-time visualizers.

<p align="center">
  <kbd>Player</kbd> <kbd>Graph Explorer</kbd> <kbd>Tour Grid</kbd> <kbd>Settings</kbd>
</p>

---

## ✨ Features

<table>
<tr><td width="50%">

### 🎧 Audio Player
- Web Audio API engine — `AnalyserNode` + `ChannelSplitter`  
- **6 visualizer presets:** Spectrum, Oscilloscope, Circular, Particles, Fire, Bars+Beads  
- VFD-style dot-matrix display with scrolling track info  
- Dual-channel VU meters with dB scale and peak hold  
- Shuffle, repeat, playlist queue  
- Jellyfin streaming integration  

</td><td width="50%">

### 🕸️ Artist Graph
- Force-directed node graph (Canvas 2D)  
- Click to expand related artists  
- Double-click to pin/unpin — pinned nodes hold orbital gravity  
- Right-click for context menu (remove, pin, expand)  
- Resizable detail panel with bio, image, and discography grid  
- Zoom + pan with mouse wheel  

</td></tr>
<tr><td width="50%">

### 🎫 Tour Grid
- Bandsintown (free) · Songkick · Ticketmaster  
- Sortable columns: artist, date, venue, city, source  
- Offline caching via localStorage  
- RSS scraper for Bandcamp, BigCartel, and custom feeds  

</td><td width="50%">

### 🎨 Retro Theme
- Winamp / Windows 9x inspired UI  
- Green-on-black CRT aesthetic (`#22ff22` / `#1a1a1a`)  
- CSS-only — no framework  
- Customizable zoom and font size  
- Custom font URL support  

</td></tr>
</table>

---

## 🚀 Quick Start

### Prerequisites
- **Go 1.24+** — [install via go.dev](https://go.dev/dl/)
- **Nothing else.** No npm. No Docker. No runtime.

### Build & Run

```bash
git clone https://github.com/cpntodd/HearME.git
cd HearME
cp .env.example .env        # edit to add API keys (optional)
make run                    # builds and starts on :8080
```

Or manually:

```bash
go build -ldflags="-s -w" -o hearme .
./hearme
```

Then open **http://localhost:8080** in your browser.

### Configuration

All API keys are **optional**. The app works out of the box with free providers.

| Variable | Provider | Required? |
|---|---|---|
| `HEARME_BANDSINTOWN_APP_ID` | Bandsintown | No — free tier works |
| `HEARME_SONGKICK_API_KEY` | Songkick | No |
| `HEARME_TICKETMASTER_API_KEY` | Ticketmaster | No |
| `HEARME_LASTFM_API_KEY` | Last.fm | Built-in key included |
| `HEARME_PORT` | Server port | Default `8080` |
| `HEARME_SCRAPER_ENABLED` | RSS scraper | Default `true` |

---

## 🧱 Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    HearME (single binary)                 │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  HTTP Server  │  │ RSS Scraper   │  │  Image Proxy   │  │
│  │  (net/http)   │  │ (goroutine)   │  │  (/api/image)  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────────┘  │
│         │                 │                              │
│  ┌──────┴─────────────────┴──────────────────────────┐  │
│  │  Provider Layer (unified ArtistProvider + TourProvider)│
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────┐ │  │
│  │  │ MusicBrainz  │  │  Last.fm      │  │  Jellyfin  │ │  │
│  │  │ (free,no key)│  │  (bio,images) │  │  (stream)  │ │  │
│  │  └─────────────┘  └──────────────┘  └───────────┘ │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────┐ │  │
│  │  │ Bandsintown  │  │  Songkick     │  │Ticketmaster│ │  │
│  │  │ (free tier)  │  │  (api key)    │  │ (api key)  │ │  │
│  │  └─────────────┘  └──────────────┘  └───────────┘ │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Embedded Frontend (//go:embed web/)                │  │
│  │  Vanilla JS · Zero dependencies · Retro CSS         │  │
│  │  app.js · graph.js · grid.js · player.js · store.js │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- **API keys never reach the browser.** All third-party calls proxy through Go.
- **Embedded assets.** `//go:embed` bakes HTML/CSS/JS into the binary.
- **localStorage persistence.** Artists, settings, and cached tours live in the browser.
- **Cover Art Archive ORB fix.** Image proxy endpoint bypasses CORS restrictions.

---

## 📁 Project Structure

```
HearME/
├── main.go                          # Entry point, embeds web/, loads .env
├── config/config.go                 # Config struct + env loading
├── internal/
│   ├── models/models.go             # Shared types (Artist, Tour, GraphNode, etc.)
│   ├── server/server.go             # HTTP server, all routes
│   ├── provider/
│   │   ├── provider.go              # ArtistProvider + TourProvider interfaces
│   │   ├── artists/                 # MusicBrainz + Last.fm aggregator
│   │   └── tours/                   # Bandsintown + Songkick + Ticketmaster
│   ├── scraper/scraper.go           # RSS engine (Bandcamp, BigCartel, custom)
│   ├── lyrics/lyrics.go             # Lyrics.ovh + Genius stub
│   └── cache/cache.go              # Generic TTL cache (sync.Map)
├── web/
│   ├── index.html                   # SPA shell (Player | Graph | Tours | Settings)
│   ├── css/winamp.css               # Winamp/9x retro theme (~1k lines)
│   └── js/
│       ├── app.js                   # Main orchestrator + tab routing
│       ├── graph.js                 # Force-directed canvas graph
│       ├── grid.js                  # Tour grid with sort/filter
│       ├── player.js                # Web Audio API player + visualizers
│       ├── store.js                 # localStorage CRUD
│       ├── api.js                   # Fetch wrapper
│       └── components.js            # Reusable UI (dialog, toast)
├── Makefile                         # build, run, vet, clean, release
├── .env.example                     # Template configuration
├── DESIGN.md                        # Full design document
└── LICENSE                          # GNU AGPL-3.0
```

---

## 🖥️ Screenshots

> *Screenshots coming soon — once the Jellyfin integration is wired and the library is populated.*

| Tab | What it does |
|---|---|
| **Player** | Album art, transport controls, 6 visualizer presets, VFD display, VU meters, playlist queue |
| **Graph Explorer** | Force-directed node graph, sidebar with artist search, detail panel with bio + discography |
| **Tour Grid** | Sortable table of upcoming shows from all enabled providers |
| **Settings** | API keys, data sources, appearance (zoom/font), data management |

---

## 🛠️ Development

```bash
make vet          # Run go vet
make build        # Optimized build (stripped)
make build-debug  # Build with debug symbols
make release      # Cross-compile linux/amd64 + linux/arm64
make clean        # Remove binary
```

The frontend is **plain ES2020 JavaScript** — no build step, no bundler. Edit files in `web/js/` and rebuild. The binary re-embeds them via `//go:embed`.

---

## 📜 License

**GNU Affero General Public License v3.0** (AGPL-3.0)

This is a strong copyleft license. If you modify HearME and run it as a network service, you **must** make your modified source code available to users of that service. See [LICENSE](LICENSE) for full terms.

> **Why AGPL?** HearME is personal tooling I'm sharing openly. The AGPL ensures derivatives stay open while closing the "SaaS loophole" — if someone hosts a modified version as a service, their users get the source too.

---

## 🙏 Credits

Built with free/open APIs:

- [MusicBrainz](https://musicbrainz.org/) — artist metadata & relationships
- [Last.fm](https://www.last.fm/api) — bios, images, discography
- [Bandsintown](https://www.bandsintown.com/) — concert listings
- [Cover Art Archive](https://coverartarchive.org/) — album artwork
- [Lyrics.ovh](https://lyrics.ovh/) — song lyrics

---

<p align="center">
  <sub>🎵 Your music. Their tours. One binary.</sub>
</p>
