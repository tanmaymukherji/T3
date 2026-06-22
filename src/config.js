// Configuration for T³ - Tanmay's Translation Tool
// All API keys and settings in one place.

function getLS(key, fallback = '') {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}

const CONFIG = {
  // Hugging Face Inference API key (set via Settings panel, persisted in localStorage)
  // Uses the @huggingface/inference client which routes through router.huggingface.co
  HUGGINGFACE_API_KEY: getLS('hf_api_key'),

  // Bhashini API
  BHASHINI_API_KEY: getLS('bhashini_api_key'),
  BHASHINI_API_URL: 'https://api.bhashini.gov.in/v2',

  // Tesseract OCR languages
  OCR_LANGUAGES: 'hin+eng+san',

  // Supported translation languages
  LANGUAGES: [
    { code: 'bn', name: 'Bengali', native: 'বাংলা' },
    { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
    { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
    { code: 'te', name: 'Telugu', native: 'తెలుగు' },
    { code: 'mr', name: 'Marathi', native: 'मराठी' },
    { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
    { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
    { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
    { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
    { code: 'ur', name: 'Urdu', native: 'اردو' },
  ],

  // IndicTrans2 model mapping
  INDICTRANS2_MODELS: {
    'en-indic': 'ai4bharat/indictrans2-en-indic-1B',
    'indic-en': 'ai4bharat/indictrans2-indic-en-1B',
    'indic-indic': 'ai4bharat/indictrans2-indic-indic-1B',
  },
  // OCR.space API key for re-scanning image regions
  OCR_SPACE_API_KEY: 'K82846767888957',
};

export default CONFIG;
