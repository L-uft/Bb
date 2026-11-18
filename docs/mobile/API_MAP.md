# API map: `src/server/server.js` → Bb mobile

Baseline: upstream `rootscripts/riff` @ `4569e7d` (package 0.7.6). `server.js` is 12,180 lines.
The router has **68 handlers** serving **72 paths** (3 album aliases, 2 tools aliases), plus the
`/api/lastfm/*` prefix dispatcher. Line numbers below are from the baseline. Re-check them before porting.

On the phone there is no local HTTP server. Each kept route becomes a typed function in
`packages/core` (or app code, when it is about files or the OS). Nothing listens on `127.0.0.1`.

## How this table was built

A call-graph script walked every route block in `requestHandler` / `handleLastFmRoute`, followed
calls through the 215 top-level functions, and collected, per route, the external hosts and the
Node-only APIs reached. Hosts built at runtime (`hostname:` options, URL constants) were added by hand.
"Needs" lists what blocks a straight copy into React Native:

- `yt-dlp` / `ffmpeg`: external binaries (`executeYtDlp`, `spawn`). They can't run on iOS.
- `fs`, `crypto`, `Buffer`, `https`: Node built-ins. Each one is replaced by the injected `Platform` adapter or by app code.
- `child_process`, `net`, `electron`: no equivalent on iOS.

## Verdicts

- **PORT**: same logic, moved into `packages/core`. Node HTTP becomes the injected `fetch`, and hashing goes through `Platform.crypto`.
- **REWRITE**: the capability is needed, but the implementation changes (`yt-dlp` becomes plain HTTP, disk files become MMKV / `expo-file-system`, localhost URLs become `file://` URIs).
- **DROP**: not needed on iPhone, or not allowed there.

**Release** follows the scope you approved: `v1`, `v1.1`, `v2`, or `—` for dropped routes.

| Verdict | Count | | Release | Count |
|---|---|---|---|---|
| PORT | 24 | | v1 | 16 |
| REWRITE | 21 | | v1.1 | 9 |
| DROP | 23 | | v2 | 20 |
| **Total** | **68** | | — (drop) | 23 |

---

## 1. Playback and streams

