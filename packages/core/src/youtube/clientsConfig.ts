/**
 * YouTube client profiles (PLAN.md D5/D15). The bundled clients.json is the
 * baseline; a remote copy may override it, but only after passing this strict
 * schema: unknown fields are rejected and nothing is ever evaluated.
 */
import { z } from 'zod';
import bundledJson from './clients.json';

/**
 * Remote override location (PLAN.md D15): the copy on the fork's `mobile` branch.
 * The fork is L-uft/Bb. Change it here and nowhere else.
 */
export const REMOTE_CLIENTS_CONFIG_URL =
  'https://raw.githubusercontent.com/L-uft/Bb/mobile/packages/core/src/youtube/clients.json';

const httpsUrl = z.string().url().refine((u) => u.startsWith('https://'), 'must be https');
const host = z.string().regex(/^[a-z0-9.-]+\.(youtube|google|googleapis)\.com$/, 'unexpected host');
const userAgent = z.string().min(8).max(300);

export const PlayerClientSchema = z
  .object({
    name: z.string().regex(/^[A-Z0-9_]{2,40}$/),
    enabled: z.boolean(),
    host,
    clientName: z.string().regex(/^[A-Z0-9_]{2,40}$/),
    clientVersion: z.string().regex(/^[0-9][0-9.]{0,30}$/),
    userAgent,
    deviceMake: z.string().max(40).optional(),
    deviceModel: z.string().max(40).optional(),
    osName: z.string().max(40).optional(),
    osVersion: z.string().max(40).optional(),
    androidSdkVersion: z.number().int().min(1).max(99).optional(),
  })
  .strict();

export const ClientsConfigSchema = z
  .object({
    version: z.number().int().min(1),
    updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    locale: z.object({ hl: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), gl: z.string().regex(/^[A-Z]{2}$/) }).strict(),
    timeouts: z
      .object({
        playerMs: z.number().int().min(1000).max(60000),
        probeMs: z.number().int().min(1000).max(60000),
        visitorDataMs: z.number().int().min(500).max(60000),
      })
      .strict(),
    visitorData: z
      .object({ url: httpsUrl, userAgent, maxAgeMs: z.number().int().min(60000).max(86400000) })
      .strict(),
    player: z.array(PlayerClientSchema).min(1).max(10),
    googlevideoUserAgents: z.record(z.string().regex(/^[A-Z0-9_]{2,40}$/), userAgent),
    fallbackGooglevideoClient: z.string().regex(/^[A-Z0-9_]{2,40}$/),
    itags: z
      .object({
        standard: z.array(z.number().int().min(1).max(999)).min(1).max(10),
        low: z.array(z.number().int().min(1).max(999)).min(1).max(10),
      })
      .strict(),
  })
  .strict()
  .refine((c) => c.player.some((p) => p.enabled), 'at least one player client must be enabled')
  .refine((c) => c.fallbackGooglevideoClient in c.googlevideoUserAgents, 'fallbackGooglevideoClient must exist in googlevideoUserAgents');

export type ClientsConfig = z.infer<typeof ClientsConfigSchema>;
export type PlayerClient = z.infer<typeof PlayerClientSchema>;
export type AudioQuality = keyof ClientsConfig['itags'];

export type ParseResult = { ok: true; config: ClientsConfig } | { ok: false; error: string };

/** Validates untrusted JSON (already parsed) against the strict schema. */
export function parseClientsConfig(json: unknown): ParseResult {
  const r = ClientsConfigSchema.safeParse(json);
  if (r.success) return { ok: true, config: r.data };
  const first = r.error.issues[0];
  return { ok: false, error: first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid config' };
}

const bundled = parseClientsConfig(bundledJson);
if (!bundled.ok) throw new Error(`Bundled clients.json is invalid: ${bundled.error}`);

/** The copy shipped inside the app. Always valid (checked at import and in tests). */
export const BUNDLED_CLIENTS_CONFIG: ClientsConfig = bundled.config;

/** User-Agent googlevideo expects for a stream URL, chosen by its `c=` client param. */
export function googlevideoUserAgentFor(config: ClientsConfig, clientParam: string | undefined): string {
  const c = (clientParam ?? '').toUpperCase();
  const table = config.googlevideoUserAgents;
  if (c && table[c]) return table[c];
  if (c.startsWith('ANDROID') && table.ANDROID) return table.ANDROID;
  if ((c === 'WEB_REMIX' || c === 'MWEB') && table.WEB) return table.WEB;
  return table[config.fallbackGooglevideoClient] as string;
}
