import React, { useState, useRef } from 'react';
import { ocrMultipleImages, terminateWorker } from '../../ocr';

export default function FolderImporter({ onImport, disabled }) {
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  const processFiles = async (files, folderName) => {
    setBusy(true);
    try {
      const imageFiles = Array.from(files).filter((f) =>
        /\.(png|jpe?g|tiff?)$/i.test(f.name)
      );

      if (imageFiles.length === 0) {
        alert('No PNG, JPG, or TIFF images found.');
        setBusy(false);
        return;
      }

      const results = await ocrMultipleImages(imageFiles, () => {});

      // Convert images to base64 for storage
      const allImages = [];
      const allParagraphs = [];
      let paragraphIndex = 0;
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        const r = results[i] || {};
        if (r.error) {
          console.warn(`OCR error for ${r.filename}: ${r.error}`);
        }

        // Convert file to base64
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });

        allImages.push({
          page: r.page || i + 1,
          filename: file.name,
          data: dataUrl,
        });

        for (const text of (r.paragraphs || [])) {
          if (text.trim()) {
            allParagraphs.push({
              id: `para_${paragraphIndex}`,
              index: paragraphIndex,
              page: r.page || i + 1,
              filename: file.name,
              text: text.trim(),
            });
            paragraphIndex++;
          }
        }
      }

      if (allParagraphs.length === 0) {
        alert('No text could be extracted from the images.');
        setBusy(false);
        return;
      }

      const name = folderName || `Document_${new Date().toLocaleDateString().replace(/\//g, '-')}`;

      onImport({
        name,
        folder: folderName || 'upload',
        paragraphs: allParagraphs,
        images: allImages,
      });
    } catch (err) {
      console.error('Import failed:', err);
      alert('Import failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleFolderSelect = async () => {
    try {
      const handle = await window.showDirectoryPicker();
      const files = [];
      for await (const entry of handle.values()) {
        if (entry.kind === 'file' && /\.(png|jpe?g|tiff?)$/i.test(entry.name)) {
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