| # | Route (line) | What it does | External hosts | Needs | Verdict | Target | Release |
|---|---|---|---|---|---|---|---|
| 1 | `/api/stream-info` (L11744 → `handleStreamInfo` L4451) | Resolves a playable audio URL. Order: offline cache → user-saved source → in-flight dedupe → InnerTube `/player` (`IOS`, `ANDROID_MUSIC`, plus `TVHTML5` when logged in) → `yt-dlp` fallback. Tracks that exist only as metadata (Deezer/iTunes/Spotify ids) are matched to a YT Music search result, and SoundCloud is the last fallback. Returns a localhost `audio-proxy` URL and starts a background cache-to-disk job (ffmpeg for HLS). | www.youtube.com, music.youtube.com, *.googlevideo.com, i.ytimg.com, api-v2.soundcloud.com, soundcloud.com | yt-dlp, ffmpeg, fs, crypto, Buffer, https | **REWRITE** | `core/stream`: the `StreamResolver` interface, `OnDeviceResolver` (InnerTube, profiles in `core/src/youtube/clients.json`), and the candidate matching. No yt-dlp, no proxy, no auto-cache. | v1 (YouTube); SoundCloud v1.1 |
| 2 | `/api/prefetch` (L11706 → `prefetchTrack` L2967) | Resolves the next track's stream ahead of time into an in-memory cache. | youtube, soundcloud | https, Buffer | **PORT** | `core/stream` resolver cache: 5-hour max age, one re-resolve on 403 | v1 |
| 3 | `/api/audio-proxy` (L12095 → `handleAudioProxy` L6236) | Streams googlevideo/SoundCloud through localhost. Sets a **User-Agent per client** from the URL's `c=` param (`googleVideoUserAgent` L6106), forwards `Range`, follows redirects, and adds cookies for logged-in clients. | *.googlevideo.com (any) | https, fs | **DROP** | The UA-per-client table moves into `clients.json`. The `<Audio source={{ uri, headers }}>` tag sends the header itself (proven in spike S2). | — |
| 4 | `/api/check-cache` (L11715) | Finds an offline file by track id or by title+artist and returns a local URL. | — | fs, crypto | **REWRITE** | `core/offline` index (MMKV) + app file layer | v1 |
| 5 | `/api/local-track` (L11757) | Serves a cached audio file with Range support. | — | fs | **DROP** | Play the `file://` URI directly | — |
| 6 | `/api/downloaded-track` (L11762) | Serves a file from the Downloads folder by name. No caller found. | — | fs | **DROP** | — | — |
| 7 | `/api/download` (L11376 → `handleDownload` L6473) | "Save to Downloads": yt-dlp download, ffmpeg conversion (mp3/flac/…), cover embedding, optional start/end trim. | youtube, soundcloud, api.soundcloud.com | yt-dlp, ffmpeg, child_process, fs | **REWRITE** | Offline download = resolve → native background download (`expo-file-system`) of the m4a **as is**. No transcoding or tag embedding; the cover is saved next to the file. | v1 |
| 8 | `/api/encode` (L11402 → `handleEncode` L6849) | Takes a WAV rendered offline with effects in the renderer, encodes it with ffmpeg and embeds the cover. | — | ffmpeg, child_process, fs | **DROP** | v2 option: export the processed track as WAV with the RIFF writer (no ffmpeg) | — |
| 9 | `/api/tmp-file` (L11398) | Serves temp files for the encode flow. | — | fs | **DROP** | — | — |
| 10 | `/api/save-track-source` (L12025) | Remembers a user-chosen alternative source for a track (artist+title → id/url/platform). | — | fs | **REWRITE** | `core/library` source overrides (MMKV) | v1.1 |
| 11 | `/api/track-analysis` (L11999) | Stores and reads a per-track analysis blob. The only renderer caller (`setCachedTrackAnalysis`) is never called. | — | fs | **DROP** | — | — |

## 2. Search and browse

