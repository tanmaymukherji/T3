import { createWorker } from 'tesseract.js';

let worker = null;
let reOcrWorker = null;
let progressCallback = null;

export function onProgress(cb) {
  progressCallback = cb;
}

async function getWorker() {
  if (worker) return worker;
  worker = await createWorker('hin+eng+san', 1, {
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

export async function getReOcrWorker() {
  if (reOcrWorker) return reOcrWorker;
  reOcrWorker = await createWorker('hin+eng+san', 1, {
    cacheMethod: 'none',
    logger: () => {},
  });
  // Use single-line mode for re-OCR on cropped regions
  await reOcrWorker.setParameters({
    tessedit_pageseg_mode: '7',
  });
  return reOcrWorker;
}

function groupLinesIntoParagraphs(lines) {
  if (!lines || lines.length === 0) return [];

  const paragraphs = [];
  let current = [];
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
          paragraphs.push(current.join('\n').trim());
          current = [];
        }
      }
    }

    current.push(text);
    if (bbox) prevBottom = lineBottom;
  }

  if (current.length > 0) {
    paragraphs.push(current.join('\n').trim());
  }

  return paragraphs;
}

export async function ocrImage(imageFile, onProgressFn) {
  if (onProgressFn) progressCallback = onProgressFn;

  const w = await getWorker();
  const { data } = await w.recognize(imageFile);

  let paragraphs = [];

  // Strategy 1: Use Tesseract's paragraph detection with preserved line breaks and bbox
  if (data.blocks && data.blocks.length > 0) {
    for (const block of data.blocks) {
      if (!block.paragraphs) continue;
      for (const para of block.paragraphs) {
        if (!para.lines || para.lines.length === 0) {
          const text = para.text?.trim();
          if (text) paragraphs.push({ text, lines: [] });
        } else {
          const lines = para.lines
            .map((l) => ({ text: (l.text || '').trim(), bbox: l.bbox }))
            .filter((l) => l.text);
          if (lines.length > 0) {
            paragraphs.push({
              text: lines.map((l) => l.text).join('\n'),
              lines,
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
          if (para.lines) allLines.push(...para.lines);
        }
      }
    }
    const grouped = groupLinesIntoParagraphs(allLines);
    if (grouped.length > 0) {
      paragraphs = grouped.map((text) => ({ text, lines: [] }));
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
