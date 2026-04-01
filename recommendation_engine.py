# -*- coding: utf-8 -*-
"""
Multi-Algorithm Restaurant Recommendation Engine
=================================================
Implements 6 recommendation strategies:
  1. Content-Based   (TF-IDF + Cosine Similarity)
  2. Fuzzy Match      (String similarity + WordNet synonyms)
  3. Collaborative Filtering (SVD Matrix Factorization)
  4. BPR              (Bayesian Personalized Ranking – pairwise SGD)
  5. Popularity       (Time-decayed, interaction-weighted scoring)
  6. Hybrid Ensemble  (Weighted combination of all the above)
"""

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.decomposition import TruncatedSVD
from scipy.sparse import csr_matrix
from fuzzywuzzy import process as fuzz_process
from nltk.corpus import wordnet as wn
from collections import defaultdict
import json, os, time, threading, random

DRINK_CATEGORIES = ['Hot Drinks', 'Cold Drinks']

KEYWORD_EXPANSION = {
    # ── MEAT & PROTEIN ──
    'meat': 'beef lamb chicken steak kebab kebap doner adana iskender chop meatball shish kavurma beyti kofte veal',
    'beef': 'steak doner iskender adana kebab meatball tenderloin kavurma beyti frites lavash kofte veal',
    'lamb': 'chop adana kebab shish grilled beyti lamb chops',
    'chicken': 'shish cajun schnitzel adana crispy grilled breast wings curry parma begendi poultry',
    'poultry': 'chicken shish cajun schnitzel adana grilled wings curry',
    'veal': 'veal shish kebab beef lamb',
    'protein': 'chicken beef lamb steak kebab shish meatball salmon shrimp',
    # ── KEBAB & GRILL ──
    'kebab': 'adana beyti iskender shish doner lamb beef chicken kebap veal wings',
    'kebap': 'adana beyti iskender shish doner lamb beef chicken kebab veal wings',
    'adana': 'kebab kebap spicy minced chicken beef wrap',
    'beyti': 'kebab wrap lavash yoghurt garlic adana',
    'iskender': 'kebab doner beef yoghurt tomato butter sauce kofte alexander',
    'alexander': 'iskender kebab doner',
    'shish': 'kebab chicken veal skewer grilled',
    'steak': 'beef tenderloin frites grilled',
    'grill': 'grilled kebab shish lamb chop steak chicken salmon mixed',
    'grilled': 'kebab shish lamb chop steak chicken salmon mixed',
    'bbq': 'grill grilled kebab shish steak chop',
    'barbecue': 'grill grilled kebab shish steak chop',
    'skewer': 'shish kebab chicken halloumi sujuk',
    # ── DONER & SHAWARMA ──
    'doner': 'shawarma slice beef chicken wrap kebab turkish döner gyro',
    'döner': 'doner shawarma slice beef chicken wrap kebab turkish',
    'shawarma': 'doner slice beef chicken wrap turkish',
    'gyro': 'doner shawarma wrap beef chicken',
    # ── MEATBALL / KOFTE ──
    'meatball': 'kofte kofta köfte butcher mozzarella kid spaghetti turkish',
    'kofte': 'meatball kofta köfte butcher begendi iskender lavash',
    'kofta': 'kofte meatball köfte butcher begendi iskender',
    'köfte': 'kofte kofta meatball butcher begendi iskender',
    # ── SEAFOOD ──
    'fish': 'salmon grilled seafood sea bass levrek',
    'seafood': 'salmon fish grilled sea bass levrek shrimp mediterranean',
    'salmon': 'grilled fish seafood smoked caesar salad',
    'shrimp': 'prawn caesar salad avocado seafood',
    'prawn': 'shrimp caesar salad avocado seafood',
    'sea bass': 'levrek fish seafood mediterranean',
    'levrek': 'sea bass fish seafood mediterranean',
    'branzino': 'sea bass levrek fish seafood mediterranean',
    # ── SALADS ──
    'salad': 'caesar ahirdag beef greek halloumi iceberg shrimp avocado lettuce green grain salmon',
    'caesar': 'salad chicken salmon shrimp grilled crispy lettuce crouton parmesan',
    'greek': 'salad feta olive tomato cucumber',
    'healthy': 'salad grain greek caesar vegan falafel yoghurt vegetable light',
    'light': 'salad greek caesar yoghurt grain iceberg falafel vegan',
    # ── APPETIZERS & MEZE ──
    'appetizer': 'meze hummus tzatziki cacik babaghanoush muhammara borek kofte gozleme acili ezme platter falafel',
    'starter': 'appetizer meze hummus tzatziki borek platter falafel',
    'meze': 'hummus tzatziki cacik babaghanoush muhammara platter appetizer acili ezme',
    'dip': 'hummus tzatziki cacik babaghanoush muhammara acuka',
    'hummus': 'houmous humus chickpea dip tahini steak bites',
    'houmous': 'hummus humus chickpea dip tahini',
    'humus': 'hummus houmous chickpea dip tahini',
    'tzatziki': 'cacik yoghurt cucumber garlic dip',
    'cacik': 'tzatziki yoghurt cucumber garlic dip',
    'baba ganoush': 'babaghanoush eggplant aubergine dip smoky',
    'baba ghanoush': 'babaghanoush eggplant aubergine dip smoky',
    'babaganush': 'babaghanoush eggplant aubergine dip smoky',
    'eggplant': 'babaghanoush mutebbal begendi aubergine smoky',
    'aubergine': 'eggplant babaghanoush mutebbal begendi',
    'muhammara': 'walnut pepper dip spicy red',
    'acili': 'ezme spicy hot pepper paste',
    'ezme': 'acili spicy hot pepper paste',
    'adjika': 'acuka spicy pepper paste',
    'acuka': 'adjika spicy pepper paste',
    # ── FALAFEL ──
    'falafel': 'felafel chickpea vegan vegetarian lavash platter appetizer',
    'felafel': 'falafel chickpea vegan vegetarian lavash platter',
    # ── WRAPS & SANDWICHES ──
    'wrap': 'doner lavash kebap sandwich roll chicken beef kofte caesar falafel vegetable',
    'lavash': 'wrap flatbread chicken beef kofte falafel vegetable cheese gozleme',
    'sandwich': 'wrap doner lavash toast pesto chicken beef',
    'toast': 'doner pesto sandwich bread',
    'roll': 'wrap lavash chicken caesar borek',
    # ── BURGERS ──
    'burger': 'mado crispy chicken grilled beef patty fries vegan kid hamburger',
    'hamburger': 'burger mado chicken grilled beef patty fries',
    'cheeseburger': 'burger mado cheese beef patty',
    # ── PASTA & NOODLES ──
    'pasta': 'casarecce penne alfredo fettuccine spaghetti meatballs manti arrabiata paprika',
    'noodle': 'pasta spaghetti fettuccine penne casarecce',
    'noodles': 'pasta spaghetti fettuccine penne casarecce',
    'spaghetti': 'pasta meatballs kid bolognese',
    'penne': 'pasta arrabiata paprika creamy chicken',
    'fettuccine': 'pasta alfredo chicken mushroom',
    'fettucine': 'fettuccine pasta alfredo chicken mushroom',
    'casarecce': 'pasta alfredo chicken',
    'alfredo': 'pasta casarecce fettuccine chicken mushroom creamy',
    'arrabiata': 'penne pasta spicy tomato',
    'arrabbiata': 'arrabiata penne pasta spicy tomato',
    'bolognese': 'spaghetti pasta meat sauce',
    'bolognaise': 'bolognese spaghetti pasta meat sauce',
    'carbonara': 'pasta alfredo cream',
    'manti': 'mantı ravioli dumpling turkish yoghurt butter mint',
    'mantı': 'manti ravioli dumpling turkish yoghurt',
    'ravioli': 'manti mantı dumpling turkish',
    'dumpling': 'manti mantı ravioli turkish',
    # ── PIZZA ──
    'pizza': 'cheese chicken mado veggie special vegetarian',
    'margherita': 'pizza cheese tomato',
    'pepperoni': 'pizza meat chicken mado special',
    'veggie': 'pizza vegetarian mado vegetable cheese',
    # ── BREAKFAST & EGGS ──
    'breakfast': 'simit borek egg omelette menemen sujuk halloumi fried cozy grand traditional benedict',
    'brunch': 'breakfast egg omelette menemen sujuk simit borek halloumi benedict',
    'egg': 'omelette fried menemen benedict boiled sujuk eggs',
    'eggs': 'omelette fried menemen benedict boiled sujuk egg',
    'omelette': 'omelet egg cheese mushroom sujuk plain breakfast',
    'omelet': 'omelette egg cheese mushroom sujuk plain breakfast',
    'benedict': 'eggs avocado salmon smoked turkey breakfast',
    'menemen': 'shakshuka egg tomato pepper cheese halloumi turkish breakfast',
    'shakshuka': 'menemen egg tomato pepper turkish breakfast',
    'sujuk': 'sucuk sausage turkish spicy fried egg omelette halloumi skewer breakfast',
    'sucuk': 'sujuk sausage turkish spicy fried egg',
    'sausage': 'sujuk sucuk turkish spicy fried',
    'halloumi': 'hellim cheese grilled skewer sujuk salad breakfast',
    'hellim': 'halloumi cheese grilled skewer',
    'avocado': 'benedict eggs shrimp salad',
    # ── BAKERY & PASTRY ──
    'borek': 'börek burek sigara cheese feta potato roll su village pastry phyllo',
    'börek': 'borek burek sigara cheese feta potato roll su village',
    'burek': 'borek börek sigara cheese feta potato roll su village',
    'sigara': 'borek roll cheese fried crispy',
    'pastry': 'borek baklava kadayif simit phyllo pogacha roll eclair',
    'simit': 'bagel sesame bread turkish sandwich cheese',
    'bagel': 'simit sesame bread turkish',
    'bread': 'simit pita lavash basket pogacha flatbread',
    'flatbread': 'lavash gozleme pita bread',
    'pita': 'bread flatbread lavash',
    'pogacha': 'pogaca poğaça cheese olive bread bun',
    'pogaca': 'pogacha poğaça cheese olive bread bun',
    'gozleme': 'gözleme flatbread potato cheese spinach turkish',
    'gözleme': 'gozleme flatbread potato cheese spinach turkish',
    'waffle': 'ice cream dessert sweet mado',
    # ── DESSERTS ──
    'dessert': 'baklava kunafah souffle cheesecake tres leches kadayif chocolate eclair tiramisu pudding wet cake pistachio walnut',
    'sweet': 'baklava kunafah souffle cheesecake tres leches kadayif dessert chocolate cake pudding waffle ice cream',
    'cake': 'chocolate devil pistachio ferrero rocher wet cheesecake tres leches brittle',
    'cheesecake': 'san sebastian cheese cake basque burnt',
    'san sebastian': 'cheesecake basque burnt cream',
    'basque': 'cheesecake san sebastian burnt',
    'tres leches': 'milk cake three milks pistachio pan homemade sponge',
    'milk cake': 'tres leches three milks',
    'tiramisu': 'coffee dessert jar cream mascarpone italian',
    'pudding': 'rice pudding sütlaç cream dessert ice cream',
    'sütlaç': 'rice pudding dessert',
    'eclair': 'éclair pastry cream chocolate dessert',
    'éclair': 'eclair pastry cream chocolate dessert',
    'souffle': 'soufflé chocolate molten warm dessert',
    'soufflé': 'souffle chocolate molten warm dessert',
    'magnolia': 'pudding cream strawberry dessert',
    # ── BAKLAVA ──
    'baklava': 'pistachio walnut phyllo kadayif shobiyet bohca carrot slice sobiyet sarma dolama tel cold mixed',
    'kadayif': 'kadaif kataifi shredded pastry hot burma cheese pistachio dessert ice cream',
    'kadaif': 'kadayif kataifi shredded pastry hot burma',
    'kataifi': 'kadayif kadaif shredded pastry',
    'kunafah': 'kunefe künefe kanafeh cheese pastry hot dessert twin',
    'kunefe': 'kunafah künefe kanafeh cheese pastry hot',
    'künefe': 'kunafah kunefe kanafeh cheese pastry hot',
    'kanafeh': 'kunafah kunefe künefe cheese pastry hot',
    'knafeh': 'kunafah kunefe kanafeh cheese pastry hot',
    'shobiyet': 'şöbiyet sobiyet baklava puff pastry cream pistachio',
    'sobiyet': 'shobiyet şöbiyet baklava puff pastry cream pistachio',
    'pistachio': 'baklava kadayif sobiyet sarma dolama tel ice cream dibek daydream cake brittle',
    'walnut': 'baklava special homemade',
    # ── ICE CREAM ──
    'ice cream': 'kesme bonbon anatolian rainbow passion frozen yoghurt waffle layer bowl',
    'gelato': 'ice cream frozen dessert',
    'frozen yogurt': 'ice cream frozen yoghurt',
    'frozen yoghurt': 'ice cream frozen yogurt',
    'sundae': 'ice cream bowl topping',
    'sorbet': 'ice cream frozen fruit',
    # ── KIDS ──
    'kids': 'kid meatball schnitzel spaghetti burger friendly children',
    'kid': 'kids meatball schnitzel spaghetti burger friendly children',
    'children': 'kids kid meatball schnitzel spaghetti burger friendly',
    # ── SOUP & SIDES ──
    'soup': 'warm hot traditional day',
    'fries': 'french fries chips potato crispy side',
    'chips': 'french fries potato crispy side fries',
    'french fries': 'fries chips potato crispy side',
    'rice': 'pilaf pilav side grain',
    'pilaf': 'rice pilav side grain bulgur',
    'pilav': 'rice pilaf side grain bulgur',
    'bulgur': 'pilaf grain rice wheat',
    'yoghurt': 'yogurt side plain turkish',
    'yogurt': 'yoghurt side plain turkish ayran',
    'side': 'fries rice yoghurt bread pita',
    # ── CHEESE ──
    'cheese': 'mozzarella halloumi borek simit parma cheesy feta cream cheddar',
    'feta': 'cheese white borek pogacha',
    'mozzarella': 'cheese pizza meatball',
    'parmesan': 'cheese caesar salad pasta',
    # ── SPICE & FLAVOUR ──
    'spicy': 'adana acili ezme cajun hot pepper',
    'mild': 'chicken grilled plain cheese',
    'garlic': 'tzatziki cacik beyti yoghurt',
    'curry': 'chicken cajun spice',
    'cajun': 'chicken curry spicy',
    'mushroom': 'omelette fettuccine alfredo cheese',
    # ── OCCASIONS & MOODS ──
    'heavy': 'kebab steak lamb platter iskender doner mixed grill kavurma',
    'filling': 'kebab steak lamb platter iskender mixed grill burger pasta',
    'sharing': 'platter meze borek mix grill family mixed grand breakfast',
    'family': 'platter mixed grill grand breakfast sharing four two',
    'date': 'steak salmon dessert cheesecake baklava',
    'quick': 'wrap sandwich toast burger doner lavash',
    'snack': 'fries borek simit appetizer meze falafel toast pogacha',
    'comfort': 'manti kunafah soup baklava tres leches pasta',
    'traditional': 'kebab manti kunafah baklava simit borek ayran turkish coffee menemen kavurma',
    'vegetarian': 'vegan salad hummus falafel vegetable cheese pizza penne lavash gozleme',
    'vegan': 'vegetarian lavash falafel salad hummus fries penne burger',
    'turkish': 'kebab doner manti baklava kunafah ayran simit borek iskender sujuk menemen gozleme kavurma turkish coffee tea gazoz',
    # ── DRINKS: SODA & SOFT ──
    'coke': 'soda pop can soda soda pop cola soft drink gazoz',
    'cola': 'soda pop can soda soda pop coke soft drink gazoz',
    'pepsi': 'soda pop can soda soda pop coke cola soft drink',
    'sprite': 'soda pop can soda soda pop lemonade soft drink gazoz',
    'fanta': 'soda pop can soda soda pop orange juice soft drink',
    'pop': 'soda can soda soda pop coke cola soft drink gazoz',
    'soda': 'can soda soda pop coke cola pop soft drink gazoz',
    'soft drink': 'soda pop can soda coke cola gazoz',
    'fizzy': 'soda pop can soda gazoz sparkling carbonated',
    'carbonated': 'soda pop gazoz sparkling fizzy',
    'gazoz': 'turkish soda pop fizzy carbonated',
    '7up': 'sprite soda pop can soda lemonade gazoz',
    'mountain dew': 'soda pop can soda soft drink',
    'dr pepper': 'soda pop can soda soft drink',
    'ginger ale': 'soda pop can soda soft drink gazoz',
    'tonic': 'soda sparkling water fizzy',
    'club soda': 'sparkling water perrier soda',
    # ── DRINKS: WATER ──
    'water': 'bottled water perrier pellegrino mineral sparkling alkaline',
    'sparkling': 'perrier pellegrino mineral water gazoz soda',
    'mineral': 'water perrier pellegrino sparkling',
    'perrier': 'sparkling water mineral pellegrino',
    'pellegrino': 'san pellegrino sparkling water mineral perrier',
    # ── DRINKS: JUICE & LEMONADE ──
    'juice': 'orange juice lemonade fresh squeezed',
    'orange': 'orange juice fresh squeezed citrus',
    'lemonade': 'homemade fresh squeezed strawberry citrus refreshing lemon jug',
    'lemon': 'lemonade smoothie citrus fresh',
    # ── DRINKS: COFFEE ──
    'coffee': 'espresso latte cortado flat white americano iced cappuccino macchiato mocha dibek turkish decaf',
    'latte': 'coffee espresso flat white iced macchiato blue dream matcha',
    'espresso': 'coffee double shot cortado americano macchiato',
    'cappuccino': 'coffee latte espresso cortado',
    'macchiato': 'coffee espresso latte',
    'mocha': 'coffee chocolate latte',
    'americano': 'coffee espresso iced',
    'cortado': 'coffee espresso latte',
    'flat white': 'coffee latte espresso',
    'dibek': 'turkish coffee pistachio gum mastic bitter chocolate special',
    'turkish coffee': 'coffee dibek double decaf cezve',
    'decaf': 'coffee turkish decaffeinated',
    'affogato': 'coffee ice cream espresso dessert',
    'frappe': 'coffee iced cold blended',
    'frappuccino': 'frappe coffee iced cold blended',
    # ── DRINKS: TEA ──
    'tea': 'herbal green iced apple chamomile detox ginger linden mint winter fruit saffron turkish brewed',
    'chai': 'tea turkish brewed',
    'herbal': 'tea chamomile linden detox ginger mint saffron',
    'green tea': 'tea herbal antioxidant healthy',
    'chamomile': 'tea herbal soothing calming',
    'ginger': 'tea honey herbal warm',
    'mint': 'tea lemon herbal fresh',
    'linden': 'ihlamur tea herbal turkish',
    'ihlamur': 'linden tea herbal turkish',
    'apple tea': 'tea cinnamon apple turkish',
    'saffron': 'tea herbal golden premium',
    'detox': 'tea herbal healthy',
    'earl grey': 'tea herbal brewed black',
    'black tea': 'tea turkish brewed glass mug',
    'rooibos': 'tea herbal',
    # ── DRINKS: MILKSHAKE & SMOOTHIE ──
    'milkshake': 'chocolate strawberry vanilla caramel oreo matcha shake thick creamy',
    'shake': 'milkshake chocolate strawberry vanilla caramel oreo matcha',
    'smoothie': 'lemon strawberry fruit blended fresh',
    'matcha': 'milkshake iced latte green tea',
    'chocolate': 'milkshake hot chocolate cake devil mocha cocoa',
    'strawberry': 'milkshake lemonade smoothie fruit',
    'vanilla': 'milkshake cream ice cream',
    'caramel': 'milkshake sweet',
    'oreo': 'milkshake cookie cream',
    # ── DRINKS: MISC ──
    'hot chocolate': 'cocoa chocolate warm drink',
    'cocoa': 'hot chocolate warm drink',
    'salep': 'sahlep sahlab hot drink warm traditional turkish',
    'sahlep': 'salep hot drink warm traditional turkish',
    'ayran': 'yogurt drink yoghurt cold salty refreshing turkish',
    'red bull': 'energy drink boost caffeine',
    'energy': 'red bull boost caffeine drink',
    'energy drink': 'red bull boost caffeine',
    'milk': 'cup of milk almond milk glass fresh whole',
    'almond milk': 'milk dairy free almond glass',
    'cold': 'iced lemonade ayran milkshake smoothie soda gazoz',
    'hot': 'latte espresso cortado chocolate herbal tea salep',
    'drink': 'ayran lemonade latte espresso iced tea coffee milkshake smoothie soda pop coke',
    'beverage': 'drink ayran lemonade latte espresso iced tea coffee milkshake smoothie soda',
    # ── COOKING & PREP ──
    'fried': 'french fries eggs sujuk crispy chicken schnitzel deep',
    'crispy': 'fried chicken schnitzel fries borek sigara',
    'baked': 'pizza borek pastry bread simit pogacha',
    'smoked': 'salmon turkey benedict',
    'cream': 'alfredo sauce cheese ice cream milkshake tres leches',
    'butter': 'sauce iskender beyti baklava',
    'tomato': 'sauce arrabiata menemen salad',
    # ── SINGLE-WORD ALIASES for multi-word items ──
    'baba': 'babaghanoush eggplant aubergine dip smoky',
    'ganoush': 'babaghanoush eggplant aubergine dip smoky',
    'ghanoush': 'babaghanoush eggplant aubergine dip smoky',
    'ghannoush': 'babaghanoush eggplant aubergine dip smoky',
    'ganush': 'babaghanoush eggplant aubergine dip smoky',
    'sebastian': 'cheesecake san sebastian basque burnt',
    'leches': 'tres leches milk cake pistachio pan homemade',
    'tres': 'tres leches milk cake pistachio pan homemade',
    'bull': 'red bull energy drink boost caffeine',
    'bass': 'sea bass levrek fish seafood mediterranean',
    'ice': 'ice cream kesme bonbon frozen yoghurt waffle layer bowl',
    'flat': 'flat white coffee latte espresso',
    'white': 'flat white coffee latte espresso',
    'earl': 'earl grey tea herbal brewed black',
    'grey': 'earl grey tea herbal brewed black',
    'gray': 'earl grey tea herbal brewed black',
    'apple': 'apple tea cinnamon turkish',
    'honey': 'ginger tea herbal warm',
    'winter': 'winter tea herbal warm',
    'fruit': 'fruit cocktail tea strawberry smoothie juice',
    'dream': 'blue dream latte',
    'blue': 'blue dream latte',
    'double': 'double shot espresso turkish coffee',
    'shot': 'double shot espresso',
    'decaffeinated': 'decaf coffee turkish',
    'sugar free': 'decaf herbal tea green tea',
    'ferrero': 'ferrero rocher cake chocolate dessert',
    'rocher': 'ferrero rocher cake chocolate dessert',
    'devil': 'devil chocolate cake dessert',
    'wet': 'wet cake dessert',
    'brittle': 'brittle pistachio cake dessert',
    'eclair': 'éclair pastry cream chocolate dessert',
    'bonbon': 'ice cream bonbon frozen',
    'kesme': 'ice cream kesme traditional turkish',
    'anatolian': 'ice cream bowl anatolian signature',
    'rainbow': 'ice cream bowl dark rainbow',
    'passion': 'ice cream bowl red passion',
    'trio': 'ice cream trio kesme',
    'schnitzel': 'chicken breaded crispy cutlet',
    'cutlet': 'schnitzel chicken breaded crispy',
    'breaded': 'schnitzel chicken crispy cutlet',
    'kavurma': 'beef sac traditional turkish',
    'begendi': 'chicken kofte eggplant puree',
    'paprika': 'penne chicken creamy pasta',
    'daydream': 'pistachio ice cream dessert hot',
    'burma': 'kadaif kadayif hot cheese pistachio',
}

