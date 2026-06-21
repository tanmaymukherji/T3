#!/bin/bash
echo "=============================================="
echo "   Translation Tool - Setup & Dev Server"
echo "=============================================="
echo ""

cd "$(dirname "$0")"

# Step 1: Install Node dependencies
echo "[1/4] Installing Node.js dependencies..."
npm install

# Step 2: Install Python dependencies
echo "[2/4] Installing Python dependencies..."
cd backend
pip install -r requirements.txt

# Step 3: Setup Tesseract OCR (embedded)
echo "[3/4] Setting up Tesseract OCR..."
python setup_tesseract.py

# Step 4: Start backend server
echo "[4/4] Starting servers..."
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 5

# Start frontend dev server
npm run dev &
FRONTEND_PID=$!

echo ""
echo "=============================================="
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo "  API Docs: http://localhost:8000/docs"
echo "=============================================="
echo ""

# Trap to kill both on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
