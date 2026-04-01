# Restaurant Recommendation System

A restaurant menu recommendation system that uses machine learning to suggest food and drink items based on user preferences.

## Features

- Fuzzy matching for food and drink recommendations
- WordNet-based synonym expansion for better matching
- TF-IDF vectorization for similarity calculations
- Web interface for user preferences
- RESTful API endpoints

## Tech Stack

- **Backend**: Flask (Python) - Port 5008
- **Frontend**: Express.js (Node.js) - Port 3000
- **ML Libraries**: scikit-learn, pandas, numpy, fuzzywuzzy
- **Template Engine**: EJS

## Prerequisites

- Python 3.9+ 
- Node.js 
- npm

## Installation & Setup

### 1. Install Python Dependencies

```bash
# Activate the virtual environment
source venv/bin/activate

# Install missing dependencies
pip install flask-cors nltk
```

### 2. Install Node.js Dependencies

```bash
# Install all Node.js packages
npm install

# Install EJS template engine
npm install ejs
```

## Running the Application

### Quick Start (Easy Method)

Simply run the startup script:

```bash
./start.sh
```

To stop the servers:

```bash
./stop.sh
```

### Manual Start (Advanced)

You need to run **TWO servers** simultaneously:

#### Terminal 1: Start Flask Backend

```bash
# Activate virtual environment
source venv/bin/activate

# Run Flask server (Port 5008)
python app.py
```

You should see:
```
 * Running on http://127.0.0.1:5008
```

#### Terminal 2: Start Node.js Frontend

```bash
# Run Express server (Port 3000)
npm start
# OR
node server.js
```

You should see:
```
Server is running on http://localhost:3000
```

## Usage

1. Open your browser and navigate to: **http://localhost:3000**
2. Enter your food and drink preferences on the form
3. Submit the form to get personalized recommendations
4. View recommended foods and drinks based on your preferences

## API Endpoints

### Flask Backend (Port 5008)

- `GET /api/menu` - Get full menu (foods and drinks)
- `POST /api/recommend` - Get recommendations based on food and drink preferences
  - Body: `{ "food": "chicken", "drink": "coffee" }`
- `POST /api/sort_menu` - Sort menu by preferred items
  - Body: `{ "preferred_items": ["item1", "item2"] }`

### Express Frontend (Port 3000)

- `GET /` - Main preferences form
- `POST /preferences` - Submit preferences and view recommendations

## Project Structure

```
RestaurantAnalyze/
├── app.py                 # Flask backend server
├── server.js              # Express frontend server
├── package.json           # Node.js dependencies
├── kozbingol_menu.csv     # Restaurant menu data
├── views/                 # EJS templates
│   ├── preferences.ejs    # Preferences input form
│   └── recommendations.ejs # Recommendations display
├── public/                # Static files
├── actions/               # Rasa actions (if using chatbot)
├── data/                  # Rasa training data
├── domain.yml             # Rasa domain file
└── venv/                  # Python virtual environment
```

## Data File

The application uses `kozbingol_menu.csv` with the following structure:
- Category
- Item
- Description
- Price

## Troubleshooting

### Port Already in Use Error

**Problem:** `Port 5008 is in use` or `Port 3000 is in use`

**Solution:**
```bash
# Kill processes on the ports
lsof -ti:5008 | xargs kill -9
lsof -ti:3000 | xargs kill -9

# OR use the stop script
./stop.sh
```

### Node.js EPERM Error

**Problem:** `Error: listen EPERM: operation not permitted 0.0.0.0:3000`

**Solution:** This was fixed by binding to `127.0.0.1` instead of `0.0.0.0`. If you still see this error, make sure `server.js` line 47 reads:
```javascript
app.listen(3000, '127.0.0.1', function() {
```

### NLTK SSL Certificate Error

**Problem:** `[nltk_data] Error loading wordnet: certificate verify failed`

**Solution:** This is already fixed in `app.py` with SSL certificate bypass. The code automatically handles downloading WordNet data.

### Flask server won't start
- Make sure virtual environment is activated: `source venv/bin/activate`
- Check if port 5008 is already in use: `lsof -i :5008`
- Verify `kozbingol_menu.csv` exists in the project root

### Node.js server won't start
- Make sure all dependencies are installed: `npm install`
- Check if port 3000 is already in use: `lsof -i :3000`
- Verify EJS is installed: `npm list ejs`

### Recommendations not working
- Ensure both servers are running
- Check Flask backend is accessible at http://127.0.0.1:5008
- Verify menu CSV file is properly formatted

### Check Server Status
```bash
# Check if Flask is running
curl http://127.0.0.1:5008/api/menu

# Check if Node.js is running
curl http://localhost:3000

# Check running processes
ps aux | grep -E "(python app.py|node server.js)" | grep -v grep
```

## Notes

- The Flask backend must be running before submitting preferences on the frontend
- NLTK will download WordNet data on first run
- Some commented code exists in `app.py` for alternative recommendation approaches

