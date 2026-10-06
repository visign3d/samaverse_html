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
let selectedGridIndex = 0;

// Gamepad state
let gamepadLoopId = null;
let lastGamepadButtonState = {};
const GAMEPAD_STICK_DEADZONE = 0.15;
let isControllerActive = false;

window.addEventListener('mousemove', () => {
    if (isControllerActive) {
        isControllerActive = false;
        document.body.classList.remove('controller-active');
    }
});

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

function renderMarkdown(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';

    const lines = text.split(/\n/);
    let html = '';
    let paragraph = [];
    let listItems = [];

    const flushParagraph = () => {
        if (!paragraph.length) return;
        html += `<p>${paragraph.join('<br>')}</p>`;
        paragraph = [];
    };

    const flushList = () => {
        if (!listItems.length) return;
        html += `<ul>${listItems.map(item => `<li>${item}</li>`).join('')}</ul>`;
        listItems = [];
    };

    const renderInline = (segment) => {
        let output = escapeHtml(segment);
        output = output.replace(/`([^`]+)`/g, '<code>$1</code>');
        output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        output = output.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
        output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        return output;
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();

        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            flushParagraph();
            flushList();
            const level = headingMatch[1].length;
            html += `<h${level}>${renderInline(headingMatch[2])}</h${level}>`;
            continue;
        }

        if (/^[-*]\s+/.test(line)) {
            flushParagraph();
            listItems.push(renderInline(line.replace(/^[-*]\s+/, '')));
            continue;
        }

        if (!line) {
            flushParagraph();
            flushList();
            continue;
        }

        paragraph.push(renderInline(line));
    }

    flushParagraph();
    flushList();
    return html;
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
        renderUI();
        restoreSlideshowState();
        initPanHandlers();
        initGamepadSupport();

        // Initial grid selection - don't scroll on start
        updateGridFocusUI(false);
    } catch (err) { console.error(err); }
    finally {
        if (loading) loading.classList.add('hidden');
    }
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
        const mediaMarkup = isText
            ? `<div class="absolute inset-0 z-10 flex items-center justify-center p-6 bg-[#111111] text-left"><div class="relative z-30 w-full max-w-[90%] markdown-content font-light leading-[0.82] tracking-[-0.06em] text-white/95 text-2xl sm:text-3xl lg:text-4xl">${renderMarkdown(getArtworkTextContent(art))}</div></div>`
            : `<img src="${art.imageUrl}" class="w-full h-full object-cover grayscale-[0.2] group-hover:grayscale-0 transition-all duration-1000" loading="lazy">`;

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
            <img onclick="goToSlide(${idx})" id="thumb-${idx}" src="${art.imageUrl}"
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
    updateGridFocusUI();
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
        if (textNode) textNode.innerHTML = renderMarkdown(contentText);
    } else {
        textDisplay.classList.add('hidden');
        img.classList.remove('hidden');
        img.style.opacity = '0';
    }

    setTimeout(() => {
        if (isText) {
            if (textNode) textNode.innerHTML = renderMarkdown(contentText);
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

        if (isVisible) {
            // Slideshow Mode Controls
            handleGamepadButton(gp, 0, togglePlayPause); // A
            handleGamepadButton(gp, 1, () => { if (currentZoom > 1) resetZoom(); else closeSlideshow(); }); // B
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
                if (currentZoom > 1) {
                    const rsX = gp.axes[2];
                    const rsY = gp.axes[3];
                    if (Math.abs(rsX) > GAMEPAD_STICK_DEADZONE || Math.abs(rsY) > GAMEPAD_STICK_DEADZONE) {
                        translateX -= rsX * 20 * currentZoom;
                        translateY -= rsY * 20 * currentZoom;
                        applyZoom();
                    }
                }
            }
        } else {
            // Home Screen Mode Controls
            // A: Select card
            handleGamepadButton(gp, 0, () => {
                if (artworks.length > 0) openSlideshow(selectedGridIndex);
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

function setGridFocus(index) {
    if (isControllerActive) return;
    selectedGridIndex = index;
    updateGridFocusUI(false); // Don't scroll when hovering
}

function moveGridFocus(delta) {
    if (artworks.length === 0) return;
    selectedGridIndex = (selectedGridIndex + delta + artworks.length) % artworks.length;
    updateGridFocusUI();
}

function moveGridFocusVertical(delta) {
    if (artworks.length === 0) return;
    const cols = getGridColumns();
    let newIndex = selectedGridIndex + (delta * cols);
    if (newIndex >= 0 && newIndex < artworks.length) {
        selectedGridIndex = newIndex;
        updateGridFocusUI();
    }
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
    const active = document.getElementById(`grid-item-${selectedGridIndex}`);
    if (active) {
        active.classList.add('is-selected');
        if (shouldScroll) {
            active.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

init();

window.addEventListener('keydown', (e) => {
    const modal = document.getElementById('slideshowModal');
    if (!modal || modal.classList.contains('hidden')) {
        if (e.key === 'Enter' && artworks.length > 0) openSlideshow(selectedGridIndex);
        if (e.key === 'ArrowRight') moveGridFocus(1);
        if (e.key === 'ArrowLeft') moveGridFocus(-1);
        if (e.key === 'ArrowUp') moveGridFocusVertical(-1);
        if (e.key === 'ArrowDown') moveGridFocusVertical(1);
        return;
    }
    if (e.key === 'ArrowRight') nextSlide();
    if (e.key === 'ArrowLeft') prevSlide();
    if (e.key === 'Escape') closeSlideshow();
    if (e.key === ' ') { e.preventDefault(); togglePlayPause(); }
    if (e.key === '+') zoomIn();
    if (e.key === '-') zoomOut();
    if (e.key === '0') resetZoom();
    if (e.key.toLowerCase() === 'f') toggleFocusMode();
});
