import React, { useState } from 'react';
import CONFIG from '../config';

export default function SettingsPanel({ onClose }) {
  const [hfKey, setHfKey] = useState(
    localStorage.getItem('hf_api_key') || ''
  );
  const [bhashiniKey, setBhashiniKey] = useState(
    localStorage.getItem('bhashini_api_key') || ''
  );
  const [libreKey, setLibreKey] = useState(
    localStorage.getItem('libretranslate_api_key') || ''
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem('hf_api_key', hfKey);
    localStorage.setItem('bhashini_api_key', bhashiniKey);
    localStorage.setItem('libretranslate_api_key', libreKey);
    CONFIG.HUGGINGFACE_API_KEY = hfKey;
    CONFIG.BHASHINI_API_KEY = bhashiniKey;
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">&times;</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Hugging Face API Key
            </label>
            <input
              type="password"
              value={hfKey}
              onChange={(e) => setHfKey(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Enter your Hugging Face token (hf_...)"
            />
            <p className="text-xs text-gray-500 mt-1">
              Used for IndicTrans2 translation models. Saved in browser local storage.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bhashini API Key
            </label>
            <input
              type="password"
              value={bhashiniKey}
              onChange={(e) => setBhashiniKey(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Enter Bhashini API key"
            />
            <p className="text-xs text-gray-500 mt-1">
              Optional. If set, will be used for translations (with HF fallback).
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              LibreTranslate API Key
            </label>
            <input
              type="password"
              value={libreKey}
              onChange={(e) => setLibreKey(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Get a free key at portal.libretranslate.com"
            />
            <p className="text-xs text-gray-500 mt-1">
              Optional. Free tier available at portal.libretranslate.com.
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={handleSave}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded text-sm"
          >
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
