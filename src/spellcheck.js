import nspell from 'nspell';
import CONFIG from './config';

let spellInstance = null;
let spellPromise = null;

const SIMILAR_CHARS = {
  '\u0915': '\u0916\u0917\u0918', // क→ख,ग,घ
  '\u0916': '\u0915\u0917\u0918',
  '\u0917': '\u0915\u0916\u0918',
  '\u0918': '\u0915\u0916\u0917',
  '\u091A': '\u091B\u091C\u091D', // च→छ,ज,झ
  '\u091B': '\u091A\u091C\u091D',
  '\u091C': '\u091A\u091B\u091D\u091C',
  '\u091D': '\u091A\u091B\u091C',
  '\u091F': '\u0920\u0921\u0922', // ट→ठ,ड,ढ
  '\u0920': '\u091F\u0921\u0922',
  '\u0921': '\u091F\u0920\u0922\u0921',
  '\u0922': '\u091F\u0920\u0921',
  '\u0924': '\u0925\u0926\u0927', // त→थ,द,ध
  '\u0925': '\u0924\u0926\u0927',
  '\u0926': '\u0924\u0925\u0927',
  '\u0927': '\u0924\u0925\u0926',
  '\u092A': '\u092B\u092C\u092D', // प→फ,ब,भ
  '\u092B': '\u092A\u092C\u092D',
  '\u092C': '\u092A\u092B\u092D',
  '\u092D': '\u092A\u092B\u092C',
  '\u0936': '\u0937\u0938', // श→ष,स
  '\u0937': '\u0936\u0938',
  '\u0938': '\u0936\u0937',
  '\u0928': '\u0923', // न→ण
  '\u0923': '\u0928',
  '\u092E': '\u092D', // म→भ
  '\u092D': '\u092E',
  '\u0930': '\u0931', // र→ऱ
  '\u0932': '\u0933', // ल→ळ
};

const CONFUSABLES = [
  ['\u093F', '\u0940'],  // ि vs ी
  ['\u0941', '\u0942'],  // ु vs ू
  ['\u0947', '\u0948'],  // े vs ै
  ['\u094B', '\u094C'],  // ो vs ौ
  ['\u0902', '\u0901', ''], // ं vs ँ vs nothing
];

export async function initSpellcheck() {
  if (spellInstance) return spellInstance;
  if (spellPromise) return spellPromise;

  spellPromise = (async () => {
    const base = import.meta.env.BASE_URL || '/';
    const affRes = await fetch(`${base}dict/hi.aff`);
    const dicRes = await fetch(`${base}dict/hi.dic`);
    const aff = await affRes.text();
    const dic = await dicRes.text();
    spellInstance = nspell(aff, dic);
    return spellInstance;
  })();

  return spellPromise;
}

export function isCorrect(word) {
  return spellInstance ? spellInstance.correct(word) : true;
}

export function suggestWord(word) {
  if (!spellInstance) return [];
  return spellInstance.suggest(word).filter((s) => s !== word).slice(0, 6);
}

const COMMON_CHARS = '\u0905\u0906\u0907\u0908\u0909\u090A\u090B\u090F\u0910\u0913\u0914' + // vowels
  '\u0915\u0916\u0917\u0918\u0919' + // क ख ग घ ङ
  '\u091A\u091B\u091C\u091D\u091E' + // च छ ज झ ञ
  '\u091F\u0920\u0921\u0922\u0923' + // ट ठ ड ढ ण
  '\u0924\u0925\u0926\u0927\u0928' + // त थ द ध न
  '\u092A\u092B\u092C\u092D\u092E' + // प फ ब भ म
  '\u092F\u0930\u0932\u0935\u0936\u0937\u0938\u0939'; // य र ल व श ष स ह

function genOneEditVariants(word) {
  const seen = new Set();
  const chars = [...word];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    // Substitute with similar character
    const subs = SIMILAR_CHARS[ch] || '';
    for (const s of subs) {
      const variant = chars.slice(0, i).join('') + s + chars.slice(i + 1).join('');
      seen.add(variant);
    }

    // Substitute with matra-like confusions
    for (const group of CONFUSABLES) {
      for (const alt of group) {
        if (alt && alt !== ch) {
          const variant = chars.slice(0, i).join('') + alt + chars.slice(i + 1).join('');
          seen.add(variant);
        }
      }
    }
  }

  // Delete each character
  for (let i = 0; i < chars.length; i++) {
    const variant = chars.slice(0, i).join('') + chars.slice(i + 1).join('');
    if (variant.length > 0) seen.add(variant);
  }

  // Swap adjacent characters (transposition)
  for (let i = 0; i < chars.length - 1; i++) {
    const swapped = [...chars];
    [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
    seen.add(swapped.join(''));
  }

  // Insert common characters at each position
  for (let i = 0; i <= chars.length; i++) {
    for (const c of COMMON_CHARS) {
      const variant = chars.slice(0, i).join('') + c + chars.slice(i).join('');
      seen.add(variant);
    }
  }

  return [...seen];
}

export function findSimilarWords(word) {
  if (!spellInstance) return [];
  const variants = genOneEditVariants(word);
  return variants.filter((v) => spellInstance.correct(v)).slice(0, 12);
}

