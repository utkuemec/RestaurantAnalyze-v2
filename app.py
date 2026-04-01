# -*- coding: utf-8 -*-

from flask import Flask, request, jsonify
import pandas as pd
from flask_cors import CORS

import nltk
import ssl

try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context

try:
    nltk.data.find('corpora/wordnet')
except LookupError:
    nltk.download('wordnet', quiet=True)

from recommendation_engine import HybridRecommender, DRINK_CATEGORIES

app = Flask(__name__)
CORS(app)

_raw = pd.read_csv('mado_menu.csv', encoding='utf-8', delimiter=',')
_raw = _raw[_raw['category'] != 'Retail'].copy()


def _clean_name(name):
    name = str(name).strip()
    if name.startswith('with Ice Cream '):
        name = name[15:] + ' with Ice Cream'
    for pfx in ['Beverages ', 'Coffee ', 'Meat ', 'Desserts ',
                 '& Pastry ', 'Friendly ', 'Platter ', 'Juice ']:
        if name.startswith(pfx):
            name = name[len(pfx):]
            break
    return name.strip()


_DESC_CAT = {
    'Appetizers & Salads & Sides': 'Appetizer or side dish. A great way to start your meal.',
    'Bakery': 'Fresh-baked Turkish pastry and bread.',
    'Baklava': 'Traditional Turkish baklava dessert with layers of phyllo pastry and nuts, soaked in sweet syrup.',
    'Breakfasts & Eggs': 'Hearty breakfast dish served fresh in the morning.',
    'Breakfasts': 'Traditional Turkish breakfast dish.',
    'Cold Desserts': 'Cold dessert treat — cakes, puddings, and sweets.',
    'Doner & Wraps': 'Turkish doner or wrap served with fresh vegetables and fries.',
    'Hot Desserts': 'Warm dessert served fresh from the kitchen with ice cream.',
    'Ice Cream & Frozen Yoghurt': 'Authentic Turkish stretchy ice cream, creamy and delicious.',
    "Kid's Menu": 'Kid-friendly meal served with sides.',
    'Mains': 'Main course dish grilled to perfection and served with sides.',
    'Pasta & Pizza': 'Italian-inspired pasta or freshly baked pizza.',
    'Sandwiches & Wraps': 'Fresh sandwich or wrap served with sides.',
    'Vegan & Vegetarian': 'Vegan or vegetarian option, plant-based and delicious.',
    'Wraps & Burgers': 'Wrap or burger served with crispy fries.',
    'Hot Drinks': 'Hot beverage prepared fresh.',
    'Cold Drinks': 'Cold refreshing beverage.',
}

_DESC_SUB = {
    'Red': 'Premium red meat — beef or lamb.',
    'Poultry': 'Tender chicken dish.',
    'Seafood': 'Fresh seafood — fish or salmon.',
    'Family': 'Grand sharing platter with assorted items, perfect for group dining.',
    'Salads': 'Fresh salad with seasonal greens and dressing.',
    'Appetizers': 'Traditional meze or starter.',
    'Sides': 'Side dish to complement your meal.',
    'Soup': 'Warm homemade soup.',
    'Boreks': 'Traditional Turkish borek — flaky phyllo pastry with filling.',
    'Eggs': 'Egg dish prepared to order.',
    'Pizza': 'Freshly baked pizza with quality toppings.',
    'Pasta': 'Pasta dish with house sauce.',
    'Burgers': 'Juicy burger with fresh toppings and fries.',
    'Wraps': 'Fresh wrap with choice of filling.',
    'Tea': 'Aromatic tea infusion.',
    'Hot': 'Freshly brewed hot beverage.',
    'Cold': 'Chilled and refreshing.',
    'Pistachio': 'Made with premium ground pistachios.',
    'Walnut': 'Made with crushed walnuts.',
    'Milkshake': 'Thick creamy milkshake blended fresh.',
    'Smoothie': 'Fresh fruit smoothie blended with ice.',
    'Lemonade': 'Freshly squeezed lemonade, sweet and tangy.',
    'Iced Coffee': 'Iced espresso coffee drink.',
    'Iced Tea': 'Cold brewed tea served over ice.',
    'Espresso': 'Strong espresso coffee.',
    'Turkish Coffee': 'Traditional Turkish coffee brewed in a cezve.',
    'Hot Chocolate': 'Rich and creamy hot chocolate.',
    'Cakes': 'Homemade cake or pastry dessert.',
    'Vegan': 'Fully vegan — no animal products.',
    'Vegetarian': 'Vegetarian-friendly.',
    'Signature': 'Signature house special ice cream bowl.',
    'Layered': 'Turkish ice cream layered in a cone.',
    'Tastes': 'Special dessert combination with ice cream.',
    'Ayran (Yogurt Drink)': 'Traditional Turkish yogurt drink — cold, salty, and refreshing.',
    'Energy Drink': 'Energy drink for a boost.',
    'Soda Pop': 'Carbonated soft drink.',
    'Can Soda': 'Canned soft drink.',
    'Bottled Water': 'Pure bottled water.',
    'Almond Milk': 'Fresh almond milk.',
    'Milk': 'Fresh cold whole milk.',
    'Fresh': 'Freshly squeezed juice.',
    'Turkish Gazoz': 'Traditional Turkish carbonated drink.',
    'Pogacha': 'Soft Turkish pogacha bread.',
    'Gift': 'Gift set — perfect for presents.',
}


