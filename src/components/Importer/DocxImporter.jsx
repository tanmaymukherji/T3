import React, { useState, useRef } from 'react';
import * as mammoth from 'mammoth';
import { terminateWorker } from '../../ocr';
import { processPdfFile } from '../../pdf-import';
import { saveProject, buildHtmlContent } from '../../storage';

function progressLabel({ phase, current, total, percent }) {
  const step = current && total ? ` ${current}/${total}` : '';
  const completion = Number.isFinite(percent) ? ` · ${percent}%` : '';
  return `${phase[0].toUpperCase() + phase.slice(1)}${step}${completion}...`;
}

export default function DocxImporter({ onImport, disabled }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const fileInputRef = useRef(null);

  const processDocx = async (file) => {
    setProgress('Reading DOCX...');
    const projectId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const div = document.createElement('div');
    div.innerHTML = result.value;
    const paraElements = div.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');

    const allParagraphs = [];
    for (const element of paraElements) {
      const text = element.innerText.trim();
      if (!text) continue;
      allParagraphs.push({
        id: `para_${allParagraphs.length}`,
        index: allParagraphs.length,
        page: 1,
        filename: file.name,
        text,
      });
    }

    const pageBreakElements = div.querySelectorAll('[style*="page-break"], hr');
    if (pageBreakElements.length === 0 && allParagraphs.length > 50) {
      const perPage = Math.ceil(allParagraphs.length / Math.ceil(allParagraphs.length / 15));
      for (let i = 0; i < allParagraphs.length; i++) {
        allParagraphs[i].page = Math.floor(i / perPage) + 1;
      }
    } else if (pageBreakElements.length > 0) {
      let page = 1;
      for (let i = 0; i < allParagraphs.length; i++) {
        const element = paraElements[i];
        if (element && (element.matches('hr') || getComputedStyle(element).pageBreakAfter === 'always')) {
          page++;
        }
        allParagraphs[i].page = page;
      }
    }

    if (allParagraphs.length === 0) {
      alert('No text could be extracted from the document.');
      return;
    }

    const project = await saveProject({
      id: projectId,
      name: file.name.replace(/\.docx$/i, '') || 'Untitled Document',
      folder_path: file.name,
      content: buildHtmlContent(allParagraphs),
      paragraphsArray: allParagraphs,
      total_paragraphs: allParagraphs.length,
      images: [],
      sources: [],
      documentKind: 'docx',
      needsValidation: false,
      isDocx: true,
    });

    onImport(project);
  };

  const processPdf = async (file) => {
    console.time(`pdf-import:${file.name}`);
    console.log('PDF import started:', file.name, 'size:', file.size);
    const projectId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const result = await processPdfFile({
      file,
      projectId,
      sourceId: 'pdf_1',
      onProgress: update => {
        setProgress(progressLabel(update));
        console.log('PDF import progress:', update.phase, update.current || '', update.total || '');
      },
    });

    if (result.paragraphs.length === 0) {
      alert('No text could be extracted from the PDF.');
      return;
    }

    result.paragraphs.forEach((paragraph, index) => {
      paragraph.id = `para_${index}`;
      paragraph.index = index;
      if (paragraph.type === 'table') paragraph.colCount = paragraph.rows?.[0]?.length || 0;
    });

    const project = await saveProject({
      id: projectId,
      name: file.name.replace(/\.pdf$/i, '') || 'Untitled Document',
      folder_path: file.name,
      content: buildHtmlContent(result.paragraphs),
      paragraphsArray: result.paragraphs,
      total_paragraphs: result.paragraphs.length,
      images: result.images,
      sources: [result.source],
      documentKind: 'pdf',
      needsValidation: true,
      isDocx: false,
    });

    console.log('PDF import complete:', file.name, 'mode:', result.source.mode, 'paragraphs:', result.paragraphs.length);
    console.timeEnd(`pdf-import:${file.name}`);
    onImport(project);
  };

  const processFile = async (file) => {
    setBusy(true);
    try {
      if (/\.docx$/i.test(file.name)) await processDocx(file);
      else if (/\.pdf$/i.test(file.name)) await processPdf(file);
      else alert('Please select a .docx or .pdf file.');
    } catch (error) {
      console.error('Import failed:', error);
      alert('Import failed: ' + error.message);
    } finally {
      terminateWorker();
      setBusy(false);
      setProgress('');
    }
  };

  const handleClick = () => {
    if ('showOpenFilePicker' in window) {
      window.showOpenFilePicker({
        multiple: false,
        types: [{ accept: {
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
          'application/pdf': ['.pdf'],
        }}],
      }).then(async ([handle]) => {
        const file = await handle.getFile();
        if (!/\.(docx|pdf)$/i.test(file.name)) {
          alert('Please select a .docx or .pdf file.');
          return;
        }
        await processFile(file);
      }).catch((error) => {
        if (error.name !== 'AbortError') fileInputRef.current?.click();
      });
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.(docx|pdf)$/i.test(file.name)) {
      alert('Please select a .docx or .pdf file.');
      event.target.value = '';
      return;
    }
    await processFile(file);
    event.target.value = '';
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,application/pdf"
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        onClick={handleClick}
        disabled={disabled || busy}
        className="bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 rounded text-sm disabled:opacity-50 flex items-center gap-1.5"
      >
        {busy ? (progress || 'Importing...') : '+ Import DOCX/PDF'}
      </button>
    </>
  );
}
