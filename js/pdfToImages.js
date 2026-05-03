window.pdfToImagesInterop = {
    convert: async function (pdfBytesArray) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        
        // pdfBytesArray from Blazor will be a Uint8Array or ArrayBuffer.
        const loadingTask = pdfjsLib.getDocument({ data: pdfBytesArray });
        const pdf = await loadingTask.promise;
        const totalPages = pdf.numPages;
        const images = [];

        for (let i = 1; i <= totalPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for higher resolution
            
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            page.cleanup(); // Release internal pdf.js rendering resources to prevent frame bleed
            images.push(canvas.toDataURL('image/png'));
        }
        
        return images;
    }
};
