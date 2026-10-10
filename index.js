const SUPABASE_URL = 'https://jldabrktsutbeuxxyjjf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_prpooTOV73w8v6GM13bE2Q_yBI9cyw7';
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const SLIDESHOW_STATE_KEY = 'samaversum.slideshowState';

let artworks = [];
let descriptions = {};
let currentIndex = 0;
let isAutoplay = false;
let autoplayTimer = null;
let currentZoom = 1;
let isDragging = false;
let startX, startY;
let translateX = 0;
let translateY = 0;
const SLIDE_INTERVAL = 8000;

// Home screen selection state
// -1: Hero, -2: Randomize, -3: About, -4: Inquire, 0..N: Grid
let selectedGridIndex = -1;
let heroArtworkIndex = 0;

// Gamepad state
let gamepadLoopId = null;
let lastGamepadButtonState = {};
const GAMEPAD_STICK_DEADZONE = 0.15;
let isControllerActive = false;

// Longpress state
let bButtonPressStartTime = null;
const LONG_PRESS_DURATION = 800;

const restoreMouse = () => {
    if (isControllerActive) {
        isControllerActive = false;
        document.body.classList.remove('controller-active');
    }
};

window.addEventListener('mousemove', restoreMouse);
window.addEventListener('mousedown', restoreMouse);
window.addEventListener('wheel', restoreMouse, { passive: true });

function updateGamepadConnectionStatus() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let hasGamepad = false;
    for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) { hasGamepad = true; break; }
    }

    if (hasGamepad) {
        document.body.classList.add('gamepad-detected');
    } else {
        document.body.classList.remove('gamepad-detected');
        isControllerActive = false;
        document.body.classList.remove('controller-active');
    }
}

window.addEventListener("gamepadconnected", updateGamepadConnectionStatus);
window.addEventListener("gamepaddisconnected", updateGamepadConnectionStatus);

function saveSlideshowState() {
    const modal = document.getElementById('slideshowModal');
    const art = artworks[currentIndex];
    if (!modal || modal.classList.contains('hidden') || !art) return;

    try {
        sessionStorage.setItem(SLIDESHOW_STATE_KEY, JSON.stringify({
            artworkId: String(art.id ?? ''),
            index: currentIndex,
            isAutoplay
        }));
    } catch (err) { console.warn('Unable to save slideshow state:', err); }
}

function restoreSlideshowState() {
    let savedState;
    try {
        savedState = JSON.parse(sessionStorage.getItem(SLIDESHOW_STATE_KEY) || 'null');
    } catch (err) { return; }
    if (!savedState) return;

    const artworkIndex = artworks.findIndex(art => String(art.id ?? '') === String(savedState.artworkId ?? ''));
    const savedIndex = Number(savedState.index);
    const index = artworkIndex >= 0
        ? artworkIndex
        : Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < artworks.length ? savedIndex : 0;

    openSlideshow(index);
    if (savedState.isAutoplay === true) togglePlayPause();
}

function syncPlayStateUI() {
    const play = document.getElementById('playIcon');
    const pause = document.getElementById('pauseIcon');
    const txt = document.getElementById('playStateText');

    if (!play || !pause || !txt) return;

    if (isAutoplay) {
        play.classList.add('hidden');
        pause.classList.remove('hidden');
        txt.textContent = 'AUTOPLAY ON';
    } else {
        play.classList.remove('hidden');
        pause.classList.add('hidden');
        txt.textContent = 'AUTOPLAY OFF';
    }
}

function resolveArtworkImageUrl(value) {
    if (!value) return '';

    const raw = String(value).trim();
    if (!raw) return '';
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) return raw;

    const normalized = raw.replace(/^\/+/, '').replace(/\/+$/, '');
    const storagePath = normalized.startsWith('public/') ? normalized : `public/${normalized}`;

    if (!supabaseClient) return '';
    const { data } = supabaseClient.storage.from('images').getPublicUrl(storagePath);
    return data?.publicUrl || '';
}

