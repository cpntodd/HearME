// store.js — localStorage-based persistence for artist list and cached tours.
// All data lives in the browser. No server-side storage needed.

const Store = {
    _prefix: 'hearme_',

    // --- Artist List ---

    getArtists() {
        try {
            const raw = localStorage.getItem(this._prefix + 'artists');
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    },

    setArtists(artists) {
        localStorage.setItem(this._prefix + 'artists', JSON.stringify(artists));
    },

    addArtist(artist) {
        const artists = this.getArtists();
        // Don't add duplicates by ID or name (case-insensitive)
        const exists = artists.some(a =>
            (artist.id && a.id === artist.id) ||
            a.name.toLowerCase() === artist.name.toLowerCase()
        );
        if (!exists) {
            artists.push(artist);
            this.setArtists(artists);
        }
        return artists;
    },

    removeArtist(artistId) {
        let artists = this.getArtists();
        artists = artists.filter(a => a.id !== artistId && a.name !== artistId);
        this.setArtists(artists);
        return artists;
    },

    toggleShowInTours(artistId, show) {
        const artists = this.getArtists();
        const artist = artists.find(a => a.id === artistId || a.name === artistId);
        if (artist) {
            artist.showInTours = show;
            this.setArtists(artists);
        }
        return artists;
    },

    // --- Cached Tours ---

    getCachedTours() {
        try {
            const raw = localStorage.getItem(this._prefix + 'cached_tours');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    },

    setCachedTours(tours) {
        const cache = {
            tours: tours,
            timestamp: new Date().toISOString(),
        };
        localStorage.setItem(this._prefix + 'cached_tours', JSON.stringify(cache));
    },

    getCachedTourTimestamp() {
        const cache = this.getCachedTours();
        return cache ? cache.timestamp : null;
    },

    // --- Graph State ---

    getGraphState() {
        try {
            const raw = localStorage.getItem(this._prefix + 'graph_state');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    },

    setGraphState(state) {
        localStorage.setItem(this._prefix + 'graph_state', JSON.stringify(state));
    },

    // --- Settings ---

    getSettings() {
        try {
            const raw = localStorage.getItem(this._prefix + 'settings');
            return raw ? JSON.parse(raw) : {
                scraperEnabled: true,
                lastfmEnabled: false,
                uiZoom: 1.0,
                fontSize: 12,
                fontUrl: '',
            };
        } catch {
            return { scraperEnabled: true, lastfmEnabled: false, uiZoom: 1.0, fontSize: 12, fontUrl: '' };
        }
    },

    setSettings(settings) {
        localStorage.setItem(this._prefix + 'settings', JSON.stringify(settings));
    },

    // --- Export / Import ---

    exportAll() {
        return {
            artists: this.getArtists(),
            settings: this.getSettings(),
            exportedAt: new Date().toISOString(),
        };
    },

    importAll(data) {
        if (data.artists) this.setArtists(data.artists);
        if (data.settings) this.setSettings(data.settings);
    },

    // --- Reset ---

    resetAll() {
        localStorage.removeItem(this._prefix + 'artists');
        localStorage.removeItem(this._prefix + 'cached_tours');
        localStorage.removeItem(this._prefix + 'graph_state');
        localStorage.removeItem(this._prefix + 'settings');
    },
};
