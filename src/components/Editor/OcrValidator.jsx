import React, { useState, useRef, useCallback, useEffect } from 'react';
import SmartTextarea from './SmartTextarea';
import SuggestionButton, { ReScanButton } from './SuggestionButton';
import { readImage, readSourceDocument } from '../../storage';

function ZoomableImage({ src, alt, focusBox }) {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const [dims, setDims] = useState({ cw: 1, ch: 1, iw: 1, ih: 1 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragPanStart, setDragPanStart] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth) {
      setDims((prev) => ({ ...prev, iw: img.naturalWidth, ih: img.naturalHeight }));
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const sz = entry.contentBoxSize?.[0] || {};
        const cw = sz.inlineSize || entry.contentRect.width;
        const ch = sz.blockSize || entry.contentRect.height;
        if (cw && ch) {
          setDims((prev) => ({ ...prev, cw, ch }));
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.naturalWidth && img.naturalHeight) {
      setDims((prev) => ({ ...prev, iw: img.naturalWidth, ih: img.naturalHeight }));
      setLoaded(true);
    }
  }, []);

  const fitZoom = dims.cw > 0 && dims.iw > 0
    ? Math.min(dims.cw / dims.iw, dims.ch / dims.ih, 1)
    : 1;

  const clampPan = useCallback((x, y, z) => {
    const zf = z || zoom;
    const effectiveW = dims.iw * zf;
    const effectiveH = dims.ih * zf;
    const maxX = Math.max(0, (effectiveW - dims.cw) / 2);
    const maxY = Math.max(0, (effectiveH - dims.ch) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, [dims, zoom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left - dims.cw / 2;
      const my = e.clientY - rect.top - dims.ch / 2;
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      const newZoom = Math.max(fitZoom * 0.5, Math.min(5, zoom * factor));
      const scale = newZoom / zoom;
      const newPan = clampPan(
        pan.x * scale + mx * (1 - scale),
        pan.y * scale + my * (1 - scale),
        newZoom
      );
      setZoom(newZoom);
      setPan(newPan);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [zoom, pan, dims, fitZoom, clampPan]);

  useEffect(() => {
    if (loaded) {
      setZoom(fitZoom);
      setPan({ x: 0, y: 0 });
    }
  }, [loaded, dims.cw, dims.ch, dims.iw, dims.ih]);

  useEffect(() => {
    if (!loaded || !focusBox || dims.cw <= 0 || dims.iw <= 0) return;

    const bx = (focusBox.x0 + focusBox.x1) / 2;
    const by = (focusBox.y0 + focusBox.y1) / 2;
    const bw = focusBox.x1 - focusBox.x0;
    const bh = focusBox.y1 - focusBox.y0;

    const zoomForW = (dims.cw * 0.6) / bw;
    const zoomForH = (dims.ch * 0.6) / bh;
    const newZoom = Math.max(fitZoom * 0.5, Math.min(5, Math.min(zoomForW, zoomForH)));

    const newPanX = -(bx - dims.iw / 2) * newZoom;
    const newPanY = -(by - dims.ih / 2) * newZoom;

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [focusBox, loaded, dims, fitZoom]);

  const handleMouseDown = useCallback((e) => {
    if (zoom > fitZoom * 1.05) {
      setDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setDragPanStart({ x: pan.x, y: pan.y });
    }
  }, [zoom, fitZoom, pan]);

  const handleMouseMove = useCallback((e) => {
    if (dragging) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      setPan(clampPan(dragPanStart.x + dx, dragPanStart.y + dy, zoom));
    }
  }, [dragging, dragStart, dragPanStart, zoom, clampPan]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const zoomIn = useCallback(() => {
    const z = Math.min(5, zoom * 1.25);
    setZoom(z);
    setPan(clampPan(pan.x, pan.y, z));
  }, [zoom, pan, clampPan]);

  const zoomOut = useCallback(() => {
    const z = Math.max(fitZoom * 0.5, zoom / 1.25);
    setZoom(z);
    setPan(clampPan(pan.x, pan.y, z));
  }, [zoom, pan, fitZoom, clampPan]);

  const resetView = useCallback(() => {
    setZoom(fitZoom);
    setPan({ x: 0, y: 0 });
  }, [fitZoom]);

  const isZoomed = zoom > fitZoom * 1.05;

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden bg-gray-900 flex items-center justify-center relative select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: isZoomed ? (dragging ? 'grabbing' : 'grab') : 'default' }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={onImgLoad}
        className="max-w-none"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
        draggable={false}
      />
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/60 rounded-lg px-2 py-1">
        <button
          onClick={zoomOut}
          className="text-white hover:text-gray-300 px-2 py-0.5 text-sm font-bold leading-none"
          title="Zoom out"
        >−</button>
        <span className="text-white text-xs font-mono min-w-[4ch] text-center">
          {Math.round(zoom / fitZoom * 100)}%
        </span>
        <button
          onClick={zoomIn}
          className="text-white hover:text-gray-300 px-2 py-0.5 text-sm font-bold leading-none"
          title="Zoom in"
        >+</button>
        <span className="text-gray-500 mx-1">|</span>
        <button
          onClick={resetView}
          className="text-white hover:text-gray-300 px-2 py-0.5 text-xs"
          title="Fit to screen"
        >⟲ Fit</button>
      </div>
    </div>
  );
}

export default function OcrValidator({ projectId, images, sources = [], paragraphs, onSaveParagraphs }) {
  console.log('[OcrValidator] RENDER', {
    projectId,
    paragraphsCount: paragraphs?.length,
    paragraphsSample: paragraphs?.slice(0, 2).map(p => ({ i: p.index, t: p.text?.substring(0, 30) })),
  });
  const pages = [...new Set(paragraphs.map((p) => p.page))].sort((a, b) => a - b);

  const [currentPage, setCurrentPage] = useState(pages.length > 0 ? pages[0] : 1);
  const [edited, setEdited] = useState({});
  const [focusBbox, setFocusBbox] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const textareaRefs = useRef({});
  const imageUrlRef = useRef(null);
  const pdfUrlRef = useRef(null);

  const pageParagraphs = paragraphs.filter((p) => p.page === currentPage);
  const sourceParagraph = pageParagraphs.find(p => p.sourceId) || null;
  const pdfSource = sourceParagraph
    ? sources.find(source => source.id === sourceParagraph.sourceId && source.type === 'pdf')
    : null;
  const showSelectablePdf = !!pdfSource && sourceParagraph?.source === 'pdf_text';
  const sourcePage = sourceParagraph?.sourcePage || currentPage;

  // Load image when page changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Revoke previous URL
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
      setImageUrl(null);

      if (!projectId || !currentPage || showSelectablePdf) return;
      setPreviewLoading(true);
      const file = await readImage(projectId, currentPage);
      if (cancelled) return;
      if (file) {
        const url = URL.createObjectURL(file);
        imageUrlRef.current = url;
        setImageUrl(url);
      }
      setPreviewLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, currentPage, showSelectablePdf]);

  // Native PDF preview keeps text selectable and avoids raster snapshots.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
      setPdfUrl(null);

      if (!projectId || !showSelectablePdf || !pdfSource) return;
      setPreviewLoading(true);
      const file = await readSourceDocument(projectId, pdfSource.storageName || pdfSource.id);
      if (cancelled) return;
      if (file) {
        const url = URL.createObjectURL(file);
        pdfUrlRef.current = url;
        setPdfUrl(url);
      }
      setPreviewLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, showSelectablePdf, pdfSource?.id, pdfSource?.storageName]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
    };
  }, []);

  // Reset to first page if pages change
  useEffect(() => {
    if (pages.length > 0 && !pages.includes(currentPage)) {
      setCurrentPage(pages[0]);
    }
  }, [pages]);

  const updateText = (index, newText) => {
    setEdited((prev) => ({ ...prev, [index]: newText }));
  };

  const updateTableCell = (paraIndex, edited, ri, ci, val) => {
    const raw = edited[paraIndex] !== undefined ? edited[paraIndex] : '';
    const rows = raw ? raw.split('\n').map(l => l.split('\t')) : [];
    if (rows[ri]) rows[ri][ci] = val;
    const joined = rows.map(r => r.join('\t')).join('\n');
    setEdited((prev) => ({ ...prev, [paraIndex]: joined }));
  };

  const getTableRows = (para) => {
    const raw = edited[para.index] !== undefined ? edited[para.index] : (para.text || '');
    return raw.split('\n').map(l => l.split('\t'));
  };

  const getText = (para) => edited[para.index] !== undefined ? edited[para.index] : para.text;

  const handleSave = async () => {
    console.log('[OcrValidator] handleSave START', {
      paragraphsCount: paragraphs.length,
      paragraphsSample: paragraphs.slice(0, 2).map(p => ({ i: p.index, t: p.text })),
      editedKeys: Object.keys(edited),
      editedSample: Object.entries(edited).slice(0, 2),
    });
    const updated = paragraphs.map((p) => {
      const entry = { ...p, text: edited[p.index] !== undefined ? edited[p.index] : p.text };
      if (p.type === 'table' && edited[p.index] !== undefined) {
        const rows = entry.text.split('\n').map(l => l.split('\t'));
        entry.rows = rows;
        entry.colCount = rows[0]?.length || 0;
      }
      return entry;
    });
    console.log('[OcrValidator] handleSave UPDATED', {
      count: updated.length,
      sample: updated.slice(0, 2).map(p => ({ i: p.index, t: p.text })),
    });
    const success = await onSaveParagraphs(updated);
    if (success) {
      setEdited({});
    }
  };

  const hasEdits = Object.keys(edited).length > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Page selector */}
      <div className="bg-gray-100 border-b border-gray-300 px-4 py-2 flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Page:</span>
        {pages.map((pg) => (
          <button
            key={pg}
            onClick={() => setCurrentPage(pg)}
            className={`px-3 py-1 rounded text-xs font-medium ${
              currentPage === pg
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-200 border border-gray-300'
            }`}
          >
            {pg}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {pageParagraphs.length} paragraph{pageParagraphs.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={handleSave}
            disabled={!hasEdits}
            className={`text-xs px-3 py-1 rounded ${
              hasEdits
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            Save OCR Corrections
          </button>
        </div>
      </div>

      {/* Split panes */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: selectable PDF for native text, image for OCR sources */}
        <div className="w-1/2 border-r border-gray-300">
          {showSelectablePdf && pdfUrl ? (
            <div className="h-full flex flex-col bg-gray-800">
              <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 text-xs text-gray-300">
                <span className="truncate" title={pdfSource.filename}>{pdfSource.filename} · page {sourcePage}</span>
                <a
                  href={`${pdfUrl}#page=${sourcePage}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-300 hover:text-indigo-200 ml-3 whitespace-nowrap"
                >
                  Open PDF
                </a>
              </div>
              <iframe
                key={`${pdfSource.id}-${sourcePage}`}
                src={`${pdfUrl}#page=${sourcePage}&zoom=page-width`}
                title={`${pdfSource.filename} page ${sourcePage}`}
                className="flex-1 w-full bg-white border-0"
              />
            </div>
          ) : imageUrl ? (
            <ZoomableImage src={imageUrl} alt={`Page ${currentPage}`} focusBox={focusBbox} />
          ) : (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm bg-gray-800">
              {previewLoading
                ? 'Loading source...'
                : showSelectablePdf
                  ? 'Original PDF is unavailable for this project.'
                  : projectId ? 'No image available' : 'No source available'}
            </div>
          )}
        </div>

        {/* Right: OCR text */}
        <div className="w-1/2 overflow-y-auto p-4 bg-gray-50">
          {pageParagraphs.length === 0 ? (
            <div className="text-center text-gray-400 mt-20">
              <p className="text-lg">No paragraphs on this page</p>
            </div>
          ) : (
            pageParagraphs.map((p, idx) => {
              const text = getText(p);
              const rows = Math.max(2, text.split('\n').length, Math.ceil(text.length / 60));
              const isEdited = edited[p.index] !== undefined && edited[p.index] !== p.text;
              if (!textareaRefs.current[p.index]) textareaRefs.current[p.index] = React.createRef();
              const isTable = p.type === 'table';
              return (
                <div key={p.index} className="mb-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    {!isTable && <SuggestionButton textareaRef={textareaRefs.current[p.index]} />}
                    {!isTable && <ReScanButton
                      textareaRef={textareaRefs.current[p.index]}
                      imageData={imageUrl}
                      lines={p.lines}
                      onFocusImage={setFocusBbox}
                      paraIndex={idx}
                      totalParas={pageParagraphs.length}
                      disabled={p.source === 'pdf_text'}
                    />}
                    <span className="text-[11px] text-gray-400 font-mono">{isTable ? '⊞' : '¶'}{p.index + 1}</span>
                    {isTable && <span className="text-[10px] text-indigo-500 font-medium">Table</span>}
                    {isEdited && <span className="text-[11px] text-amber-600 font-medium">edited</span>}
                  </div>
                  {isTable ? (
                    <div className="overflow-x-auto bg-white border border-gray-300 rounded">
                      <table className="w-full border-collapse border border-gray-400 text-sm">
                        <tbody>
                          {getTableRows(p).map((row, ri) => (
                            <tr key={ri}>
                              {row.map((cell, ci) => (
                                <td key={ci} className="border border-gray-400 p-1 min-w-[60px] align-top">
                                  <textarea
                                    value={cell}
                                    onChange={(e) => updateTableCell(p.index, edited, ri, ci, e.target.value)}
                                    className="w-full bg-transparent resize-none outline-none border-none p-0 m-0 text-sm font-sans leading-snug"
                                    rows={Math.max(1, (cell || '').split('\n').length)}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <SmartTextarea
                      ref={textareaRefs.current[p.index]}
                      value={text}
                      onChange={(newText) => updateText(p.index, newText)}
                      className={`w-full p-3 rounded border text-sm resize-y min-h-[3.5rem] font-sans leading-relaxed whitespace-pre-wrap focus:outline-none ${
                        isEdited
                          ? 'bg-amber-50 border-amber-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500'
                          : 'bg-white border-gray-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400'
                      }`}
                      rows={rows}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
