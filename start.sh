#!/bin/bash

# Restaurant Recommendation System Startup Script

echo "🍽️  Starting Restaurant Recommendation System..."
echo ""

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "❌ Error: Virtual environment not found!"
    echo "Please create it first: python3 -m venv venv"
    exit 1
fi

# Kill any existing processes on ports 3000 and 5008
echo "🧹 Cleaning up existing processes..."
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null
lsof -ti:5008 2>/dev/null | xargs kill -9 2>/dev/null
sleep 1

# Start Flask backend
echo "🐍 Starting Flask backend (Port 5008)..."
source venv/bin/activate
python app.py > flask.log 2>&1 &
FLASK_PID=$!
echo "   Flask PID: $FLASK_PID"

# Wait for Flask to start
sleep 3

# Start Node.js frontend
echo "📦 Starting Node.js frontend (Port 3000)..."
node server.js > node.log 2>&1 &
NODE_PID=$!
echo "   Node.js PID: $NODE_PID"

# Wait for servers to fully start
sleep 2

# Check if servers are running
echo ""
echo "✅ Checking server status..."
if lsof -i:5008 > /dev/null 2>&1; then
    echo "   ✓ Flask backend is running on http://127.0.0.1:5008"
else
    echo "   ✗ Flask backend failed to start. Check flask.log"
fi

if lsof -i:3000 > /dev/null 2>&1; then
    echo "   ✓ Node.js frontend is running on http://localhost:3000"
else
    echo "   ✗ Node.js frontend failed to start. Check node.log"
fi

echo ""
echo "🎉 Application is ready!"
echo ""
echo "📱 Open your browser to: http://localhost:3000"
echo ""
echo "To stop the servers, run: ./stop.sh"
echo "Or manually kill processes:"
echo "   kill $FLASK_PID $NODE_PID"
echo ""

