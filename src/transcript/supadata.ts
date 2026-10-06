import { KeyPool } from './keyPool.ts';
import type { FetchLike, FetchOptions, ProviderResult, TranscriptProvider, TranscriptSegment } from './types.ts';

const API = 'https://api.supadata.ai/v1';

export interface SupadataOptions {
  apiKeys: string[];
  /**
   * `native` (default) only reads captions the video already has: 1 credit per request
   * regardless of video length. `auto` / `generate` fall back to AI transcription, billed
   * per minute of video, which can drain a small quota with a few long videos.
   */
  mode?: 'native' | 'auto' | 'generate';
  /** Max time to wait for an async job (long videos return a job id). */
  jobTimeoutMs?: number;
  pollIntervalMs?: number;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

type Content = string | { text: string; offset: number; duration: number }[];

function toSegments(content: Content): TranscriptSegment[] {
  if (Array.isArray(content)) {
    return content
      .filter((s) => s && typeof s.text === 'string' && s.text.trim())
      .map((s) => ({ text: s.text, offsetMs: Number(s.offset) || 0, durationMs: Number(s.duration) || 0 }));
  }
  // Plain-text transcripts carry no timing: one segment per line, evenly spaced.
  return String(content || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text, i) => ({ text, offsetMs: i * 5000, durationMs: 5000 }));
}

const base = (code?: string) => (code || '').split('-')[0].toLowerCase();

/** https://docs.supadata.ai — YouTube transcript provider with key rotation and async-job polling. */
export function supadataProvider(options: SupadataOptions): TranscriptProvider {
  const pool = new KeyPool(options.apiKeys);
  const doFetch: FetchLike = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const mode = options.mode ?? 'native';
  const jobTimeoutMs = options.jobTimeoutMs ?? 180_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;

  async function pollJob(jobId: string, key: string): Promise<any> {
    const started = Date.now();
    while (Date.now() - started < jobTimeoutMs) {
      const res = await doFetch(`${API}/transcript/${jobId}`, { headers: { 'x-api-key': key } });
      const body = await res.json();
      if (body?.status === 'completed') return body;
      if (body?.status === 'failed') throw new Error(body?.error || 'job failed');
      await sleep(pollIntervalMs);
    }
    throw new Error('job polling timeout');
  }

  return {
    name: 'supadata',
    async fetchTranscript(videoId: string, opts: FetchOptions = {}): Promise<ProviderResult> {
      const key = pool.next();
      if (!key) return { kind: 'skip', reason: pool.size ? 'all keys cooling down' : 'no api key' };

      const url = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);
      const lang = opts.lang && opts.lang !== 'auto' ? `&lang=${base(opts.lang)}` : '';
      try {
        const res = await doFetch(`${API}/transcript?url=${url}${lang}&mode=${mode}`, { headers: { 'x-api-key': key } });

        if (res.status === 429 || res.status === 402) {
          // Quota or rate limit: bench this key; a free-tier key renews monthly, so a long bench is fine.
          pool.bench(key);
          return { kind: 'skip', reason: `HTTP ${res.status}` };
        }
        if (res.status === 206) return { kind: 'unavailable', reason: 'transcript-unavailable' };
        if (res.status >= 400) return { kind: 'skip', reason: `HTTP ${res.status}` };

        let body = await res.json();
        if (body?.jobId) body = await pollJob(body.jobId, key);

        const segments = toSegments(body?.content);
        if (segments.length === 0) return { kind: 'unavailable', reason: 'empty transcript' };
        return {
          kind: 'ok',
          transcript: {
            segments,
            lang: base(body?.lang) || base(opts.lang) || 'auto',
            availableLangs: (body?.availableLangs || []).map(base),
            provider: 'supadata',
          },
        };
      } catch (e) {
        return { kind: 'skip', reason: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
