import React, { useState, useRef, useCallback, useEffect } from 'react';
import { fetchSuggestions, reOcrRegion } from '../../spellcheck';

function findLineBbox(lines, selStart, selEnd) {
  let offset = 0;
  for (const line of lines) {
    const lineLen = line.text.length;
    const lineStart = offset;
    const lineEnd = offset + lineLen;
    if (selStart < lineEnd && selEnd > lineStart) {
      return { bbox: line.bbox, lineText: line.text };
    }
    offset += lineLen + 1;
  }
  return null;
}

export function ReScanButton({ textareaRef, imageData, lines, onFocusImage, paraIndex, totalParas }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState({});
  const [selPreview, setSelPreview] = useState('');

  const close = useCallback(() => { setOpen(false); setResult(''); setLoading(false); }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (!e.target.closest('.rescan-popup') && !e.target.closest('.rescan-btn')) close(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  function estimateParaBbox(img, idx, total) {
    const ph = img.naturalHeight / total;
    return { x0: 0, y0: idx * ph, x1: img.naturalWidth, y1: (idx + 1) * ph };
  }

  const handleClick = useCallback(() => {
    const ta = textareaRef?.current;
    if (!ta) return;
    const sel = ta.selectionStart;
    const sele = ta.selectionEnd;
    const text = sel !== sele ? ta.value.substring(sel, sele).trim() : ta.value.trim();
    if (!text) { alert('The textarea is empty — nothing to cross-check.'); return; }

    const rect = btnRef.current?.getBoundingClientRect();
    let left = rect ? rect.left : 0;
    let top = rect ? rect.bottom + 4 : 0;
    if (left + 420 > window.innerWidth) left = Math.max(0, window.innerWidth - 420);
    if (top + 300 > window.innerHeight) top = Math.max(0, (rect ? rect.top : 0) - 300);
    setPos({ left, top });
    setSelPreview(text.length > 80 ? text.slice(0, 80) + '...' : text);
    setOpen(true);
    setResult('');
    setLoading(false);

    if (!imageData) { setResult('No image available for this page.'); return; }

    // If Tesseract provided line bbox, use it for precise crop
    if (lines && lines.length > 0 && sel !== sele) {
      const found = findLineBbox(lines, sel, sele);
      if (found && found.bbox && typeof found.bbox.x0 === 'number') {
        if (onFocusImage) onFocusImage(found.bbox);
        setLoading(true);
        reOcrRegion(imageData, found.bbox).then((txt) => {
          setResult(txt || '(empty result)');
          setLoading(false);
        }).catch((err) => {
          setResult('Error: ' + (err?.message || err || 'OCR.space API failed'));
          setLoading(false);
        });
        return;
      }
    }

    // Fallback: estimate bbox from paragraph position on the page
    if (paraIndex != null && totalParas != null && totalParas > 0) {
      const img = new window.Image();
      img.onload = () => {
        const bbox = estimateParaBbox(img, paraIndex, totalParas);
        if (onFocusImage) onFocusImage(bbox);
        setLoading(true);
        reOcrRegion(imageData, bbox).then((txt) => {
          setResult(txt || '(empty result)');
          setLoading(false);
        }).catch((err) => {
          setResult('Error: ' + (err?.message || err || 'OCR.space API failed'));
          setLoading(false);
        });
      };
      img.onerror = () => {
        setResult('Could not load image for region estimate.');
        setLoading(false);
      };
      img.src = imageData;
    } else {
      setResult('Cannot determine image region. Select a few words within a paragraph and try again.');
      setLoading(false);
    }
  }, [textareaRef, imageData, lines, onFocusImage, paraIndex, totalParas]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleClick}
        className="rescan-btn text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded hover:bg-orange-200"
        title="Re-scan image region with OCR.space"
      >
        ⟳ Re-scan
      </button>
      {open && (
        <div
          className="rescan-popup fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[280px] max-w-[420px] text-sm max-h-[80vh] overflow-y-auto"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="px-3 py-1.5 text-[10px] text-gray-400 border-b border-gray-100 truncate">
            Selected: &ldquo;{selPreview}&rdquo;
          </div>
          <div className="px-3 py-2">
            {loading ? (
              <div className="text-xs text-gray-400 animate-pulse">Scanning with OCR.space...</div>
            ) : result.startsWith('Error:') ? (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{result}</div>
            ) : (
              <textarea
                readOnly
                className="w-full text-sm text-gray-800 bg-indigo-50 border border-indigo-100 rounded p-2 resize-none outline-none cursor-text select-text"
                style={{ minHeight: 60, maxHeight: '55vh' }}
                value={result}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function SuggestionButton({ textareaRef }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [type, setType] = useState('none');
  const [pos, setPos] = useState({});

  const close = useCallback(() => { setOpen(false); setSuggestions([]); }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (!e.target.closest('.suggest-popup') && !e.target.closest('.suggest-btn')) close(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  const handleClick = useCallback(() => {
    const ta = textareaRef?.current;
    if (!ta) return;
    const sel = ta.selectionStart;
    const sele = ta.selectionEnd;
    if (sel === sele) { alert('Select a word first by highlighting it with the mouse.'); return; }
    const selected = ta.value.substring(sel, sele).trim();
    if (!selected || selected.includes(' ')) { alert('Please select a single word.'); return; }

    const rect = btnRef.current?.getBoundingClientRect();
    setPos({ left: rect ? rect.left : 0, top: rect ? rect.bottom + 4 : 0 });

    setWord(selected);
    setOpen(true);
    setLoading(true);
    setSuggestions([]);

    fetchSuggestions(selected, ta.value, sel, sele).then((result) => {
      setType(result.type);
      setSuggestions(result.alternatives);
      setLoading(false);
    });
  }, [textareaRef]);

  const handleReplace = useCallback((replacement) => {
    const ta = textareaRef?.current;
    if (!ta) return;
    const sel = ta.selectionStart;
    const sele = ta.selectionEnd;
    const newValue = ta.value.substring(0, sel) + replacement + ta.value.substring(sele);
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeInputValueSetter.call(ta, newValue);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  }, [textareaRef, close]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleClick}
        className="suggest-btn text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded hover:bg-purple-200"
      >
        Suggest
      </button>
      {open && (
        <div
          className="suggest-popup fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[260px] text-sm max-h-[80vh] overflow-y-auto"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-100 truncate max-w-[320px]">
            Selected: &ldquo;{word}&rdquo;
          </div>
          <div>
            {loading && <div className="px-3 py-2 text-xs text-gray-400">Loading dictionaries...</div>}
            {!loading && suggestions.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400">No alternatives found</div>
            )}
            {!loading && type === 'corrections' && suggestions.length > 0 && (
              <div className="px-3 pt-1.5 pb-0.5 text-[10px] text-amber-500 font-medium">Spelling corrections</div>
            )}
            {!loading && type === 'alternatives' && suggestions.length > 0 && (
              <div className="px-3 pt-1.5 pb-0.5 text-[10px] text-indigo-500 font-medium">Similar alternatives</div>
            )}
            {!loading && suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleReplace(s)}
                className="w-full text-left px-3 py-1.5 hover:bg-green-50 text-gray-700 font-medium block"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
