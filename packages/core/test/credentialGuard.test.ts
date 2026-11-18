// D20: upstream Riff ships third-party credentials that belong to its developer
// (Last.fm key/secret, a SoundCloud client_id, a Google OAuth client id). They must
// never be copied into Bb. Only SHA-256 hashes are stored here, so the keys
// themselves never enter this repo.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN_SHA256: Record<string, string> = {
  ef64d15a5efecdb3b5db1368b6f1454f0a3c7b5f3082e75149a6ba3bdc019f73: 'Last.fm default API key',
  '81cd83606b5281b4e4fcc79671a1ed0bc30adec59bb447b3775dba72705e111e': 'Last.fm default API secret',
  d62bd812b34bcde920a2c353ef194f42bbe14548cec048e57b2bcdb3de2f77f4: 'Last.fm inline API key',
  '6e886ce90254de56cebe66abdb7f733bf3a10d2aa05a029b8c5aafacf3e0c068': 'SoundCloud fallback client_id',
  '8dc41acf430856f9399da94ec526b76bed93178222a0cb20ec03ccf4222f4cce': 'Google OAuth client id',
};

const REPO = resolve(__dirname, '../../..');
const SCAN_ROOTS = ['packages/core/src', 'packages/core/test', 'apps/mobile/src', 'apps/mobile/plugins', 'apps/mobile/app.json'];
const TEXT_EXT = /\.(ts|tsx|js|jsx|json|md)$/;

function* files(path: string): Generator<string> {
  let st;
  try {
    st = statSync(path);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (TEXT_EXT.test(path)) yield path;
    return;
  }
  for (const name of readdirSync(path)) {
    if (name === 'node_modules') continue;
    yield* files(join(path, name));
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('credential guard (D14/D20)', () => {
  it('finds none of the upstream third-party credentials in Bb sources', () => {
    const hits: string[] = [];
    let scanned = 0;
    for (const root of SCAN_ROOTS) {
      for (const file of files(join(REPO, root))) {
        scanned++;
        const text = readFileSync(file, 'utf8');
        const tokens = new Set([
          ...(text.match(/[A-Za-z0-9]{32}/g) ?? []),
          ...(text.match(/\d{6,}-[a-z0-9]+\.apps\.googleusercontent\.com/g) ?? []),
        ]);
        for (const t of tokens) {
          const label = FORBIDDEN_SHA256[sha256(t)];
          if (label) hits.push(`${file.slice(REPO.length + 1)}: ${label}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(5);
    expect(hits).toEqual([]);
  });

  it('would catch a credential (self-test against upstream server.js)', () => {
    const upstream = readFileSync(join(REPO, 'src/server/server.js'), 'utf8');
    const found = new Set(
      (upstream.match(/[A-Za-z0-9]{32}/g) ?? []).map((t) => FORBIDDEN_SHA256[sha256(t)]).filter(Boolean),
    );
    expect(found.size).toBeGreaterThanOrEqual(3);
  });
});
