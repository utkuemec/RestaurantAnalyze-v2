(function() {
    'use strict';

    var history = [];

    try { sessionStorage.removeItem('mado_chat_history'); } catch (e) {}

    // Build DOM
    var bubble = document.createElement('div');
    bubble.id = 'chat-bubble';
    bubble.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
    document.body.appendChild(bubble);

    var panel = document.createElement('div');
    panel.id = 'chat-panel';
    panel.classList.add('chat-hidden');
    panel.innerHTML =
        '<div id="chat-header">' +
            '<span class="chat-title">MADO Concierge</span>' +
            '<button id="chat-close">&times;</button>' +
        '</div>' +
        '<div id="chat-messages"></div>' +
        '<div id="chat-input-area">' +
            '<input type="text" id="chat-input" placeholder="Ask about our menu, specials, or anything..." autocomplete="off">' +
            '<button id="chat-send">&#10148;</button>' +
        '</div>';
    document.body.appendChild(panel);

    var messagesEl = document.getElementById('chat-messages');
    var inputEl = document.getElementById('chat-input');
    var sendBtn = document.getElementById('chat-send');
    var closeBtn = document.getElementById('chat-close');
    var isOpen = false;
    var isSending = false;

    function addMessage(role, text) {
        var div = document.createElement('div');
        div.className = 'chat-msg chat-msg-' + role;
        div.textContent = text;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderHistory() {
        messagesEl.innerHTML = '';
        if (history.length === 0) {
            addMessage('assistant', "Welcome to MADO! I'm your personal concierge. Ask me anything about our menu, ingredients, or tell me what you're craving — I'll find the perfect match!");
        }
        history.forEach(function(m) {
            addMessage(m.role, m.content);
        });
    }

    function showTyping() {
        var div = document.createElement('div');
        div.className = 'chat-msg chat-msg-assistant chat-typing';
        div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
        div.id = 'chat-typing-indicator';
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function removeTyping() {
        var el = document.getElementById('chat-typing-indicator');
        if (el) el.remove();
    }

    async function sendMessage() {
        var text = inputEl.value.trim();
        if (!text || isSending) return;

        history.push({ role: 'user', content: text });
        addMessage('user', text);
        inputEl.value = '';
        isSending = true;
        sendBtn.disabled = true;
        showTyping();

        try {
            var resp = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, history: history.slice(0, -1) }),
            });
            var data = await resp.json();
            removeTyping();
            var reply = data.reply || "Sorry, I couldn't process that.";
            history.push({ role: 'assistant', content: reply });
            addMessage('assistant', reply);
        } catch (e) {
            removeTyping();
            addMessage('assistant', "Sorry, something went wrong. Please try again.");
        }

        isSending = false;
        sendBtn.disabled = false;
        inputEl.focus();
    }

    bubble.addEventListener('click', function() {
        isOpen = !isOpen;
        if (isOpen) {
            panel.classList.remove('chat-hidden');
            bubble.classList.add('chat-bubble-hidden');
            renderHistory();
            inputEl.focus();
        } else {
            panel.classList.add('chat-hidden');
            bubble.classList.remove('chat-bubble-hidden');
        }
    });

    closeBtn.addEventListener('click', function() {
        isOpen = false;
        panel.classList.add('chat-hidden');
        bubble.classList.remove('chat-bubble-hidden');
    });

    sendBtn.addEventListener('click', sendMessage);

    inputEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') sendMessage();
    });
})();
