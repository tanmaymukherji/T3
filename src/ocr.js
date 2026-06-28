import { createWorker } from 'tesseract.js';
import { bboxOverlapRatio, collectTesseractWords, detectTableBlocks, unionBboxes } from './table-structure.js';

let worker = null;
let progressCallback = null;

export function onProgress(cb) {
  progressCallback = cb;
}

async function getWorker() {
  if (worker) return worker;
  worker = await createWorker('hin+eng+san', 3, {
    cacheMethod: 'none',
    logger: (m) => {
      if (m.status === 'recognizing text' && progressCallback) {
        progressCallback(m.progress);
      }
      if (m.status === 'loading tesseract core' && progressCallback) {
        progressCallback(0);
      }
    },
  });
  await worker.setParameters({
    tessedit_pageseg_mode: '3', // PSM_AUTO – automatic page segmentation
  });
  return worker;
}

function computeLineBbox(line) {
  if (line.bbox && typeof line.bbox.x0 === 'number') return line.bbox;
  // Tesseract.js v7 puts bbox at word level; compute line bbox from words
  if (line.words && line.words.length > 0) {
    const valid = line.words.filter(w => w.bbox && typeof w.bbox.x0 === 'number');
    if (valid.length > 0) {
      return {
        x0: Math.min(...valid.map(w => w.bbox.x0)),
        y0: Math.min(...valid.map(w => w.bbox.y0)),
        x1: Math.max(...valid.map(w => w.bbox.x1)),
        y1: Math.max(...valid.map(w => w.bbox.y1)),
      };
    }
  }
  return undefined;
}

function groupLinesIntoParagraphs(lines) {
  if (!lines || lines.length === 0) return [];

  const paragraphs = [];
  let current = [];
  let currentLines = [];
  let prevBottom = null;

  for (const line of lines) {
    const text = (line.text || '').trim();
    if (!text) continue;

    const bbox = line.bbox;
    const lineTop = bbox ? bbox.y0 : 0;
    const lineBottom = bbox ? bbox.y1 : 0;

    if (prevBottom !== null && bbox) {
      const gap = lineTop - prevBottom;
      const lineHeight = lineBottom - lineTop;

      // Only start a new paragraph if the gap is large (>2.5x line height)
      // AND the current paragraph has at least 2 lines, or the new line is long
      const wouldBeSingle = current.length === 0;
      if (gap > lineHeight * 2.5 && !wouldBeSingle) {
        if (current.length > 0) {
          paragraphs.push({ text: current.join('\n').trim(), lines: currentLines, bbox: unionBboxes(currentLines) });
          current = [];
          currentLines = [];
        }
      }
    }

    current.push(text);
    currentLines.push({ text, bbox });
    if (bbox) prevBottom = lineBottom;
  }

  if (current.length > 0) {
    paragraphs.push({ text: current.join('\n').trim(), lines: currentLines, bbox: unionBboxes(currentLines) });
  }

  return paragraphs;
}

