#!/bin/bash
# CareerFlow SG — Setup Script
# Run this to get everything ready

echo "🚀 Setting up CareerFlow SG..."
echo ""

# Check prerequisites
echo "✓ Checking prerequisites..."
command -v node >/dev/null 2>&1 || { echo "❌ Node.js not found. Install from https://nodejs.org"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "❌ Python 3 not found. Install from https://python.org"; exit 1; }
command -v pip3 >/dev/null 2>&1 || { echo "❌ pip3 not found."; exit 1; }

echo "  Node.js: $(node --version)"
echo "  Python: $(python3 --version)"
echo ""

# Backend setup
echo "📦 Installing backend dependencies..."
cd backend
pip3 install -r requirements.txt 2>&1 | tail -3
cd ..

# Create .env file
if [ ! -f backend/.env ]; then
    echo ""
    echo "⚠️  Creating backend/.env..."
    cp backend/.env.example backend/.env
    echo "   → Please edit backend/.env and add your Groq API key"
    echo "   → Get a free key at: https://console.groq.com/keys"
fi

# Frontend setup
echo ""
echo "📦 Installing frontend dependencies..."
cd frontend
npm install 2>&1 | tail -3
cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit backend/.env and add your MODEL_API_KEY"
echo "  2. Start the backend:  cd backend && uvicorn main:app --reload --port 8000"
echo "  3. Start the frontend: cd frontend && npm run dev"
echo "  4. Open http://localhost:3000 in your browser"
echo ""
