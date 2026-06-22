import React, { useState, useEffect, useCallback, useMemo, useRef, createRef } from 'react';
import { translate } from '../../translation';
import { generateDocx, generateDocxBlob } from '../../docx';
import SmartTextarea from './SmartTextarea';
import SuggestionButton, { ReScanButton } from './SuggestionButton';
import CONFIG from '../../config';

function parseParagraphs(project) {
  const html = project?.content || '';
  const div = document.createElement('div');
  div.innerHTML = html;
  const paraElements = div.querySelectorAll('p');
  const tableElements = div.querySelectorAll('table');
  const result = [];
  let index = 0;

  if (paraElements.length > 0 || tableElements.length > 0) {
    const allEls = Array.from(div.body?.childNodes || div.childNodes).filter(
      n => n.nodeType === 1 && (n.tagName === 'P' || n.tagName === 'TABLE')
    );
    for (const el of allEls) {
      if (el.tagName === 'P') {
        const text = el.innerText.trim();
        if (text) {
          result.push({
            id: `p_${index}`,
            index,
            page: parseInt(el.getAttribute('data-page'), 10) || 1,
            filename: el.getAttribute('data-filename') || '',
            source: el.getAttribute('data-source') || undefined,
            sourceId: el.getAttribute('data-source-id') || undefined,
            sourcePage: parseInt(el.getAttribute('data-source-page'), 10) || undefined,
            text,
          });
          index++;
        }
      } else if (el.tagName === 'TABLE') {
        const rows = [];
        el.querySelectorAll('tr').forEach(tr => {
          const cells = [];
          tr.querySelectorAll('td').forEach(td => cells.push(td.innerText.trim()));
          rows.push(cells);
        });
        if (rows.length > 0) {
          const tableText = rows.map(r => r.join('\t')).join('\n');
          result.push({
            id: `p_${index}`,
            index,
            page: parseInt(el.getAttribute('data-page'), 10) || 1,
            filename: el.getAttribute('data-filename') || '',
            source: el.getAttribute('data-source') || 'pdf_text',
            sourceId: el.getAttribute('data-source-id') || undefined,
            sourcePage: parseInt(el.getAttribute('data-source-page'), 10) || undefined,
            type: 'table',
            rows,
            colCount: rows[0]?.length || 0,
            text: tableText,
          });
          index++;
        }
      }
    }
  }

  const paraField = project?.paragraphsArray || project?.paragraphs;
  if (result.length === 0 && Array.isArray(paraField) && paraField.length > 0) {
    for (const p of paraField) {
      const entry = {
        id: p.id || `p_${index}`,
        index,
        page: p.page || 1,
        filename: p.filename || '',
        source: p.source || undefined,
        sourceId: p.sourceId || undefined,
        sourcePage: p.sourcePage || undefined,
        text: p.text,
      };
      if (p.type === 'table' && p.rows && p.rows.length > 0) {
        entry.type = 'table';
        entry.rows = p.rows.map(r => [...r]);
        entry.colCount = p.colCount || p.rows[0].length;
      }
      result.push(entry);
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

function getTableRows(para, originals) {
  const raw = originals && originals[para.index] !== undefined ? originals[para.index] : (para.text || '');
  return raw.split('\n').map(l => l.split('\t'));
}

function getTranslatedTableRows(para, translations) {
  const raw = translations && translations[para.index] !== undefined ? translations[para.index] : '';
  if (!raw) return para.rows || getTableRows(para, null);
  return raw.split('\n').map(l => l.split('\t'));
}

function TableGroup({ rows, onCellChange, readOnly, className }) {
  return (
    <div className={className + ' overflow-x-auto'}>
      <table className="w-full border-collapse border border-gray-400 text-sm">
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-gray-400 p-1 min-w-[60px] align-top">
                  {readOnly ? (
                    <span className="block whitespace-pre-wrap min-h-[1.2em]">{cell}</span>
                  ) : (
                    <textarea
                      value={cell}
                      onChange={(e) => onCellChange(ri, ci, e.target.value)}
                      className="w-full bg-transparent resize-none outline-none border-none p-0 m-0 text-sm font-sans leading-snug"
                      rows={Math.max(1, (cell || '').split('\n').length)}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageGroup({ pageNum, paragraphs, originals, translations, translatingIndex, onTextChange, onTranslate, onKeepOriginal, projectId, linesByIndex }) {
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
      {paragraphs.map((p, idx) => {
        const text = originals[p.index] !== undefined ? originals[p.index] : p.text;
        const rows = Math.max(2, text.split('\n').length, Math.ceil(text.length / 55));
        if (!textareaRefs.current[p.index]) textareaRefs.current[p.index] = createRef();
        const translated = translations && translations[p.index] !== undefined;
        const isTable = p.type === 'table';
        return (
          <div key={p.id || p.index} data-para-index={p.index} className="mb-2 ml-2">
            <div className="flex items-center gap-2 mb-0.5">
              {!isTable && <SuggestionButton textareaRef={textareaRefs.current[p.index]} />}
              {!isTable && <ReScanButton
                textareaRef={textareaRefs.current[p.index]}
                projectId={projectId}
                pageNumber={pageNum}
                lines={linesByIndex[p.index]}
                paraIndex={idx}
                totalParas={paragraphs.length}
                disabled={p.source === 'pdf_text'}
              />}
              <span className="text-[11px] text-gray-400 font-mono">{isTable ? '⊞' : '¶'}{p.index + 1}</span>
              <span className="text-[11px] text-gray-400">p.{pageNum}</span>
              {isTable && <span className="text-[10px] text-indigo-500 font-medium">Table</span>}
              {translated && <span className="text-[10px] text-amber-600 font-medium">✓ Translated</span>}
            </div>
            {isTable ? (
              <TableGroup
                rows={getTableRows(p, originals)}
                onCellChange={(ri, ci, val) => {
                  const r = getTableRows(p, originals);
                  r[ri][ci] = val;
                  const joined = r.map(row => row.join('\t')).join('\n');
                  onTextChange(p.index, joined);
                }}
                readOnly={false}
                className="bg-white border border-gray-300 rounded"
              />
            ) : (
              <SmartTextarea
                ref={textareaRefs.current[p.index]}
                value={text}
                onChange={(newText) => onTextChange(p.index, newText)}
                className={`w-full p-3 border text-sm resize-y min-h-[3.5rem] font-sans leading-relaxed whitespace-pre-wrap rounded ${translated ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200'} focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400`}
                rows={rows}
              />
            )}
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

function TranslationPageGroup({ pageNum, paragraphs, translations, onTextChange, projectId, linesByIndex }) {
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
      {paraList.map((p, idx) => {
        const t = translations[p.index];
        if (t === undefined) return null;
        const rows = Math.max(2, t.split('\n').length, Math.ceil(t.length / 55));
        if (!textareaRefs.current[p.index]) textareaRefs.current[p.index] = createRef();
        const isTable = p.type === 'table';
        return (
          <div key={p.id || p.index} data-para-index={p.index} className="mb-2 ml-2">
            <div className="flex items-center gap-2 mb-0.5">
              {!isTable && <SuggestionButton textareaRef={textareaRefs.current[p.index]} />}
              {!isTable && <ReScanButton
                textareaRef={textareaRefs.current[p.index]}
                projectId={projectId}
                pageNumber={pageNum}
                lines={linesByIndex[p.index]}
                paraIndex={idx}
                totalParas={paraList.length}
                disabled={p.source === 'pdf_text'}
              />}
              <span className="text-[11px] text-gray-400 font-mono">{isTable ? '⊞' : '¶'}{p.index + 1}</span>
              {isTable && <span className="text-[10px] text-green-500 font-medium">Table</span>}
            </div>
            {isTable ? (
              <TableGroup
                rows={getTranslatedTableRows(p, translations)}
                readOnly={false}
                onCellChange={(ri, ci, val) => {
                  const r = getTranslatedTableRows(p, translations);
                  r[ri][ci] = val;
                  const joined = r.map(row => row.join('\t')).join('\n');
                  onTextChange(p.index, joined);
                }}
                className="bg-white border border-green-200 rounded"
              />
            ) : (
              <SmartTextarea
                ref={textareaRefs.current[p.index]}
                value={t}
                onChange={(newText) => onTextChange(p.index, newText)}
                className="w-full p-3 bg-white rounded border border-green-200 focus:border-green-400 focus:ring-1 focus:ring-green-400 text-sm resize-y min-h-[3.5rem] font-sans leading-relaxed whitespace-pre-wrap"
                rows={rows}
              />
            )}
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
  const [scrollToIndex, setScrollToIndex] = useState(null);
  const leftScrollRef = useRef(null);
  const rightScrollRef = useRef(null);
  const suppressSyncRef = useRef(false);

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

  // Scroll left/right panels together by matching paragraph index
  useEffect(() => {
    const left = leftScrollRef.current;
    const right = rightScrollRef.current;
    if (!left || !right) return;

    function offsetTo(el, ancestor) {
      let top = 0;
      while (el && el !== ancestor) {
        top += el.offsetTop;
        el = el.offsetParent;
      }
      return top;
    }

    function firstVisibleIndex(container) {
      const items = container.querySelectorAll('[data-para-index]');
      if (items.length === 0) return null;
      const st = container.scrollTop;
      for (let i = 0; i < items.length; i++) {
        const itemTop = offsetTo(items[i], container);
        if (itemTop + items[i].offsetHeight / 2 >= st - 5) {
          return parseInt(items[i].getAttribute('data-para-index'), 10);
        }
      }
      return parseInt(items[items.length - 1].getAttribute('data-para-index'), 10);
    }

    function scrollToPara(container, idx) {
      const target = container.querySelector(`[data-para-index="${idx}"]`);
      if (!target) return;
      suppressSyncRef.current = true;
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      requestAnimationFrame(() => { suppressSyncRef.current = false; });
    }

    const onLeft = () => {
      if (suppressSyncRef.current) return;
      const idx = firstVisibleIndex(left);
      if (idx == null) return;
      scrollToPara(right, idx);
    };
    const onRight = () => {
      if (suppressSyncRef.current) return;
      const idx = firstVisibleIndex(right);
      if (idx == null) return;
      scrollToPara(left, idx);
    };

    left.addEventListener('scroll', onLeft, { passive: true });
    right.addEventListener('scroll', onRight, { passive: true });
    return () => {
      left.removeEventListener('scroll', onLeft);
      right.removeEventListener('scroll', onRight);
    };
  }, [paragraphs, translations]);

  // Auto-scroll right panel to newly translated paragraph
  useEffect(() => {
    if (scrollToIndex == null) return;
    suppressSyncRef.current = true;
    const el = document.querySelector(`[data-para-index="${scrollToIndex}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setScrollToIndex(null);
    setTimeout(() => { suppressSyncRef.current = false; }, 300);
  }, [translations, scrollToIndex]);

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
      setScrollToIndex(para.index);
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
    const exportData = paragraphs
      .filter((p) => {
        const orig = originals[p.index] !== undefined ? originals[p.index] : p.text;
        const trans = translations[p.index];
        return trans !== undefined || (orig || '').trim().length > 0;
      })
      .map((p) => ({
        page: p.page,
        text: originals[p.index] !== undefined ? originals[p.index] : p.text,
        translated: translations[p.index],
        type: p.type,
        rows: p.type === 'table' ? (p.rows || getTableRows(p, originals)) : undefined,
        colCount: p.colCount,
      }));
    try {
      const filename = `${project.name || 'translation'}_${targetLang}.docx`;
      if ('showSaveFilePicker' in window) {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } }],
        });
        const blob = await generateDocxBlob(exportData);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        await generateDocx(exportData, filename);
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError('Export failed: ' + err.message);
    }
  };

  const handleSave = () => {
    const kept = [];
    const oldToNew = {};
    for (const p of paragraphs) {
      const text = originals[p.index] !== undefined ? originals[p.index] : p.text;
      if ((text || '').trim().length > 0) {
        oldToNew[p.index] = kept.length;
        kept.push({ ...p, text });
      }
    }
    const remapped = {};
    for (const p of kept) {
      const newIdx = oldToNew[p.index];
      if (translations[p.index] !== undefined) {
        remapped[newIdx] = translations[p.index];
      }
    }
    const html = kept.map((p) => {
      const sourceAttrs = `${p.source ? ` data-source="${p.source}"` : ''}` +
        `${p.sourceId ? ` data-source-id="${p.sourceId}"` : ''}` +
        `${p.sourcePage ? ` data-source-page="${p.sourcePage}"` : ''}`;
      if (p.type === 'table' && p.rows && p.rows.length > 0) {
        const rowsHtml = p.rows.map(r =>
          '<tr>' + r.map(c => '<td>' + (c || '') + '</td>').join('') + '</tr>'
        ).join('');
        return `<table data-page="${p.page}" data-filename="${p.filename || ''}" data-type="table"${sourceAttrs}>${rowsHtml}</table>`;
      }
      return `<p data-page="${p.page}" data-filename="${p.filename || ''}"${sourceAttrs}>${p.text}</p>`;
    }).join('\n');
    onSave(html, { translations: remapped });
  };

  return (
    <div className="h-full flex">
      {/* LEFT PANE: Originals grouped by page */}
      <div className="w-1/2 border-r border-gray-300 flex flex-col">
        <div className="bg-gray-100 px-4 py-2 border-b border-gray-300 text-sm font-medium text-gray-700 flex items-center justify-between">
          <span>Original Document</span>
          <span className="text-xs text-gray-500">{pages.length} pages · {paragraphs.length} paragraphs</span>
        </div>
        <div ref={leftScrollRef} className="flex-1 overflow-y-auto p-4">
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
              projectId={project?.id}
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

        <div ref={rightScrollRef} className="flex-1 overflow-y-auto p-4">
          {Object.keys(translations).length > 0 ? (
            pages.map(({ page, paragraphs: pageParas }) => (
              <TranslationPageGroup
                key={page}
                pageNum={page}
                paragraphs={pageParas}
                translations={translations}
                onTextChange={updateTranslation}
                projectId={project?.id}
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
