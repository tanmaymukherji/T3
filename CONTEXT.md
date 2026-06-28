# T³ - Tanmay's Translation Tool — Project Context

## 1. Overview

A fully client-side, offline-capable document translation tool. Users import image folders or PDF/DOCX files, run OCR, validate/correct text, translate paragraphs (via Hugging Face / Bhashini / MyMemory / LibreTranslate / Google / OPUS-MT cascading), and export as `.docx`.

**Live:** https://tanmaymukherji.github.io/T3/  
**Deploy:** GitHub Actions — push to `master` triggers `.github/workflows/deploy.yml`  
**Stack:** React 18, Vite 5, Tailwind CSS 3, pdfjs-dist, Tesseract.js, mammoth, docx, nspell, Hugging Face Inference API

---

## 2. Data Flow

```
User selects folder/files
    → FolderImporter / DocxImporter
        → Images: OCR via Tesseract.js (web worker, non-blocking)
        → PDFs (text): extractTextParagraphs() — pdfjs main-thread
        → PDFs (scanned): renderPageToFile() + OCR
    → Merged into paragraphs[] + images[]
    → saveProject() → File System Access API (Documents/T3/projects/{id}/)
    → handleProjectResult()
        → loadProjects() (reads all project dirs from FS)
        → Opens editor (OcrValidator or SplitPaneEditor)
```

## 3. Persistence

- **Projects:** File System Access API — `Documents/T3/projects/{id}/project.json` + `images/`
- **Directory handle:** IndexedDB small config store (`T3Config`)
- **API keys / preferences:** `localStorage`
- **Old data:** Legacy IndexedDB (`TranslationTool`) deleted on first init

---

## 4. Key Components

| Component | File | Role |
|---|---|---|
| `App` | `src/App.jsx` | Root — state, routing, init, save orchestration |
| `FolderImporter` | `src/components/Importer/FolderImporter.jsx` | Bulk import from folder (images + PDFs mixed) |
| `DocxImporter` | `src/components/Importer/DocxImporter.jsx` | Single DOCX/PDF import |
| `OcrValidator` | `src/components/Editor/OcrValidator.jsx` | Side-by-side image + text correction |
| `SplitPaneEditor` | `src/components/Editor/SplitPaneEditor.jsx` | Translation workspace, synced scroll panes |
| `SuggestionButton` | `src/components/Editor/SuggestionButton.jsx` | Spellcheck + OCR re-scan per paragraph |
| `DocumentLibrary` | `src/components/Library/DocumentLibrary.jsx` | Project grid/listing |
| `SettingsPanel` | `src/components/SettingsPanel.jsx` | API keys, working directory, backup/restore |

---

## 5. Key Utility Modules

| Module | File | Role |
|---|---|---|
| `storage.js` | File System Access API persistence layer | `saveProject`, `readImage`, `writeImage`, `listProjects` |
| `pdf-utils.js` | pdfjs-dist wrapper | `extractTextParagraphs`, `renderPageToFile`, `detectTextPdf` |
| `ocr.js` | Tesseract.js wrapper | `ocrImage`, `ocrMultipleImages` |
| `translation.js` | Multi-provider translator | Hugging Face, Bhashini, MyMemory, LibreTranslate, Google, OPUS-MT |
| `spellcheck.js` | Hunspell spellcheck + OCR.space re-scan | `fetchSuggestions`, `reOcrRegion` |
| `docx.js` | DOCX export | `generateDocx`, `generateDocxBlob` |
| `config.js` | Constants | Languages, models, API URLs |

---

## 6. Critical Bug: "Page Unresponsive" on PDF Import

### Symptoms
- Only happens when importing folders containing PDFs (image-only imports work fine).
- Browser shows Chrome's "Page Unresponsive" dialog.
- Console shows **zero messages** (preserve log enabled).
- Tab may crash entirely.

### Debugging History

#### Attempt 1 — Reduce render scales + add sleeps/yields
- Changed: Lowered canvas scale to 0.5/1.5, added 50ms sleep + requestAnimationFrame between pages (text PDFs), added JPEG format.
- Result: Failed.

