import os
import sys
import re
import importlib
import shutil
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import sqlite3
from datetime import datetime

# Load environment variables from .env file
env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
if os.path.exists(env_path):
    load_dotenv(env_path)
else:
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        load_dotenv(env_path)

from ocr.engine import OCRProcessor, is_tesseract_available, get_tesseract_path
from docx_handler import DocxHandler
from translation.factory import TranslationFactory

# Auto-setup Tesseract if not found
if not is_tesseract_available():
    print("Tesseract OCR not found. Attempting auto-download...")
    try:
        import subprocess
        subprocess.run(
            [sys.executable, os.path.join(os.path.dirname(__file__), "setup_tesseract.py")],
            check=True, timeout=120
        )
        # Re-import to pick up the new Tesseract path
        import importlib
        importlib.reload(importlib.import_module("ocr.engine"))
        from ocr.engine import OCRProcessor, is_tesseract_available, get_tesseract_path
        print(f"Tesseract auto-downloaded at: {get_tesseract_path()}")
    except Exception as e:
        print(f"WARNING: Auto-download failed: {e}")
        print("OCR features will be disabled until Tesseract is installed.")

app = FastAPI(title="Translation Tool API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = os.path.join(os.path.dirname(__file__), "projects.db")
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_path TEXT NOT NULL,
            docx_path TEXT NOT NULL,
            name TEXT NOT NULL,
            content TEXT DEFAULT '',
            paragraphs INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_opened TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


init_db()

ocr_processor = OCRProcessor()
docx_handler = DocxHandler()
translation_factory = TranslationFactory()


# ─── Pydantic Models ─────────────────────────────────────────

class ImportRequest(BaseModel):
    folder_path: str

class TranslateRequest(BaseModel):
    text: str
    src_lang: str = "auto"
    tgt_lang: str = "bn"

class SaveRequest(BaseModel):
    docx_path: str
    content: str

class SaveTranslationRequest(BaseModel):
    docx_path: str
    content: str
    target_lang: str


# ─── Utilities ────────────────────────────────────────────────

SANSKRIT_PATTERN = re.compile(r'[\u0900-\u097F]{3,}')

def is_sanskrit_text(text: str) -> bool:
    devanagari_chars = len(SANSKRIT_PATTERN.findall(text))
    total_chars = len(text.strip())
    if total_chars == 0:
        return False
    return devanagari_chars / total_chars > 0.3

def detect_language(text: str) -> str:
    devanagari = len(re.findall(r'[\u0900-\u097F]', text))
    latin = len(re.findall(r'[a-zA-Z]', text))
    total = devanagari + latin
    if total == 0:
        return "unknown"
    if latin / total > 0.6:
        return "eng_Latn"
    return "hin_Deva"

IMAGE_EXTENSIONS = ('.png', '.jpg', '.jpeg', '.tiff', '.tif')

def scan_folder_for_images(folder: str) -> list:
    """List image files in a folder, sorted by name."""
    return sorted([
        f for f in os.listdir(folder)
        if f.lower().endswith(IMAGE_EXTENSIONS)
    ])

def ocr_folder_images(folder: str, image_files: list) -> list:
    """Run OCR on all images and return extracted paragraphs."""
    all_paragraphs = []
    errors = []

    for img_file in image_files:
        img_path = os.path.join(folder, img_file)
        try:
            result = ocr_processor.process_image(img_path)
            # Log the result for debugging
            print(f"OCR [{img_file}]: {result.get('word_count', 0)} words, strategy={result.get('strategy', '?')}")
            for para in result.get("paragraphs", []):
                para_text = para.strip()
                if para_text:
                    all_paragraphs.append(para_text)
        except Exception as e:
            error_msg = f"OCR failed for {img_file}: {e}"
            print(error_msg)
            errors.append(error_msg)

    return all_paragraphs, errors

def build_project_from_text(paragraphs: list, folder: str, docx_path: str) -> dict:
    """Build project dict from extracted paragraphs and save to DB."""
    # Build HTML content
    html_paragraphs = []
    for para in paragraphs:
        lang = detect_language(para)
        data_attrs = f'data-lang="{lang}"'
        if is_sanskrit_text(para):
            data_attrs += ' data-sanskrit="true"'
        html_paragraphs.append(f'<p {data_attrs}>{para}</p>')

    content_html = "\n".join(html_paragraphs)

    # Save DOCX
    docx_handler.create_docx(paragraphs, docx_path)

    # Save to DB
    conn = get_db()
    project_name = os.path.basename(folder)
    conn.execute(
        "INSERT INTO projects (folder_path, docx_path, name, content, paragraphs, last_opened) VALUES (?, ?, ?, ?, ?, ?)",
        (folder, docx_path, project_name, content_html, len(paragraphs), datetime.now().isoformat())
    )
    conn.commit()
    project_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    project = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    conn.close()
    return dict(project)


# ─── Health & Status ──────────────────────────────────────────

@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "tesseract": is_tesseract_available(),
    }

@app.get("/api/check-internet")
def check_internet():
    import socket
    try:
        socket.create_connection(("8.8.8.8", 53), timeout=3)
        return {"online": True}
    except OSError:
        return {"online": False}

@app.get("/api/status")
def status():
    """Returns tool status, config, and available languages."""
    from ocr.engine import get_tesseract_languages
    return {
        "tesseract_installed": is_tesseract_available(),
        "tesseract_languages": get_tesseract_languages(),
        "projects_db": os.path.exists(DB_PATH),
        "providers": translation_factory.list_providers(),
    }


# ─── Projects ──────────────────────────────────────────────────

