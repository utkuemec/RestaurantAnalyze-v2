require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { spawn } = require('child_process');
const net = require('net');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

/** Set FLASK_API in .env to use an already-running Flask; otherwise Node spawns Flask on a free port. */
var FLASK_API = (process.env.FLASK_API || '').trim();
var flaskChild = null;

function getFreePort() {
    return new Promise(function(resolve, reject) {
        var s = net.createServer();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', function() {
            var p = s.address().port;
            s.close(function() { resolve(p); });
        });
    });
}

function waitForFlask(base, maxMs) {
    var start = Date.now();
    return new Promise(function tryOnce(resolve, reject) {
        if (Date.now() - start > maxMs) {
            return reject(new Error('Flask did not become ready within ' + maxMs + 'ms'));
        }
        fetch(base + '/api/stats')
            .then(function(r) {
                if (r.ok) return resolve();
                setTimeout(function() { tryOnce(resolve, reject); }, 400);
            })
            .catch(function() {
                setTimeout(function() { tryOnce(resolve, reject); }, 400);
            });
    });
}

function ensureFlask() {
    if (FLASK_API) {
        console.log('Using FLASK_API=' + FLASK_API + ' (Flask auto-spawn skipped)');
        return Promise.resolve();
    }
    return getFreePort().then(function(port) {
        FLASK_API = 'http://127.0.0.1:' + port;
        var py = process.env.PYTHON || 'python3';
        flaskChild = spawn(py, [path.join(__dirname, 'app.py')], {
            cwd: __dirname,
            env: Object.assign({}, process.env, { FLASK_INTERNAL_PORT: String(port) }),
            stdio: ['ignore', 'inherit', 'inherit'],
        });
        flaskChild.on('exit', function(code, sig) {
            if (code !== 0 && code !== null) {
                console.log('Flask process exited with code ' + code + (sig ? ' signal ' + sig : ''));
            }
        });
        console.log('Started Flask (Python) on internal port ' + port);
        return waitForFlask(FLASK_API, 120000);
    }).then(function() {
        console.log('Flask is ready at ' + FLASK_API);
    });
}

// ---------- AI Chat Setup (Claude primary → Groq → Gemini fallback) ----------

var claudeProvider = null;
var groqProvider = null;
var geminiProvider = null;
var chatProvider = null;

if (process.env.ANTHROPIC_API_KEY) {
    var Anthropic = require('@anthropic-ai/sdk');
    var anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    claudeProvider = {
        name: 'Claude',
        send: async function(systemPrompt, messages) {
            var msgs = [];
            messages.forEach(function(m) { msgs.push({ role: m.role, content: m.content }); });
            var result = await anthropicClient.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1024,
                system: systemPrompt,
                messages: msgs,
            });
            return result.content[0].text;
        },
    };
    console.log('Chat: Claude ready (Haiku 4.5 — fast)');
}

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

// Combined provider: Claude (best) → Groq → Gemini
var providers = [];
if (claudeProvider) providers.push(claudeProvider);
if (groqProvider) providers.push(groqProvider);
if (geminiProvider) providers.push(geminiProvider);

