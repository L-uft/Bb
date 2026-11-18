// In-memory event log (ring buffer). The spike screens show it and can share it as text.
// S5 adds the persistent log file on top of this.
import { useSyncExternalStore } from 'react';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
  t: number;
  level: LogLevel;
  tag: string;
  msg: string;
}

const MAX_ENTRIES = 800;
const entries: LogEntry[] = [];
const listeners = new Set<() => void>();
let version = 0;

function stringify(data: unknown): string {
  if (data instanceof Error) return `${data.name}: ${data.message}`;
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, '0');
}

export function formatTime(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export const eventLog = {
  add(level: LogLevel, tag: string, msg: string, data?: unknown) {
    const text = data === undefined ? msg : `${msg} ${stringify(data)}`;
    entries.push({ t: Date.now(), level, tag, msg: text });
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    version++;
    listeners.forEach((l) => l());
    if (__DEV__) console.log(`[${level}] ${tag}: ${text}`);
  },
  debug: (tag: string, msg: string, data?: unknown) => eventLog.add('debug', tag, msg, data),
  info: (tag: string, msg: string, data?: unknown) => eventLog.add('info', tag, msg, data),
  warn: (tag: string, msg: string, data?: unknown) => eventLog.add('warn', tag, msg, data),
  error: (tag: string, msg: string, data?: unknown) => eventLog.add('error', tag, msg, data),
  all: (): readonly LogEntry[] => entries,
  toText(): string {
    return entries.map((e) => `${formatTime(e.t)} ${e.level.toUpperCase().padEnd(5)} ${e.tag}: ${e.msg}`).join('\n');
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  version: () => version,
};

/** Newest first, at most `limit` entries; re-renders on every new entry. */
export function useEventLog(limit = 60, minLevel: LogLevel = 'debug'): LogEntry[] {
  useSyncExternalStore(eventLog.subscribe, eventLog.version);
  const rank: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const out: LogEntry[] = [];
  for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
    const e = entries[i]!;
    if (rank[e.level] >= rank[minLevel]) out.push(e);
  }
  return out;
}