@app.get("/api/projects")
def list_projects():
    conn = get_db()
    rows = conn.execute("SELECT * FROM projects ORDER BY last_opened DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─── Import via folder path (local backend) ───────────────────

@app.post("/api/import")
def import_folder(req: ImportRequest):
    folder = req.folder_path
    if not os.path.isdir(folder):
        raise HTTPException(status_code=400, detail=f"Folder does not exist: {folder}")

    # Check for existing project
    conn = get_db()
    existing = conn.execute(
        "SELECT * FROM projects WHERE folder_path = ?", (folder,)
    ).fetchone()
    if existing:
        conn.close()
        return dict(existing)

    # Check if Tesseract is available
    if not is_tesseract_available():
        raise HTTPException(
            status_code=500,
            detail="Tesseract OCR is not installed. "
                   "Install from: https://github.com/UB-Mannheim/tesseract/wiki"
        )

    # Scan images
    image_files = scan_folder_for_images(folder)
    if not image_files:
        raise HTTPException(
            status_code=400,
            detail=f"No PNG, JPG, or TIFF images found in: {folder}"
        )

    # OCR each image
    all_paragraphs, errors = ocr_folder_images(folder, image_files)

    if not all_paragraphs:
        error_detail = "No text could be extracted from images."
        if errors:
            error_detail += f" Errors: {'; '.join(errors[:3])}"
        if is_tesseract_available():
            from ocr.engine import get_tesseract_languages
            langs = get_tesseract_languages()
            error_detail += f" Available Tesseract languages: {', '.join(langs) if langs else 'None'}"
        raise HTTPException(status_code=400, detail=error_detail)

    # Generate DOCX
    docx_filename = f"{os.path.basename(folder)}_original.docx"
    docx_path = os.path.join(folder, docx_filename)

    project = build_project_from_text(all_paragraphs, folder, docx_path)
    return project


# ─── Import via file upload (web frontend) ─────────────────────

@app.post("/api/upload")
async def upload_images(images: list[UploadFile] = File(...)):
    """Upload images via browser and process them."""
    if not images or len(images) == 0:
        raise HTTPException(status_code=400, detail="No images provided")

    if not is_tesseract_available():
        raise HTTPException(
            status_code=500,
            detail="Tesseract OCR is not installed. "
                   "Install from: https://github.com/UB-Mannheim/tesseract/wiki"
        )

    # Create a unique temp folder for this upload batch
    batch_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    batch_dir = os.path.join(UPLOAD_DIR, f"upload_{batch_id}")
    os.makedirs(batch_dir, exist_ok=True)

    saved_files = []
    for img in images:
        if not img.filename.lower().endswith(IMAGE_EXTENSIONS):
            continue
        file_path = os.path.join(batch_dir, img.filename)
        with open(file_path, "wb") as f:
            content = await img.read()
            f.write(content)
        saved_files.append(img.filename)

    if not saved_files:
        shutil.rmtree(batch_dir, ignore_errors=True)
        raise HTTPException(
            status_code=400,
            detail=f"No valid image files found. Supported: PNG, JPG, TIFF"
        )

    # OCR all images
    all_paragraphs, errors = ocr_folder_images(batch_dir, saved_files)

    if not all_paragraphs:
        shutil.rmtree(batch_dir, ignore_errors=True)
        error_detail = "No text could be extracted from uploaded images."
        if errors:
            error_detail += f" Errors: {'; '.join(errors[:3])}"
        raise HTTPException(status_code=400, detail=error_detail)

    # Generate DOCX
    docx_filename = f"upload_{batch_id}_original.docx"
    docx_path = os.path.join(batch_dir, docx_filename)

    project = build_project_from_text(all_paragraphs, batch_dir, docx_path)
    return project


# ─── Translation ────────────────────────────────────────────────

@app.post("/api/translate/hf")
def translate_huggingface(req: TranslateRequest):
    if is_sanskrit_text(req.text):
        return {"translation": req.text, "note": "Sanskrit text kept as-is"}

    src = req.src_lang
    if src == "auto":
        src = detect_language(req.text)

    try:
        result = translation_factory.translate("huggingface", req.text, src, req.tgt_lang)
        return {"translation": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/translate/bhashini")
def translate_bhashini(req: TranslateRequest):
    if is_sanskrit_text(req.text):
        return {"translation": req.text, "note": "Sanskrit text kept as-is"}

    src = req.src_lang
    if src == "auto":
        src = detect_language(req.text)

    try:
        result = translation_factory.translate("bhashini", req.text, src, req.tgt_lang)
        return {"translation": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Save ───────────────────────────────────────────────────────

@app.post("/api/save")
def save_document(req: SaveRequest):
    try:
        docx_handler.update_docx(req.docx_path, req.content)
        conn = get_db()
        conn.execute(
            "UPDATE projects SET content = ?, last_opened = ? WHERE docx_path = ?",
            (req.content, datetime.now().isoformat(), req.docx_path)
        )
        conn.commit()
        conn.close()
        return {"success": True, "docx_path": req.docx_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/save-translation")
def save_translation(req: SaveTranslationRequest):
    original_path = req.docx_path
    folder = os.path.dirname(original_path)
    base_name = os.path.basename(original_path).replace("_original.docx", "")

    translated_filename = f"{base_name}_{req.target_lang if req.target_lang != 'original' else 'original'}.docx"
    translated_path = os.path.join(folder, translated_filename)

    try:
        docx_handler.create_docx_from_html(req.content, translated_path)
        return {"success": True, "docx_path": translated_path, "filename": translated_filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