VAGUE_QUERY_WORDS = {
    'something', 'anything', 'whatever', 'any', 'surprise', 'decide',
    'recommend', 'suggestion', 'nice', 'good', 'best', 'popular',
    'dunno', 'idk', 'no idea', 'not sure', 'unsure', 'maybe',
    'compatible', 'goes with', 'pair', 'match', 'fits', 'suitable',
    'complements', 'alongside', 'with it', 'with that', 'with food',
    'with my food', 'with meal', 'with my meal', 'don\'t know',
    'dealer\'s choice', 'up to you', 'you choose', 'you decide',
    'you pick', 'chef', 'waiter', 'close', 'like',
}


def _is_vague_query(query):
    if not query or not query.strip():
        return True
    q = query.lower().strip()
    words = set(q.split())

    meaningful = words & set(KEYWORD_EXPANSION.keys())
    if meaningful:
        return False

    if words & VAGUE_QUERY_WORDS:
        return True
    vague_phrases = [
        'something like', 'something nice', 'something good', 'something that',
        'anything that', 'whatever goes', 'goes well', 'pairs with',
        'you decide', 'you choose', 'you pick', 'up to you',
        'don\'t know', 'do not know', 'not sure', 'no idea',
        'i can not decide', 'i cannot decide', "can't decide",
        'dealer', 'surprise me', 'recommend me', 'suggest',
        'what goes', 'what pairs', 'compatible with',
    ]
    for phrase in vague_phrases:
        if phrase in q:
            return True
    return False


