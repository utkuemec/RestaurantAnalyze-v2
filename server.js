require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

const FLASK_API = 'http://127.0.0.1:5008';

// ---------- AI Chat Setup (Groq primary → Gemini fallback) ------------------

var groqProvider = null;
var geminiProvider = null;
var chatProvider = null;

if (process.env.GROQ_API_KEY) {
    var Groq = require('groq-sdk');
    var groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: 30000 });
    var GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
    groqProvider = {
        name: 'Groq (Llama)',
        send: async function(systemPrompt, messages) {
            var msgs = [{ role: 'system', content: systemPrompt }];
            messages.forEach(function(m) { msgs.push({ role: m.role, content: m.content }); });
            for (var i = 0; i < GROQ_MODELS.length; i++) {
                try {
                    var completion = await groqClient.chat.completions.create({
                        model: GROQ_MODELS[i],
                        messages: msgs,
                        max_tokens: 1024,
                        temperature: 0.7,
                    });
                    return completion.choices[0].message.content;
                } catch (err) {
                    if ((err.status === 429 || err.status === 413) && i < GROQ_MODELS.length - 1) {
                        console.log('Chat: rate limited on ' + GROQ_MODELS[i] + ', trying ' + GROQ_MODELS[i + 1]);
                        continue;
                    }
                    throw err;
                }
            }
        },
    };
    console.log('Chat: Groq ready (Llama 3.3 70B / 8B)');
}

if (process.env.GEMINI_API_KEY) {
    var { GoogleGenerativeAI } = require('@google/generative-ai');
    var gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    geminiProvider = {
        name: 'Gemini',
        send: async function(systemPrompt, messages) {
            var model = gemini.getGenerativeModel({ model: 'gemini-2.0-flash' });
            var history = [];
            messages.slice(0, -1).forEach(function(m) {
                history.push({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }],
                });
            });
            var chat = model.startChat({
                history: history,
                systemInstruction: { parts: [{ text: systemPrompt }] },
            });
            var last = messages[messages.length - 1];
            var result = await chat.sendMessage(last.content);
            return result.response.text();
        },
    };
    console.log('Chat: Gemini ready (2.0 Flash)');
}

// Combined provider: tries Groq first, falls back to Gemini
if (groqProvider || geminiProvider) {
    chatProvider = {
        name: groqProvider && geminiProvider ? 'Groq + Gemini' : (groqProvider || geminiProvider).name,
        send: async function(systemPrompt, messages) {
            if (groqProvider) {
                try {
                    return await groqProvider.send(systemPrompt, messages);
                } catch (err) {
                    if (geminiProvider) {
                        console.log('Chat: Groq failed (' + (err.status || err.message) + '), falling back to Gemini');
                    } else {
                        throw err;
                    }
                }
            }
            if (geminiProvider) {
                return await geminiProvider.send(systemPrompt, messages);
            }
            throw new Error('No chat provider available');
        },
    };
    console.log('Chat: active provider chain — ' + chatProvider.name);
}

var cachedMenuText = null;

async function getMenuText() {
    if (cachedMenuText) return cachedMenuText;
    try {
        var r = await fetch(FLASK_API + '/api/menu');
        var menu = await r.json();
        var lines = ['MENU:'];
        (menu.Foods || []).forEach(function(item) {
            lines.push(item.name + ' $' + item.price.toFixed(2));
        });
        lines.push('---DRINKS---');
        (menu.Drinks || []).forEach(function(item) {
            lines.push(item.name + ' $' + item.price.toFixed(2));
        });
        cachedMenuText = lines.join('\n');
        return cachedMenuText;
    } catch (e) {
        return 'Menu is currently unavailable.';
    }
}

