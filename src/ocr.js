// Client-side OCR using Tesseract.js (WebAssembly, runs entirely in browser)

import { createWorker } from 'tesseract.js';

let worker = null;
let progressCallback = null;

export function onProgress(cb) {
  progressCallback = cb;
}

async function getWorker() {
  if (worker) return worker;
  worker = await createWorker('hin+eng+san', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && progressCallback) {
        progressCallback(m.progress);
      }
    },
  });
  return worker;
}

export async function ocrImage(imageFile, onProgressFn) {
  if (onProgressFn) progressCallback = onProgressFn;

  const w = await getWorker();
  const { data } = await w.recognize(imageFile);

  // Extract paragraphs from the result
  const paragraphs = [];
  let currentPara = [];

  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      const text = para.text?.trim();
      if (text) {
        paragraphs.push(text);
      }
    }
  }

  // Fallback: split raw text into paragraphs
  if (paragraphs.length === 0 && data.text) {
    const lines = data.text.split('\n').filter((l) => l.trim());
    let current = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '' && current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      } else if (trimmed) {
        current.push(trimmed);
      }
    }
    if (current.length > 0) paragraphs.push(current.join(' '));
  }

  return {
    text: data.text,
    paragraphs,
    wordCount: data.text ? data.text.split(/\s+/).filter(Boolean).length : 0,
  };
}

export async function ocrMultipleImages(files, onProgress) {
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress({ current: i + 1, total: files.length, file: file.name, phase: 'ocr' });
    try {
      const result = await ocrImage(file, (p) => {
        onProgress({ current: i + 1, total: files.length, file: file.name, phase: 'ocr', percent: p });
      });
      results.push({ filename: file.name, ...result });
    } catch (err) {
      console.error(`OCR failed for ${file.name}:`, err);
      results.push({ filename: file.name, text: '', paragraphs: [], wordCount: 0, error: err.message });
    }
  }
  return results;
}

export function terminateWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}