function normalizeMediumValue(value) {
    return String(value ?? '').trim().toLowerCase();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatArtworkText(value) {
    const lines = String(value ?? '').split(/\r?\n/);
    const isAxisDiagram = /[│┼─↑↓←→]/.test(lines.join('\n'));

    if (isAxisDiagram) {
        const yAxisLineIndex = lines.findIndex(line => /^\s*y\s*$/i.test(line));
        const arrowLine = lines.find(line => /^\s*↑\s*$/.test(line));
        const verticalAxisLine = arrowLine || lines.find(line => /^\s*│\s*$/.test(line));
        const labelLineIndex = lines.findIndex(line => /ORGANIC.*[│|].*STRUCTURAL/i.test(line));
        const axisColumn = verticalAxisLine?.search(/\S/) ?? -1;

        if (axisColumn >= 0 && yAxisLineIndex >= 0) {
            lines[yAxisLineIndex] = `${' '.repeat(axisColumn)}y`;
        }

    }

    return lines.join('\n');
}

function getArtworkTextColumnCount(value) {
    return Math.max(1, ...formatArtworkText(value).split('\n').map(line => line.length));
}

function renderArtworkText(value) {
    return escapeHtml(formatArtworkText(value)).replace(/ /g, '&nbsp;');
}

function getFirstDefinedValue(row, keys) {
    if (!row || typeof row !== 'object') return '';

    for (const key of keys) {
        const value = row[key];
        if (value === undefined || value === null) continue;
        const text = String(value).trim();
        if (text) return value;
    }

    return '';
}

function getArtworkDetails(art) {
    if (!art) return null;
    const artId = String(art.id ?? art.artwork_id ?? '');
    if (!artId) return null;
    return descriptions[artId] || Object.values(descriptions).find(d => String(d.artwork_id ?? d.artworkId) === artId) || null;
}

function getArtworkMedium(art) {
    const detail = getArtworkDetails(art);
    return normalizeMediumValue(art?.medium ?? detail?.medium ?? art?.metadata?.medium ?? 'image');
}

function isTextArtwork(art) {
    return getArtworkMedium(art) === 'text';
}

function getArtworkTextContent(art) {
    const detail = getArtworkDetails(art);
    return String(
        detail?.description_text ||
        art?.text_art ||
        art?.textArt ||
        detail?.artwork_name ||
        art?.title ||
        'Untitled'
    );
}

function normalizeTagValue(rawValue) {
    if (rawValue === null || rawValue === undefined) return [];

    if (Array.isArray(rawValue)) {
        return rawValue.flatMap(item => normalizeTagValue(item));
    }

    if (typeof rawValue === 'object') {
        if (Array.isArray(rawValue.tags)) return rawValue.tags.flatMap(item => normalizeTagValue(item));
        if (Array.isArray(rawValue.tag_list)) return rawValue.tag_list.flatMap(item => normalizeTagValue(item));
        if (Array.isArray(rawValue.keywords)) return rawValue.keywords.flatMap(item => normalizeTagValue(item));
        if (Array.isArray(rawValue.metadata?.tags)) return rawValue.metadata.tags.flatMap(item => normalizeTagValue(item));
        if (typeof rawValue.value === 'string') return normalizeTagValue(rawValue.value);
        return [];
    }

    const text = String(rawValue).trim();
    if (!text) return [];

    return text
        .split(/[|,;\n]+/)
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => item.replace(/^['\"]|['\"]$/g, ''));
}

function getArtworkTags(art) {
    const detail = getArtworkDetails(art);
    const source = [art, detail, art?.metadata, detail?.metadata];
    const collected = [];

    source.forEach(item => {
        if (!item) return;

        const candidates = [
            item.tags,
            item.tag_list,
            item.keywords,
            item.tags_json,
            item.metadata?.tags,
            item.metadata?.tag_list,
            item.metadata?.keywords,
            item.description_tags,
            item.series_tags
        ];

        candidates.forEach(candidate => {
            collected.push(...normalizeTagValue(candidate));
        });
    });

    const deduped = [...new Set(collected.map(tag => tag.toLowerCase().replace(/\s+/g, '-')))].filter(Boolean);
    return deduped.length ? deduped : [
        String(art?.series || art?.category || art?.collection || 'samaversum').toLowerCase().replace(/\s+/g, '-'),
        'artwork',
        'archive'
    ];
}

function renderTagChips(tags) {
    const tagContainer = document.getElementById('proTags');
    if (!tagContainer) return;

    const safeTags = Array.isArray(tags) ? tags : [];
    if (!safeTags.length) {
        tagContainer.innerHTML = '<span class="text-xs text-gray-500 font-mono uppercase tracking-[0.2em]">No tags</span>';
        return;
    }

    tagContainer.innerHTML = safeTags
        .slice(0, 12)
        .map(tag => `<span class="inline-flex items-center rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-[10px] font-mono uppercase tracking-[0.2em] text-gray-300">${tag}</span>`)
        .join('');
}

async function init() {
    const loading = document.getElementById('loading');
    if (loading) loading.classList.remove('hidden');

    try {
        if (!supabaseClient) {
            console.error('Supabase client is unavailable.');
            return;
        }

        const { data: paintData, error: paintError } = await supabaseClient.from('artwork').select('*');
        if (paintError) console.warn('Unable to query artwork table:', paintError);

        const { data: descData, error: descError } = await supabaseClient.from('artwork_description').select('*');
        if (descError) console.warn('Unable to query artwork_description table:', descError);

        if (descData && descData.length) {
            descriptions = {};
            descData.forEach(d => {
                const key = String(d.artwork_id ?? d.artworkId ?? d.id ?? '');
                if (key) descriptions[key] = d;
            });
        }

        artworks = (paintData || [])
            .filter(row => row.is_published === true) // Filter out unpublished artworks in the public HTML gallery
            .map(row => {
                const artId = String(getFirstDefinedValue(row, ['id', 'artwork_id']) || '');
                const medium = normalizeMediumValue(getFirstDefinedValue(row, ['medium']) || 'image');
                const imageSource = getFirstDefinedValue(row, ['image_art_url', 'image_url', 'image_large', 'url', 'image', 'path', 'file_name']);
                const imageUrl = resolveArtworkImageUrl(imageSource);

                if (!imageUrl && medium !== 'text') {
                    return null;
                }

                return {
                    ...row,
                    id: artId,
                    title: getFirstDefinedValue(row, ['title', 'artwork_name']) || 'Untitled',
                    description: getFirstDefinedValue(row, ['description', 'description_text']) || '',
                    imageUrl,
                    artist: getFirstDefinedValue(row, ['artist']) || row?.artist || 'SAMACORP',
                    medium
                };
            })
            .filter(Boolean);

        if (!artworks.length) {
            console.warn('No artworks available from Supabase.');
            return;
        }

        artworks.sort(() => Math.random() - 0.5);
        renderFeaturedArtwork();
        renderUI();
        restoreSlideshowState();
        initPanHandlers();
        initGamepadSupport();
        updateGamepadConnectionStatus();

        if (window.location.hash === '#about') {
            showAbout();
        }

        // Initial grid selection - start with hero focused
        selectedGridIndex = -1;
        updateGridFocusUI(false);
    } catch (err) { console.error(err); }
    finally {
        if (loading) loading.classList.add('hidden');
    }
}

function randomizeArchive() {
    if (!artworks.length) return;
    // Fisher-Yates shuffle
    for (let i = artworks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [artworks[i], artworks[j]] = [artworks[j], artworks[i]];
    }

    // Smooth transition effect
    const grid = document.getElementById('galleryGrid');
    const hero = document.getElementById('featuredContainer');
    if (grid) grid.style.opacity = '0';
    if (hero) hero.style.opacity = '0';

    setTimeout(() => {
        renderFeaturedArtwork();
        renderUI();
        selectedGridIndex = -1; // Reset to hero
        updateGridFocusUI(false);
        if (grid) grid.style.opacity = '1';
        if (hero) hero.style.opacity = '1';
    }, 300);
}

function renderFeaturedArtwork() {
    const featuredSection = document.getElementById('featuredSection');
    const container = document.getElementById('featuredContainer');
    if (!featuredSection || !container || !artworks.length) return;

    const art = artworks[Math.floor(Math.random() * artworks.length)];
    const idx = artworks.indexOf(art);
    heroArtworkIndex = idx;

    const d = getArtworkDetails(art);
    const titleText = d?.artwork_name || art.title || 'Untitled';
    const artistText = d?.artist || art.artist || 'SAMACORP';
    const summaryText = d?.description_text || d?.description || art.description || '';
    const dateYear = d?.made_date ? new Date(d.made_date).getFullYear() : '';
    const materialText = d?.medium || art.medium || 'Theory';
    const isText = isTextArtwork(art);
    const artworkText = getArtworkTextContent(art);
    const previewMarkup = isText
        ? `<div class="artwork-text-frame relative flex flex-1 min-w-0 min-h-[32rem] items-center justify-center p-6 sm:p-10 bg-[#111111] text-left">
               <div class="relative z-10 w-full max-w-[90%] artwork-text-content text-white/95" style="--artwork-columns:${getArtworkTextColumnCount(artworkText)}">${renderArtworkText(artworkText)}</div>
           </div>`
        : `<div class="flex flex-1 min-w-0 min-h-[24rem] lg:min-h-[40rem] items-center justify-center bg-black/40 p-4 sm:p-8">
               <img src="${art.imageUrl}" alt="${escapeHtml(titleText)}" class="max-h-[40rem] max-w-full object-contain brightness-[0.7] group-hover:brightness-[0.9] transition-[filter] duration-700">
           </div>`;

    container.onclick = () => openSlideshow(idx);

    container.innerHTML = `
        ${previewMarkup}
        <div class="relative z-10 w-full lg:w-[28rem] shrink-0 p-8 sm:p-12 flex flex-col justify-center bg-gradient-to-br from-black/90 via-black/70 to-[#0a0a0a]">
            <span class="text-xs font-black text-accent-red tracking-[0.5em] uppercase mb-6 animate-pulse">${artistText}</span>
            <h2 class="text-5xl lg:text-7xl font-extralight text-white tracking-tighter mb-8 leading-[1.1]">${titleText}</h2>
            <p class="text-lg text-gray-300 font-light leading-relaxed italic mb-10 line-clamp-3">${escapeHtml(summaryText)}</p>
            <div class="flex items-center gap-8">
                <div class="text-[10px] font-mono text-gray-500 uppercase tracking-[0.3em]">${dateYear ? dateYear + ' / ' : ''}${materialText}</div>
                <div class="h-[1px] w-12 bg-white/20"></div>
                <div class="text-[9px] font-bold text-white tracking-[0.2em] uppercase opacity-0 group-hover:opacity-100 transition-opacity">Enter Archive &rarr;</div>
            </div>
        </div>
    `;

    featuredSection.classList.remove('hidden');
}

function renderUI() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;

    grid.innerHTML = artworks.map((art, idx) => {
        const d = getArtworkDetails(art);
        const dateYear = d?.made_date ? new Date(d.made_date).getFullYear() : '';
        const titleText = d?.artwork_name || art.title || 'Untitled';
        const artistText = d?.artist || art.artist || 'SAMACORP';
        const summaryText = d?.description_text || d?.description || art.description || '';
        const materialText = d?.medium || art.medium || 'Theory';
        const isText = isTextArtwork(art);
        const artworkText = getArtworkTextContent(art);
        const mediaMarkup = isText
            ? `<div class="artwork-text-frame absolute inset-0 z-10 flex items-center justify-center p-6 bg-[#111111] text-left"><div class="relative z-30 w-full max-w-[90%] artwork-text-content text-white/95" style="--artwork-columns:${getArtworkTextColumnCount(artworkText)}">${renderArtworkText(artworkText)}</div></div>`
            : `<img src="${art.imageUrl}" alt="${escapeHtml(titleText)}" class="w-full h-full object-cover grayscale-[0.2] group-hover:grayscale-0 transition-all duration-1000" loading="lazy">`;

        return `
        <div id="grid-item-${idx}"
             onmouseenter="setGridFocus(${idx})"
             onclick="openSlideshow(${idx})"
             class="artwork-grid-item group cursor-pointer relative aspect-[3/4] bg-[#0f0f0f] rounded-2xl overflow-hidden border border-white/5">
            ${mediaMarkup}
            <div class="absolute inset-0 z-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80 group-hover:opacity-40 transition-opacity"></div>
            <div class="absolute inset-x-0 bottom-0 p-8 flex flex-col justify-end translate-y-6 group-hover:translate-y-0 transition-transform duration-700">
                <span class="text-[9px] font-black text-accent-red tracking-[0.3em] uppercase mb-2">${artistText}</span>
                <h3 class="text-lg font-light text-white tracking-tighter mb-4">${titleText}</h3>
                <div class="opacity-0 group-hover:opacity-100 transition-opacity duration-700">
                    <p class="text-xs text-gray-500 font-light leading-relaxed line-clamp-2 italic mb-4">${escapeHtml(summaryText)}</p>
                    <div class="text-[9px] font-mono text-gray-600 uppercase tracking-widest">${dateYear ? dateYear + ' / ' : ''}${materialText}</div>
                </div>
            </div>
        </div>
    `;
    }).join('');

    const strip = document.getElementById('thumbStrip');
    if (!strip) return;

    strip.innerHTML = artworks.map((art, idx) => {
        if (isTextArtwork(art)) {
            return `
                <div onclick="goToSlide(${idx})" id="thumb-${idx}" class="thumb-item h-20 w-20 rounded-2xl cursor-pointer flex-shrink-0 border border-white/10 bg-[#101010] flex items-center justify-center p-2 text-center">
                    <span class="text-[9px] font-mono uppercase tracking-[0.2em] text-white/80 leading-tight">${escapeHtml((art.title || 'Text').slice(0, 12))}</span>
                </div>
            `;
        }

        return `
            <img onclick="goToSlide(${idx})" id="thumb-${idx}" src="${art.imageUrl}" alt="${escapeHtml(art.title || 'Artwork thumbnail')}"
                 class="thumb-item h-20 w-20 object-cover rounded-2xl cursor-pointer flex-shrink-0">
        `;
    }).join('');
}

function openSlideshow(index) {
    currentIndex = index;
    selectedGridIndex = index; // Sync
    resetZoom();
    updateSlideshow();
    const modal = document.getElementById('slideshowModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    syncPlayStateUI();
    saveSlideshowState();
}

function closeSlideshow() {
    const modal = document.getElementById('slideshowModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('is-zoomed');
        modal.classList.remove('is-focused');
    }
    document.body.style.overflow = '';
    isAutoplay = false;
    stopAutoplay();
    syncPlayStateUI();
    try { sessionStorage.removeItem(SLIDESHOW_STATE_KEY); } catch (err) { console.warn('Unable to clear slideshow state:', err); }
    if (document.fullscreenElement) {
        document.exitFullscreen?.();
    }
    resetZoom();
    updateGridFocusUI(false);
}

function toggleFullscreen() {
    const modal = document.getElementById('slideshowModal');
    if (!modal) return;

    if (!document.fullscreenElement) {
        modal.requestFullscreen?.().catch(() => {});
    } else {
        document.exitFullscreen?.();
    }
}

function toggleFocusMode() {
    const modal = document.getElementById('slideshowModal');
    if (!modal) return;
    modal.classList.toggle('is-focused');
    resetZoom();
}

function zoomIn() {
    currentZoom = Math.min(currentZoom + 0.5, 4);
    applyZoom();
}

function zoomOut() {
    currentZoom = Math.max(currentZoom - 0.5, 1);
    applyZoom();
}

function resetZoom() {
    currentZoom = 1;
    translateX = 0;
    translateY = 0;
    applyZoom();
}

function applyZoom() {
    const img = document.getElementById('slideshowImage');
    const modal = document.getElementById('slideshowModal');
    if (img && modal) {
        if (currentZoom > 1) {
            modal.classList.add('is-zoomed');
            img.style.cursor = 'grab';
            img.style.transition = isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.2, 1, 0.3, 1)';
        } else {
            modal.classList.remove('is-zoomed');
            img.style.cursor = 'default';
            translateX = 0;
            translateY = 0;
            img.style.transition = 'transform 0.5s cubic-bezier(0.2, 1, 0.3, 1)';
        }
        img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${currentZoom})`;
    }
}

function initPanHandlers() {
    const img = document.getElementById('slideshowImage');
    const container = document.querySelector('.slideshow-image-container');
    if (!img || !container) return;

    img.addEventListener('mousedown', (e) => {
        if (currentZoom <= 1) return;
        isDragging = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        img.style.cursor = 'grabbing';
        img.style.transition = 'none';
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        applyZoom();
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        if (img) {
            img.style.cursor = currentZoom > 1 ? 'grab' : 'default';
            img.style.transition = 'transform 0.3s cubic-bezier(0.2, 1, 0.3, 1)';
        }
    });

    container.addEventListener('wheel', (e) => {
        if (document.getElementById('slideshowText').classList.contains('hidden')) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.2 : 0.2;
            const newZoom = Math.min(Math.max(currentZoom + delta, 1), 4);
            if (newZoom !== currentZoom) {
                currentZoom = newZoom;
                applyZoom();
            }
        }
    }, { passive: false });
}

function updateSlideshow() {
    const art = artworks[currentIndex];
    const img = document.getElementById('slideshowImage');
    const textDisplay = document.getElementById('slideshowText');
    if (!art || !img || !textDisplay) return;
    saveSlideshowState();

    const artId = String(art.id ?? '');
    const d = getArtworkDetails(art);
    renderTagChips(getArtworkTags(art));

    resetZoom();
    const isText = isTextArtwork(art);
    const contentText = getArtworkTextContent(art);
    const textNode = textDisplay.querySelector('div');

    if (isText) {
        img.classList.add('hidden');
        img.style.opacity = '0';
        textDisplay.classList.remove('hidden');
        if (textNode) {
            textNode.style.setProperty('--artwork-columns', getArtworkTextColumnCount(contentText));
            textNode.innerHTML = renderArtworkText(contentText);
        }
    } else {
        textDisplay.classList.add('hidden');
        img.classList.remove('hidden');
        img.style.opacity = '0';
    }

    setTimeout(() => {
        if (isText) {
            if (textNode) {
                textNode.style.setProperty('--artwork-columns', getArtworkTextColumnCount(contentText));
                textNode.innerHTML = renderArtworkText(contentText);
            }
            document.getElementById('slideCounter').textContent = `${(currentIndex + 1).toString().padStart(2, '0')} / ${artworks.length.toString().padStart(2, '0')}`;
            document.getElementById('proTitle').textContent = d ? (d.artwork_name || art.title) : art.title;
            document.getElementById('proArtist').textContent = d ? (d.artist || 'Viktor Kadza Jr.') : 'Viktor Kadza Jr.';
            document.getElementById('proDate').textContent = d?.made_date ? new Date(d.made_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
            document.getElementById('proMedium').textContent = d ? (d.medium || 'Research Medium') : 'Research Medium';
            document.getElementById('proSurface').textContent = d ? (d.surface || 'Surface Theory') : 'Surface Theory';
            document.getElementById('proDimensions').textContent = d ? `${d.width_mm}w * ${d.height_mm}h mm` : 'Variable';
            document.getElementById('proId').textContent = artId.substring(0, 8).toUpperCase();
            document.getElementById('proDesc').textContent = d ? (d.description_text || art.description || 'Metadata pending archival verification.') : (art.description || 'Metadata pending archival verification.');
            document.querySelectorAll('.thumb-item').forEach(t => t.classList.remove('active'));
            const t = document.getElementById(`thumb-${currentIndex}`);
            if (t) { t.classList.add('active'); t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); }
            if (isAutoplay) resetProgressBar();
            return;
        }

        img.onerror = () => {
            img.style.opacity = '1';
            img.src = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="100%" height="100%" fill="#111"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="28" font-family="sans-serif">Image unavailable</text></svg>');
        };

        img.onload = () => { img.style.opacity = '1'; };
        img.src = art.imageUrl;
        img.alt = d ? (d.artwork_name || art.title) : (art.title || 'Artwork display');

        document.getElementById('slideCounter').textContent = `${(currentIndex + 1).toString().padStart(2, '0')} / ${artworks.length.toString().padStart(2, '0')}`;
        document.getElementById('proTitle').textContent = d ? (d.artwork_name || art.title) : art.title;
        document.getElementById('proArtist').textContent = d ? (d.artist || 'Viktor Kadza Jr.') : 'Viktor Kadza Jr.';
        document.getElementById('proDate').textContent = d?.made_date ? new Date(d.made_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
        document.getElementById('proMedium').textContent = d ? (d.medium || 'Research Medium') : 'Research Medium';
        document.getElementById('proSurface').textContent = d ? (d.surface || 'Surface Theory') : 'Surface Theory';
        document.getElementById('proDimensions').textContent = d ? `${d.width_mm}w * ${d.height_mm}h mm` : 'Variable';
        document.getElementById('proId').textContent = artId.substring(0, 8).toUpperCase();
        document.getElementById('proDesc').textContent = d ? (d.description_text || art.description || 'Metadata pending archival verification.') : (art.description || 'Metadata pending archival verification.');

        document.querySelectorAll('.thumb-item').forEach(t => t.classList.remove('active'));
        const t = document.getElementById(`thumb-${currentIndex}`);
        if (t) { t.classList.add('active'); t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); }

        if (isAutoplay) resetProgressBar();
    }, 400);
}

function togglePlayPause() {
    isAutoplay = !isAutoplay;
    syncPlayStateUI();
    if (isAutoplay) {
        startAutoplay();
    } else {
        stopAutoplay();
    }
    saveSlideshowState();
}

function startAutoplay() {
    stopAutoplay();
    resetProgressBar();
    autoplayTimer = setInterval(nextSlide, SLIDE_INTERVAL);
}

function stopAutoplay() {
    if (autoplayTimer) clearInterval(autoplayTimer);
    const bar = document.getElementById('progressBar');
    if (bar) bar.style.width = '0%';
}

function resetProgressBar() {
    const bar = document.getElementById('progressBar');
    if (!bar) return;
    bar.style.transition = 'none';
    bar.style.width = '0%';
    setTimeout(() => {
        bar.style.transition = `width ${SLIDE_INTERVAL}ms linear`;
        bar.style.width = '100%';
    }, 50);
}

function nextSlide() { currentIndex = (currentIndex + 1) % artworks.length; updateSlideshow(); }
function prevSlide() { currentIndex = (currentIndex - 1 + artworks.length) % artworks.length; updateSlideshow(); }
function goToSlide(idx) { currentIndex = idx; updateSlideshow(); }

function showAbout() {
    const modal = document.getElementById('aboutModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    if (window.location.hash !== '#about') {
        history.pushState(null, null, '#about');
    }
}

function closeAbout() {
    const modal = document.getElementById('aboutModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.style.overflow = '';
        if (window.location.hash === '#about') {
            history.pushState(null, null, ' ');
        }
    }
}

function showContact() { const modal = document.getElementById('contactModal'); if (!modal) return; modal.classList.remove('hidden'); modal.classList.add('flex'); }
function closeContact() { const modal = document.getElementById('contactModal'); if (modal) modal.classList.add('hidden'); }

async function sendEmail() {
    const name = document.getElementById('contactName')?.value.trim() || '';
    const email = document.getElementById('contactEmail')?.value.trim() || '';
    const message = document.getElementById('contactMessage')?.value.trim() || '';

    if (!name || !email || !message) return;

    const payload = {
        name,
        email,
        message,
        created_at: new Date().toISOString()
    };

    try {
        if (supabaseClient) {
            const { error } = await supabaseClient.from('messages').insert([payload]);
            if (error) throw error;
            closeContact();
            return;
        }
    } catch (err) {
        console.error('Failed to save inquiry to Supabase:', err);
    }

    const mailBody = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\n${message}`);
    window.location.href = `mailto:samaversum@gmail.com?subject=Inquiry&body=${mailBody}`;
    closeContact();
}

function toggleHeaderDescription() {
    const desc = document.getElementById('headerDescription');
    if (desc) {
        desc.classList.toggle('expanded');
    }
}

// Gamepad Implementation
function initGamepadSupport() {
    window.addEventListener("gamepadconnected", (e) => {
        console.log("Gamepad connected:", e.gamepad.id);
        if (!gamepadLoopId) gamepadLoop();
    });

    // Check if already connected
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (gamepads[0] && !gamepadLoopId) gamepadLoop();
}

function gamepadLoop() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[0];

    if (gp) {
        // Detect activity
        let hasActivity = false;
        for (let i = 0; i < gp.buttons.length; i++) {
            if (gp.buttons[i].pressed) { hasActivity = true; break; }
        }
        if (!hasActivity) {
            for (let i = 0; i < gp.axes.length; i++) {
                if (Math.abs(gp.axes[i]) > GAMEPAD_STICK_DEADZONE) { hasActivity = true; break; }
            }
        }

        if (hasActivity && !isControllerActive) {
            isControllerActive = true;
            document.body.classList.add('controller-active');
        }

        const modal = document.getElementById('slideshowModal');
        const isVisible = modal && !modal.classList.contains('hidden');
        const aboutModal = document.getElementById('aboutModal');
        const contactModal = document.getElementById('contactModal');

        // B Button Logic (Release / Short Press)
        const bButton = gp.buttons[1];
        const indicator = document.getElementById('longpressIndicator');
        const indicatorCircle = indicator ? indicator.querySelector('circle') : null;

        if (bButton.pressed) {
            if (bButtonPressStartTime === null) {
                bButtonPressStartTime = performance.now();
                if (indicator) indicator.style.display = 'block';
            }

            const elapsed = performance.now() - bButtonPressStartTime;
            const progress = Math.min((elapsed / LONG_PRESS_DURATION), 1);

            // Circumference is 126
            if (indicatorCircle) {
                indicatorCircle.style.strokeDashoffset = 126 - (progress * 126);
            }

            if (elapsed >= LONG_PRESS_DURATION && bButtonPressStartTime !== Infinity) {
                randomizeArchive();
                bButtonPressStartTime = Infinity; // Block until release
                if (indicator) indicator.style.display = 'none';
                if (indicatorCircle) indicatorCircle.style.strokeDashoffset = 126;
            }
        } else {
            if (bButtonPressStartTime !== null) {
                // If it wasn't a longpress, trigger normal B action
                if (bButtonPressStartTime !== Infinity && (performance.now() - bButtonPressStartTime < LONG_PRESS_DURATION)) {
                    // EXIT MODALS logic
                    if (aboutModal && !aboutModal.classList.contains('hidden')) {
                        closeAbout();
                    } else if (contactModal && !contactModal.classList.contains('hidden')) {
                        closeContact();
                    } else if (isVisible) {
                        if (currentZoom > 1) resetZoom(); else closeSlideshow();
                    } else {
                        // Home screen focus reset
                        if (selectedGridIndex !== -1) {
                            selectedGridIndex = -1;
                            updateGridFocusUI();
                        }
                    }
                }
                bButtonPressStartTime = null;
                if (indicator) indicator.style.display = 'none';
                if (indicatorCircle) indicatorCircle.style.strokeDashoffset = 126;
            }
        }

        // RS Vertical Axis Scrolling (Axis 3)
        const rsY = gp.axes[3];
        if (Math.abs(rsY) > GAMEPAD_STICK_DEADZONE) {
            const scrollAmount = rsY * 25; // Speed multiplier
            const proMetaPanel = document.getElementById('proMetaPanel');

            if (aboutModal && !aboutModal.classList.contains('hidden')) {
                aboutModal.scrollBy(0, scrollAmount);
            } else if (isVisible && proMetaPanel) {
                proMetaPanel.scrollBy(0, scrollAmount);
            } else if (!isVisible) {
                window.scrollBy(0, scrollAmount);
            }
        }

        if (isVisible) {
            // Slideshow Mode Controls
            handleGamepadButton(gp, 0, togglePlayPause); // A
            // handleGamepadButton(gp, 1, ...); // Handled above for longpress
            handleGamepadButton(gp, 2, toggleFocusMode); // X
            handleGamepadButton(gp, 3, toggleFullscreen); // Y
            handleGamepadButton(gp, 4, prevSlide); // LB
            handleGamepadButton(gp, 5, nextSlide); // RB
            handleGamepadButton(gp, 14, prevSlide); // D-Pad Left
            handleGamepadButton(gp, 15, nextSlide); // D-Pad Right
            handleGamepadButton(gp, 12, zoomIn);    // D-Pad Up
            handleGamepadButton(gp, 13, zoomOut);   // D-Pad Down

            const lsX = gp.axes[0];
            if (lsX < -0.6) handleGamepadButton({index: gp.index, buttons: [{pressed: true}]}, 'LS_LEFT', prevSlide);
            else if (lsX > 0.6) handleGamepadButton({index: gp.index, buttons: [{pressed: true}]}, 'LS_RIGHT', nextSlide);
            else {
                lastGamepadButtonState[gp.index + '_LS_LEFT'] = false;
                lastGamepadButtonState[gp.index + '_LS_RIGHT'] = false;
            }

            if (document.getElementById('slideshowText').classList.contains('hidden')) {
                const lt = gp.buttons[6].value;
                const rt = gp.buttons[7].value;
                if (rt > 0.1) { currentZoom = Math.min(currentZoom + rt * 0.05, 4); applyZoom(); }
                if (lt > 0.1) { currentZoom = Math.max(currentZoom - lt * 0.05, 1); applyZoom(); }

                // Pan with Right Stick (Axes 2 & 3)
                if (currentZoom > 1) {
                    const rsX_pan = gp.axes[2];
                    const rsY_pan = gp.axes[3];
                    if (Math.abs(rsX_pan) > GAMEPAD_STICK_DEADZONE || Math.abs(rsY_pan) > GAMEPAD_STICK_DEADZONE) {
                        translateX -= rsX_pan * 20 * currentZoom;
                        translateY -= rsY_pan * 20 * currentZoom;
                        applyZoom();
                    }
                }
            }
        } else {
            // Home Screen Mode Controls
            // A: Select card
            handleGamepadButton(gp, 0, () => {
                if (artworks.length > 0) {
                    if (selectedGridIndex === -1) openSlideshow(heroArtworkIndex);
                    else if (selectedGridIndex === -2) randomizeArchive();
                    else if (selectedGridIndex === -3) showAbout();
                    else if (selectedGridIndex === -4) showContact();
                    else openSlideshow(selectedGridIndex);
                }
            });

            // LB / RB: Navigation
            handleGamepadButton(gp, 4, () => moveGridFocus(-1)); // LB
            handleGamepadButton(gp, 5, () => moveGridFocus(1));  // RB

            // D-Pad navigation
            handleGamepadButton(gp, 14, () => moveGridFocus(-1)); // Left
            handleGamepadButton(gp, 15, () => moveGridFocus(1));  // Right
            handleGamepadButton(gp, 12, () => moveGridFocusVertical(-1)); // Up
            handleGamepadButton(gp, 13, () => moveGridFocusVertical(1));  // Down

            const lsX = gp.axes[0];
            const lsY = gp.axes[1];

            if (lsX < -0.6) handleGamepadButton({index: gp.index, buttons: [{pressed: true}]}, 'GRID_LS_LEFT', () => moveGridFocus(-1));
            else if (lsX > 0.6) handleGamepadButton({index: gp.index, buttons: [{pressed: true}]}, 'GRID_LS_RIGHT', () => moveGridFocus(1));
            else {
                lastGamepadButtonState[gp.index + '_GRID_LS_LEFT'] = false;
                lastGamepadButtonState[gp.index + '_GRID_LS_RIGHT'] = false;
            }

            if (lsY < -0.6) handleGamepadButton({index: gp.index, buttons: [{pressed: true}]}, 'GRID_LS_UP', () => moveGridFocusVertical(-1));
            else if (lsY > 0.6) handleGamepadButton({index: gp.index, buttons: [{pressed: true}]}, 'GRID_LS_DOWN', () => moveGridFocusVertical(1));
            else {
                lastGamepadButtonState[gp.index + '_GRID_LS_UP'] = false;
                lastGamepadButtonState[gp.index + '_GRID_LS_DOWN'] = false;
            }
        }
    }

    gamepadLoopId = requestAnimationFrame(gamepadLoop);
}

