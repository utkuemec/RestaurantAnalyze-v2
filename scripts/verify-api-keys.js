/**
 * One real API call per provider (same models as server.js).
 * Run from project root: node scripts/verify-api-keys.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

var PROMPT = 'Reply with exactly the two letters OK and nothing else.';

function fail(name, err) {
    var msg = err && (err.message || err.error && err.error.message) || String(err);
    var status = err && (err.status || err.statusCode);
    console.log('FAIL  ' + name + (status ? ' (HTTP ' + status + ')' : '') + ': ' + msg);
    return false;
}

async function testAnthropic() {
    var key = process.env.ANTHROPIC_API_KEY;
    if (!key || !String(key).trim()) {
        console.log('SKIP  ANTHROPIC_API_KEY (not set)');
        return null;
    }
    try {
        var Anthropic = require('@anthropic-ai/sdk');
        var client = new Anthropic({ apiKey: key });
        var result = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 32,
            messages: [{ role: 'user', content: PROMPT }],
        });
        var text = (result.content[0] && result.content[0].text) || '';
        console.log('OK    Anthropic (Claude Haiku 4.5) — sample: ' + JSON.stringify(text.trim().slice(0, 40)));
        return true;
    } catch (e) {
        return fail('Anthropic', e);
    }
}

async function testGroq() {
    var key = process.env.GROQ_API_KEY;
    if (!key || !String(key).trim()) {
        console.log('SKIP  GROQ_API_KEY (not set)');
        return null;
    }
    try {
        var Groq = require('groq-sdk');
        var groq = new Groq({ apiKey: key, timeout: 30000 });
        var completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: PROMPT }],
            max_tokens: 32,
            temperature: 0,
        });
        var text = (completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) || '';
        console.log('OK    Groq (llama-3.3-70b-versatile) — sample: ' + JSON.stringify(text.trim().slice(0, 40)));
        return true;
    } catch (e) {
        return fail('Groq', e);
    }
}

async function testGemini() {
    var key = process.env.GEMINI_API_KEY;
    if (!key || !String(key).trim()) {
        console.log('SKIP  GEMINI_API_KEY (not set)');
        return null;
    }
    var { GoogleGenerativeAI } = require('@google/generative-ai');
    var genAI = new GoogleGenerativeAI(key);
    var models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
    var lastErr;
    for (var i = 0; i < models.length; i++) {
        try {
            var model = genAI.getGenerativeModel({ model: models[i] });
            var result = await model.generateContent(PROMPT);
            var text = (await result.response.text()) || '';
            console.log('OK    Gemini (' + models[i] + ') — sample: ' + JSON.stringify(text.trim().slice(0, 40)));
            return true;
        } catch (e) {
            lastErr = e;
            var status = e && (e.status || e.statusCode);
            var msg = e && (e.message || '') || '';
            if (status === 429 || /429|quota|rate/i.test(msg)) {
                console.log('WARN  Gemini (' + models[i] + '): HTTP 429 / quota — key accepted; try again later or another model.');
                continue;
            }
            if (i < models.length - 1) {
                console.log('WARN  Gemini (' + models[i] + ') failed, trying next model...');
                continue;
            }
            return fail('Gemini', e);
        }
    }
    if (lastErr && (lastErr.status === 429 || /429|quota|rate/i.test(lastErr.message || ''))) {
        console.log('FAIL  Gemini: all tried models returned quota/rate limits (key likely valid; billing or free-tier exhausted).');
        return 'quota';
    }
    return fail('Gemini', lastErr);
}

async function main() {
    console.log('Verifying API keys (isolated calls, same models as server.js)...\n');
    var results = [];
    results.push(await testAnthropic());
    results.push(await testGroq());
    results.push(await testGemini());

    var anyHardFail = results.some(function (r) { return r === false; });
    var anyOk = results.some(function (r) { return r === true; });
    var geminiQuota = results.some(function (r) { return r === 'quota'; });
    console.log('');
    if (anyHardFail) {
        console.log('Summary: at least one provider failed (invalid key, model error, or network).');
        process.exit(1);
    }
    if (!anyOk && !geminiQuota && results.every(function (r) { return r === null; })) {
        console.log('Summary: no keys were set (all skipped).');
        process.exit(1);
    }
    if (geminiQuota && !results.some(function (r) { return r === true; })) {
        console.log('Summary: only quota/rate-limit issues (no successful generation).');
        process.exit(1);
    }
    if (geminiQuota) {
        console.log('Summary: Anthropic and/or Groq OK; Gemini hit quota on all tried models (check Google AI Studio / billing).');
        process.exit(2);
    }
    console.log('Summary: every configured provider returned a successful completion.');
    process.exit(0);
}

main().catch(function (e) {
    console.error(e);
    process.exit(1);
});
