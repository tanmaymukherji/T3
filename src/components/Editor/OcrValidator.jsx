import React, { useState, useRef, useCallback, useEffect } from 'react';
import SmartTextarea from './SmartTextarea';
import SuggestionButton from './SuggestionButton';

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
  const focusCounterRef = useRef(0);

  // Track container size with proper fallback
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

  // When image loads, get natural size and fit to container
  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    setDims((prev) => ({ ...prev, iw, ih }));
    setLoaded(true);
  }, []);

  // Recalculate fit zoom when container or image dimensions change
  const fitZoom = dims.cw > 0 && dims.iw > 0
    ? Math.min(dims.cw / dims.iw, dims.ch / dims.ih, 1)
    : 1;

  // Reset to fit-to-screen when image loads or container resizes
  useEffect(() => {
    if (loaded) {
      setZoom(fitZoom);
      setPan({ x: 0, y: 0 });
    }
  }, [loaded, dims.cw, dims.ch, dims.iw, dims.ih]);

  // Focus on a specific image region when focusBox changes
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

    focusCounterRef.current += 1;
    console.log(`[ZoomableImage] focus #${focusCounterRef.current}:`, {
      bbox: focusBox,
      newZoom,
      newPanX,
      newPanY,
      dims,
      fitZoom
    });

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [focusBox, loaded, dims, fitZoom]);

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

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
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
  }, [zoom, pan, dims, fitZoom, clampPan]);

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
      onWheel={handleWheel}
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

export default function OcrValidator({ images, paragraphs, onSaveParagraphs }) {
  const pages = [...new Set(paragraphs.map((p) => p.page))].sort((a, b) => a - b);

  const [currentPage, setCurrentPage] = useState(pages.length > 0 ? pages[0] : 1);
  const [edited, setEdited] = useState({});
  const [focusBbox, setFocusBbox] = useState(null);
  const textareaRefs = useRef({});

  // Reset to first page if pages change
  useEffect(() => {
    if (pages.length > 0 && !pages.includes(currentPage)) {
      setCurrentPage(pages[0]);
    }
  }, [pages]);

  const pageParagraphs = paragraphs.filter((p) => p.page === currentPage);
  const pageImage = images?.find((img) => img.page === currentPage);

  const updateText = (index, newText) => {
    setEdited((prev) => ({ ...prev, [index]: newText }));
  };

  const getText = (para) => edited[para.index] !== undefined ? edited[para.index] : para.text;

  const handleSave = () => {
    const updated = paragraphs.map((p) => ({
      ...p,
      text: edited[p.index] !== undefined ? edited[p.index] : p.text,
    }));
    onSaveParagraphs(updated);
    setEdited({});
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
        {/* Left: Image */}
        <div className="w-1/2 border-r border-gray-300">
          {pageImage ? (
            <ZoomableImage src={pageImage.data} alt={`Page ${currentPage}`} focusBox={focusBbox} />
          ) : (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm bg-gray-800">
              No image available
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
              return (
                <div key={p.index} className="mb-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <SuggestionButton
                      textareaRef={textareaRefs.current[p.index]}
                      imageData={pageImage?.data}
                      lines={p.lines}
                      paraIndex={idx}
                      totalParas={pageParagraphs.length}
                      onFocusImage={setFocusBbox}
                    />
                    <span className="text-[11px] text-gray-400 font-mono">¶{p.index + 1}</span>
                    {isEdited && <span className="text-[11px] text-amber-600 font-medium">edited</span>}
                  </div>
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
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