| # | Route (line) | What it does | External hosts | Needs | Verdict | Target | Release |
|---|---|---|---|---|---|---|---|
| 12 | `/api/search` (L11581 → `handleSearch` L3434) | Search per platform: `ytmusic` (InnerTube music search), `youtube` (InnerTube web search), `soundcloud` (api-v2), `rifflibrary` (YTM + SC interleaved). Falls back to Deezer/iTunes metadata. Paginates from an in-memory pool. | music.youtube.com, www.youtube.com, i.ytimg.com, api-v2.soundcloud.com, api.soundcloud.com, soundcloud.com, api.deezer.com, itunes.apple.com | https, Buffer | **PORT** | `core/youtube/search`, `core/search` | v1 (YT Music, YouTube fallback); SoundCloud v1.1 |
| 13 | `/api/albums/search` (L11475) | Album search on iTunes. | itunes.apple.com | https | **PORT** | `core/metadata` | v1.1 |
| 14 | `/api/playlists/search` (L11479) | Public playlist search on Deezer and Spotify (feeds import). | api.deezer.com, www.deezer.com, open.spotify.com, api.spotify.com, accounts.spotify.com | https, Buffer, fs | **PORT** | `core/import` | v2 |
| 15 | `/api/album`, `/api/albums/tracks`, `/api/album-tracks` (L11483 → `handleAlbumTracks` L10397) | Album tracklist and cover from YTM browse, Deezer, iTunes, MusicBrainz, Cover Art Archive, archive.org, Genius. | music.youtube.com, www.youtube.com, i.ytimg.com, api.deezer.com, itunes.apple.com, musicbrainz.org, coverartarchive.org, archive.org, genius.com | https, Buffer, fs | **PORT** (trimmed: YTM + Deezer + iTunes) | `core/album` | v1.1 |
| 16 | `/api/artist` (L11694 → `fetchArtistInfo` L5373) | Artist page: bio, avatar, banner, top tracks, albums, listener counts. Sources: YTM, Deezer, Last.fm (**hard-coded key**), Genius, SoundCloud, MusicBrainz, archive.org. | 15 hosts incl. ws.audioscrobbler.com, lastfm.freetls.fastly.net, www.last.fm | https, Buffer, crypto, fs | **PORT** (trimmed: YTM + Deezer; Last.fm only with your own key) | `core/artist` | v1.1 |
| 17 | `/api/hot` (L11487 → `handleHotPicks` L10733) | "Hot picks" row for Home, cached. | api.deezer.com, music.youtube.com, www.youtube.com, i.ytimg.com | https, Buffer, fs | **PORT** | `core/charts` | v1.1 |
| 18 | `/api/trending` (L11605 → `handleTrending` L4206) | Trending tracks per region (YTM charts + Deezer). Seeds include a hard-coded list of CIS artists. | api.deezer.com, music.youtube.com, www.youtube.com, i.ytimg.com | https, Buffer, fs | **PORT** (drop the hard-coded seeds) | `core/charts` | v1.1 |
| 19 | `/api/top-chart` (L11609 → `handleTopChart` L4139) | Country chart from YTM charts, kworb.net, Yandex (RU), Last.fm geo and iTunes. | + kworb.net, api.music.yandex.net, ws.audioscrobbler.com, itunes.apple.com | https, Buffer, fs | **PORT** (YTM + Deezer only) | `core/charts` | v1.1 |
| 20 | `/api/vibe` (L11589 → `handleVibeRecommendations` L3592) | "My Wave": recommendations seeded from history and favorites, via YTM radio (`/next`), Last.fm similar (**hard-coded key**) and Deezer. | music.youtube.com, www.youtube.com, i.ytimg.com, api.deezer.com, ws.audioscrobbler.com | https, Buffer, fs | **PORT** (YTM radio only) | `core/recommend`: autoplay when the queue ends | v1.1 |
| 21 | `/api/net-check` (L11599) | Online check that pings google, deezer and itunes. | www.google.com, api.deezer.com, itunes.apple.com | — | **REWRITE** | App: `expo-network` reachability | v1 |

## 3. Lyrics

| # | Route (line) | What it does | External hosts | Needs | Verdict | Target | Release |
|---|---|---|---|---|---|---|---|
| 22 | `/api/lyrics` (L12123 → `handleLyrics` L7767) | Lyrics by source (`auto` or a named one). Order: custom → disk cache → lrclib (`get`, then `search`) → Musixmatch (desktop token) → NetEase → Kugou → Genius (plain text). Detects instrumentals and caches to disk. | lrclib.net, apic-desktop.musixmatch.com, music.163.com, lyrics.kugou.com, genius.com | https, Buffer, crypto, fs | **PORT** | `core/lyrics`: lrclib + LRC parser + match heuristics (`sanitizeForLyrics`, `isStrictLyricMatch`, `isInstrumentalOrBreakcore`). Cache in MMKV. | v1 (lrclib only); other sources v2 |
| 23 | `/api/lyrics-words` (L12106) | NetEase word-level (`yrc`) lyrics: the syllable timing source. | music.163.com | https, Buffer | **PORT** | `core/lyrics/netease` | v2 |
| 24 | `/api/save-custom-lyrics` (L12100) | Saves user-provided `.lrc` or pasted lyrics. | — | fs, crypto | **REWRITE** | `core/lyrics` store | v2 |
| 25 | `/api/translate` (L11200 → `handleTranslate` L10120) | Translates lyric lines. Order: official DeepL (user key) → public DeepLX proxies (deeplx.mingming.dev, api.deeplx.org, deepl.tr1ck.top) → Google (translate.googleapis.com). | listed in "What it does" | https, Buffer | **PORT** | `core/translate`. Official DeepL with your key by default; the public proxies send lyrics to unknown third parties, so they become opt-in. | v2 |
| 26 | `/api/lyrics-stream` (L11363) | Server-sent-events (SSE) feed of now-playing state for the `riff lyrics` CLI and the mini window. | — | — | **DROP** | — | — |
| 27 | `/api/state` (L11306) | The renderer posts now-playing state into that SSE feed. | — | — | **DROP** | — | — |

