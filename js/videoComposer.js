window.videoComposer = {
    canvas: null,
    ctx: null,
    mediaRecorder: null,
    audioContext: null,
    audioDestination: null,
    chunks: [],
    ffmpeg: null,

    initialize: async (canvasId) => {
        // Create canvas dynamically in memory instead of relying on the DOM
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        
        window.videoComposer.canvas = canvas;
        window.videoComposer.ctx = canvas.getContext('2d');

        // Initialize AudioContext
        window.videoComposer.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        window.videoComposer.audioDestination = window.videoComposer.audioContext.createMediaStreamDestination();

        console.log("Video Composer Initialized");
    },

    loadFFmpeg: async () => {
        const { FFmpeg } = FFmpegWASM;
        const { fetchFile, toBlobURL } = FFmpegUtil;
        window.videoComposer.ffmpeg = new FFmpeg();
        window.videoComposer.fetchFile = fetchFile;
        // Log progress
        window.videoComposer.ffmpeg.on('log', ({ message }) => {
            console.log(message);
        });

        const baseURL = 'lib/ffmpeg';
        await window.videoComposer.ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        console.log("FFmpeg Loaded");
    },

    drawImage: (url, alpha = 1.0) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const ctx = window.videoComposer.ctx;
                const canvas = window.videoComposer.canvas;
                ctx.globalAlpha = alpha;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve();
            };
            img.onerror = reject;
            img.src = url;
        });
    },

    // Smooth easing function: ease-in-out cubic
    easeInOutCubic: (t) => {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },

    animateTransition: async (fromUrl, toUrl, type, duration) => {
        const canvas = window.videoComposer.canvas;
        const ctx = window.videoComposer.ctx;
        const ease = window.videoComposer.easeInOutCubic;

        // Preload both images before starting
        const imgFrom = new Image(); imgFrom.crossOrigin = "anonymous"; imgFrom.src = fromUrl;
        const imgTo   = new Image(); imgTo.crossOrigin   = "anonymous"; imgTo.src   = toUrl;
        await Promise.all([
            new Promise(r => { imgFrom.onload = r; imgFrom.onerror = r; }),
            new Promise(r => { imgTo.onload   = r; imgTo.onerror   = r; })
        ]);

        // No-op transition: just draw destination and return immediately
        if (type !== 'FadeId' && type !== 'SlideLeft' && type !== 'SlideRight') {
            ctx.globalAlpha = 1.0;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(imgTo, 0, 0, canvas.width, canvas.height);
            return;
        }

        function drawFrame(progress) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1.0;

            if (type === 'FadeId') {
                ctx.drawImage(imgFrom, 0, 0, canvas.width, canvas.height);
                ctx.globalAlpha = progress;
                ctx.drawImage(imgTo, 0, 0, canvas.width, canvas.height);
                ctx.globalAlpha = 1.0;
            } else if (type === 'SlideLeft') {
                const offset = canvas.width * progress;
                ctx.drawImage(imgFrom, -offset, 0, canvas.width, canvas.height);
                ctx.drawImage(imgTo, canvas.width - offset, 0, canvas.width, canvas.height);
            } else if (type === 'SlideRight') {
                const offset = canvas.width * progress;
                ctx.drawImage(imgFrom, offset, 0, canvas.width, canvas.height);
                ctx.drawImage(imgTo, -canvas.width + offset, 0, canvas.width, canvas.height);
            }
        }

        // Use a Web Worker timer — NOT throttled in background tabs unlike main-thread setTimeout
        // The worker fires every 16ms regardless of tab visibility, giving true 60fps.
        return new Promise((resolve) => {
            const startTime = performance.now();

            // Inline worker via Blob URL so no extra file dependency is needed
            const workerCode = `
                let timer = null;
                self.onmessage = function(e) {
                    if (e.data === 'start') {
                        if (timer) clearInterval(timer);
                        timer = setInterval(() => self.postMessage('tick'), 16);
                    } else if (e.data === 'stop') {
                        if (timer) { clearInterval(timer); timer = null; }
                    }
                };
            `;
            const blob   = new Blob([workerCode], { type: 'application/javascript' });
            const worker = new Worker(URL.createObjectURL(blob));

            worker.onmessage = () => {
                const elapsed     = performance.now() - startTime;
                const rawProgress = Math.min(elapsed / duration, 1.0);
                const progress    = ease(rawProgress);

                drawFrame(progress);

                if (rawProgress >= 1.0) {
                    worker.postMessage('stop');
                    worker.terminate();

                    // Paint final destination frame cleanly
                    ctx.globalAlpha = 1.0;
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(imgTo, 0, 0, canvas.width, canvas.height);
                    resolve();
                }
            };

            worker.postMessage('start');
        });
    },

    clearCanvas: () => {
        const ctx = window.videoComposer.ctx;
        const canvas = window.videoComposer.canvas;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    },

    playAudio: async (base64Audio) => {
        const ctx = window.videoComposer.audioContext;

        // AudioContext may be suspended after tab visibility change — resume before use
        if (ctx.state === 'suspended') {
            await ctx.resume();
        }

        // Decode base64 directly with atob() — avoids DOMException from fetch() aborting
        // large data: URLs (which browsers can reject when the payload is too big)
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const audioBuffer = await ctx.decodeAudioData(bytes.buffer);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);          // For hearing it
        source.connect(window.videoComposer.audioDestination); // For recording it
        source.start(0);

        return new Promise(resolve => {
            source.onended = resolve;
        });
    },

    getSupportedMimeType: () => {
        const types = [
            'video/webm; codecs="vp9,opus"',
            'video/webm; codecs=vp9',
            'video/webm; codecs="vp8,opus"',
            'video/webm; codecs=vp8',
            'video/webm',
            'video/mp4'
        ];
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
        return '';
    },

    startRecording: () => {
        const canvasStream = window.videoComposer.canvas.captureStream(60); // 60 FPS
        const audioStream = window.videoComposer.audioDestination.stream;

        // Combine tracks
        const combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioStream.getAudioTracks()
        ]);

        window.videoComposer.chunks = [];
        const mimeType = window.videoComposer.getSupportedMimeType();
        console.log(`Using mimeType: ${mimeType}`);

        if (!mimeType) {
            console.error("No supported MediaRecorder mime type found.");
            window.videoComposer.mediaRecorder = new MediaRecorder(combinedStream);
        } else {
            window.videoComposer.mediaRecorder = new MediaRecorder(combinedStream, { mimeType });
        }

        window.videoComposer.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) window.videoComposer.chunks.push(e.data);
        };

        // Start a keep-alive worker to force canvas frame emission.
        // If the canvas isn't drawn to (e.g. during a 5-second audio clip), MediaRecorder
        // stops recording frames, which causes the final video to freeze or truncate.
        const workerCode = `
            let timer = null;
            self.onmessage = function(e) {
                if (e.data === 'start') {
                    timer = setInterval(() => self.postMessage('tick'), 16);
                } else if (e.data === 'stop') {
                    clearInterval(timer);
                }
            };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        window.videoComposer.keepAliveWorker = new Worker(URL.createObjectURL(blob));
        window.videoComposer.keepAliveWorker.onmessage = () => {
            if (window.videoComposer.mediaRecorder.state === 'recording') {
                const ctx = window.videoComposer.ctx;
                // Draw an invisible 1x1 rect outside the visible area just to trigger the canvas dirty flag
                ctx.clearRect(-1, -1, 1, 1);
            }
        };
        window.videoComposer.keepAliveWorker.postMessage('start');

        // Request data periodically to ensure chunks are flushed and timestamps remain stable
        window.videoComposer.mediaRecorder.start(1000); 
        console.log("Recording started");
    },

    stopRecording: async () => {
        return new Promise(resolve => {
            window.videoComposer.mediaRecorder.onstop = async () => {
                if (window.videoComposer.keepAliveWorker) {
                    window.videoComposer.keepAliveWorker.postMessage('stop');
                    window.videoComposer.keepAliveWorker.terminate();
                    window.videoComposer.keepAliveWorker = null;
                }

                const blob = new Blob(window.videoComposer.chunks, { type: 'video/webm' });
                console.log("Recording stopped, converting...");
                const mp4Blob = await window.videoComposer.convertToMp4(blob);
                resolve(URL.createObjectURL(mp4Blob));
            };
            window.videoComposer.mediaRecorder.stop();
        });
    },

    convertToMp4: async (webmBlob) => {
        const ffmpeg = window.videoComposer.ffmpeg;
        if (!ffmpeg.loaded) await window.videoComposer.loadFFmpeg();

        const name = 'record.webm';
        await ffmpeg.writeFile(name, await window.videoComposer.fetchFile(webmBlob));
        // Simple copy if codec allows, else transcode
        // await ffmpeg.exec(['-i', name, '-c:v', 'copy', '-c:a', 'copy', 'output.mp4']);
        // Re-encoding ensures high compatibility
        await ffmpeg.exec(['-i', name, '-c:v', 'libx264', '-preset', 'ultrafast', 'output.mp4']);

        const data = await ffmpeg.readFile('output.mp4');
        return new Blob([data.buffer], { type: 'video/mp4' });
    }
};
window.blobToBytes=b=>fetch(b).then(r=>r.arrayBuffer()).then(ab=>Array.from(new Uint8Array(ab)));