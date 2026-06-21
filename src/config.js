// Configuration for Translation Tool
// All API keys and settings in one place.

const CONFIG = {
  // Hugging Face Inference API (set via Settings panel, persisted in localStorage)
  HUGGINGFACE_API_KEY: localStorage.getItem('hf_api_key') || '',
  HUGGINGFACE_API_URL: 'https://api-inference.huggingface.co/models',

  // Bhashini API
  BHASHINI_API_KEY: localStorage.getItem('bhashini_api_key') || '',
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
};

export default CONFIG;