## 4. Local files and offline library

| # | Route (line) | What it does | External hosts | Needs | Verdict | Target | Release |
|---|---|---|---|---|---|---|---|
| 28 | `/api/library` (L11836) | Lists imported local files. | — | — | **REWRITE** | `core/local` index (MMKV) | v1 |
| 29 | `/api/library-add` (L11767) | Registers files copied in by the IPC `import-audio-files` call, and parses "Artist - Title" from the filename. | — | fs | **REWRITE** | App: `expo-document-picker` → copy into the sandbox → tag parse (`core/local/tags`) → index | v1 |
| 30 | `/api/library-update` (L11815) | Stores a local file's duration. | — | fs | **REWRITE** | `core/local` | v1 |
| 31 | `/api/library-remove` (L11856) | Deletes local files (one, many or all). | — | fs | **REWRITE** | `core/local` + app file layer | v1 |
| 32 | `/api/library-file` (L11851) | Serves a local library file with Range support. | — | fs | **DROP** | Play the `file://` URI | — |
| 33 | `/api/offline-library` (L11967) | Lists offline tracks with size, metadata and thumbnail. | — | fs | **REWRITE** | `core/offline` | v1 |
| 34 | `/api/offline-delete` (L12045) | Deletes one offline track (by id or title+artist), with its metadata and thumbnail. | — | fs, crypto | **REWRITE** | `core/offline` | v1 |
| 35 | `/api/clear-offline-library` (L12075) | Deletes all offline audio and thumbnails. | — | fs | **REWRITE** | `core/offline` | v1 |
| 36 | `/api/local-thumbnail` (L11955) | Serves an offline track's cached cover. | — | fs | **REWRITE** | Cover file saved next to the audio, shown as `file://` | v1 |
| 37 | `/api/image-proxy` (L11911) | Fetches remote images with a desktop UA and caches them on disk; falls back to an iTunes cover lookup. | any + itunes.apple.com | fs, crypto, Buffer | **REWRITE** | `expo-image` disk cache. The cover-lookup fallback comes in v1.1 with #38. | v1 |

## 5. Metadata

| # | Route (line) | What it does | External hosts | Needs | Verdict | Target | Release |
|---|---|---|---|---|---|---|---|
| 38 | `/api/track-cover` (L11459) | Finds a cover URL by artist + title (Deezer, then iTunes). | api.deezer.com, itunes.apple.com | — | **PORT** | `core/metadata` | v1.1 |
| 39 | `/api/track-credits` (L11467) | Songwriters and producers from Genius, Deezer and iTunes. | genius.com, api.deezer.com, itunes.apple.com | — | **PORT** | `core/metadata` | v2 |

## 6. Playlist imports

