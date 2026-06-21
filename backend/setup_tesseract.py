"""
Tesseract OCR Auto-Download & Setup Script.

Downloads and installs Tesseract OCR automatically into backend/tesseract/.
No separate installation required.

Supports: Windows (via installer), macOS (via Homebrew), Linux (via apt).
"""

import os
import sys
import platform
import urllib.request
import subprocess
import shutil
import tempfile
from pathlib import Path

TESSERACT_DIR = os.path.join(os.path.dirname(__file__), "tesseract")
TESSERACT_EXE = os.path.join(TESSERACT_DIR, "tesseract.exe")


def download_file(url, dest):
    """Download a file with progress indicator."""
    print(f"Downloading:\n  {url}")
    print(f"  -> {dest}")

    def report(block_num, block_size, total_size):
        downloaded = block_num * block_size / 1024
        if total_size > 0:
            total = total_size / 1024
            percent = min(100, downloaded * 100 / total)
            print(f"\r  {percent:.0f}% ({downloaded:.0f}/{total:.0f} KB)", end="")
        else:
            print(f"\r  {downloaded:.0f} KB", end="")

    urllib.request.urlretrieve(url, dest, reporthook=report)
    print()


def install_windows():
    """Install Tesseract on Windows using UB-Mannheim silent installer."""
    if os.path.exists(TESSERACT_EXE):
        print(f"Tesseract already installed at: {TESSERACT_EXE}")
        return TESSERACT_EXE

    os.makedirs(TESSERACT_DIR, exist_ok=True)

    # Download the installer
    # Auto-detect latest version
    try:
        req = urllib.request.urlopen(
            "https://api.github.com/repos/UB-Mannheim/tesseract/releases/latest",
            timeout=10
        )
        import json
        data = json.loads(req.read())
        tag = data["tag_name"]
        # Find the Windows installer asset
        for asset in data["assets"]:
            if "w64" in asset["name"].lower() or "win" in asset["name"].lower():
                installer_url = asset["browser_download_url"]
                break
        else:
            raise KeyError("No Windows installer found in release")
        print(f"Latest release: {tag}")
    except Exception as e:
        print(f"Could not detect latest release ({e}), using fallback URL...")
        installer_url = (
            "https://github.com/UB-Mannheim/tesseract/releases/download/"
            "v5.4.0.20240606/"
            "tesseract-ocr-w64-setup-5.4.0.20240606.exe"
        )
    installer_path = os.path.join(tempfile.gettempdir(), "tesseract_setup.exe")

    download_file(installer_url, installer_path)

    # Run installer silently
    print("Installing Tesseract (silent mode)...")
    result = subprocess.run(
        [installer_path, "/S", f"/D={TESSERACT_DIR}"],
        capture_output=True, text=True, timeout=120
    )

    # Clean up installer
    try:
        os.remove(installer_path)
    except Exception:
        pass

    if result.returncode != 0:
        raise RuntimeError(f"Installer failed: {result.stderr}")

    if not os.path.exists(TESSERACT_EXE):
        raise RuntimeError(
            f"Tesseract.exe not found after installation at {TESSERACT_EXE}.\n"
            f"Stdout: {result.stdout}\nStderr: {result.stderr}"
        )

    print(f"Tesseract installed at: {TESSERACT_EXE}")
    return TESSERACT_EXE


def install_windows_portable():
    """Alternative: Download and extract portable Tesseract zip."""
    if os.path.exists(TESSERACT_EXE):
        return TESSERACT_EXE

    os.makedirs(TESSERACT_DIR, exist_ok=True)

    # Try multiple URLs for the portable build
    urls = [
        # Alternative portable builds
        "https://github.com/AlexanderPro/Tesseract-OCR/releases/download/"
        "v5.5.0.20241231/Tesseract-OCR.7z",
    ]

    # Use the first approach (silent installer) as primary
    return install_windows()


def download_language_packs():
    """Download language data for Hindi, English, Sanskrit."""
    tessdata_dir = os.path.join(TESSERACT_DIR, "tessdata")
    os.makedirs(tessdata_dir, exist_ok=True)

    lang_files = {
        "hin": "https://github.com/tesseract-ocr/tessdata_fast/raw/main/hin.traineddata",
        "eng": "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata",
        "san": "https://github.com/tesseract-ocr/tessdata_fast/raw/main/san.traineddata",
    }

    for code, url in lang_files.items():
        dest = os.path.join(tessdata_dir, f"{code}.traineddata")
        if not os.path.exists(dest):
            print(f"Downloading language pack: {code}...")
            try:
                download_file(url, dest)
            except Exception as e:
                print(f"  Warning: Failed to download {code}: {e}")

    print(f"Language packs in: {tessdata_dir}")


def setup_tesseract():
    """Main setup - ensures Tesseract is available on any platform."""
    print("=" * 60)
    print("  Translation Tool - Tesseract OCR Setup")
    print("=" * 60)
    system = platform.system()

    # Check if already installed on system PATH
    try:
        if system == "Windows":
            result = subprocess.run(
                ["where", "tesseract"], capture_output=True, text=True, timeout=5
            )
        else:
            result = subprocess.run(
                ["which", "tesseract"], capture_output=True, text=True, timeout=5
            )
        if result.returncode == 0:
            path = result.stdout.strip().split("\n")[0]
            print(f"Tesseract found on system: {path}")
            return path
    except Exception:
        pass

    # Check bundled
    if os.path.exists(TESSERACT_EXE):
        print(f"Tesseract bundled at: {TESSERACT_EXE}")
        download_language_packs()
        return TESSERACT_EXE

    # Download and install
    print("Tesseract not found. Downloading and installing...")

    if system == "Windows":
        exe_path = install_windows()
        download_language_packs()
    elif system == "Linux":
        print("Installing via apt...")
        subprocess.run(
            ["sudo", "apt-get", "install", "-y", "tesseract-ocr",
             "tesseract-ocr-hin", "tesseract-ocr-eng", "tesseract-ocr-san"],
            check=True, timeout=120
        )
        exe_path = "/usr/bin/tesseract"
    elif system == "Darwin":
        print("Installing via Homebrew...")
        subprocess.run(["brew", "install", "tesseract"], check=True, timeout=300)
        subprocess.run(["brew", "install", "tesseract-lang"], check=False, timeout=300)
        exe_path = "/usr/local/bin/tesseract"
    else:
        raise RuntimeError(f"Unsupported platform: {system}")

    print(f"\nTesseract ready: {exe_path}")
    return exe_path


if __name__ == "__main__":
    try:
        path = setup_tesseract()
        print(f"\n[OK] Tesseract OCR is ready at: {path}")
    except Exception as e:
        print(f"\n[ERROR] Tesseract setup failed: {e}")
        print("\nPlease install Tesseract manually:")
        print("  Windows: https://github.com/UB-Mannheim/tesseract/wiki")
        print("  macOS:   brew install tesseract")
        print("  Linux:   sudo apt install tesseract-ocr")
        sys.exit(1)
