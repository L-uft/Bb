# IPC map: `window.electronAPI` (src/main/preload.js) → Bb mobile

Baseline: upstream `4569e7d`. `preload.js` exposes **95 members**. The handlers live in
`src/main/main.js`, plus `plugins.js`, `themes.js` and `updater.js` (line numbers below).

Verdicts follow API_MAP.md: **PORT** (same logic), **REWRITE** (same capability, new
implementation), **DROP** (no equivalent, or not allowed on iOS).

| Verdict | Count |
|---|---|
| REWRITE | 21 |
| DROP | 74 |
| PORT | 0 (the main process holds no portable business logic, apart from the local-file tag parser and the `.rfacc` codec, both REWRITE) |
| **Total** | **95** |

---

## Storage, the most important group

The renderer keeps **all user state in `localStorage`** (203 static keys, plus 30 places that build
key names at runtime). Electron mirrors that into `storage.json` through the sync IPC calls below.

| Member | Channel → handler | What it does | Verdict | Mobile | Release |
|---|---|---|---|---|---|
| `storageInitSync` | `storage-get-all-sync` → main.js:231 | Returns the whole storage snapshot synchronously at boot. | **REWRITE** | MMKV, which is already synchronous | v1 |
| `storageSaveBatch` | `storage-save-batch` → main.js:235 | Debounced (250 ms) atomic write of the snapshot. | **REWRITE** | MMKV per-key writes | v1 |
| `storageSaveSync` | `storage-save-sync` → main.js:247 | Immediate write. | **REWRITE** | MMKV | v1 |
| `readCacheFile` | `cache-read` → main.js:268 | Reads `cache.json` (renderer-side caches). | **REWRITE** | MMKV in a separate `cache` instance | v1 |
| `writeCacheFile` | `cache-write` → main.js:277 | Writes `cache.json` atomically. | **REWRITE** | Same as above | v1 |
| `accountImport` | `account-import` → main.js:1503 | Opens a `.rfacc` file and decrypts it (`decryptAccount`, main.js:38). | **REWRITE** | `expo-document-picker` → `core/account/rfacc` → key mapper (below) | v1 (Phase 3 step 2 asks for it) |
| `accountExport` | `account-export` → main.js:1486 | Encrypts the payload and opens a save dialog. | **REWRITE** | Share sheet. Format still to be decided: `.rfacc` or plain JSON. | v2 |
| `savePlaylistsJson` | `save-playlists-json` → main.js:1472 | Exports playlists as JSON through a save dialog. | **REWRITE** | Share sheet | v2 |

### The `.rfacc` format (`encryptAccount`, main.js:27)

```
"RFAC" (4 bytes) | IV (12 bytes) | GCM tag (16 bytes) | AES-256-GCM( deflateRaw( JSON ) )
key = SHA-256( <passphrase hard-coded in main.js> )
JSON = { app: "Riff", version: "1.0", exportedAt, localStorage: { <key>: <string value>, ... } }
```

The key is a constant in the open-source code, so the phone can decrypt files exported by the desktop.
Decoding in Hermes: AES-GCM and SHA-256 go through `Platform.crypto` (React Native implementation:
`@noble/ciphers` / `@noble/hashes`; Node implementation: `node:crypto`, which lets tests check one
against the other). Inflate uses `fflate` (pure JS). The passphrase is read from upstream when we port
the codec and is not copied into these docs.

### Desktop key → Bb store mapping (import only)

Bb uses its own MMKV keys (`bb.*`) from day one. Desktop keys are only read during import, so no
rename migration is needed later.

