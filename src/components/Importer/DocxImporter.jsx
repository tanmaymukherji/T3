import React, { useState, useRef } from 'react';
import * as mammoth from 'mammoth';
import { initPdfJs, detectTextPdf, extractTextParagraphs, renderPageToDataUrl, renderPageToFile } from '../../pdf-utils';
import { ocrMultipleImages } from '../../ocr';

export default function DocxImporter({ onImport, disabled }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const fileInputRef = useRef(null);

  const processDocx = async (file, handle) => {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const html = result.value;

    const div = document.createElement('div');
    div.innerHTML = html;
    const paraElements = div.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');

    const allParagraphs = [];
    let page = 1;
    for (const el of paraElements) {
      const text = el.innerText.trim();
      if (text) {
        allParagraphs.push({
          id: `para_${allParagraphs.length}`,
          index: allParagraphs.length,
          page,
          filename: file.name,
          text,
        });
      }
    }

    const pageBreakEls = div.querySelectorAll('[style*="page-break"], hr');
    if (pageBreakEls.length === 0) {
      if (allParagraphs.length > 50) {
        const perPage = Math.ceil(allParagraphs.length / Math.ceil(allParagraphs.length / 15));
        for (let i = 0; i < allParagraphs.length; i++) {
          allParagraphs[i].page = Math.floor(i / perPage) + 1;
        }
      }
    } else {
      page = 1;
      for (let i = 0; i < allParagraphs.length; i++) {
        const el = paraElements[i];
        if (el && (el.matches('hr') || getComputedStyle(el).pageBreakAfter === 'always')) {
          page++;
        }
        allParagraphs[i].page = page;
      }
    }

    if (allParagraphs.length === 0) {
      alert('No text could be extracted from the document.');
      return;
    }

    const name = file.name.replace(/\.docx$/i, '') || 'Untitled Document';

    onImport({
      name,
      folder: file.name,
      paragraphs: allParagraphs,
      isDocx: true,
      fileHandle: handle || null,
    });
  };

  const processPdf = async (file, handle) => {
    console.log('[processPdf] START - reading file');
    setStatus('Reading file...');
    const buf = await file.arrayBuffer();
    console.log('[processPdf] file read, size:', buf.byteLength);
    setStatus('Initializing PDF.js...');
    const pdfjs = await initPdfJs();
    console.log('[processPdf] pdfjs initialized');
    setStatus('Loading PDF document...');
    const t0 = performance.now();
    const doc = await pdfjs.getDocument({data: new Uint8Array(buf)}).promise;
    console.log('[processPdf] doc loaded, pages:', doc.numPages, 'in', (performance.now() - t0).toFixed(0), 'ms');
    setStatus('Detecting if text PDF...');
    const isText = await detectTextPdf(doc);
    console.log('[processPdf] detectTextPdf:', isText);

    if (isText) {
      console.log('[processPdf] text PDF - extracting paragraphs');
      setStatus('Extracting text from PDF...');
      const t1 = performance.now();
      const paragraphs = await extractTextParagraphs(doc);
      console.log('[processPdf] extracted', paragraphs.length, 'paragraphs in', (performance.now() - t1).toFixed(0), 'ms');
      const name = file.name.replace(/\.pdf$/i, '') || 'Untitled Document';
        doc.loadingTask.destroy();
      if (paragraphs.length === 0) {
        alert('No text could be extracted from the PDF.');
        return;
      }
      const allParagraphs = paragraphs.map((p, i) => {
        const entry = {
          id: `para_${i}`,
          index: i,
          page: p.page || 1,
          filename: file.name,
          text: p.text,
          source: 'pdf_text',
        };
        if (p.type === 'table') {
          entry.type = 'table';
          entry.rows = p.rows;
          entry.colCount = p.rows && p.rows.length > 0 ? p.rows[0].length : 0;
        }
        return entry;
      });
      console.log('[processPdf] calling onImport for text PDF');
      setStatus('');
      onImport({
        name,
        folder: file.name,
        paragraphs: allParagraphs,
        isDocx: true,
        fileHandle: handle || null,
      });
    } else {
      console.log('[processPdf] scanned PDF - rendering pages');
      setStatus('Rendering PDF pages...');
      const rendered = [];
      for (let i = 1; i <= doc.numPages; i++) {
        console.log('[processPdf] rendering page', i);
        setStatus(`Rendering page ${i}/${doc.numPages}...`);
        const t1 = performance.now();
        const page = await doc.getPage(i);
        const f = await renderPageToFile(page, 3.0, `${file.name}_p${i}.png`);
        console.log('[processPdf] page', i, 'rendered in', (performance.now() - t1).toFixed(0), 'ms, size:', f.size);
        rendered.push(f);
        page.cleanup();
      }
        doc.loadingTask.destroy();

      if (rendered.length === 0) {
        alert('Could not render PDF pages.');
        return;
      }

      console.log('[processPdf] starting OCR on', rendered.length, 'images');
      setStatus('Running OCR (this may take a while)...');
      const tOcr = performance.now();
      const ocrResults = await ocrMultipleImages(rendered, () => {});
      console.log('[processPdf] OCR done in', (performance.now() - tOcr).toFixed(0), 'ms');

      const allImages = [];
      const allParagraphs = [];
      let paragraphIndex = 0;
      for (let i = 0; i < rendered.length; i++) {
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(rendered[i]);
        });
        allImages.push({ page: i + 1, filename: `${file.name}_p${i + 1}`, data: dataUrl });

        const r = ocrResults[i] || {};
        for (const para of (r.paragraphs || [])) {
          const text = (typeof para === 'string' ? para : (para.text || '')).trim();
          if (text) {
            allParagraphs.push({
              id: `para_${paragraphIndex}`,
              index: paragraphIndex,
              page: i + 1,
              filename: file.name,
              text,
              lines: typeof para === 'object' && Array.isArray(para.lines) ? para.lines : undefined,
            });
            paragraphIndex++;
          }
        }
      }

      const name = file.name.replace(/\.pdf$/i, '') || 'Untitled Document';
      console.log('[processPdf] calling onImport for scanned PDF');
      onImport({
        name,
        folder: file.name,
        paragraphs: allParagraphs,
        images: allImages,
      });
    }
  };

  const processFile = async (file, handle) => {
    console.log('[DocxImporter] processFile called', file.name, file.size);
    setBusy(true);
    setStatus('Starting import...');
    const timeoutId = setTimeout(() => {
      setStatus('Still working... (this is taking longer than expected)');
    }, 30000);
    try {
      if (/\.docx$/i.test(file.name)) {
        console.log('[DocxImporter] routing to processDocx');
        setStatus('Processing DOCX...');
        await processDocx(file, handle);
        console.log('[DocxImporter] processDocx done');
      } else if (/\.pdf$/i.test(file.name)) {
        console.log('[DocxImporter] routing to processPdf, size:', file.size);
        const t0 = performance.now();
        await processPdf(file, handle);
        console.log('[DocxImporter] processPdf done in', (performance.now() - t0).toFixed(0), 'ms');
      } else {
        alert('Please select a .docx or .pdf file.');
      }
    } catch (err) {
      console.error('[DocxImporter] Import failed:', err);
      alert('Import failed: ' + err.message);
    } finally {
      clearTimeout(timeoutId);
      console.log('[DocxImporter] processFile finally - setting busy false');
      setBusy(false);
      setStatus('');
    }
  };

  const handleClick = () => {
    console.log('[DocxImporter] handleClick');
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    console.error('[DocxImporter] FILE SELECTED:', file.name, file.size);
    if (!file.name.toLowerCase().endsWith('.docx') && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('Please select a .docx or .pdf file.');
      e.target.value = '';
      return;
    }
    e.target.value = '';
    processFile(file, null).catch((err) => {
      console.error('[DocxImporter] unhandled error:', err);
    });
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.pdf"
        onChange={handleFileChange}
        className="hidden"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={handleClick}
          disabled={disabled || busy}
          className="bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 rounded text-sm disabled:opacity-50 flex items-center gap-1.5"
        >
          {busy ? 'Importing...' : '+ Import DOCX/PDF'}
        </button>
        {busy && status && <span className="text-xs text-gray-400">{status}</span>}
      </div>
    </>
  );
}