var SYSTEM_PROMPT = `You are a friendly waiter at MADO, a famous Turkish café/restaurant (ice cream, baklavas, kebabs). Be warm, helpful, and conversational — like a real waiter. Keep replies natural length (2-4 sentences typical, longer if listing items).

LANGUAGE RULE (#1 PRIORITY): Reply ENTIRELY in the customer's language. If they write Turkish, reply in Turkish. French→French. Arabic→Arabic. Any language→same language.
MENU ITEM TRANSLATION: When replying in a non-English language, you MUST use the translated menu item names from the TRANSLATED MENU REFERENCE section (appended at the end of this prompt). Use those exact translated names — NEVER use the English name in your reply text. If no translated reference is provided, translate the menu item names yourself naturally.
EXCEPTION: Inside [ADD_TO_CART: ...] tags, ALWAYS use the ORIGINAL ENGLISH menu name exactly as listed in the MENU section.
Translate naturally — do NOT put the English name in parentheses.
If the message starts with [IMPORTANT: ...], follow that language instruction absolutely.

DRINK-FOOD PAIRING (follow these STRICTLY):
IMPORTANT: The drink names below are English identifiers. When replying in a non-English language, ALWAYS use the translated names from the TRANSLATED MENU REFERENCE — NEVER write these English names in your reply.
SAVORY FOOD (kebab, chicken, burger, steak, doner, kofte, wraps, mains, appetizers, salads):
  → Recommend from these drinks (translate the names): Ayran, Soda Pop, Can Soda, Turkish Gazoz, Homemade Lemonade, Sparkling Water, Iced Tea
  → Always suggest 2-3 options.
  → NEVER suggest coffee-based drinks (Turkish Coffee, Latte, Cappuccino, Espresso, Hot Chocolate) with savory/meat dishes.
SWEET FOOD (baklava, kunefe, ice cream, cake, waffle, desserts):
  → ONLY recommend from these drinks (translate the names): Turkish Coffee, Espresso, Cappuccino, Latte, Tea, Salep, Hot Chocolate
  → NEVER suggest Ayran, Soda, or savory drinks with desserts.
"Recommend something with it" / "something nice with it" after ordering food = they want a DRINK, not dessert. Only suggest dessert if they explicitly ask for dessert or sweets.

ORDERING — THESE RULES ARE CRITICAL, READ CAREFULLY:

WHEN TO ADD (use [ADD_TO_CART: exact item name]):
- Customer says an EXACT menu item name + clear order word: "I want the Iskender Kebab", "Ayran istiyorum", "Give me a Turkish Coffee", "Chicken Shish Kebab lütfen"
- Customer confirms YOUR specific suggestion: you said "Would you like the Adana Kebab?" and they say "Yes" / "Evet" / "Sure"
- Customer orders multiple specific items: "I want Ayran and also the Baklava" → add both

WHEN TO NEVER ADD (NO [ADD_TO_CART] tag at all):
- Customer asks for recommendations: "What do you suggest?", "önerir misin?", "what's good with kebab?"
- Customer is browsing: "What are the drinks?", "Tell me about desserts", "What kebabs do you have?"
- Customer is vague: "I want something nice", "kebab istiyorum", "I feel like chicken"
- YOU are recommending/suggesting items: when YOU say "I recommend Ayran", do NOT add Ayran to cart — wait for the customer to confirm
- Customer says "I want something with kebab" = asking for pairing suggestion, NOT ordering

The KEY test: Did the customer say the EXACT name of a menu item AND clearly want to order it? If NO → just recommend, don't add. If YES → add with [ADD_TO_CART: exact name].
- A message can contain BOTH an order AND a question. Example: "Yes I wanna Iskender Kebab and recommend me a dessert" → ADD Iskender Kebab [ADD_TO_CART: Iskender Kebab] AND recommend desserts. The "recommend" part does NOT cancel the order part.

TAG FORMAT: Always write [ADD_TO_CART: Item Name] exactly using the ENGLISH menu name. Never shorten to [Item] or skip the tag.
CRITICAL: The item name inside [ADD_TO_CART: ...] must ALWAYS be the original English name from the MENU, even when replying in another language. But the reply TEXT must use the translated name.
Examples (note: reply text is in the customer's language, but ADD_TO_CART uses English):
  Customer (Turkish): "Ayran istiyorum" → "[ADD_TO_CART: Ayran] Ayran eklendi!"
  Customer (French): "Je voudrais un thé glacé" → "[ADD_TO_CART: Iced Tea] Thé glacé ajouté !"
  Customer (any language asking for recommendation): → Recommend items using TRANSLATED names, NO [ADD_TO_CART] tag
  Customer (any language confirming order): → Add with [ADD_TO_CART: English Name] and confirm in their language

SPEECH RECOGNITION ERRORS: Customers use voice input. The speech-to-text often garbles Turkish/foreign menu item names into English-sounding words. You MUST try to figure out what they meant. Common examples:
- "scan that/skander/a scanner/is kinder/his kinder" → Iskender Kebab
- "a donna/adana/a donna" → Adana Kebab or Adana Chicken Kebab
- "bay tea/bay tee/bay T" → Beyti Kebab
- "gone afa/gonna for" → Kunefe
- "bakla wa/bock lava" → Baklava
- "eye ran/I ran/iron/i run" → Ayran
- "goz lemme/goes lemon" → Gozleme
- "sah lep/saw lap" → Salep
- "la vash" → Lavash
- "man tea/mon tea" → Manti
If the customer's words sound PHONETICALLY similar to a menu item, assume they mean that item and respond accordingly. Ask for confirmation if unsure: "Did you mean Iskender Kebab?"

Only recommend items from the menu below.
`;

