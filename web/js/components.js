// components.js — Reusable UI component factory.
// Creates Windows 9x / Winamp styled DOM elements programmatically.

const Components = {
    // Create a raised panel
    panel(title, contentEl) {
        const div = document.createElement('div');
        div.className = 'panel inset';
        if (title) {
            const header = document.createElement('div');
            header.className = 'panel-header';
            header.textContent = title;
            div.appendChild(header);
        }
        const body = document.createElement('div');
        body.className = 'panel-body';
        if (typeof contentEl === 'string') {
            body.innerHTML = contentEl;
        } else if (contentEl) {
            body.appendChild(contentEl);
        }
        div.appendChild(body);
        return div;
    },

    // Create a button
    button(text, className = '', onClick) {
        const btn = document.createElement('button');
        btn.className = 'btn ' + className;
        btn.textContent = text;
        if (onClick) btn.addEventListener('click', onClick);
        return btn;
    },

    // Create an input field
    input(placeholder = '', className = '') {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'input ' + className;
        inp.placeholder = placeholder;
        return inp;
    },

    // Show the disambiguation dialog
    showDisambiguationDialog(matches, onSelect, onCancel) {
        const overlay = document.getElementById('dialog-overlay');
        const list = document.getElementById('dialog-artist-list');
        const cancelBtn = document.getElementById('dialog-cancel');
        const closeBtn = document.getElementById('dialog-close');

        list.innerHTML = '';
        matches.forEach(match => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="match-name">${this._esc(match.name)}</span>
                ${match.disambiguation ? `<span class="match-detail">${this._esc(match.disambiguation)}</span>` : ''}
                ${match.genres && match.genres.length ? `<span class="match-genres">${this._esc(match.genres.join(', '))}</span>` : ''}
            `;
            li.addEventListener('click', () => {
                overlay.classList.add('hidden');
                onSelect(match);
            });
            list.appendChild(li);
        });

        const cleanup = () => {
            overlay.classList.add('hidden');
            if (onCancel) onCancel();
        };

        cancelBtn.onclick = cleanup;
        closeBtn.onclick = cleanup;
        overlay.classList.remove('hidden');

        // Close on overlay click
        overlay.onclick = (e) => {
            if (e.target === overlay) cleanup();
        };

        // Close on Escape
        const onKey = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                document.removeEventListener('keydown', onKey);
            }
        };
        document.addEventListener('keydown', onKey);
    },

    // Create a toast/notification
    toast(message, type = 'info') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
            background: ${type === 'error' ? '#600' : '#060'};
            color: ${type === 'error' ? '#f88' : '#8f8'};
            border: 2px solid ${type === 'error' ? '#c00' : '#0a0'};
            padding: 6px 16px; font-size: 11px; z-index: 200;
            font-family: var(--font-ui);
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    },

    _esc(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    },
};
