import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { translate } from '../../translation';
import { generateDocx } from '../../docx';
import CONFIG from '../../config';

export default function SplitPaneEditor({ project, onSave, loading }) {
  const [originalHtml, setOriginalHtml] = useState('');
  const [translations, setTranslations] = useState({});
  const [selectedParagraphIndex, setSelectedParagraphIndex] = useState(null);
  const [translatingIndex, setTranslatingIndex] = useState(null);
  const [targetLang, setTargetLang] = useState(
    () => localStorage.getItem('target_lang') || 'bn'
  );
  const [provider, setProvider] = useState(
    () => localStorage.getItem('translation_provider') || 'huggingface'
  );
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem('hf_api_key') || CONFIG.HUGGINGFACE_API_KEY
  );
  const [error, setError] = useState(null);

  useEffect(() => {
    if (project?.content) {
      setOriginalHtml(project.content);
    }
  }, [project]);

  const paragraphs = useMemo(() => {
    const div = document.createElement('div');
    div.innerHTML = originalHtml;
    const paraElements = div.querySelectorAll('p');
    const result = [];
    paraElements.forEach((p, i) => {
      const text = p.innerText.trim();
      if (text) {
        result.push({ index: i, text, html: p.outerHTML });
      }
    });
    if (result.length === 0) {
      const lines = originalHtml.split(/\n\s*\n/);
      lines.forEach((line, i) => {
        const text = line.replace(/<[^>]*>/g, '').trim();
        if (text) {
          result.push({ index: i, text, html: `<p>${text}</p>` });
        }
      });
    }
    return result;
  }, [originalHtml]);

  const handleTranslate = useCallback(async (paragraph, index) => {
    setTranslatingIndex(index);
    setError(null);

    try {
      const result = await translate(provider, paragraph.text, 'auto', targetLang, apiKey);
      setTranslations((prev) => ({
        ...prev,
        [index]: result.translation,
      }));
    } catch (err) {
      console.error('Translation failed:', err);
      setError(err.message || 'Translation failed');
      // Keep original as fallback
      setTranslations((prev) => ({
        ...prev,
        [index]: paragraph.text,
      }));
    } finally {
      setTranslatingIndex(null);
    }
  }, [provider, targetLang, apiKey]);

  const handleKeepOriginal = (paragraph, index) => {
    setTranslations((prev) => ({
      ...prev,
      [index]: paragraph.text,
    }));
  };

  const handleExportDocx = async () => {
    const allParagraphs = paragraphs.map((p, i) => {
      return translations[i] || p.text;
    });
    try {
      const filename = `${project.name || 'translation'}_${targetLang}.docx`;
      await generateDocx(allParagraphs, filename);
    } catch (err) {
      setError('Export failed: ' + err.message);
    }
  };

  const handleProviderChange = (newProvider) => {
    setProvider(newProvider);
    localStorage.setItem('translation_provider', newProvider);
  };

  const handleLangChange = (newLang) => {
    setTargetLang(newLang);
    localStorage.setItem('target_lang', newLang);
  };

  return (
    <div className="h-full flex">
      {/* Left Pane: Original */}
      <div className="w-1/2 border-r border-gray-300 flex flex-col">
        <div className="bg-gray-100 px-4 py-2 border-b border-gray-300 text-sm font-medium text-gray-700">
          Original Document
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {paragraphs.map((p, i) => (
            <div key={i} className="mb-3 group relative">
              <div
                className="p-3 bg-white rounded border border-gray-200 hover:border-indigo-300 cursor-pointer"
                onClick={() => setSelectedParagraphIndex(i)}
                dangerouslySetInnerHTML={{ __html: p.html }}
              />
              <div className="mt-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleTranslate(p, i)}
                  disabled={translatingIndex === i}
                  className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded hover:bg-indigo-200 disabled:opacity-50"
                >
                  {translatingIndex === i ? 'Translating...' : 'Translate'}
                </button>
                <button
                  onClick={() => handleKeepOriginal(p, i)}
                  className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded hover:bg-gray-200"
                >
                  Keep Original
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Pane: Translation */}
      <div className="w-1/2 flex flex-col">
        <div className="bg-gray-100 px-4 py-2 border-b border-gray-300">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Translation</span>
            <div className="flex items-center gap-2">
              <select
                value={targetLang}
                onChange={(e) => handleLangChange(e.target.value)}
                className="text-xs border rounded px-2 py-1"
              >
                {CONFIG.LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name} ({l.native})
                  </option>
                ))}
              </select>
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="text-xs border rounded px-2 py-1"
              >
                <option value="huggingface">Hugging Face (IndicTrans2)</option>
                <option value="bhashini">Bhashini</option>
              </select>
              <button
                onClick={handleExportDocx}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1 rounded"
              >
                Export DOCX
              </button>
              <button
                onClick={() => onSave(originalHtml)}
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1 rounded disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-4 py-2 text-sm">
            {error}
            <button onClick={() => setError(null)} className="float-right font-bold">&times;</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {Object.keys(translations).length > 0 ? (
            paragraphs.map((p, i) => (
              translations[i] ? (
                <div key={i} className="mb-3">
                  <div className="p-3 bg-white rounded border border-green-200">
                    <p className="text-sm text-gray-500 mb-1">Paragraph {i + 1}</p>
                    {translations[i]}
                  </div>
                </div>
              ) : null
            ))
          ) : (
            <div className="text-center text-gray-400 mt-20">
              <p className="text-lg">No translations yet.</p>
              <p className="text-sm mt-2">
                Click "Translate" on any paragraph in the left pane to get started.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
