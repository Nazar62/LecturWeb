// transitionWorker.js
// Web Worker timers are NOT throttled in background tabs, unlike main-thread setTimeout.
// This allows smooth 60fps frame draws during canvas transitions even when the tab is inactive.

let timer = null;

self.onmessage = function (e) {
    if (e.data === 'start') {
        if (timer) clearInterval(timer);
        // 16ms = ~60fps. These intervals are guaranteed even in background tabs.
        timer = setInterval(() => self.postMessage('tick'), 16);
    } else if (e.data === 'stop') {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }
};
