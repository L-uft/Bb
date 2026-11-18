# Bb: navigation and screens

Stack: Expo Router (file-based routes), bottom tabs, native stack for detail screens, a native
modal for the full-screen player, and bottom sheets for the queue, EQ and track actions.
English UI, written with `start`/`end` (never `left`/`right`) so RTL can be added later.

## Route tree (`apps/mobile/app/`)

```
app/
├── _layout.tsx                  Root: providers (theme, PlayerService, query cache), error boundary → Logger
├── (tabs)/
│   ├── _layout.tsx              Bottom tabs + <MiniPlayer/> docked above the tab bar
│   ├── home.tsx                 Home                                 (v1.1)
│   ├── index.tsx                Search (first tab in v1)
│   ├── library/
│   │   ├── index.tsx            Library hub
│   │   ├── liked.tsx            Liked songs
│   │   ├── history.tsx          History
│   │   ├── local.tsx            Local files (+ "Import from Files")
│   │   ├── downloads.tsx        Offline downloads (+ storage used)
│   │   └── albums.tsx           Saved albums                         (v1.1)
│   └── settings/
│       ├── index.tsx            Settings hub
│       ├── playback.tsx         Quality, (v1.1: crossfade/explicit)
│       ├── storage.tsx          Storage used, clear cache, clear downloads
│       ├── account.tsx          Import desktop account (.rfacc)        (v1.1)
│       ├── youtube-config.tsx   Active clients.json: version + source (bundled / remote / cached)
│       ├── logs.tsx             Log viewer + "Share log file" + diagnostics header
│       ├── about.tsx            Bb, version, "Based on Riff by rootscripts (MIT)"
│       ├── licenses.tsx         Open-source licenses
│       └── resolver.tsx         RemoteResolver URL + token, off by default  (v2)
├── playlist/[id].tsx            Playlist detail
├── album/[id].tsx               Album                                       (v1.1)
├── artist/[id].tsx              Artist                                      (v1.1)
├── player.tsx                   Full-screen player (modal, swipe down to close)
├── queue.tsx                    Queue (bottom sheet, opened from player or mini player)
├── eq.tsx                       Audio editor (bottom sheet): EQ + presets; v1.1 speed/pitch/reverb/sleep
├── track-actions.tsx            Track action sheet (play next, add to queue, add to playlist, like, download, share v2)
└── playlist-picker.tsx          "Add to playlist" sheet (+ create new)
```

Tabs in v1: **Search · Library · Settings**. **Home** is added as the first tab in v1.1. Queue and
lyrics live in the player instead of having their own tabs.

## Player architecture (UI side)

- `PlayerService` (singleton, outside React) owns the `AudioContext`, the `<Audio>` source, the node
  graph, the queue, and the lock-screen/remote wiring. UI code never touches audio nodes.
- UI reads player state from a Zustand store that `PlayerService` updates (track, position, buffering,
  queue, repeat/shuffle, EQ). UI actions call `PlayerService` methods (`play`, `seek`, `setEqBand`, …).
- Position updates go to the UI at ~4 Hz. Lyrics and visualizers subscribe to a faster channel
  (Reanimated shared values / Skia) so they don't re-render React trees.

## Screens

### Mini player (docked above the tabs, every tab screen)

```
┌──────────────────────────────────────────────┐
│ [art]  Song title                 ▶ ❙❙   ⏭  │  ← tap: open player; swipe up: open player
│        Artist          ───────────── (thin progress line)
└──────────────────────────────────────────────┘
│     Search        Library        Settings    │   (v1.1: Home tab first)
```
Long-press opens the queue sheet. Hidden when nothing is loaded.

### Full-screen player (`player.tsx`)

```
┌──────────────────────────────────────┐
│  ⌄                Now playing      ⋯ │  ⋯ → track actions
│                                      │
│        ┌──────────────────────┐      │
│        │                      │      │  Artwork. Tap the lyrics button to
│        │      album art       │      │  swap it with synced lyrics.
│        │                      │      │
│        └──────────────────────┘      │
│  Song title                      ♡   │
│  Artist                              │
│  ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │  scrubber
│  1:12                         -2:40  │
│     🔀     ⏮      ▶/❙❙      ⏭     🔁 │
│  [lyrics]     [EQ]      [queue]  ⬇   │  ⬇ = download for offline
└──────────────────────────────────────┘
```
The background tint comes from the album-art accent (dynamic color). In v1.1 a visualizer strip goes
under the artwork.

### Lyrics (inside the player)

```
│   previous line (dim)                │
│ ▶ CURRENT LINE (bright, larger)      │  auto-scroll, tap any line to seek
│   next line (dim)                    │  Arabic/Hebrew lines are right-aligned automatically
│                       [offset ±] v1.1│
```
States: loading · "No synced lyrics found" (falls back to plain lyrics if lrclib has them) ·
instrumental · offline with cached lyrics.

### Queue sheet (`queue.tsx`)

```
┌──────────────────────────────────────┐
│ ─────  Queue                Clear     │
│ Now playing: Song — Artist            │
│ Next up                               │
│ ≡ [art] Song 2 — Artist          ✕    │  drag ≡ to reorder, swipe to remove
│ ≡ [art] Song 3 — Artist          ✕    │
│ ...                                   │
│ (v1.1) Autoplay: similar tracks  [on] │
└──────────────────────────────────────┘
```

### Home (`(tabs)/home.tsx`, v1.1)

Local sections: **Continue listening** (last session), **Recently played**, **Your playlists**,
**Liked songs** (shortcut). Online sections: **Hot picks**, **Trending**, **Top chart (country)**.

### Search (`(tabs)/index.tsx`, the first tab in v1)

Search field with debounce. Recent searches when empty. Results come from YT Music ("Songs");
v1.1 adds "Albums" and "Artists" chips and a SoundCloud source chip. Each row: art, title, artist,
duration, explicit badge, ⋯ (track actions). Tap = play now, which replaces the queue with the result
list starting at that row.

### Library (`(tabs)/library/index.tsx`)

```
│ Liked songs            128 ›         │
│ Downloads               42 ›  1.3 GB │
│ Local files             17 ›         │
│ History                    ›         │
│ Playlists          [+ New playlist]  │
│ [cover] Road trip           34 songs │
│ [cover] Focus               12 songs │
```

### Audio editor (`eq.tsx`, bottom sheet)

```
│ Presets: [Flat] [Bass boost] [Vocal] [Treble] [My preset…] [+ Save] │
│  32  64  125 250 500  1k  2k  4k  8k  16k                          │
│  ┃   ┃   ┃   ┃   ┃   ┃   ┃   ┃   ┃   ┃    vertical sliders ±12 dB │
│ [Reset]                                                [EQ on/off] │
│ v1.1: Speed · Pitch · Reverb · Echo · Sleep timer                  │
```

### Settings (`(tabs)/settings/index.tsx`)

Playback & quality · Storage & downloads · YouTube config (active `clients.json` version + source) ·
Logs & diagnostics · About · Open-source licenses · (v1.1) Import from desktop (.rfacc) ·
(v2) Integrations: Last.fm, Spotify, RemoteResolver.

## Every screen

- Loading (skeleton rows), empty state (icon + one line + action), error state (message + Retry; the
  error is also sent to the Logger).
- Safe areas (notch, home indicator), Dynamic Type friendly, minimum 44 pt touch targets.
- Haptics on primary actions: play/pause, like, add to queue, reorder drop, download start.
- VoiceOver labels on every icon button ("Play", "Next track", "Like Song by Artist", …).
