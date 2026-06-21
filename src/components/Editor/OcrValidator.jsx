import React, { useState, useRef, useCallback } from 'react';

function ZoomableImage({ src, alt }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imgRef = useRef(null);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.max(0.25, Math.min(5, z + delta)));
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (zoom > 1) {
      setDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [zoom, pan]);

  const handleMouseMove = useCallback((e) => {
    if (dragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  }, [dragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return (
    <div
      className="w-full h-full overflow-hidden bg-gray-900 flex items-center justify-center relative"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className="max-w-none transition-transform duration-75"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
        draggable={false}
      />
      <div className="absolute bottom-3 right-3 flex gap-1">
        <button
          onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
          className="bg-white/80 hover:bg-white text-gray-800 rounded px-2 py-1 text-xs font-bold"
          title="Zoom out"
        >−</button>
        <span className="bg-white/80 text-gray-800 rounded px-2 py-1 text-xs font-mono">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom((z) => Math.min(5, z + 0.25))}
          className="bg-white/80 hover:bg-white text-gray-800 rounded px-2 py-1 text-xs font-bold"
          title="Zoom in"
        >+</button>
        <button
          onClick={resetView}
          className="bg-white/80 hover:bg-white text-gray-800 rounded px-2 py-1 text-xs"
          title="Reset view"
        >⟲</button>
      </div>
    </div>
  );
}

export default function OcrValidator({ images, paragraphs, onSaveParagraphs }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [edited, setEdited] = useState({});

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

  const pages = [...new Set(paragraphs.map((p) => p.page))].sort((a, b) => a - b);

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
        <div className="ml-auto flex gap-2">
          <span className="text-xs text-gray-500 self-center">
            {pageParagraphs.length} paragraph{pageParagraphs.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={handleSave}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1 rounded"
          >
            Save OCR Corrections
          </button>
        </div>
      </div>

      {/* Split panes */}
      <div className="flex-1 flex">
        {/* Left: Image */}
        <div className="w-1/2 border-r border-gray-300">
          {pageImage ? (
            <ZoomableImage src={pageImage.data} alt={`Page ${currentPage}`} />
          ) : (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              No image for this page
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
            pageParagraphs.map((p) => {
              const text = getText(p);
              const rows = Math.max(2, text.split('\n').length, Math.ceil(text.length / 60));
              const hasChanges = edited[p.index] !== undefined && edited[p.index] !== p.text;
              return (
                <div key={p.index} className="mb-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] text-gray-400 font-mono">¶{p.index + 1}</span>
                    {hasChanges && <span className="text-[11px] text-amber-600 font-medium">edited</span>}
                  </div>
                  <textarea
                    value={text}
                    onChange={(e) => updateText(p.index, e.target.value)}
                    className={`w-full p-3 rounded border text-sm resize-y min-h-[3.5rem] font-sans leading-relaxed whitespace-pre-wrap ${
                      hasChanges
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
