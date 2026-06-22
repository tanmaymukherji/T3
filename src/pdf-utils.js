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
    const page = await pdfDoc.getPage(1);
    const content = await page.getTextContent();
    const chars = content.items.reduce((s, i) => s + (i.str || '').length, 0);
    page.cleanup();
    return chars >= 30;
  } catch {
    return false;
  }
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

export async function extractTextParagraphs(pdfDoc) {
  const allLines = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    const lines = groupToLines(content.items);
    for (const l of lines) l.page = i;
    allLines.push(...lines);
    page.cleanup();
  }

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

export async function renderPageToDataUrl(page, scale) {
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width;
  canvas.height = vp.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas.toDataURL('image/png');
}

export async function renderPageToFile(page, scale, filename) {
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width;
  canvas.height = vp.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(new File([blob], filename, { type: 'image/png' })), 'image/png');
  });
}