// AI-powered menu translation cache — generates translations on first request per language
var menuTranslationCache = {};
var menuItemNames = null;
var translationInProgress = {};

var LANG_NAMES = {
    'tr': 'Turkish', 'fr': 'French', 'de': 'German', 'es': 'Spanish',
    'ar': 'Arabic', 'ru': 'Russian', 'zh': 'Mandarin Chinese', 'ja': 'Japanese',
    'ko': 'Korean', 'it': 'Italian', 'pt': 'Portuguese', 'nl': 'Dutch',
    'pl': 'Polish', 'el': 'Greek', 'hi': 'Hindi', 'uk': 'Ukrainian', 'sv': 'Swedish'
};

async function extractMenuItemNames() {
    if (menuItemNames) return menuItemNames;
    var menuText = await getMenuText();
    if (!menuText || menuText === 'Menu is currently unavailable.') return [];
    var items = [];
    menuText.split('\n').forEach(function(line) {
        line = line.trim();
        if (line && line !== 'MENU:' && line !== '---DRINKS---' && line.indexOf('$') !== -1) {
            var name = line.replace(/\s*\$[\d.]+$/, '').trim();
            if (name) items.push(name);
        }
    });
    menuItemNames = items;
    return items;
}

var translationQueue = [];
var translationRunning = false;

async function aiTranslate(prompt, sysPrompt, retries) {
    retries = retries || 0;
    var providers = [];
    if (geminiProvider) providers.push({ name: 'Gemini', fn: function() { return geminiProvider.send(sysPrompt, [{ role: 'user', content: prompt }]); } });
    if (process.env.GROQ_API_KEY) {
        var Groq = require('groq-sdk');
        var gc = new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: 30000 });
        var msgs = [{ role: 'system', content: sysPrompt }, { role: 'user', content: prompt }];
        ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'].forEach(function(m) {
            providers.push({ name: 'Groq/' + m, fn: function() {
                return gc.chat.completions.create({ model: m, messages: msgs, max_tokens: 4096, temperature: 0.3 })
                    .then(function(c) { return c.choices[0].message.content; });
            }});
        });
    }
    if (!providers.length) throw new Error('No AI provider');

    for (var i = 0; i < providers.length; i++) {
        try {
            return await providers[i].fn();
        } catch (e) {
            var isRateLimit = e.message && (e.message.indexOf('429') !== -1 || e.message.indexOf('rate') !== -1 || e.message.indexOf('quota') !== -1 || e.status === 429);
            if (isRateLimit && i < providers.length - 1) {
                console.log('Translation: ' + providers[i].name + ' rate limited, trying next...');
                continue;
            }
            if (isRateLimit && retries < 2) {
                var wait = (retries + 1) * 20000;
                console.log('Translation: all providers rate limited, retrying in ' + (wait / 1000) + 's...');
                await new Promise(function(r) { setTimeout(r, wait); });
                return aiTranslate(prompt, sysPrompt, retries + 1);
            }
            throw e;
        }
    }
}

function parseTranslationJSON(text) {
    var jsonStr = text.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
    var start = jsonStr.indexOf('{');
    var end = jsonStr.lastIndexOf('}');
    if (start !== -1 && end !== -1) jsonStr = jsonStr.substring(start, end + 1);
    return JSON.parse(jsonStr);
}

