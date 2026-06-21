import React, { useState, useEffect, useCallback, useMemo, useRef, createRef } from 'react';
import { translate } from '../../translation';
import { generateDocx } from '../../docx';
import SmartTextarea from './SmartTextarea';
import SuggestionButton, { ReScanButton } from './SuggestionButton';
import CONFIG from '../../config';

function parseParagraphs(project) {
  const html = project?.content || '';
  const div = document.createElement('div');
  div.innerHTML = html;
  const paraElements = div.querySelectorAll('p');
  const result = [];
  let index = 0;

  if (paraElements.length > 0) {
    paraElements.forEach((p) => {
      const text = p.innerText.trim();
      if (text) {
        result.push({
          id: `p_${index}`,
          index,
          page: parseInt(p.getAttribute('data-page'), 10) || 1,
          filename: p.getAttribute('data-filename') || '',
          text,
        });
        index++;
      }
    });
  }

  const paraField = project?.paragraphsArray || project?.paragraphs;
  if (result.length === 0 && Array.isArray(paraField) && paraField.length > 0) {
    for (const p of paraField) {
      result.push({
        id: p.id || `p_${index}`,
        index,
        page: p.page || 1,
        filename: p.filename || '',
        text: p.text,
      });
      index++;
    }
  }

  if (result.length === 0) {
    const lines = html.split(/\n\s*\n/);
    lines.forEach((line) => {
      const text = line.replace(/<[^>]*>/g, '').trim();
      if (text) {
        result.push({ id: `p_${index}`, index, page: 1, text });
        index++;
      }
    });
  }

  return result;
}