def get_synonyms(word):
    synonyms = set()
    for syn in wn.synsets(word):
        for lemma in syn.lemmas():
            synonyms.add(lemma.name().replace('_', ' '))
    return list(synonyms)


# ---------------------------------------------------------------------------
# 1) Content-Based Recommender  (TF-IDF + Cosine Similarity)
# ---------------------------------------------------------------------------
class ContentBasedRecommender:
    """
    Builds a TF-IDF matrix over enriched item text (name repeated for weight,
    plus category and description).  Query recommendations are produced by
    transforming the user query (expanded with WordNet synonyms) into the same
    TF-IDF space and ranking by cosine similarity.  A pre-computed item–item
    similarity matrix powers the "similar items" feature.
    """

    def __init__(self, df):
        self.df = df
        texts = df.apply(
            lambda r: (
                f"{r['Item']} " * 4
                + f"{r['Category']} " * 2
                + f"{r['Description']}"
            ),
            axis=1,
        )
        self.vectorizer = TfidfVectorizer(
            stop_words='english', ngram_range=(1, 2), max_features=5000,
        )
        self.tfidf_matrix = self.vectorizer.fit_transform(texts)
        self.item_sim = cosine_similarity(self.tfidf_matrix)

    def recommend_by_query(self, query, n=30):
        q_lower = query.lower()
        words = q_lower.split()
        expanded = list(words)
        for phrase, exp in KEYWORD_EXPANSION.items():
            if ' ' in phrase and phrase in q_lower:
                expanded.extend(exp.split())
        for w in words:
            expanded.extend(get_synonyms(w))
            if w in KEYWORD_EXPANSION:
                expanded.extend(KEYWORD_EXPANSION[w].split())
        vec = self.vectorizer.transform([' '.join(expanded)])
        scores = cosine_similarity(vec, self.tfidf_matrix)[0]
        top = np.argsort(scores)[::-1][:n]
        return [{'index': int(i), 'score': float(scores[i])} for i in top if scores[i] > 0]

    def get_similar_items(self, idx, n=8):
        scores = self.item_sim[idx]
        top = np.argsort(scores)[::-1][1:n + 1]
        return [{'index': int(i), 'score': float(scores[i])} for i in top]


