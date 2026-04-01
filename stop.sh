#!/bin/bash

# Restaurant Recommendation System Stop Script

echo "🛑 Stopping Restaurant Recommendation System..."
echo ""

# Kill processes on ports 3000 and 5008
echo "Stopping Flask backend (Port 5008)..."
lsof -ti:5008 2>/dev/null | xargs kill -9 2>/dev/null
pkill -f "python app.py" 2>/dev/null

echo "Stopping Node.js frontend (Port 3000)..."
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null
pkill -f "node server.js" 2>/dev/null

sleep 1

# Verify servers are stopped
if ! lsof -i:5008 > /dev/null 2>&1 && ! lsof -i:3000 > /dev/null 2>&1; then
    echo ""
    echo "✅ All servers stopped successfully!"
else
    echo ""
    echo "⚠️  Some servers may still be running. Please check manually."
fi

echo ""