function handleGamepadButton(gp, index, callback) {
    const isPressed = typeof index === 'string' ? true : (gp.buttons[index] && gp.buttons[index].pressed);
    const stateKey = gp.index + '_' + index;
    if (isPressed) {
        if (!lastGamepadButtonState[stateKey]) {
            callback();
            lastGamepadButtonState[stateKey] = true;
        }
    } else {
        lastGamepadButtonState[stateKey] = false;
    }
}

function setHeroFocus() {
    if (isControllerActive) return;
    selectedGridIndex = -1;
    updateGridFocusUI(false);
}

function setNavFocus(index) {
    if (isControllerActive) return;
    selectedGridIndex = index;
    updateGridFocusUI(false);
}

function setGridFocus(index) {
    if (isControllerActive) return;
    selectedGridIndex = index;
    updateGridFocusUI(false); // Don't scroll when hovering
}

function moveGridFocus(delta) {
    if (artworks.length === 0) return;

    if (selectedGridIndex === -2 || selectedGridIndex === -3 || selectedGridIndex === -4) {
        // Navigating header buttons horizontally
        if (delta > 0) {
            if (selectedGridIndex === -2) selectedGridIndex = -3;
            else if (selectedGridIndex === -3) selectedGridIndex = -4;
            else if (selectedGridIndex === -4) selectedGridIndex = -2;
        } else {
            if (selectedGridIndex === -2) selectedGridIndex = -4;
            else if (selectedGridIndex === -4) selectedGridIndex = -3;
            else if (selectedGridIndex === -3) selectedGridIndex = -2;
        }
    } else if (selectedGridIndex === -1) {
        if (delta > 0) selectedGridIndex = 0;
        else selectedGridIndex = artworks.length - 1;
    } else {
        selectedGridIndex = (selectedGridIndex + delta + artworks.length) % artworks.length;
        // Wrapping from last back to hero?
        if (delta > 0 && selectedGridIndex === 0) selectedGridIndex = -1;
        else if (delta < 0 && selectedGridIndex === artworks.length - 1) selectedGridIndex = -1;
    }
    updateGridFocusUI();
}

