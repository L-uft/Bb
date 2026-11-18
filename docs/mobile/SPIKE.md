# Phase 2 spike: results

Live record of S0 to S5 (criteria in PLAN.md §4). Updated as each item completes.

| Item | Status | Summary |
|---|---|---|
| S0 build pipeline | **PASS** | Run 1 installed with Sideloadly (free Apple ID) on iPhone 13 Pro Max, iOS 26.6.1: self-check all ✓ (MMKV, files, AudioContext 48000 Hz + FFmpeg, memory 103.8 MB, network) |
| S1 resolver | **PASS** | 3/3 videos → itag 140 audio/mp4 via the `IOS` profile; URLs need no special User-Agent |
| S2 playback / background / lock screen | **round 1 FAILED on device**; round 2 build pending | Run 3: stuck in "buffering", position 0:00, RMS 0; memory +5–12 MB per track change |
| S3 DSP nodes | pending | |
| S4 local formats + Hermes APIs | pending | |
| S5 log screen | pending | |

## S0: build pipeline

- Expo SDK 58.0.26, React Native 0.88.1, React 19.3.0. SDK 58 needs **Xcode 26.4+** and **Node 22.13+** (Expo version table).
- Native modules in the first build, all v1 ones (risk R11): react-native-audio-api **1.0.1 (pinned)** with FFmpeg
  enabled, react-native-mmkv 4 + nitro-modules, react-native-device-info, expo-router, reanimated 4 + worklets,
  gesture-handler, expo-file-system / document-picker / sharing / application / network / haptics / image /
  splash-screen, expo-dev-client.
- **Icon:** Expo's prebuild flattens the light and tinted icons onto white
  (`@expo/prebuild-config` `withIosIcons`: `removeTransparency: true, backgroundColor: '#ffffff'`).
  `apps/mobile/plugins/withExactIosIcon.js` restores the original PNG after every other step, and CI
  checks all three variants with SHA-256 against `assets/brand/bb-icon-1024.png`.
- The first screen is a self-check: each native module makes one real call (MMKV set/get, file
  write/read, AudioContext + FFmpeg flag, memory, device, network) and shows ✓/✗.
