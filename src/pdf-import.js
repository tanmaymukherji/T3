import {
  initPdfJs,
  isTextContentUsable,
  extractPageParagraphs,
  getSafeRenderScale,
  renderPageToFile,
} from './pdf-utils';
import { smartOcrImage, rescanDetectedPdfTables } from './smart-ocr.js';
import { writeImage, writeSourceDocument } from './storage';

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export async function processPdfFile({
  file,
  projectId,
  sourceId,
  pageOffset = 0,
  onProgress = () => {},
}) {
  const sourceStorageName = await writeSourceDocument(projectId, sourceId, file);
  const buffer = await file.arrayBuffer();
  const pdfjs = await initPdfJs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  let pdfDoc = null;

  try {
    onProgress({ phase: 'loading', file: file.name });
    pdfDoc = await loadingTask.promise;
    const paragraphs = [];
    const images = [];
    const pageModes = [];

    for (let sourcePage = 1; sourcePage <= pdfDoc.numPages; sourcePage++) {
      const globalPage = pageOffset + sourcePage;
      const page = await pdfDoc.getPage(sourcePage);
      const content = await page.getTextContent();
      const textPage = isTextContentUsable(content);

      if (textPage) {
        onProgress({ phase: 'extracting', file: file.name, current: sourcePage, total: pdfDoc.numPages });
        let pageParagraphs = await extractPageParagraphs(page, sourcePage, content);
        if (pageParagraphs.some((paragraph) => paragraph.type === 'table' && paragraph.bbox)) {
          const scale = getSafeRenderScale(page);
          const tablePage = await renderPageToFile(page, scale, `${sourceId}_table_page_${sourcePage}.jpg`, 'jpeg');
          pageParagraphs = await rescanDetectedPdfTables(page, pageParagraphs, tablePage, scale, (update) => onProgress({
            ...update,
            file: file.name,
            current: sourcePage,
            total: pdfDoc.numPages,
          }));
        }
        for (const paragraph of pageParagraphs) {
          paragraphs.push({
            ...paragraph,
            page: globalPage,
            filename: file.name,
            source: 'pdf_text',
            sourceId,
            sourcePage,
          });
        }
        pageModes.push('text');
      } else {
        onProgress({ phase: 'rendering', file: file.name, current: sourcePage, total: pdfDoc.numPages });
        const scale = getSafeRenderScale(page);
        let rendered = await renderPageToFile(page, scale, `${sourceId}_page_${sourcePage}.png`);
        await yieldToBrowser();

        onProgress({ phase: 'ocr', file: file.name, current: sourcePage, total: pdfDoc.numPages });
        let ocr = { paragraphs: [] };
        let lastReportedPercent = -5;
        try {
          // Try Tesseract first (typed mode); smartOcrImage falls back to
          // cloud OCR (OCR.Space -> Google Vision) if confidence is low or if
          // the page requires table/handwriting recognition.
          ocr = await smartOcrImage(rendered, (update) => {
            const roundedPercent = Math.round((update.percent || 0) * (update.percent > 1 ? 1 : 100));
            if (roundedPercent >= lastReportedPercent + 5 || roundedPercent === 100) {
              lastReportedPercent = roundedPercent;
              onProgress({
                phase: update.phase || 'ocr',
                file: file.name,
                current: sourcePage,
                total: pdfDoc.numPages,
                percent: roundedPercent,
              });
            }
          }, { mode: 'typed' });
        } catch (error) {
          // Preserve the source page and continue the rest of the document if one OCR page fails.
          console.error(`OCR failed for ${file.name} page ${sourcePage}:`, error);
        }
        await writeImage(projectId, globalPage, rendered);
        images.push({
          page: globalPage,
          filename: `page_${globalPage}.png`,
          sourceId,
          sourcePage,
        });

        for (const paragraph of (ocr.paragraphs || [])) {
          const rawText = typeof paragraph === 'string' ? paragraph : paragraph.text || '';
          if (!rawText.trim()) continue;
          paragraphs.push({
            page: globalPage,
            filename: file.name,
            text: paragraph?.type === 'table' ? rawText : rawText.trim(),
            type: typeof paragraph === 'object' ? paragraph.type : undefined,
            rows: typeof paragraph === 'object' ? paragraph.rows : undefined,
            colCount: typeof paragraph === 'object' ? paragraph.colCount : undefined,
            bbox: typeof paragraph === 'object' ? paragraph.bbox : undefined,
            cells: typeof paragraph === 'object' ? paragraph.cells : undefined,
            lines: typeof paragraph === 'object' && Array.isArray(paragraph.lines) ? paragraph.lines : undefined,
            rotation: typeof paragraph === 'object' ? paragraph.rotation : undefined,
            ocrProvider: ocr.provider,
            source: 'pdf_ocr',
            sourceId,
            sourcePage,
          });
        }
        rendered = null;
        pageModes.push('scanned');
      }

      page.cleanup();
      await yieldToBrowser();
    }

    const mode = pageModes.every(value => value === 'text')
      ? 'text'
      : pageModes.every(value => value === 'scanned') ? 'scanned' : 'hybrid';

    return {
      paragraphs,
      images,
      pageCount: pdfDoc.numPages,
      source: {
        id: sourceId,
        filename: file.name,
        storageName: sourceStorageName,
        type: 'pdf',
        pages: pdfDoc.numPages,
        mode,
      },
    };
  } finally {
    await loadingTask.destroy();
  }
}
