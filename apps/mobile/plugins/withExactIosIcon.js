// Config plugin: ship the iOS app icon byte-for-byte as provided.
//
// Expo's built-in icon step (@expo/prebuild-config withIosIcons) flattens the
// light and tinted 1024px icons onto solid white (removeTransparency +
// backgroundColor '#ffffff'). Bb's icon must be used exactly as is, with its
// transparency kept, so after every other mod has run this plugin overwrites
// the generated light/dark/tinted files with the original PNG.
// CI verifies the result with SHA-256 (see .github/workflows/mobile-ios.yml).
const fs = require('fs');
const path = require('path');
const { withFinalizedMod } = require('expo/config-plugins');

const ICON_FILES = [
  'App-Icon-1024x1024@1x.png', // light ("any")
  'App-Icon-dark-1024x1024@1x.png',
  'App-Icon-tinted-1024x1024@1x.png',
];

/** Finds ios/<ProjectName>/Images.xcassets/AppIcon.appiconset. */
function findAppIconSet(iosRoot) {
  for (const entry of fs.readdirSync(iosRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(iosRoot, entry.name, 'Images.xcassets', 'AppIcon.appiconset');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Copies the source icon over every generated variant. Returns the files written. */
function overwriteIcons(iosRoot, sourceIcon) {
  const iconSet = findAppIconSet(iosRoot);
  if (!iconSet) throw new Error(`[withExactIosIcon] AppIcon.appiconset not found under ${iosRoot}`);
  if (!fs.existsSync(sourceIcon)) throw new Error(`[withExactIosIcon] source icon not found: ${sourceIcon}`);
  const written = [];
  for (const name of ICON_FILES) {
    const target = path.join(iconSet, name);
    if (!fs.existsSync(target)) continue; // variant not configured
    fs.copyFileSync(sourceIcon, target);
    written.push(target);
  }
  if (written.length === 0) throw new Error(`[withExactIosIcon] no generated icon files found in ${iconSet}`);
  return written;
}

const withExactIosIcon = (config, props = {}) =>
  withFinalizedMod(config, [
    'ios',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const sourceIcon = path.resolve(projectRoot, props.icon || './assets/brand/bb-icon-1024.png');
      const written = overwriteIcons(cfg.modRequest.platformProjectRoot, sourceIcon);
      console.log(`[withExactIosIcon] restored original icon in ${written.length} file(s)`);
      return cfg;
    },
  ]);

module.exports = withExactIosIcon;
module.exports.overwriteIcons = overwriteIcons;
module.exports.ICON_FILES = ICON_FILES;