| # | Route (line) | What it does | External hosts | Needs | Verdict | Target | Release |
|---|---|---|---|---|---|---|---|
| 40 | `/api/spotify-import` (L11410 → `handleSpotifyImport` L8190) | Spotify playlist. Order: Web API with the user's PKCE token → anonymous token + api-partner GraphQL → embed page scrape. | open.spotify.com, api.spotify.com, api-partner.spotify.com, accounts.spotify.com | https, Buffer, fs | **PORT** | `core/import/spotify` | v2 |
| 41 | `/api/apple-import` (L11415) | Apple Music playlist: page scrape + iTunes lookup. | itunes.apple.com (+ music.apple.com page) | https | **PORT** | `core/import/apple` | v2 |
| 42 | `/api/yandex-import` (L11420) | Yandex Music playlist via its public API. | api.music.yandex.net | — | **PORT** | `core/import/yandex` | v2 |
| 43 | `/api/playlist-import` (L11425 → `handlePlaylistImport` L8895) | Generic link import: Deezer, SoundCloud (incl. short links), YouTube / YT Music playlists (InnerTube, with a `yt-dlp --flat-playlist` fallback). Spotify links are routed to #40. | spotify hosts, api.deezer.com, api-v2.soundcloud.com, soundcloud.com, www.youtube.com, i.ytimg.com | yt-dlp, child_process, fs, https | **REWRITE** | `core/import`: InnerTube browse only, no yt-dlp | v2 |
| 44 | `/api/vk-import` (L11445 → `handleVkImport` L9533) | VK playlist from a URL or pasted text; matches each track on YT Music. | music.youtube.com, www.youtube.com, i.ytimg.com | yt-dlp (fallback), fs, https | **REWRITE** | `core/import/vk`, no yt-dlp | v2 |
| 45 | `/api/tiktok-import` (L11430 → `handleTikTokImport` L9292) | Turns a TikTok sound into a track via the tikwm.com scraper + yt-dlp. Not listed in the README. | www.tikwm.com | yt-dlp, child_process, crypto, fs | **DROP** | Revisit later if wanted | — |
| 46 | `/api/check-playlist-unavailable` (L11108) | Flags imported tracks that have no Deezer match. No caller found in the renderer. | api.deezer.com | — | **DROP** | Re-evaluate with imports in v2 | — |

## 7. Integrations

| # | Route (line) | What it does | External hosts | Needs | Verdict | Target | Release |
|---|---|---|---|---|---|---|---|
| 47 | `/api/lastfm/token` (L10891) | Last.fm web auth: gets a token and an auth URL. | ws.audioscrobbler.com, www.last.fm | crypto (MD5 signature), Buffer, https | **PORT** | `core/lastfm` | v2 |
| 48 | `/api/lastfm/session` (L10903) | Exchanges the token for a session key. | ws.audioscrobbler.com | same | **PORT** | `core/lastfm` | v2 |
| 49 | `/api/lastfm/mobile-session` (L10915) | Username + password login (`auth.getMobileSession`). | ws.audioscrobbler.com | same | **PORT** | `core/lastfm`; preferred on the phone (no browser round-trip) | v2 |
| 50 | `/api/lastfm/now-playing` (L10932) | `track.updateNowPlaying`. | ws.audioscrobbler.com | same | **PORT** | `core/lastfm` | v2 |
| 51 | `/api/lastfm/scrobble` (L10947) | `track.scrobble`. | ws.audioscrobbler.com | same | **PORT** | `core/lastfm` | v2 |
| 52 | `/api/spotify-auth-start` (L11491) | PKCE OAuth with the user's own Spotify Client ID. | accounts.spotify.com | crypto (random, SHA-256), fs | **REWRITE** | `expo-auth-session` + `bb://` redirect | v2 |
| 53 | `/api/spotify-callback` (L11510) | localhost OAuth redirect and token exchange. | accounts.spotify.com | https, Buffer, fs | **REWRITE** | Same as #52 | v2 |
| 54 | `/api/spotify-status` (L11555) | Refreshes the token and reports whether Spotify is connected. | accounts.spotify.com | https, fs | **REWRITE** | Token in the iOS Keychain (`expo-secure-store`) | v2 |
| 55 | `/api/spotify-logout` (L11565) | Clears the stored token (Electron `safeStorage`). | — | fs, electron | **REWRITE** | `expo-secure-store` | v2 |
| 56 | `/api/spotify-library` (L11577) | The user's Spotify playlists and liked songs via the Web API. | api.spotify.com, accounts.spotify.com | https, Buffer, fs | **PORT** | `core/import/spotify` | v2 |
| 57 | `/api/youtube-account-info` (L11613) | YouTube profile read from login cookies in the Electron session. | www.youtube.com, music.youtube.com | electron, crypto, fs | **DROP** | YouTube login is out of scope | — |
| 58 | `/api/yt-cookies-from-browser` (L11628) | Imports YouTube cookies from desktop browsers via yt-dlp. | www.youtube.com | yt-dlp, electron, fs | **DROP** | — | — |

