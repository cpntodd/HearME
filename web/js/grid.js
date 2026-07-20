// grid.js — Tour grid view management.
// Handles rendering the tour table, sorting, filtering, and offline caching.

const Grid = {
    tours: [],
    sortColumn: 'date',
    sortDirection: 'asc',
    genreFilter: '',
    countryFilter: '',

    init() {
        document.getElementById('btn-refresh-tours').addEventListener('click', () => this.refresh());
        document.getElementById('filter-genre').addEventListener('change', (e) => {
            this.genreFilter = e.target.value;
            this.render();
        });
        document.getElementById('filter-country').addEventListener('change', (e) => {
            this.countryFilter = e.target.value;
            this.render();
        });

        // Sortable headers
        document.querySelectorAll('.tour-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (this.sortColumn === col) {
                    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    this.sortColumn = col;
                    this.sortDirection = 'asc';
                }
                this._updateSortHeaders();
                this.render();
            });
        });

        // Load cached tours on init
        const cached = Store.getCachedTours();
        if (cached && cached.tours) {
            this.tours = cached.tours;
            this.render();
        }
    },

    async refresh() {
        const statusEl = document.getElementById('status-text');
        statusEl.textContent = 'Fetching tours...';

        // Get artists marked "show in tours"
        const artists = Store.getArtists().filter(a => a.showInTours);
        if (artists.length === 0) {
            this.tours = [];
            this.render();
            statusEl.textContent = 'No artists selected for tours.';
            return;
        }

        const names = artists.map(a => a.name);
        try {
            const data = await API.getTours(names);
            this.tours = data || [];
            Store.setCachedTours(this.tours);
            document.getElementById('tour-offline-warning').classList.add('hidden');
            statusEl.textContent = `Loaded ${this.tours.length} tours.`;
        } catch (err) {
            // Fall back to cached data
            const cached = Store.getCachedTours();
            if (cached && cached.tours) {
                this.tours = cached.tours;
                document.getElementById('tour-offline-warning').classList.remove('hidden');
                statusEl.textContent = `Using cached data (${err.message})`;
            } else {
                this.tours = [];
                statusEl.textContent = `Error: ${err.message}`;
            }
        }

        this.render();
    },

    render() {
        let filtered = [...this.tours];

        // Apply genre filter
        if (this.genreFilter) {
            const artists = Store.getArtists();
            const artistGenres = {};
            artists.forEach(a => { artistGenres[a.name.toLowerCase()] = a.genres || []; });
            filtered = filtered.filter(t => {
                const genres = artistGenres[t.artistName.toLowerCase()] || [];
                return genres.some(g => g.toLowerCase() === this.genreFilter.toLowerCase());
            });
        }

        // Apply country filter
        if (this.countryFilter) {
            filtered = filtered.filter(t => t.country === this.countryFilter);
        }

        // Sort
        filtered.sort((a, b) => {
            let va = a[this.sortColumn] || '';
            let vb = b[this.sortColumn] || '';
            if (this.sortColumn === 'date') {
                va = va || '9999';
                vb = vb || '9999';
            }
            const cmp = va < vb ? -1 : va > vb ? 1 : 0;
            return this.sortDirection === 'asc' ? cmp : -cmp;
        });

        // Update genre filter options
        this._updateGenreFilter();
        // Update country filter options
        this._updateCountryFilter();

        // Render table
        const tbody = document.getElementById('tour-table-body');
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr class="tour-empty"><td colspan="8">No tours to display. Select artists in the Graph Explorer and check "Show in Tour Grid".</td></tr>`;
        } else {
            tbody.innerHTML = filtered.map(t => {
                const owned = (typeof App !== 'undefined' && App.isArtistOwned && App.isArtistOwned(t.artistName))
                    ? '<span style="color:#22ff22" title="In your Jellyfin library">✓</span>' : '';
                return `
                <tr>
                    <td>${this._esc(t.artistName)}</td>
                    <td style="text-align:center">${owned}</td>
                    <td>${this._esc(t.tourName || '—')}</td>
                    <td>${this._formatDate(t.date)}</td>
                    <td>${this._esc(t.city)}</td>
                    <td>${this._esc(t.venue)}</td>
                    <td>${this._esc(t.country)}</td>
                    <td>${t.ticketUrl ? `<a href="${this._esc(t.ticketUrl)}" target="_blank" rel="noopener" class="ticket-link">Tickets 🎫</a>` : '—'}</td>
                </tr>
            `;
            }).join('');
        }

        document.getElementById('tour-count').textContent = `${filtered.length} tours`;
        const ts = Store.getCachedTourTimestamp();
        if (ts) {
            document.getElementById('tour-last-updated').textContent =
                `• Last updated: ${new Date(ts).toLocaleString()}`;
        }
    },

    _updateGenreFilter() {
        const select = document.getElementById('filter-genre');
        const artists = Store.getArtists().filter(a => a.showInTours);
        const genres = new Set();
        artists.forEach(a => (a.genres || []).forEach(g => genres.add(g)));
        const current = select.value;
        select.innerHTML = '<option value="">All</option>' +
            [...genres].sort().map(g => `<option value="${this._esc(g)}"${g === current ? ' selected' : ''}>${this._esc(g)}</option>`).join('');
    },

    _updateCountryFilter() {
        const select = document.getElementById('filter-country');
        const countries = new Set();
        this.tours.forEach(t => { if (t.country) countries.add(t.country); });
        const current = select.value;
        select.innerHTML = '<option value="">All</option>' +
            [...countries].sort().map(c => `<option value="${this._esc(c)}"${c === current ? ' selected' : ''}>${this._esc(c)}</option>`).join('');
    },

    _updateSortHeaders() {
        document.querySelectorAll('.tour-table th.sortable').forEach(th => {
            th.classList.remove('sorted-asc', 'sorted-desc');
            if (th.dataset.sort === this.sortColumn) {
                th.classList.add(this.sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
            }
        });
    },

    _formatDate(dateStr) {
        if (!dateStr) return '—';
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch {
            return dateStr;
        }
    },

    _esc(s) {
        if (!s) return '';
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    },
};
