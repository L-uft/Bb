# Bb (iPhone port of Riff): plan

Status: Phase 1 (audit) done on 2026-11-18. Baseline upstream commit: `rootscripts/riff@4569e7d` (0.7.6).
Companion docs: [API_MAP.md](API_MAP.md) · [IPC_MAP.md](IPC_MAP.md) · [FEATURES.md](FEATURES.md) · [SCREENS.md](SCREENS.md).

## 1. Decisions so far

| # | Decision | Source |
|---|---|---|
| D1 | App name **Bb**, bundle id **com.luft.bb**, URL scheme `bb`. All new code uses Bb names from day one; Phase 5 becomes a check, not a rename. | you + proposed |
| D2 | Icon: `bb-icon-1024.png`, used exactly as is (1024², RGBA). `ios.icon` = `{ light, dark, tinted }` all pointing to it; splash = icon centered on `#FFFFFF`; Android adaptive foreground with `#FFFFFF` background. If any build step rejects the transparent icon: **stop and ask**. | you |
| D3 | English UI only. Styles use `start`/`end`, never `left`/`right`. | you |
| D4 | Free Apple ID. iOS builds come from a GitHub Actions macOS job as an **unsigned .ipa** and are installed with Sideloadly. UI work happens on the Android emulator. | you |
| D5 | YouTube client profiles live in versioned `packages/core/src/youtube/clients.json`. Fixing a profile is a config change. | you |
| D6 | Stream URLs are resolved at play time. On 403/expiry: re-resolve once, then show an error. Never reuse a URL older than 5 h. | you |
| D7 | `StreamResolver` interface with `OnDeviceResolver` (InnerTube, the default) and `RemoteResolver` (your token-protected yt-dlp endpoint; Settings toggle, off by default). Interface now, RemoteResolver after v1. | you |
| D8 | Audio: stream through the EQ chain. **No whole-song decode into memory.** Report memory use and tap-to-first-sound. Ask before any switch to track-player. | you |
| D9 | In-app log screen: JS errors + native audio errors written to a file, shareable from Settings. | you |
| D10 | `packages/core` gets an injected `Platform` adapter (fetch, crypto/hashing, base64/bytes, storage, logger). Node implementation for tests, React Native implementation for the app. A lint rule blocks Node built-ins. | you |
| D11 | Scope: v1 / v1.1 / v2 as listed in FEATURES.md. The spike skips SoundCloud. | you |
| D12 | Bb stores data under its own MMKV keys (`bb.*`). Desktop data comes in only through `.rfacc` import with a key mapper, so a rename migration is never needed. | proposed |
| D13 | No root npm workspace (that would change the desktop's `package.json`). `apps/mobile` depends on `packages/core` via `"@bb/core": "file:../../packages/core"` plus Metro `watchFolders`. | proposed |
| D14 | Never reuse upstream's hard-coded third-party credentials (Last.fm key/secret, SoundCloud fallback client_id, Google OAuth client), and never copy them into anything ported to `packages/core`. The one exception is the `.rfacc` passphrase: it is a file-format constant, and we need it to read your desktop exports. | brief + audit + you |
| D15 | **Remote `clients.json` override in v1.** A copy ships inside the app; the remote file is only an override, fetched from `raw.githubusercontent.com/L-uft/Bb/mobile/packages/core/src/youtube/clients.json` at most once every 6 h and also right after a stream-resolve failure. It is validated with a strict zod schema (no fields outside the schema, data only, never evaluated). Fallback order: valid remote → last good cached copy → bundled. Every switch is logged. Settings shows the active config's version and source (bundled / remote / cached). | you (Phase 1 reply) |
| D16 | `.rfacc` import moves to **v1.1**. The key-mapping table stays in IPC_MAP.md for later. | you |
| D17 | Approved v1 additions: next-track prefetch, audio quality setting, tap a lyric line to seek, RTL rendering for Arabic/Hebrew lyric lines (detected per line; the rest of the UI stays English LTR). The offline Home moves to **v1.1**, so **v1 has three tabs: Search · Library · Settings**, and the Home tab arrives in v1.1. | you (+ my assumption on the tab count) |
| D18 | Pushes go to branch `mobile` only: no `main`, no tags, no force-push. Upstream workflows (`release.yml`, `nix-hash.yml`) are never modified or deleted. Unsigned builds need no secrets; if any step asks for one, stop and report. | you |
| D19 | **Modular audio graph:** `source → [processing slots] → analyser → destination`. `PlayerService` builds the chain from an ordered list of `ProcessingSlot`s (each exposes `input`/`output` nodes, plus `bypass`). A custom native C++ node can later be added as one more slot without changing `PlayerService`. | you |
| D20 | **Credential guard:** a test scans `packages/core` and `apps/mobile` sources for the upstream third-party keys. It compares SHA-256 hashes of every key-shaped token against a list of hashes, so the keys themselves never enter the repo. | proposed (enforces D14) |

## 2. Architecture

```
Bb/ (fork of rootscripts/riff; the desktop app stays untouched)
├── src/ …                         desktop app (unchanged; upstream fixes are pulled from here)
├── packages/core/                 @bb/core: TypeScript (strict), ESM, zero React Native imports, runs in Node 22 and Hermes
│   ├── src/platform/              Platform interface + createNodePlatform() for tests
│   ├── src/log/                   Logger interface, ring buffer
│   ├── src/youtube/               clients.json, InnerTube request builder, visitorData, player parsing, music search + parser
│   ├── src/stream/                StreamResolver, OnDeviceResolver, RemoteResolver (interface/stub), StreamService (cache + 5 h + retry)
│   ├── src/lyrics/                lrclib client, LRC parser, match heuristics, RTL line detection
│   ├── src/library/               Track/Playlist models, playlists, liked, history, queue logic, EQ presets
│   ├── src/offline/               download index, storage accounting
│   ├── src/local/                 tag parsers (ID3v2, MP4, FLAC/Vorbis) on Uint8Array
│   ├── src/account/               .rfacc decoder + desktop-key → Bb mapper
│   ├── src/color/                 dominant color / accent extraction from RGBA pixels
│   └── test/                      Vitest. Offline fixture tests by default; live network tests only with LIVE=1.
├── apps/mobile/                   Expo SDK 58, React Native 0.88, Expo Router, TypeScript strict, expo-dev-client
│   ├── src/app/                   routes (Expo Router, see SCREENS.md)
│   ├── plugins/withExactIosIcon.js  keeps the icon byte-identical (Expo flattens light/tinted onto white)
│   ├── src/player/PlayerService.ts  owns AudioContext, <Audio>, node graph, queue, lock screen
│   ├── src/platform/              React Native Platform implementation (fetch, @noble/*, MMKV, file logger)
│   └── assets/brand/bb-icon-1024.png
├── .github/workflows/mobile-ios.yml   macOS job → unsigned .ipa artifact
└── docs/mobile/                   these docs
```

### Key interfaces (draft, finalized in Phase 2/3)

```ts
// packages/core/src/platform/types.ts
export interface Platform {
  fetch(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response>;
  crypto: {
    md5Hex(data: Uint8Array | string): string;        // Last.fm signatures (v2)
    sha1Hex(data: Uint8Array | string): string;       // stable ids
    sha256(data: Uint8Array | string): Uint8Array;    // .rfacc key
    randomBytes(n: number): Uint8Array;
    aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, cipher: Uint8Array, tag: Uint8Array): Uint8Array;
  };
  bytes: { toBase64(b: Uint8Array): string; fromBase64(s: string): Uint8Array;
           utf8Encode(s: string): Uint8Array; utf8Decode(b: Uint8Array): string };
  storage: { getString(k: string): string | undefined; set(k: string, v: string): void;
             delete(k: string): void; keys(): string[] };
  logger: { debug/info/warn/error(tag: string, msg: string, data?: unknown): void };
  now(): number;
}

// packages/core/src/stream/types.ts
export interface ResolvedStream {
  url: string;
  headers: Record<string, string>;   // e.g. the User-Agent googlevideo expects for this client
  mimeType: string; itag?: number; bitrate?: number; contentLength?: number;
  client: string;                    // which profile won, for the logs
  resolvedAt: number;
  expiresAt: number;                 // min(expire= param, resolvedAt + 5 h)
}
export interface StreamResolver {
  readonly kind: 'on-device' | 'remote';
  resolve(track: TrackRef, opts?: { quality?: 'low' | 'standard'; signal?: AbortSignal }): Promise<ResolvedStream>;
}
// StreamService wraps a resolver: cache, prefetch, "re-resolve once on 403/expired, then error".
```

`clients.json` (shape):
`{ version, updated, player: [{ name, clientName, clientVersion, host, userAgent, deviceMake?, deviceModel?, osName?, osVersion?, androidSdkVersion?, enabled }], googlevideoUserAgents: { IOS, ANDROID_MUSIC, … }, itags: { standard: [140, 141, 139], low: [139, 140] } }`.
Seeded from `fetchDirectYoutubeStreamServer` (server.js L1115) and `GV_UA`.

**Remote override (approved, D15):** a newer `clients.json` on the fork's `mobile` branch fixes
YouTube breakage without rebuilding and re-sideloading. It is data, not code, so iOS allows it.

### Audio graph (D19)

```
<Audio source={{ uri, headers }}>      (or a local file)
        │  MediaElementAudioSourceNode
        ▼
 ┌─ slot 1: EQ (10 × BiquadFilter) ─┐   each slot: { id, input: AudioNode, output: AudioNode,
 ├─ slot 2: (v1.1) reverb/echo      ┤                bypass(on: boolean), dispose() }
 ├─ slot n: (later) custom C++ node ┤   PlayerService connects slot[i].output → slot[i+1].input
 └──────────────────────────────────┘
        ▼
   AnalyserNode  →  master GainNode  →  destination
```
Slots are registered in a list. Inserting, removing or bypassing a slot rewires only its neighbours,
so `PlayerService` and the UI never change when a new processing stage is added.

**Lint rule (packages/core):** `no-restricted-imports` for `buffer`, `crypto`, `zlib`, `http`,
`https`, `fs`, `fs/promises`, `stream`, `child_process`, `net`, `dns`, `os`, `path`, `url`, plus every
`node:*` form. `no-restricted-globals` for `Buffer`, `process`, `__dirname`, `require`. Pure-JS
dependencies (`fflate`, `@noble/*`) are allowed.

## 3. Milestones

| M | Phase | Content | Ends with |
|---|---|---|---|
| M0 | 1 | Audit: these five docs | **STOP** (now) |
| M1 | 2 | **Spike**: S1 to S5 below | pass/fail report, numbers, fallback proposal → **STOP** |
| M2 | 3 | `packages/core` v1 modules + tests, Platform adapters, MMKV store, remote `clients.json` override, app shell (3 tabs, mini player, full player, queue sheet), dark theme + dynamic accent | screenshots/recording → **STOP** |
| M3 | 4 | v1 features in order: search → play → queue → liked/history/playlists → local files → offline → lyrics → EQ + presets. Every screen gets loading/empty/error, haptics, VoiceOver. | status vs FEATURES.md → **STOP** |
| M4 | 5 | Rebrand check: icon/splash per D2, About + licenses, `git grep -in riff -- apps/mobile packages/core` returns only allowed hits (RIFF magic strings, credits) | report → **STOP** |
| M5 | 6 | Verify: typecheck, lint, tests, real-device smoke test, release .ipa + Android APK, `apps/mobile/RUN.md` | final report |
| M6 | — | v1.1: SoundCloud, speed/pitch, reverb, echo, sleep timer, visualizers, Home tab (local + online sections), album/artist pages, autoplay radio, `.rfacc` import, light theme, lyrics offset | |
| M7 | — | v2: imports, Last.fm, other lyrics sources, translation, RemoteResolver, normalizer, crossfade, … | |

## 4. Spike (Phase 2): what I'll prove first, in this order

The build pipeline comes first, because nothing can be tested on the iPhone without it.

| # | Item | Pass criteria |
|---|---|---|
| **S0** | GitHub Actions `mobile-ios.yml` (macOS): `expo prebuild` → `xcodebuild archive` with signing off → `Payload/Bb.app` → `Bb-unsigned.ipa` artifact. Two variants: **dev-client** (loads JS from Metro on the PC over Wi-Fi, so JS changes need no rebuild) and **release** (JS bundled, for tests away from the PC). The icon follows D2. | .ipa installs with Sideloadly and opens on your iPhone |
| **S1** | `resolveYouTubeAudio(videoId)` in `packages/core` (OnDeviceResolver + clients.json) + a Vitest test with 3 public video IDs (LIVE=1). Prefer itag 140. Also a header test: one `Range: bytes=0-0` request **with** and one **without** the client User-Agent, to learn whether googlevideo enforces it. | 3/3 resolve to `audio/mp4` and return a 206 response; per-client success logged |
| **S2** | One screen: tap → resolve → `<Audio source={{ uri, headers }}>` → `MediaElementAudioSourceNode` → 10 × BiquadFilter → AnalyserNode → output. Background audio (`iosBackgroundMode`), session category `playback`, lock-screen info + artwork (`PlaybackNotificationManager`), remote play/pause/next/previous/seek, interruption handling. | Sound plays; seeking works; **10 min with the screen locked** without dropouts; lock screen and AirPods controls work; playback resumes after a call; **memory stays flat** over a long track (shows it is streaming, not decoding the whole file) |
| **S3** | DSP check: live EQ changes (no clicks), ConvolverNode reverb with a generated impulse response, AnalyserNode returns data, `playbackRate` 0.8 / 1.25 with `preservesPitch` on and off. List missing nodes (already known: no DynamicsCompressorNode). | Each item audible and correct, or listed as missing |
| **S4** | Local files: MP3, M4A, FLAC, WAV from Files; OGG/Opus with and without the audio-api `enableFFmpeg` plugin option. Also check in Hermes: `URL`/`URLSearchParams`, `TextDecoder`, `AbortSignal.timeout`. | Supported formats listed; polyfills chosen where needed |
| **S5** | Log screen: a JS error, an unhandled promise rejection and a native audio error all land in the log file. The file can be shared. The header shows app version, iOS version, device and memory. | Shared file contains all three |

**Measurements, without Xcode:** `PlayerService` logs timestamps for tap → resolve start/end →
`onLoad` → `onPlaying`, so **tap-to-first-sound** appears on the log screen. Memory is sampled every
10 s with `react-native-device-info` `getUsedMemory()` and reported as start/peak/end. Targets:
first sound under 2.5 s on Wi-Fi with a cold resolve, under 1 s with a prefetched URL.

### Fallback tree (S2 and S3)

1. `<Audio>` ignores `headers` → (a) use a client profile whose URLs play without a special UA (from
   the S1 header test); (b) otherwise **download to a file first** with our own fetch (headers OK),
   then play the file through the same `<Audio>` + EQ graph. A 4-minute track at 128 kbps is about
   4 MB, so roughly 1 to 2 s on Wi-Fi. It lives on disk, not decoded in RAM.
2. `MediaElementAudioSourceNode` doesn't feed the graph → `AudioBufferQueueSourceNode` fed by chunked
   decoding of the file (bounded memory). More work; I'd ask before starting.
3. Whole-file decode with `AudioBufferSourceNode`: about 100 MB for 5 minutes. Only with your explicit OK.
4. `react-native-track-player` (no EQ): **only after asking you** (D8).

## 5. Build and install loop (free Apple ID, no Mac)

- **One-time:** enable **Developer Mode** on the iPhone (Settings → Privacy & Security). iOS requires it
  for developer-signed apps. Install Sideloadly on the PC. Allow Node/Metro through Windows Firewall
  (port 8081) so the dev-client build can load JS over Wi-Fi.
- **Day to day:** JS/TS changes reload live from Metro, with no rebuild. Native changes (new native
  module, plugin or icon) mean push → Actions builds the .ipa (about 15 to 25 min) → download →
  Sideloadly.
- **Limits:** re-sign every 7 days; at most 3 sideloaded apps; 10 new App IDs per 7 days.
- **Cost:** your fork is public, so GitHub-hosted macOS minutes are free. The flip side: artifacts and
  code are public, so **no secrets ever go into the repo or the app bundle**. v1 has none; v2 keys
  (Last.fm, Spotify, DeepL) are entered at runtime and stored in the Keychain.
- The existing upstream workflows don't fire on `mobile` (`release.yml` runs on `v*` tags,
  `nix-hash.yml` on `main`). **Never push `v*` tags to the fork.**

