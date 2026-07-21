// graph.js — Canvas-based force-directed node graph for artist exploration.
// Handles rendering, physics simulation, and interaction (drag, zoom, pan, click-to-expand).

const Graph = {
    canvas: null,
    ctx: null,
    nodes: [],        // { id, artist, x, y, vx, vy, selected, expanded, radius, color }
    edges: [],        // { source, target, type }
    simulation: null, // requestAnimationFrame ID
    transform: { x: 0, y: 0, scale: 1 }, // pan & zoom
    dragNode: null,
    dragOffset: { x: 0, y: 0 },
    isPanning: false,
    panStart: { x: 0, y: 0 },
    hoverNode: null,
    maxNodes: 500, // default, overridden by user setting (0 = unlimited)

    _getMaxNodes() {
        try {
            const s = JSON.parse(localStorage.getItem('hearme_settings') || '{}');
            const val = parseInt(s.maxGraphNodes);
            return (val > 0) ? val : Infinity;
        } catch { return Infinity; }
    },

    // Simulation constants
    repulsion: 5000,
    attraction: 0.01,
    idealEdgeLength: 120,
    damping: 0.85,
    centerGravity: 0.003,        // pull toward viewport center (only when enabled)
    centerGravityEnabled: true,  // toggle via settings — keeps nodes from drifting off-screen
    orbitGravity: 0.008,         // pull connected nodes toward pinned hosts
    orbitIdealDist: 100,         // ideal orbital distance from pinned node
    maxVelocity: 10,
    dragScale: 1.15,             // scale up when dragging
    wiggleTime: 0,               // for edge wiggle animation

    // Genre color map
    genreColors: {},

    init() {
        this.canvas = document.getElementById('graph-canvas');
        this.ctx = this.canvas.getContext('2d');

        // Defer initial sizing until after CSS layout (flex container needs computed height)
        requestAnimationFrame(() => {
            this._resize();
            // Start simulation only after canvas has dimensions
            this._startSimulation();
        });

        // ResizeObserver is more reliable than window.resize for flex layout changes
        if (window.ResizeObserver) {
            const container = this.canvas.parentElement;
            this._resizeObserver = new ResizeObserver(() => this._resize());
            this._resizeObserver.observe(container);
        } else {
            window.addEventListener('resize', () => this._resize());
        }

        this._bindEvents();
    },

    _resize() {
        const container = this.canvas.parentElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width));
        const h = Math.max(1, Math.floor(rect.height));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
    },

    // Ensure canvas is sized; call before relying on canvas dimensions
    _ensureSize() {
        if (this.canvas.width <= 1 || this.canvas.height <= 1) {
            this._resize();
        }
    },

    // --- Node Management ---

    addNode(artist, x, y) {
        const limit = this._getMaxNodes();
        if (this.nodes.length >= limit && limit !== Infinity) {
            document.getElementById('graph-warning').classList.remove('hidden');
            return false;
        }
        document.getElementById('graph-warning').classList.add('hidden');

        // Deduplicate
        const exists = this.nodes.find(n => n.id === artist.id);
        if (exists) {
            exists.selected = true;
            return true;
        }

        // Ensure canvas has dimensions before computing default position
        this._ensureSize();

        const colors = ['#4488ff', '#ff8844', '#22ff22', '#ff44ff', '#ffdd44',
                        '#44ddff', '#ff6644', '#88ff44', '#ff4488', '#44ff88'];
        const colorIdx = this.nodes.length % colors.length;

        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;
        // World-space center (accounting for pan/zoom)
        const worldCX = (cx - this.transform.x) / this.transform.scale;
        const worldCY = (cy - this.transform.y) / this.transform.scale;

        this.nodes.push({
            id: artist.id,
            artist: artist,
            x: x !== undefined ? x : worldCX + (Math.random() - 0.5) * 120,
            y: y !== undefined ? y : worldCY + (Math.random() - 0.5) * 120,
            vx: 0, vy: 0,
            selected: true,
            expanded: false,
            pinned: false,
            radius: 12 + (artist.popularity || 0) / 10,
            color: colors[colorIdx],
            genreColor: null,
        });
        this._updateStatus();
        return true;
    },

    addRelatedNodes(artistId, relations) {
        const parentNode = this.nodes.find(n => n.id === artistId);
        if (!parentNode) return;

        parentNode.expanded = true;

        for (const rel of relations) {
            if (this.nodes.length >= this._getMaxNodes() && this._getMaxNodes() !== Infinity) {
                document.getElementById('graph-warning').classList.remove('hidden');
                break;
            }

            const exists = this.nodes.find(n => n.id === rel.artist.id);
            if (exists) {
                // Add edge if not already present
                const edgeExists = this.edges.find(e =>
                    (e.source === artistId && e.target === rel.artist.id) ||
                    (e.source === rel.artist.id && e.target === artistId)
                );
                if (!edgeExists) {
                    this.edges.push({ source: artistId, target: rel.artist.id, type: rel.relationType });
                }
                continue;
            }

            const angle = Math.random() * Math.PI * 2;
            const dist = 80 + Math.random() * 80;
            const nx = parentNode.x + Math.cos(angle) * dist;
            const ny = parentNode.y + Math.sin(angle) * dist;

            this.nodes.push({
                id: rel.artist.id,
                artist: rel.artist,
                x: nx, y: ny,
                vx: 0, vy: 0,
                selected: false,
                expanded: false,
                pinned: false,
                radius: 10 + (rel.artist.popularity || 0) / 10,
                color: this._getGenreColor(rel.artist.genres),
                genreColor: null,
            });

            this.edges.push({ source: artistId, target: rel.artist.id, type: rel.relationType });
        }
        this._updateStatus();
    },

    removeNode(nodeId) {
        this.nodes = this.nodes.filter(n => n.id !== nodeId);
        this.edges = this.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
        document.getElementById('graph-warning').classList.add('hidden');
        this._updateStatus();
    },

    // Returns all node IDs directly or indirectly connected to the given node.
    getConnectedNodes(nodeId) {
        const visited = new Set();
        const queue = [nodeId];
        visited.add(nodeId);

        while (queue.length > 0) {
            const current = queue.shift();
            for (const edge of this.edges) {
                let neighbor = null;
                if (edge.source === current) neighbor = edge.target;
                else if (edge.target === current) neighbor = edge.source;
                if (neighbor && !visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }
        return [...visited];
    },

    // Removes a node and all nodes connected to it (transitively).
    removeConnectedNodes(nodeId) {
        const connected = this.getConnectedNodes(nodeId);
        const set = new Set(connected);
        this.nodes = this.nodes.filter(n => !set.has(n.id));
        this.edges = this.edges.filter(e => !set.has(e.source) && !set.has(e.target));
        document.getElementById('graph-warning').classList.add('hidden');
        this._updateStatus();
    },

    selectNode(nodeId) {
        this.nodes.forEach(n => n.selected = (n.id === nodeId));
    },

    clearAll() {
        this.nodes = [];
        this.edges = [];
        document.getElementById('graph-warning').classList.add('hidden');
        this._updateStatus();
    },

    getSelectedArtists() {
        return this.nodes.filter(n => n.selected).map(n => n.artist);
    },

    // --- Physics Simulation ---

    _startSimulation() {
        const tick = (time) => {
            this.wiggleTime = time * 0.001; // seconds for sine wave
            this._simulate();
            this._render();
            this.simulation = requestAnimationFrame(tick);
        };
        this.simulation = requestAnimationFrame(tick);
    },

    _simulate() {
        if (this.dragNode) return; // pause simulation while dragging

        const nodes = this.nodes;
        const n = nodes.length;
        if (n === 0) return;

        // Scale repulsion down for large graphs.
        const repScale = Math.min(1, Math.sqrt(50 / Math.max(1, n)));
        const repulsion = this.repulsion * repScale;

        // --- Spatial hash grid for O(n) repulsion ---
        // Instead of O(n²) pairwise checks, each node only checks forces
        // from nodes in the same or neighboring grid cells.
        const CELL = 150; // grid cell size in world-space pixels
        const grid = new Map();

        for (let i = 0; i < n; i++) {
            const node = nodes[i];
            const cx = Math.floor(node.x / CELL);
            const cy = Math.floor(node.y / CELL);
            const key = cx + ',' + cy;
            let cell = grid.get(key);
            if (!cell) { cell = []; grid.set(key, cell); }
            cell.push(i); // store index for fast lookup
        }

        // Repulsion: only check within 3×3 neighborhood
        for (let i = 0; i < n; i++) {
            const node = nodes[i];
            if (node.pinned) continue; // pinned nodes still repel others but aren't moved
            const cx = Math.floor(node.x / CELL);
            const cy = Math.floor(node.y / CELL);

            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const cell = grid.get((cx + dx) + ',' + (cy + dy));
                    if (!cell) continue;
                    for (let k = 0; k < cell.length; k++) {
                        const j = cell[k];
                        if (j <= i) continue; // avoid double-counting
                        const other = nodes[j];
                        const ddx = other.x - node.x;
                        const ddy = other.y - node.y;
                        const distSq = ddx * ddx + ddy * ddy;
                        if (distSq < 1) continue;
                        const dist = Math.sqrt(distSq);
                        const force = repulsion / distSq;
                        const fx = (ddx / dist) * force;
                        const fy = (ddy / dist) * force;
                        if (!node.pinned) { node.vx -= fx; node.vy -= fy; }
                        if (!other.pinned) { other.vx += fx; other.vy += fy; }
                    }
                }
            }
        }

        // Build node lookup map for O(1) lookups in edge traversal
        const nodeMap = new Map();
        for (const node of nodes) {
            nodeMap.set(node.id, node);
        }

        // Attraction along edges
        for (const edge of this.edges) {
            const src = nodeMap.get(edge.source);
            const tgt = nodeMap.get(edge.target);
            if (!src || !tgt) continue;
            const dx = tgt.x - src.x;
            const dy = tgt.y - src.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = this.attraction * (dist - this.idealEdgeLength);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            if (!src.pinned) { src.vx += fx; src.vy += fy; }
            if (!tgt.pinned) { tgt.vx -= fx; tgt.vy -= fy; }
        }

        // Orbital gravity: pinned nodes pull their connected neighbors into orbit
        for (const node of nodes) {
            if (!node.pinned) continue;
            for (const edge of this.edges) {
                let neighbor = null;
                if (edge.source === node.id) neighbor = nodeMap.get(edge.target);
                else if (edge.target === node.id) neighbor = nodeMap.get(edge.source);
                if (!neighbor || neighbor.pinned) continue;

                const dx = node.x - neighbor.x;
                const dy = node.y - neighbor.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                // Pull toward the ideal orbital distance
                const force = this.orbitGravity * (dist - this.orbitIdealDist);
                neighbor.vx += (dx / dist) * force;
                neighbor.vy += (dy / dist) * force;

                // Add a small tangential force for orbital motion
                const tangentForce = 0.002;
                neighbor.vx += (-dy / dist) * tangentForce;
                neighbor.vy += (dx / dist) * tangentForce;
            }
        }

        // Center gravity (only for unpinned nodes, only when enabled)
        if (this.centerGravityEnabled) {
            const cw = Math.max(this.canvas.width, 1);
            const ch = Math.max(this.canvas.height, 1);
            const cx = cw / 2 / this.transform.scale - this.transform.x / this.transform.scale;
            const cy = ch / 2 / this.transform.scale - this.transform.y / this.transform.scale;
            for (const node of nodes) {
                if (node.pinned) continue;
                // Guard against NaN positions
                if (isNaN(node.x)) node.x = cx + (Math.random() - 0.5) * 100;
                if (isNaN(node.y)) node.y = cy + (Math.random() - 0.5) * 100;
                node.vx += (cx - node.x) * this.centerGravity;
                node.vy += (cy - node.y) * this.centerGravity;
            }
        }

        // Apply velocities with damping and clamp (only for unpinned nodes)
        for (const node of nodes) {
            if (node.pinned) { node.vx = 0; node.vy = 0; continue; }
            node.vx *= this.damping;
            node.vy *= this.damping;
            if (Math.abs(node.vx) > this.maxVelocity) node.vx = Math.sign(node.vx) * this.maxVelocity;
            if (Math.abs(node.vy) > this.maxVelocity) node.vy = Math.sign(node.vy) * this.maxVelocity;
            node.x += node.vx;
            node.y += node.vy;
        }
    },

    // --- Rendering ---

    _render() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Guard against zero-size canvas (not yet laid out)
        if (w <= 1 || h <= 1) return;

        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.translate(this.transform.x, this.transform.y);
        ctx.scale(this.transform.scale, this.transform.scale);

        // Compute visible world-space rectangle (with margin for labels)
        const margin = 50;
        const vx1 = -this.transform.x / this.transform.scale - margin;
        const vy1 = -this.transform.y / this.transform.scale - margin;
        const vx2 = (w - this.transform.x) / this.transform.scale + margin;
        const vy2 = (h - this.transform.y) / this.transform.scale + margin;

        // Build a Set of visible node IDs for edge culling
        const visibleNodeIds = new Set();
        for (const node of this.nodes) {
            if (node.x >= vx1 && node.x <= vx2 && node.y >= vy1 && node.y <= vy2) {
                visibleNodeIds.add(node.id);
            }
        }

        // Build node lookup map for O(1) edge endpoint resolution
        const nodeMap = new Map();
        for (const node of this.nodes) {
            nodeMap.set(node.id, node);
        }

        // Draw edges (skip if both endpoints are off-screen)
        for (const edge of this.edges) {
            const src = nodeMap.get(edge.source);
            const tgt = nodeMap.get(edge.target);
            if (!src || !tgt) continue;
            // Skip edges where both endpoints are far off-screen
            if (!visibleNodeIds.has(src.id) && !visibleNodeIds.has(tgt.id)) continue;

            let sx = src.x, sy = src.y, tx = tgt.x, ty = tgt.y;

            // Wiggle edges connected to the dragged node
            if (this.dragNode && (src === this.dragNode || tgt === this.dragNode)) {
                const wiggle = Math.sin(this.wiggleTime * 8 + (src === this.dragNode ? tx : sx) * 0.05) * 4;
                const dx = tx - sx;
                const dy = ty - sy;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const nx = -dy / len;
                const ny = dx / len;
                const mx = (sx + tx) / 2 + nx * wiggle;
                const my = (sy + ty) / 2 + ny * wiggle;

                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.quadraticCurveTo(mx, my, tx, ty);
                ctx.strokeStyle = 'rgba(34,255,34,0.5)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(tx, ty);
                ctx.strokeStyle = 'rgba(128,128,128,0.3)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        // Draw nodes — sort so selected render on top, dragged on very top
        const sorted = [...this.nodes].sort((a, b) => {
            if (a === this.dragNode) return 1;
            if (b === this.dragNode) return -1;
            return (a.selected ? 1 : 0) - (b.selected ? 1 : 0);
        });
        for (const node of sorted) {
            // Viewport cull: skip nodes completely outside visible area
            if (!visibleNodeIds.has(node.id) && node !== this.dragNode) continue;

            const isDragging = node === this.dragNode;
            const scale = isDragging ? this.dragScale : 1;
            const r = node.radius * scale;
            // Glow for selected nodes
            if (node.selected) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(34,255,34,0.15)';
                ctx.fill();
            }

            // Node circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
            const gradient = ctx.createRadialGradient(node.x - r * 0.3, node.y - r * 0.3, 0, node.x, node.y, r);
            gradient.addColorStop(0, this._lighten(node.color, 30));
            gradient.addColorStop(1, node.color);
            ctx.fillStyle = gradient;
            ctx.fill();

            // Selection ring
            if (node.selected) {
                ctx.strokeStyle = '#22ff22';
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            // Expanded indicator
            if (node.expanded) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
                ctx.strokeStyle = '#ff8844';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Label
            const label = node.artist.name.length > 18
                ? node.artist.name.substring(0, 16) + '…'
                : node.artist.name;
            ctx.font = `${Math.max(10, 12 / this.transform.scale)}px "${this._getFontFamily()}"`;
            ctx.fillStyle = '#e0e0e0';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(label, node.x, node.y + r + 4);

            // Hover highlight
            if (node === this.hoverNode && !isDragging) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 2, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            // Pin indicator
            if (node.pinned) {
                ctx.beginPath();
                ctx.arc(node.x, node.y - r - 6, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = '#ffaa00';
                ctx.fill();
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }

            // Owned indicator (in Jellyfin library)
            if (typeof App !== 'undefined' && App.isArtistOwned && App.isArtistOwned(node.artist.name)) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2);
                ctx.strokeStyle = '#22ff22';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        ctx.restore();
    },

    // --- Interaction ---

    _bindEvents() {
        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
        this.canvas.addEventListener('dblclick', (e) => this._onDblClick(e));
        this.canvas.addEventListener('contextmenu', (e) => this._onContextMenu(e));
        // Delete key removes selected node
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Don't delete if user is typing in an input
                if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
                const selected = this.nodes.find(n => n.selected);
                if (selected && this._onNodeDelete) {
                    this._onNodeDelete(selected);
                }
            }
        });
    },

    _screenToWorld(sx, sy) {
        return {
            x: (sx - this.transform.x) / this.transform.scale,
            y: (sy - this.transform.y) / this.transform.scale,
        };
    },

    _hitTest(wx, wy) {
        // Search in reverse order (top nodes first)
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const node = this.nodes[i];
            const dx = wx - node.x;
            const dy = wy - node.y;
            if (dx * dx + dy * dy <= (node.radius + 4) * (node.radius + 4)) {
                return node;
            }
        }
        return null;
    },

    _onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = this._screenToWorld(sx, sy);
        const hit = this._hitTest(world.x, world.y);

        if (hit) {
            this.dragNode = hit;
            this.dragOffset = { x: world.x - hit.x, y: world.y - hit.y };
            // Track mouse screen position for click-vs-drag detection (more reliable than node position)
            this._mouseDownPos = { x: e.clientX, y: e.clientY };
            this.canvas.style.cursor = 'grabbing';
        } else {
            this.isPanning = true;
            this.panStart = { x: e.clientX, y: e.clientY };
            this.canvas.classList.add('panning');
        }
    },

    _onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = this._screenToWorld(sx, sy);

        if (this.dragNode) {
            this.dragNode.x = world.x - this.dragOffset.x;
            this.dragNode.y = world.y - this.dragOffset.y;
            this.dragNode.vx = 0;
            this.dragNode.vy = 0;
        } else if (this.isPanning) {
            this.transform.x += e.clientX - this.panStart.x;
            this.transform.y += e.clientY - this.panStart.y;
            this.panStart = { x: e.clientX, y: e.clientY };
        } else {
            const hit = this._hitTest(world.x, world.y);
            if (hit !== this.hoverNode) {
                this.hoverNode = hit;
                this.canvas.style.cursor = hit ? 'pointer' : 'grab';
            }
        }
    },

    _onMouseUp(e) {
        if (this.dragNode) {
            // Detect click vs drag by comparing mouse screen position (reliable even if
            // _onMouseMove fired and moved the node). 5px threshold for a real click.
            const mdx = Math.abs(e.clientX - (this._mouseDownPos?.x || e.clientX));
            const mdy = Math.abs(e.clientY - (this._mouseDownPos?.y || e.clientY));
            const wasClick = mdx < 5 && mdy < 5;

            // Only pin if actually dragged (moved more than a click)
            if (!wasClick) {
                this.dragNode.pinned = true;
            }
            this.dragNode.vx = 0;
            this.dragNode.vy = 0;
            const node = this.dragNode;
            this._mouseDownPos = null;
            this.dragNode = null;
            this.canvas.style.cursor = this.hoverNode ? 'pointer' : 'grab';

            if (wasClick && this._onNodeClick) {
                this._onNodeClick(node);
            }
        }
        this.isPanning = false;
        this.canvas.classList.remove('panning');
    },

    _onWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const zoom = e.deltaY < 0 ? 1.1 : 0.9;
        const newScale = Math.max(0.1, Math.min(5, this.transform.scale * zoom));

        // Zoom toward cursor
        this.transform.x = mx - (mx - this.transform.x) * (newScale / this.transform.scale);
        this.transform.y = my - (my - this.transform.y) * (newScale / this.transform.scale);
        this.transform.scale = newScale;
    },

    _onDblClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const hit = this._hitTest(world.x, world.y);
        if (hit) {
            // Toggle pin state
            hit.pinned = !hit.pinned;
            if (!hit.pinned) {
                // Unpinned — let simulation move it again
                hit.vx = (Math.random() - 0.5) * 2;
                hit.vy = (Math.random() - 0.5) * 2;
            }
        }
    },

    // Called by app.js when a node is clicked
    onNodeClick(callback) {
        this._onNodeClick = callback;
    },

    // Called by app.js when a node should be deleted (right-click or Delete key)
    onNodeDelete(callback) {
        this._onNodeDelete = callback;
    },

    // Called by app.js to show a custom context menu
    onContextMenu(callback) {
        this._onContextMenuCb = callback;
    },

    _onContextMenu(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const world = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const hit = this._hitTest(world.x, world.y);
        if (hit) {
            this.selectNode(hit.id);
            if (this._onContextMenuCb) {
                this._onContextMenuCb(hit, e.clientX, e.clientY);
            }
        }
    },

    // --- Helpers ---

    _getGenreColor(genres) {
        if (!genres || genres.length === 0) return '#4488ff';
        const genre = genres[0].toLowerCase();
        if (!this.genreColors[genre]) {
            const hash = this._hashStr(genre);
            const h = hash % 360;
            this.genreColors[genre] = `hsl(${h}, 50%, 45%)`;
        }
        return this.genreColors[genre];
    },

    _hashStr(s) {
        let hash = 0;
        for (let i = 0; i < s.length; i++) {
            hash = ((hash << 5) - hash) + s.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    },

    _lighten(hex, percent) {
        const num = parseInt(hex.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.min(255, (num >> 16) + amt);
        const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
        const B = Math.min(255, (num & 0x0000FF) + amt);
        return `rgb(${R},${G},${B})`;
    },

    _getFontFamily() {
        return getComputedStyle(document.body).fontFamily || 'sans-serif';
    },

    _updateStatus() {
        const el = document.getElementById('status-node-count');
        if (el) el.textContent = `${this.nodes.length} nodes`;
    },

    // Reset view
    resetView() {
        this.transform = { x: 0, y: 0, scale: 1 };
    },

    // --- Export ---

    // Export the current canvas as a PNG file download.
    exportPNG() {
        // Render one frame without UI decorations (the canvas already only has the graph)
        // Force a render frame to ensure content is on canvas
        this._render();
        const dataURL = this.canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = 'hearme_graph_' + new Date().toISOString().slice(0, 10) + '.png';
        a.click();
    },

    // Export nodes and edges as CSV (two files: nodes.csv + edges.csv).
    exportCSV() {
        // Nodes CSV
        let nodesCSV = 'id,name,genres,popularity,pinned,expanded,x,y\n';
        for (const node of this.nodes) {
            const genres = (node.artist.genres || []).join('; ');
            nodesCSV += [
                this._csvEscape(node.id),
                this._csvEscape(node.artist.name),
                this._csvEscape(genres),
                node.artist.popularity || 0,
                node.pinned ? 'yes' : 'no',
                node.expanded ? 'yes' : 'no',
                Math.round(node.x),
                Math.round(node.y),
            ].join(',') + '\n';
        }

        // Edges CSV
        let edgesCSV = 'source_id,source_name,target_id,target_name,type\n';
        for (const edge of this.edges) {
            const src = this.nodes.find(n => n.id === edge.source);
            const tgt = this.nodes.find(n => n.id === edge.target);
            edgesCSV += [
                this._csvEscape(edge.source),
                this._csvEscape(src ? src.artist.name : ''),
                this._csvEscape(edge.target),
                this._csvEscape(tgt ? tgt.artist.name : ''),
                this._csvEscape(edge.type || 'similar'),
            ].join(',') + '\n';
        }

        const blob = new Blob([nodesCSV], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'hearme_nodes_' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        URL.revokeObjectURL(url);

        // Small delay between downloads to avoid browser blocking
        setTimeout(() => {
            const blob2 = new Blob([edgesCSV], { type: 'text/csv' });
            const url2 = URL.createObjectURL(blob2);
            const a2 = document.createElement('a');
            a2.href = url2;
            a2.download = 'hearme_edges_' + new Date().toISOString().slice(0, 10) + '.csv';
            a2.click();
            URL.revokeObjectURL(url2);
        }, 200);
    },

    _csvEscape(val) {
        const s = String(val || '');
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    },
};
