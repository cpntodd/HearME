// app.js — Main application entry point.
// Initializes all views, wires up events, and manages tab switching.

const App = {
    currentTab: 'player',

    init() {
        Graph.init();
        Grid.init();
        Player.init();
        this._applyAppearance();
        this._bindTabs();
        this._bindArtistSearch();
        this._bindSettings();
        this._bindAppearance();
        this._bindTitlebar();
        this._bindMenus();
        this._bindNodeClick();
        this._bindNodeDelete();
        this._bindContextMenu();
        this._bindClearGraph();
        this._bindDetailPanel();
        this._restoreState();
        this._updateArtistList();
        this._loadOwnedArtists(); // async — loads Jellyfin collection for graph/tour badges

        document.getElementById('status-text').textContent = 'Ready';
    },

    // --- Owned Artists (Jellyfin cross-reference) ---
    _ownedArtists: new Set(),
    _ownedLoaded: false,

    async _loadOwnedArtists() {
        try {
            const resp = await fetch('/api/jellyfin/library/owned');
            const data = await resp.json();
            if (data.names) {
                this._ownedArtists = new Set(data.names.map(n => n.toLowerCase()));
                this._ownedLoaded = true;
                // Update status bar
                const count = document.getElementById('status-node-count');
                if (count) count.textContent += ` · ${data.names.length} owned`;
            }
        } catch {
            // non-critical — owned badges just won't show
        }
    },

    isArtistOwned(name) {
        return this._ownedArtists.has((name || '').toLowerCase());
    },

    // --- Tab Switching ---

    _bindTabs() {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                this._switchTab(tabName);
            });
        });
    },

    _switchTab(name) {
        this.currentTab = name;

        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');

        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${name}`).classList.add('active');

        // Resize canvas when switching to graph view
        if (name === 'graph') {
            requestAnimationFrame(() => {
                Graph._resize();
            });
        }

        document.getElementById('status-text').textContent =
            name === 'graph' ? 'Graph Explorer' :
            name === 'tours' ? 'Tour Grid' :
            'Settings';
    },

    // --- Artist Search ---

    _bindArtistSearch() {
        const input = document.getElementById('artist-search-input');
        const btn = document.getElementById('btn-add-artist');

        const addArtist = async () => {
            const name = input.value.trim();
            if (!name) return;

            document.getElementById('status-text').textContent = `Searching for "${name}"...`;
            input.value = '';
            input.disabled = true;
            btn.disabled = true;

            try {
                const data = await API.getArtist(name);
                if (data.matches && data.matches.length > 1) {
                    // Disambiguation needed
                    Components.showDisambiguationDialog(data.matches,
                        (match) => this._onArtistSelected(match),
                        () => {
                            document.getElementById('status-text').textContent = 'Ready';
                        }
                    );
                } else {
                    // Single match, no matches (API fallback), or direct response
                    const artist = (data.matches && data.matches.length === 1)
                        ? data.matches[0]
                        : { id: data.id || ('local_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_')),
                            name: data.name || name,
                            genres: data.genres || [],
                            popularity: data.popularity || 0 };
                    this._onArtistSelected(artist);
                }
            } catch (err) {
                // Create a local-only artist for offline/fallback
                const artist = {
                    id: 'local_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
                    name: name,
                    genres: [],
                    popularity: 0,
                };
                this._onArtistSelected(artist);
                document.getElementById('status-text').textContent =
                    `Added "${name}" (offline mode — ${err.message})`;
            }

            input.disabled = false;
            btn.disabled = false;
            input.focus();
        };

        btn.addEventListener('click', addArtist);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addArtist();
        });
    },

    _onArtistSelected(artist) {
        // Add to store
        Store.addArtist({ ...artist, showInTours: true });

        // Add to graph
        const added = Graph.addNode(artist);
        if (!added) {
            Components.toast('Node limit reached (500). Remove some artists first.', 'error');
            return;
        }

        this._updateArtistList();
        document.getElementById('status-text').textContent = `Added "${artist.name}"`;

        // Expand graph: fetch related artists
        this._expandArtist(artist);

        // Discover RSS feeds for scraper
        this._discoverFeeds(artist);
    },

    async _expandArtist(artist) {
        document.getElementById('status-text').textContent = `Expanding "${artist.name}"...`;
        try {
            const data = await API.expandGraph(artist.name);
            if (data.nodes && data.nodes.length > 0) {
                Graph.addRelatedNodes(artist.id, data.nodes.map(n => ({
                    artist: n.artist,
                    relationType: n.relationType || 'similar',
                })));
                document.getElementById('status-text').textContent =
                    `Found ${data.nodes.length} related artists for "${artist.name}"`;
            } else {
                document.getElementById('status-text').textContent =
                    `No related artists found for "${artist.name}"`;
            }
        } catch (err) {
            document.getElementById('status-text').textContent =
                `Could not expand "${artist.name}" (${err.message})`;
        }
    },

    async _discoverFeeds(artist) {
        try {
            const resp = await fetch(`/api/scraper/feeds/${encodeURIComponent(artist.name)}`, { method: 'POST' });
            const data = await resp.json();
            if (data.feeds && data.feeds.length > 0) {
                document.getElementById('status-text').textContent =
                    `Found ${data.feeds.length} RSS feed(s) for "${artist.name}"`;
            }
        } catch {
            // Feed discovery is best-effort; failures are silent
        }
    },

    // --- Node Click (Graph → App communication) ---

    _bindNodeClick() {
        Graph.onNodeClick((node) => {
            // Always allow expansion (re-fetch if previously expanded)
            this._expandArtist(node.artist);
            Graph.selectNode(node.id);
            this._updateArtistList();
            this._showDetailPanel(node);

            // Check the artist in the sidebar
            const items = document.querySelectorAll('#artist-list li');
            items.forEach(li => {
                li.classList.remove('selected');
                if (li.dataset.artistId === node.id) {
                    li.classList.add('selected');
                }
            });
        });
    },

    _bindNodeDelete() {
        Graph.onNodeDelete((node) => {
            const connected = Graph.getConnectedNodes(node.id);
            const connectedOthers = connected.filter(nid => nid !== node.id);
            const connectedNames = connectedOthers.map(nid => {
                const n = Graph.nodes.find(no => no.id === nid);
                return n ? n.artist.name : nid;
            });

            let msg = `Delete "${node.artist.name}"?`;
            if (connectedNames.length > 0) {
                msg += `\n\nConnected artists (${connectedNames.length}):\n${connectedNames.map(n => '• ' + n).join('\n')}\n\nDelete connected artists too?`;
            }

            if (confirm(msg)) {
                // Delete host + all connected
                Graph.removeConnectedNodes(node.id);
                connected.forEach(nid => Store.removeArtist(nid));
            } else {
                // Delete only this node
                Graph.removeNode(node.id);
                Store.removeArtist(node.id);
            }
            this._updateArtistList();
            document.getElementById('status-text').textContent =
                `Removed "${node.artist.name}"`;
        });
    },

    _bindContextMenu() {
        const menu = document.getElementById('graph-context-menu');
        let currentTarget = null;
        let justOpened = false;

        Graph.onContextMenu((node, x, y) => {
            currentTarget = node;
            justOpened = true;
            const pinItem = menu.querySelector('[data-action="pin"]');
            const unpinItem = menu.querySelector('[data-action="unpin"]');
            if (node.pinned) {
                pinItem.classList.add('hidden');
                unpinItem.classList.remove('hidden');
            } else {
                pinItem.classList.remove('hidden');
                unpinItem.classList.add('hidden');
            }
            menu.style.left = Math.min(x, window.innerWidth - 130) + 'px';
            menu.style.top = Math.min(y, window.innerHeight - 80) + 'px';
            menu.classList.remove('hidden');
        });

        const hide = () => { menu.classList.add('hidden'); currentTarget = null; };

        menu.querySelector('[data-action="pin"]').addEventListener('click', () => {
            if (currentTarget) { currentTarget.pinned = true; currentTarget.vx = 0; currentTarget.vy = 0; }
            hide();
        });
        menu.querySelector('[data-action="unpin"]').addEventListener('click', () => {
            if (currentTarget) {
                currentTarget.pinned = false;
                currentTarget.vx = (Math.random() - 0.5) * 2;
                currentTarget.vy = (Math.random() - 0.5) * 2;
            }
            hide();
        });
        menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
            if (currentTarget && Graph._onNodeDelete) Graph._onNodeDelete(currentTarget);
            hide();
        });

        document.addEventListener('click', (e) => { if (!menu.contains(e.target)) hide(); });
        document.addEventListener('contextmenu', (e) => {
            if (justOpened) { justOpened = false; return; }
            if (!menu.contains(e.target)) hide();
        });
    },

    _bindClearGraph() {
        document.getElementById('btn-clear-graph').addEventListener('click', () => {
            if (confirm('Clear all nodes from the graph? This cannot be undone.')) {
                Graph.clearAll();
                const artists = Store.getArtists();
                artists.forEach(a => Store.removeArtist(a.id || a.name));
                this._updateArtistList();
                this._hideDetailPanel();
                document.getElementById('status-text').textContent = 'Graph cleared.';
            }
        });
    },

    _bindDetailPanel() {
        document.getElementById('detail-close').addEventListener('click', () => {
            this._hideDetailPanel();
            Graph.nodes.forEach(n => n.selected = false);
        });
        // Album modal close
        document.getElementById('album-modal-close').addEventListener('click', () => {
            document.getElementById('album-modal-overlay').classList.add('hidden');
        });
        document.getElementById('album-modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                document.getElementById('album-modal-overlay').classList.add('hidden');
            }
        });

        // Resize grip for detail panel
        this._bindDetailResize();
        // Vertical section separators
        this._bindDetailSeparators();
    },

    _bindDetailSeparators() {
        document.querySelectorAll('.detail-separator').forEach(sep => {
            let dragging = false;
            let startY = 0;
            let startHeight = 0;
            let targetSection = null;

            sep.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const sectionId = sep.dataset.resize;
                targetSection = document.getElementById(
                    sectionId === 'top' ? 'detail-section-top' :
                    sectionId === 'bio' ? 'detail-section-bio' : null
                );
                if (!targetSection) return;

                dragging = true;
                startY = e.clientY;
                startHeight = targetSection.offsetHeight;
                sep.classList.add('active');
                document.body.style.userSelect = 'none';
                document.body.style.cursor = 'ns-resize';
            });

            const onMove = (e) => {
                if (!dragging || !targetSection) return;
                const dy = e.clientY - startY;
                const minH = parseInt(targetSection.style.minHeight) || 40;
                const maxH = parseInt(targetSection.style.maxHeight) || 500;
                const newHeight = Math.min(maxH, Math.max(minH, startHeight + dy));
                targetSection.style.height = newHeight + 'px';
            };

            const onUp = () => {
                if (dragging) {
                    dragging = false;
                    sep.classList.remove('active');
                    document.body.style.userSelect = '';
                    document.body.style.cursor = '';
                    targetSection = null;
                }
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    },

    _bindDetailResize() {
        const grip = document.getElementById('detail-resize-grip');
        const panel = document.getElementById('detail-panel');
        let dragging = false;
        let startX = 0;
        let startWidth = 0;

        grip.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragging = true;
            startX = e.clientX;
            startWidth = panel.offsetWidth;
            grip.classList.add('active');
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'ew-resize';
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = startX - e.clientX; // leftward drag = wider panel
            const newWidth = Math.min(520, Math.max(200, startWidth + dx));
            panel.style.width = newWidth + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                grip.classList.remove('active');
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
            }
        });
    },

    async _showDetailPanel(node) {
        const panel = document.getElementById('detail-panel');
        const nameEl = document.getElementById('detail-name');
        const genresEl = document.getElementById('detail-genres');
        const bioEl = document.getElementById('detail-bio');
        const imgEl = document.getElementById('detail-artist-img');
        const discoEl = document.getElementById('detail-discography');

        nameEl.textContent = node.artist.name;
        genresEl.innerHTML = (node.artist.genres || []).slice(0, 8)
            .map(g => `<span class="detail-genre-tag">${this._esc(g)}</span>`).join('');

        // Show artist image with timeout fallback
        const imgContainer = document.getElementById('detail-artist-img-container');
        const fallbackEl = document.getElementById('detail-artist-fallback');
        let loadTimer = null;

        const showFallback = () => {
            imgEl.style.display = 'none';
            fallbackEl.style.display = 'flex';
        };

        if (node.artist.imageUrl) {
            imgContainer.classList.remove('hidden');
            imgEl.style.display = '';
            fallbackEl.style.display = 'none';
            imgEl.src = `/api/image?url=${encodeURIComponent(node.artist.imageUrl)}`;
            // If image doesn't load within 4 seconds, show fallback
            loadTimer = setTimeout(() => {
                if (!imgEl.complete || imgEl.naturalWidth === 0) showFallback();
            }, 4000);
            imgEl.onload = () => { if (loadTimer) clearTimeout(loadTimer); };
            imgEl.onerror = () => { if (loadTimer) clearTimeout(loadTimer); showFallback(); };
        } else {
            imgContainer.classList.add('hidden');
        }

        // Show bio if available
        if (node.artist.bio) {
            bioEl.textContent = node.artist.bio;
            bioEl.classList.remove('hidden');
            document.getElementById('detail-section-bio').style.height = '80px';
        } else {
            bioEl.classList.add('hidden');
            document.getElementById('detail-section-bio').style.height = '40px';
        }

        discoEl.innerHTML = '<div class="detail-loading">Loading...</div>';
        panel.classList.remove('hidden');

        this._currentReleases = [];
        this._currentFilter = 'all';
        this._currentSortDesc = true;
        this._currentArtist = node.artist;

        document.querySelectorAll('.detail-filter-tab:not(.detail-sort-btn)').forEach(t => t.classList.remove('active'));
        const allTab = document.querySelector('.detail-filter-tab[data-filter="all"]');
        if (allTab) allTab.classList.add('active');
        document.getElementById('detail-sort-btn').textContent = '↓ Year';

        try {
            const resp = await fetch(`/api/artists/discography/${encodeURIComponent(node.artist.name)}`);
            const data = await resp.json();
            this._currentReleases = data.releases || [];

            // Update bio + image from discography response if not already set
            const artist = data.artist;
            if (artist) {
                if (artist.genres && artist.genres.length > 0) {
                    genresEl.innerHTML = artist.genres.slice(0, 8)
                        .map(g => `<span class="detail-genre-tag">${this._esc(g)}</span>`).join('');
                }
                if (artist.bio && !node.artist.bio) {
                    bioEl.textContent = artist.bio;
                    bioEl.classList.remove('hidden');
                    document.getElementById('detail-section-bio').style.height = '80px';
                    node.artist.bio = artist.bio;
                }
                if (artist.imageUrl && !node.artist.imageUrl) {
                    imgContainer.classList.remove('hidden');
                    imgEl.style.display = '';
                    fallbackEl.style.display = 'none';
                    imgEl.src = `/api/image?url=${encodeURIComponent(artist.imageUrl)}`;
                    node.artist.imageUrl = artist.imageUrl;
                    loadTimer = setTimeout(() => {
                        if (!imgEl.complete || imgEl.naturalWidth === 0) showFallback();
                    }, 4000);
                    imgEl.onload = () => { if (loadTimer) clearTimeout(loadTimer); };
                    imgEl.onerror = () => { if (loadTimer) clearTimeout(loadTimer); showFallback(); };
                }
            }

            this._renderAlbumGrid();
        } catch {
            discoEl.innerHTML = '<div class="detail-loading">Failed to load.</div>';
        }
    },

    _renderAlbumGrid() {
        const discoEl = document.getElementById('detail-discography');
        let filtered = this._currentReleases;
        if (this._currentFilter !== 'all') {
            filtered = filtered.filter(r => (r.type || 'album') === this._currentFilter);
        }

        // Sort by year
        filtered = [...filtered].sort((a, b) => {
            const cmp = (a.year || 0) - (b.year || 0);
            return this._currentSortDesc ? -cmp : cmp;
        });

        if (filtered.length === 0) {
            discoEl.innerHTML = '<div class="detail-loading">No releases found.</div>';
            return;
        }

        discoEl.innerHTML = filtered.map(r => {
            const imgSrc = r.imageUrl ? `/api/image?url=${encodeURIComponent(r.imageUrl)}` : '';
            const imgHTML = r.imageUrl
                ? `<img src="${imgSrc}" class="detail-album-art" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="detail-album-art-placeholder" style="display:none">💿</div>`
                : `<div class="detail-album-art-placeholder">💿</div>`;
            return `
                <div class="detail-album-card" data-title="${this._esc(r.title)}" data-type="${this._esc(r.type)}">
                    ${imgHTML}
                    <div class="detail-album-name">${this._esc(r.title)}</div>
                    <div class="detail-album-year">${r.year || ''} ${r.type || ''}</div>
                </div>
            `;
        }).join('');

        discoEl.querySelectorAll('.detail-album-card').forEach(card => {
            card.addEventListener('click', () => {
                this._openAlbumModal(this._currentArtist.name, card.dataset.title);
            });
        });

        // Filter tabs (exclude sort button)
        document.querySelectorAll('.detail-filter-tab:not(.detail-sort-btn)').forEach(tab => {
            tab.onclick = () => {
                document.querySelectorAll('.detail-filter-tab:not(.detail-sort-btn)').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this._currentFilter = tab.dataset.filter;
                this._renderAlbumGrid();
            };
        });

        // Sort toggle
        const sortBtn = document.getElementById('detail-sort-btn');
        sortBtn.onclick = () => {
            this._currentSortDesc = !this._currentSortDesc;
            sortBtn.textContent = this._currentSortDesc ? '↓ Year' : '↑ Year';
            this._renderAlbumGrid();
        };
    },

    async _openAlbumModal(artistName, albumTitle) {
        const overlay = document.getElementById('album-modal-overlay');
        const titleEl = document.getElementById('album-modal-title');
        const artistEl = document.getElementById('album-modal-artist');
        const metaEl = document.getElementById('album-modal-meta');
        const tracksEl = document.getElementById('album-modal-tracks');
        const lyricsEl = document.getElementById('album-modal-lyrics');
        const imgEl = document.getElementById('album-modal-img');

        titleEl.textContent = albumTitle;
        artistEl.textContent = artistName;
        metaEl.textContent = 'Loading...';
        tracksEl.innerHTML = '<div class="detail-loading">Loading tracks...</div>';
        lyricsEl.classList.add('hidden');
        imgEl.src = '';
        overlay.classList.remove('hidden');

        try {
            const resp = await fetch(`/api/albums/${encodeURIComponent(artistName)}/${encodeURIComponent(albumTitle)}`);
            const album = await resp.json();

            artistEl.textContent = album.artist || artistName;
            const metaParts = [];
            if (album.year) metaParts.push(album.year);
            if (album.type) metaParts.push(album.type);
            if (album.playCount) metaParts.push(`${Number(album.playCount).toLocaleString()} plays`);
            metaEl.textContent = metaParts.join(' • ');

            if (album.imageUrl) {
                imgEl.src = `/api/image?url=${encodeURIComponent(album.imageUrl)}`;
            }

            const tracks = album.tracks || [];
            tracksEl.innerHTML = tracks.map(t => `
                <div class="album-modal-track" data-artist="${this._esc(artistName)}" data-track="${this._esc(t.title)}">
                    <span class="album-modal-track-num">${t.number || ''}</span>
                    <span>${this._esc(t.title)}</span>
                    <span class="album-modal-track-dur">${t.duration || ''}</span>
                </div>
            `).join('');

            // Bind track clicks → show lyrics
            tracksEl.querySelectorAll('.album-modal-track').forEach(trackEl => {
                trackEl.addEventListener('click', async () => {
                    const tArtist = trackEl.dataset.artist;
                    const tTitle = trackEl.dataset.track;
                    lyricsEl.classList.remove('hidden');
                    document.getElementById('album-modal-lyrics-text').textContent = 'Loading lyrics...';
                    try {
                        const lr = await fetch(`/api/lyrics/${encodeURIComponent(tArtist)}/${encodeURIComponent(tTitle)}`);
                        const ld = await lr.json();
                        document.getElementById('album-modal-lyrics-text').textContent =
                            ld.lyrics || 'No lyrics found.';
                    } catch {
                        document.getElementById('album-modal-lyrics-text').textContent = 'Failed to load lyrics.';
                    }
                });
            });
        } catch {
            tracksEl.innerHTML = '<div class="detail-loading">Failed to load album details.</div>';
        }
    },

    _hideDetailPanel() {
        document.getElementById('detail-panel').classList.add('hidden');
    },

    // --- Artist List Sidebar ---

    _updateArtistList() {
        const list = document.getElementById('artist-list');
        const artists = Store.getArtists();

        if (artists.length === 0) {
            list.innerHTML = '<li class="artist-list-empty">No artists added yet.<br>Search above to add some.</li>';
            return;
        }

        list.innerHTML = artists.map(a => `
            <li data-artist-id="${this._esc(a.id || a.name)}" class="${a.showInTours !== false ? '' : 'dimmed'}">
                <input type="checkbox" class="artist-check" ${a.showInTours !== false ? 'checked' : ''}
                    data-artist-id="${this._esc(a.id || a.name)}">
                <span class="artist-name">${this._esc(a.name)}</span>
                <span class="artist-remove" data-artist-id="${this._esc(a.id || a.name)}" title="Remove">✕</span>
            </li>
        `).join('');

        // Bind checkboxes
        list.querySelectorAll('.artist-check').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = cb.dataset.artistId;
                Store.toggleShowInTours(id, cb.checked);
            });
        });

        // Bind remove buttons
        list.querySelectorAll('.artist-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.artistId;
                const artist = artists.find(a => (a.id || a.name) === id);
                if (!artist) return;

                const connected = Graph.getConnectedNodes(id);
                const connectedNames = connected
                    .filter(nid => nid !== id)
                    .map(nid => {
                        const node = Graph.nodes.find(n => n.id === nid);
                        return node ? node.artist.name : nid;
                    });

                if (connectedNames.length > 0) {
                    const msg = `Delete "${artist.name}"?\n\nConnected artists (${connectedNames.length}):\n${connectedNames.map(n => '• ' + n).join('\n')}\n\nDelete connected artists too?`;
                    const result = confirm(msg);
                    if (result) {
                        // Delete host + all connected
                        Graph.removeConnectedNodes(id);
                        connected.forEach(nid => {
                            if (nid !== id) Store.removeArtist(nid);
                        });
                    } else {
                        // Delete only host, keep connections (they become orphaned)
                        Graph.removeNode(id);
                    }
                } else {
                    if (confirm(`Delete "${artist.name}"?`)) {
                        Graph.removeNode(id);
                    } else {
                        return; // User cancelled
                    }
                }

                Store.removeArtist(id);
                this._updateArtistList();
                document.getElementById('status-text').textContent =
                    `Removed "${artist.name}"`;
            });
        });

        // Bind click to select
        list.querySelectorAll('li').forEach(li => {
            li.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.classList.contains('artist-remove')) return;
                const id = li.dataset.artistId;
                Graph.selectNode(id);
                this._updateArtistList();
                li.classList.add('selected');
            });
        });
    },

    // --- Settings ---

    _bindSettings() {
        // Load current settings from backend
        this._loadSettings();

        // Collapsible panel headers
        document.querySelectorAll('#view-settings .panel-header').forEach(header => {
            header.addEventListener('click', () => {
                header.classList.toggle('collapsed');
            });
        });

        document.getElementById('btn-clear-cache').addEventListener('click', async () => {
            if (confirm('Clear all cached data?')) {
                localStorage.removeItem('hearme_cached_tours');
                localStorage.removeItem('hearme_graph_state');
                // Also clear backend cache
                try {
                    await fetch('/api/cache/clear', { method: 'POST' });
                } catch { /* non-critical */ }
                Components.toast('Cache cleared.', 'info');
            }
        });

        document.getElementById('btn-export-artists').addEventListener('click', () => {
            const data = Store.exportAll();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'hearme_backup.json';
            a.click();
            URL.revokeObjectURL(url);
            Components.toast('Artists exported.', 'info');
        });

        document.getElementById('btn-import-artists').addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = '.json';
            inp.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const data = JSON.parse(reader.result);
                        Store.importAll(data);
                        this._updateArtistList();
                        this._restoreState();
                        Components.toast('Artists imported. Restarting graph...', 'info');
                        // Rebuild graph from imported artists
                        Graph.clearAll();
                        Store.getArtists().forEach(a => {
                            Graph.addNode(a);
                            if (a.expanded) this._expandArtist(a);
                        });
                    } catch {
                        Components.toast('Invalid backup file.', 'error');
                    }
                };
                reader.readAsText(file);
            };
            inp.click();
        });

        document.getElementById('btn-reset-all').addEventListener('click', () => {
            if (confirm('This will delete ALL your data. Are you sure?')) {
                Store.resetAll();
                Graph.clearAll();
                this._updateArtistList();
                Grid.tours = [];
                Grid.render();
                // Clear backend cache too
                fetch('/api/cache/clear', { method: 'POST' }).catch(() => {});
                Components.toast('All data has been reset.', 'info');
            }
        });

        // API Keys save
        document.getElementById('btn-save-keys').addEventListener('click', async () => {
            const body = {};
            const lastfmKey = document.getElementById('setting-lastfm-key').value.trim();
            const bandsintownKey = document.getElementById('setting-bandsintown-key').value.trim();
            const songkickKey = document.getElementById('setting-songkick-key').value.trim();
            const ticketmasterKey = document.getElementById('setting-ticketmaster-key').value.trim();
            if (lastfmKey) body.lastfmKey = lastfmKey;
            if (bandsintownKey) body.bandsintownKey = bandsintownKey;
            if (songkickKey) body.songkickKey = songkickKey;
            if (ticketmasterKey) body.ticketmasterKey = ticketmasterKey;
            if (Object.keys(body).length === 0) {
                Components.toast('No keys to save.', 'info');
                return;
            }
            try {
                const resp = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (resp.ok) {
                    Components.toast('API keys saved.', 'info');
                    document.getElementById('setting-save-status').textContent = '✓ Saved';
                    setTimeout(() => { document.getElementById('setting-save-status').textContent = ''; }, 2000);
                    // Reload settings to update provider checkboxes
                    this._loadSettings();
                } else {
                    Components.toast('Failed to save keys.', 'error');
                }
            } catch {
                Components.toast('Failed to save keys.', 'error');
            }
        });

        // Jellyfin save
        document.getElementById('btn-save-jellyfin').addEventListener('click', async () => {
            const body = {};
            const url = document.getElementById('setting-jellyfin-url').value.trim();
            const key = document.getElementById('setting-jellyfin-key').value.trim();
            if (url) body.jellyfinUrl = url;
            if (key) body.jellyfinKey = key;
            if (Object.keys(body).length === 0) {
                Components.toast('No Jellyfin settings to save.', 'info');
                return;
            }
            try {
                const resp = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (resp.ok) {
                    Components.toast('Jellyfin settings saved.', 'info');
                    document.getElementById('setting-jellyfin-status').textContent = '✓ Saved';
                    document.getElementById('setting-jellyfin-key').value = '';
                    document.getElementById('setting-jellyfin-key').placeholder = '(saved)';
                    setTimeout(() => { document.getElementById('setting-jellyfin-status').textContent = ''; }, 2000);
                } else {
                    Components.toast('Failed to save Jellyfin settings.', 'error');
                }
            } catch {
                Components.toast('Failed to save Jellyfin settings.', 'error');
            }
        });

        // Scraper toggle
        document.getElementById('setting-scraper').addEventListener('change', async (e) => {
            try {
                await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scraperEnabled: e.target.checked }),
                });
                Components.toast(`Scraper ${e.target.checked ? 'enabled' : 'disabled'}.`, 'info');
            } catch {
                Components.toast('Failed to update settings.', 'error');
            }
        });
    },

    async _loadSettings() {
        try {
            const resp = await fetch('/api/settings');
            const data = await resp.json();
            // Update checkboxes
            const providers = data.providers || {};
            document.getElementById('setting-bandsintown').checked = providers.bandsintown || false;
            document.getElementById('setting-songkick').checked = providers.songkick || false;
            document.getElementById('setting-ticketmaster').checked = providers.ticketmaster || false;
            document.getElementById('setting-lastfm').checked = providers.lastfm || false;
            document.getElementById('setting-scraper').checked = (data.scraper && data.scraper.enabled) || false;
            // Jellyfin
            const jf = data.jellyfin || {};
            document.getElementById('setting-jellyfin-url').value = jf.url || '';
            document.getElementById('setting-jellyfin-key').placeholder = jf.hasKey ? '(saved)' : 'Dashboard > API Keys';
            // Update cache info
            const cacheEntries = (data.cache && data.cache.entries) || 0;
            document.getElementById('status-text').textContent =
                `Settings loaded • ${cacheEntries} cached entries`;
        } catch {
            // Settings load is non-critical
        }
    },

    // --- Appearance ---

    _applyAppearance() {
        const settings = Store.getSettings();
        this._setZoom(settings.uiZoom || 1.0);
        this._setFontSize(settings.fontSize || 12);
        if (settings.fontUrl) {
            this._loadCustomFont(settings.fontUrl);
        }
        // Init appearance controls
        document.getElementById('setting-zoom').value = settings.uiZoom || 1.0;
        document.getElementById('setting-zoom-val').textContent = (settings.uiZoom || 1.0).toFixed(1) + 'x';
        document.getElementById('setting-font-size').value = settings.fontSize || 12;
        document.getElementById('setting-font-val').textContent = (settings.fontSize || 12) + 'px';
        document.getElementById('setting-font-url').value = settings.fontUrl || '';

        // Re-apply zoom on window resize to keep layout correct
        window.addEventListener('resize', () => {
            const s = Store.getSettings();
            if (s.uiZoom && s.uiZoom !== 1.0) {
                const wrapper = document.getElementById('app-wrapper');
                if (wrapper) {
                    wrapper.style.width = (100 / s.uiZoom) + '%';
                    wrapper.style.height = (100 / s.uiZoom) + 'vh';
                }
                if (Graph && Graph._resize) setTimeout(() => Graph._resize(), 50);
            }
        });
    },

    _setZoom(zoom) {
        const wrapper = document.getElementById('app-wrapper');
        if (wrapper) {
            wrapper.style.transform = `scale(${zoom})`;
            wrapper.style.width = (100 / zoom) + '%';
            wrapper.style.height = (100 / zoom) + 'vh';
        }
        document.getElementById('setting-zoom-val').textContent = zoom.toFixed(1) + 'x';
        const settings = Store.getSettings();
        settings.uiZoom = zoom;
        Store.setSettings(settings);
        if (Graph && Graph._resize) {
            setTimeout(() => Graph._resize(), 50);
        }
    },

    _setFontSize(size) {
        // Inject a style element that scales all font-size declarations
        const scale = size / 12; // 12px is the default base
        const styleId = 'hearme-font-scale';
        let styleEl = document.getElementById(styleId);
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = styleId;
            document.head.appendChild(styleEl);
        }
        // Generate CSS to scale fonts. Target only text-content elements, not layout containers.
        styleEl.textContent = `
            .panel-header, .titlebar-text, .statusbar,
            .detail-name, .detail-bio, .detail-genre-tag, .detail-album-name,
            .detail-album-year, .detail-filter-tab, .detail-release,
            .detail-section-title, .album-modal-track, .album-modal-artist,
            .album-modal-meta, .setting-label,
            .context-menu-item, .legend-item, .artist-list li,
            .tour-table th, .tour-table td, .filter-label,
            .dialog-body, .dialog-body p, .checkbox-label,
            .graph-hint, .graph-warning, .detail-loading,
            .detail-sort-btn, .setting-status,
            .artist-list-empty, .tour-empty td, .offline-warning,
            .album-modal-tracks-title, .album-modal-lyrics pre,
            .album-modal-track-num, .album-modal-track-dur,
            .detail-release-year, .detail-release-type,
            .artist-name, .detail-artist-fallback {
                font-size: ${size}px !important;
            }
            .detail-genre-tag, .detail-album-year, .detail-filter-tab,
            .album-modal-track-num, .album-modal-track-dur,
            .detail-release-year, .detail-release-type,
            .legend-item, .graph-hint, .graph-warning,
            .detail-sort-btn, .setting-status {
                font-size: ${Math.round(size * 0.8)}px !important;
            }
        `;
        document.getElementById('setting-font-val').textContent = size + 'px';
        const settings = Store.getSettings();
        settings.fontSize = size;
        Store.setSettings(settings);
    },

    _loadCustomFont(url) {
        if (!url) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.id = 'custom-font-link';
        const old = document.getElementById('custom-font-link');
        if (old) old.remove();
        document.head.appendChild(link);
        const settings = Store.getSettings();
        settings.fontUrl = url;
        Store.setSettings(settings);
    },

    _bindAppearance() {
        const zoomSlider = document.getElementById('setting-zoom');
        const fontSlider = document.getElementById('setting-font-size');

        zoomSlider.addEventListener('input', () => {
            this._setZoom(parseFloat(zoomSlider.value));
        });
        document.getElementById('setting-zoom-up').addEventListener('click', () => {
            zoomSlider.value = Math.min(2.0, parseFloat(zoomSlider.value) + 0.1);
            zoomSlider.dispatchEvent(new Event('input'));
        });
        document.getElementById('setting-zoom-down').addEventListener('click', () => {
            zoomSlider.value = Math.max(0.8, parseFloat(zoomSlider.value) - 0.1);
            zoomSlider.dispatchEvent(new Event('input'));
        });

        fontSlider.addEventListener('input', () => {
            this._setFontSize(parseInt(fontSlider.value));
        });
        document.getElementById('setting-font-up').addEventListener('click', () => {
            fontSlider.value = Math.min(22, parseInt(fontSlider.value) + 1);
            fontSlider.dispatchEvent(new Event('input'));
        });
        document.getElementById('setting-font-down').addEventListener('click', () => {
            fontSlider.value = Math.max(10, parseInt(fontSlider.value) - 1);
            fontSlider.dispatchEvent(new Event('input'));
        });

        document.getElementById('btn-apply-appearance').addEventListener('click', () => {
            const fontUrl = document.getElementById('setting-font-url').value.trim();
            if (fontUrl) {
                this._loadCustomFont(fontUrl);
                Components.toast('Custom font loaded.', 'info');
            }
        });
    },

    // --- Titlebar Buttons ---

    _bindTitlebar() {
        document.getElementById('btn-close').addEventListener('click', () => {
            if (confirm('Close HearME?')) {
                window.close();
            }
        });
        document.getElementById('btn-minimize').addEventListener('click', () => {
            document.getElementById('app-window').style.opacity = '0.5';
            Components.toast('Minimize not supported in browser. Close tab to exit.', 'info');
            setTimeout(() => {
                document.getElementById('app-window').style.opacity = '1';
            }, 2000);
        });
        document.getElementById('btn-maximize').addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen();
            }
        });
    },

    _bindMenus() {
        // --- Dropdown toggle: click menu button to open/close ---
        document.querySelectorAll('.menu-dropdown > .menu-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const dropdown = btn.parentElement;
                const wasOpen = dropdown.classList.contains('open');
                // Close all dropdowns
                document.querySelectorAll('.menu-dropdown.open').forEach(d => d.classList.remove('open'));
                // Toggle this one
                if (!wasOpen) dropdown.classList.add('open');
            });
        });

        // --- Click a dropdown item executes action ---
        document.querySelectorAll('.menu-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close all dropdowns
                document.querySelectorAll('.menu-dropdown.open').forEach(d => d.classList.remove('open'));
                const action = item.dataset.action;
                this._handleMenuAction(action);
            });
        });

        // --- Click anywhere outside closes dropdowns ---
        document.addEventListener('click', () => {
            document.querySelectorAll('.menu-dropdown.open').forEach(d => d.classList.remove('open'));
        });

        // --- About dialog ---
        document.getElementById('about-close').addEventListener('click', () => {
            document.getElementById('about-overlay').classList.add('hidden');
        });
        document.getElementById('about-ok').addEventListener('click', () => {
            document.getElementById('about-overlay').classList.add('hidden');
        });
        document.getElementById('about-overlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('about-overlay')) {
                document.getElementById('about-overlay').classList.add('hidden');
            }
        });
    },

    _handleMenuAction(action) {
        const settings = Store.getSettings();
        switch (action) {
            // --- File ---
            case 'export':
                document.getElementById('btn-export-artists').click();
                break;
            case 'import':
                document.getElementById('btn-import-artists').click();
                break;
            case 'exit':
                if (confirm('Close HearME?')) window.close();
                break;

            // --- View: Tab switching ---
            case 'tab-player':
                document.querySelector('button[data-tab="player"]').click();
                break;
            case 'tab-graph':
                document.querySelector('button[data-tab="graph"]').click();
                break;
            case 'tab-tours':
                document.querySelector('button[data-tab="tours"]').click();
                break;
            case 'tab-settings':
                document.querySelector('button[data-tab="settings"]').click();
                break;

            // --- View: Zoom ---
            case 'zoom-in': {
                const z = Math.min(2.0, (settings.uiZoom || 1.0) + 0.1);
                this._setZoom(Math.round(z * 10) / 10);
                break;
            }
            case 'zoom-out': {
                const z = Math.max(0.8, (settings.uiZoom || 1.0) - 0.1);
                this._setZoom(Math.round(z * 10) / 10);
                break;
            }
            case 'zoom-reset':
                this._setZoom(1.0);
                break;

            // --- Help ---
            case 'about':
                document.getElementById('about-overlay').classList.remove('hidden');
                break;
            case 'github':
                window.open('https://github.com/cpntodd/HearME', '_blank');
                break;
        }
    },

    // --- State Persistence ---

    _restoreState() {
        const artists = Store.getArtists();
        if (artists.length > 0) {
            artists.forEach(a => Graph.addNode(a));
        }
    },

    // --- Helpers ---

    _esc(s) {
        if (!s) return '';
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
