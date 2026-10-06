import { KeyPool } from './keyPool.ts';
import type { FetchLike, FetchOptions, ProviderResult, TranscriptProvider } from './types.ts';

const API = 'https://api.scrapecreators.com/v1/youtube/video/transcript';

export interface ScrapeCreatorsOptions {
  apiKeys: string[];
  fetch?: FetchLike;
}

interface ScResponse {
  success?: boolean;
  notFound?: boolean;
  language?: string | null;
  transcript?: { text: string; startMs: string | number; endMs: string | number }[];
  captionTracks?: { languageCode?: string; name?: { simpleText?: string } }[];
  message?: string;
}

const base = (code?: string) => (code || '').split('-')[0].toLowerCase();

/**
 * https://docs.scrapecreators.com — reads existing YouTube captions (including auto-generated
 * "asr" tracks). 1 credit per request; empty / not-found answers are not charged, so asking
 * again without a language when the preferred one is missing costs nothing.
 */
export function scrapeCreatorsProvider(options: ScrapeCreatorsOptions): TranscriptProvider {
  const pool = new KeyPool(options.apiKeys);
  const doFetch: FetchLike = options.fetch ?? (globalThis.fetch as unknown as FetchLike);

  const request = async (key: string, videoId: string, lang?: string): Promise<{ status: number; body: ScResponse }> => {
    const q = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${videoId}` });
    if (lang) q.set('language', lang);
    const res = await doFetch(`${API}?${q}`, { headers: { 'x-api-key': key } });
    return { status: res.status, body: res.status < 400 ? await res.json() : {} };
  };

  return {
    name: 'scrapecreators',
    async fetchTranscript(videoId: string, opts: FetchOptions = {}): Promise<ProviderResult> {
      const key = pool.next();
      if (!key) return { kind: 'skip', reason: pool.size ? 'all keys cooling down' : 'no api key' };
      const wanted = opts.lang && opts.lang !== 'auto' ? base(opts.lang) : undefined;

      try {
        let { status, body } = await request(key, videoId, wanted);
        if ([401, 402, 403, 429].includes(status)) {
          pool.bench(key);
          return { kind: 'skip', reason: `HTTP ${status}` };
        }
        if (status >= 400) return { kind: 'skip', reason: `HTTP ${status}` };
        if (body.notFound) return { kind: 'unavailable', reason: 'video not found' };

        // Preferred language missing → empty, uncharged answer. Ask for the original track instead.
        let usedLang = wanted;
        if (wanted && !(body.transcript && body.transcript.length)) {
          ({ status, body } = await request(key, videoId));
          if (status >= 400) return { kind: 'skip', reason: `HTTP ${status}` };
          usedLang = undefined;
        }
        if (body.success === false) return { kind: 'skip', reason: body.message || 'success=false' };

        const raw = (body.transcript || []).filter((s) => s && typeof s.text === 'string' && s.text.trim());
        if (raw.length === 0) return { kind: 'unavailable', reason: 'no captions' };

        const tracks = body.captionTracks || [];
        // `language` is a display name ("Turkish"); the code lives on the matching caption track.
        const byName = tracks.find(
          (t) => body.language && t.name?.simpleText?.toLowerCase().startsWith(String(body.language).toLowerCase())
        );
        const lang = usedLang || base(byName?.languageCode || tracks[0]?.languageCode) || 'auto';

        return {
          kind: 'ok',
          transcript: {
            segments: raw.map((s) => {
              const start = Number(s.startMs) || 0;
              const end = Number(s.endMs) || start;
              return { text: s.text, offsetMs: start, durationMs: Math.max(0, end - start) };
            }),
            lang,
            availableLangs: [...new Set(tracks.map((t) => base(t.languageCode)).filter(Boolean))],
            provider: 'scrapecreators',
          },
        };
      } catch (e) {
        return { kind: 'skip', reason: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