function moveGridFocusVertical(delta) {
    if (artworks.length === 0) return;
    const cols = getGridColumns();

    if (selectedGridIndex === -2 || selectedGridIndex === -3 || selectedGridIndex === -4) {
        // Down from nav goes to Hero
        if (delta > 0) selectedGridIndex = -1;
    } else if (selectedGridIndex === -1) {
        if (delta > 0) selectedGridIndex = 0;
        else selectedGridIndex = -2; // Up from Hero goes to Nav
    } else {
        let newIndex = selectedGridIndex + (delta * cols);
        if (newIndex < 0) {
            selectedGridIndex = -1; // Go to hero
        } else if (newIndex < artworks.length) {
            selectedGridIndex = newIndex;
        }
    }
    updateGridFocusUI();
}

function getGridColumns() {
    const grid = document.getElementById('galleryGrid');
    if (!grid || artworks.length < 2) return 1;
    const items = document.querySelectorAll('.artwork-grid-item');
    if (items.length < 2) return 1;

    let cols = 0;
    const firstTop = items[0].offsetTop;
    for (let i = 0; i < items.length; i++) {
        if (Math.abs(items[i].offsetTop - firstTop) < 5) cols++;
        else break;
    }
    return cols || 1;
}

function updateGridFocusUI(shouldScroll = true) {
    document.querySelectorAll('.artwork-grid-item').forEach(el => el.classList.remove('is-selected'));

    const hero = document.getElementById('featuredContainer');
    const randomizeBtn = document.getElementById('randomizeBtn');
    const aboutBtn = document.getElementById('aboutBtn');
    const contactBtn = document.getElementById('contactBtn');

    if (hero) hero.classList.remove('is-selected');
    if (randomizeBtn) randomizeBtn.classList.remove('nav-btn-focus');
    if (aboutBtn) aboutBtn.classList.remove('nav-btn-focus');
    if (contactBtn) contactBtn.classList.remove('nav-btn-focus');

    if (selectedGridIndex === -1) {
        if (hero) {
            hero.classList.add('is-selected');
            if (shouldScroll) hero.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    } else if (selectedGridIndex === -2) {
        if (randomizeBtn) randomizeBtn.classList.add('nav-btn-focus');
    } else if (selectedGridIndex === -3) {
        if (aboutBtn) aboutBtn.classList.add('nav-btn-focus');
    } else if (selectedGridIndex === -4) {
        if (contactBtn) contactBtn.classList.add('nav-btn-focus');
    } else {
        const active = document.getElementById(`grid-item-${selectedGridIndex}`);
        if (active) {
            active.classList.add('is-selected');
            if (shouldScroll) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

init();

window.addEventListener('keydown', (e) => {
    const modal = document.getElementById('slideshowModal');
    const aboutModal = document.getElementById('aboutModal');
    const contactModal = document.getElementById('contactModal');

    if (e.key === 'Escape') {
        if (modal && !modal.classList.contains('hidden')) closeSlideshow();
        if (aboutModal && !aboutModal.classList.contains('hidden')) closeAbout();
        if (contactModal && !contactModal.classList.contains('hidden')) closeContact();
        return;
    }

    if (!modal || modal.classList.contains('hidden')) {
        if (e.key.toLowerCase() === 'r') randomizeArchive();
        if (e.key === 'Enter' && artworks.length > 0) {
            if (selectedGridIndex === -1) openSlideshow(heroArtworkIndex);
            else if (selectedGridIndex === -2) randomizeArchive();
            else if (selectedGridIndex === -3) showAbout();
            else if (selectedGridIndex === -4) showContact();
            else openSlideshow(selectedGridIndex);
        }
        if (e.key === 'ArrowRight') moveGridFocus(1);
        if (e.key === 'ArrowLeft') moveGridFocus(-1);
        if (e.key === 'ArrowUp') moveGridFocusVertical(-1);
        if (e.key === 'ArrowDown') moveGridFocusVertical(1);
        return;
    }
    if (e.key === 'ArrowRight') nextSlide();
    if (e.key === 'ArrowLeft') prevSlide();
    if (e.key === ' ') { e.preventDefault(); togglePlayPause(); }
    if (e.key === '+') zoomIn();
    if (e.key === '-') zoomOut();
    if (e.key === '0') resetZoom();
    if (e.key.toLowerCase() === 'f') toggleFocusMode();
});