async function processTranslationQueue() {
    if (translationRunning) return;
    translationRunning = true;

    while (translationQueue.length > 0) {
        var job = translationQueue.shift();
        var key = job.key;
        var langName = job.langName;

        try {
            var items = await extractMenuItemNames();
            if (!items.length) continue;

            console.log('Translation cache: generating ' + langName + ' (' + items.length + ' items)...');
            var sysPrompt = 'You are a professional food menu translator. Return ONLY valid JSON. No markdown fences, no explanation.';
            var prompt = 'Translate ALL of these restaurant menu items from English to ' + langName + '.\n' +
                'Return a JSON object: {"English Name": "' + langName + ' Translation"}\n' +
                'Rules: translate naturally as a native ' + langName + ' speaker. Keep brand names (MADO, Perrier, Red Bull, Ferrero Rocher, Oreo, San Pellegrino) unchanged.\n' +
                'Keep culinary loanwords commonly used in ' + langName + '.\n' +
                'You MUST translate ALL ' + items.length + ' items. Return ONLY the JSON object.\n\n' +
                items.join('\n');

            var result = await aiTranslate(prompt, sysPrompt);
            var translations = parseTranslationJSON(result);
            var count = Object.keys(translations).length;

            if (count < items.length * 0.5) {
                console.log('Translation cache: ' + langName + ' partial (' + count + '/' + items.length + '), fetching remainder...');
                var missing = items.filter(function(it) { return !translations[it]; });
                if (missing.length > 0) {
                    await new Promise(function(r) { setTimeout(r, 3000); });
                    var prompt2 = 'Translate these remaining items from English to ' + langName + '.\n' +
                        'Return ONLY a JSON object: {"English Name": "Translation"}\n\n' +
                        missing.join('\n');
                    try {
                        var result2 = await aiTranslate(prompt2, sysPrompt);
                        var extra = parseTranslationJSON(result2);
                        Object.assign(translations, extra);
                        count = Object.keys(translations).length;
                    } catch (e2) {
                        console.error('Translation remainder error (' + langName + '):', e2.message);
                    }
                }
            }

            if (count > 0) {
                menuTranslationCache[key] = translations;
                console.log('Translation cache: ' + langName + ' ready (' + count + ' items)');
            }
        } catch (e) {
            console.error('Translation cache error (' + langName + '):', e.message);
        }

        if (translationQueue.length > 0) {
            await new Promise(function(r) { setTimeout(r, 2000); });
        }
    }

    translationRunning = false;
}

function startTranslationCache(langCode) {
    var key = langCode.substring(0, 2);
    if (key === 'en' || menuTranslationCache[key] || translationInProgress[key]) return;
    if (!chatProvider) return;

    var langName = LANG_NAMES[key];
    if (!langName) return;

    translationInProgress[key] = true;
    translationQueue.push({ key: key, langName: langName });
    processTranslationQueue();
}

function getMenuTranslations(langCode) {
    var key = langCode.substring(0, 2);
    if (key === 'en') return null;
    if (menuTranslationCache[key]) return menuTranslationCache[key];
    startTranslationCache(langCode);
    return null;
}

function buildTranslatedMenuRef(translations) {
    if (!translations) return '';
    var lines = ['\n\nTRANSLATED MENU REFERENCE (use these exact names when replying in this language):'];
    Object.keys(translations).forEach(function(en) {
        lines.push(en + ' → ' + translations[en]);
    });
    return lines.join('\n');
}

function buildWordMap(translations) {
    var wordMap = {};
    Object.keys(translations).forEach(function(en) {
        var tr = translations[en];
        if (en === tr) return;
        var enWords = en.split(/\s+/);
        var trWords = tr.split(/\s+/);
        if (enWords.length === 1 && trWords.length >= 1) {
            wordMap[enWords[0]] = trWords.join(' ');
        } else if (enWords.length === 2 && trWords.length >= 1) {
            wordMap[en] = tr;
            if (enWords[0].length > 3) wordMap[enWords[0]] = trWords[0];
        }
    });
    return wordMap;
}

