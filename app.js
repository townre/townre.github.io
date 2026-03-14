// app.js - Main Application Logic

const AppState = {
    apiKey: localStorage.getItem('tts_apiKey') || '',
    region: localStorage.getItem('tts_region') || '',
    voice: localStorage.getItem('tts_voice') || '',
    theme: localStorage.getItem('tts_theme') || 'dark',
    progress: parseInt(localStorage.getItem('tts_progress')) || 0,
    sentences: [],
    paragraphData: [],
    isPlaying: false
};

const DOM = {
    // Header
    themeToggle: document.getElementById('theme-toggle'),
    fileUpload: document.getElementById('file-upload'),
    fileName: document.getElementById('file-name'),
    settingsBtn: document.getElementById('settings-btn'),
    // Main
    textContainer: document.getElementById('text-container'),
    // Modals & Toasts
    settingsModal: document.getElementById('settings-modal'),
    closeSettings: document.getElementById('close-settings'),
    saveSettings: document.getElementById('save-settings'),
    azureKey: document.getElementById('azure-key'),
    azureRegion: document.getElementById('azure-region'),
    toastContainer: document.getElementById('toast-container'),
    // Controller
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    btnPlayPause: document.getElementById('btn-play-pause'),
    btnFocus: document.getElementById('btn-focus'),
    voiceSelect: document.getElementById('voice-select')
};

function init() {
    applyTheme(AppState.theme);
    setupEventListeners();
    populateSettingsModal();
    
    // Check if we have previously loaded text in localStorage (for a real app, this might be too large, but for simple txt reading we can try)
    const savedText = localStorage.getItem('tts_current_text');
    if (savedText) {
        parseAndRenderText(savedText, true);
    }

    // Auto-fetch voices if credentials exist
    if (AppState.apiKey && AppState.region) {
        fetchVoices();
    }
}

function setupEventListeners() {
    // Theme
    DOM.themeToggle.addEventListener('click', () => {
        AppState.theme = AppState.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('tts_theme', AppState.theme);
        applyTheme(AppState.theme);
    });

    // File Upload
    DOM.fileUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        DOM.fileName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target.result;
            try {
                localStorage.setItem('tts_current_text', text); // Cache for refresh
            } catch (err) {
                console.warn("File too large to save to localStorage.");
            }
            AppState.progress = 0;
            localStorage.setItem('tts_progress', 0);
            parseAndRenderText(text);
        };
        reader.readAsText(file);
    });

    // Settings Modal
    DOM.settingsBtn.addEventListener('click', () => DOM.settingsModal.classList.remove('hidden'));
    DOM.closeSettings.addEventListener('click', () => DOM.settingsModal.classList.add('hidden'));
    DOM.settingsModal.addEventListener('click', (e) => {
        if (e.target === DOM.settingsModal) DOM.settingsModal.classList.add('hidden');
    });

    DOM.saveSettings.addEventListener('click', () => {
        AppState.apiKey = DOM.azureKey.value.trim();
        AppState.region = DOM.azureRegion.value.trim();
        localStorage.setItem('tts_apiKey', AppState.apiKey);
        localStorage.setItem('tts_region', AppState.region);
        
        DOM.settingsModal.classList.add('hidden');
        showToast('Settings saved successfully');
        
        fetchVoices();
    });
    
    // Controller Event Placeholders
    DOM.btnPlayPause.addEventListener('click', togglePlayPause);
    DOM.btnPrev.addEventListener('click', () => jumpSentence(-1));
    DOM.btnNext.addEventListener('click', () => jumpSentence(1));
    DOM.btnFocus.addEventListener('click', focusActiveSentence);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // Update Phospor icon
    const icon = DOM.themeToggle.querySelector('i');
    icon.className = theme === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    DOM.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function populateSettingsModal() {
    DOM.azureKey.value = AppState.apiKey;
    DOM.azureRegion.value = AppState.region;
}

