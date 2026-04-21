(function() {
    'use strict';

    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    var synth = window.speechSynthesis;

    var history = [];
    var isListening = false;
    var isSpeaking = false;
    var isSending = false;
    var recognition = null;
    var currentLang = 'en-US';
    var allVoices = [];
    var silenceTimer = null;
    var maxListenTimer = null;
    var lastInterim = '';
    var ttsAudio = new Audio();
    var ttsObjectUrl = null;
    var ttsUnlocked = false;
    var speakGen = 0;

    var useWhisper = true;
    var mediaRecorder = null;
    var audioChunks = [];
    var mediaStream = null;
    var recGenWhisper = 0;
    var audioCtx = null;
    var analyserNode = null;
    var silenceCheckInterval = null;

    var micBtn = document.getElementById('mic-btn');
    var micRing = document.getElementById('mic-ring');
    var micLabel = document.getElementById('mic-label');
    var statusText = document.getElementById('status-text');
    var transcriptEl = document.getElementById('transcript');
    var micIcon = micBtn.querySelector('.mic-icon');
    var stopIcon = micBtn.querySelector('.stop-icon');

    var langChipsContainer = document.getElementById('lang-chips');
    var langChips = langChipsContainer.querySelectorAll('.lang-chip');

    var typeBtn = document.getElementById('type-instead-btn');
    var textOverlay = document.getElementById('text-chat-overlay');
    var textCloseBtn = document.getElementById('text-chat-close');
    var textMessages = document.getElementById('text-chat-messages');
    var textInput = document.getElementById('text-chat-input');
    var textSendBtn = document.getElementById('text-chat-send');

    var speechSupported = !!SpeechRecognition;
    var ttsSupported = 'speechSynthesis' in window;
    var voicesLoaded = false;

    var LANG_DISPLAY = {};
    langChips.forEach(function(chip) {
        LANG_DISPLAY[chip.getAttribute('data-lang')] = chip.textContent.trim();
    });

    var WELCOME = "Welcome to MADO! I'm your personal concierge. Ask me anything about our menu, ingredients, or tell me what you're craving \u2014 I'll find the perfect match!";

    var menuItems = [];
    var splashEl = document.getElementById('splash-overlay');
    var welcomeAudioBlob = null;

    // ═══════════════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════════════

    function init() {
        fetchMenu();
        prefetchWelcomeAudio();

        var browserLang = (navigator.language || 'en-US');
        var matched = matchChipLang(browserLang);
        currentLang = matched || 'en-US';
        highlightActiveChip();

        var hasMediaRecorder = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
        if (!hasMediaRecorder && !speechSupported) {
            micLabel.textContent = 'Voice not supported \u2014 use Type Instead below';
            micBtn.disabled = true;
            micBtn.style.opacity = '.35';
            statusText.textContent = 'Voice unavailable';
            useWhisper = false;
        } else if (!hasMediaRecorder) {
            useWhisper = false;
            buildRecognition();
            statusText.textContent = 'Ready \u2014 ' + langName(currentLang);
        } else {
            useWhisper = true;
            statusText.textContent = 'Ready \u2014 ' + langName(currentLang);
        }

        addTranscriptBubble('assistant', WELCOME);

        if (splashEl) {
            splashEl.addEventListener('click', dismissSplash);
            splashEl.addEventListener('touchend', dismissSplash);
        }

        langChips.forEach(function(chip) {
            chip.addEventListener('click', function() {
                var lang = this.getAttribute('data-lang');
                switchLanguage(lang);
            });
        });

        micBtn.addEventListener('click', toggleMic);
        typeBtn.addEventListener('click', openTextChat);
        textCloseBtn.addEventListener('click', closeTextChat);
        textSendBtn.addEventListener('click', sendTextMessage);
        textInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') sendTextMessage();
        });
        textOverlay.addEventListener('click', function(e) {
            if (e.target === textOverlay) closeTextChat();
        });

        fixLangChipsScroll();
    }

    function prefetchWelcomeAudio() {
        fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: WELCOME, lang: 'en-US' }),
        })
        .then(function(r) { return r.ok ? r.blob() : null; })
        .then(function(blob) { welcomeAudioBlob = blob; })
        .catch(function() {});
    }

    function dismissSplash(e) {
        if (e) e.preventDefault();
        if (!splashEl || splashEl.classList.contains('hidden')) return;
        ensureAudioUnlocked();
        splashEl.classList.add('hidden');
        playWelcomeAudio();
    }

    function playWelcomeAudio() {
        if (welcomeAudioBlob) {
            if (ttsObjectUrl) URL.revokeObjectURL(ttsObjectUrl);
            ttsObjectUrl = URL.createObjectURL(welcomeAudioBlob);
            welcomeAudioBlob = null;

            isSpeaking = true;
            micRing.classList.add('speaking');
            statusText.textContent = 'Speaking (' + langName('en-US') + ')';

            ttsAudio.onended = function() {
                ttsAudio.onerror = null;
                isSpeaking = false;
                micRing.classList.remove('speaking');
                if (!isSending) statusText.textContent = 'Ready \u2014 ' + langName(currentLang);
            };
            ttsAudio.onerror = function() {
                ttsAudio.onerror = null;
                isSpeaking = false;
                micRing.classList.remove('speaking');
            };
            ttsAudio.src = ttsObjectUrl;
            ttsAudio.play().then(function() {
                ttsAudio.onerror = null;
            }).catch(function() {
                ttsAudio.onerror = null;
                isSpeaking = false;
                micRing.classList.remove('speaking');
            });
        } else {
            speak(WELCOME, 'en-US');
        }
    }

    function fixLangChipsScroll() {
        var chips = document.getElementById('lang-chips');
        if (!chips) return;
        var startX = 0;
        var startY = 0;
        var scrollLeft = 0;
        var isHorizontal = null;

        chips.addEventListener('touchstart', function(e) {
            startX = e.touches[0].pageX;
            startY = e.touches[0].pageY;
            scrollLeft = chips.scrollLeft;
            isHorizontal = null;
        }, { passive: true });

        chips.addEventListener('touchmove', function(e) {
            var dx = e.touches[0].pageX - startX;
            var dy = e.touches[0].pageY - startY;

            if (isHorizontal === null && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                isHorizontal = Math.abs(dx) > Math.abs(dy);
            }

            if (isHorizontal) {
                e.preventDefault();
                e.stopPropagation();
                chips.scrollLeft = scrollLeft - dx;
            }
        }, { passive: false });
    }

    function matchChipLang(browserLang) {
        var bl = browserLang.toLowerCase();
        for (var i = 0; i < langChips.length; i++) {
            var dl = langChips[i].getAttribute('data-lang').toLowerCase();
            if (dl === bl) return langChips[i].getAttribute('data-lang');
            if (dl.split('-')[0] === bl.split('-')[0]) return langChips[i].getAttribute('data-lang');
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    //  LANGUAGE PICKER
    // ═══════════════════════════════════════════════════════════════

    function switchLanguage(lang) {
        if (lang === currentLang) return;
        currentLang = lang;
        highlightActiveChip();
        if (!useWhisper) buildRecognition();
        micLabel.textContent = 'Tap the microphone to speak';
        statusText.textContent = 'Ready \u2014 ' + langName(currentLang);
    }

    function highlightActiveChip() {
        langChips.forEach(function(chip) {
            var dl = chip.getAttribute('data-lang');
            chip.classList.toggle('active', dl === currentLang);
        });
        var activeChip = langChipsContainer.querySelector('.lang-chip.active');
        if (activeChip) {
            activeChip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        }
    }

    function langName(code) {
        return LANG_DISPLAY[code] || code;
    }

    // ═══════════════════════════════════════════════════════════════
    //  SPEECH RECOGNITION  (Whisper primary, browser API fallback)
    // ═══════════════════════════════════════════════════════════════

    var recGeneration = 0;
    var watchdogInterval = null;
    var listenStartedAt = 0;
    var LISTEN_MAX_MS = 15000;

    function buildRecognition() {
        if (recognition) {
            recognition.onstart = null;
            recognition.onresult = null;
            recognition.onerror = null;
            recognition.onend = null;
            try { recognition.abort(); } catch (e) {}
            recognition = null;
        }
    }

    function stopSilenceDetection() {
        if (silenceCheckInterval) { clearInterval(silenceCheckInterval); silenceCheckInterval = null; }
        if (analyserNode) { try { analyserNode.disconnect(); } catch (e) {} analyserNode = null; }
        if (audioCtx && audioCtx.state !== 'closed') { try { audioCtx.close(); } catch (e) {} }
        audioCtx = null;
    }

    function stopWhisperRecording() {
        recGenWhisper++;
        stopSilenceDetection();
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try { mediaRecorder.stop(); } catch (e) {}
        }
        if (mediaStream) {
            mediaStream.getTracks().forEach(function(t) { t.stop(); });
            mediaStream = null;
        }
        mediaRecorder = null;
        audioChunks = [];
    }

    function forceCleanup() {
        clearTimeout(silenceTimer);
        clearTimeout(maxListenTimer);
        lastInterim = '';
        stopWhisperRecording();
        if (recognition) {
            recognition.onstart = null;
            recognition.onresult = null;
            recognition.onerror = null;
            recognition.onend = null;
            try { recognition.abort(); } catch (e) {}
        }
        resetMicUI();
    }

    function toggleMic() {
        ensureAudioUnlocked();
        if (synth) synth.cancel();
        if (isSpeaking) {
            stopSpeaking();
        }
        micBtn.disabled = false;
        if (isListening) {
            if (useWhisper) {
                finishWhisperRecording();
            } else {
                recGeneration++;
                forceCleanup();
            }
        } else {
            startListening();
        }
    }

    function startListening() {
        if (isSending) {
            micLabel.textContent = 'Wait for response\u2026';
            return;
        }
        if (isSpeaking) {
            stopSpeaking();
        }

        if (useWhisper) {
            startWhisperListening();
        } else if (speechSupported) {
            startBrowserListening();
        } else {
            micLabel.textContent = 'Voice not supported \u2014 use Type Instead';
        }
    }

    // ── Whisper-based recording with auto silence detection ──

    var SILENCE_THRESHOLD = 5;
    var SILENCE_DURATION_MS = 2000;
    var MIN_RECORD_MS = 1500;

    function pickMimeType() {
        var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
        for (var i = 0; i < types.length; i++) {
            if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(types[i])) {
                return types[i];
            }
        }
        return '';
    }

    function mimeToExt(mime) {
        if (mime.indexOf('mp4') !== -1) return 'mp4';
        if (mime.indexOf('ogg') !== -1) return 'ogg';
        return 'webm';
    }

    function startWhisperListening() {
        stopWhisperRecording();
        buildRecognition();
        recGenWhisper++;
        var myGen = recGenWhisper;
        audioChunks = [];

        micRing.classList.add('listening');
        micIcon.style.display = 'none';
        stopIcon.style.display = 'block';
        micLabel.textContent = 'Starting mic\u2026';
        statusText.textContent = 'Starting mic\u2026';

        var constraints = { audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } };

        navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
            if (myGen !== recGenWhisper) {
                stream.getTracks().forEach(function(t) { t.stop(); });
                return;
            }
            mediaStream = stream;

            var analyserReady = false;
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                if (audioCtx.state === 'suspended') {
                    audioCtx.resume().catch(function() {});
                }
                var source = audioCtx.createMediaStreamSource(stream);
                analyserNode = audioCtx.createAnalyser();
                analyserNode.fftSize = 256;
                analyserNode.smoothingTimeConstant = 0.5;
                source.connect(analyserNode);
                analyserReady = true;
            } catch (e) {
                analyserReady = false;
            }

            var mimeType = pickMimeType();
            var options = mimeType ? { mimeType: mimeType } : {};
            var actualMime = mimeType || 'audio/webm';
            var recorder = new MediaRecorder(stream, options);
            mediaRecorder = recorder;

            recorder.ondataavailable = function(e) {
                if (e.data && e.data.size > 0) audioChunks.push(e.data);
            };

            recorder.onstop = function() {
                if (myGen !== recGenWhisper) return;
                stopSilenceDetection();
                stream.getTracks().forEach(function(t) { t.stop(); });
                mediaStream = null;
                if (audioChunks.length === 0) {
                    resetMicUI();
                    micLabel.textContent = 'No audio \u2014 tap to try again';
                    return;
                }
                var blob = new Blob(audioChunks, { type: actualMime });
                audioChunks = [];
                sendToWhisper(blob, myGen, actualMime);
            };

            recorder.onerror = function() {
                if (myGen !== recGenWhisper) return;
                stopSilenceDetection();
                stream.getTracks().forEach(function(t) { t.stop(); });
                mediaStream = null;
                resetMicUI();
                micLabel.textContent = 'Recording error \u2014 tap to try again';
            };

            recorder.start(250);
            isListening = true;
            micLabel.textContent = 'Listening\u2026';
            statusText.textContent = 'Listening (' + langName(currentLang) + ')';

            var speechDetected = false;
            var silentSince = 0;
            var recordStart = Date.now();

            if (analyserReady && analyserNode) {
                var freqData = new Uint8Array(analyserNode.frequencyBinCount);
                silenceCheckInterval = setInterval(function() {
                    if (myGen !== recGenWhisper || !isListening) {
                        stopSilenceDetection();
                        return;
                    }

                    var elapsed = Date.now() - recordStart;
                    if (elapsed < MIN_RECORD_MS) return;

                    try {
                        analyserNode.getByteFrequencyData(freqData);
                    } catch (e) {
                        stopSilenceDetection();
                        return;
                    }
                    var sum = 0;
                    for (var i = 0; i < freqData.length; i++) sum += freqData[i];
                    var avg = sum / freqData.length;

                    if (avg > SILENCE_THRESHOLD) {
                        speechDetected = true;
                        silentSince = 0;
                    } else if (speechDetected) {
                        if (!silentSince) silentSince = Date.now();
                        if (Date.now() - silentSince >= SILENCE_DURATION_MS) {
                            finishWhisperRecording();
                        }
                    }
                }, 150);
            }

            maxListenTimer = setTimeout(function() {
                if (myGen !== recGenWhisper || !isListening) return;
                finishWhisperRecording();
            }, LISTEN_MAX_MS);

        }).catch(function(err) {
            if (myGen !== recGenWhisper) return;
            resetMicUI();
            if (err.name === 'NotAllowedError') {
                micLabel.textContent = 'Microphone access denied';
                statusText.textContent = 'Mic blocked \u2014 use Type Instead';
            } else {
                micLabel.textContent = 'Mic failed \u2014 tap to retry';
            }
        });
    }

    function finishWhisperRecording() {
        clearTimeout(maxListenTimer);
        stopSilenceDetection();
        isListening = false;
        micRing.classList.remove('listening');
        micIcon.style.display = 'block';
        stopIcon.style.display = 'none';
        micLabel.textContent = 'Processing\u2026';
        statusText.textContent = 'Transcribing\u2026';
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            try { mediaRecorder.requestData(); } catch (e) {}
            setTimeout(function() {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    try { mediaRecorder.stop(); } catch (e) {}
                }
            }, 100);
        } else {
            resetMicUI();
        }
    }

    function sendToWhisper(blob, gen, mime) {
        var ext = mimeToExt(mime || '');
        var filename = 'audio.' + ext;

        var formData = new FormData();
        formData.append('audio', blob, filename);
        formData.append('lang', currentLang);

        fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (gen !== recGenWhisper) return;
            var text = (data.text || '').trim();
            var hallucinations = /^(sous-?titr|subtitl|untertitel|音声|字幕|请订阅|ご視聴|MBC |SBS |KBS |www\.|http|Abone ol|Altyaz|Amara\.org|Merci d'avoir regard)/i;
            if (!text || text === '.' || text === '...' || text.length < 2 || hallucinations.test(text)) {
                resetMicUI();
                micLabel.textContent = 'Didn\u2019t catch that \u2014 tap to try again';
                return;
            }
            micLabel.textContent = text;
            resetMicUI();
            onUserSpeech(text);
        })
        .catch(function(err) {
            if (gen !== recGenWhisper) return;
            resetMicUI();
            micLabel.textContent = 'Error \u2014 tap to try again';
        });
    }

    // ── Browser SpeechRecognition (fallback only) ──

    function startBrowserListening() {
        buildRecognition();
        recGeneration++;
        var gen = recGeneration;

        micRing.classList.add('listening');
        micIcon.style.display = 'none';
        stopIcon.style.display = 'block';
        micLabel.textContent = 'Starting\u2026';
        statusText.textContent = 'Starting mic\u2026';

        var rec = new SpeechRecognition();
        rec.continuous = false;
        rec.interimResults = true;
        rec.lang = currentLang;
        rec.maxAlternatives = 1;
        recognition = rec;

        var speechHandled = false;

        rec.onstart = function() {
            if (gen !== recGeneration) return;
            isListening = true;
            micLabel.textContent = 'Listening\u2026';
            statusText.textContent = 'Listening (' + langName(currentLang) + ')';
        };

        rec.onresult = function(event) {
            if (gen !== recGeneration || speechHandled) return;
            var final = '';
            var interim = '';
            for (var i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    final += event.results[i][0].transcript;
                } else {
                    interim += event.results[i][0].transcript;
                }
            }

            if (final) {
                speechHandled = true;
                clearTimeout(silenceTimer);
                micLabel.textContent = final.trim();
                onUserSpeech(final.trim());
                try { rec.stop(); } catch (e) {}
                setTimeout(function() { if (gen === recGeneration) forceCleanup(); }, 500);
                return;
            }

            if (interim) {
                micLabel.textContent = interim;
                lastInterim = interim;
                clearTimeout(silenceTimer);
                silenceTimer = setTimeout(function() {
                    if (gen !== recGeneration || speechHandled || !lastInterim) return;
                    speechHandled = true;
                    var text = lastInterim.trim();
                    lastInterim = '';
                    if (text) onUserSpeech(text);
                    try { rec.stop(); } catch (e) {}
                    setTimeout(function() { if (gen === recGeneration) forceCleanup(); }, 500);
                }, 3500);
            }
        };

        rec.onerror = function(event) {
            if (gen !== recGeneration) return;
            clearTimeout(silenceTimer);
            resetMicUI();
            if (event.error === 'not-allowed') {
                micLabel.textContent = 'Microphone access denied';
            } else if (event.error !== 'aborted') {
                micLabel.textContent = 'Tap the microphone to speak';
            }
        };

        rec.onend = function() {
            if (gen !== recGeneration) return;
            clearTimeout(silenceTimer);
            if (lastInterim && !speechHandled) {
                speechHandled = true;
                var text = lastInterim.trim();
                lastInterim = '';
                if (text) onUserSpeech(text);
            }
            lastInterim = '';
            resetMicUI();
        };

        var startTimeout = setTimeout(function() {
            if (gen !== recGeneration) return;
            try { rec.abort(); } catch (e) {}
            forceCleanup();
            micLabel.textContent = 'Mic failed \u2014 tap to retry';
        }, 5000);
        rec.onstart = (function(origOnStart) {
            return function() {
                clearTimeout(startTimeout);
                if (gen !== recGeneration) return;
                isListening = true;
                micLabel.textContent = 'Listening\u2026';
                statusText.textContent = 'Listening (' + langName(currentLang) + ')';
            };
        })(rec.onstart);

        try { rec.start(); } catch (e) {
            clearTimeout(startTimeout);
            forceCleanup();
            micLabel.textContent = 'Mic failed \u2014 tap to retry';
        }
    }

    function resetMicUI() {
        isListening = false;
        micRing.classList.remove('listening');
        micIcon.style.display = 'block';
        stopIcon.style.display = 'none';
        if (!isSending) {
            micLabel.textContent = 'Tap the microphone to speak';
            statusText.textContent = 'Ready \u2014 ' + langName(currentLang);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  SPEECH CORRECTION (fixes common voice misrecognitions)
    // ═══════════════════════════════════════════════════════════════

    var SPEECH_FIXES = [
        [/\b(scan that|scan the|scandal|skander|a scanner|is kinder|his kinder|a skin there|skin there|scan there|es kinder|es canter|its kinder|it's kinder|iskander|ascender|a skin der|scanned|scant err|scanned her|slander)\b/gi, 'Iskender'],
        [/\b(a donna|a diner|add honor|a donner|madonna|a done a|add on a)\b/gi, 'Adana'],
        [/\b(bay tea|bay tee|bay T|bait E|beta|bay key|bait tea|bay D)\b/gi, 'Beyti'],
        [/\b(gone afa|gonna for|cool knife|could a fey|cornea fey|connect|could knife|kuhn affair)\b/gi, 'Kunefe'],
        [/\b(bakla wa|bock lava|bach lava|bach la va|buckle ava|block lava|balk lava)\b/gi, 'Baklava'],
        [/\b(eye ran|I ran|Iran|iron|i run|a run|i ron)\b/gi, 'Ayran'],
        [/\b(goz lemme|goes lemon|goose lemma|girls lemon)\b/gi, 'Gozleme'],
        [/\b(sah lep|saw lap|sell up|sa lap)\b/gi, 'Salep'],
        [/\b(la vash|love ash|lava sh)\b/gi, 'Lavash'],
        [/\b(man tea|mon tea|mount E)\b/gi, 'Manti'],
        [/\b(kofte|cough te|cough day|caught a)\b/gi, 'Kofte'],
        [/\b(doner|donor|don air)\b/gi, 'Doner'],
        [/\b(kebab|kebap|the Bob|cab Bob|cab up)\b/gi, 'Kebab'],
        [/\b(shish|she sh|sheesh)\b/gi, 'Shish'],
    ];

    function correctSpeech(text) {
        var corrected = text;
        SPEECH_FIXES.forEach(function(fix) {
            corrected = corrected.replace(fix[0], fix[1]);
        });
        return corrected;
    }

    // ═══════════════════════════════════════════════════════════════
    //  CHAT LOGIC
    // ═══════════════════════════════════════════════════════════════

    function onUserSpeech(text) {
        if (!text || isSending) return;
        var corrected = (currentLang.indexOf('en') === 0) ? correctSpeech(text) : text;
        history.push({ role: 'user', content: corrected });
        addTranscriptBubble('user', corrected);
        if (!textOverlay.classList.contains('text-chat-hidden')) {
            appendTextChatBubble('user', corrected);
        }
        fetchReply(corrected);
    }

    async function fetchReply(text) {
        isSending = true;
        micBtn.disabled = true;
        micLabel.textContent = 'Thinking\u2026';
        statusText.textContent = 'Preparing response\u2026';

        showTyping('transcript');
        if (!textOverlay.classList.contains('text-chat-hidden')) showTyping('textchat');

        var langHint = buildLangHint();
        var messageToSend = langHint ? (langHint + '\n' + text) : text;

        try {
            var resp = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: messageToSend, history: history.slice(0, -1), lang: currentLang }),
            });
            var data = await resp.json();
            clearTyping();

            var rawReply = data.reply || "Sorry, I couldn't process that.";
            var cleanReply = parseAndHandleCartTags(rawReply);

            history.push({ role: 'assistant', content: cleanReply });
            addTranscriptBubble('assistant', cleanReply);
            if (!textOverlay.classList.contains('text-chat-hidden')) {
                appendTextChatBubble('assistant', cleanReply);
            }

            speak(cleanReply, currentLang, data.ttsKey);
        } catch (e) {
            clearTyping();
            var err = "Sorry, something went wrong. Please try again.";
            addTranscriptBubble('assistant', err);
        }

        isSending = false;
        micBtn.disabled = false;
        micLabel.textContent = 'Tap the microphone to speak';
        if (!isSpeaking) statusText.textContent = 'Ready \u2014 ' + langName(currentLang);
    }

    function buildLangHint() {
        var name = langName(currentLang);
        if (currentLang.indexOf('en') === 0) {
            return '[IMPORTANT: The customer is speaking English. Reply in English.]';
        }
        return '[IMPORTANT: The customer is speaking ' + name + '. Reply 100% in ' + name + '. ZERO English words allowed — translate ALL menu names, ALL descriptions, ALL cooking terms, ALL adjectives into ' + name + '. Words like "special", "served", "grilled", "thinly sliced", "fresh", "homemade" MUST be in ' + name + ', never in English.]';
    }

    // ═══════════════════════════════════════════════════════════════
    //  TRANSCRIPT BUBBLES
    // ═══════════════════════════════════════════════════════════════

    function addTranscriptBubble(role, text) {
        var div = document.createElement('div');
        div.className = 'transcript-msg transcript-msg-' + role;

        var label = document.createElement('span');
        label.className = 'transcript-label';
        label.textContent = role === 'user' ? 'You' : 'MADO';

        var content = document.createElement('span');
        content.className = 'transcript-content';
        content.textContent = text;

        div.appendChild(label);
        div.appendChild(content);
        transcriptEl.appendChild(div);
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    // ═══════════════════════════════════════════════════════════════
    //  TYPING INDICATORS
    // ═══════════════════════════════════════════════════════════════

    function showTyping(target) {
        var dots = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
        if (target === 'transcript') {
            var d = document.createElement('div');
            d.className = 'transcript-msg transcript-msg-assistant transcript-typing';
            d.id = 'typing-transcript';
            d.innerHTML = '<span class="transcript-label">MADO</span><span class="transcript-content">' + dots + '</span>';
            transcriptEl.appendChild(d);
            transcriptEl.scrollTop = transcriptEl.scrollHeight;
        }
        if (target === 'textchat') {
            var t = document.createElement('div');
            t.className = 'chat-msg chat-msg-assistant chat-typing';
            t.id = 'typing-textchat';
            t.innerHTML = dots;
            textMessages.appendChild(t);
            textMessages.scrollTop = textMessages.scrollHeight;
        }
    }

    function clearTyping() {
        ['typing-transcript', 'typing-textchat'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  TEXT-TO-SPEECH  (single blessed Audio element for mobile)
    // ═══════════════════════════════════════════════════════════════

    function ensureAudioUnlocked() {
        if (ttsUnlocked) return;
        var silent = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
        silent.volume = 0;
        silent.play().then(function() {
            ttsUnlocked = true;
        }).catch(function() {});
    }

    function stopSpeaking() {
        ttsAudio.onended = null;
        ttsAudio.onerror = null;
        ttsAudio.pause();
        ttsAudio.removeAttribute('src');
        ttsAudio.load();
        if (ttsObjectUrl) {
            URL.revokeObjectURL(ttsObjectUrl);
            ttsObjectUrl = null;
        }
        if (synth) synth.cancel();
        isSpeaking = false;
        micRing.classList.remove('speaking');
    }

    function speak(text, lang, ttsKey) {
        if (!text) return;
        stopSpeaking();
        speakGen++;
        var myGen = speakGen;
        var targetLang = lang || currentLang;

        isSpeaking = true;
        micRing.classList.add('speaking');
        statusText.textContent = 'Speaking (' + langName(targetLang) + ')';

        fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, lang: targetLang, ttsKey: ttsKey || '' }),
        })
        .then(function(r) {
            if (!r.ok) throw new Error('TTS failed');
            return r.blob();
        })
        .then(function(blob) {
            if (myGen !== speakGen) return;
            if (ttsObjectUrl) URL.revokeObjectURL(ttsObjectUrl);
            ttsObjectUrl = URL.createObjectURL(blob);

            ttsAudio.onended = function() {
                ttsAudio.onerror = null;
                if (myGen === speakGen) {
                    isSpeaking = false;
                    micRing.classList.remove('speaking');
                    if (!isSending) statusText.textContent = 'Ready \u2014 ' + langName(currentLang);
                }
            };
            ttsAudio.onerror = function() {
                ttsAudio.onerror = null;
                if (myGen === speakGen) {
                    isSpeaking = false;
                    micRing.classList.remove('speaking');
                    if (!isSending) statusText.textContent = 'Ready \u2014 ' + langName(currentLang);
                }
            };
            ttsAudio.src = ttsObjectUrl;
            ttsAudio.play().catch(function() {
                ttsAudio.onerror = null;
                if (myGen === speakGen) {
                    isSpeaking = false;
                    micRing.classList.remove('speaking');
                    if (!isSending) statusText.textContent = 'Ready \u2014 ' + langName(currentLang);
                }
            });
        })
        .catch(function() {
            if (myGen === speakGen) {
                isSpeaking = false;
                micRing.classList.remove('speaking');
                if (!isSending) statusText.textContent = 'Ready \u2014 ' + langName(currentLang);
            }
        });
    }

    function browserSpeak(text, lang) {
        if (!ttsSupported || !text) {
            isSpeaking = false;
            micRing.classList.remove('speaking');
            return;
        }
        synth.cancel();
        var utt = new SpeechSynthesisUtterance(text);
        utt.lang = lang;
        utt.rate = 1;
        utt.pitch = 1;
        utt.onstart = function() {
            isSpeaking = true;
            micRing.classList.add('speaking');
            statusText.textContent = 'Speaking (' + langName(lang) + ')';
        };
        utt.onend = function() {
            isSpeaking = false;
            micRing.classList.remove('speaking');
            if (!isSending) statusText.textContent = 'Ready \u2014 ' + langName(currentLang);
        };
        utt.onerror = function() {
            isSpeaking = false;
            micRing.classList.remove('speaking');
        };
        synth.speak(utt);
    }

    function cacheVoices() {}
    function loadVoicesThen(cb) { setTimeout(cb, 300); }

    // ═══════════════════════════════════════════════════════════════
    //  TEXT CHAT  (Type Instead)
    // ═══════════════════════════════════════════════════════════════

    function openTextChat() {
        textOverlay.classList.remove('text-chat-hidden');
        rebuildTextChat();
        textInput.focus();
    }

    function closeTextChat() {
        textOverlay.classList.add('text-chat-hidden');
    }

    function rebuildTextChat() {
        textMessages.innerHTML = '';
        if (history.length === 0) {
            appendTextChatBubble('assistant', WELCOME);
        }
        history.forEach(function(m) {
            appendTextChatBubble(m.role, m.content);
        });
    }

    function appendTextChatBubble(role, text) {
        var div = document.createElement('div');
        div.className = 'chat-msg chat-msg-' + role;
        div.textContent = text;
        textMessages.appendChild(div);
        textMessages.scrollTop = textMessages.scrollHeight;
    }

    async function sendTextMessage() {
        var text = textInput.value.trim();
        if (!text || isSending) return;
        textInput.value = '';
        ensureAudioUnlocked();

        history.push({ role: 'user', content: text });
        addTranscriptBubble('user', text);
        appendTextChatBubble('user', text);

        isSending = true;
        micBtn.disabled = true;
        micLabel.textContent = 'Thinking\u2026';
        statusText.textContent = 'Preparing response\u2026';
        showTyping('transcript');
        showTyping('textchat');

        var langHint = buildLangHint();
        var messageToSend = langHint ? (langHint + '\n' + text) : text;

        try {
            var resp = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: messageToSend, history: history.slice(0, -1), lang: currentLang }),
            });
            var data = await resp.json();
            clearTyping();

            var rawReply = data.reply || "Sorry, I couldn't process that.";
            var cleanReply = parseAndHandleCartTags(rawReply);

            history.push({ role: 'assistant', content: cleanReply });
            addTranscriptBubble('assistant', cleanReply);
            appendTextChatBubble('assistant', cleanReply);
            speak(cleanReply, currentLang, data.ttsKey);
        } catch (e) {
            clearTyping();
            var err = "Sorry, something went wrong. Please try again.";
            addTranscriptBubble('assistant', err);
            appendTextChatBubble('assistant', err);
        }

        isSending = false;
        micBtn.disabled = false;
        micLabel.textContent = 'Tap the microphone to speak';
        if (!isSpeaking) statusText.textContent = 'Ready \u2014 ' + langName(currentLang);
        textInput.focus();
    }

    // ═══════════════════════════════════════════════════════════════
    //  MENU + CART INTEGRATION
    // ═══════════════════════════════════════════════════════════════

    function fetchMenu() {
        fetch('/api/menu')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                menuItems = [];
                (data.Foods || []).forEach(function(item) {
                    menuItems.push({ name: item.name, price: item.price, category: item.category, type: 'food' });
                });
                (data.Drinks || []).forEach(function(item) {
                    menuItems.push({ name: item.name, price: item.price, category: item.category, type: 'drink' });
                });
            })
            .catch(function() {});
    }

    function parseAndHandleCartTags(text) {
        var tagPattern = /\[ADD_TO_CART:\s*([^\]]+)\]/gi;
        var matches = [];
        var match;
        while ((match = tagPattern.exec(text)) !== null) {
            matches.push(match[1].trim());
        }

        var cleanText = text.replace(/\s*\[ADD_TO_CART:\s*[^\]]+\]\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim();

        matches.forEach(function(itemName) {
            addItemToCart(itemName);
        });

        return cleanText;
    }

    function addItemToCart(requestedName) {
        if (!requestedName || requestedName.toLowerCase() === 'none') return;
        var found = findMenuItem(requestedName);
        if (found && window.madoCart) {
            window.madoCart.add(found.name, found.price.toFixed(2), found.category);
            showToast('\u2705 ' + found.name + ' added to cart \u2014 $' + found.price.toFixed(2));
        }
    }

    function findMenuItem(name) {
        if (!menuItems.length) return null;
        var lower = name.toLowerCase().trim();

        for (var i = 0; i < menuItems.length; i++) {
            if (menuItems[i].name.toLowerCase() === lower) return menuItems[i];
        }

        var containsMatches = [];
        for (var j = 0; j < menuItems.length; j++) {
            var itemLower = menuItems[j].name.toLowerCase();
            if (itemLower.indexOf(lower) !== -1 || lower.indexOf(itemLower) !== -1) {
                containsMatches.push(menuItems[j]);
            }
        }
        if (containsMatches.length > 0) {
            containsMatches.sort(function(a, b) {
                return Math.abs(a.name.length - name.length) - Math.abs(b.name.length - name.length);
            });
            return containsMatches[0];
        }

        var bestScore = 0;
        var bestItem = null;
        var bestLen = Infinity;
        var nameWords = lower.split(/\s+/);
        for (var k = 0; k < menuItems.length; k++) {
            var kLower = menuItems[k].name.toLowerCase();
            var score = 0;
            nameWords.forEach(function(w) {
                if (w.length > 2 && kLower.indexOf(w) !== -1) score++;
            });
            if (score > bestScore || (score === bestScore && score > 0 && menuItems[k].name.length < bestLen)) {
                bestScore = score;
                bestItem = menuItems[k];
                bestLen = menuItems[k].name.length;
            }
        }
        if (bestScore > 0) return bestItem;

        return null;
    }

    function showToast(msg, isError) {
        var toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.className = 'toast show' + (isError ? ' toast-error' : '');
        setTimeout(function() { toast.className = 'toast'; }, 3500);
    }

    window.showToast = showToast;

    // ═══════════════════════════════════════════════════════════════
    //  BOOT
    // ═══════════════════════════════════════════════════════════════

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
