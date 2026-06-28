import { ocrImage } from './ocr.js';
import {
  cloudTextToParagraphs,
  hasSubstantialPageText,
  ocrSpaceImage,
  googleVisionImage,
} from './spellcheck.js';
import CONFIG from './config.js';

/**
 * Smart OCR routing engine.
 *
 * Mode = 'typed' (default Tesseract path):
 *   1. Run Tesseract.js (local)
 *   2. If average word confidence >= CONFIG.OCR_CONFIDENCE_THRESHOLD (70%) AND
 *      text passes hasSubstantialPageText, return Tesseract result.
 *   3. Otherwise fall back to 'cloud' mode.
 *
 * Mode = 'cloud' (handwritten / tables / fallback):
 *   1. Run OCR.Space (cloud)
 *   2. If OCR.Space throws OCR_DAILY_LIMIT, fall back to Google Vision.
 *   3. Return whichever cloud result succeeds.
 *
 * For table mode (options.tableMode === true), we always go directly to the
 * cloud path since Tesseract.js table detection is unreliable.
 */
export async function smartOcrImage(imageFile, onProgress = () => {}, options = {}) {
  const tableMode = options.tableMode === true;
  const threshold = CONFIG.OCR_CONFIDENCE_THRESHOLD || 70;

  // --- Typed-text path (Tesseract first, unless table mode) ---
  if (!tableMode && options.mode !== 'cloud') {
    try {
      onProgress({ phase: 'local-ocr', percent: 0 });
      const local = await ocrImage(imageFile, (p) => onProgress({ phase: 'local-ocr', percent: p }));
      onProgress({ phase: 'local-ocr', percent: 100 });

      const hasText = hasSubstantialPageText(local.text);
      const confident = local.confidence >= threshold;

      if (hasText && confident) {
        return {
          text: local.text,
          paragraphs: local.paragraphs,
          orientation: 0,
          confidence: local.confidence,
          ignored: false,
          provider: 'tesseract',
        };
      }

      // Tesseract result was below threshold or too sparse; log and fall through
      console.log(
        `Tesseract confidence ${local.confidence?.toFixed(1)}% (threshold ${threshold}%), ` +
        `text length ${local.text?.length}. Falling back to cloud OCR.`
      );
    } catch (localError) {
      console.warn('Tesseract OCR failed; falling back to cloud OCR:', localError.message);
    }
  }

  // --- Cloud path (OCR.Space -> Google Vision) ---
  // This path runs for:
  //   1. Table mode (always)
  //   2. Cloud mode (explicitly requested)
  //   3. Tesseract fallback (typed mode failures / low confidence)

  try {
    onProgress({ phase: tableMode ? 'cloud-table' : 'cloud-ocr', percent: 0 });
    const cloud = await ocrSpaceImage(imageFile, { tableMode });
    onProgress({ phase: tableMode ? 'cloud-table' : 'cloud-ocr', percent: 100 });

    if (!hasSubstantialPageText(cloud.text)) {
      return { ...cloud, paragraphs: [], ignored: true, provider: 'ocr-space' };
    }

    const paragraphs = cloud.paragraphs?.length
      ? cloud.paragraphs
      : cloudTextToParagraphs(cloud.text, { preferTable: tableMode });

    return {
      ...cloud,
      paragraphs: paragraphs.map((p) => ({
        ...p,
        rotation: cloud.orientation || 0,
      })),
      ignored: false,
      provider: 'ocr-space',
    };
  } catch (cloudError) {
    // Check if this is a quota-limit error to decide whether to use Google Vision
    const isQuotaError = cloudError.code === 'OCR_DAILY_LIMIT' ||
      cloudError.message?.includes('OCR_DAILY_LIMIT') ||
      cloudError.message?.includes('Daily high-quality OCR limit');

    if (isQuotaError) {
      console.warn('OCR.Space daily limit reached; switching to Google Vision API.');
    } else {
      console.warn('OCR.Space failed; falling back to Google Vision API:', cloudError.message);
    }

    // Try Google Vision as the final fallback
    try {
      onProgress({ phase: 'google-vision', percent: 0 });
      const vision = await googleVisionImage(imageFile, { tableMode });
      onProgress({ phase: 'google-vision', percent: 100 });

      if (!hasSubstantialPageText(vision.text)) {
        return { ...vision, paragraphs: [], ignored: true, provider: 'google-vision' };
      }

      const paragraphs = vision.paragraphs?.length
        ? vision.paragraphs
        : cloudTextToParagraphs(vision.text, { preferTable: tableMode });

      return {
        ...vision,
        paragraphs: paragraphs.map((p) => ({ ...p, rotation: vision.orientation || 0 })),
        ignored: false,
        provider: 'google-vision',
      };
    } catch (visionError) {
      console.error('Both OCR.Space and Google Vision failed:', visionError.message);
      // Final fallback: try Tesseract if we haven't already
      if (!tableMode && options.mode !== 'cloud') {
        try {
          onProgress({ phase: 'local-ocr', percent: 0 });
          const local = await ocrImage(imageFile, (p) => onProgress({ phase: 'local-ocr', percent: p }));
          onProgress({ phase: 'local-ocr', percent: 100 });
          return {
            ...local,
            orientation: 0,
            ignored: !hasSubstantialPageText(local.text),
            provider: 'tesseract',
          };
        } catch (finalError) {
          throw new Error(`All OCR engines failed: ${finalError.message}`);
        }
      }
      throw new Error(`All cloud OCR engines failed: ${visionError.message}`);
    }
  }
}

/**
 * Re-scan detected PDF tables using the cloud OCR fallback chain.
 */
export async function rescanDetectedPdfTables(page, paragraphs, renderedPage, scale, onProgress = () => {}) {
  const tables = paragraphs.filter((paragraph) => paragraph.type === 'table' && paragraph.bbox);
  if (!tables.length || !renderedPage) return paragraphs;
  const replacements = new Map();
  for (let index = 0; index < tables.length; index++) {
    const table = tables[index];
    onProgress({ phase: 'cloud-table', current: index + 1, total: tables.length });
    try {
      const bbox = {
        x0: table.bbox.x0 * scale,
        y0: table.bbox.y0 * scale,
        x1: table.bbox.x1 * scale,
        y1: table.bbox.y1 * scale,
      };
      let result;
      try {
        result = await ocrSpaceImage(renderedPage, { bbox, tableMode: true, padding: 12 * scale });
      } catch (spaceError) {
        if (spaceError.code === 'OCR_DAILY_LIMIT' ||
            spaceError.message?.includes('OCR_DAILY_LIMIT') ||
            spaceError.message?.includes('Daily high-quality OCR limit')) {
          console.warn('OCR.Space quota exceeded for table rescan; using Google Vision.');
          result = await googleVisionImage(renderedPage, { tableMode: true });
        } else {
          throw spaceError;
        }
      }
      const replacement = result.table || result.paragraphs?.find((entry) => entry.type === 'table');
      if (replacement?.rows?.length >= 2 && replacement.colCount >= 2) {
        replacements.set(table, {
          ...table,
          ...replacement,
          bbox: table.bbox,
          source: 'pdf_text',
          ocrProvider: result.provider === 'google-vision' ? 'google-vision-table' : 'ocr-space-table',
        });
      }
    } catch (error) {
      console.warn('Cloud table OCR failed; retaining PDF table structure:', error.message);
    }
  }
  return paragraphs.map((paragraph) => replacements.get(paragraph) || paragraph);
}
