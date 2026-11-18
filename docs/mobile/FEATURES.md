# Features: desktop Riff → Bb mobile

Labels: **v1**, **v1.1**, **v2**, or **drop** (not possible or not wanted on iPhone; the brief's drop list).

**By** shows who placed each item:
- **you**: from your scope list (reply on 2026-11-18). Fixed unless you change it.
- **brief**: from the project brief (its drop list, or a phase requirement such as the About and licenses screens).
- **proposed**: my placement for something your list didn't mention. Move any of these freely.

Sources: README "Features", the views in `src/renderer/index.html`, the settings categories
(`data-cat`), the audio editor modal, and `localStorage` keys that show hidden features.

---

## 1. Streaming and playback

| Feature | Desktop source | Label | By | Notes |
|---|---|---|---|---|
| YouTube Music search | `/api/search?platform=ytmusic` | **v1** | you | YouTube web search as a fallback when YTM returns nothing (same as the desktop) |
| YouTube Music playback | `/api/stream-info` | **v1** | you | `StreamResolver` → `OnDeviceResolver`; client profiles in `clients.json`; itag 140 first |
| Stream URL rules: re-resolve once on 403/expiry, never reuse a URL older than 5 h | `isStreamCacheExpired` | **v1** | you | The desktop uses the `expire=` param or 2 h; Bb uses `min(expire, 5 h)` |
| Prefetch the next track's URL | `/api/prefetch` | **v1** | you (approved) | Cuts the gap between tracks; follows the 5 h rule |
| Audio quality setting (data saver / standard) | `riff_audio_quality` | **v1** | you (approved) | Picks the itag (139 = 48 kbps / 140 = 128 kbps AAC) |
| Remote `clients.json` override (bundled → remote → cached; version and source shown in Settings) | — (new) | **v1** | you | PLAN.md D15 |
| Queue: add, play next, reorder, remove | queue view, `audio.js` | **v1** | you | |
| Shuffle, repeat (off / all / one) | `riff_shuffle`, `riff_repeat` | **v1** | you | |
| Lock screen / Control Center: title, artist, artwork, progress, controls | media keys (`onMediaCommand`) | **v1** | you | `PlaybackNotificationManager` |
| AirPods / Bluetooth remote: play, pause, next, previous | media keys | **v1** | you | Same remote-command events |
| Background playback, resume after a phone call | — | **v1** | you (brief Phase 2/6) | `UIBackgroundModes: audio`, `AudioManager.observeAudioInterruptions` |
| SoundCloud search and playback | `/api/search?platform=soundcloud`, `fetchDirectSoundCloudStreamServer` | **v1.1** | you | client_id scrape + api-v2, no yt-dlp |
| Mixed "Riff library" search (YTM + SC interleaved) | `platform=rifflibrary` | **v1.1** | proposed | Comes with SoundCloud |
| Choose an alternative source for a track ("wrong song") | `/api/save-track-source` | **v1.1** | proposed | |
| Autoplay / radio when the queue ends ("My Wave") | `/api/vibe` | **v1.1** | proposed | YTM radio only (no hard-coded Last.fm key) |
| Explicit-content filter | `riff_show_explicit` | **v1.1** | proposed | `isExplicit` is already in the track data |
| Crossfade | `riff_crossfade` | **v2** | proposed | Needs two `<Audio>` tags and gain ramps |
| Per-track trim (start/end) | `riff_track_trims` | **v2** | proposed | |
| Rename tracks, block tracks/artists | `riff_track_renames`, `riff_blocked_*` | **v2** | proposed | |
| Share a track | `forShare` in `/api/stream-info` | **v2** | proposed | |
| RemoteResolver (your yt-dlp endpoint, token-protected) | — (new) | **v2** | you | The interface is designed in v1; Settings toggle, off by default |
| YouTube account login | `google-oauth.js`, `youtubePlayback*` | **drop** | brief | Revisit only with your own OAuth client |
| Proxy settings | `/api/proxy-config` | **drop** | proposed | iOS system VPN/proxy applies |

## 2. Library

| Feature | Desktop source | Label | By | Notes |
|---|---|---|---|---|
| Playlists: create, rename, delete, add/remove tracks, cover | `devsize_playlists`, view `playlist-detail` | **v1** | you | |
| Liked songs | `devsize_favorites`, view `favorites` | **v1** | you | |
| History | `devsize_history`, view `history` | **v1** | you | |
| Local files from the Files app, with tags and embedded artwork | `importAudioFiles`, view `local` | **v1** | you | Copied into the sandbox. MP3/M4A/AAC/WAV/FLAC play natively; OGG/Opus need the audio-api FFmpeg option (tested in the spike). |
| Offline downloads + offline library view, delete, storage used | `/api/offline-*`, `/api/download` | **v1** | you | Downloads the m4a as is. No format conversion (no ffmpeg). |
| Import a desktop account (`.rfacc`) | `accountImport` | **v1.1** | you (moved from v1) | Imports playlists, liked songs, history, EQ presets and player prefs. Key mapping is in IPC_MAP.md. |
| Saved albums, followed artists | `riff_saved_albums`, `riff_favorite_artists`, view `albums` | **v1.1** | proposed | Comes with the album and artist pages |
| Pinned playlists, custom sort orders | `riff_pinned_playlists`, `riff_sb_lib_sort`, `riff_local_sort` | **v1.1** | proposed | |
| Export account / playlists as JSON | `accountExport`, `savePlaylistsJson` | **v2** | proposed | Share sheet |
| Listening stats, "top moments", daily mixes | `riff_stats`, `riff_top_moments`, `riff_daily_mixes` | **v2** | proposed | |
| Pick a whole folder of music | `pickLocalFolder` | **drop** | proposed | The iOS document picker doesn't pick folders |

## 3. Browse and discovery

| Feature | Desktop source | Label | By | Notes |
|---|---|---|---|---|
| Home, local sections: recently played, liked, your playlists, resume last session | view `discover`, `riff_last_playback_state` | **v1.1** | you (moved from v1) | v1 has no Home tab; Library → Downloads covers offline listening |
| Home, online sections: hot picks, trending, country chart | `/api/hot`, `/api/trending`, `/api/top-chart` | **v1.1** | proposed | YTM + Deezer only |
| Album page | view `album`, `/api/album` | **v1.1** | proposed | |
| Artist page (bio, top tracks, albums) | view `artist`, `/api/artist` | **v1.1** | proposed | No hard-coded Last.fm key |
| Album search | `/api/albums/search` | **v1.1** | proposed | |
| Track credits | `/api/track-credits` | **v2** | proposed | |
| Cover lookup for tracks with no art | `/api/track-cover` | **v1.1** | proposed | |

## 4. Lyrics

| Feature | Desktop source | Label | By | Notes |
|---|---|---|---|---|
| Line-synced lyrics from lrclib, auto-scroll | `/api/lyrics` (lrclib path), `lyrics.js` | **v1** | you | Includes the desktop's match heuristics (title cleanup, strict match, instrumental detection) |
| Tap a line to seek | `lyrics.js` | **v1** | you (approved) | Almost free once lines are timed |
| Right-to-left display for Arabic/Hebrew lyric lines | `lyrics-rtl.js` | **v1** | you (approved) | Detected per line; this is song **content**, so the rest of the UI stays English LTR |
| Manual timing offset | `riff_lyrics_speed` / offset controls | **v1.1** | proposed | |
| Syllable / word highlighting | `/api/lyrics-words` (NetEase yrc), `parseEnhancedLrcWords` | **v2** | you ("other lyrics sources") | lrclib is line-level only, so syllable timing needs NetEase |
| Other sources: Musixmatch, NetEase, Kugou, Genius | `/api/lyrics?source=` | **v2** | you | |
| Custom `.lrc` / pasted lyrics | `/api/save-custom-lyrics` | **v2** | proposed (counted as another source) | |
| Lyrics translation | `/api/translate` | **v2** | you | Official DeepL with your key; public proxies opt-in |
| Lyrics on the lock screen / mini window / CLI | `/api/lyrics-stream`, mini window | **drop** | brief | |

## 5. Audio editor (desktop `audio-settings-modal`)

The desktop audio graph (`src/renderer/audio.js`):
`media element → [HQ chain: compressor → bass → vocal → air → saturation → limiter] → 3-band EQ → 10-band EQ (32 Hz to 16 kHz) → bus → dry + distortion + echo (delay) + reverb (convolver) → master → normalizer (compressor/limiter) → analyser → fade → output`.
Speed uses `playbackRate` with `preservesPitch = true`. "Speed + pitch" and the pitch semitones use
`playbackRate` with `preservesPitch = false`, so the desktop has no pitch control that is independent
of speed.

| Feature | Desktop node(s) | Label | By | Notes |
|---|---|---|---|---|
| 10-band EQ | 10 × BiquadFilter (peaking) | **v1** | you | Same frequencies as the desktop, so imported presets match |
| EQ presets: built-in + custom (save, rename, delete) | `devsize_custom_presets` | **v1** | you | Includes **bass boost** as a preset |
| Speed with pitch preserved | `playbackRate` + `preservesPitch` | **v1.1** | you | `<Audio preservesPitch playbackRate>` exists in audio-api 1.0.1; the spike checks it |
| Pitch / "speed + pitch" (nightcore, slowed) | `playbackRate`, `preservesPitch = false` | **v1.1** | you | |
| Reverb | ConvolverNode + generated impulse response | **v1.1** | you (if it passes the spike) | ConvolverNode exists in 1.0.1 |
| "Slowed + reverb" and "nightcore" presets | presets | **v1.1** | you (follows speed/pitch and reverb) | |
| Echo | DelayNode + feedback gain | **v1.1** | proposed | DelayNode exists in 1.0.1 |
| Distortion | WaveShaperNode | **v2** | proposed | WaveShaperNode exists |
| 3-band EQ (low/mid/high) | 3 × BiquadFilter | **v2** | proposed | Covered by the 10-band EQ |
| Sleep timer | `audioeditor.js` | **v1.1** | proposed | Small and popular on phones |
| Volume normalizer | DynamicsCompressor + limiter | **v2** | proposed | **audio-api 1.0.1 has no DynamicsCompressorNode.** Needs a custom gain-riding implementation. |
| "HQ engine" (vocal / air / bass enhancer, saturation, limiter) | compressor + biquads + waveshaper | **v2** | proposed | Same compressor gap |
| Export a track with effects applied | `renderOffline` + `/api/encode` | **v2** | proposed | WAV only (RIFF writer), no ffmpeg |
| Download formats (mp3/flac/… conversion) | `/api/download` + ffmpeg | **drop** | brief | No ffmpeg on iOS |
| Audio output device picker | `riff_audio_output_device` | **drop** | proposed | iOS routes audio itself; AirPlay picker possible in v2 |

## 6. Visualizers

| Feature | Desktop source | Label | By | Notes |
|---|---|---|---|---|
| Wave, bars and swift visualizers | `visualizer.js` (WebGL/canvas) | **v1.1** | you | Skia, driven by `AnalyserNode` |
| Visualizer settings (style, smoothing, sensitivity, opacity, position) | `riff_viz_*`, `riff_bar_viz_*` | **v1.1** | you (with visualizers) | |
| "TVK" full-screen visualizer + lyrics mode | `riff_tvk_*` | **v2** | proposed | |

## 7. Look and feel

| Feature | Desktop source | Label | By | Notes |
|---|---|---|---|---|
| Dark theme (default) | theme module | **v1** | brief (Phase 3) | |
| Dynamic accent color from album art | `getCoverDominantColors` (ui.js:7556), `extractDominantColor` (theme.js:297) | **v1** | brief (Phase 3) | Ported color extractor |
| Light theme / follow system | `riff_theme_mode` | **v1.1** | proposed | |
| Theme customizer (intensity, brightness, palette, mesh/cover backgrounds, banners, fonts, icon packs, corner radius) | theme / banners / interface settings | **v2** | proposed | A subset only |
| Custom CSS editor, CSS themes | Monaco, `themes.js` | **drop** | brief | No CSS in React Native |
| Alternate app icons | `riff_app_icon` | **drop** | proposed | Bb ships one icon (yours) |
| UI translation (machine-translated via DeepL) | `/api/i18n-batch`, `riff_ui_lang` | **drop** | you (English only) | Styles use start/end, so Arabic can be added later with real string tables |
| Haptics, VoiceOver labels, loading/empty/error states, safe areas | — | **v1** | brief (Phase 4) | Baseline on every screen |

## 8. Integrations

| Feature | Desktop source | Label | By | Notes |
|---|---|---|---|---|
| Playlist import: Spotify, Apple Music, Deezer, YT Music, YouTube, VK, Yandex, with sync | `/api/*-import`, `import.js` | **v2** | you | No yt-dlp: InnerTube browse instead |
| Spotify account (your own Client ID, PKCE) → your library | `/api/spotify-*` | **v2** | you (imports) | `expo-auth-session`, token in the Keychain |
| Last.fm scrobbling + now playing | `/api/lastfm/*` | **v2** | you | Your own API key only |
| TikTok sound import | `/api/tiktok-import` | **drop** | proposed | tikwm.com scraper + yt-dlp; not in the README |
| Discord Rich Presence | `discord.js` | **drop** | brief | |
| Plugins | `plugins.js` | **drop** | brief | iOS forbids downloaded code |

## 9. App, settings and support

| Feature | Desktop source | Label | By | Notes |
|---|---|---|---|---|
| Settings: playback & quality, storage (used / clear / offline), account import, about | settings categories `tracks`, `storage`, `account`, `about` | **v1** | brief | |
| In-app log screen: JS errors + native audio errors → file, share from Settings | `logError`, `openLogsFolder`, `getDiagnostics` | **v1** | you | Also shows app version, iOS version, device and memory use |
| About screen ("Based on Riff by rootscripts (MIT)") + open-source licenses screen | — | **v1** | brief | |
| RemoteResolver settings (URL + token, off by default) | — | **v2** | you | |
| Settings categories `interface`, `theme`, `banners` | — | **v2** | proposed | Small subset, see section 7 |
| Settings categories `custom-themes`, `plugins`, `integrations → Discord` | — | **drop** | brief | |
| First-run welcome screen | `welcome.html` | **drop** | proposed | Not needed for a personal install |
| Desktop-only: window controls, tray, mini window, multi-instance, global/keyboard shortcuts, auto-updater, yt-dlp/ffmpeg installer, data/download folder pickers, zoom/UI scale, owner/donator badges | various | **drop** | brief | |

---

## The 10 desktop views (7 in the brief + 3 detail views)

| Desktop view (`index.html`) | Bb screen | Label |
|---|---|---|
| `view-discover` | Home tab | v1.1 (local + online sections) |
| `view-favorites` | Library → Liked songs | v1 |
| `view-history` | Library → History | v1 |
| `view-local` | Library → Local files | v1 |
| `view-queue` | Queue sheet (from the player or mini player) | v1 |
| `view-settings` | Settings tab | v1 (subset) |
| `view-albums` | Library → Albums | v1.1 |
| `view-playlist-detail` | Playlist screen | v1 |
| `view-album` | Album screen | v1.1 |
| `view-artist` | Artist screen | v1.1 |
| (new) | Library → Downloads (offline) | v1 |
| (new) | Search tab | v1 |
| (new) | Full-screen player + lyrics + EQ sheet | v1 |

## The v1 list in one place

YT Music search and playback · queue (reorder, shuffle, repeat) · playlists, liked songs, history ·
lrclib synced lyrics (tap to seek, RTL lines) · 10-band EQ + presets (incl. bass boost) · local files
from Files · offline downloads · lock screen + AirPods + background + call interruptions ·
dark theme + dynamic accent · prefetch + quality setting · remote `clients.json` override ·
log screen · About + licenses · haptics / VoiceOver / loading-empty-error states.
Tabs in v1: **Search · Library · Settings** (Home arrives in v1.1).
