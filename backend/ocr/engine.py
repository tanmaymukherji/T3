"""
OCR Engine - Uses embedded/bundled Tesseract.

If Tesseract is not installed on the system, run `python setup_tesseract.py`
to download a portable version into backend/tesseract/.
"""

import os
import sys
import subprocess
import re
import pytesseract
from PIL import Image, ImageEnhance
import numpy as np

# ── Bundled Tesseract path ──────────────────────────────────
BUNDLE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tesseract")
BUNDLED_EXE = os.path.join(BUNDLE_DIR, "tesseract.exe")


def _find_tesseract():
    """Find Tesseract: bundled dir first, then system PATH."""
    # 1. Check bundled version
    if os.path.exists(BUNDLED_EXE):
        return BUNDLED_EXE

    # 2. Check environment variable
    cmd = os.environ.get("TESSERACT_CMD", "")
    if cmd and os.path.exists(cmd):
        return cmd

    # 3. Common install paths
    candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        "/usr/bin/tesseract",
        "/usr/local/bin/tesseract",
        "/opt/homebrew/bin/tesseract",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c

    # 4. PATH lookup
    try:
        if sys.platform == "win32":
            result = subprocess.run(
                ["where", "tesseract"], capture_output=True, text=True, timeout=5
            )
        else:
            result = subprocess.run(
                ["which", "tesseract"], capture_output=True, text=True, timeout=5
            )
        if result.returncode == 0:
            return result.stdout.strip().split("\n")[0]
    except Exception:
        pass

    return None


TESSERACT_CMD = _find_tesseract()

if TESSERACT_CMD:
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD
    # If using bundled version, set TESSDATA_PREFIX for language packs
    if TESSERACT_CMD == BUNDLED_EXE:
        tessdata = os.path.join(BUNDLE_DIR, "tessdata")
        if os.path.isdir(tessdata):
            os.environ["TESSDATA_PREFIX"] = tessdata


def is_tesseract_available():
    """Check if Tesseract is available (bundled or system)."""
    return TESSERACT_CMD is not None


def get_tesseract_path():
    """Return path to Tesseract executable."""
    return TESSERACT_CMD


def get_tesseract_languages():
    """Get list of installed Tesseract language packs."""
    if not TESSERACT_CMD:
        return []
    try:
        result = subprocess.run(
            [TESSERACT_CMD, "--list-langs"],
            capture_output=True, text=True, timeout=10
        )
        langs = []
        for line in result.stdout.split("\n"):
            line = line.strip()
            if line and not line.startswith("List") and not line.startswith("Warning"):
                langs.append(line)
        return langs
    except Exception:
        return []


class OCRProcessor:
    """Process images using Tesseract OCR with multiple fallback strategies."""

    def __init__(self, lang: str = "default"):
        self.lang = lang
        self.available_langs = get_tesseract_languages()
        self._select_language_pack()

    def _select_language_pack(self):
        """Select the best available language pack."""
        if self.lang != "default":
            return

        preferred = ["hin", "eng", "san"]
        available = [l for l in preferred if l in self.available_langs]

        if available:
            self.lang = "+".join(available)
        elif self.available_langs:
            self.lang = "+".join(self.available_langs[:3])
        else:
            self.lang = "eng"  # fallback (usually always available)

    def preprocess_image(self, image_path: str) -> list:
        """
        Generate multiple preprocessed versions of an image.
        Returns list of (strategy_name, PIL_image) tuples.
        """
        pil_img = Image.open(image_path).convert("RGB")
        img = np.array(pil_img)
        strategies = []

        # Strategy 1: Grayscale + Otsu threshold
        try:
            import cv2
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
            _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            strategies.append(("otsu", Image.fromarray(thresh)))
        except Exception:
            pass

        # Strategy 2: Grayscale only
        try:
            import cv2
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
            strategies.append(("grayscale", Image.fromarray(gray)))
        except Exception:
            pass

        # Strategy 3: Contrast enhanced
        try:
            enhanced = ImageEnhance.Contrast(pil_img).enhance(2.0).convert("L")
            strategies.append(("enhanced", enhanced))
        except Exception:
            pass

        # Strategy 4: Original image (last resort)
        strategies.append(("original", pil_img))

        return strategies

    def process_image(self, image_path: str) -> dict:
        """Extract text from image using OCR with fallback strategies."""
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image not found: {image_path}")

        if not TESSERACT_CMD:
            return {
                "raw_text": "",
                "paragraphs": [],
                "word_count": 0,
                "filename": os.path.basename(image_path),
                "error": (
                    "Tesseract OCR is not installed.\n\n"
                    "Run this command in the backend directory to auto-install:\n"
                    "  python setup_tesseract.py\n\n"
                    "Or install manually from:\n"
                    "  https://github.com/UB-Mannheim/tesseract/wiki"
                ),
                "tesseract_available": False,
            }

        # Get preprocessing variants
        try:
            strategies = self.preprocess_image(image_path)
        except Exception as e:
            strategies = [(f"raw", Image.open(image_path))]

        # Tesseract configs to try (varying PSM modes)
        configs = [
            f'--oem 3 --psm 6 -l {self.lang} -c preserve_interword_spaces=1',
            f'--oem 3 --psm 3 -l {self.lang} -c preserve_interword_spaces=1',
            f'--oem 3 --psm 4 -l {self.lang} -c preserve_interword_spaces=1',
        ]

        best_result = None
        max_words = 0

        for strategy_name, pil_image in strategies:
            for config_str in configs:
                try:
                    raw = pytesseract.image_to_string(pil_image, config=config_str).strip()
                    wc = len(raw.split())
                    if wc > max_words:
                        max_words = wc
                        data = pytesseract.image_to_data(
                            pil_image, config=config_str,
                            output_type=pytesseract.Output.DICT
                        )
                        paras = []
                        cur = []
                        prev_block = -1
                        for i in range(len(data["text"])):
                            bn = data["block_num"][i]
                            t = data["text"][i].strip()
                            if bn != prev_block and prev_block != -1:
                                if cur:
                                    paras.append(" ".join(cur))
                                    cur = []
                            if t:
                                cur.append(t)
                            prev_block = bn
                        if cur:
                            paras.append(" ".join(cur))

                        best_result = {
                            "raw_text": raw,
                            "paragraphs": paras if paras else [raw],
                            "word_count": wc,
                            "strategy": strategy_name,
                        }
                except Exception:
                    continue

        if best_result is None:
            # Absolute fallback
            raw = pytesseract.image_to_string(
                Image.open(image_path).convert("RGB"),
                config=f'--oem 3 --psm 3 -l {self.lang}'
            ).strip()
            best_result = {
                "raw_text": raw,
                "paragraphs": [raw] if raw else [],
                "word_count": len(raw.split()),
                "strategy": "fallback",
            }

        best_result["filename"] = os.path.basename(image_path)
        best_result["tesseract_available"] = True
        best_result["tesseract_path"] = TESSERACT_CMD
        return best_result

    def process_batch(self, image_paths: list) -> list:
        """Process multiple images."""
        results = []
        for path in image_paths:
            try:
                results.append(self.process_image(path))
            except Exception as e:
                results.append({
                    "raw_text": "", "paragraphs": [],
                    "word_count": 0, "filename": os.path.basename(path),
                    "error": str(e),
                })
        return results