# ---------------------------------------------------------------------------
# 2) Fuzzy Match Recommender  (fuzzywuzzy + WordNet)
# ---------------------------------------------------------------------------
class FuzzyRecommender:
    """Enhanced fuzzy string matching: each query term and its WordNet synonyms
    are matched against all item names via Levenshtein-ratio scoring."""

    def __init__(self, df):
        self.df = df
        self.names = df['Item'].tolist()

    def recommend_by_query(self, query, n=30):
        q_lower = query.lower()
        terms = [query] + get_synonyms(query)
        for phrase, exp in KEYWORD_EXPANSION.items():
            if ' ' in phrase and phrase in q_lower:
                terms.extend(exp.split())
        for w in q_lower.split():
            if w in KEYWORD_EXPANSION:
                terms.extend(KEYWORD_EXPANSION[w].split())
        best = {}
        for t in terms:
            for name, score in fuzz_process.extractBests(t, self.names, limit=n):
                if name not in best or score > best[name]:
                    best[name] = score
        name_idx = {name: i for i, name in enumerate(self.names)}
        results = sorted(best.items(), key=lambda x: -x[1])
        return [{'index': name_idx[n], 'score': s / 100.0} for n, s in results if n in name_idx][:n]


# ---------------------------------------------------------------------------
# 3) Collaborative Filtering  (SVD Matrix Factorization – ALS-style)
# ---------------------------------------------------------------------------
class CollaborativeFilteringRecommender:
    """
    Builds a user × item interaction matrix (implicit ratings) and factorises
    it with Truncated SVD.  Predicted preference = user_factor · item_factorᵀ.
    Falls back gracefully when < 2 users exist.
    """

    def __init__(self, n_items, n_factors=15):
        self.n_items = n_items
        self.n_factors = n_factors
        self.interactions = defaultdict(dict)
        self.user_factors = None
        self.item_factors = None
        self.user_map = {}
        self.is_trained = False

    def add_interaction(self, user_id, item_idx, rating=1.0):
        self.interactions[user_id][int(item_idx)] = float(rating)
        self.is_trained = False

    def train(self):
        if len(self.interactions) < 2:
            return False
        users = sorted(self.interactions.keys())
        self.user_map = {u: i for i, u in enumerate(users)}
        n_users = len(users)

        mat = np.zeros((n_users, self.n_items))
        for uid, items in self.interactions.items():
            for idx, r in items.items():
                mat[self.user_map[uid]][idx] = r

        nc = min(self.n_factors, min(n_users, self.n_items) - 1)
        if nc < 1:
            return False
        svd = TruncatedSVD(n_components=nc, random_state=42)
        self.user_factors = svd.fit_transform(csr_matrix(mat))
        self.item_factors = svd.components_.T
        self.is_trained = True
        return True

    def predict(self, user_id):
        if not self.is_trained or user_id not in self.user_map:
            return np.zeros(self.n_items)
        return self.user_factors[self.user_map[user_id]] @ self.item_factors.T

    def recommend(self, user_id, n=30, exclude_known=True):
        scores = self.predict(user_id)
        if scores.sum() == 0:
            return []
        known = set(self.interactions.get(user_id, {}).keys()) if exclude_known else set()
        top = np.argsort(scores)[::-1]
        out = []
        for i in top:
            if int(i) not in known and len(out) < n:
                out.append({'index': int(i), 'score': float(scores[i])})
        return out