function postProcessTranslation(reply, translations) {
    if (!translations) return reply;

    var tags = [];
    var result = reply.replace(/\[ADD_TO_CART:[^\]]*\]/g, function(m) {
        tags.push(m);
        return '\x00TAG' + (tags.length - 1) + '\x00';
    });

    var keys = Object.keys(translations).sort(function(a, b) { return b.length - a.length; });
    keys.forEach(function(en) {
        var translated = translations[en];
        if (en !== translated) {
            result = result.split(en).join(translated);
        }
    });

    var wordMap = buildWordMap(translations);
    var wordKeys = Object.keys(wordMap).sort(function(a, b) { return b.length - a.length; });
    wordKeys.forEach(function(en) {
        var regex = new RegExp('\\b' + en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
        result = result.replace(regex, wordMap[en]);
    });

    tags.forEach(function(tag, i) {
        result = result.split('\x00TAG' + i + '\x00').join(tag);
    });

    return result;
}

function getUserId(req, res) {
    if (req.cookies && req.cookies.uid) return req.cookies.uid;
    var id = crypto.randomBytes(16).toString('hex');
    res.cookie('uid', id, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true });
    return id;
}

// ---------- Pages ----------------------------------------------------------

app.get('/', function(req, res) {
    var uid = getUserId(req, res);
    res.render('concierge', { uid: uid });
});

app.get('/recommend', async function(req, res) {
    var uid = getUserId(req, res);
    try {
        var picksRes = await fetch(FLASK_API + '/api/chefs-picks?per=3');
        var picks = await picksRes.json();
        res.render('preferences', { picks: picks, uid: uid });
    } catch (e) {
        res.render('preferences', { picks: null, uid: uid });
    }
});

app.post('/preferences', async function(req, res) {
    var uid = getUserId(req, res);
    var { food, drink, strategy } = req.body;
    strategy = strategy || 'hybrid';

    try {
        var [response, menuRes] = await Promise.all([
            fetch(FLASK_API + '/api/recommend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ food: food, drink: drink, strategy: strategy, user_id: uid }),
            }),
            fetch(FLASK_API + '/api/menu'),
        ]);
        if (!response.ok) throw new Error('Backend ' + response.status);
        var data = await response.json();
        var menu = menuRes.ok ? await menuRes.json() : { Foods: [], Drinks: [] };
        res.render('recommendations', { data: data, menu: menu, food: food || '', drink: drink || '', uid: uid });
    } catch (error) {
        console.error('Recommend error:', error.message);
        res.render('error', { message: 'Could not fetch recommendations. Is the Flask backend running?' });
    }
});

app.get('/menu', async function(req, res) {
    var uid = getUserId(req, res);
    try {
        var response = await fetch(FLASK_API + '/api/menu');
        if (!response.ok) throw new Error('Backend ' + response.status);
        var data = await response.json();
        res.render('menu', { data: data, uid: uid });
    } catch (error) {
        console.error('Menu error:', error.message);
        res.render('error', { message: 'Could not fetch menu. Is the Flask backend running?' });
    }
});

// ---------- API proxies (AJAX from browser) --------------------------------

