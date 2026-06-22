import React, { useState, useRef } from 'react';
import { ocrMultipleImages, terminateWorker } from '../../ocr';
import { initPdfJs, detectTextPdf, extractTextParagraphs, renderPageToFile } from '../../pdf-utils';
import { saveProject, writeImage, buildHtmlContent } from '../../storage';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function yieldFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

export default function FolderImporter({ onImport, disabled }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const fileInputRef = useRef(null);

  const processFiles = async (files, folderName) => {
    console.time('processFiles');
    console.log('processFiles started with', files.length, 'files');
    setBusy(true);
    setProgress('Scanning files...');
    try {
      const items = Array.from(files);
      const imageFiles = items.filter((f) => /\.(png|jpe?g|tiff?)$/i.test(f.name));
      const pdfFiles = items.filter((f) => /\.pdf$/i.test(f.name));

      if (imageFiles.length === 0 && pdfFiles.length === 0) {
        alert('No PNG, JPG, TIFF, or PDF files found.');
        setBusy(false);
        setProgress('');
        return;
      }

      await initPdfJs();
      await yieldFrame();

      const projectId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const name = folderName || `Document_${new Date().toLocaleDateString().replace(/\//g, '-')}`;

      // Process image files (existing OCR pipeline)
      setProgress('Running OCR on images...');
      await yieldFrame();
      const imageOcrResults = imageFiles.length > 0 ? await ocrMultipleImages(imageFiles, () => {}) : [];

      // Process PDF files page by page, yielding between each
      const pdfResults = [];
      for (const pdfFile of pdfFiles) {
        console.log('processing PDF:', pdfFile.name, 'size:', pdfFile.size);
        setProgress(`Loading PDF: ${pdfFile.name}...`);
        await sleep(50);

        const buf = await pdfFile.arrayBuffer();
        console.log('arrayBuffer loaded, size:', buf.byteLength);
        const pdfDoc = await pdfjsDocLoad(buf);
        console.log('pdfDoc loaded, pages:', pdfDoc.numPages);
        const isText = await detectTextPdf(pdfDoc);
        console.log('detectTextPdf result:', isText);

        if (isText) {
          setProgress(`Extracting text: ${pdfFile.name}...`);
          await yieldFrame();
          console.time(`extract:${pdfFile.name}`);
          const paragraphs = await extractTextParagraphs(pdfDoc);
          console.timeEnd(`extract:${pdfFile.name}`);
          pdfDoc.loadingTask.destroy();

          pdfResults.push({ filename: pdfFile.name, type: 'text', paragraphs, images: [], pages: pdfDoc.numPages });
        } else {
          const rendered = [];
          for (let i = 1; i <= pdfDoc.numPages; i++) {
            setProgress(`Rendering page ${i}/${pdfDoc.numPages}: ${pdfFile.name}...`);
            await yieldFrame();
            await sleep(30);

            const page = await pdfDoc.getPage(i);
            // Use moderate resolution for OCR — balances quality and speed
            const file = await renderPageToFile(page, 1.5, `page_${i}.png`, 'png');
            rendered.push(file);
            page.cleanup();

            await sleep(50);
          }

          pdfDoc.loadingTask.destroy();

          setProgress(`Running OCR on scanned PDF: ${pdfFile.name}...`);
          await yieldFrame();

          const ocr = rendered.length > 0 ? await ocrMultipleImages(rendered, () => {}) : [];

          const pageImages = [];
          for (let i = 0; i < rendered.length; i++) {
            await writeImage(projectId, i + 1, rendered[i]);
            pageImages.push({ page: i + 1, filename: `page_${i + 1}.png` });
            await sleep(30);
          }

          pdfResults.push({ filename: pdfFile.name, type: 'scanned', ocrResults: ocr, images: pageImages, pages: pdfDoc.numPages });
        }
      }

      await yieldFrame();

      console.time('merge');
      // Build merged arrays preserving original file order
      const allParagraphs = [];
      const allImages = [];
      let paragraphIndex = 0;

      for (const file of items) {
        if (/\.(png|jpe?g|tiff?)$/i.test(file.name)) {
          const idx = imageFiles.indexOf(file);
          const r = imageOcrResults[idx] || {};
          if (r.error) console.warn(`OCR error for ${r.filename}: ${r.error}`);

          const pageNum = r.page || idx + 1;
          await writeImage(projectId, pageNum, file);
          allImages.push({ page: pageNum, filename: `page_${pageNum}.${file.name.includes('.png') ? 'png' : 'jpg'}` });

          for (const para of (r.paragraphs || [])) {
            const text = (typeof para === 'string' ? para : (para.text || '')).trim();
            if (text) {
              allParagraphs.push({
                id: `para_${paragraphIndex}`,
                index: paragraphIndex,
                page: pageNum,
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
            const pageOffset = allImages.length;
            for (const img of pr.images) {
              allImages.push({ page: pageOffset + img.page, filename: img.filename });
            }
            for (const para of pr.paragraphs) {
              const entry = {
                id: `para_${paragraphIndex}`,
                index: paragraphIndex,
                page: pageOffset + (para.page || 1),
                filename: file.name,
                text: para.text,
                source: 'pdf_text',
              };
              if (para.type === 'table') {
                entry.type = 'table';
                entry.rows = para.rows;
                entry.colCount = para.rows && para.rows.length > 0 ? para.rows[0].length : 0;
              }
              allParagraphs.push(entry);
              paragraphIndex++;
            }
          } else {
            const pageOffset = allImages.length;
            for (const img of pr.images) {
              allImages.push({ page: pageOffset + (img.page || allImages.length + 1), filename: img.filename });
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
        await yieldFrame();
      }

      if (allParagraphs.length === 0) {
        alert('No text could be extracted.');
        setBusy(false);
        setProgress('');
        return;
      }

      console.timeEnd('merge');
      await yieldFrame();
      const htmlContent = buildHtmlContent(allParagraphs);

      setProgress('Saving project...');
      await yieldFrame();

      const onlyTextPdfs = imageFiles.length === 0 && pdfFiles.length > 0 && pdfFiles.every(f => {
        const pr = pdfResults.find(p => p.filename === f.name);
        return pr && pr.type === 'text';
      });

      console.time('saveProject');
      const project = await saveProject({
        id: projectId,
        name,
        folder_path: folderName || 'upload',
        content: htmlContent,
        paragraphsArray: allParagraphs,
        total_paragraphs: allParagraphs.length,
        images: allImages,
        isDocx: !!onlyTextPdfs,
      });
      console.timeEnd('saveProject');

      onImport(project);
      console.timeEnd('processFiles');
    } catch (err) {
      console.error('Import failed:', err);
      alert('Import failed: ' + err.message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  async function pdfjsDocLoad(buffer) {
    const pdfjs = await initPdfJs();
    return pdfjs.getDocument({data: new Uint8Array(buffer)}).promise;
  }

  const handleFolderSelect = async () => {
    console.log('handleFolderSelect started');
    try {
      const handle = await window.showDirectoryPicker();
      console.log('picker returned, handle:', handle.name);
      const files = [];
      for await (const entry of handle.values()) {
        if (entry.kind === 'file' && /\.(png|jpe?g|tiff?|pdf)$/i.test(entry.name)) {
          if (/\.pdf$/i.test(entry.name)) console.log('reading PDF:', entry.name);
          const file = await entry.getFile();
          Object.defineProperty(file, 'name', { value: entry.name });
          files.push(file);
        }
      }
      console.log('files collected:', files.length);
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      console.log('calling processFiles');
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
            <span className="text-xs max-w-[200px] truncate">{progress || 'Processing...'}</span>
          </>
        ) : (
          '+ Select Folder / Images'
        )}
      </button>
    </div>
  );
}