# ---------------------------------------------------------------------------
# 4) BPR  (Bayesian Personalized Ranking – SGD)
# ---------------------------------------------------------------------------
class BPRRecommender:
    """
    Learns user and item embeddings by optimising the pairwise objective
      P(user prefers item_i over item_j)
    via stochastic gradient descent.  Well-suited for implicit feedback
    and "top-N" ranking tasks.
    """

    def __init__(self, n_items, n_factors=15, lr=0.05, reg=0.01):
        self.n_items = n_items
        self.n_factors = n_factors
        self.lr = lr
        self.reg = reg
        self.positive = defaultdict(set)
        self.user_emb = {}
        self.item_emb = np.random.normal(0, 0.01, (n_items, n_factors))
        self.is_trained = False

    def add_positive(self, user_id, item_idx):
        self.positive[user_id].add(int(item_idx))
        if user_id not in self.user_emb:
            self.user_emb[user_id] = np.random.normal(0, 0.01, self.n_factors)
        self.is_trained = False

    def train(self, epochs=150):
        if len(self.positive) < 1:
            return False
        all_items = set(range(self.n_items))
        for _ in range(epochs):
            for uid, pos in self.positive.items():
                neg = all_items - pos
                if not pos or not neg:
                    continue
                for _ in range(len(pos)):
                    i = random.choice(list(pos))
                    j = random.choice(list(neg))
                    u = self.user_emb[uid]
                    d = self.item_emb[i] - self.item_emb[j]
                    x = np.dot(u, d)
                    sig = 1.0 / (1.0 + np.exp(np.clip(x, -500, 500)))
                    self.user_emb[uid] += self.lr * (sig * d - self.reg * u)
                    self.item_emb[i] += self.lr * (sig * u - self.reg * self.item_emb[i])
                    self.item_emb[j] += self.lr * (-sig * u - self.reg * self.item_emb[j])
        self.is_trained = True
        return True

    def recommend(self, user_id, n=30):
        if not self.is_trained or user_id not in self.user_emb:
            return []
        scores = self.item_emb @ self.user_emb[user_id]
        liked = self.positive.get(user_id, set())
        top = np.argsort(scores)[::-1]
        out = []
        for i in top:
            if int(i) not in liked and len(out) < n:
                out.append({'index': int(i), 'score': float(scores[i])})
        return out


# ---------------------------------------------------------------------------
# 5) Popularity Recommender  (time-decayed, interaction-weighted)
# ---------------------------------------------------------------------------
class PopularityRecommender:
    """
    Each interaction type has a weight (view < click < like < order).
    Older interactions are exponentially decayed so trending items surface.
    """
    WEIGHTS = {'view': 0.5, 'click': 1.0, 'like': 3.0, 'rate': 2.0, 'order': 5.0}
    DECAY = 0.95  # per day

    def __init__(self, n_items):
        self.n_items = n_items
        self.log = []

    def add(self, item_idx, itype='click', ts=None):
        self.log.append((int(item_idx), itype, ts or time.time()))

    def scores(self):
        now = time.time()
        s = np.zeros(self.n_items)
        for idx, itype, ts in self.log:
            days = (now - ts) / 86400.0
            s[idx] += self.WEIGHTS.get(itype, 1.0) * (self.DECAY ** days)
        return s

    def recommend(self, n=20):
        s = self.scores()
        top = np.argsort(s)[::-1][:n]
        return [{'index': int(i), 'score': float(s[i])} for i in top if s[i] > 0]