function PageGroup({ pageNum, paragraphs, originals, translations, translatingIndex, onTextChange, onTranslate, onKeepOriginal, imageData, linesByIndex }) {
  const textareaRefs = useRef({});
  const filename = paragraphs[0]?.filename || '';
  return (
    <div className="mb-6">
      <div className="sticky top-0 z-10 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-3 flex items-center gap-3 shadow-sm">
        <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded">
          PAGE {pageNum}
        </span>
        <span className="text-xs text-blue-700 font-medium">
          {paragraphs.length} paragraph{paragraphs.length !== 1 ? 's' : ''}
        </span>
        {filename && (
          <span className="text-xs text-blue-500 ml-auto truncate max-w-[200px]" title={filename}>
            {filename}
          </span>
        )}
      </div>
      {paragraphs.map((p) => {
        const text = originals[p.index] !== undefined ? originals[p.index] : p.text;
        const rows = Math.max(2, text.split('\n').length, Math.ceil(text.length / 55));
        if (!textareaRefs.current[p.index]) textareaRefs.current[p.index] = createRef();
        return (
          <div key={p.id || p.index} className="mb-2 ml-2">
            <div className="flex items-center gap-2 mb-0.5">
              <SuggestionButton textareaRef={textareaRefs.current[p.index]} />
              <ReScanButton
                textareaRef={textareaRefs.current[p.index]}
                imageData={imageData}
                lines={linesByIndex[p.index]}
              />
              <span className="text-[11px] text-gray-400 font-mono">¶{p.index + 1}</span>
              <span className="text-[11px] text-gray-400">p.{pageNum}</span>
            </div>
            <SmartTextarea
              ref={textareaRefs.current[p.index]}
              value={text}
              onChange={(newText) => onTextChange(p.index, newText)}
              className="w-full p-3 bg-white rounded border border-gray-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 text-sm resize-y min-h-[3.5rem] font-sans leading-relaxed whitespace-pre-wrap"
              rows={rows}
            />
            <div className="mt-1 flex gap-1">
              <button
                onClick={() => onTranslate(p)}
                disabled={translatingIndex === p.index}
                className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded hover:bg-indigo-200 disabled:opacity-50"
              >
                {translatingIndex === p.index ? 'Translating...' : 'Translate'}
              </button>
              <button
                onClick={() => onKeepOriginal(p)}
                className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded hover:bg-gray-200"
              >
                Keep Original
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TranslationPageGroup({ pageNum, paragraphs, translations, onTextChange, imageData, linesByIndex }) {
  const textareaRefs = useRef({});
  const paraList = Array.isArray(paragraphs) ? paragraphs : [];
  const hasAny = paraList.some((p) => translations && translations[p.index] !== undefined);
  if (!hasAny) return null;

  const filename = paraList[0]?.filename || '';

  return (
    <div className="mb-6">
      <div className="sticky top-0 z-10 bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-3 flex items-center gap-3 shadow-sm">
        <span className="bg-green-600 text-white text-xs font-bold px-2 py-0.5 rounded">
          PAGE {pageNum}
        </span>
        {filename && (
          <span className="text-xs text-green-500 ml-auto truncate max-w-[200px]" title={filename}>
            {filename}
          </span>
        )}
      </div>
      {paraList.map((p) => {
        const t = translations[p.index];
        if (t === undefined) return null;
        const rows = Math.max(2, t.split('\n').length, Math.ceil(t.length / 55));
        if (!textareaRefs.current[p.index]) textareaRefs.current[p.index] = createRef();
        return (
          <div key={p.id || p.index} className="mb-2 ml-2">
            <div className="flex items-center gap-2 mb-0.5">
              <SuggestionButton textareaRef={textareaRefs.current[p.index]} />
              <ReScanButton
                textareaRef={textareaRefs.current[p.index]}
                imageData={imageData}
                lines={linesByIndex[p.index]}
              />
              <span className="text-[11px] text-gray-400 font-mono">¶{p.index + 1}</span>
            </div>
            <SmartTextarea
              ref={textareaRefs.current[p.index]}
              value={t}
              onChange={(newText) => onTextChange(p.index, newText)}
              className="w-full p-3 bg-white rounded border border-green-200 focus:border-green-400 focus:ring-1 focus:ring-green-400 text-sm resize-y min-h-[3.5rem] font-sans leading-relaxed whitespace-pre-wrap"
              rows={rows}
            />
          </div>
        );
      })}
    </div>
  );
}

export default function SplitPaneEditor({ project, images, paragraphs: origParagraphs, onSave, loading }) {
  const [paragraphs, setParagraphs] = useState([]);
  const [originals, setOriginals] = useState({});
  const [translations, setTranslations] = useState({});
  const [translatingIndex, setTranslatingIndex] = useState(null);

  // Lookup maps for the re-scan feature
  const imageByPage = useMemo(() => {
    const map = {};
    for (const img of (images || [])) {
      map[img.page] = img.data;
    }
    return map;
  }, [images]);

  const linesByIndex = useMemo(() => {
    const map = {};
    for (const p of (origParagraphs || [])) {
      if (p.lines && p.lines.length > 0) {
        map[p.index] = p.lines;
      }
    }
    return map;
  }, [origParagraphs]);
  const [targetLang, setTargetLang] = useState(
    () => localStorage.getItem('target_lang') || 'bn'
  );
  const [provider, setProvider] = useState(
    () => localStorage.getItem('translation_provider') || 'huggingface'
  );
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem('hf_api_key') || ''
  );
  const [error, setError] = useState(null);

  useEffect(() => {
    if (project) {
      const parsed = parseParagraphs(project);
      setParagraphs(parsed);
      const origs = {};
      for (const p of parsed) {
        origs[p.index] = p.text;
      }
      setOriginals(origs);
      if (project.translations) {
        setTranslations(project.translations);
      }
    }
  }, [project]);

  const pages = useMemo(() => {
    const map = {};
    for (const p of paragraphs) {
      const pg = p.page || 1;
      if (!map[pg]) map[pg] = [];
      map[pg].push(p);
    }
    return Object.entries(map)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([page, paras]) => ({ page: parseInt(page), paragraphs: paras }));
  }, [paragraphs]);

  const updateOriginal = useCallback((index, text) => {
    setOriginals((prev) => ({ ...prev, [index]: text }));
  }, []);

  const updateTranslation = useCallback((index, text) => {
    setTranslations((prev) => ({ ...prev, [index]: text }));
  }, []);

  const handleTranslate = useCallback(async (para) => {
    const text = originals[para.index] || para.text;
    setTranslatingIndex(para.index);
    setError(null);

    try {
      const result = await translate(provider, text, 'auto', targetLang, apiKey);
      setTranslations((prev) => ({
        ...prev,
        [para.index]: result.translation,
      }));
    } catch (err) {
      console.error('Translation failed:', err);
      setError(err.message || 'Translation failed');
    } finally {
      setTranslatingIndex(null);
    }
  }, [provider, targetLang, apiKey, originals]);

  const handleKeepOriginal = useCallback((para) => {
    setTranslations((prev) => ({
      ...prev,
      [para.index]: originals[para.index] || para.text,
    }));
  }, [originals]);

  const handleExportDocx = async () => {
    const exportData = paragraphs.map((p) => ({
      page: p.page,
      text: originals[p.index] || p.text,
      translated: translations[p.index],
    }));
    try {
      const filename = `${project.name || 'translation'}_${targetLang}.docx`;
      await generateDocx(exportData, filename);
    } catch (err) {
      setError('Export failed: ' + err.message);
    }
  };

  const handleSave = () => {
    const html = paragraphs
      .map((p) => `<p data-page="${p.page}" data-filename="${p.filename || ''}">${originals[p.index] || p.text}</p>`)
      .join('\n');
    onSave(html, { translations });
  };

  return (
    <div className="h-full flex">
      {/* LEFT PANE: Originals grouped by page */}
      <div className="w-1/2 border-r border-gray-300 flex flex-col">
        <div className="bg-gray-100 px-4 py-2 border-b border-gray-300 text-sm font-medium text-gray-700 flex items-center justify-between">
          <span>Original Document</span>
          <span className="text-xs text-gray-500">{pages.length} pages · {paragraphs.length} paragraphs</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {pages.map(({ page, paragraphs: pageParas }) => (
            <PageGroup
              key={page}
              pageNum={page}
              paragraphs={pageParas}
              originals={originals}
              translations={translations}
              translatingIndex={translatingIndex}
              onTextChange={updateOriginal}
              onTranslate={handleTranslate}
              onKeepOriginal={handleKeepOriginal}
              imageData={imageByPage[page]}
              linesByIndex={linesByIndex}
            />
          ))}
          {pages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <p className="text-lg">No paragraphs</p>
              <p className="text-sm mt-2">Import images to get started.</p>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANE: Translations grouped by page */}
      <div className="w-1/2 flex flex-col">
        <div className="bg-gray-100 px-4 py-2 border-b border-gray-300">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Translation</span>
            <div className="flex items-center gap-2">
              <select
                value={targetLang}
                onChange={(e) => {
                  setTargetLang(e.target.value);
                  localStorage.setItem('target_lang', e.target.value);
                }}
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
                onChange={(e) => {
                  setProvider(e.target.value);
                  localStorage.setItem('translation_provider', e.target.value);
                }}
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
                onClick={handleSave}
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
            pages.map(({ page, paragraphs: pageParas }) => (
              <TranslationPageGroup
                key={page}
                pageNum={page}
                paragraphs={pageParas}
                translations={translations}
                onTextChange={updateTranslation}
                imageData={imageByPage[page]}
                linesByIndex={linesByIndex}
              />
            ))
          ) : (
            <div className="text-center text-gray-400 mt-20">
              <p className="text-lg">No translations yet.</p>
              <p className="text-sm mt-2">
                Click "Translate" on any paragraph to get started.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
