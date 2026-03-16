const AppState = {
    apiKey: localStorage.getItem('tts_apiKey') || '',
    region: localStorage.getItem('tts_region') || '',
    voice: localStorage.getItem('tts_voice') || '',
    speed: localStorage.getItem('tts_speed') || '1',
    maxChars: parseInt(localStorage.getItem('tts_maxChars')) || 200,
    theme: localStorage.getItem('tts_theme') || 'dark',
    pageMode: localStorage.getItem('tts_pageMode') === 'true',
    progress: parseInt(localStorage.getItem('tts_progress')) || 0,
    fontFamily: localStorage.getItem('tts_fontFamily') || "'Lora', Georgia, serif",
    currentFileName: localStorage.getItem('tts_current_filename') || '',
    sentences: [],
    paragraphData: [],
    chapters: [],     // array of { title, sentenceIndex }
    pages: [],        // array of arrays of sentence indices per page (page mode)
    currentPage: 0,   // which page is displayed in page mode
    isPlaying: false
};

// Per-file progress helpers — stores { reading: N, viewport: N } per filename
function getFileProgressMap() {
    try { return JSON.parse(localStorage.getItem('tts_fileProgress') || '{}'); }
    catch { return {}; }
}
function getFileProgress(filename) {
    const entry = getFileProgressMap()[filename];
    if (!entry) return { reading: 0, viewport: null };
    // Backward compat: old format was just a number
    if (typeof entry === 'number') return { reading: entry, viewport: null };
    return { reading: entry.reading ?? 0, viewport: entry.viewport ?? null };
}
function saveReadingProgress(filename, index) {
    const map = getFileProgressMap();
    const entry = typeof map[filename] === 'object' ? map[filename] : { reading: 0, viewport: null };
    map[filename] = { ...entry, reading: index };
    try { localStorage.setItem('tts_fileProgress', JSON.stringify(map)); } catch { }
}
function saveViewportProgress(filename, index) {
    const map = getFileProgressMap();
    const entry = typeof map[filename] === 'object' ? map[filename] : { reading: 0, viewport: null };
    map[filename] = { ...entry, viewport: index };
    try { localStorage.setItem('tts_fileProgress', JSON.stringify(map)); } catch { }
}