# ---------------------------------------------------------------------------
# 6) Drink Pairing Model  (General-Purpose ML — works with any menu)
# ---------------------------------------------------------------------------
class DrinkPairingModel:
    """
    General-purpose ML model for food→drink compatibility prediction.
    No cuisine-specific knowledge — automatically adapts to any restaurant menu.

    Architecture:
      1. TF-IDF + SVD  → latent item embeddings (auto-extracted from descriptions)
      2. Co-occurrence CF → food×drink affinity learned from user behaviour
      3. Bilinear model  → compatibility matrix W trained via BPR (pairwise SGD)
         on the co-occurrence pairs, enabling generalisation to unseen combos

    Noise prevention:
      - Co-occurrence gating: when co-occurrence data exists, the bilinear
        model is masked to ONLY re-rank drinks that have real co-occurrence
        signal — drinks with zero signal are excluded.
      - Relevance threshold: drinks scoring < 25 % of the top drink are cut.

    Cold-start:
      The parent HybridRecommender auto-generates seed profiles by analysing
      the menu (sweet vs savory food, coffee vs tea vs refreshing drinks)
      so the model works from the first request.
    """

    COFFEE_KW = ['espresso', 'coffee', 'latte', 'americano', 'cortado',
                 'cappuccino', 'mocha', 'macchiato', 'roasted arabica',
                 'flat white', 'affogato', 'frappe', 'dibek']
    TEA_KW    = ['tea', 'herbal', 'chai', 'matcha', 'infusion', 'chamomile',
                 'linden', 'ihlamur', 'detox', 'ginger', 'mint', 'apple',
                 'winter', 'fruit cocktail', 'green tea', 'saffron']
    SWEET_KW  = ['sweet', 'sugar', 'cream', 'chocolate', 'honey', 'syrup',
                 'dessert', 'cake', 'pastry', 'caramel', 'vanilla', 'fruit',
                 'berry', 'mousse', 'pudding', 'custard', 'cookie', 'brownie',
                 'pie', 'tart', 'confection', 'candy', 'gelato', 'sorbet',
                 'meringue', 'truffle', 'icing', 'whipped', 'baklava',
                 'kunafah', 'kadayif', 'tres leches', 'waffle', 'souffle',
                 'tiramisu', 'eclair']

    def __init__(self, df, n_factors=15):
        self.df = df
        self.n_items = len(df)
        self.drink_mask = df['Category'].isin(DRINK_CATEGORIES).values
        self.food_mask = ~self.drink_mask
        self.food_indices = np.where(self.food_mask)[0]
        self.drink_indices = np.where(self.drink_mask)[0]
        self.n_factors = n_factors

        self._build_embeddings()
        self._classify_drinks()
        self._classify_food_categories()

        self.W = np.eye(self.n_factors) * 0.1
        self.cooc = np.zeros((self.n_items, self.n_items))
        self.is_trained = False

    def _build_embeddings(self):
        texts = self.df.apply(
            lambda r: f"{r['Item']} {r['Item']} {r['Category']} {r['Description']}",
            axis=1,
        )
        vectorizer = TfidfVectorizer(
            stop_words='english', ngram_range=(1, 2), max_features=500,
        )
        tfidf = vectorizer.fit_transform(texts)
        nc = min(self.n_factors, min(tfidf.shape) - 1)
        svd = TruncatedSVD(n_components=nc, random_state=42)
        self.embeddings = svd.fit_transform(tfidf)
        norms = np.linalg.norm(self.embeddings, axis=1, keepdims=True)
        norms[norms == 0] = 1
        self.embeddings /= norms

    SWEET_DRINK_KW = ['chocolate', 'cocoa', 'milkshake', 'smoothie', 'frappe',
                      'cream soda', 'float', 'shake', 'salep']
    PLAIN_DRINK_KW = ['cup of milk', 'glass of milk', 'plain milk', 'whole milk',
                      'plain water', 'still water', 'sparkling water',
                      'bottled water', 'almond milk', 'milk (glass)']
    MEAL_DRINK_KW = ['soda', 'pop', 'cola', 'coke', 'ayran', 'yogurt drink',
                     'lemonade', 'juice', 'gazoz', 'can soda', 'soda pop',
                     'iced tea']
    WATER_DRINK_KW = ['perrier', 'pellegrino', 'mineral water']
    ENERGY_DRINK_KW = ['red bull', 'energy drink']

    def _classify_drinks(self):
        self.coffee_drinks = []
        self.tea_drinks = []
        self.sweet_drinks = []
        self.meal_drinks = []
        self.water_drinks = []
        self.energy_drinks = []

        for idx in self.drink_indices:
            text = f"{self.df.iloc[idx]['Item']} {self.df.iloc[idx]['Description']}".lower()
            name_lower = self.df.iloc[idx]['Item'].lower()

            if 'milkshake' in name_lower or 'shake' in name_lower:
                self.sweet_drinks.append(int(idx))
            elif any(kw in text for kw in self.PLAIN_DRINK_KW):
                pass
            elif any(kw in text for kw in self.MEAL_DRINK_KW):
                self.meal_drinks.append(int(idx))
            elif any(kw in text for kw in self.COFFEE_KW):
                self.coffee_drinks.append(int(idx))
            elif any(kw in text for kw in self.TEA_KW):
                self.tea_drinks.append(int(idx))
            elif any(kw in text for kw in self.SWEET_DRINK_KW):
                self.sweet_drinks.append(int(idx))
            elif any(kw in text for kw in self.WATER_DRINK_KW):
                self.water_drinks.append(int(idx))
            elif any(kw in text for kw in self.ENERGY_DRINK_KW):
                self.energy_drinks.append(int(idx))
            else:
                self.meal_drinks.append(int(idx))

        self.refreshing_drinks = self.meal_drinks + self.water_drinks + self.energy_drinks

    def _drink_group(self, idx):
        """Group drinks by type for diversity filtering."""
        name = self.df.iloc[idx]['Item'].lower()
        if 'lemonade' in name or 'lemon' in name: return 'lemonade'
        if 'soda' in name or 'pop' in name or 'cola' in name: return 'soda'
        if 'ayran' in name: return 'ayran'
        if 'juice' in name: return 'juice'
        if 'milkshake' in name or 'shake' in name: return 'milkshake'
        if 'smoothie' in name: return 'smoothie'
        if 'water' in name or 'perrier' in name or 'pellegrino' in name: return 'water'
        if 'gazoz' in name: return 'gazoz'
        if 'red bull' in name: return 'energy'
        if 'tea' in name: return 'tea'
        if any(k in name for k in ['coffee', 'latte', 'espresso', 'americano',
                                    'cortado', 'cappuccino', 'mocha', 'macchiato',
                                    'dibek', 'flat white']): return 'coffee'
        if 'milk' in name: return 'milk'
        return name

    def _classify_food_categories(self):
        self.sweet_food_cats = []
        self.savory_food_cats = []

        for cat in self.df[self.food_mask]['Category'].unique():
            items = self.df[self.df['Category'] == cat]
            text = ' '.join(
                f"{r['Item']} {r['Description']}".lower()
                for _, r in items.iterrows()
            )
            sweet_density = sum(text.count(w) for w in self.SWEET_KW) / max(len(items), 1)
            if sweet_density > 2.0:
                self.sweet_food_cats.append(cat)
            else:
                self.savory_food_cats.append(cat)

    # -- training -------------------------------------------------------------

    def train(self, interactions_dict):
        self.cooc = np.zeros((self.n_items, self.n_items))
        pairs = []

        for uid, items in interactions_dict.items():
            foods = {idx: r for idx, r in items.items() if self.food_mask[idx]}
            drinks = {idx: r for idx, r in items.items() if self.drink_mask[idx]}
            if not foods or not drinks:
                continue
            for fi, fr in foods.items():
                for di, dr in drinks.items():
                    w = fr * dr
                    self.cooc[fi, di] += w
                    if fr >= 3 and dr >= 3:
                        pairs.append((fi, di, w / 25.0))

        row_sums = self.cooc.sum(axis=1, keepdims=True)
        row_sums[row_sums == 0] = 1.0
        self.cooc /= row_sums

        if pairs:
            self._train_bpr(pairs)
        self.is_trained = True

    def _train_bpr(self, pairs, epochs=200, lr=0.01, reg=0.001):
        W = np.eye(self.n_factors) * 0.1
        for _ in range(epochs):
            random.shuffle(pairs)
            for fi, di, weight in pairs:
                f_emb = self.embeddings[fi]
                d_pos = self.embeddings[di]
                neg_di = random.choice(self.drink_indices)
                d_neg = self.embeddings[int(neg_di)]
                diff = f_emb @ W @ d_pos - f_emb @ W @ d_neg
                sig = 1.0 / (1.0 + np.exp(np.clip(diff, -500, 500)))
                grad = sig * weight * (np.outer(f_emb, d_pos) - np.outer(f_emb, d_neg))
                W += lr * (grad - reg * W)
        self.W = W

    # -- inference ------------------------------------------------------------

    def recommend_foods(self, drink_indices, drink_scores, n=5):
        """Reverse pairing: given drinks, recommend compatible foods."""
        cooc_scores = np.zeros(self.n_items)
        for di, ds in zip(drink_indices, drink_scores):
            cooc_scores += self.cooc[:, di] * ds

        drink_emb = np.zeros(self.n_factors)
        for di, ds in zip(drink_indices, drink_scores):
            drink_emb += self.embeddings[di] * ds
        norm = np.linalg.norm(drink_emb)
        if norm > 0:
            drink_emb /= norm

        bpr_scores = np.zeros(self.n_items)
        compat = self.W.T @ drink_emb
        for fi in self.food_indices:
            bpr_scores[int(fi)] = self.embeddings[int(fi)] @ compat

        def _norm(a):
            mn, mx = a.min(), a.max()
            return (a - mn) / (mx - mn) if (mx - mn) > 1e-9 else np.zeros_like(a)

        has_cooc = cooc_scores.max() > 0 and self.is_trained

        if has_cooc:
            cooc_n = _norm(cooc_scores)
            cooc_gate = (cooc_scores > 0).astype(float)
            bpr_gated = _norm(bpr_scores) * cooc_gate
            combined = 0.85 * cooc_n + 0.15 * bpr_gated
        else:
            combined = _norm(bpr_scores)

        combined[~self.food_mask] = -1

        top_score = combined[self.food_indices].max() if len(self.food_indices) > 0 else 0
        threshold = top_score * 0.30

        top = np.argsort(combined)[::-1]
        results = []
        for i in top:
            if combined[i] >= threshold and combined[i] > 0 and len(results) < n:
                results.append((int(i), float(combined[i])))
        return results

    def recommend(self, food_indices, food_scores, n=5):
        cooc_scores = np.zeros(self.n_items)
        for fi, fs in zip(food_indices, food_scores):
            cooc_scores += self.cooc[fi] * fs

        food_emb = np.zeros(self.n_factors)
        for fi, fs in zip(food_indices, food_scores):
            food_emb += self.embeddings[fi] * fs
        norm = np.linalg.norm(food_emb)
        if norm > 0:
            food_emb /= norm

        bpr_scores = np.zeros(self.n_items)
        compat = food_emb @ self.W
        for di in self.drink_indices:
            bpr_scores[int(di)] = compat @ self.embeddings[int(di)]

        def _norm(a):
            mn, mx = a.min(), a.max()
            return (a - mn) / (mx - mn) if (mx - mn) > 1e-9 else np.zeros_like(a)

        has_cooc = cooc_scores.max() > 0 and self.is_trained

        if has_cooc:
            cooc_n = _norm(cooc_scores)
            cooc_gate = (cooc_scores > 0).astype(float)
            bpr_gated = _norm(bpr_scores) * cooc_gate
            combined = 0.85 * cooc_n + 0.15 * bpr_gated
        else:
            combined = _norm(bpr_scores)

        combined[~self.drink_mask] = -1

        top_drink_score = combined[self.drink_indices].max() if len(self.drink_indices) > 0 else 0
        threshold = top_drink_score * 0.40

        top = np.argsort(combined)[::-1]
        group_count = {}
        results = []
        for i in top:
            if combined[i] < threshold or combined[i] <= 0:
                continue
            grp = self._drink_group(int(i))
            if group_count.get(grp, 0) >= 1:
                continue
            results.append((int(i), float(combined[i])))
            group_count[grp] = group_count.get(grp, 0) + 1
            if len(results) >= n:
                break
        return results


