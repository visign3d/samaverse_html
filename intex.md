# Samaverse Supabase Project - HTML Implementation

## Tasks
* Create HTML/JS version in `B:\apps\dharma_day\lib\samaverse\html\index.html`
* Use `B:\apps\dharma_day\lib\samaverse\samaverse_supabese.dart` as reference
* Create `sitemap.xml` for the HTML version
* Add random artwork hero at start of page
* Add spacing and "Full Archive Entry" header before the gallery grid

## Status: Complete
- **HTML/JS Port**: Successfully built a responsive, dark-themed gallery using Tailwind CSS and Supabase JS SDK.
- **Featured Hero**: Implemented a randomized "Featured Archive Entry" hero section at the start of the page that deep-links into the slideshow.
- **Gallery Header**: Added a clear "Full Archive Entry" separator with increased spacing between the hero and the main grid.
- **Sitemap**: Created `sitemap.xml` to assist with SEO and indexing of the gallery.
- **Sync Logic**: Implemented identical image resolution and field mapping logic to match the Flutter implementation.
- **Fixes**: 
    - Resolved `Uncaught SyntaxError: Identifier 'supabase' has already been declared` by renaming the client instance to `supabaseClient`.
    - Added diagnostic logging to the UI for better error visibility in the web version.
- **Flutter Enhancements**:
    - Added `Icons.dashboard_customize_rounded` (Master Dashboard) to `samaverse_supabese.dart`.
    - Dashboard button is specific to the Flutter app as requested.
- **Verification**: Cross-checked Dart and HTML codebases for logic parity.
