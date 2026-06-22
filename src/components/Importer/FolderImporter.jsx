import React, { useState, useRef } from 'react';
import { ocrMultipleImages, terminateWorker } from '../../ocr';
import { initPdfJs, detectTextPdf, extractTextParagraphs, renderPageToDataUrl, renderPageToFile } from '../../pdf-utils';

export default function FolderImporter({ onImport, disabled }) {
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  const processFiles = async (files, folderName) => {
    setBusy(true);
    try {
      const items = Array.from(files);
      const imageFiles = items.filter((f) => /\.(png|jpe?g|tiff?)$/i.test(f.name));
      const pdfFiles = items.filter((f) => /\.pdf$/i.test(f.name));

      if (imageFiles.length === 0 && pdfFiles.length === 0) {
        alert('No PNG, JPG, TIFF, or PDF files found.');
        setBusy(false);
        return;
      }

      await initPdfJs();

      // Process image files (existing OCR pipeline)
      const imageOcrResults = imageFiles.length > 0 ? await ocrMultipleImages(imageFiles, () => {}) : [];

      // Process PDF files
      const pdfResults = [];
      for (const pdfFile of pdfFiles) {
        const buf = await pdfFile.arrayBuffer();
        const pdfDoc = await pdfjsDocLoad(buf);
        const isText = await detectTextPdf(pdfDoc);
        if (isText) {
          const paragraphs = await extractTextParagraphs(pdfDoc);
          // Render low-res preview image for each page
          const pageImages = [];
          for (let i = 1; i <= pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const dataUrl = await renderPageToDataUrl(page, 1.5);
            pageImages.push({ page: i, filename: `${pdfFile.name}_p${i}`, data: dataUrl });
            page.cleanup();
          }
          pdfResults.push({ filename: pdfFile.name, type: 'text', paragraphs, images: pageImages, pages: pdfDoc.numPages });
        } else {
          // Scanned PDF: render high-res, OCR
          const rendered = [];
          for (let i = 1; i <= pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const file = await renderPageToFile(page, 3.0, `${pdfFile.name}_p${i}.png`);
            rendered.push(file);
            page.cleanup();
          }
          const ocr = rendered.length > 0 ? await ocrMultipleImages(rendered, () => {}) : [];
          const pageImages = [];
          for (let i = 0; i < rendered.length; i++) {
            const dataUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(rendered[i]);
            });
            pageImages.push({ page: i + 1, filename: `${pdfFile.name}_p${i + 1}`, data: dataUrl });
          }
          pdfResults.push({ filename: pdfFile.name, type: 'scanned', ocrResults: ocr, images: pageImages, pages: pdfDoc.numPages });
        }
        pdfDoc.loadingTask.destroy();
      }

      // Build merged arrays preserving original file order
      const allParagraphs = [];
      const allImages = [];
      let paragraphIndex = 0;

      for (const file of items) {
        if (/\.(png|jpe?g|tiff?)$/i.test(file.name)) {
          const idx = imageFiles.indexOf(file);
          const r = imageOcrResults[idx] || {};
          if (r.error) console.warn(`OCR error for ${r.filename}: ${r.error}`);

          const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
          });

          allImages.push({ page: r.page || idx + 1, filename: file.name, data: dataUrl });

          for (const para of (r.paragraphs || [])) {
            const text = (typeof para === 'string' ? para : (para.text || '')).trim();
            if (text) {
              allParagraphs.push({
                id: `para_${paragraphIndex}`,
                index: paragraphIndex,
                page: r.page || idx + 1,
                filename: file.name,
                text,
                lines: typeof para === 'object' && Array.isArray(para.lines) ? para.lines : undefined,
              });
              paragraphIndex++;
            }
          }
        } else if (/\.pdf$/i.test(file.name)) {
          const pr = pdfResults.find(p => p.filename === file.name);
          if (!pr) continue;

          if (pr.type === 'text') {
            let pageOffset = allImages.length;
            for (const img of pr.images) {
              allImages.push({ page: pageOffset + img.page, filename: img.filename, data: img.data });
            }
            for (const para of pr.paragraphs) {
              allParagraphs.push({
                id: `para_${paragraphIndex}`,
                index: paragraphIndex,
                page: pageOffset + (para.page || 1),
                filename: file.name,
                text: para.text,
                source: 'pdf_text',
              });
              paragraphIndex++;
            }
          } else {
            let pageOffset = allImages.length;
            for (const img of pr.images) {
              allImages.push({ page: pageOffset + (img.page || allImages.length + 1), filename: img.filename, data: img.data });
            }
            for (let pi = 0; pi < (pr.ocrResults || []).length; pi++) {
              const r = pr.ocrResults[pi];
              for (const para of (r.paragraphs || [])) {
                const text = (typeof para === 'string' ? para : (para.text || '')).trim();
                if (text) {
                  allParagraphs.push({
                    id: `para_${paragraphIndex}`,
                    index: paragraphIndex,
                    page: pageOffset + pi + 1,
                    filename: file.name,
                    text,
                    lines: typeof para === 'object' && Array.isArray(para.lines) ? para.lines : undefined,
                  });
                  paragraphIndex++;
                }
              }
            }
          }
        }
      }

      if (allParagraphs.length === 0) {
        alert('No text could be extracted.');
        setBusy(false);
        return;
      }

      const name = folderName || `Document_${new Date().toLocaleDateString().replace(/\//g, '-')}`;

      // Route decision: if ONLY text PDFs (no images, no scanned PDFs), go to translation
      const onlyTextPdfs = imageFiles.length === 0 && pdfFiles.length > 0 && pdfFiles.every(f => {
        const pr = pdfResults.find(p => p.filename === f.name);
        return pr && pr.type === 'text';
      });

      onImport({
        name,
        folder: folderName || 'upload',
        paragraphs: allParagraphs,
        images: allImages,
        isDocx: onlyTextPdfs ? true : undefined,
      });
    } catch (err) {
      console.error('Import failed:', err);
      alert('Import failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  async function pdfjsDocLoad(buffer) {
    const pdfjs = await initPdfJs();
    return pdfjs.getDocument({data: new Uint8Array(buffer)}).promise;
  }

  const handleFolderSelect = async () => {
    try {
      const handle = await window.showDirectoryPicker();
      const files = [];
      for await (const entry of handle.values()) {
        if (entry.kind === 'file' && /\.(png|jpe?g|tiff?|pdf)$/i.test(entry.name)) {
          const file = await entry.getFile();
          Object.defineProperty(file, 'name', { value: entry.name });
          files.push(file);
        }
      }
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      await processFiles(files, handle.name);
    } catch (err) {
      if (err.name === 'AbortError' || err.name === 'SecurityError') return;
      console.warn('Folder picker not supported, falling back to file upload:', err.message);
      fileInputRef.current?.click();
    }
  };

  const handleFileSelect = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processFiles(files, 'Uploaded Images');
    e.target.value = '';
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/tiff,application/pdf"
        onChange={handleFileSelect}
        className="hidden"
      />
      <button
        onClick={handleFolderSelect}
        disabled={disabled || busy}
        className="bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 rounded text-sm disabled:opacity-50 flex items-center gap-1.5"
      >
        {busy ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            OCR Processing...
          </>
        ) : (
          '+ Select Folder / Images'
        )}
      </button>
    </div>
  );
}