app.post('/api/like', async function(req, res) {
    var uid = getUserId(req, res);
    try {
        var r = await fetch(FLASK_API + '/api/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: uid, item_name: req.body.item_name, type: 'like' }),
        });
        var data = await r.json();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/menu', async function(req, res) {
    try {
        var r = await fetch(FLASK_API + '/api/menu');
        var data = await r.json();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/similar', async function(req, res) {
    try {
        var r = await fetch(FLASK_API + '/api/similar?item=' + encodeURIComponent(req.query.item || '') + '&n=' + (req.query.n || 6));
        var data = await r.json();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/popular', async function(req, res) {
    try {
        var r = await fetch(FLASK_API + '/api/popular?n=' + (req.query.n || 8));
        var data = await r.json();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/stats', async function(req, res) {
    try {
        var r = await fetch(FLASK_API + '/api/stats');
        var data = await r.json();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ---------- TTS (Edge Neural voices via msedge-tts) --------------------------

var EdgeTTS = require('msedge-tts');

var TTS_VOICES = {
    'en-US': 'en-US-JennyNeural',
    'tr-TR': 'tr-TR-EmelNeural',
    'fr-FR': 'fr-FR-DeniseNeural',
    'de-DE': 'de-DE-KatjaNeural',
    'es-ES': 'es-ES-ElviraNeural',
    'ar-SA': 'ar-SA-ZariyahNeural',
    'ru-RU': 'ru-RU-SvetlanaNeural',
    'zh-CN': 'zh-CN-XiaoxiaoNeural',
    'ja-JP': 'ja-JP-NanamiNeural',
    'ko-KR': 'ko-KR-SunHiNeural',
    'it-IT': 'it-IT-ElsaNeural',
    'pt-BR': 'pt-BR-FranciscaNeural',
    'nl-NL': 'nl-NL-ColetteNeural',
    'pl-PL': 'pl-PL-AgnieszkaNeural',
    'hi-IN': 'hi-IN-SwaraNeural',
    'el-GR': 'el-GR-AthinaNeural',
    'uk-UA': 'uk-UA-PolinaNeural',
    'sv-SE': 'sv-SE-SofieNeural',
};

function getTTSVoice(lang) {
    if (TTS_VOICES[lang]) return TTS_VOICES[lang];
    var prefix = lang.split('-')[0];
    for (var key in TTS_VOICES) {
        if (key.startsWith(prefix)) return TTS_VOICES[key];
    }
    return 'en-US-JennyNeural';
}

app.post('/api/tts', async function(req, res) {
    var text = (req.body.text || '').trim();
    var lang = req.body.lang || 'en-US';
    if (!text) return res.status(400).json({ error: 'No text' });

    try {
        var tts = new EdgeTTS.MsEdgeTTS();
        await tts.setMetadata(getTTSVoice(lang), EdgeTTS.OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        var result = tts.toStream(text);
        var audioStream = result.audioStream;
        var chunks = [];
        audioStream.on('data', function(chunk) { chunks.push(chunk); });
        await new Promise(function(resolve, reject) {
            audioStream.on('close', resolve);
            audioStream.on('error', reject);
        });
        var buffer = Buffer.concat(chunks);
        res.set('Content-Type', 'audio/mpeg');
        res.send(buffer);
    } catch (e) {
        console.error('TTS error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ---------- AI Chatbot (free tier) ------------------------------------------

app.post('/api/chat', async function(req, res) {
    if (!chatProvider) {
        return res.json({ reply: "Chat is not configured. Set GROQ_API_KEY or GEMINI_API_KEY to enable AI chat." });
    }
    try {
        var menuText = await getMenuText();
        var history = (req.body.history || []).slice(-20);
        var userMessage = (req.body.message || '').trim();
        if (!userMessage) return res.json({ reply: "Sorry, I didn't catch that. What can I help you with?" });

        var messages = [];
        history.forEach(function(m) { messages.push({ role: m.role, content: m.content }); });
        messages.push({ role: 'user', content: userMessage });

        var timedOut = false;
        var timer;
        var timeoutPromise = new Promise(function(_, reject) {
            timer = setTimeout(function() { timedOut = true; reject(new Error('timeout')); }, 45000);
        });
        var lang = req.body.lang || '';
        var translations = getMenuTranslations(lang);
        var translatedRef = buildTranslatedMenuRef(translations);

        var rawReply = await Promise.race([
            chatProvider.send(SYSTEM_PROMPT + menuText + translatedRef, messages),
            timeoutPromise
        ]);
        clearTimeout(timer);
        var reply = postProcessTranslation(rawReply, translations);
        res.json({ reply: reply });
    } catch (e) {
        console.error('Chat error:', e.message);
        var msg = e.message === 'timeout'
            ? "Sorry, the response took too long. Please try again!"
            : "Sorry, I'm having a little trouble right now. Please try again in a moment!";
        res.json({ reply: msg });
    }
});

// ---------- Order API --------------------------------------------------------

var orderCounter = 1000;
var orders = [];

app.post('/api/order', function(req, res) {
    var items = req.body.items;
    var total = req.body.total;
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'No items in order' });
    }
    orderCounter++;
    var order = {
        order_number: orderCounter,
        items: items,
        total: total,
        timestamp: new Date().toISOString(),
        status: 'received'
    };
    orders.push(order);
    console.log('--- NEW ORDER #' + orderCounter + ' ---');
    items.forEach(function(it) {
        console.log('  ' + it.qty + 'x ' + it.name + ' ($' + it.price + ')');
    });
    console.log('  TOTAL: $' + parseFloat(total).toFixed(2));
    console.log('---');
    res.json({ success: true, order_number: orderCounter });
});

app.get('/api/orders', function(req, res) {
    res.json(orders);
});

app.listen(3001, '127.0.0.1', function() {
    console.log('Server is running on http://localhost:3001');
});
