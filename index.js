const SUPABASE_URL = 'https://jldabrktsutbeuxxyjjf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_prpooTOV73w8v6GM13bE2Q_yBI9cyw7';
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const SLIDESHOW_STATE_KEY = 'samaversum.slideshowState';

let artworks = [];
let descriptions = {};
let currentIndex = 0;
let isAutoplay = false;
let autoplayTimer = null;
const SLIDE_INTERVAL = 8000;

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

function getArtworkDetails(art) {
    if (!art) return null;
    const artId = String(art.id ?? art.artwork_id ?? '');
    if (!artId) return null;
    return descriptions[artId] || Object.values(descriptions).find(d => String(d.artwork_id ?? d.artworkId) === artId) || null;
}

async function init() {
    const loading = document.getElementById('loading');
    if (loading) loading.classList.remove('hidden');

    try {
        if (!supabaseClient) {
            console.error('Supabase client is unavailable.');
            return;
        }

        const { data: paintData } = await supabaseClient.from('painting').select('*');
        const { data: descData } = await supabaseClient.from('artwork_description').select('*');

        if (descData) {
            descriptions = {};
            descData.forEach(d => { descriptions[String(d.artwork_id)] = d; });
        }

        artworks = (paintData || [])
            .map(row => {
                const imageUrl = resolveArtworkImageUrl(
                    row.image_url || row.image_large || row.url || row.image || row.path || row.file_name || ''
                );
                if (!imageUrl) return null;
                return {
                    ...row,
                    id: String(row.id ?? row.artwork_id ?? ''),
                    title: row.title || row.artwork_name || 'Untitled',
                    description: row.description || '',
                    imageUrl
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
        const materialText = d?.medium || 'Theory';
        return `
        <div onclick="openSlideshow(${idx})" class="artwork-grid-item group cursor-pointer relative aspect-[3/4] bg-[#0f0f0f] rounded-2xl overflow-hidden border border-white/5">
            <img src="${art.imageUrl}" class="w-full h-full object-cover grayscale-[0.2] group-hover:grayscale-0 transition-all duration-1000" loading="lazy">
            <div class="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80 group-hover:opacity-40 transition-opacity"></div>
            <div class="absolute inset-x-0 bottom-0 p-8 flex flex-col justify-end translate-y-6 group-hover:translate-y-0 transition-transform duration-700">
                <span class="text-[9px] font-black text-accent-red tracking-[0.3em] uppercase mb-2">${artistText}</span>
                <h3 class="text-lg font-light text-white tracking-tighter mb-4">${titleText}</h3>
                <div class="opacity-0 group-hover:opacity-100 transition-opacity duration-700">
                    <p class="text-xs text-gray-500 font-light leading-relaxed line-clamp-2 italic mb-4">${summaryText}</p>
                    <div class="text-[9px] font-mono text-gray-600 uppercase tracking-widest">${dateYear ? dateYear + ' / ' : ''}${materialText}</div>
                </div>
            </div>
        </div>
    `;
    }).join('');

    const strip = document.getElementById('thumbStrip');
    if (!strip) return;

    strip.innerHTML = artworks.map((art, idx) => `
        <img onclick="goToSlide(${idx})" id="thumb-${idx}" src="${art.imageUrl}"
             class="thumb-item h-20 w-20 object-cover rounded-2xl cursor-pointer flex-shrink-0">
    `).join('');
}

function openSlideshow(index) {
    currentIndex = index;
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
    }
    document.body.style.overflow = '';
    isAutoplay = false;
    stopAutoplay();
    syncPlayStateUI();
    try { sessionStorage.removeItem(SLIDESHOW_STATE_KEY); } catch (err) { console.warn('Unable to clear slideshow state:', err); }
    if (document.fullscreenElement) {
        document.exitFullscreen?.();
    }
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

function updateSlideshow() {
    const art = artworks[currentIndex];
    const img = document.getElementById('slideshowImage');
    if (!art || !img) return;
    saveSlideshowState();

    const artId = String(art.id ?? '');
    const d = getArtworkDetails(art);

    img.style.opacity = '0';
    img.style.transform = 'scale(0.98)';

    setTimeout(() => {
        img.onerror = () => {
            img.style.opacity = '1';
            img.style.transform = 'scale(1)';
            img.src = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="100%" height="100%" fill="#111"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="28" font-family="sans-serif">Image unavailable</text></svg>');
        };

        img.onload = () => { img.style.opacity = '1'; img.style.transform = 'scale(1)'; };
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

init();
window.addEventListener('keydown', (e) => {
    const modal = document.getElementById('slideshowModal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (e.key === 'ArrowRight') nextSlide();
    if (e.key === 'ArrowLeft') prevSlide();
    if (e.key === 'Escape') closeSlideshow();
    if (e.key === ' ') { e.preventDefault(); togglePlayPause(); }
});