export async function ocrImage(imageFile, onProgressFn, options = {}) {
  if (onProgressFn) progressCallback = onProgressFn;

  const w = await getWorker();
  // Tesseract.js v6+ returns text only by default. Explicitly request blocks so
  // word bounding boxes are available for paragraph and table reconstruction.
  let { data } = await w.recognize(imageFile, {}, { text: true, blocks: true });

  // Ruled tables can cause automatic segmentation to see only a few isolated
  // cells. On sparse pages (and explicit table rescans), retry with sparse-text
  // segmentation and keep it only when it recovers materially more words.
  const initialWordCount = collectTesseractWords(data.blocks || []).length;
  if (options.forceSparse || initialWordCount < 12) {
    await w.setParameters({ tessedit_pageseg_mode: '12', preserve_interword_spaces: '1' });
    try {
      const sparseResult = await w.recognize(imageFile, {}, { text: true, blocks: true });
      const sparseWordCount = collectTesseractWords(sparseResult.data.blocks || []).length;
      if (sparseWordCount >= initialWordCount + 3) data = sparseResult.data;
    } finally {
      await w.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '0' });
    }
  }

  let paragraphs = [];

  // Strategy 1: Use Tesseract's paragraph detection with preserved line breaks and bbox
  if (data.blocks && data.blocks.length > 0) {
    for (const block of data.blocks) {
      if (!block.paragraphs) continue;
      for (const para of block.paragraphs) {
        if (!para.lines || para.lines.length === 0) {
          const text = para.text?.trim();
          if (text) paragraphs.push({ text, lines: [], bbox: para.bbox });
        } else {
          const lines = para.lines
            .map((l) => ({ text: (l.text || '').trim(), bbox: computeLineBbox(l) }))
            .filter((l) => l.text);
          if (lines.length > 0) {
            paragraphs.push({
              text: lines.map((l) => l.text).join('\n'),
              lines,
              bbox: unionBboxes(lines),
            });
          }
        }
      }
    }
  }

  // Strategy 2: Fall back to line-level paragraph grouping
  if (paragraphs.length <= 1 && data.blocks) {
    const allLines = [];
    for (const block of data.blocks) {
      if (block.paragraphs) {
        for (const para of block.paragraphs) {
          if (para.lines) {
            for (const l of para.lines) {
              allLines.push({ text: l.text, bbox: computeLineBbox(l) });
            }
          }
        }
      }
    }
    const grouped = groupLinesIntoParagraphs(allLines);
    if (grouped.length > 0) {
      paragraphs = grouped;
    }
  }

  // Strategy 3: Last resort – split data.text by blank lines
  if (paragraphs.length <= 1 && data.text) {
    const raw = data.text;
    const parts = raw.split(/\n\s*\n/);
    const filtered = parts.map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean);
    if (filtered.length > 1) {
      paragraphs = filtered.map((text) => ({ text, lines: [] }));
    } else {
      // Single block: keep internal line breaks
      const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length > 1) {
        // Try to detect paragraph boundaries from short lines or indentation
        let groups = [];
        let cur = [];
        for (const line of lines) {
          const isShort = line.length < 30;
          const isIndented = line.length > 0 && line[0] === ' ';
          if (isShort && cur.length > 0) {
            cur.push(line);
            groups.push(cur.join('\n'));
            cur = [];
          } else {
            cur.push(line);
          }
        }
        if (cur.length > 0) groups.push(cur.join('\n'));
        if (groups.length >= 1) paragraphs = groups.map((text) => ({ text, lines: [] }));
        else paragraphs = [{ text: raw.replace(/\n/g, ' ').trim(), lines: [] }];
      } else {
        paragraphs = [{ text: raw.trim(), lines: [] }];
      }
    }
  }

  // Reconstruct tables from word geometry after all paragraph fallbacks, then
  // remove prose blocks covering the same region. A table remains one block.
  const words = collectTesseractWords(data.blocks || []);
  const tables = detectTableBlocks(words);
  if (tables.length > 0) {
    paragraphs = paragraphs.flatMap((paragraph) => {
      if (paragraph.lines?.length) {
        const lines = paragraph.lines.filter((line) => !tables.some((table) => bboxOverlapRatio(line.bbox, table.bbox) >= 0.5));
        if (!lines.length) return [];
        return [{ ...paragraph, lines, text: lines.map((line) => line.text).join('\n'), bbox: unionBboxes(lines) }];
      }
      return tables.some((table) => bboxOverlapRatio(paragraph.bbox, table.bbox) >= 0.35) ? [] : [paragraph];
    });
    paragraphs = [...paragraphs, ...tables].sort((a, b) => {
      if (!a.bbox && !b.bbox) return 0;
      if (!a.bbox) return 1;
      if (!b.bbox) return -1;
      return a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0;
    });
  }

  // Compute average word confidence from Tesseract's per-word confidence.
  // Tesseract.js places per-word confidence in the `confidence` property on
  // each word object inside blocks → paragraphs → lines → words.
  let confidence = 0;
  let wordCount = 0;
  if (data.blocks) {
    for (const block of data.blocks) {
      if (!block.paragraphs) continue;
      for (const para of block.paragraphs) {
        if (!para.lines) continue;
        for (const line of para.lines) {
          if (!line.words) continue;
          for (const word of line.words) {
            if (typeof word.confidence === 'number') {
              confidence += word.confidence;
              wordCount++;
            }
          }
        }
      }
    }
  }
  const avgConfidence = wordCount > 0 ? confidence / wordCount : 0;

  return {
    text: data.text,
    paragraphs,
    wordCount: data.text ? data.text.split(/\s+/).filter(Boolean).length : 0,
    confidence: avgConfidence,
  };
}

export async function reOcrTableRegion(imageData, bbox, onProgressFn) {
  const source = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the page image.'));
    image.src = imageData;
  });
  const paddingX = Math.max(24, (bbox.x1 - bbox.x0) * 0.04);
  const paddingY = Math.max(18, (bbox.y1 - bbox.y0) * 0.18);
  const x = Math.max(0, Math.floor(bbox.x0 - paddingX));
  const y = Math.max(0, Math.floor(bbox.y0 - paddingY));
  const width = Math.min(source.naturalWidth - x, Math.ceil(bbox.x1 - bbox.x0 + paddingX * 2));
  const height = Math.min(source.naturalHeight - y, Math.ceil(bbox.y1 - bbox.y0 + paddingY * 2));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, x, y, width, height, 0, 0, width, height);
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not prepare the table image.')), 'image/png'));
  const result = await ocrImage(blob, onProgressFn, { forceSparse: true });
  const table = result.paragraphs.find((paragraph) => paragraph.type === 'table');
  if (!table) throw new Error('No stable table grid was found in this region.');
  const offsetBox = (box) => box ? ({ x0: box.x0 + x, y0: box.y0 + y, x1: box.x1 + x, y1: box.y1 + y }) : undefined;
  return {
    ...table,
    bbox: offsetBox(table.bbox),
    cells: (table.cells || []).map((cell) => ({ ...cell, bbox: offsetBox(cell.bbox) })),
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
      results.push({ filename: file.name, page: i + 1, ...result });
    } catch (err) {
      console.error(`OCR failed for ${file.name}:`, err);
      results.push({ filename: file.name, page: i + 1, text: '', paragraphs: [], wordCount: 0, error: err.message });
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