| Desktop key | Shape | Bb target | Release |
|---|---|---|---|
| `devsize_playlists` | `[{ id: "pl_…", name, tracks: Track[], cover?, importedPlatform?, syncPlatform?, importedAt? }]` | playlists | v1 |
| `devsize_favorites` | `Track[]` (each with `addedAt`) | liked songs | v1 |
| `devsize_history` | `Track[]`, newest first | history | v1 |
| `devsize_custom_presets`, `riff_active_preset` | `{ id, name, settings: { eqBands[10], speed, speedPitch, pitch, reverb, echo, distortion, volume, eq{low,mid,high} } }` | EQ presets. Same 10 band frequencies (32 Hz to 16 kHz). The other fields are kept for v1.1. | v1 |
| `riff_audio_settings`, `riff_persist_sound_settings` | same `settings` shape | current EQ | v1 |
| `riff_shuffle`, `riff_repeat`, `riff_volume` | strings | player prefs | v1 |
| `riff_saved_albums`, `riff_favorite_artists`, `riff_unfollowed_artists` | arrays | saved albums/artists | v1.1 |
| `riff_blocked_tracks`, `riff_blocked_artists`, `riff_track_renames`, `riff_track_trims` | maps and arrays | — | v2 |
| `riff_local_*`, `devsize_local_*`, `riff_removed_local_paths` | desktop file paths | **skipped**: the files aren't on the phone | — |
| `riff_lastfm_sk/apikey/apisecret`, `riff_deepl_api_key`, `riff_spotify_client_id` | secrets | **not imported automatically**. v2 can offer it, into the Keychain. | v2 |
| ~170 UI/theme/desktop keys (`riff_theme_*`, `riff_sidebar_*`, `riff_tvk_*`, …) | — | ignored | — |

`Track` (from `parseYtmSongs`, server.js L3189, plus renderer additions):
`{ id, title, artist, album?, duration, thumbnail, isExplicit?, platform?, url?, addedAt? }`.

---

## Files and media pickers

| Member | Handler | What it does | Verdict | Mobile | Release |
|---|---|---|---|---|---|
| `importAudioFiles` | main.js:808 | Picks files or folders, copies them to `LIBRARY_DIR` as `local_<sha1(name+size)[0:12]>.<ext>`. | **REWRITE** | `expo-document-picker` (multiple) → copy into the sandbox | v1 |
| `pickLocalFiles` | main.js:1151 | Picks files to play in place. | **REWRITE** | Merged into the import above: iOS needs files inside the sandbox | v1 |
| `rescanLocalMetadata` | main.js:1206 | Reads tags and embedded covers (ID3, MP4, FLAC/Vorbis, read by hand in `extractLocalTrackMetadata`). | **REWRITE** | `core/local/tags`: port the hand-written parsers on top of `Uint8Array` | v1 |
| `pickLocalFolder` | main.js:1167 | Picks a folder of music. | **DROP** | `expo-document-picker` can't pick folders. Revisit if needed. | — |
| `pickMedia` | main.js:803 | Picks an image or video for the banner/background. | **DROP** | Background customization isn't planned | — |

## Playback and OS integration

| Member | Handler | What it does | Verdict | Mobile | Release |
|---|---|---|---|---|---|
| `onMediaCommand` | main → renderer push | Media-key commands. | **REWRITE** | `PlaybackNotificationManager` events (play/pause/next/previous/seek) | v1 |
| `onMediaControl` | main → renderer push | Thumbbar/tray controls. | **REWRITE** | Same as above | v1 |
| `setMediaKeys` | main.js:1366 | Turns media keys on or off. | **DROP** | Always on | — |
| `mediaKeysActive` | main.js:1367 | Keep-alive for media keys. | **DROP** | — | — |
| `getAudioOutputInfo` | main.js:710 | Name of the output device. | **DROP** | v2 option: `AudioManager.getDevicesInfo()` | — |

## Cache and diagnostics

