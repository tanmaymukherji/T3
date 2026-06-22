import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let pdfjsInstance = null;
let initPromise = null;

export async function initPdfJs() {
  if (pdfjsInstance) return pdfjsInstance;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    pdfjsInstance = pdfjsLib;
    return pdfjsInstance;
  })();
  return initPromise;
}

export async function detectTextPdf(pdfDoc) {
  try {
    const samplePages = Math.min(pdfDoc.numPages, 3);
    for (let i = 1; i <= samplePages; i++) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const usable = isTextContentUsable(content);
      page.cleanup();
      if (usable) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function countTextCharacters(content) {
  return (content?.items || []).reduce(
    (sum, item) => sum + String(item.str || '').replace(/\s/g, '').length,
    0
  );
}

export function isTextContentUsable(content, minimumCharacters = 8) {
  return countTextCharacters(content) >= minimumCharacters;
}

function groupToLines(items) {
  const buckets = {};
  for (const item of items) {
    const y = Math.round(item.transform[5] * 10) / 10;
    if (!buckets[y]) buckets[y] = [];
    buckets[y].push(item);
  }
  const sorted = Object.keys(buckets).map(Number).sort((a, b) => b - a);
  const lines = [];
  for (const y of sorted) {
    const row = buckets[y].sort((a, b) => a.transform[4] - b.transform[4]);
    const fontSize = row[0]?.height || 12;
    let prevEnd = null;
    let text = '';
    const cols = [];
    for (const item of row) {
      const x = item.transform[4];
      const w = item.width || item.str.length * fontSize * 0.5;
      if (prevEnd !== null && x - prevEnd > fontSize * 2) {
        text += '\t' + item.str;
        cols.push({ x: x, x2: x + w });
      } else if (text) {
        text += ' ' + item.str;
        // merge into current column range
        if (cols.length > 0) cols[cols.length - 1].x2 = Math.max(cols[cols.length - 1].x2, x + w);
      } else {
        text = item.str;
        cols.push({ x: x, x2: x + w });
      }
      prevEnd = x + w;
    }
    const t = text.trim();
    if (t) lines.push({ text: t, y, fontSize, cols, items: row });
  }
  return lines;
}

function detectTableRegions(lines) {
  if (!lines.length) return [];
  // Mark each line with how many columns it has (tabs + 1)
  const tabCounts = lines.map(l => (l.text.match(/\t/g) || []).length);
  const colCounts = tabCounts.map(c => c + 1);

  const regions = []; // { start, end, colCount } for each table region
  let i = 0;
  while (i < lines.length) {
    // Skip lines with 1 column
    if (colCounts[i] < 2) { i++; continue; }
    // Start of potential table
    const start = i;
    const expectedColCount = colCounts[i];
    while (i < lines.length && colCounts[i] === expectedColCount &&
           lines[i].cols && lines[i].cols.length === expectedColCount) {
      // Check column X-positions are consistent
      if (i > start) {
        const prev = lines[i - 1].cols;
        const cur = lines[i].cols;
        let match = true;
        for (let c = 0; c < expectedColCount; c++) {
          const xDiff = prev[c] ? Math.abs(prev[c].x - cur[c].x) : 0;
          if (xDiff > 20) { match = false; break; }
        }
        if (!match) break;
      }
      i++;
    }
    if (i - start >= 3) {
      regions.push({ start, end: i, colCount: expectedColCount });
    }
  }
  return regions;
}

function groupLinesToParagraphs(lines) {
  if (!lines.length) return [];
  const result = [];
  let cur = [];
  for (let i = 0; i < lines.length; i++) {
    const prev = i > 0 ? lines[i - 1] : null;
    const gap = prev ? lines[i].y - prev.y : 0;
    const pageBreak = prev ? lines[i].page !== prev.page : false;
    if (pageBreak || gap > (lines[i].fontSize || 12) * 2.5) {
      if (cur.length) { result.push({ text: cur.map(l => l.text).join('\n'), page: cur[0].page }); cur = []; }
    }
    cur.push(lines[i]);
  }
  if (cur.length) result.push({ text: cur.map(l => l.text).join('\n'), page: cur[0].page });
  return result;
}

function buildTableBlock(lines, region) {
  const rows = [];
  for (let i = region.start; i < region.end; i++) {
    const l = lines[i];
    const cells = l.text.split('\t');
    rows.push(cells);
  }
  return rows;
}

function yieldFrame() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
    else setTimeout(resolve, 0);
  });
}

function linesToParagraphs(allLines) {
  const tableRegions = detectTableRegions(allLines);
  // Build result: interleave paragraph and table blocks
  const result = [];
  let lastEnd = 0;
  for (const region of tableRegions) {
    // Paragraphs before this table
    if (region.start > lastEnd) {
      const paras = groupLinesToParagraphs(allLines.slice(lastEnd, region.start));
      for (const p of paras) {
        result.push({ text: p.text, source: 'pdf_text', page: p.page || 1 });
      }
    }
    // Table block
    const rows = buildTableBlock(allLines, region);
    const tableText = rows.map(r => r.join('\t')).join('\n');
    result.push({
      text: tableText,
      source: 'pdf_text',
      page: allLines[region.start].page || 1,
      type: 'table',
      rows: rows,
    });
    lastEnd = region.end;
  }
  // Remaining paragraphs after last table
  if (lastEnd < allLines.length) {
    const paras = groupLinesToParagraphs(allLines.slice(lastEnd));
    for (const p of paras) {
      result.push({ text: p.text, source: 'pdf_text', page: p.page || 1 });
    }
  }

  return result;
}

export async function extractPageParagraphs(page, pageNumber, content = null) {
  const pageContent = content || await page.getTextContent();
  const lines = groupToLines(pageContent.items);
  for (const line of lines) line.page = pageNumber;
  return linesToParagraphs(lines);
}

export async function extractTextParagraphs(pdfDoc) {
  const result = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const paragraphs = await extractPageParagraphs(page, i);
    result.push(...paragraphs);
    page.cleanup();
    await yieldFrame();
  }
  return result;
}

export function getSafeRenderScale(page, preferredScale = 2, maxPixels = 5_000_000) {
  const base = page.getViewport({ scale: 1 });
  const preferredPixels = base.width * base.height * preferredScale * preferredScale;
  if (preferredPixels <= maxPixels) return preferredScale;
  return Math.max(1, Math.sqrt(maxPixels / (base.width * base.height)));
}

export async function renderPageToFile(page, scale, filename, format = 'png') {
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width;
  canvas.height = vp.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) {
        reject(new Error(`Could not encode rendered PDF page: ${filename}`));
        return;
      }
      resolve(new File([blob], filename, { type: mime }));
    }, mime, format === 'jpeg' ? 0.85 : undefined);
  });
}