export async function fetchSuggestions(word, fullText, selStart, selEnd) {
  // Step 1: Try Hunspell for Hindi
  const lang = detectLang(fullText);
  if (lang === 'hi') {
    await initSpellcheck();
    const corrected = suggestWord(word);
    if (corrected.length > 0) {
      return { type: 'corrections', alternatives: corrected };
    }
    const similar = findSimilarWords(word);
    if (similar.length > 0) {
      return { type: 'alternatives', alternatives: similar };
    }
    return { type: 'none', alternatives: [] };
  }

  // Step 2: LanguageTool for supported languages
  try {
    const ltLang = LT_LANGS.has(lang) ? lang : 'en-US';
    const params = new URLSearchParams({ text: fullText, language: ltLang, enabledOnly: 'false' });
    const res = await fetch(LT_URL, { method: 'POST', body: params });
    const data = await res.json();
    const matches = data?.matches || [];
    const overlapping = matches.filter((m) => {
      const mEnd = m.offset + m.length;
      return m.offset < selEnd && mEnd > selStart;
    });
    const all = overlapping.flatMap((m) =>
      (m.replacements || []).map((r) => r.value)
    ).filter(Boolean);
    const alternatives = [...new Set(all)].filter((s) => s !== word).slice(0, 6);
    return { type: alternatives.length > 0 ? 'corrections' : 'none', alternatives };
  } catch {
    return { type: 'none', alternatives: [] };
  }
}

const LT_URL = 'https://api.languagetool.org/v2/check';

const LT_LANGS = new Set([
  'en-US', 'en-GB', 'en-AU', 'en-CA', 'en-NZ', 'en-ZA',
  'de', 'de-DE', 'de-AT', 'de-CH',
  'fr', 'fr-FR', 'fr-CA', 'fr-BE', 'fr-CH',
  'es', 'es-ES', 'es-AR',
  'pt', 'pt-BR', 'pt-PT', 'pt-AO', 'pt-MZ',
  'it', 'it-IT', 'nl', 'nl-NL', 'nl-BE',
  'ru-RU', 'uk-UA', 'be-BY',
  'pl-PL', 'cs-CZ', 'sk-SK', 'sl-SI',
  'ro-RO', 'da-DK', 'sv-SE', 'nb', 'no',
  'fi-FI', 'et-EE', 'lv-LV', 'lt-LT',
  'el-GR', 'hu-HU', 'bg-BG', 'sr-SR',
  'hr-HR', 'ca-ES', 'gl-ES',
  'ja-JP', 'zh-CN', 'ko-KR',
  'ta-IN', 'km-KH', 'th-TH',
  'ar', 'fa', 'fa-IR', 'he',
  'tr-TR', 'id-ID', 'ms-MY', 'tl-PH', 'vi-VN',
]);

function detectLang(text) {
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0980-\u09FF]/.test(text)) return 'bn';
  if (/[\u0A00-\u0A7F]/.test(text)) return 'pa';
  if (/[\u0A80-\u0AFF]/.test(text)) return 'gu';
  if (/[\u0B00-\u0B7F]/.test(text)) return 'or';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn';
  if (/[\u0D00-\u0D7F]/.test(text)) return 'ml';
  return 'en-US';
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const TARGET_MP = 1.5; // target megapixels for full-page fallback (< 1.5MB API limit)

export async function reOcrRegion(imageData, bbox, padding) {
  const img = await loadImage(imageData);
  let iw = img.naturalWidth;
  let ih = img.naturalHeight;

  let sx, sy, sw, sh;
  let fullPage = false;
  if (bbox && typeof bbox.x0 === 'number') {
    const pad = padding !== undefined ? padding : Math.max(8, (bbox.x1 - bbox.x0) * 0.3);
    sx = Math.max(0, bbox.x0 - pad);
    sy = Math.max(0, bbox.y0 - pad);
    sw = Math.min(iw - sx, (bbox.x1 - bbox.x0) + pad * 2);
    sh = Math.min(ih - sy, (bbox.y1 - bbox.y0) + pad * 2);
    if (sw < 4 || sh < 4) return '';
  } else {
    sx = 0; sy = 0; sw = iw; sh = ih;
    fullPage = true;
  }

  let scale = 1;
  if (fullPage && (sw * sh > TARGET_MP * 1e6)) {
    scale = Math.sqrt(TARGET_MP * 1e6 / (sw * sh));
  }
  const cw = Math.round(sw * scale);
  const ch = Math.round(sh * scale);

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);

  const base64 = canvas.toDataURL('image/png');
  const apiKey = CONFIG.OCR_SPACE_API_KEY;

  if (!apiKey) return '';

  const params = new URLSearchParams({
    apikey: apiKey,
    OCREngine: '3',
    base64Image: base64,
    isOverlayRequired: 'false',
    scale: 'true',
  });

  const res = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    const text = await res.text().catch(() => '');
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }

  if (data.OCRExitCode === 1 && data.ParsedResults && data.ParsedResults.length > 0) {
    return data.ParsedResults[0].ParsedText.trim();
  }
  const errMsg = Array.isArray(data.ErrorMessage)
    ? data.ErrorMessage.join('; ')
    : data.ErrorMessage || `OCR.space exit code ${data.OCRExitCode}`;
  throw new Error(errMsg);
}
