# Running Bb on your iPhone (Windows PC, free Apple ID)

This file grows through Phase 6. For now it covers installing the CI builds and the dev-client loop.

## The two builds

Every push to `mobile` that touches `apps/mobile/**` or `packages/core/**` runs **mobile-ios**
(GitHub → Actions → mobile-ios). Each run produces two unsigned apps:

| Artifact | What it is | Needs the PC? |
|---|---|---|
| `Bb-release-unsigned-run<N>` | JS bundled inside the app | No |
| `Bb-dev-unsigned-run<N>` | expo-dev-client: loads JS from Metro on your PC | Yes (same network) |

Both use bundle ID **`com.luft.bb`**, so installing one **replaces** the other (your app data is
kept). Only one Bb ever counts against the free Apple ID limit of 3 sideloaded apps.

Artifacts are kept 7 days. Downloading needs a GitHub login. Each download is a `.zip` that
contains the `.ipa`.

## One-time setup on the PC

1. **iTunes and iCloud, web versions.** Sideloadly needs the versions downloaded from Apple's site,
   not the Microsoft Store ones. If the Store versions are installed, uninstall them first. Download
   links: https://sideloadly.io (section "Windows").
2. **Sideloadly**: download from https://sideloadly.io and install.
3. **Firewall rule for Metro (dev-client only).** In PowerShell **as Administrator**:
   ```powershell
   New-NetFirewallRule -DisplayName "Bb Metro 8081" -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow -Profile Private
   ```
   Also check that the network is **Private**: Settings → Network & internet → (your connection) →
   Network profile type → Private.

## Install a build with Sideloadly

1. GitHub → Actions → **mobile-ios** → the newest green run → **Artifacts** → download
   `Bb-release-unsigned-run<N>` → unzip → `Bb-release-unsigned.ipa`.
2. Connect the iPhone with a cable and unlock it. Tap **Trust This Computer** and enter the passcode.
3. Open Sideloadly. Drag the `.ipa` onto it. Pick the iPhone in **iDevice**. Type your Apple ID email.
   Leave **Advanced options** alone; in particular, **don't change the bundle ID**.
4. Click **Start**. Enter your Apple ID password, and the 2-factor code if asked. Wait for **Done**.
5. On the iPhone:
   - **Developer Mode** (iOS 16 and later): Settings → Privacy & Security → **Developer Mode** → On →
     **Restart**. After the restart, tap **Turn On** and enter the passcode. (The switch only appears
     after the first sideloaded app is installed.)
   - **Trust your Apple ID**: Settings → General → **VPN & Device Management** → under
     "Developer App", tap your Apple ID → **Trust "…"** → Trust.
6. Open **Bb** from the home screen.

**Every 7 days** a free-account app stops opening. Run steps 3–4 again with the same `.ipa` (or
a newer one). The app's data is kept.

## Dev-client loop (JS changes without reinstalling)

1. Install `Bb-dev-unsigned-run<N>` with the steps above. It replaces the release build.
2. On the PC:
   ```powershell
   cd C:\Users\PC\Desktop\ios.mu.mp3\Bb\apps\mobile
   npm install        # first time, or after package.json changes
   npm start          # = expo start --dev-client, serves JS on port 8081
   ```
   The terminal shows a QR code and a URL like `http://192.168.x.x:8081`.
3. The iPhone must be on the **same router** (Wi-Fi), not on mobile data or a guest network.
4. Open the **Camera** on the iPhone, scan the QR code, and tap the banner. It opens Bb and connects.
   Alternative: open Bb → **Enter URL manually** → `http://<PC IPv4>:8081`.
   Find the PC address with `ipconfig` (the "IPv4 Address" of your active adapter).
5. Allow **Local Network** access when iOS asks. If you tapped Don't Allow: Settings →
   Privacy & Security → Local Network → Bb → On.
6. Edit code, save, and the app reloads. Shake the phone for the dev menu (Reload, etc.).

### If the iPhone can't connect

1. On the iPhone, open Safari → `http://<PC IPv4>:8081/status`. It should say
   `packager-status:running`.
   - If it times out: the firewall rule above is missing, the network is set to Public, or the phone
     is on another network or a guest Wi-Fi with client isolation.
   - If it works in Safari but not in Bb: allow Local Network for Bb (step 5).
2. Make sure only one `npm start` is running (port 8081 in use → Expo offers another port; use the
   URL it prints).
3. Last resort: `npx expo start --dev-client --tunnel` (slower; goes over the internet).

## If the app crashes on launch (before the log screen exists)

iPhone: Settings → Privacy & Security → Analytics & Improvements → **Analytics Data** → open the
newest entry that starts with `Bb` → share it (Share button at the top).
