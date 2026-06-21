import React, { useState, useRef } from 'react';
import { ocrMultipleImages, terminateWorker } from '../../ocr';

/**
 * FolderImporter - handles importing images via:
 * 1. File System Access API (folder picker) - Chrome/Edge
 * 2. Standard file upload (multi-select) - all browsers
 * 
 * Runs OCR entirely in the browser using Tesseract.js.
 */
export default function FolderImporter({ onImport, disabled }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null);
  const fileInputRef = useRef(null);

  const processFiles = async (files, folderName) => {
    setBusy(true);
    try {
      const imageFiles = Array.from(files).filter((f) =>
        /\.(png|jpe?g|tiff?)$/i.test(f.name)
      );

      if (imageFiles.length === 0) {
        alert('No PNG, JPG, or TIFF images found in the selected files.');
        setBusy(false);
        return;
      }

      // Set up progress callback
      const onProgress = (p) => {
        // Progress is handled via the callback to App
      };

      // Run OCR
      const results = await ocrMultipleImages(imageFiles, (p) => {});

      // Collect all paragraphs
      const allParagraphs = [];
      for (const r of results) {
        if (r.error) {
          console.warn(`OCR error for ${r.filename}: ${r.error}`);
        }
        for (const p of r.paragraphs) {
          if (p.trim()) allParagraphs.push(p.trim());
        }
      }

      if (allParagraphs.length === 0) {
        alert(
          'No text could be extracted from the images. ' +
          'This may happen if:\n' +
          '- The images contain no readable text\n' +
          '- Tesseract.js failed to load (check browser console)\n' +
          '- The image format is not supported'
        );
        setBusy(false);
        return;
      }

      const name = folderName || `Document_${new Date().toLocaleDateString().replace(/\//g, '-')}`;

      onImport({
        name,
        folder: folderName || 'upload',
        paragraphs: allParagraphs,
        results,
      });
    } catch (err) {
      console.error('Import failed:', err);
      alert('Import failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleFolderSelect = async () => {
    // File System Access API - Chrome/Edge only
    try {
      const handle = await window.showDirectoryPicker();
      const files = [];
      for await (const entry of handle.values()) {
        if (entry.kind === 'file' && /\.(png|jpe?g|tiff?)$/i.test(entry.name)) {
          const file = await entry.getFile();
          // Preserve the original file name
          Object.defineProperty(file, 'name', { value: entry.name });
          files.push(file);
        }
      }
      await processFiles(files, handle.name);
    } catch (err) {
      if (err.name === 'AbortError' || err.name === 'SecurityError') {
        return; // User cancelled or permission denied
      }
      // Fallback to file input
      console.warn('Folder picker not supported, falling back to file upload:', err.message);
      fileInputRef.current?.click();
    }
  };

  const handleFileSelect = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processFiles(files, 'Uploaded Images');
    e.target.value = ''; // Reset so same files can be re-selected
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/tiff"
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