const DOM = {
    // Header
    themeToggle: document.getElementById('theme-toggle'),
    modeToggle: document.getElementById('mode-toggle'),
    tocToggle: document.getElementById('toc-toggle'),
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
    fontFamilySelect: document.getElementById('font-family'),
    azureKey: document.getElementById('azure-key'),
    azureRegion: document.getElementById('azure-region'),
    toastContainer: document.getElementById('toast-container'),
    // ToC Panel
    tocPanel: document.getElementById('toc-panel'),
    closeToc: document.getElementById('close-toc'),
    tocList: document.getElementById('toc-list'),
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
    applyFontFamily(AppState.fontFamily);
    applyPageMode(AppState.pageMode);
    await initDB();
    setupEventListeners();
    populateSettingsModal();

    // Check if we have previously loaded text in localStorage
    const savedText = localStorage.getItem('tts_current_text');
    if (savedText) {
        // Restore both pointers for the previously open file
        AppState.currentFileName = localStorage.getItem('tts_current_filename') || '';
        if (AppState.currentFileName) {
            const { reading, viewport } = getFileProgress(AppState.currentFileName);
            AppState.progress = reading;
            localStorage.setItem('tts_progress', reading);
            AppState._restoreViewport = viewport; // used once by restoreViewport() after render
        }
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

    // ToC Toggle
    DOM.tocToggle.addEventListener('click', () => {
        DOM.tocPanel.classList.toggle('open');
        if (DOM.tocPanel.classList.contains('open')) {
            syncTocActiveItem();
        }
    });
    DOM.closeToc.addEventListener('click', () => {
        DOM.tocPanel.classList.remove('open');
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
                localStorage.setItem('tts_current_filename', file.name);
            } catch (err) {
                console.warn("File too large to save to localStorage.");
            }
            // Restore per-file progress (reading + viewport), or start from 0 for a new file
            AppState.currentFileName = file.name;
            const { reading, viewport } = getFileProgress(file.name);
            AppState.progress = reading;
            localStorage.setItem('tts_progress', reading);
            AppState._restoreViewport = viewport;
            parseAndRenderText(text);
        };
        reader.readAsText(file);
    });

    // Media Session Handlers
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => {
            if (!AppState.isPlaying) togglePlayPause();
        });
        navigator.mediaSession.setActionHandler('pause', () => {
            if (AppState.isPlaying) togglePlayPause();
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => jumpSentence(-1));
        navigator.mediaSession.setActionHandler('nexttrack', () => jumpSentence(1));
    }

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
        AppState.fontFamily = DOM.fontFamilySelect.value;

        localStorage.setItem('tts_apiKey', AppState.apiKey);
        localStorage.setItem('tts_region', AppState.region);
        localStorage.setItem('tts_maxChars', AppState.maxChars);
        localStorage.setItem('tts_fontFamily', AppState.fontFamily);

        applyFontFamily(AppState.fontFamily);
        DOM.settingsModal.classList.add('hidden');
        showToast('Settings saved successfully');

        fetchVoices();

        // Reparse text with new limits or fonts
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

    // Mouse Wheel for Page Mode
    let wheelThrottleTimer = null;
    document.addEventListener('wheel', (e) => {
        if (!AppState.pageMode) return;
        if (DOM.settingsModal.classList.contains('hidden') === false) return;
        if (DOM.tocPanel.classList.contains('open')) return;

        if (wheelThrottleTimer) return;

        if (e.deltaY > 0) {
            turnPage(1);
        } else if (e.deltaY < 0) {
            turnPage(-1);
        }

        wheelThrottleTimer = setTimeout(() => {
            wheelThrottleTimer = null;
        }, 300);
    }, { passive: true });

    // Speed Selector
    DOM.speedSelect.value = AppState.speed;
    DOM.speedSelect.addEventListener('change', (e) => {
        AppState.speed = e.target.value;
        localStorage.setItem('tts_speed', AppState.speed);
    });

    // Viewport tracking: debounced scroll saves the first visible sentence index
    let scrollTimer = null;
    window.addEventListener('scroll', () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
            if (AppState.pageMode || !AppState.currentFileName) return;
            const idx = getFirstVisibleSentenceIndex();
            if (idx !== -1) saveViewportProgress(AppState.currentFileName, idx);
        }, 300);
    }, { passive: true });

    // Rebuild pages on resize so computeCharsPerPage() stays accurate
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (AppState.sentences.length === 0) return;
            const vp = AppState.currentFileName ? getFileProgress(AppState.currentFileName).viewport : null;
            buildPages();
            renderSentences(true);
            if (vp != null) restoreViewport(vp);
        }, 250);
    });
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // Update Phospor icon
    const icon = DOM.themeToggle.querySelector('i');
    icon.className = theme === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
}

function applyFontFamily(font) {
    document.documentElement.style.setProperty('--font-reading', font);
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

    // Capture current viewport sentence BEFORE switching modes so we can restore it after
    let viewportToRestore = null;
    if (AppState.sentences.length > 0) {
        if (isPageMode) {
            // Switching TO page mode: capture first visible sentence from scroll position
            viewportToRestore = getFirstVisibleSentenceIndex();
            if (viewportToRestore === -1) viewportToRestore = null;
        } else {
            // Switching TO scroll mode: use first sentence of current page
            viewportToRestore = AppState.pages[AppState.currentPage]?.[0] ?? null;
        }
        if (viewportToRestore != null && AppState.currentFileName) {
            saveViewportProgress(AppState.currentFileName, viewportToRestore);
        }
    }

    // Re-render content for the new mode (shows all sentences in scroll mode, or current page in page mode)
    if (AppState.sentences.length > 0) {
        renderSentences();
        if (viewportToRestore != null) restoreViewport(viewportToRestore);
    }
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
    DOM.fontFamilySelect.value = AppState.fontFamily;
    updateCacheSizeUI();
}