def _gen_desc(row):
    cat = str(row['category'])
    sub = str(row.get('subcategory', ''))
    if sub == 'nan':
        sub = ''
    parts = []
    if sub and sub in _DESC_SUB:
        parts.append(_DESC_SUB[sub])
    if cat in _DESC_CAT:
        parts.append(_DESC_CAT[cat])
    return ' '.join(parts) if parts else cat


_raw['item_name'] = _raw['item_name'].apply(_clean_name)
_raw['Description'] = _raw.apply(_gen_desc, axis=1)
_raw = _raw.rename(columns={'item_name': 'Item', 'category': 'Category', 'price_min': 'Price'})
_raw['Price'] = pd.to_numeric(_raw['Price'], errors='coerce')
_raw = _raw.drop_duplicates(subset='Item', keep='first')
df = _raw[['Category', 'Item', 'Description', 'Price']].dropna(subset=['Category', 'Item', 'Price']).reset_index(drop=True)

engine = HybridRecommender(df)


# ---------------------------------------------------------------------------
#  Core recommendation
# ---------------------------------------------------------------------------
@app.route('/api/recommend', methods=['POST'])
def recommend():
    data = request.get_json()
    result = engine.recommend(
        user_id=data.get('user_id'),
        food_query=data.get('food', ''),
        drink_query=data.get('drink', ''),
        strategy=data.get('strategy', 'hybrid'),
        n=int(data.get('n', 5)),
    )
    return jsonify(result)


# ---------------------------------------------------------------------------
#  Full menu
# ---------------------------------------------------------------------------
@app.route('/api/menu', methods=['GET'])
def get_menu():
    menu = {'Foods': [], 'Drinks': []}
    for _, row in df.iterrows():
        item = {
            'name': row['Item'], 'category': row['Category'],
            'description': row['Description'], 'price': float(row['Price']),
        }
        if row['Category'] in DRINK_CATEGORIES:
            menu['Drinks'].append(item)
        else:
            menu['Foods'].append(item)
    return jsonify(menu)


# ---------------------------------------------------------------------------
#  Interaction tracking  (like / view / order)
# ---------------------------------------------------------------------------
@app.route('/api/track', methods=['POST'])
def track_interaction():
    data = request.get_json()
    ok = engine.track(
        user_id=data.get('user_id', 'anonymous'),
        item_name=data.get('item_name', ''),
        itype=data.get('type', 'click'),
        rating=data.get('rating'),
    )
    if ok:
        return jsonify({'status': 'ok'})
    return jsonify({'status': 'error', 'message': 'Item not found'}), 404


# ---------------------------------------------------------------------------
#  Chef's Picks  (3 per category)
# ---------------------------------------------------------------------------
@app.route('/api/chefs-picks', methods=['GET'])
def chefs_picks():
    per = int(request.args.get('per', 3))
    return jsonify(engine.get_chefs_picks(per))


# ---------------------------------------------------------------------------
#  Popular items
# ---------------------------------------------------------------------------
@app.route('/api/popular', methods=['GET'])
def popular():
    n = int(request.args.get('n', 8))
    return jsonify(engine.get_popular(n))


# ---------------------------------------------------------------------------
#  Similar items
# ---------------------------------------------------------------------------
@app.route('/api/similar', methods=['GET'])
def similar():
    item = request.args.get('item', '')
    n = int(request.args.get('n', 6))
    return jsonify(engine.get_similar(item, n))


# ---------------------------------------------------------------------------
#  Personalized (CF + BPR for a specific user)
# ---------------------------------------------------------------------------
@app.route('/api/personalized', methods=['GET'])
def personalized():
    user_id = request.args.get('user_id', '')
    n = int(request.args.get('n', 8))
    return jsonify(engine.get_personalized(user_id, n))


# ---------------------------------------------------------------------------
#  Retrain models
# ---------------------------------------------------------------------------
@app.route('/api/retrain', methods=['POST'])
def retrain():
    engine.retrain()
    return jsonify({'status': 'ok', 'message': 'Models retrained'})


# ---------------------------------------------------------------------------
#  Engine stats
# ---------------------------------------------------------------------------
@app.route('/api/stats', methods=['GET'])
def stats():
    return jsonify(engine.get_stats())



if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5008)