#### Attempt 2 — Remove canvas rendering + yields in text extraction
- Changed:
  - Removed `renderPageToFile()` + `writeImage()` loop for text PDFs entirely.
  - Added `yieldFrame()` inside `extractTextParagraphs()` between pages.
  - Added `yieldFrame()` in merge loop after each file and before `buildHtmlContent()`.
  - Added `setTimeout(0)` before `loadProjects()` in `handleProjectResult`.
- Result: User reports "no change" — but this was deployed via `gh-pages -d dist` which pushes to `gh-pages` branch, while the actual GitHub Pages site is deployed from `master` via GitHub Actions. User was running OLD code the entire time.

#### Attempt 3 — Correct deployment + debug logs (CURRENT)
- Changed: Pushed to `master` → triggers GitHub Actions → site properly updated.
- Added extensive `console.log` / `console.time` markers at every step:
  - `handleFolderSelect started` — very first line of click handler
  - `picker returned, handle:` — after `showDirectoryPicker()`
  - `files collected:` — after reading all folder entries
  - `processFiles started with N files` — inside `processFiles`
  - `processing PDF:` — for each PDF file
  - `arrayBuffer loaded, size:` — after `arrayBuffer()`
  - `pdfDoc loaded, pages:` — after `getDocument().promise`
  - `detectTextPdf result:` — after detection
  - `extract:<filename>` — time for `extractTextParagraphs()`
  - `merge` — time for merge loop
  - `saveProject` — time for `saveProject()`
- **Status:** Deployed and live. User testing pending.

### Console markers flow (text PDF path):

```
handleFolderSelect started
  picker returned, handle: <dirname>
  reading PDF: <filename>          (for each PDF encountered)
  files collected: N
  calling processFiles
processFiles started with N files
  processing PDF: <name> size: N  (for each PDF)
    arrayBuffer loaded, size: N
    pdfDoc loaded, pages: N
    detectTextPdf result: true/false
    extract:<name>: N ms           (extractTextParagraphs timing)
  merge: N ms                     (merge loop timing)
  saveProject: N ms               (saveProject timing)
processFiles: N ms                (total)
```

### How to test
1. Open Chrome DevTools (F12) → Console tab → Check "Preserve log"
2. Hard refresh (Ctrl+F5) to ensure latest JS loads
3. Click "+ Select Folder / Images"
4. Select a folder containing a text PDF
5. Report the **LAST** console message visible

---

## 7. Current Hypothesis

**The previous deploys (`gh-pages -d dist`) were pushing to the wrong branch.** The GitHub Actions workflow (`.github/workflows/deploy.yml`) deploys from `master`, not from the `gh-pages` branch. All attempts prior to commit `200b174` were testing old code that still had the canvas rendering loop.

With the correct deployment now live:
- Text PDFs skip canvas rendering entirely
- `extractTextParagraphs()` yields between pages via `requestAnimationFrame`
- Merge loop yields between files
- `console.log` markers at every step will pinpoint the exact location of any remaining block

### If markers don't appear at all (still zero console messages)
The issue is before any JavaScript runs — possibly:
1. Browser tab crashes during `showDirectoryPicker()` (Chrome bug with stored picker ID `t3-work-dir`)
2. Inline `<script>` error in `index.html` prevents React from mounting
3. Module script fails to load (CORS, network, MIME type)
4. Browser extension conflict

### If markers appear up to "processing PDF" then stop
The issue is in pdfjs PDF loading: `arrayBuffer()`, `getDocument().promise`, or `getPage()`/`getTextContent()`.

### If markers appear up to "extract" then the page unresponsive dialog shows
The issue is in `extractTextParagraphs()` — a single page's text extraction blocks for >5s (unlikely for text PDFs but possible with complex layouts).

---

## 8. Future Work (outside the bug)
- Background image renderer for scanned PDF page images (deferred after editor loads)
- Upgrade imported images to higher resolution after initial OCR