if (providers.length > 0) {
    chatProvider = {
        name: providers.map(function(p) { return p.name; }).join(' + '),
        send: async function(systemPrompt, messages) {
            for (var i = 0; i < providers.length; i++) {
                try {
                    return await providers[i].send(systemPrompt, messages);
                } catch (err) {
                    if (i < providers.length - 1) {
                        console.log('Chat: ' + providers[i].name + ' failed (' + (err.status || err.message) + '), trying ' + providers[i + 1].name);
                        continue;
                    }
                    throw err;
                }
            }
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

LANGUAGE RULE (#1 PRIORITY — ABSOLUTE):
Reply ENTIRELY in the customer's language. If they write Turkish, reply 100% in Turkish. French→100% French. Arabic→100% Arabic. ANY language→100% that language.
ZERO ENGLISH WORDS ALLOWED in non-English replies. Use proper CULINARY terminology (e.g. Turkish: "Dana" for beef/veal, NOT "İnek" which means cow; "Kuzu" for lamb, NOT "Koyun" which means sheep). This means:
- ALL menu item names must be translated (use the TRANSLATED MENU REFERENCE section at the end of this prompt)
- ALL descriptive words must be in the target language (e.g. "thinly sliced" → "ince dilimlenmiş" in Turkish, "tranché finement" in French)
- ALL cooking terms, adjectives, and adverbs must be in the target language (NEVER "special", "served", "grilled", "fresh", "homemade" etc. in English)
- Every single word in your reply must be in the customer's language. Not a SINGLE English word.
ONLY EXCEPTION: Inside [ADD_TO_CART: ...] tags, use the ORIGINAL ENGLISH menu name.
If no TRANSLATED MENU REFERENCE is provided, translate all menu names yourself naturally.
Do NOT put English names in parentheses.
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
- Customer orders multiple specific items: "Adana kebap istiyorum yanına da ayran" → you MUST add BOTH: [ADD_TO_CART: Adana Kebab] AND [ADD_TO_CART: Ayran]. NEVER skip any ordered item.
- CRITICAL: When a customer mentions MULTIPLE items they want to order, add ALL of them with separate [ADD_TO_CART] tags. Do NOT skip any.

WHEN TO NEVER ADD (NO [ADD_TO_CART] tag at all — CRITICAL):
- Customer asks about items: "What is X?", "Tell me about X", "What's the difference between X and Y?"
- Customer asks for recommendations: "What do you suggest?", "önerir misin?", "what's good with kebab?"
- Customer is browsing: "What are the drinks?", "Tell me about desserts", "What kebabs do you have?"
- Customer is vague: "I want something nice", "kebab istiyorum", "I feel like chicken"
- YOU are recommending/suggesting items: when YOU say "I recommend Ayran", do NOT add Ayran to cart — wait for the customer to confirm
- Customer says "I want something with kebab" = asking for pairing suggestion, NOT ordering
- Customer is comparing items: "difference between X and Y", "which is better X or Y"
- Customer is asking questions about ingredients, preparation, or descriptions

The KEY test: Did the customer say the EXACT name of a menu item AND use a CLEAR ORDER WORD (want, give me, I'll have, order, lütfen, istiyorum, je voudrais, etc.)? If NO → just answer/recommend, NEVER add. If YES → add with [ADD_TO_CART: exact name].
When in doubt, do NOT add to cart. It is MUCH better to NOT add something than to add it incorrectly.
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

TURKISH SPELLING VARIANTS (always map to the English menu name in [ADD_TO_CART]):
"kebap" = "Kebab", "köfte" = "Kofte", "şiş" = "Shish", "döner" = "Doner", "künefe" = "Kunefe", "mantı" = "Manti", "gözleme" = "Gozleme", "börek" = "Borek", "ayran" = "Ayran", "şakşuka" = "Shakshuka", "simit" = "Simit", "lahmacun" = "Lahmacun"
So "Adana kebap istiyorum" → [ADD_TO_CART: Adana Kebab], "İskender kebap istiyorum" → [ADD_TO_CART: Iskender Kebab]

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
            var sysPrompt = 'You are a professional restaurant menu translator with deep knowledge of culinary terminology. Return ONLY valid JSON. No markdown fences, no explanation.';
            var prompt = 'Translate ALL of these restaurant menu items from English to ' + langName + '.\n' +
                'Return a JSON object: {"English Name": "' + langName + ' Translation"}\n' +
                'CRITICAL RULES:\n' +
                '- Use proper CULINARY/RESTAURANT terminology, NOT literal animal names. For example: "Beef" in Turkish is "Dana" (veal) NOT "İnek" (cow). "Lamb" is "Kuzu" NOT "Koyun". "Chicken" is "Tavuk".\n' +
                '- Translate as a native ' + langName + ' chef/restaurant owner would write a menu.\n' +
                '- Keep brand names (MADO, Perrier, Red Bull, Ferrero Rocher, Oreo, San Pellegrino) unchanged.\n' +
                '- Keep culinary loanwords commonly used in ' + langName + '.\n' +
                '- Use the most natural, appetizing restaurant terminology in ' + langName + '.\n' +
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

    tags.forEach(function(tag, i) {
        result = result.split('\x00TAG' + i + '\x00').join(tag);
    });

    return result;
}

// Backup: detect ordered items in user message and inject [ADD_TO_CART] if AI forgot
var ORDER_WORDS_PATTERN = /\b(istiyorum|want|give me|i'll have|order|lütfen|s'il vous plaît|je voudrais|quiero|ich möchte|voglio|я хочу|أريد|주세요|ください|我要|gostaria|alayım|alırım|getir|ver)\b/i;
var RECOMMEND_WORDS_PATTERN = /\b(öner|recommend|suggest|what do you have|ne var|ne öner|çeşit|seçenek|options|menü|which|hangisi|tavsiye|conseille|empfehle|recomiend|consiglia|порекоменд|what.*good|neler var|fark|difference|compare|karşılaştır|arasındaki)\b/i;

function normalizeForMatch(text) {
    return text.toLowerCase()
        .replace(/kebap/g, 'kebab')
        .replace(/köfte/g, 'kofte')
        .replace(/şiş/g, 'shish')
        .replace(/döner/g, 'doner')
        .replace(/künefe/g, 'kunefe')
        .replace(/mantı/g, 'manti')
        .replace(/göz?leme/g, 'gozleme')
        .replace(/börek/g, 'borek')
        .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
        .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
        .replace(/é/g, 'e').replace(/è/g, 'e').replace(/ê/g, 'e')
        .replace(/ä/g, 'a').replace(/ñ/g, 'n');
}

function detectMissingCartTags(userMsg, aiReply, menuItemNames) {
    if (!menuItemNames || !menuItemNames.length) return aiReply;
    if (/\[ADD_TO_CART:/i.test(aiReply)) return aiReply;

    var cleanMsg = userMsg.replace(/\[IMPORTANT:[^\]]*\]/gi, '').trim();
    if (!cleanMsg) return aiReply;

    if (RECOMMEND_WORDS_PATTERN.test(cleanMsg)) return aiReply;

    if (!ORDER_WORDS_PATTERN.test(cleanMsg)) return aiReply;

    var msgNorm = normalizeForMatch(cleanMsg);
    var matched = [];
    var sorted = menuItemNames.slice().sort(function(a, b) { return b.length - a.length; });

    sorted.forEach(function(name) {
        var nameNorm = normalizeForMatch(name);
        if (msgNorm.indexOf(nameNorm) !== -1) {
            matched.push(name);
            msgNorm = msgNorm.split(nameNorm).join('');
        }
    });

    if (matched.length === 0) {
        var msgWords = msgNorm.split(/\s+/);
        sorted.forEach(function(name) {
            var nameNorm = normalizeForMatch(name);
            var nameWords = nameNorm.split(/\s+/).filter(function(w) { return w.length > 3; });
            if (nameWords.length === 0) return;
            var hits = 0;
            nameWords.forEach(function(nw) {
                msgWords.forEach(function(mw) {
                    if (mw.indexOf(nw) !== -1 || nw.indexOf(mw) !== -1) hits++;
                });
            });
            if (hits >= nameWords.length) {
                matched.push(name);
            }
        });
    }

    if (matched.length > 0) {
        var tags = matched.map(function(name) { return '[ADD_TO_CART: ' + name + ']'; }).join(' ');
        console.log('Cart backup: injected tags for: ' + matched.join(', '));
        return tags + ' ' + aiReply;
    }

    return aiReply;
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

// ---------- Speech-to-Text (Groq Whisper — accurate multilingual) ------------

var multer = require('multer');
var upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

var WHISPER_LANG_MAP = {
    'en-US': 'en', 'tr-TR': 'tr', 'fr-FR': 'fr', 'de-DE': 'de', 'es-ES': 'es',
    'ar-SA': 'ar', 'ru-RU': 'ru', 'zh-CN': 'zh', 'ja-JP': 'ja', 'ko-KR': 'ko',
    'it-IT': 'it', 'pt-BR': 'pt', 'nl-NL': 'nl', 'pl-PL': 'pl', 'hi-IN': 'hi',
    'el-GR': 'el', 'uk-UA': 'uk', 'sv-SE': 'sv',
};

var whisperPromptCache = null;

async function getWhisperPrompt() {
    if (whisperPromptCache) return whisperPromptCache;
    try {
        var items = await extractMenuItemNames();
        var short = items.slice(0, 25).map(function(n) {
            return n.split(' ').slice(0, 3).join(' ');
        });
        var prompt = 'MADO restaurant: ' + short.join(', ');
        if (prompt.length > 800) prompt = prompt.substring(0, 800);
        whisperPromptCache = prompt;
    } catch (e) {
        whisperPromptCache = 'MADO restaurant: Kebab, Ayran, Baklava, Kunefe, Iskender, Adana, Beyti, Gozleme, Manti, Lahmacun.';
    }
    return whisperPromptCache;
}

var HALLUCINATION_RE = /(subscribe|subtitl|sous.?titr|copyright|all rights|thank you for watch|vampire|sourcesub|amara\.org|请订阅|ご視聴|Abone ol|Altyaz|openai|whisper|captioning|untertitel|Gesellschaft|Radio.Canada|Merci d.avoir regard)/i;
var HALLUCINATION_DATE_RE = /\b(january|february|march|april|june|july|august|september|october|november|december)\s+\d{1,2},?\s*\d{4}\b/i;
var ENGLISH_NOISE_RE = /\b(maximizes?|rule|causes?|reality|vampire|dario|source\s*sub|AIT.?E)\b/i;

function isLikelyHallucination(text, expectedLang) {
    if (!text || text.length < 3) return true;
    if (HALLUCINATION_RE.test(text)) return true;
    if (HALLUCINATION_DATE_RE.test(text)) return true;
    if (expectedLang !== 'en' && ENGLISH_NOISE_RE.test(text)) return true;
    return false;
}

async function transcribeWithGroq(buffer, origName, contentType, whisperLang, prompt) {
    var { File } = require('buffer');
    var audioFile = new File([buffer], origName, { type: contentType });
    var result = await groqClient.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-large-v3',
        language: whisperLang,
        temperature: 0.0,
        prompt: prompt,
    });
    return (result.text || '').trim();
}

async function transcribeWithGemini(buffer, contentType, lang) {
    if (!process.env.GEMINI_API_KEY) throw new Error('No Gemini key');
    var { GoogleGenerativeAI } = require('@google/generative-ai');
    var genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    var langFullName = LANG_NAMES[lang] || lang;
    var base64Audio = buffer.toString('base64');
    var mimeType = contentType || 'audio/webm';
    var promptText = 'Transcribe this audio exactly as spoken. The speaker is speaking ' + langFullName + '. Return ONLY the transcribed text, nothing else. No explanations, no labels, no quotes.';

    var models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
    for (var i = 0; i < models.length; i++) {
        try {
            var model = genAI.getGenerativeModel({ model: models[i] });
            var result = await model.generateContent([
                { inlineData: { mimeType: mimeType, data: base64Audio } },
                { text: promptText },
            ]);
            return (result.response.text() || '').trim();
        } catch (e) {
            if (i < models.length - 1 && e.message && e.message.indexOf('429') !== -1) {
                console.log('Gemini STT: ' + models[i] + ' rate limited, trying ' + models[i + 1]);
                continue;
            }
            throw e;
        }
    }
    throw new Error('All Gemini models exhausted');
}

app.post('/api/transcribe', upload.single('audio'), async function(req, res) {
    if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'no_audio', text: '' });
    }

    var lang = req.body.lang || 'en-US';
    var whisperLang = WHISPER_LANG_MAP[lang] || lang.split('-')[0] || 'en';

    var origName = req.file.originalname || 'audio.webm';
    var contentType = req.file.mimetype || 'audio/webm';
    if (origName.endsWith('.mp4')) contentType = 'audio/mp4';
    if (origName.endsWith('.ogg')) contentType = 'audio/ogg';

    console.log('Transcribe: received ' + req.file.buffer.length + ' bytes, name=' + origName + ', mime=' + contentType + ', lang=' + whisperLang);

    var text = '';

    if (groqClient) {
        try {
            var prompt = await getWhisperPrompt();
            text = await transcribeWithGroq(req.file.buffer, origName, contentType, whisperLang, prompt);
            console.log('Whisper [' + whisperLang + ']: "' + text + '"');
        } catch (e) {
            console.log('Groq Whisper failed (' + (e.status || e.message) + '), trying Gemini...');
            text = '';
        }
    }

    if (!text || isLikelyHallucination(text, whisperLang)) {
        if (text) console.log('Whisper: REJECTED hallucination: "' + text + '"');
        try {
            text = await transcribeWithGemini(req.file.buffer, contentType, whisperLang);
            console.log('Gemini STT [' + whisperLang + ']: "' + text + '"');
        } catch (e2) {
            console.error('Gemini STT also failed:', e2.message);
            if (!text || isLikelyHallucination(text, whisperLang)) {
                return res.json({ text: '' });
            }
        }
    }

    if (isLikelyHallucination(text, whisperLang)) {
        console.log('STT: REJECTED final hallucination: "' + text + '"');
        return res.json({ text: '' });
    }

    res.json({ text: text });
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

function generateTTSBuffer(text, lang) {
    return new Promise(async function(resolve, reject) {
        try {
            var tts = new EdgeTTS.MsEdgeTTS();
            await tts.setMetadata(getTTSVoice(lang), EdgeTTS.OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
            var result = tts.toStream(text);
            var audioStream = result.audioStream;
            var chunks = [];
            audioStream.on('data', function(chunk) { chunks.push(chunk); });
            audioStream.on('close', function() { resolve(Buffer.concat(chunks)); });
            audioStream.on('error', reject);
        } catch (e) {
            reject(e);
        }
    });
}

// Pre-generated TTS cache: chat endpoint starts TTS before sending response
var ttsPreCache = {};
var TTS_CACHE_TTL = 30000;

function preGenerateTTS(text, lang, key) {
    ttsPreCache[key] = { promise: generateTTSBuffer(text, lang), ts: Date.now() };
    setTimeout(function() { delete ttsPreCache[key]; }, TTS_CACHE_TTL);
}

app.post('/api/tts', async function(req, res) {
    var text = (req.body.text || '').trim();
    var lang = req.body.lang || 'en-US';
    var ttsKey = req.body.ttsKey || '';
    if (!text && !ttsKey) return res.status(400).json({ error: 'No text' });

    try {
        var buffer;
        if (ttsKey && ttsPreCache[ttsKey]) {
            buffer = await ttsPreCache[ttsKey].promise;
            delete ttsPreCache[ttsKey];
        } else {
            buffer = await generateTTSBuffer(text, lang);
        }
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
        return res.json({ reply: "Chat is not configured. Set ANTHROPIC_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY to enable AI chat." });
    }
    try {
        var menuText = await getMenuText();
        var history = (req.body.history || []).slice(-20);
        var userMessage = (req.body.message || '').trim();
        if (!userMessage) return res.json({ reply: "Sorry, I didn't catch that. What can I help you with?" });

        var messages = [];
        history.forEach(function(m) { messages.push({ role: m.role, content: m.content }); });
        messages.push({ role: 'user', content: userMessage });

        var timer;
        var timeoutPromise = new Promise(function(_, reject) {
            timer = setTimeout(function() { reject(new Error('timeout')); }, 45000);
        });
        var lang = req.body.lang || '';
        var translations = getMenuTranslations(lang);
        var translatedRef = buildTranslatedMenuRef(translations);

        var rawReply = await Promise.race([
            chatProvider.send(SYSTEM_PROMPT + menuText + translatedRef, messages),
            timeoutPromise
        ]);
        clearTimeout(timer);

        var items = await extractMenuItemNames();
        rawReply = detectMissingCartTags(userMessage, rawReply, items);

        var reply = postProcessTranslation(rawReply, translations);

        var cleanForTTS = reply.replace(/\[ADD_TO_CART:[^\]]*\]/g, '').replace(/\*\*/g, '').replace(/\s{2,}/g, ' ').trim();
        var ttsKey = '';
        if (cleanForTTS && lang) {
            ttsKey = crypto.randomBytes(8).toString('hex');
            preGenerateTTS(cleanForTTS, lang, ttsKey);
        }

        res.json({ reply: reply, ttsKey: ttsKey });
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

function shutdownFlask() {
    if (flaskChild && !flaskChild.killed) {
        flaskChild.kill('SIGTERM');
    }
}

process.on('SIGINT', function() {
    shutdownFlask();
    process.exit(0);
});
process.on('SIGTERM', function() {
    shutdownFlask();
    process.exit(0);
});

var listenPort = parseInt(process.env.PORT || '3001', 10);

ensureFlask()
    .then(function() {
        app.listen(listenPort, '127.0.0.1', function() {
            console.log('Server is running on http://127.0.0.1:' + listenPort + ' (UI + Node APIs; Flask is internal only)');
        });
    })
    .catch(function(err) {
        console.error(err);
        shutdownFlask();
        process.exit(1);
    });
