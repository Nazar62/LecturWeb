window.videoComposer = {
    canvas: null,
    ctx: null,
    mediaRecorder: null,
    audioContext: null,
    audioDestination: null,
    chunks: [],
    ffmpeg: null,

    initialize: async (canvasId) => {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            console.error("Canvas not found");
            return;
        }
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

    animateTransition: async (fromUrl, toUrl, type, duration) => {
        return new Promise(async (resolve) => {
            const start = performance.now();
            const canvas = window.videoComposer.canvas;
            const ctx = window.videoComposer.ctx;

            // Preload images
            const imgFrom = new Image(); imgFrom.crossOrigin = "anonymous"; imgFrom.src = fromUrl;
            const imgTo = new Image(); imgTo.crossOrigin = "anonymous"; imgTo.src = toUrl;

            await Promise.all([
                new Promise(r => imgFrom.onload = r),
                new Promise(r => imgTo.onload = r)
            ]);

            function loop(now) {
                const elapsed = now - start;
                const progress = Math.min(elapsed / duration, 1.0);

                ctx.clearRect(0, 0, canvas.width, canvas.height); // clear to transparent
                // Fill white background to avoid transparency issues
                ctx.fillStyle = "white";
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                if (type === 'FadeId') { // Enum is 'FadeId'
                    ctx.globalAlpha = 1.0;
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
                } else {
                    // None or unknown
                    ctx.drawImage(imgTo, 0, 0, canvas.width, canvas.height);
                }

                if (progress < 1.0 && type !== 'None') {
                    requestAnimationFrame(loop);
                } else {
                    // Ensure final state
                    ctx.drawImage(imgTo, 0, 0, canvas.width, canvas.height);
                    resolve();
                }
            }

            requestAnimationFrame(loop);
        });
    },

    clearCanvas: () => {
        const ctx = window.videoComposer.ctx;
        const canvas = window.videoComposer.canvas;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    },

    playAudio: async (base64Audio) => {
        const ctx = window.videoComposer.audioContext;
        const audioData = await fetch(`data:audio/mp3;base64,${base64Audio}`).then(r => r.arrayBuffer());
        const audioBuffer = await ctx.decodeAudioData(audioData);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination); // For hearing it
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
        const canvasStream = window.videoComposer.canvas.captureStream(24); // 24 FPS
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
            // Fallback to default which might work or throw
            window.videoComposer.mediaRecorder = new MediaRecorder(combinedStream);
        } else {
            window.videoComposer.mediaRecorder = new MediaRecorder(combinedStream, { mimeType });
        }

        window.videoComposer.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) window.videoComposer.chunks.push(e.data);
        };

        window.videoComposer.mediaRecorder.start();
        console.log("Recording started");
    },

    stopRecording: async () => {
        return new Promise(resolve => {
            window.videoComposer.mediaRecorder.onstop = async () => {
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
