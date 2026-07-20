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
    _seeking: false,
    _vol: 0.8,
    _balance: 0,
    _eqGains: [0,0,0,0,0,0,0,0,0,0],
    _loading: false,

    // Library state
    _libView: 'artists', // 'artists', 'albums', 'tracks'
    _libParentId: null,
    _libParentName: '',

    // VFD state
    vfdText: 'HEARME  READY',
    vfdScroll: 0,

    init() {
        document.getElementById('btn-play').addEventListener('click', () => this.togglePlay());
        document.getElementById('btn-stop').addEventListener('click', () => this.stop());
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

        // Seek bar — seek via audio element
        const seek = document.getElementById('player-seek');
        seek.addEventListener('input', () => {
            if (this.audioEl) {
                this.audioEl.currentTime = parseFloat(seek.value);
            }
        });

        // Volume
        const volume = document.getElementById('player-volume');
        volume.addEventListener('input', () => {
            this._vol = volume.value / 100;
            if (this.gainNode) this.gainNode.gain.value = this._vol;
        });

        // Balance
        const balance = document.getElementById('player-balance');
        balance.addEventListener('input', () => {
            this._balance = parseInt(balance.value) / 100;
            this._applyBalance();
        });

        // Equalizer
        this._buildEQ();
        document.getElementById('player-eq-preset').addEventListener('change', (e) => {
            this._applyEQPreset(e.target.value);
        });
        document.getElementById('btn-eq-toggle').addEventListener('click', () => {
            const bands = document.getElementById('player-eq-bands');
            bands.style.display = bands.style.display === 'none' ? 'flex' : 'none';
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

        // Library panel
        this._initLibrary();

        // Right panel resize grip
        this._initResizeGrip();
    },

    _initResizeGrip() {
        const grip = document.getElementById('player-resize-grip');
        const panel = document.getElementById('player-right-panel');
        if (!grip || !panel) return;
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
            const dx = startX - e.clientX; // leftward = wider
            const newWidth = Math.min(480, Math.max(140, startWidth + dx));
            panel.style.width = newWidth + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                grip.classList.remove('active');
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
                // Save preference
                if (panel.style.width) {
                    const settings = JSON.parse(localStorage.getItem('hearme_settings') || '{}');
                    settings.playerPanelWidth = panel.style.width;
                    localStorage.setItem('hearme_settings', JSON.stringify(settings));
                }
            }
        });

        // Restore saved width
        try {
            const settings = JSON.parse(localStorage.getItem('hearme_settings') || '{}');
            if (settings.playerPanelWidth) {
                panel.style.width = settings.playerPanelWidth;
            }
        } catch {}
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

        // Clean up previous source without full stop (don't kill audioCtx)
        if (this.sourceNode) {
            try { this.sourceNode.disconnect(); } catch(e) {}
            this.sourceNode = null;
        }
        if (this.audioEl) {
            try { this.audioEl.pause(); } catch(e) {}
            this.audioEl.src = '';
            this.audioEl = null;
        }
        cancelAnimationFrame(this.animFrame);

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
                // Metadata display
                this._updateMetaDisplay(audioEl);
            });
            audioEl.addEventListener('timeupdate', () => {
                if (!this._seeking) {
                    document.getElementById('player-seek').value = Math.floor(audioEl.currentTime);
                }
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
            // If AbortError, it means stop() was called — don't treat as error
            if (err.name === 'AbortError') return;
            this.isPlaying = false;
            this.vfdText = 'ERROR';
            document.getElementById('btn-play').textContent = '▶';
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
        this.isPlaying = false;
        document.getElementById('btn-play').textContent = '▶';
        if (this.audioEl) {
            try { this.audioEl.pause(); } catch(e) {}
            this.audioEl.currentTime = 0;
        }
        // Don't clear audioEl.src or nullify — allows resume via play button
        document.getElementById('player-seek').value = 0;
        document.getElementById('player-time-current').textContent = '0:00';
        cancelAnimationFrame(this.animFrame);
        this.vfdText = 'STOPPED';
    },

    next() { this._navigate(1); },
    prev() { this._navigate(-1); },

    _navigate(dir) {
        if (this.playlist.length === 0 || this._loading) return;
        this._loading = true;
        if (this.shuffle) {
            this.playlistIndex = Math.floor(Math.random() * this.playlist.length);
        } else {
            this.playlistIndex = (this.playlistIndex + dir + this.playlist.length) % this.playlist.length;
        }
        const track = this.playlist[this.playlistIndex];
        this.loadTrack(track.url, track).finally(() => {
            this._loading = false;
            this._updatePlaylistUI();
        });
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
        const drawMeter = (canvasId, analyser, peakRef) => {
            const canvas = document.getElementById(canvasId);
            if (!canvas || !analyser) return;
            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;

            // Use fftSize for getByteTimeDomainData buffer (must match analyser setup)
            const bufferLen = analyser.fftSize;
            const data = new Uint8Array(bufferLen);
            analyser.getByteTimeDomainData(data);

            // Compute RMS level from time-domain samples
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
                const v = (data[i] - 128) / 128; // normalize to [-1, 1]
                sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length);
            // Convert to dB, floor at -60
            const db = rms > 0.00001 ? 20 * Math.log10(rms) : -60;

            // Background
            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, 0, w, h);

            // dB scale: -60 to +3, teal gradient background
            const dbMin = -60, dbMax = 3;
            const dbRange = dbMax - dbMin;
            for (let d = dbMin; d <= dbMax; d += 6) {
                const y = h - ((d - dbMin) / dbRange) * h;
                // Red zone above 0dB
                ctx.fillStyle = d >= 0 ? 'rgba(255,60,60,0.2)' : 'rgba(0,200,220,0.08)';
                ctx.fillRect(0, y - 1, w, 3);
                ctx.fillStyle = d >= 0 ? '#f55' : '#555';
                ctx.font = '7px monospace';
                ctx.textAlign = 'left';
                ctx.fillText(d.toString(), 2, y + 2);
            }

            // Colored bar (teal gradient, turns yellow/orange/red as level increases)
            const normalizedDb = (db - dbMin) / dbRange;
            const barH = normalizedDb * h;
            const barColor = normalizedDb > 0.85 ? '#ff4444' :  // red zone
                             normalizedDb > 0.7  ? '#ffaa00' :  // orange
                             normalizedDb > 0.5  ? '#ffee00' :  // yellow
                             '#00e5ff';                           // teal
            ctx.fillStyle = barColor;
            ctx.fillRect(1, h - barH, w - 2, barH);

            // Peak hold dot (decays slowly)
            const peakDb = Math.max(db, (peakRef.val || -60) - 0.15);
            peakRef.val = peakDb;
            const peakY = h - ((peakDb - dbMin) / dbRange) * h;
            ctx.fillStyle = normalizedDb > 0.85 ? '#ff0000' : '#ffffff';
            ctx.fillRect(1, Math.max(0, peakY - 1), w - 2, 2);
        };

        drawMeter('player-vu-left', this.analyserL, this._vuPeakL);
        drawMeter('player-vu-right', this.analyserR, this._vuPeakR);
    },

    _vuPeakL: { val: -60 },
    _vuPeakR: { val: -60 },

    _fmtTime(secs) {
        if (!secs || !isFinite(secs)) return '0:00';
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    },

    // --- Metadata display ---
    _updateMetaDisplay(audioEl) {
        // Try to get bitrate from the audio element or MediaSource
        let kbps = '—';
        let kHz = '—';
        if (audioEl.audioTracks && audioEl.audioTracks.length > 0) {
            // Not widely supported
        }
        // Use webkitAudioDecodedByteCount as a rough measure
        if (audioEl.duration && audioEl.duration > 0) {
            // Bitrate estimate from file size isn't available via JS
        }
        // If we have a web audio context, we can check sample rate
        if (this.audioCtx) {
            kHz = (this.audioCtx.sampleRate / 1000).toFixed(1);
        }
        document.getElementById('player-meta-info').textContent =
            `${kbps} kbps · ${kHz} kHz`;
    },

    // --- Balance ---
    _applyBalance() {
        // Balance is applied via a stereo panner if available, otherwise gain split
        if (!this.audioCtx) return;
        if (!this._panner) {
            this._panner = this.audioCtx.createStereoPanner();
        }
        this._panner.pan.value = this._balance || 0;
    },

    // --- Equalizer ---
    _eqBands: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
    _eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    _eqFilters: [],

    _buildEQ() {
        const container = document.getElementById('player-eq-bands');
        container.innerHTML = '';
        this._eqBands.forEach((freq, i) => {
            const band = document.createElement('div');
            band.className = 'player-eq-band';
            const val = document.createElement('span');
            val.className = 'player-eq-val';
            val.textContent = '0dB';
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'player-eq-slider';
            slider.min = -12;
            slider.max = 12;
            slider.value = 0;
            slider.step = 1;
            slider.title = freq >= 1000 ? (freq/1000)+'kHz' : freq+'Hz';
            slider.addEventListener('input', () => {
                this._eqGains[i] = parseInt(slider.value);
                val.textContent = (this._eqGains[i] > 0 ? '+' : '') + this._eqGains[i] + 'dB';
                document.getElementById('player-eq-preset').value = '';
                this._updateEQFilters();
            });
            const label = document.createElement('span');
            label.className = 'player-eq-label';
            label.textContent = freq >= 1000 ? (freq/1000)+'k' : freq;
            band.appendChild(val);
            band.appendChild(slider);
            band.appendChild(label);
            container.appendChild(band);
        });
    },

    _updateEQFilters() {
        if (!this.audioCtx) return;
        // Remove old filters
        this._eqFilters.forEach(f => { try { f.disconnect(); } catch(e) {} });
        this._eqFilters = [];

        if (this._eqGains.every(g => g === 0)) return; // no EQ applied

        // Rebuild audio graph with EQ: source -> eq filters -> analyser -> gain
        if (this.sourceNode && this.analyser && this.gainNode) {
            // Disconnect source
            this.sourceNode.disconnect();
            this.splitter && this.sourceNode.disconnect();

            let prevNode = this.sourceNode;
            this._eqBands.forEach((freq, i) => {
                const filter = this.audioCtx.createBiquadFilter();
                filter.type = 'peaking';
                filter.frequency.value = freq;
                filter.Q.value = 1.0;
                filter.gain.value = this._eqGains[i];
                prevNode.connect(filter);
                prevNode = filter;
                this._eqFilters.push(filter);
            });

            // Connect through EQ to analyser and gain
            prevNode.connect(this.analyser);
            this.analyser.connect(this.gainNode);
            // Reconnect splitter
            if (this.splitter) {
                prevNode.connect(this.splitter);
                this.splitter.connect(this.analyserL, 0);
                this.splitter.connect(this.analyserR, 1);
            }
        }
    },

    _applyEQPreset(preset) {
        const presets = {
            rock:       [5, 4, 2, 0, -2, -1, 2, 4, 5, 5],
            pop:        [-1, 0, 2, 4, 3, 0, -1, -1, 0, 0],
            classical:  [5, 4, 3, 1, -1, -2, 0, 1, 3, 5],
            jazz:       [4, 3, 1, 1, 0, 0, 1, 2, 3, 3],
            electronic: [6, 5, 0, -2, -4, 0, 2, 4, 5, 5],
            hiphop:     [5, 5, 3, 0, 0, 1, 2, 3, 3, 3],
            metal:      [5, 5, 2, -2, -3, 0, 3, 5, 5, 5],
            flat:       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            vocal:      [-2, -2, -1, 2, 5, 3, 1, 0, -1, -2],
            bass:       [6, 6, 5, 3, 1, 0, 0, 0, 0, 0],
        };

        const gains = presets[preset];
        if (!gains) return;

        this._eqGains = gains;
        const sliders = document.querySelectorAll('.player-eq-slider');
        const vals = document.querySelectorAll('.player-eq-val');
        gains.forEach((g, i) => {
            if (sliders[i]) sliders[i].value = g;
            if (vals[i]) vals[i].textContent = (g > 0 ? '+' : '') + g + 'dB';
        });
        this._updateEQFilters();
    },

    // ====================================================================
    //  Media Library Browser
    // ====================================================================

    _initLibrary() {
        // Right panel tab switching
        document.querySelectorAll('.player-right-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.player-right-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const panelId = 'panel-' + tab.dataset.panel;
                document.querySelectorAll('.player-right-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(panelId).classList.add('active');
                if (tab.dataset.panel === 'library') {
                    this._loadLibrary();
                }
            });
        });

        // Back button
        document.getElementById('lib-back').addEventListener('click', () => this._libGoBack());

        // Search filter
        document.getElementById('lib-search').addEventListener('input', (e) => {
            this._libFilter(e.target.value);
        });
    },

    async _loadLibrary() {
        if (this._libView === 'artists' && !this._libArtistsCache) {
            await this._loadArtists();
        }
    },

    _libGoBack() {
        if (this._libView === 'albums') {
            this._libView = 'artists';
            this._libParentId = null;
            this._libParentName = '';
            document.getElementById('lib-breadcrumb').textContent = 'All Artists';
            this._renderLibrary();
        } else if (this._libView === 'tracks') {
            this._libView = 'albums';
            document.getElementById('lib-breadcrumb').textContent = this._libParentName;
            this._renderAlbums(this._libAlbumsCache || []);
        }
    },

    _libFilter(query) {
        const q = query.toLowerCase();
        const cards = document.querySelectorAll('.library-card');
        const tracks = document.querySelectorAll('.library-track');
        cards.forEach(c => {
            const name = (c.querySelector('.library-card-name')?.textContent || '').toLowerCase();
            const sub = (c.querySelector('.library-card-sub')?.textContent || '').toLowerCase();
            c.style.display = (!q || name.includes(q) || sub.includes(q)) ? '' : 'none';
        });
        tracks.forEach(t => {
            const title = (t.querySelector('.library-track-title')?.textContent || '').toLowerCase();
            t.style.display = (!q || title.includes(q)) ? '' : 'none';
        });
    },

    async _loadArtists() {
        const content = document.getElementById('lib-content');
        content.innerHTML = '<div class="library-loading">Loading artists...</div>';
        try {
            const resp = await fetch('/api/jellyfin/library/artists');
            if (!resp.ok) throw new Error('Failed to load artists');
            const data = await resp.json();
            this._libArtistsCache = data;
            this._renderArtists(data);
        } catch (err) {
            content.innerHTML = '<div class="library-loading" style="color:var(--error)">⚠ Failed to load artists.<br>Check Jellyfin connection.</div>';
        }
    },

    async _loadAlbums(artistId, artistName) {
        const content = document.getElementById('lib-content');
        content.innerHTML = '<div class="library-loading">Loading albums...</div>';
        try {
            const url = '/api/jellyfin/library/albums' + (artistId ? '?artistId=' + artistId : '');
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('Failed to load albums');
            const data = await resp.json();
            this._libAlbumsCache = data;
            this._libView = 'albums';
            this._libParentId = artistId;
            this._libParentName = artistName;
            document.getElementById('lib-breadcrumb').textContent = artistName;
            this._renderAlbums(data);
        } catch (err) {
            content.innerHTML = '<div class="library-loading" style="color:var(--error)">⚠ Failed to load albums.</div>';
        }
    },

    async _loadTracks(albumId, albumName) {
        const content = document.getElementById('lib-content');
        content.innerHTML = '<div class="library-loading">Loading tracks...</div>';
        try {
            const resp = await fetch('/api/jellyfin/library/tracks?albumId=' + albumId);
            if (!resp.ok) throw new Error('Failed to load tracks');
            const data = await resp.json();
            this._libView = 'tracks';
            document.getElementById('lib-breadcrumb').textContent = albumName;
            this._renderTracks(data);
        } catch (err) {
            content.innerHTML = '<div class="library-loading" style="color:var(--error)">⚠ Failed to load tracks.</div>';
        }
    },

    _renderLibrary() {
        if (this._libView === 'artists') {
            this._renderArtists(this._libArtistsCache || []);
        } else if (this._libView === 'albums') {
            this._renderAlbums(this._libAlbumsCache || []);
        }
    },

    _renderArtists(data) {
        const content = document.getElementById('lib-content');
        if (!data.length) {
            content.innerHTML = '<div class="library-loading">No artists found.</div>';
            return;
        }
        let html = '<div class="library-grid">';
        data.forEach(a => {
            const img = a.imageUrl
                ? `<img class="library-card-img" src="${a.imageUrl}" alt="" loading="lazy" onerror="this.textContent='🎤'">`
                : '<span class="library-card-img">🎤</span>';
            html += `<div class="library-card" data-id="${a.id}" data-name="${a.name}" data-type="artist">
                ${img}
                <div class="library-card-name">${this._esc(a.name)}</div>
                <div class="library-card-sub">Artist</div>
            </div>`;
        });
        html += '</div>';
        content.innerHTML = html;
        content.querySelectorAll('.library-card').forEach(card => {
            card.addEventListener('click', () => {
                this._loadAlbums(card.dataset.id, card.dataset.name);
            });
        });
    },

    _renderAlbums(data) {
        const content = document.getElementById('lib-content');
        if (!data.length) {
            content.innerHTML = '<div class="library-loading">No albums found.</div>';
            return;
        }
        let html = '<div class="library-grid">';
        data.forEach(a => {
            const img = a.imageUrl
                ? `<img class="library-card-img" src="${a.imageUrl}" alt="" loading="lazy" onerror="this.textContent='💿'">`
                : '<span class="library-card-img">💿</span>';
            html += `<div class="library-card" data-id="${a.id}" data-name="${a.name}" data-type="album">
                ${img}
                <div class="library-card-name">${this._esc(a.name)}</div>
                <div class="library-card-sub">${a.year || ''} ${a.artist ? '· '+this._esc(a.artist) : ''}</div>
            </div>`;
        });
        html += '</div>';
        content.innerHTML = html;
        content.querySelectorAll('.library-card').forEach(card => {
            card.addEventListener('click', () => {
                this._loadTracks(card.dataset.id, card.dataset.name);
            });
        });
    },

    _renderTracks(data) {
        const content = document.getElementById('lib-content');
        if (!data.length) {
            content.innerHTML = '<div class="library-loading">No tracks found.</div>';
            return;
        }
        let html = '<div class="library-track-list">';
        data.forEach(t => {
            html += `<div class="library-track" data-id="${t.id}" data-title="${this._esc(t.title)}" data-artist="${this._esc(t.artist)}" data-album="${this._esc(t.album)}">
                <span class="library-track-num">${t.trackNum || ''}</span>
                <span class="library-track-title">${this._esc(t.title)}</span>
                <span class="library-track-artist">${this._esc(t.artist)}</span>
                <span class="library-track-dur">${this._fmtTime(t.duration)}</span>
                <span class="library-track-btn" title="Add to queue">▶</span>
            </div>`;
        });
        html += '</div>';
        content.innerHTML = html;
        // Click track → play stream
        content.querySelectorAll('.library-track').forEach(row => {
            const playBtn = row.querySelector('.library-track-btn');
            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._queueAndPlay(row.dataset);
            });
            row.addEventListener('dblclick', () => {
                this._queueAndPlay(row.dataset);
            });
        });
    },

    async _queueAndPlay(track) {
        if (this._loading) return;
        this._loading = true;

        try {
            // Fetch stream URL from backend
            const resp = await fetch('/api/jellyfin/stream/' + track.id);
            const data = await resp.json();
            const streamUrl = data.url;

            const entry = {
                url: streamUrl,
                title: track.title,
                artist: track.artist,
                album: track.album,
            };
            // Add to playlist with the resolved URL
            this.playlist.push(entry);
            this.playlistIndex = this.playlist.length - 1;
            this._updatePlaylistUI();
            await this.loadTrack(streamUrl, entry);
        } catch(e) {
            console.error('Failed to queue track:', e);
        } finally {
            this._loading = false;
        }
    },

    _esc(s) {
        return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
};