# ---------------------------------------------------------------------------
# 7) Hybrid Ensemble Recommender
# ---------------------------------------------------------------------------
class HybridRecommender:
    """
    Orchestrates all sub-recommenders and exposes a single `.recommend()` API.
    In **hybrid** mode the final score for each item is a normalised weighted
    sum across all engines.  Gracefully degrades: when CF / BPR have
    insufficient training data their weight is redistributed to content-based.

    Also handles interaction persistence (JSON file) and seed-data generation
    so collaborative models work out of the box.
    """

    DEFAULT_WEIGHTS = {
        'content': 0.45, 'fuzzy': 0.20,
        'cf': 0.15, 'bpr': 0.10, 'popularity': 0.10,
    }

    STRATEGIES = {
        'hybrid':        'Weighted ensemble of all algorithms',
        'content':       'TF-IDF cosine similarity on item descriptions',
        'fuzzy':         'Fuzzy string matching + WordNet synonym expansion',
        'collaborative': 'SVD matrix factorization on user-item interactions',
        'bpr':           'Bayesian Personalized Ranking (pairwise SGD)',
        'popularity':    'Time-decayed, interaction-weighted trending',
    }

    def __init__(self, df, data_path='user_data/interactions.json'):
        self.df = df.reset_index(drop=True)
        self.n_items = len(df)
        self.data_path = data_path
        self._lock = threading.Lock()

        self.items = df.to_dict('records')
        self.name_to_idx = {r['Item']: i for i, r in enumerate(self.items)}

        self.content = ContentBasedRecommender(df)
        self.fuzzy = FuzzyRecommender(df)
        self.cf = CollaborativeFilteringRecommender(self.n_items)
        self.bpr = BPRRecommender(self.n_items)
        self.popularity = PopularityRecommender(self.n_items)
        self.drink_pairing = DrinkPairingModel(df)

        os.makedirs(os.path.dirname(self.data_path) or '.', exist_ok=True)
        if not os.path.exists(self.data_path):
            self._generate_seed_data()
        self._load()

    # -- persistence ----------------------------------------------------------

    def _load(self):
        if not os.path.exists(self.data_path):
            return
        with open(self.data_path) as f:
            data = json.load(f)
        for rec in data.get('interactions', []):
            uid, idx = rec['user_id'], rec['item_idx']
            r = rec.get('rating', 1.0)
            itype = rec.get('type', 'click')
            ts = rec.get('timestamp', time.time())
            self.cf.add_interaction(uid, idx, r)
            self.popularity.add(idx, itype, ts)
            if r >= 3 or itype in ('like', 'order'):
                self.bpr.add_positive(uid, idx)
        self.cf.train()
        self.bpr.train()
        self.drink_pairing.train(self.cf.interactions)

    def _append_interaction(self, record):
        data = {'interactions': []}
        if os.path.exists(self.data_path):
            with open(self.data_path) as f:
                data = json.load(f)
        data['interactions'].append(record)
        with open(self.data_path, 'w') as f:
            json.dump(data, f, indent=2)

    # -- seed data (cold-start bootstrap) -------------------------------------

    def _generate_seed_data(self):
        """Auto-generate seed profiles by analysing the menu structure.

        Fully general — works with any restaurant menu.  The algorithm:
          1. Uses DrinkPairingModel's auto-classification of drinks (coffee /
             tea / refreshing) and food categories (sweet / savory).
          2. Creates user archetypes: savory-food users prefer refreshing +
             tea drinks; sweet-food users prefer coffee + tea drinks.
          3. No item names are hardcoded — everything is derived from the
             menu's own descriptions and category structure.
        """
        dp = self.drink_pairing
        interactions = []
        base_ts = time.time() - 30 * 86400

        def _add(uid, idx, is_like):
            ts = base_ts + random.random() * 25 * 86400
            interactions.append({
                'user_id': uid, 'item_idx': int(idx),
                'item_name': self.items[int(idx)]['Item'],
                'type': random.choice(['like', 'order']) if is_like else 'view',
                'rating': round(random.uniform(4.0, 5.0) if is_like
                                else random.uniform(1.0, 2.5), 1),
                'timestamp': ts,
            })

        for cat in dp.savory_food_cats:
            cat_items = self.df.index[self.df['Category'] == cat].tolist()
            if not cat_items:
                continue
            for copy in range(3):
                uid = f'seed_savory_{cat[:12]}_{copy}'
                for idx in random.sample(cat_items, min(5, len(cat_items))):
                    _add(uid, idx, True)
                for idx in dp.meal_drinks:
                    _add(uid, idx, True)
                for idx in dp.water_drinks:
                    _add(uid, idx, False)

        for cat in dp.sweet_food_cats:
            cat_items = self.df.index[self.df['Category'] == cat].tolist()
            if not cat_items:
                continue
            for copy in range(3):
                uid = f'seed_sweet_{cat[:12]}_{copy}'
                for idx in random.sample(cat_items, min(5, len(cat_items))):
                    _add(uid, idx, True)
                for idx in dp.tea_drinks:
                    _add(uid, idx, True)
                for idx in dp.sweet_drinks:
                    _add(uid, idx, True)
                for idx in dp.coffee_drinks[:3]:
                    _add(uid, idx, True)
                for idx in dp.coffee_drinks[3:5]:
                    _add(uid, idx, False)

        with open(self.data_path, 'w') as f:
            json.dump({'interactions': interactions}, f, indent=2)

    # -- tracking / training --------------------------------------------------

    def track(self, user_id, item_name, itype='click', rating=None):
        idx = self.name_to_idx.get(item_name)
        if idx is None:
            return False
        ts = time.time()
        r = rating if rating is not None else \
            {'view': 1, 'click': 2, 'like': 4, 'order': 5}.get(itype, 2)

        with self._lock:
            self.cf.add_interaction(user_id, idx, float(r))
            self.popularity.add(idx, itype, ts)
            if r >= 3 or itype in ('like', 'order'):
                self.bpr.add_positive(user_id, idx)
            self._append_interaction({
                'user_id': user_id, 'item_idx': idx, 'item_name': item_name,
                'type': itype, 'rating': float(r), 'timestamp': ts,
            })
        return True

    def retrain(self):
        with self._lock:
            self.cf.train()
            self.bpr.train()
            self.drink_pairing.train(self.cf.interactions)

    # -- helpers --------------------------------------------------------------

    def _to_arr(self, results):
        a = np.zeros(self.n_items)
        for r in results:
            a[r['index']] = r['score']
        return a

    def _norm(self, a):
        mn, mx = a.min(), a.max()
        return (a - mn) / (mx - mn) if (mx - mn) > 1e-9 else np.zeros_like(a)

    def _fmt(self, idx, score, strategy):
        r = self.items[idx]
        return {
            'name': r['Item'], 'category': r['Category'],
            'description': r['Description'], 'price': float(r['Price']),
            'score': round(float(score) * 100, 1), 'strategy': strategy,
        }

    def _pair_drinks_with_food(self, food_query, food_results, n=5):
        """Use the trained DrinkPairingModel to recommend drinks for given foods."""
        food_indices = []
        food_scores = []
        for r in food_results:
            idx = self.name_to_idx.get(r['name'])
            if idx is not None:
                food_indices.append(idx)
                food_scores.append(r['score'] / 100.0)

        if not food_indices:
            return []

        pairs = self.drink_pairing.recommend(food_indices, food_scores, n)
        return [self._fmt(idx, score, 'ml_pairing') for idx, score in pairs]

    def _pair_foods_with_drink(self, drink_results, n=5):
        """Reverse ML pairing: given drinks, recommend compatible foods."""
        drink_indices = []
        drink_scores = []
        for r in drink_results:
            idx = self.name_to_idx.get(r['name'])
            if idx is not None:
                drink_indices.append(idx)
                drink_scores.append(r['score'] / 100.0)

        if not drink_indices:
            return []

        pairs = self.drink_pairing.recommend_foods(drink_indices, drink_scores, n)
        return [self._fmt(idx, score, 'ml_pairing') for idx, score in pairs]

    # -- main recommendation API ----------------------------------------------

    def recommend(self, user_id=None, food_query='', drink_query='',
                  strategy='hybrid', n=5, weights=None):
        w = weights or self.DEFAULT_WEIGHTS
        food_mask = ~self.df['Category'].isin(DRINK_CATEGORIES)
        drink_mask = self.df['Category'].isin(DRINK_CATEGORIES)

        def _rank(query, strat):
            if strat == 'content':
                return self._norm(self._to_arr(self.content.recommend_by_query(query)))

            if strat == 'fuzzy':
                return self._norm(self._to_arr(self.fuzzy.recommend_by_query(query)))

            if strat == 'collaborative':
                if user_id and self.cf.is_trained:
                    arr = self._norm(self._to_arr(self.cf.recommend(user_id)))
                    if arr.sum() > 0:
                        return arr
                return self._norm(self._to_arr(self.content.recommend_by_query(query)))

            if strat == 'bpr':
                if user_id and self.bpr.is_trained:
                    arr = self._norm(self._to_arr(self.bpr.recommend(user_id)))
                    if arr.sum() > 0:
                        return arr
                return self._norm(self._to_arr(self.content.recommend_by_query(query)))

            if strat == 'popularity':
                arr = self._norm(self.popularity.scores())
                if arr.sum() > 0:
                    return arr
                return self._norm(self._to_arr(self.content.recommend_by_query(query)))

            if strat == 'hybrid':
                scores = np.zeros(self.n_items)
                cb_raw = self._to_arr(self.content.recommend_by_query(query))
                cb = self._norm(cb_raw)

                gate = (cb_raw > 0.01).astype(float)

                # Expand gate via item-item content similarity so that
                # related items (same cooking style, same category) are
                # included even if TF-IDF didn't match them directly.
                if gate.sum() > 0:
                    seed_indices = np.where(gate > 0)[0]
                    sim_scores = np.zeros(self.n_items)
                    for si in seed_indices:
                        sim_scores = np.maximum(sim_scores, self.content.item_sim[si])
                    for idx in np.argsort(sim_scores)[::-1][:n * 3]:
                        if sim_scores[idx] > 0.20:
                            gate[idx] = 1.0

                    top_seed = sorted(seed_indices, key=lambda i: cb_raw[i], reverse=True)[:5]
                    seed_categories = set(self.df.iloc[int(si)]['Category'] for si in top_seed)
                    for idx in range(self.n_items):
                        if self.df.iloc[idx]['Category'] in seed_categories:
                            gate[idx] = 1.0

                scores += w['content'] * cb

                fz = self._norm(self._to_arr(self.fuzzy.recommend_by_query(query)))
                scores += w['fuzzy'] * (fz * gate)

                if user_id and self.cf.is_trained:
                    cf = self._norm(self._to_arr(self.cf.recommend(user_id)))
                    scores += w['cf'] * (cf * gate if cf.sum() > 0 else cb)
                else:
                    scores += w['cf'] * cb

                if user_id and self.bpr.is_trained:
                    bp = self._norm(self._to_arr(self.bpr.recommend(user_id)))
                    scores += w['bpr'] * (bp * gate if bp.sum() > 0 else cb)
                else:
                    scores += w['bpr'] * cb

                pop = self._norm(self.popularity.scores())
                scores += w['popularity'] * (pop * gate if pop.sum() > 0 else np.zeros(self.n_items))

                scores *= gate
                return scores

            return np.zeros(self.n_items)

        def _top(query, mask, strat):
            if not query:
                return []
            s = _rank(query, strat)
            s[~mask.values] = -1
            top = np.argsort(s)[::-1][:n]
            return [self._fmt(int(i), s[i], strat) for i in top if s[i] > 0]

        food_vague = _is_vague_query(food_query)
        drink_vague = _is_vague_query(drink_query)

        if not food_vague and not drink_vague:
            foods = _top(food_query, food_mask, strategy)
            drinks = _top(drink_query, drink_mask, strategy)
        elif not food_vague and drink_vague:
            foods = _top(food_query, food_mask, strategy)
            drinks = self._pair_drinks_with_food(food_query, foods, n)
        elif food_vague and not drink_vague:
            drinks = _top(drink_query, drink_mask, strategy)
            foods = self._pair_foods_with_drink(drinks, n)
        else:
            foods = []
            drinks = []

        return {
            'recommended_foods': foods,
            'recommended_drinks': drinks,
            'strategy': strategy,
            'strategy_description': self.STRATEGIES.get(strategy, ''),
        }

    # -- extra endpoints ------------------------------------------------------

    def get_chefs_picks(self, per_category=3):
        """Return `per_category` items for every category in the menu."""
        categories = self.df['Category'].unique().tolist()
        picks = {}
        for cat in categories:
            cat_indices = self.df.index[self.df['Category'] == cat].tolist()
            if not cat_indices:
                continue
            selected = random.sample(cat_indices, min(per_category, len(cat_indices)))
            picks[cat] = [self._fmt(int(i), 0, 'featured') for i in selected]
        return picks

    def get_popular(self, n=12):
        results = self.popularity.recommend(n=n * 2)
        foods, drinks = [], []
        for r in results:
            item = self._fmt(r['index'], r['score'], 'popularity')
            cat = self.items[r['index']]['Category']
            if cat in DRINK_CATEGORIES:
                if len(drinks) < n:
                    drinks.append(item)
            else:
                if len(foods) < n:
                    foods.append(item)
        return {'foods': foods, 'drinks': drinks}

    def get_similar(self, item_name, n=6):
        idx = self.name_to_idx.get(item_name)
        if idx is None:
            return []
        return [self._fmt(r['index'], r['score'], 'content')
                for r in self.content.get_similar_items(idx, n)]

    def get_personalized(self, user_id, n=12):
        if not user_id:
            return self.get_popular(n)

        combined = np.zeros(self.n_items)
        if self.cf.is_trained:
            cf = self._norm(self._to_arr(self.cf.recommend(user_id)))
            combined += 0.55 * cf
        if self.bpr.is_trained:
            bp = self._norm(self._to_arr(self.bpr.recommend(user_id)))
            combined += 0.45 * bp

        if combined.sum() == 0:
            return self.get_popular(n)

        food_m = ~self.df['Category'].isin(DRINK_CATEGORIES)
        drink_m = self.df['Category'].isin(DRINK_CATEGORIES)
        fs = combined.copy(); fs[~food_m.values] = -1
        ds = combined.copy(); ds[~drink_m.values] = -1

        foods = [self._fmt(int(i), fs[i], 'personalized')
                 for i in np.argsort(fs)[::-1][:n] if fs[i] > 0]
        drinks = [self._fmt(int(i), ds[i], 'personalized')
                  for i in np.argsort(ds)[::-1][:n] if ds[i] > 0]
        return {'foods': foods, 'drinks': drinks}

    def get_stats(self):
        return {
            'n_items': self.n_items,
            'n_users': len(self.cf.interactions),
            'n_interactions': sum(len(v) for v in self.cf.interactions.values()),
            'cf_trained': self.cf.is_trained,
            'bpr_trained': self.bpr.is_trained,
            'strategies': list(self.STRATEGIES.keys()),
            'strategy_info': self.STRATEGIES,
            'weights': self.DEFAULT_WEIGHTS,
        }
