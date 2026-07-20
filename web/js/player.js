// player.js — Audio player with Web Audio API, visualizer, VFD, VU meter.
// Integrates with Jellyfin for media sources.

const Player = {
    audioCtx: null,
    sourceNode: null,
    analyser: null,
    gainNode: null,
    splitter: null,
    currentTrack: null,
    playlist: [],
    playlistIndex: -1,
    isPlaying: false,
    shuffle: false,
    repeat: 'off', // 'off', 'one', 'all'
    preset: 'spectrum',
    animFrame: null,

    // VFD state
    vfdText: 'HEARME  READY',
    vfdScroll: 0,

    init() {
        document.getElementById('btn-play').addEventListener('click', () => this.togglePlay());
        document.getElementById('btn-prev').addEventListener('click', () => this.prev());
        document.getElementById('btn-next').addEventListener('click', () => this.next());
        document.getElementById('btn-shuffle').addEventListener('click', () => {
            this.shuffle = !this.shuffle;
            document.getElementById('btn-shuffle').style.color = this.shuffle ? 'var(--green)' : '';
        });
        document.getElementById('btn-repeat').addEventListener('click', () => {
            const states = ['off', 'all', 'one'];
            const idx = (states.indexOf(this.repeat) + 1) % 3;
            this.repeat = states[idx];
            const btn = document.getElementById('btn-repeat');
            btn.textContent = this.repeat === 'one' ? '🔂' : '🔁';
            btn.style.color = this.repeat !== 'off' ? 'var(--green)' : '';
        });

        const seek = document.getElementById('player-seek');
        seek.addEventListener('input', () => {
            if (this.audioCtx && this.currentTrack) {
                // Seeking not directly supported with MediaElementSource; will use audio element
            }
        });

        const volume = document.getElementById('player-volume');
        volume.addEventListener('input', () => {
            if (this.gainNode) {
                this.gainNode.gain.value = volume.value / 100;
            }
        });

        // Visualizer presets
        document.querySelectorAll('#view-player .detail-filter-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('#view-player .detail-filter-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.preset = tab.dataset.preset;
            });
        });

        // Start VFD + VU render loop
        this._renderDisplays();
    },

    async loadTrack(url, metadata) {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 2048;
            this.gainNode = this.audioCtx.createGain();
            this.gainNode.connect(this.audioCtx.destination);
            this.gainNode.gain.value = document.getElementById('player-volume').value / 100;

            // Channel splitter for VU meter
            this.splitter = this.audioCtx.createChannelSplitter(2);
            this.analyserL = this.audioCtx.createAnalyser();
            this.analyserR = this.audioCtx.createAnalyser();
            this.analyserL.fftSize = 256;
            this.analyserR.fftSize = 256;
        }

        // Stop current playback
        this.stop();

        try {
            const audioEl = new Audio();
            audioEl.crossOrigin = 'anonymous';
            audioEl.src = url;
            this.sourceNode = this.audioCtx.createMediaElementSource(audioEl);
            this.sourceNode.connect(this.analyser);
            this.analyser.connect(this.gainNode);

            // Split for VU
            this.sourceNode.connect(this.splitter);
            this.splitter.connect(this.analyserL, 0);
            this.splitter.connect(this.analyserR, 1);

            this.audioEl = audioEl;
            this.currentTrack = { url, ...metadata };

            // Update UI
            document.getElementById('player-track-title').textContent = metadata.title || 'Unknown';
            document.getElementById('player-track-artist').textContent = metadata.artist || '—';
            document.getElementById('player-track-album').textContent = metadata.album || '—';
            document.getElementById('player-album-art').src = metadata.artUrl || '';
            document.getElementById('player-time-total').textContent = '—:—';

            audioEl.addEventListener('loadedmetadata', () => {
                document.getElementById('player-seek').max = Math.floor(audioEl.duration);
                document.getElementById('player-time-total').textContent = this._fmtTime(audioEl.duration);
            });
            audioEl.addEventListener('timeupdate', () => {
                document.getElementById('player-seek').value = Math.floor(audioEl.currentTime);
                document.getElementById('player-time-current').textContent = this._fmtTime(audioEl.currentTime);
            });
            audioEl.addEventListener('ended', () => this._onEnded());
            audioEl.addEventListener('error', () => this._onError());

            await audioEl.play();
            this.isPlaying = true;
            document.getElementById('btn-play').textContent = '⏸';
            this.vfdText = 'NOW PLAYING';
            this._startVisualizer();
        } catch (err) {
            console.error('Playback error:', err);
            this.isPlaying = false;
        }
    },

    togglePlay() {
        if (!this.audioEl) return;
        if (this.isPlaying) {
            this.audioEl.pause();
            this.isPlaying = false;
            document.getElementById('btn-play').textContent = '▶';
            this.vfdText = 'PAUSED';
        } else {
            this.audioEl.play();
            this.isPlaying = true;
            document.getElementById('btn-play').textContent = '⏸';
            this.vfdText = 'NOW PLAYING';
            this._startVisualizer();
        }
    },

    stop() {
        if (this.audioEl) {
            this.audioEl.pause();
            this.audioEl.src = '';
        }
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }
        this.isPlaying = false;
        document.getElementById('btn-play').textContent = '▶';
        cancelAnimationFrame(this.animFrame);
    },

    next() { this._navigate(1); },
    prev() { this._navigate(-1); },

    _navigate(dir) {
        if (this.playlist.length === 0) return;
        if (this.shuffle) {
            this.playlistIndex = Math.floor(Math.random() * this.playlist.length);
        } else {
            this.playlistIndex = (this.playlistIndex + dir + this.playlist.length) % this.playlist.length;
        }
        const track = this.playlist[this.playlistIndex];
        this.loadTrack(track.url, track);
        this._updatePlaylistUI();
    },

    _onEnded() {
        if (this.repeat === 'one') {
            this.audioEl.currentTime = 0;
            this.audioEl.play();
        } else if (this.repeat === 'all' || this.playlistIndex < this.playlist.length - 1) {
            this.next();
        } else {
            this.stop();
        }
    },

    _onError() {
        this.stop();
        this.vfdText = 'ERROR';
    },

    addToPlaylist(tracks) {
        this.playlist = this.playlist.concat(tracks);
        if (this.playlistIndex < 0) this.playlistIndex = 0;
        this._updatePlaylistUI();
    },

    clearPlaylist() {
        this.playlist = [];
        this.playlistIndex = -1;
        this.stop();
        this._updatePlaylistUI();
    },

    _updatePlaylistUI() {
        const el = document.getElementById('player-playlist');
        if (this.playlist.length === 0) {
            el.innerHTML = '<div class="player-playlist-empty">Queue is empty.<br>Browse Jellyfin to add tracks.</div>';
            return;
        }
        el.innerHTML = this.playlist.map((t, i) => `
            <div class="player-playlist-track${i === this.playlistIndex ? ' active' : ''}" data-index="${i}">
                ${i+1}. ${t.artist || '?'} — ${t.title || '?'}
            </div>
        `).join('');
        el.querySelectorAll('.player-playlist-track').forEach(trk => {
            trk.addEventListener('click', () => {
                this.playlistIndex = parseInt(trk.dataset.index);
                this.loadTrack(this.playlist[this.playlistIndex].url, this.playlist[this.playlistIndex]);
                this._updatePlaylistUI();
            });
        });
    },

    // --- Visualizer ---

    _startVisualizer() {
        cancelAnimationFrame(this.animFrame);
        const canvas = document.getElementById('player-visualizer');
        const ctx = canvas.getContext('2d');
        const analyser = this.analyser;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const resize = () => {
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
        };
        resize();
        window.addEventListener('resize', resize);

        const render = () => {
            this.animFrame = requestAnimationFrame(render);
            analyser.getByteFrequencyData(dataArray);
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, w, h);

            switch (this.preset) {
                case 'spectrum': this._drawSpectrum(ctx, dataArray, w, h, bufferLength); break;
                case 'oscilloscope': this._drawOscilloscope(ctx, w, h); break;
                case 'circular': this._drawCircular(ctx, dataArray, w, h, bufferLength); break;
                case 'particles': this._drawParticles(ctx, dataArray, w, h, bufferLength); break;
                case 'fire': this._drawFire(ctx, dataArray, w, h, bufferLength); break;
                case 'bars': this._drawBarsBeads(ctx, dataArray, w, h, bufferLength); break;
            }
        };
        render();
    },

    _drawSpectrum(ctx, data, w, h, n) {
        const barW = w / 64;
        for (let i = 0; i < 64; i++) {
            const val = data[Math.floor(i * n / 64)] / 255;
            const barH = val * h * 0.8;
            const x = i * barW;
            const hue = (i / 64) * 300;
            ctx.fillStyle = `hsl(${hue}, 80%, ${30 + val * 40}%)`;
            ctx.fillRect(x, h - barH, barW - 1, barH);
            // Peak dot
            ctx.fillStyle = `hsl(${hue}, 100%, 80%)`;
            ctx.fillRect(x, h - barH - 2, barW - 1, 2);
        }
    },

    _drawOscilloscope(ctx, w, h) {
        const data = new Uint8Array(this.analyser.fftSize);
        this.analyser.getByteTimeDomainData(data);
        ctx.beginPath();
        ctx.strokeStyle = '#22ff22';
        ctx.lineWidth = 1.5;
        const slice = w / data.length;
        let x = 0;
        for (let i = 0; i < data.length; i++) {
            const v = data[i] / 128.0;
            const y = v * h / 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            x += slice;
        }
        ctx.stroke();
    },

    _drawCircular(ctx, data, w, h, n) {
        const cx = w / 2, cy = h / 2;
        const maxR = Math.min(w, h) / 2 - 10;
        for (let ring = 3; ring >= 0; ring--) {
            ctx.beginPath();
            const r = maxR * (ring + 1) / 4;
            const points = 64;
            for (let i = 0; i <= points; i++) {
                const angle = (i / points) * Math.PI * 2;
                const idx = Math.floor(i * n / points);
                const val = data[idx % n] / 255;
                const rr = r + val * 15 * (ring + 1);
                const x = cx + Math.cos(angle) * rr;
                const y = cy + Math.sin(angle) * rr;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.strokeStyle = `hsl(${ring * 80}, 70%, 50%)`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    },

    _drawParticles(ctx, data, w, h, n) {
        if (!this._particles) this._particles = Array.from({length: 80}, () => ({ x: Math.random()*w, y: Math.random()*h, vx: 0, vy: 0 }));
        const bass = data.slice(0, 10).reduce((a,b) => a+b, 0) / 2550;
        for (const p of this._particles) {
            p.vx += (Math.random() - 0.5) * bass * 3;
            p.vy += (Math.random() - 0.5) * bass * 3;
            p.x += p.vx; p.y += p.vy;
            p.vx *= 0.95; p.vy *= 0.95;
            if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
            if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
            ctx.fillStyle = `hsl(${bass * 200}, 80%, ${40 + bass * 30}%)`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.5 + bass * 2, 0, Math.PI * 2);
            ctx.fill();
        }
    },

    _drawFire(ctx, data, w, h, n) {
        const bass = data.slice(0, 20).reduce((a,b) => a+b, 0) / (255 * 20);
        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, `hsl(${10 + bass * 30}, 100%, ${20 + bass * 30}%)`);
        grad.addColorStop(0.5, `hsl(${25}, 100%, ${40 + bass * 40}%)`);
        grad.addColorStop(1, `hsl(${50}, 100%, ${60 + bass * 30}%)`);
        ctx.fillStyle = grad;
        const cols = 40;
        const colW = w / cols;
        for (let i = 0; i < cols; i++) {
            const idx = Math.floor(i * n / cols);
            const val = data[idx % n] / 255;
            const flameH = h * (0.2 + val * 0.8 + Math.sin(Date.now()*0.005 + i*0.5) * 0.15);
            ctx.fillRect(i * colW, h - flameH, colW, flameH);
        }
    },

    _drawBarsBeads(ctx, data, w, h, n) {
        for (let i = 0; i < 32; i++) {
            const val = data[Math.floor(i * n / 32)] / 255;
            const x = i * (w / 32);
            const barH = val * h * 0.6;
            ctx.fillStyle = `hsl(${i * 10}, 70%, 50%)`;
            ctx.fillRect(x + 2, h - barH - 10, w/32 - 4, barH);
            // Falling beads
            if (!this._beads) this._beads = [];
            if (Math.random() < val * 0.3) {
                this._beads.push({ x: x + w/64, y: h - barH - 10, vy: 1 + val * 3 });
            }
        }
        if (this._beads) {
            this._beads = this._beads.filter(b => b.y < h);
            for (const b of this._beads || []) {
                b.y += b.vy;
                ctx.fillStyle = '#22ff22';
                ctx.beginPath();
                ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    },

    // --- VFD + VU Meter ---

    _renderDisplays() {
        const render = () => {
            this._drawVFD();
            this._drawVU();
            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
    },

    _drawVFD() {
        const canvas = document.getElementById('player-vfd');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        ctx.fillStyle = '#0a1a0a';
        ctx.fillRect(0, 0, w, h);

        // Scrolling text
        this.vfdScroll = (this.vfdScroll + 1) % (w + this.vfdText.length * 14);
        const colW = 12;
        const rowH = 16;
        const charsPerRow = Math.floor(w / colW);
        let displayText = this.vfdText;

        // Add track info if playing
        if (this.isPlaying && this.currentTrack) {
            displayText += '  ' + (this.currentTrack.artist || '') + ' - ' + (this.currentTrack.title || '');
        }

        ctx.fillStyle = '#22ff44';
        ctx.font = 'bold 18px monospace';
        for (let i = 0; i < Math.min(displayText.length, charsPerRow + 2); i++) {
            const charIdx = (i + Math.floor(this.vfdScroll / colW)) % displayText.length;
            if (charIdx < displayText.length) {
                const char = displayText[charIdx];
                const x = i * colW - (this.vfdScroll % colW);
                if (x > -colW && x < w) {
                    // Simple VFD dot-matrix style
                    ctx.fillStyle = '#22ff44';
                    ctx.font = 'bold 16px monospace';
                    ctx.fillText(char, x, h - 8);
                }
            }
        }

        // Bitrate/time display on right side
        if (this.audioEl && this.audioEl.duration) {
            ctx.fillStyle = '#22ff44';
            ctx.font = 'bold 12px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(this._fmtTime(this.audioEl.currentTime), w - 4, h - 8);
            ctx.textAlign = 'left';
        }
    },

    _drawVU() {
        const drawMeter = (canvasId, analyser) => {
            const canvas = document.getElementById(canvasId);
            if (!canvas || !analyser) return;
            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteTimeDomainData(data);

            // Compute RMS level
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
                const v = (data[i] - 128) / 128;
                sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length);
            const db = rms > 0.001 ? 20 * Math.log10(rms) : -60;

            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, 0, w, h);

            // dB scale background
            const dbMin = -60, dbMax = 3;
            const dbRange = dbMax - dbMin;
            for (let d = dbMin; d <= dbMax; d += 3) {
                const y = h - ((d - dbMin) / dbRange) * h;
                ctx.fillStyle = d > 0 ? '#400' : '#333';
                ctx.fillRect(0, y, w, 1);
                ctx.fillStyle = '#666';
                ctx.font = '7px monospace';
                ctx.fillText(d.toString(), 2, y - 1);
            }

            // Needle
            const needleY = h - ((Math.max(dbMin, Math.min(dbMax, db)) - dbMin) / dbRange) * h;
            ctx.strokeStyle = '#ff4444';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(4, h - 4);
            ctx.lineTo(w - 4, needleY);
            ctx.stroke();

            // Peak hold
            const peakY = Math.min(needleY, this._vuPeak || h);
            this._vuPeak = Math.min(needleY, (this._vuPeak || h) + 0.3);
            ctx.fillStyle = '#ff4444';
            ctx.fillRect(0, peakY, w, 1);
        };

        drawMeter('player-vu-left', this.analyserL);
        drawMeter('player-vu-right', this.analyserR);
    },

    _vuPeak: 0,

    _fmtTime(secs) {
        if (!secs || !isFinite(secs)) return '0:00';
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    },
};
