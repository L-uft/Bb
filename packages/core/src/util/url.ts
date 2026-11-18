/**
 * Reads one query parameter without URL/URLSearchParams (React Native's URL
 * implementation has historically been incomplete). Handles both raw and
 * percent-encoded separators, e.g. "?expire=1" and "%3Fexpire%3D1".
 */
export function getQueryParam(url: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = url.match(new RegExp(`(?:[?&]|%3F|%26)${escaped}(?:=|%3D)([^&#%]*)`, 'i'));
  if (!m || m[1] === undefined) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export function hostOf(url: string): string {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i);
  return m?.[1]?.toLowerCase() ?? '';
}
