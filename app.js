const AppState = {
    apiKey: localStorage.getItem('tts_apiKey') || '',
    region: localStorage.getItem('tts_region') || '',
    voice: localStorage.getItem('tts_voice') || '',
    speed: localStorage.getItem('tts_speed') || '1',
    maxChars: parseInt(localStorage.getItem('tts_maxChars')) || 200,
    theme: localStorage.getItem('tts_theme') || 'dark',
    pageMode: localStorage.getItem('tts_pageMode') === 'true',
    progress: parseInt(localStorage.getItem('tts_progress')) || 0,
    sentences: [],
    paragraphData: [],
    pages: [],        // array of arrays of sentence indices per page (page mode)
    currentPage: 0,   // which page is displayed in page mode
    isPlaying: false
};

const DOM = {
    // Header
    themeToggle: document.getElementById('theme-toggle'),
    modeToggle: document.getElementById('mode-toggle'),
    fileUpload: document.getElementById('file-upload'),
    fileName: document.getElementById('file-name'),
    settingsBtn: document.getElementById('settings-btn'),
    // Main
    textContainer: document.getElementById('text-container'),
    appMain: document.querySelector('.app-main'),
    pageZoneLeft: document.getElementById('page-zone-left'),
    pageZoneRight: document.getElementById('page-zone-right'),
    // Modals & Toasts
    settingsModal: document.getElementById('settings-modal'),
    closeSettings: document.getElementById('close-settings'),
    saveSettings: document.getElementById('save-settings'),
    clearCacheBtn: document.getElementById('clear-cache-btn'),
    cacheSizeSpan: document.getElementById('cache-size'),
    maxChars: document.getElementById('max-chars'),
    azureKey: document.getElementById('azure-key'),
    azureRegion: document.getElementById('azure-region'),
    toastContainer: document.getElementById('toast-container'),
    // Controller
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    btnPlayPause: document.getElementById('btn-play-pause'),
    btnFocus: document.getElementById('btn-focus'),
    voiceSelect: document.getElementById('voice-select'),
    speedSelect: document.getElementById('speed-select')
};

async function init() {
    applyTheme(AppState.theme);
    applyPageMode(AppState.pageMode);
    await initDB();
    setupEventListeners();
    populateSettingsModal();
    
    // Check if we have previously loaded text in localStorage
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
    
    // Mode Toggle
    DOM.modeToggle.addEventListener('click', () => {
        AppState.pageMode = !AppState.pageMode;
        localStorage.setItem('tts_pageMode', AppState.pageMode);
        applyPageMode(AppState.pageMode);
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
        AppState.maxChars = parseInt(DOM.maxChars.value) || 200;
        
        localStorage.setItem('tts_apiKey', AppState.apiKey);
        localStorage.setItem('tts_region', AppState.region);
        localStorage.setItem('tts_maxChars', AppState.maxChars);
        
        DOM.settingsModal.classList.add('hidden');
        showToast('Settings saved successfully');
        
        fetchVoices();
        
        // Reparse text with new chunk limits
        const savedText = localStorage.getItem('tts_current_text');
        if (savedText) {
            parseAndRenderText(savedText, true);
        }
    });
    
    // Clear Cache
    DOM.clearCacheBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all downloaded audio?')) {
            await clearAudioCache();
            showToast('Audio cache cleared');
            updateCacheSizeUI();
        }
    });
    
    // Controller Event Placeholders
    DOM.btnPlayPause.addEventListener('click', togglePlayPause);
    DOM.btnPrev.addEventListener('click', () => jumpSentence(-1));
    DOM.btnNext.addEventListener('click', () => jumpSentence(1));
    DOM.btnFocus.addEventListener('click', syncViewToSentence);
    
    // Page Turning Zones
    DOM.pageZoneLeft.addEventListener('click', () => turnPage(-1));
    DOM.pageZoneRight.addEventListener('click', () => turnPage(1));
    
    // Global Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (DOM.settingsModal.classList.contains('hidden') === false) return;
        
        if (AppState.pageMode) {
            if (e.key === 'ArrowRight') turnPage(1);
            if (e.key === 'ArrowLeft') turnPage(-1);
        }
    });
    
    // Speed Selector
    DOM.speedSelect.value = AppState.speed;
    DOM.speedSelect.addEventListener('change', (e) => {
        AppState.speed = e.target.value;
        localStorage.setItem('tts_speed', AppState.speed);
    });
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // Update Phospor icon
    const icon = DOM.themeToggle.querySelector('i');
    icon.className = theme === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
}