- **Run 1** (commit `77b04bc`, https://github.com/L-uft/Bb/actions/runs/44211662178):
  release job ✓ in 15.2 min (prebuild 3 s, pods 110 s, Xcode build 758 s); artifact
  `Bb-release-unsigned-run1`, 16.6 MB zipped. Both variants share bundle id `com.luft.bb`
  (one `app.json`), so installing one replaces the other.
- **Design note for S2:** `<Audio context={ctx}>` creates its file source inside our AudioContext;
  `new MediaElementAudioSourceNode(ctx, { mediaElement: handle })` disconnects it from the destination
  and exposes it as a normal node for the slot chain (D19). The tag spawns a new file source when the
  source changes, so PlayerService must rebuild the source node on every load.

## S2: playback through the graph (code ready)

What the S2 screen does (`apps/mobile/src/app/s2.tsx`, `src/player/*`):
- `PlayerService` (singleton) owns the AudioContext, the graph and the queue. `PlayerHost` renders the one
  `<Audio context source={{ uri, headers }}>` tag at the app root. On load, `MediaElementAudioSourceNode`
  feeds the slot chain `source → eq10 (10 × peaking, Q 1.1, desktop bands) → analyser → master gain → out` (D19).
- **Graph proof**, two ways: (1) a live analyser RMS meter, (2) a "mute master gain" switch that must
  silence the music. If audio bypassed the graph, the meter would read 0 and mute would do nothing.
- Session: category `playback`, interruptions observed (`began` → paused; `ended` + `shouldResume` →
  resume), route changes logged, `OldDeviceUnavailable` (AirPods removed) → pause.
- Lock screen: `PlaybackNotificationManager` with title, artist, artwork, duration, elapsed time; controls
  play / pause / next / previous / seek. Remote events are logged as `remote: …`.
- Measurements: tap → resolve → `onLoad` → `onPlaying` per track (prefetched or not). Memory is sampled
  every 10 s (`getUsedMemory`), with track start / now / peak.
- D6: one re-resolve on a playback error, then an error state. The next track is prefetched once the
  current one starts.
- Event log on screen, with a **Share log** button (text). S5 adds the persistent log file.

### Round 1 on device (run 3, commit `0d46d3e`): FAIL

Your report (iPhone 13 Pro Max, iOS 26.6.1):
- Resolve on the phone works: IOS itag 140, 179–1130 ms.
- **Playback never really started.** After every `audio: loaded`, the only event was `buffering`.
  No `playing`, no position progress, analyser RMS 0.000 ~30 s after the tap.
- The old "first sound" metric was wrong: it measured `onPlay` (`play()` returning), not audio.
- **Memory grew** on every change and never dropped: 144 → 156 → 167 → 171 → 177 → 180 → 183 MB.

What the library source says (react-native-audio-api 1.0.1):
- `buffering` comes from the native file source's `bufferingStateChanged(true)`. `onPlaying` only
  fires when it later reports `false`, so the native side never produced audio after `start()`.
- Before playing a remote URL the library runs `HEAD` + `Range: bytes=0-0`. With byte ranges it streams
  natively through FFmpeg; **otherwise it downloads the whole file into a JS ArrayBuffer**, which would
  match memory growing by about the file size.
- The app created the AudioContext at app start, **before** the audio session was set to `playback` and
  activated. A context whose output never renders also explains every symptom: nothing pulls the
  source (stuck buffering, position 0, RMS 0) while network data piles up in native memory.

### Round 2 changes (this build)

1. **Context order fix:** session category → activate → *then* create the AudioContext (lazily, on
   first play). If no audio arrives and the context isn't `running`, rebuild it once.
2. **Real first-sound metric:** the first analyser RMS > 0.003 after the tap; the first position tick
   is recorded separately. Status stays `buffering` until there is evidence of audio.
3. **Logging:** every state change (`play() called`, `buffering`, `buffering → playing`, paused, ended),
   context state changes, the position + RMS every 5 s, every `<Audio>` / context error.
4. **Release on track change:** detach from the graph, stop the old native source after its tag
   unmounts, and call `gc()` if Hermes exposes it.
5. **"10 rapid track changes"** button: logs memory after each change, then a settled reading and a
   PLATEAU / STILL GROWING verdict (slope of changes 6–10).
6. **Fallback 1b built in:** strategy switch Stream / Download → play file (native download to disk,
   newest 4 kept). Auto-fallback: no audio within 8 s on a stream → retry as file.
7. **Diagnostics screen (one button):** B1/B2 = 440 Hz oscillator beep (no `<Audio>` tag: does the
   context render?), then #1–#7 = control MP3 vs YouTube itag 140 / 251 × stream / JS buffer / disk
   file × direct / graph. For each case it logs which loading path the library took (`HEAD` /
   `Accept-Ranges` / `Range` status), load time, first tick, max position, RMS, buffering events,
   errors and memory.

**FFmpeg is required for streaming:** the `Audio` tag streams remote files over HTTP Range requests
**only when FFmpeg is in the build**; without it, the whole file downloads before playback
(react-native-audio-api 1.0.1 `Audio.d.ts`). So `enableFFmpeg: true` is needed for D8, not just for
OGG/Opus.

## S1: OnDeviceResolver (`packages/core`)

Run on 2026-11-18 from the dev PC (`npm run test:live` in `packages/core`).

| Video | Winner | itag | Type | kbps | Size | Resolve time | URL valid for |
|---|---|---|---|---|---|---|---|
| dQw4w9WgXcQ | IOS | 140 | audio/mp4 | 131 | 3.29 MB | 850 ms (includes visitorData) | 5 h (capped) |
| kJQP7kiw5Fk | IOS | 140 | audio/mp4 | 131 | 4.35 MB | 352 ms | 5 h |
| fJ9rUzIMcZQ | IOS | 140 | audio/mp4 | 149 | 5.55 MB | 275 ms | 5 h |

**User-Agent matrix** (`Range: bytes=0-0` probe on the resolved URL):

| Client | client UA | AppleCoreMedia (iOS player) | Safari | no UA |
|---|---|---|---|---|
| IOS (3 videos) | 206 | 206 | 206 | 206 |

So `IOS` URLs play with **any** User-Agent. The `<Audio>` tag doesn't need custom headers for them
(fallback 1a in PLAN.md is already met). Bb still sends the client UA, to match the desktop.

**Client profiles:**
- `IOS`: 6/6 resolves.
- `ANDROID_MUSIC`: **LOGIN_REQUIRED** for 3/3 videos ("Please sign in"). Disabled in `clients.json` v2.
- `ANDROID_VR` (tried as a second profile, not added): 1/3, then "Sign in to confirm you're not a bot".

**Consequence (risk R1):** only one working profile right now. Finding a second one is a config
change (remote `clients.json`), not a code change. The resolver already tries every enabled profile
in parallel and logs each failure reason.

**Also in `packages/core`:** strict zod schema for `clients.json` (unknown fields rejected, YouTube
hosts only, https only), the 5-hour URL age rule, a range probe that aborts after headers, an ESLint
ban on Node built-ins / `Buffer` / `process` / React Native (checked with a probe file: 5/5 caught),
and the credential guard (D20, hashes only). 28 unit tests + 6 live tests pass.