## 6. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | YouTube changes InnerTube (PO tokens, clients stop returning direct URLs, 403s) | High / High | clients.json (D5), proposed remote override, re-resolve once (D6), RemoteResolver later (D7) |
| R2 | `<Audio>` streaming + `headers` + `MediaElementAudioSourceNode` unproven on iOS | Medium / High | Spike S2, fallback tree |
| R3 | `react-native-audio-api` **1.0.1 was released 2026-11-16** (2 days old) | Medium / Medium | Pin the exact version, never use nightlies, upgrade deliberately after reading the changelog |
| R4 | No `DynamicsCompressorNode` in audio-api 1.0.1 | Certain / Low for v1 | Normalizer and HQ engine moved to v2 |
| R5 | Free Apple ID friction (7-day re-sign, Developer Mode, app limits) | Certain / Medium | Dev-client over LAN avoids most rebuilds; RUN.md covers re-signing |
| R6 | No Xcode console for native crashes | Certain / Medium | Log screen (S5), memory sampling, native error capture |
| R7 | Hermes gaps (`URL`, `AbortSignal.timeout`, Node built-ins) | Medium / Medium | Platform adapter + lint rule (D10); checked in S4 |
| R8 | Upstream drift (upstream is active) | High / Low–Medium | Baseline `4569e7d`; each core module records the server.js functions it came from. Port by reviewing `git diff <baseline>..upstream/main` on those functions. |
| R9 | Upstream ships hard-coded third-party credentials | Certain / Medium | Never reused (D14); your own keys only |
| R10 | Scope creep (68 routes, 88k lines) | Medium / High | v1 needs 16 of the 68 routes; everything else is labeled v1.1, v2 or drop |
| R11 | Newest stack (Expo 58 / RN 0.88, New Architecture only): native module compatibility (MMKV 4, Skia 2, FlashList 2, audio-api 1.0) | Low–Medium / Medium | First S0 build installs all v1 native modules, so any problem shows up in week 1 |
| R12 | Legal: YouTube/SoundCloud terms | Accepted | Personal install only, never the App Store (brief) |

## 7. Phase 1 questions: answered (2026-11-18)

1. Remote `clients.json`: yes, in v1, with the rules in D15.
2. `.rfacc` import: moved to v1.1 (D16).
3. v1 additions: prefetch, quality, tap-to-seek and RTL lyric lines approved; offline Home moved to v1.1 (D17).
4. Push: yes, branch `mobile` only (D18).