## 8. App plumbing

| # | Route (line) | What it does | Needs | Verdict | Notes |
|---|---|---|---|---|---|
| 59 | `/api/default-settings` (L11062) | Reads a defaults file and reports an "owner environment" flag (it checks for `/home/rootless`). | fs | **DROP** | Defaults are compiled into the app |
| 60 | `/api/save-default-settings` (L11073) | Writes that defaults file (a developer tool). | fs | **DROP** | — |
| 61 | `/api/audio-output-info` (L11102) | Gets the system output device name through OS commands. | child_process | **DROP** | v2 option: show the AVAudioSession route via audio-api `getDevicesInfo()` |
| 62 | `/api/proxy-config` (L11323) | Sets an HTTP proxy for server requests after a liveness check. | net | **DROP** | iOS system proxy/VPN applies |
| 63 | `/api/proxy-test` (L11343) | Tests a proxy by running yt-dlp. | yt-dlp | **DROP** | — |
| 64 | `/api/i18n-batch` (L11213) | Machine-translates UI strings via DeepL and caches them per language. | fs, https | **DROP** | The UI is English. Arabic, if added later, gets real string tables. |
| 65 | `/api/devsize-memes` (L11186) | Lists the meme images in `assets/devsize`. | fs | **DROP** | — |
| 66 | `/api/brand-icon` (L11406) | Fetches brand icons from cdn.simpleicons.org. No caller found. | fs | **DROP** | Bundle the few icons we need |
| 67 | `/api/tools-status`, `/api/tools/status` (L11733) | yt-dlp/ffmpeg install status. | — | **DROP** | — |
| 68 | `/api/tools-install`, `/api/tools/install` (L11738) | Downloads yt-dlp and ffmpeg. | — | **DROP** | — |

---

## Things found during the audit that affect the port

1. **The googlevideo User-Agent must match the client.** The desktop rewrites the UA on every
   googlevideo request based on the `c=` param (`googleVideoUserAgent`, `GV_UA`), and
   `verifyStreamPlayable` checks each URL with a `Range: bytes=0-0` request using that UA. On the phone,
   whatever fetches audio must send the same header. The audio-api `<Audio>` tag accepts
   `source={{ uri, headers }}` (from its 1.0.1 type definitions), so the spike has to prove this on a device.
2. **The desktop picks m4a first** in "medium" quality (`extractAudioFromPlayerResponse`, L1148).
   That matches "prefer itag 140 on iOS".
3. **Hard-coded credentials that belong to the original developer. Never reuse them:**
   - Last.fm: `DEFAULT_LFM_KEY` / `DEFAULT_LFM_SECRET` (L10833), plus a second inline key used by artist, vibe and top-chart calls.
   - A fallback SoundCloud `client_id` (L1282). SoundCloud gets a live scrape only.
   - The Google OAuth client in `src/main/google-oauth.js`.

   Bb's Last.fm support uses a key you enter in Settings (v2).
4. **The `.rfacc` account file is not plain JSON** (see IPC_MAP.md). Its payload is a dump of the
   renderer's `localStorage`.
5. **The SoundCloud client_id scrape** reads the newest `a-v2.sndcdn.com` script bundles (L1287).
   That host is missing from the URL grep because the bundle URLs are scraped from the page.