function applyPageMode(isPageMode) {
    if (isPageMode) {
        document.body.classList.add('page-mode-active');
        DOM.modeToggle.querySelector('i').classList.replace('ph-book-open', 'ph-scroll');
        DOM.modeToggle.title = "Switch to Scroll Mode";
        DOM.pageZoneLeft.classList.remove('hidden');
        DOM.pageZoneRight.classList.remove('hidden');
    } else {
        document.body.classList.remove('page-mode-active');
        DOM.modeToggle.querySelector('i').classList.replace('ph-scroll', 'ph-book-open');
        DOM.modeToggle.title = "Switch to Page Mode";
        DOM.pageZoneLeft.classList.add('hidden');
        DOM.pageZoneRight.classList.add('hidden');
    }
    
    // Ensure we are snapping to the right place after reflow
    setTimeout(() => syncViewToSentence(), 50);
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
    DOM.maxChars.value = AppState.maxChars;
    updateCacheSizeUI();
}

async function updateCacheSizeUI() {
    const size = await getCacheSize();
    if (DOM.cacheSizeSpan) {
        DOM.cacheSizeSpan.textContent = size;
    }
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
        
        let groupedText = "";
        let groupedSentenceCount = 0;
        
        // Reconstruct sentences with their punctuation and group them
        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];
            let isSentenceEnd = token.match(splitRegex);
            currentSentence += token;
            
            if (isSentenceEnd || i === tokens.length - 1) {
                let trimmed = currentSentence.trim();
                currentSentence = "";
                
                if (!trimmed) continue;
                
                if (groupedText.length === 0) {
                    groupedText = trimmed;
                    groupedSentenceCount = 1;
                } else if (groupedSentenceCount < 2 && (groupedText.length + 1 + trimmed.length) <= AppState.maxChars) {
                    // Combine into at most 2 sentences if under char limit
                    groupedText += " " + trimmed;
                    groupedSentenceCount++;
                } else {
                    AppState.sentences.push(groupedText);
                    sentenceCount++;
                    groupedText = trimmed;
                    groupedSentenceCount = 1;
                }
            }
        }
        
        if (groupedText.trim()) {
            AppState.sentences.push(groupedText);
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
    
    buildPages();
}

// Build discrete pages for Page Mode by grouping sentences until a char threshold is hit
const CHARS_PER_PAGE = 1200;
function buildPages() {
    AppState.pages = [];
    let page = [];
    let charCount = 0;
    AppState.sentences.forEach((text, idx) => {
        if (charCount + text.length > CHARS_PER_PAGE && page.length > 0) {
            AppState.pages.push(page);
            page = [];
            charCount = 0;
        }
        page.push(idx);
        charCount += text.length;
    });
    if (page.length > 0) AppState.pages.push(page);
    
    // Reset current page to the one that contains `progress`
    AppState.currentPage = findPageForSentence(AppState.progress);
}

function findPageForSentence(sentenceIndex) {
    for (let p = 0; p < AppState.pages.length; p++) {
        if (AppState.pages[p].includes(sentenceIndex)) return p;
    }
    return 0;
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

    // Determine which sentence indices to show
    const visibleIndices = AppState.pageMode
        ? new Set(AppState.pages[AppState.currentPage] || [])
        : null; // null = show all

    let globalSentenceIndex = 0;

    AppState.paragraphData.forEach((sentenceCount) => {
        const p = document.createElement('p');
        p.className = 'paragraph';
        let hasVisible = false;
        
        for (let i = 0; i < sentenceCount; i++) {
            const index = globalSentenceIndex++;
            
            // In page mode, skip sentences not on this page
            if (visibleIndices && !visibleIndices.has(index)) continue;
            hasVisible = true;

            const sentenceText = AppState.sentences[index];
            const span = document.createElement('span');
            span.className = `sentence ${index === AppState.progress ? 'active' : ''}`;
            span.textContent = sentenceText + ' ';
            span.dataset.index = index;
            span.addEventListener('click', () => selectSentence(index));
            p.appendChild(span);
        }
        
        if (!visibleIndices || hasVisible) {
            DOM.textContainer.appendChild(p);
        }
    });
    
    // Update page indicator if in page mode
    if (AppState.pageMode) {
        updatePageIndicator();
    }

    if (AppState.sentences.length > 0) {
        setTimeout(syncViewToSentence, 100);
    }
}

function updatePageIndicator() {
    let indicator = document.getElementById('page-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'page-indicator';
        indicator.className = 'page-indicator';
        DOM.textContainer.appendChild(indicator);
    } else {
        DOM.textContainer.appendChild(indicator);
    }
    indicator.textContent = `${AppState.currentPage + 1} / ${AppState.pages.length}`;
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
    
    syncViewToSentence();
    
    if (AppState.isPlaying) {
        playCurrentSentence();
    }
}

function jumpSentence(offset) {
    selectSentence(AppState.progress + offset);
}

function turnPage(direction) {
    if (!AppState.pageMode) return;
    const newPage = AppState.currentPage + direction;
    if (newPage < 0 || newPage >= AppState.pages.length) return;
    AppState.currentPage = newPage;
    renderSentences();
    // Scroll to top of the new page
    DOM.appMain.scrollTo({ top: 0, behavior: 'auto' });
}