// Basic Text parsing into sentences using Regex (Fallback if Intl.Segmenter is complex, but let's try a simple approach)
function parseAndRenderText(rawText, isRestore = false) {
    // Split by any sequence of newlines to identify paragraphs
    const paragraphs = rawText.split(/[\r\n]+/);
    
    AppState.sentences = [];
    AppState.paragraphData = [];
    
    // Simple sentence splitting by common punctuation.
    const splitRegex = /([.?!]+[\s]+)/g;
    
    paragraphs.forEach((paragraphText) => {
        if (!paragraphText.trim()) return;
        // Also replace single newlines inside paragraphs with spaces
        const textToParse = paragraphText.replace(/\n/g, ' ');
        const tokens = textToParse.split(splitRegex);
        let currentSentence = "";
        let sentenceCount = 0;
        
        // Reconstruct sentences with their punctuation
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].match(splitRegex)) {
                currentSentence += tokens[i];
                AppState.sentences.push(currentSentence.trim());
                sentenceCount++;
                currentSentence = "";
            } else {
                currentSentence += tokens[i];
            }
        }
        if (currentSentence.trim()) {
            AppState.sentences.push(currentSentence.trim());
            sentenceCount++;
        }
        
        if (sentenceCount > 0) {
            AppState.paragraphData.push(sentenceCount);
        }
    });

    renderSentences();
    
    if (isRestore) {
        DOM.fileName.textContent = "Restored from session";
    }
}

function renderSentences() {
    DOM.textContainer.innerHTML = '';
    
    if (AppState.sentences.length === 0) {
        DOM.textContainer.innerHTML = `
            <div class="empty-state">
                <i class="ph ph-warning-circle"></i>
                <p>Could not find readable text in the file.</p>
            </div>`;
        return;
    }

    let globalSentenceIndex = 0;

    AppState.paragraphData.forEach((sentenceCount) => {
        const p = document.createElement('p');
        p.className = 'paragraph';
        
        for (let i = 0; i < sentenceCount; i++) {
            const index = globalSentenceIndex++;
            const sentenceText = AppState.sentences[index];
            
            const span = document.createElement('span');
            span.className = `sentence ${index === AppState.progress ? 'active' : ''}`;
            span.textContent = sentenceText + ' ';
            span.dataset.index = index;
            
            span.addEventListener('click', () => {
                selectSentence(index);
            });

            p.appendChild(span);
        }
        
        DOM.textContainer.appendChild(p);
    });

    if (AppState.sentences.length > 0) {
        setTimeout(focusActiveSentence, 100); // Wait for DOM render
    }
}

function selectSentence(index) {
    if (index < 0 || index >= AppState.sentences.length) return;
    
    // Removing old active
    const oldActive = DOM.textContainer.querySelector(`.sentence[data-index="${AppState.progress}"]`);
    if (oldActive) oldActive.classList.remove('active');
    
    // Setting new active
    AppState.progress = index;
    localStorage.setItem('tts_progress', AppState.progress);
    
    const newActive = DOM.textContainer.querySelector(`.sentence[data-index="${AppState.progress}"]`);
    if (newActive) newActive.classList.add('active');
    
    focusActiveSentence();
    
    if (AppState.isPlaying) {
        playCurrentSentence();
    }
}

function jumpSentence(offset) {
    selectSentence(AppState.progress + offset);
}

