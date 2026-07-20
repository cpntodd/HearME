// api.js — Frontend API client for the HearME backend.
// All third-party API calls are proxied through the Go server.

const API = {
    _base: '/api',

    async _fetch(path, options = {}) {
        try {
            const res = await fetch(this._base + path, {
                headers: { 'Content-Type': 'application/json', ...options.headers },
                ...options,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: res.statusText }));
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            return await res.json();
        } catch (err) {
            if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
                throw new Error('Server unreachable. Is HearME running?');
            }
            throw err;
        }
    },

    // Health check
    async health() {
        return this._fetch('/health');
    },

    // Get tours for a list of artist names
    async getTours(artistNames) {
        return this._fetch('/tours', {
            method: 'POST',
            body: JSON.stringify({ artists: artistNames }),
        });
    },

    // Get artist metadata (genres, bio, image)
    async getArtist(name) {
        return this._fetch('/artists/' + encodeURIComponent(name));
    },

    // Expand graph: get related artists for a given artist
    async expandGraph(name) {
        return this._fetch('/graph/expand/' + encodeURIComponent(name));
    },
};
