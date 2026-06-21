@echo off
echo ==============================================
echo    Translation Tool - Setup ^& Dev Server
echo ==============================================
echo.

cd /d "%~dp0"

REM Step 1: Install Node dependencies
echo [1/4] Installing Node.js dependencies...
call npm install

REM Step 2: Install Python dependencies
echo [2/4] Installing Python dependencies...
cd backend
call pip install -r requirements.txt

REM Step 3: Setup Tesseract OCR (embedded, no manual install needed)
echo [3/4] Setting up Tesseract OCR...
python setup_tesseract.py

REM Step 4: Start the backend server
echo [4/4] Starting servers...
start "Translation Tool API" cmd /k "uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
cd ..

REM Wait for backend to start
timeout /t 5 /nobreak >nul

REM Start frontend dev server
start "Translation Tool Frontend" cmd /k "npm run dev"

echo.
echo ==============================================
echo    Backend:  http://localhost:8000
echo    Frontend: http://localhost:5173
echo    API Docs: http://localhost:8000/docs
echo ==============================================
echo.
echo Press any key to stop all servers...
pause
taskkill /f /im python.exe >nul 2>&1
taskkill /f /im cmd.exe /fi "WindowTitle eq Translation Tool*" >nul 2>&1