function focusActiveSentence() {
    const active = DOM.textContainer.querySelector('.sentence.active');
    if (active) {
        active.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// Azure TTS logic
let currentAudio = new Audio();
let playGeneration = 0; // Async race condition guard

async function fetchVoices() {
    if (!AppState.apiKey || !AppState.region) return;

    try {
        const response = await fetch(`https://${AppState.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
            headers: {
                'Ocp-Apim-Subscription-Key': AppState.apiKey
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch voices');

        const voices = await response.json();
        
        // Populate Select
        DOM.voiceSelect.innerHTML = '';
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.ShortName;
            option.textContent = `${voice.DisplayName} (${voice.Locale})`;
            DOM.voiceSelect.appendChild(option);
        });

        // Set previous or default
        if (AppState.voice) {
            DOM.voiceSelect.value = AppState.voice;
        } else {
            AppState.voice = DOM.voiceSelect.value;
            localStorage.setItem('tts_voice', AppState.voice);
        }

        DOM.voiceSelect.addEventListener('change', (e) => {
            AppState.voice = e.target.value;
            localStorage.setItem('tts_voice', AppState.voice);
        });

    } catch (err) {
        console.error(err);
        showToast('Error loading voices. Check your settings.');
    }
}

async function playCurrentSentence() {
    playGeneration++;
    const currentGen = playGeneration;

    if (AppState.sentences.length === 0) return;
    if (!AppState.apiKey || !AppState.region || !AppState.voice) {
        showToast('Please configure Azure TTS Settings first.');
        AppState.isPlaying = false;
        updatePlayBtnUI();
        return;
    }

    currentAudio.pause();

    const textToRead = AppState.sentences[AppState.progress];
    if (!textToRead) return;

    // Skip sentences that contain no letters or numbers (like "......" or "    ")
    // \p{L} matches any kind of letter from any language. \p{N} matches any kind of numeric character in any script.
    if (!/\p{L}|\p{N}/u.test(textToRead)) {
        if (AppState.progress < AppState.sentences.length - 1) {
            setTimeout(() => jumpSentence(1), 50); // Visual delay before skipping
        } else {
            AppState.isPlaying = false;
            updatePlayBtnUI();
        }
        return;
    }

    updatePlayBtnUI(); // Ensure UI reflects loading/playing state immediately

    try {
        const ssml = `
            <speak version='1.0' xml:lang='en-US'>
                <voice xml:lang='en-US' xml:gender='Neural' name='${AppState.voice}'>
                    ${escapeXml(textToRead)}
                </voice>
            </speak>`;

        const response = await fetch(`https://${AppState.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': AppState.apiKey,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
                'User-Agent': 'TXT_TTS_Reader'
            },
            body: ssml
        });

        if (!response.ok) throw new Error('Failed to synthesize speech');
        
        // If a new sentence was requested while we were fetching this one, abort.
        if (currentGen !== playGeneration) return;

        const blob = await response.blob();
        
        // Revoke the old URL to prevent memory leaks if it exists
        if (currentAudio.src && currentAudio.src.startsWith('blob:')) {
            URL.revokeObjectURL(currentAudio.src);
        }
        
        const url = URL.createObjectURL(blob);
        
        // Use the existing audio element to satisfy Mobile Safari/Edge gesture constraints
        currentAudio.src = url;
        
        // Ensure event listener triggers for next play
        currentAudio.onended = () => {
            if (currentGen !== playGeneration) return; // Prevent old hooks from firing
            
            if (AppState.isPlaying) {
                if (AppState.progress < AppState.sentences.length - 1) {
                    jumpSentence(1);
                } else {
                    // Reached end
                    AppState.isPlaying = false;
                    updatePlayBtnUI();
                }
            }
        };

        // Fallback for some browsers that aggressively suspend audio
        currentAudio.removeEventListener('ended', currentAudio.onended);
        currentAudio.addEventListener('ended', currentAudio.onended);
        
        await currentAudio.play();
    } catch (err) {
        if (currentGen !== playGeneration) return;
        console.error(err);
        showToast('Playback failed. Check API key/region.');
        AppState.isPlaying = false;
        updatePlayBtnUI();
    }
}

function escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case "'": return '&apos;';
            case '"': return '&quot;';
        }
    });
}

function updatePlayBtnUI() {
    const playIcon = DOM.btnPlayPause.querySelector('i');
    if (AppState.isPlaying) {
        playIcon.className = 'ph ph-pause-circle';
    } else {
        playIcon.className = 'ph ph-play-circle';
    }
}

function togglePlayPause() {
    AppState.isPlaying = !AppState.isPlaying;
    updatePlayBtnUI();
    
    if (AppState.isPlaying) {
        playCurrentSentence();
    } else {
        currentAudio.pause();
    }
}

document.addEventListener('DOMContentLoaded', init);