| Member | Handler | What it does | Verdict | Mobile | Release |
|---|---|---|---|---|---|
| `getCacheSize` | main.js:738 | Size of the data and cache folders. | **REWRITE** | Storage-used in Settings (`expo-file-system`) | v1 |
| `clearCache` | main.js:771 | Clears the caches. | **REWRITE** | Settings → Storage | v1 |
| `logError` | main.js:661 | Writes renderer errors to the log file. | **REWRITE** | `Logger` → rotating file. Catches JS errors and native audio errors (your request #3). | v1 |
| `openLogsFolder` | main.js:684 | Opens the logs folder. | **REWRITE** | Settings → Logs → **Share log file** (share sheet) | v1 |
| `getDiagnostics` | main.js:675 | Version, platform, paths. | **REWRITE** | Header of the log screen (app version, iOS version, device, memory) | v1 |
| `getAppVersion` | main.js:1470 / updater.js:43 | App version. | **REWRITE** | `expo-application` | v1 |
| `openExternal` | main.js:534 | Opens a URL in the browser. | **REWRITE** | `Linking` / `expo-web-browser` | v1 |
| `showPlaylistContextMenu` | main.js:1520 | Native context menu for a playlist. | **REWRITE** | Native action sheet / context menu in the UI | v1 |

## Dropped groups

| Group | Members | Why |
|---|---|---|
| Window chrome | `minimizeWindow`, `maximizeWindow`, `closeWindow`, `onWindowVisibility`, `setWindowButtonsVisible`, `setZoomFactor`, `getZoomFactor`, `clearWebFrameCache`, `getGpuCompositing` | No desktop windows on iOS |
| Local server | `serverToken` (`--riff-token`), `getServerPort`, `setAppProxy` | No local HTTP server |
| App lifecycle | `restartApp`, `isWindows`, `platform` | `platform` becomes `Platform.OS`; nothing else is needed |
| Mini window, tray, multi-instance, shortcuts | `toggleMiniWindow`, `setMiniLyrics`, `setTrayOnClose`, `getMultiInstance`, `setMultiInstance`, `getGlobalShortcuts`, `setGlobalShortcuts` | The brief drops these |
| Onboarding, launcher | `welcomeFinish`, `onWelcomeResult`, `getLauncherInfo`, `installLauncher` | The yt-dlp/ffmpeg launcher can't exist on iOS; onboarding isn't needed in v1 |
| Data and download folders | `getDataDir`, `pickDataDir`, `setDataDir`, `getDownloadDir`, `pickDownloadDir`, `setDownloadDir`, `resetDownloadDir` | The iOS sandbox decides where files go |
| Updater (electron-updater, points at rootscripts releases) | `checkForUpdates`, `updateAction`, `installUpdateNow`, `onUpdateAvailable`, `onUpdateDownloaded`, `onUpdateProgress`, `onUpdateReady`, `onUpdateError`, `onUpdateNotAvailable` | Sideloaded builds update by reinstalling |
| Discord RPC | `discordRpcUpdate`, `discordRpcClear`, `discordRpcSetEnabled`, `discordRpcGetEnabled`, `discordRpcGetConnected`, `discordRpcReconnect` | The brief drops it |
| CSS themes and editor | `listThemes`, `importThemes`, `setThemeEnabled`, `disableAllThemes`, `removeTheme`, `getAppCss` | No CSS in React Native; the Monaco editor is dropped |
| Plugins (they run user JS) | `listPlugins`, `setPluginEnabled`, `disableAllPlugins`, `openPluginsFolder`, `removePlugin`, `importPlugins` | iOS forbids downloaded executable code |
| Google / YouTube login | `googleLogin`, `googleLogout`, `googleAuthStatus`, `googleAccountInfo`, `googleImportLibrary`, `youtubePlaybackLogin`, `youtubePlaybackLogout`, `youtubePlaybackStatus`, `onYoutubePlaybackAuth` | Out of scope. The OAuth client in `google-oauth.js` belongs to the original developer and is never reused. |

Count check: 8 (storage) + 5 (files) + 5 (playback) + 8 (cache and diagnostics) + 69 (dropped groups) = **95**.
REWRITE = 8 + 3 + 2 + 8 = **21**. DROP = 2 + 3 + 69 = **74**.