async function updateCacheSizeUI() {
    const size = await getCacheSize();
    if (DOM.cacheSizeSpan) {
        DOM.cacheSizeSpan.textContent = size;
    }
}
// Basic Text parsing into sentences using Regex and simple heuristics for Chapters
function parseAndRenderText(rawText, isRestore = false) {
    // Split by any sequence of newlines to identify paragraphs
    const paragraphs = rawText.split(/[\r\n]+/);

    AppState.sentences = [];
    AppState.paragraphData = [];
    AppState.chapters = [];

    // Simple sentence splitting by common punctuation.
    const splitRegex = /([.?!]+[\s]+)/g;

    // Chapter detection heuristics
    // English: "Chapter 1", "Part 1", "Prologue", "Epilogue" (case insensitive at start of line)
    // Chinese: "第一章", "第1回", "第十二节", "序" etc.
    // The line should be relatively short (e.g. < 50 chars) to avoid false positives.
    const chapterRegex = /^(?:chapter\s+\d+|part\s+\d+|prologue|epilogue|第[零一二三四五六七八九十百千万\d]+[章回节卷]|序章?)/i;

    let globalSentenceIndex = 0;

    paragraphs.forEach((paragraphText) => {
        let trimmedPara = paragraphText.trim();
        if (!trimmedPara) return;

        // Check if this paragraph is a chapter heading
        if (trimmedPara.length < 50 && chapterRegex.test(trimmedPara)) {
            AppState.chapters.push({
                title: trimmedPara,
                sentenceIndex: globalSentenceIndex
            });
        }

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
                    globalSentenceIndex++;
                    sentenceCount++;
                    groupedText = trimmed;
                    groupedSentenceCount = 1;
                }
            }
        }

        if (groupedText.trim()) {
            AppState.sentences.push(groupedText);
            globalSentenceIndex++;
            sentenceCount++;
        }

        if (sentenceCount > 0) {
            AppState.paragraphData.push(sentenceCount);
        }
    });

    buildTocUI();

    // Build pages FIRST so renderSentences has correct page data for the new file
    if (!isRestore) {
        AppState.currentPage = 0; // Don't carry over the old file's page position
    }
    buildPages();
    renderSentences();

    DOM.fileName.textContent = AppState.currentFileName;

    // After render, navigate to the viewport pointer only if it was explicitly saved
    if (AppState._restoreViewport != null) {
        restoreViewport(AppState._restoreViewport);
    }
    AppState._restoreViewport = undefined;
}

function buildTocUI() {
    DOM.tocList.innerHTML = '';

    if (AppState.chapters.length === 0) {
        DOM.tocList.innerHTML = '<div class="toc-empty">No chapters detected</div>';
        DOM.tocToggle.classList.add('hidden'); // Optional: hide toggle if no toc
        return;
    }
    DOM.tocToggle.classList.remove('hidden');

    AppState.chapters.forEach((chapter, i) => {
        const div = document.createElement('div');
        div.className = 'toc-item';
        div.textContent = chapter.title;
        div.dataset.index = chapter.sentenceIndex;
        div.addEventListener('click', () => {
            selectSentence(chapter.sentenceIndex);
            if (window.innerWidth <= 768) {
                DOM.tocPanel.classList.remove('open');
            }
        });
        DOM.tocList.appendChild(div);
    });
}

function syncTocActiveItem() {
    // Find the current chapter based on progress
    let activeChapterIdx = -1;
    for (let i = 0; i < AppState.chapters.length; i++) {
        if (AppState.progress >= AppState.chapters[i].sentenceIndex) {
            activeChapterIdx = i;
        } else {
            break;
        }
    }

    const items = DOM.tocList.querySelectorAll('.toc-item');
    items.forEach((item, i) => {
        if (i === activeChapterIdx) {
            item.classList.add('active');
            // Scroll into view within ToC panel
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            item.classList.remove('active');
        }
    });
}

