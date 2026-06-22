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
    const t = row.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
    if (t) lines.push({ text: t, y, fontSize: row[0]?.height || 12 });
  }
  return lines;
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
  return groupLinesToParagraphs(allLines).map((p, idx) => ({
    text: p.text,
    source: 'pdf_text',
    page: p.page || 1,
  }));
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
