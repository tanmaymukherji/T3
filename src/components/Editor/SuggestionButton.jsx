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

export default function SuggestionButton({ textareaRef, imageData, lines, paraIndex, totalParas, onFocusImage }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [type, setType] = useState('none');
  const [pos, setPos] = useState({});
  const [reOcrText, setReOcrText] = useState('');
  const [reOcrLoading, setReOcrLoading] = useState(false);

  const close = useCallback(() => { setOpen(false); setSuggestions([]); setReOcrText(''); setReOcrLoading(false); }, []);

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
    setSelStart(sel);
    setSelEnd(sele);
    setOpen(true);
    setLoading(true);
    setSuggestions([]);
    setReOcrText('');
    setReOcrLoading(false);

    fetchSuggestions(selected, ta.value, sel, sele).then((result) => {
      setType(result.type);
      setSuggestions(result.alternatives);
      setLoading(false);
    });

    // Zoom main image to the selected line region
    if (imageData && lines && lines.length > 0 && onFocusImage) {
      const found = findLineBbox(lines, sel, sele);
      if (found && found.bbox && typeof found.bbox.x0 === 'number') {
        onFocusImage(found.bbox);
      }
    }

    // Re-OCR the image region if bbox is available
    if (imageData && lines && lines.length > 0) {
      const found = findLineBbox(lines, sel, sele);
      if (found && found.bbox && typeof found.bbox.x0 === 'number') {
        setReOcrLoading(true);
        reOcrRegion(imageData, found.bbox).then((text) => {
          setReOcrText(text);
          setReOcrLoading(false);
        }).catch((err) => {
          setReOcrText('Error: ' + (err?.message || err || 'OCR API failed'));
          setReOcrLoading(false);
        });
      }
    }
  }, [textareaRef, imageData, lines, onFocusImage]);

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

  const showPreview = imageData;

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
          {showPreview && (
            <div className="px-3 py-2 border-b border-gray-100">
              <div className="text-[10px] text-gray-400 mb-1">
                {reOcrLoading ? 'Re-scanning image region...' : reOcrText ? (reOcrText.startsWith('Error:') ? 'Scan error:' : 'Fresh scan result:') : 'Image reference'}
              </div>
              {!reOcrLoading && reOcrText && (
                <div className={`text-sm font-medium rounded p-2 mb-2 border leading-relaxed break-words ${
                  reOcrText.startsWith('Error:')
                    ? 'text-red-700 bg-red-50 border-red-200'
                    : 'text-gray-800 bg-indigo-50 border-indigo-100'
                }`}>
                  {reOcrText}
                </div>
              )}
              {reOcrLoading && (
                <div className="text-xs text-gray-400 animate-pulse py-2">Scanning with OCR.space...</div>
              )}
            </div>
          )}
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
