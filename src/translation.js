// Translation API - direct browser calls to Hugging Face / Bhashini

import CONFIG from './config';

// Language code mapping for IndicTrans2
const IT2_LANG_MAP = {
  bn: 'ben_Beng',
  hi: 'hin_Deva',
  ta: 'tam_Taml',
  te: 'tel_Telu',
  mr: 'mar_Deva',
  gu: 'guj_Gujr',
  kn: 'kan_Knda',
  ml: 'mal_Mlym',
  pa: 'pan_Guru',
  ur: 'urd_Arab',
  en: 'eng_Latn',
};

function toIT2Code(lang) {
  if (IT2_LANG_MAP[lang]) return IT2_LANG_MAP[lang];
  if (lang.includes('_')) return lang;
  return lang;
}

function detectLanguage(text) {
  const devanagari = (text.match(/[\u0900-\u097F]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  const total = devanagari + latin;
  if (total === 0) return 'unknown';
  if (latin / total > 0.6) return 'eng_Latn';
  return 'hin_Deva';
}

function isSanskrit(text) {
  const devanagari = (text.match(/[\u0900-\u097F]{3,}/g) || []).length;
  return text.length > 0 && devanagari / text.length > 0.3;
}

export async function translateHF(text, srcLang, tgtLang, apiKey) {
  if (isSanskrit(text)) {
    return { translation: text, note: 'Sanskrit text kept as-is' };
  }

  const resolvedKey = apiKey || CONFIG.HUGGINGFACE_API_KEY;
  if (!resolvedKey) {
    throw new Error('Hugging Face API key not configured. Open Settings (⚙) to enter your token.');
  }

  const src = srcLang === 'auto' ? detectLanguage(text) : toIT2Code(srcLang);
  const tgt = toIT2Code(tgtLang);

  // Determine model
  let modelId;
  if (src === 'eng_Latn') {
    modelId = CONFIG.INDICTRANS2_MODELS['en-indic'];
  } else if (tgt === 'eng_Latn') {
    modelId = CONFIG.INDICTRANS2_MODELS['indic-en'];
  } else {
    modelId = CONFIG.INDICTRANS2_MODELS['indic-indic'];
  }

  const url = `${CONFIG.HUGGINGFACE_API_URL}/${modelId}`;
  const key = apiKey || CONFIG.HUGGINGFACE_API_KEY;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: text,
      parameters: { src_lang: src, tgt_lang: tgt },
    }),
  });

  if (response.status === 503) {
    // Model is loading - wait and retry once
    await new Promise((r) => setTimeout(r, 5000));
    return translateHF(text, srcLang, tgtLang, apiKey);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Translation API error (${response.status}): ${errorBody}`);
  }

  const result = await response.json();
  let translation;
  if (Array.isArray(result)) {
    translation = result[0]?.translation_text || result[0]?.generated_text || '';
  } else if (typeof result === 'object') {
    translation = result.translation_text || result.generated_text || '';
  } else {
    translation = String(result);
  }

  return { translation };
}

export async function translateBhashini(text, srcLang, tgtLang, apiKey) {
  if (isSanskrit(text)) {
    return { translation: text, note: 'Sanskrit text kept as-is' };
  }

  if (!apiKey || apiKey === 'your_bhashini_api_key_here') {
    throw new Error('Bhashini API key not configured');
  }

  const src = srcLang === 'auto' ? detectLanguage(text).split('_')[0] : srcLang;
  const tgt = tgtLang.split('_')[0];

  const response = await fetch(`${CONFIG.BHASHINI_API_URL}/translate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sourceLanguage: src,
      targetLanguage: tgt,
      text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Bhashini API error (${response.status})`);
  }

  const result = await response.json();
  return { translation: result.translation || result.text || '' };
}

export async function translate(provider, text, srcLang, tgtLang, apiKey) {
  if (provider === 'bhashini') {
    try {
      return await translateBhashini(text, srcLang, tgtLang, apiKey);
    } catch (e) {
      if (e.message.includes('key not configured')) {
        // Fallback to HF
        console.warn('Bhashini unavailable, falling back to Hugging Face:', e.message);
        return await translateHF(text, srcLang, tgtLang, apiKey);
      }
      throw e;
    }
  }
  return await translateHF(text, srcLang, tgtLang, apiKey);
}
