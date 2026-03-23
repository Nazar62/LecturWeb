window.MathJaxLoader = {

    _loaded: false,
    _loading: false,

    load() {
        if (this._loaded) {
            MathJax.typesetPromise();
            return;
        }

        if (this._loading) return;

        this._loading = true;

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
                ready() {
                    MathJax.startup.defaultReady();
                    window.MathJaxLoader._loaded  = true;
                    window.MathJaxLoader._loading = false;
                }
            }
        };

        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';
        document.head.appendChild(s);
    }
};