function buildPages() {
    AppState.pages = [];
    if (AppState.sentences.length === 0) return;

    const header = document.querySelector('.app-header');
    const controller = document.querySelector('.bottom-controller');
    const availableH = window.innerHeight
        - (header?.offsetHeight || 64)
        - (controller?.offsetHeight || 80)
        - 80 // top + bottom padding of app-main
        - 40; // reserved space for .page-indicator

    // Probe div matching text-container layout exactly
    const probe = document.createElement('div');
    probe.style.cssText = [
        'position:absolute', 'top:-9999px', 'left:0',
        `width:${DOM.textContainer.offsetWidth || 752}px`,
        `font-family:${AppState.fontFamily}`,
        'font-size:20px', 'line-height:1.8',
        'visibility:hidden', 'pointer-events:none'
    ].join(';');
    document.body.appendChild(probe);

    // Know which sentence indices start a new paragraph
    const paragraphStarts = new Set();
    let s = 0;
    AppState.paragraphData.forEach(n => { paragraphStarts.add(s); s += n; });

    let page = [];
    let probeP = null;

    for (let idx = 0; idx < AppState.sentences.length; idx++) {
        // New paragraph boundary → start a new <p> in probe
        if (paragraphStarts.has(idx) || probeP === null) {
            probeP = document.createElement('p');
            probeP.style.marginBottom = '1.5em';
            probe.appendChild(probeP);
        }

        const span = document.createElement('span');
        span.textContent = AppState.sentences[idx] + ' ';
        probeP.appendChild(span);

        if (probe.offsetHeight > availableH && page.length > 0) {
            // This sentence overflowed → end current page, start next
            probeP.removeChild(span);
            AppState.pages.push([...page]);
            page = [idx];
            // Reset probe: new page starts with this sentence
            probe.innerHTML = '';
            probeP = document.createElement('p');
            probeP.style.marginBottom = '1.5em';
            probeP.appendChild(span);
            probe.appendChild(probeP);
        } else {
            page.push(idx);
        }
    }

    if (page.length > 0) AppState.pages.push(page);
    document.body.removeChild(probe);

    // Reset current page to the one that contains `progress`
    AppState.currentPage = findPageForSentence(AppState.progress);
}

function findPageForSentence(sentenceIndex) {
    for (let p = 0; p < AppState.pages.length; p++) {
        if (AppState.pages[p].includes(sentenceIndex)) return p;
    }
    return 0;
}

function renderSentences(skipSync = false) {
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

            // Add download button before the sentence
            const dlBtn = document.createElement('button');
            dlBtn.className = 'dl-sentence-audio';
            dlBtn.innerHTML = '<i class="ph ph-download-simple"></i>';
            dlBtn.title = 'Download audio';
            dlBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const text = AppState.sentences[index];
                const cacheKey = `${AppState.voice}_${AppState.speed}_${text}`;
                const blob = await getAudioFromCache(cacheKey);
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `sentence_${index + 1}.mp3`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 100);
                } else {
                    showToast('Audio not in cache. Play it first.');
                }
            });
            p.appendChild(dlBtn);

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
    // Save as the reading pointer in the per-file map
    if (AppState.currentFileName) {
        saveReadingProgress(AppState.currentFileName, index);
    }

    const newActive = DOM.textContainer.querySelector(`.sentence[data-index="${AppState.progress}"]`);
    if (newActive) newActive.classList.add('active');

    // In page mode, flip to the page containing the new sentence (no auto-scroll in scroll mode)
    if (AppState.pageMode) {
        const targetPage = findPageForSentence(index);
        if (targetPage !== AppState.currentPage) {
            AppState.currentPage = targetPage;
            renderSentences(true);
            DOM.appMain.scrollTo({ top: 0, behavior: 'auto' });
        }
    }

    // Sync ToC if open
    syncTocActiveItem();

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
    renderSentences(true); // skipSync so we don't snap back to active sentence's page
    // Scroll to top of the new page
    DOM.appMain.scrollTo({ top: 0, behavior: 'auto' });
    // Track the first sentence of the new page as the viewport pointer
    if (AppState.currentFileName) {
        const firstOnPage = AppState.pages[newPage]?.[0] ?? 0;
        saveViewportProgress(AppState.currentFileName, firstOnPage);
    }
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

