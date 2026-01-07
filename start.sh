#!/bin/bash

echo "🚀 Uruchamianie app.smogw.pl..."
echo ""

# Start backend
echo "📦 Uruchamianie backendu (FastAPI)..."
cd backend
python3 -m app.main &
BACKEND_PID=$!
echo "✅ Backend uruchomiony (PID: $BACKEND_PID) na http://localhost:8000"
echo ""

# Wait for backend to start
sleep 3

# Start frontend
echo "🎨 Uruchamianie frontendu (React + Vite)..."
cd ../frontend
npm run dev &
FRONTEND_PID=$!
echo "✅ Frontend uruchomiony (PID: $FRONTEND_PID) na http://localhost:5173"
echo ""

echo "================================"
echo "🎉 app.smogw.pl gotowy!"
echo "================================"
echo "Frontend: http://localhost:5173"
echo "Backend API: http://localhost:8000"
echo "API Docs: http://localhost:8000/docs"
echo ""
echo "Naciśnij Ctrl+C aby zatrzymać obie aplikacje"
echo ""

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