function syncViewToSentence() {
    if (!AppState.pageMode) {
        // Vanilla Scroll Mode
        const active = DOM.textContainer.querySelector('.sentence.active');
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    
    // Page Mode: find which page contains the active sentence and switch to it
    const targetPage = findPageForSentence(AppState.progress);
    if (targetPage !== AppState.currentPage) {
        AppState.currentPage = targetPage;
        renderSentences();
    }
    // Scroll to top of page
    DOM.appMain.scrollTo({ top: 0, behavior: 'auto' });
}

// IndexedDB Wrapper for Audio Cache
let db;
const DB_NAME = 'TTSAudioCache';
const STORE_NAME = 'audioBlobs';

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = (e) => {
            console.error("IndexedDB error", e);
            resolve(null); // fail gracefully
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            db.createObjectStore(STORE_NAME);
        };
    });
}

function saveAudioToCache(key, blob) {
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => updateCacheSizeUI();
}

function getAudioFromCache(key) {
    return new Promise((resolve) => {
        if (!db) return resolve(null);
        const tx = db.transaction(STORE_NAME, 'readonly');
        const getReq = tx.objectStore(STORE_NAME).get(key);
        getReq.onsuccess = (e) => resolve(e.target.result);
        getReq.onerror = () => resolve(null);
    });
}

function clearAudioCache() {
    return new Promise((resolve) => {
        if (!db) return resolve();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
    });
}

function getCacheSize() {
    return new Promise((resolve) => {
        if (!db) return resolve(0);
        const tx = db.transaction(STORE_NAME, 'readonly');
        const countReq = tx.objectStore(STORE_NAME).count();
        countReq.onsuccess = (e) => resolve(e.target.result);
        countReq.onerror = () => resolve(0);
    });
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
    
    // Check if we already synthesized this exact sentence with these settings in persistent Cache
    const cacheKey = `${AppState.voice}_${AppState.speed}_${textToRead}`;
    const cachedBlob = await getAudioFromCache(cacheKey);
    
    if (cachedBlob) {
        if (currentGen !== playGeneration) return;
        
        const url = URL.createObjectURL(cachedBlob);
        currentAudio.src = url;
        
        currentAudio.onended = () => {
            if (currentGen !== playGeneration) return; // Prevent old hooks
            
            URL.revokeObjectURL(url); // clean up memory after play
            
            if (AppState.isPlaying) {
                if (AppState.progress < AppState.sentences.length - 1) {
                    jumpSentence(1);
                } else {
                    AppState.isPlaying = false;
                    updatePlayBtnUI();
                }
            }
        };

        currentAudio.removeEventListener('ended', currentAudio.onended);
        currentAudio.addEventListener('ended', currentAudio.onended);
        
        try {
            await currentAudio.play();
        } catch (e) {
            console.error(e);
        }
        return;
    }

    // Background preload the next sentence
    preloadSentence(AppState.progress + 1);

    try {
        const ssml = `
            <speak version='1.0' xml:lang='en-US'>
                <voice xml:lang='en-US' xml:gender='Neural' name='${AppState.voice}'>
                    <prosody rate='${AppState.speed}'>
                        ${escapeXml(textToRead)}
                    </prosody>
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
        
        // Save the Blob permanently to IndexedDB
        saveAudioToCache(cacheKey, blob);
        
        const url = URL.createObjectURL(blob);
        
        // Use the existing audio element to satisfy Mobile Safari/Edge gesture constraints
        currentAudio.src = url;
        
        // Ensure event listener triggers for next play
        currentAudio.onended = () => {
            if (currentGen !== playGeneration) return; // Prevent old hooks from firing
            URL.revokeObjectURL(url); // Clean memory buffer when finished
            
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

async function preloadSentence(index) {
    if (index < 0 || index >= AppState.sentences.length) return;
    const textToRead = AppState.sentences[index];
    if (!textToRead || !/\p{L}|\p{N}/u.test(textToRead)) return;
    
    // Check if already in persistent Cache
    const cacheKey = `${AppState.voice}_${AppState.speed}_${textToRead}`;
    const cachedBlob = await getAudioFromCache(cacheKey);
    if (cachedBlob) return; 

    // Fetch and cache silently in background
    try {
        const ssml = `
            <speak version='1.0' xml:lang='en-US'>
                <voice xml:lang='en-US' xml:gender='Neural' name='${AppState.voice}'>
                    <prosody rate='${AppState.speed}'>
                        ${escapeXml(textToRead)}
                    </prosody>
                </voice>
            </speak>`;

        const response = await fetch(`https://${AppState.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': AppState.apiKey,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
                'User-Agent': 'TXT_TTS_Reader_Preloader'
            },
            body: ssml
        });

        if (response.ok) {
            const blob = await response.blob();
            saveAudioToCache(cacheKey, blob);
        }
    } catch (e) {
        console.warn("Preload failed", e);
    }
}

document.addEventListener('DOMContentLoaded', init);