// Returns the sentence index of the first sentence currently visible in the viewport (-1 if none)
function getFirstVisibleSentenceIndex() {
    const spans = DOM.textContainer.querySelectorAll('.sentence');
    for (const span of spans) {
        const rect = span.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < window.innerHeight) {
            return parseInt(span.dataset.index);
        }
    }
    return -1;
}

// Scrolls the view to the viewport pointer without changing the active (reading) sentence
function restoreViewport(viewportIndex) {
    if (AppState.pageMode) {
        // In page mode, navigate to the page that contains the viewport sentence
        const targetPage = findPageForSentence(viewportIndex);
        if (targetPage !== AppState.currentPage) {
            AppState.currentPage = targetPage;
            renderSentences(true);
        }
        DOM.appMain.scrollTo({ top: 0, behavior: 'auto' });
    } else {
        // In scroll mode, scroll the sentence element into view (top-aligned, instant)
        setTimeout(() => {
            const el = DOM.textContainer.querySelector(`.sentence[data-index="${viewportIndex}"]`);
            if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
        }, 150);
    }
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
let audioA = new Audio();
let audioB = new Audio();
let currentAudio = audioA;
let playGeneration = 0; // Async race condition guard

window.lastAudioEndedTime = 0; // DEBUG: Gap tracking
const audioMetadata = new Map(); // Cache for speech boundaries { duration, speechEnd }
let silenceCheckInterval = null;

// Detects the real speech end time in an audio blob by scanning samples from the end
async function detectAudioBoundary(blob, cacheKey) {
    if (audioMetadata.has(cacheKey)) return audioMetadata.get(cacheKey);

    try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        const data = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const threshold = 0.01; // Silence threshold

        let lastSpeakIndex = data.length - 1;
        // Scan backwards to find the last sample above threshold
        for (let i = data.length - 1; i >= 0; i--) {
            if (Math.abs(data[i]) > threshold) {
                lastSpeakIndex = i;
                break;
            }
        }

        const speechEnd = lastSpeakIndex / sampleRate;
        const meta = { duration: audioBuffer.duration, speechEnd: speechEnd };
        audioMetadata.set(cacheKey, meta);
        console.log(`[Audio Debug] Silence Detection: ${meta.duration.toFixed(2)}s total, speech ends at ${meta.speechEnd.toFixed(2)}s`);
        return meta;
    } catch (e) {
        console.warn("Silence detection failed", e);
        return null;
    }
}

// Add event listeners to both to handle continuous playback natively
function setupAudioEndedHook(audioElement) {
    audioElement.addEventListener('ended', () => {
        // Prevent old hooks or if we already jumped early
        if (audioElement.dataset.gen !== playGeneration.toString()) return;

        window.lastAudioEndedTime = performance.now(); // DEBUG: Mark end time
        triggerNextSentence();
    });
}

