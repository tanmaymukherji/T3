import React, { useState, useRef } from 'react';
import { terminateWorker } from '../../ocr';
import { smartOcrImage } from '../../smart-ocr';
import { processPdfFile } from '../../pdf-import';
import { saveProject, writeImage, buildHtmlContent } from '../../storage';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function progressLabel({ phase, current, total, file, percent }) {
  const step = current && total ? ` page ${current}/${total}` : '';
  const completion = Number.isFinite(percent) ? ` · ${percent}%` : '';
  return `${phase[0].toUpperCase() + phase.slice(1)}${step}${completion}: ${file}...`;
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
      const imageFiles = items.filter(file => /\.(png|jpe?g|tiff?)$/i.test(file.name));
      const pdfFiles = items.filter(file => /\.pdf$/i.test(file.name));

      if (imageFiles.length === 0 && pdfFiles.length === 0) {
        alert('No PNG, JPG, TIFF, or PDF files found.');
        return;
      }

      const projectId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const name = folderName || `Document_${new Date().toLocaleDateString().replace(/\//g, '-')}`;
      const allParagraphs = [];
      const allImages = [];
      const sources = [];
      let globalPage = 0;
      let pdfIndex = 0;

      // Process in source order so page numbers, source documents and images stay aligned.
      for (const file of items) {
        if (/\.(png|jpe?g|tiff?)$/i.test(file.name)) {
          setProgress(`Scanning: ${file.name}...`);
          try {
            // Try Tesseract first (typed mode); smartOcrImage will fall back
            // to cloud OCR (OCR.Space -> Google Vision) if confidence is low.
            const result = await smartOcrImage(file, (update) => {
              const phase = update.phase === 'local-ocr' ? 'Tesseract'
                : update.phase === 'google-vision' ? 'Google Vision'
                : update.phase === 'cloud-table' ? 'Table OCR'
                : 'Cloud OCR';
              setProgress(`${phase}: ${file.name}...`);
            }, { mode: 'typed' });
            if (result.ignored || !(result.paragraphs || []).length) {
              console.log('Ignoring image without meaningful written content:', file.name);
              continue;
            }
            globalPage++;
            await writeImage(projectId, globalPage, file);
            allImages.push({ page: globalPage, filename: `page_${globalPage}.png` });

            for (const paragraph of (result.paragraphs || [])) {
              const rawText = typeof paragraph === 'string' ? paragraph : paragraph.text || '';
              if (!rawText.trim()) continue;
              allParagraphs.push({
                page: globalPage,
                filename: file.name,
                text: paragraph?.type === 'table' ? rawText : rawText.trim(),
                type: typeof paragraph === 'object' ? paragraph.type : undefined,
                rows: typeof paragraph === 'object' ? paragraph.rows : undefined,
                colCount: typeof paragraph === 'object' ? paragraph.colCount : undefined,
                bbox: typeof paragraph === 'object' ? paragraph.bbox : undefined,
                cells: typeof paragraph === 'object' ? paragraph.cells : undefined,
                lines: typeof paragraph === 'object' && Array.isArray(paragraph.lines) ? paragraph.lines : undefined,
                rotation: typeof paragraph === 'object' ? paragraph.rotation : undefined,
                ocrProvider: result.provider,
                source: 'image_ocr',
              });
            }
          } catch (error) {
            console.error(`OCR failed for ${file.name}:`, error);
          }
        } else if (/\.pdf$/i.test(file.name)) {
          pdfIndex++;
          console.log('processing PDF:', file.name, 'size:', file.size);
          const result = await processPdfFile({
            file,
            projectId,
            sourceId: `pdf_${pdfIndex}`,
            pageOffset: globalPage,
            onProgress: update => setProgress(progressLabel(update)),
          });
          console.log('PDF processed:', file.name, 'mode:', result.source.mode, 'pages:', result.pageCount);
          allParagraphs.push(...result.paragraphs);
          allImages.push(...result.images);
          sources.push(result.source);
          globalPage += result.pageCount;
        }
        await sleep(0);
      }

      if (allParagraphs.length === 0) {
        alert('No text could be extracted.');
        return;
      }

      allParagraphs.forEach((paragraph, index) => {
        paragraph.id = `para_${index}`;
        paragraph.index = index;
        if (paragraph.type === 'table') {
          paragraph.colCount = paragraph.rows?.[0]?.length || 0;
        }
      });

      setProgress('Saving project...');
      await sleep(0);
      const project = await saveProject({
        id: projectId,
        name,
        folder_path: folderName || 'upload',
        content: buildHtmlContent(allParagraphs),
        paragraphsArray: allParagraphs,
        total_paragraphs: allParagraphs.length,
        images: allImages,
        sources,
        documentKind: pdfFiles.length > 0 ? (imageFiles.length > 0 ? 'mixed' : 'pdf') : 'images',
        needsValidation: true,
        isDocx: false,
      });

      onImport(project);
      console.timeEnd('processFiles');
    } catch (error) {
      console.error('Import failed:', error);
      alert('Import failed: ' + error.message);
    } finally {
      terminateWorker();
      setBusy(false);
      setProgress('');
    }
  };

  const handleFolderSelect = async () => {
    console.log('handleFolderSelect started');
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
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'SecurityError') return;
      console.warn('Folder picker not supported, falling back to file upload:', error.message);
      fileInputRef.current?.click();
    }
  };

  const handleFileSelect = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    await processFiles(files, 'Uploaded Files');
    event.target.value = '';
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
