// ── pdfmake — lazy loaded on first export click ───────────────────────────────

window.PdfExport = {

    _loaded: false,

    async _ensureLoaded() {
        if (this._loaded) return;
        await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js');
        await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.min.js');
        this._loaded = true;
    },

    _loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
            const s = document.createElement('script');
            s.src     = src;
            s.onload  = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    },

    async downloadFromJson(docJson, filename) {
        await this._ensureLoaded();

        const docDef = JSON.parse(docJson);

        if (docDef.footer?.__footerTitle !== undefined) {
            const title      = docDef.footer.__footerTitle;
            const label      = docDef.footer.__footerLabel;
            const mutedColor = docDef.__mutedColor ?? '#6B7280';
            docDef.footer = (page, count) => ({
                columns: [
                    { text: title,                fontSize: 8, color: mutedColor },
                    { text: label,                fontSize: 8, color: mutedColor, alignment: 'center' },
                    { text: `${page} / ${count}`, fontSize: 8, color: mutedColor, alignment: 'right' },
                ],
                margin: [50, 10],
            });
        }

        delete docDef.__mutedColor;
        pdfMake.createPdf(docDef).download(filename);
    },

    getThemeColors() {
        const s   = getComputedStyle(document.documentElement);
        const get = (v) => s.getPropertyValue(v).trim();
        return {
            accent:      get('--accent-color'),
            accentLight: get('--accent-color-30'),
            secondary:   get('--secondary'),
            fontColor:   get('--font-color'),
            fontButton:  get('--font-color-button'),
            bgLight:     get('--bg-color-light'),
            bgDark:      get('--bg-color-dark'),
            muted:       get('--theme-color-oposite-50-no-opacity'),
            inputBg:     get('--accent-color-input'),
        };
    }
};

// ── MathJax — lazy loaded on page arrival, only once per session ──────────────
// Call window.MathJaxLoader.load() from Blazor's OnAfterRenderAsync on pages
// that contain math. Safe to call multiple times — loads only once.

window.MathJaxLoader = {

    _loaded: false,
    _loading: false,

    load() {
        if (this._loaded || this._loading) {
            // Already loaded — just re-typeset whatever is currently on screen
            if (this._loaded && window.MathJax?.typesetPromise)
                MathJax.typesetPromise();
            return;
        }

        this._loading = true;

        // Config must be set before the MathJax script loads
        window.MathJax = {
            tex: {
                inlineMath:  [['$', '$']],
                displayMath: [['$$', '$$']],
            },
            options: {
                renderActions: {
                    findScript: [10, function (doc) {
                        for (const node of document.querySelectorAll('span.math')) {
                            const math = new doc.options.MathItem(node.textContent, doc.inputJax[0], true);
                            const text = document.createTextNode('');
                            node.parentNode.replaceChild(text, node);
                            math.start = { node: text, delim: '', n: 0 };
                            math.end   = { node: text, delim: '', n: 0 };
                            doc.math.push(math);
                        }
                        for (const node of document.querySelectorAll('div.math')) {
                            const math = new doc.options.MathItem(node.textContent, doc.inputJax[0], false);
                            const text = document.createTextNode('');
                            node.parentNode.replaceChild(text, node);
                            math.start = { node: text, delim: '', n: 0 };
                            math.end   = { node: text, delim: '', n: 0 };
                            doc.math.push(math);
                        }
                    }, '']
                }
            },
            startup: {
                ready: () => {
                    MathJax.startup.defaultReady();
                    window.MathJaxLoader._loaded   = true;
                    window.MathJaxLoader._loading  = false;
                }
            }
        };

        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';
        document.head.appendChild(s);
    }
};