function triggerNextSentence() {
    if (silenceCheckInterval) {
        clearInterval(silenceCheckInterval);
        silenceCheckInterval = null;
    }

    if (currentAudio.src) {
        URL.revokeObjectURL(currentAudio.src);
        currentAudio.removeAttribute('src'); // Clean memory buffer when finished
        currentAudio.load(); // Force release file handle on mobile
    }

    if (AppState.isPlaying) {
        if (AppState.progress < AppState.sentences.length - 1) {
            jumpSentence(1);
        } else {
            AppState.isPlaying = false;
            updatePlayBtnUI();
        }
    }
}
setupAudioEndedHook(audioA);
setupAudioEndedHook(audioB);


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

    // Stop current audio before starting next (if skipping manually)
    currentAudio.pause();

    // Swap buffers to prevent gapless stuttering and "src changing while playing" mobile bugs
    currentAudio = currentAudio === audioA ? audioB : audioA;
    currentAudio.dataset.gen = currentGen.toString();

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

    updateMediaSessionMetadata();

    // Background preload the next two sentences
    preloadSentence(AppState.progress + 1);
    preloadSentence(AppState.progress + 2);

    // DEBUG: Gap Tracking Function
    const triggerAudioPlay = async (blob, cacheKey) => {
        try {
            // Start silence detection in background
            const metaPromise = detectAudioBoundary(blob, cacheKey);

            if (window.lastAudioEndedTime > 0) {
                const playCallGap = performance.now() - window.lastAudioEndedTime;
                console.log(`[Audio Gap Tracker] JS Execution Time (ended -> play() called): ${playCallGap.toFixed(2)}ms`);

                currentAudio.addEventListener('playing', async function _onPlaying() {
                    const actualPlayGap = performance.now() - window.lastAudioEndedTime;
                    console.log(`[Audio Gap Tracker] Total Real World Gap (ended -> browser actually outputting sound): ${actualPlayGap.toFixed(2)}ms`);
                    // Reset tracker
                    window.lastAudioEndedTime = 0;
                    currentAudio.removeEventListener('playing', _onPlaying);

                    // Once playing, wait for meta and start the early trigger loop
                    const meta = await metaPromise;
                    if (meta && meta.speechEnd < meta.duration - 0.1) {
                        /* DISABLED FOR TESTING: Programmatic "Cut"
                        if (silenceCheckInterval) clearInterval(silenceCheckInterval);
                        silenceCheckInterval = setInterval(() => {
                            // Trigger next sentence as soon as we hit the speechEnd boundary
                            if (currentAudio.currentTime >= meta.speechEnd) {
                                console.log(`[Audio Debug] Early Trigger: Silence start reached at ${currentAudio.currentTime.toFixed(2)}s`);
                                triggerNextSentence();
                            }
                        }, 50);
                        */
                    }
                });
            }
            await currentAudio.play();
        } catch (e) {
            console.error(e);
        }
    };

    if (cachedBlob) {
        if (currentGen !== playGeneration) return;
        console.log(`[Audio Debug] Playing from Cache: ${cacheKey.substring(0, 30)}...`);

        const url = URL.createObjectURL(cachedBlob);
        currentAudio.src = url;

        triggerAudioPlay(cachedBlob, cacheKey);
        return;
    }

    try {
        const ssml = `
            <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'>
                <voice name='${AppState.voice}'>
                    <mstts:silence  type='Sentenceboundary-exact' value='0ms'/>
                    <mstts:silence  type='Tailing-exact' value='0ms'/>
                    <mstts:silence  type='Leading-exact' value='0ms'/>
                    <prosody rate='${AppState.speed}'>
                        ${escapeXml(textToRead)}
                    </prosody>
                </voice>
            </speak>`;

        console.log(`[Audio Debug] Fetching from Azure. SSML:`, ssml);

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
        currentAudio.src = url;

        triggerAudioPlay(blob, cacheKey);
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
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    } else {
        playIcon.className = 'ph ph-play-circle';
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    }
}

let lastMediaTitle = '';
function updateMediaSessionMetadata() {
    if ('mediaSession' in navigator) {
        const textToRead = AppState.sentences[AppState.progress] || '';
        const title = textToRead.substring(0, 40) + (textToRead.length > 40 ? '...' : '');

        if (title === lastMediaTitle) return; // Prevent unnecessary updates
        lastMediaTitle = title;

        let chapterTitle = 'Unknown Chapter';
        for (let i = AppState.chapters.length - 1; i >= 0; i--) {
            if (AppState.chapters[i].sentenceIndex <= AppState.progress) {
                chapterTitle = AppState.chapters[i].title;
                break;
            }
        }

        // SVG artwork causes massive lag on Android System UI when updated frequently.
        // It's removed entirely to fix performance issues.
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artist: AppState.currentFileName || 'TXT Reader',
            album: chapterTitle
        });
    }
}

let audioUnlocked = false;

function togglePlayPause() {
    // Mobile browsers require a synchronous play() trigger by a user gesture to unlock audio
    if (!audioUnlocked) {
        audioUnlocked = true;
        currentAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        currentAudio.play().catch(() => { });
        currentAudio.pause();
    }

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
            <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'>
                <voice name='${AppState.voice}'>
                    <mstts:silence  type='Sentenceboundary-exact' value='0ms'/>
                    <mstts:silence  type='Tailing-exact' value='0ms'/>
                    <mstts:silence  type='Leading-exact' value='0ms'/>
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
