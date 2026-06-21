# Translation Tool

A fully browser-based standalone web app hosted on GitHub Pages:
1. Select a folder of scanned images (Hindi/English/Sanskrit)
2. Extract text via OCR (runs entirely in browser via Tesseract.js WebAssembly)
3. Edit and translate paragraph-by-paragraph into 10 Indian languages
4. Export translated DOCX files

**No backend required. No local server. No installation.**
Just open the URL and use it.

## Live Site
https://tanmaymukherji.github.io/Translation_Tool/

## Features
- **OCR**: Browser-based OCR using Tesseract.js (Hindi, English, Sanskrit)
- **Editor**: Split-pane editor to review extracted text and create translations
- **Translation**: Uses Hugging Face IndicTrans2 (primary) or Bhashini (secondary) APIs
- **Selective Translation**: Translate specific paragraphs, keep others original
- **Export**: Download translated documents as DOCX files

## Tech Stack
- React, Vite, Tailwind CSS
- Tesseract.js (browser OCR via WebAssembly)
- docx (client-side DOCX generation)
- idb (IndexedDB wrapper for document storage)
- Hugging Face Inference API / Bhashini API

## Setup (for development)
```bash
npm install
npm run dev
```

## Deploy to GitHub Pages
```bash
npm run deploy
```

## Usage
1. Open the app (local or GitHub Pages)
2. Click **+ Select Folder / Images** in the top-right
3. Choose a folder with scanned images (Chromium browsers) or select image files
4. Wait for OCR processing (runs entirely in your browser)
5. Review extracted paragraphs in the left pane
6. Click **Translate** on any paragraph to get a translation
7. Click **Keep Original** to retain the source text in the translation pane
8. Select target language and translation provider from the dropdown
9. Click **Export DOCX** to download the translated document
10. Click **Save** to persist to IndexedDB (local browser storage)
