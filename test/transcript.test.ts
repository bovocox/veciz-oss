import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTranscriptChain,
  supadataProvider,
  scrapeCreatorsProvider,
  KeyPool,
  TranscriptUnavailableError,
  TranscriptFetchError,
} from '../src/index.ts';
import type { FetchLike } from '../src/index.ts';

type Route = (url: string, headers: Record<string, string>) => { status: number; body?: any };
const mockFetch = (route: Route, calls: string[] = []): FetchLike => async (url, init) => {
  calls.push(url);
  const { status, body } = route(url, init?.headers ?? {});
  return { status, json: async () => body, text: async () => JSON.stringify(body) };
};

test('KeyPool rotates and benches keys', () => {
  let now = 0;
  const pool = new KeyPool(['a', 'b'], { cooldownMs: 100, now: () => now });
  assert.equal(pool.next(), 'a');
  assert.equal(pool.next(), 'b');
  pool.bench('a');
  assert.equal(pool.next(), 'b');
  pool.bench('b');
  assert.equal(pool.next(), null);
  now = 101;
  assert.equal(pool.next(), 'a');
});

test('supadata: native mode, segments mapped', async () => {
  const calls: string[] = [];
  const p = supadataProvider({
    apiKeys: ['k1'],
    fetch: mockFetch(() => ({ status: 200, body: { content: [{ text: 'merhaba', offset: 40, duration: 3000 }], lang: 'tr', availableLangs: ['tr'] } }), calls),
  });
  const r = await p.fetchTranscript('abc', { lang: 'tr' });
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') {
    assert.deepEqual(r.transcript.segments, [{ text: 'merhaba', offsetMs: 40, durationMs: 3000 }]);
    assert.equal(r.transcript.lang, 'tr');
  }
  assert.match(calls[0], /mode=native/);
  assert.match(calls[0], /lang=tr/);
});

test('supadata: 206 is a definitive "no captions"', async () => {
  const p = supadataProvider({ apiKeys: ['k1'], fetch: mockFetch(() => ({ status: 206 })) });
  assert.equal((await p.fetchTranscript('abc')).kind, 'unavailable');
});

test('supadata: 429 benches the key, then the pool is empty', async () => {
  const p = supadataProvider({ apiKeys: ['k1'], fetch: mockFetch(() => ({ status: 429 })) });
  assert.deepEqual(await p.fetchTranscript('abc'), { kind: 'skip', reason: 'HTTP 429' });
  assert.deepEqual(await p.fetchTranscript('abc'), { kind: 'skip', reason: 'all keys cooling down' });
});

test('supadata: polls async jobs', async () => {
  let polls = 0;
  const p = supadataProvider({
    apiKeys: ['k1'],
    sleep: async () => {},
    fetch: mockFetch((url) => {
      if (url.includes('/transcript/job-1')) {
        polls++;
        return polls < 2 ? { status: 200, body: { status: 'active' } } : { status: 200, body: { status: 'completed', content: 'a\nb', lang: 'en' } };
      }
      return { status: 202, body: { jobId: 'job-1' } };
    }),
  });
  const r = await p.fetchTranscript('abc');
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.equal(r.transcript.segments.length, 2);
});

test('scrapecreators: falls back to the original track when the preferred language is missing', async () => {
  const calls: string[] = [];
  const p = scrapeCreatorsProvider({
    apiKeys: ['k1'],
    fetch: mockFetch((url) => {
      if (url.includes('language=en')) return { status: 200, body: { success: true, language: null } };
      return {
        status: 200,
        body: {
          success: true,
          language: 'Turkish',
          transcript: [{ text: 'Herkese merhaba', startMs: '40', endMs: '3439' }],
          captionTracks: [{ languageCode: 'tr', name: { simpleText: 'Turkish (auto-generated)' } }],
        },
      };
    }, calls),
  });
  const r = await p.fetchTranscript('abc', { lang: 'en' });
  assert.equal(calls.length, 2);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') {
    assert.equal(r.transcript.lang, 'tr');
    assert.deepEqual(r.transcript.segments[0], { text: 'Herkese merhaba', offsetMs: 40, durationMs: 3399 });
  }
});

test('scrapecreators: notFound is unavailable', async () => {
  const p = scrapeCreatorsProvider({ apiKeys: ['k1'], fetch: mockFetch(() => ({ status: 200, body: { success: true, notFound: true } })) });
  assert.equal((await p.fetchTranscript('abc')).kind, 'unavailable');
});

test('chain: first provider out of quota, second answers', async () => {
  const seen: string[] = [];
  const fetchTranscript = createTranscriptChain(
    [
      supadataProvider({ apiKeys: [], fetch: mockFetch(() => ({ status: 500 })) }),
      scrapeCreatorsProvider({
        apiKeys: ['k'],
        fetch: mockFetch(() => ({ status: 200, body: { success: true, transcript: [{ text: 'hi', startMs: 0, endMs: 1000 }], captionTracks: [{ languageCode: 'en' }] } })),
      }),
    ],
    { onAttempt: (name, result) => seen.push(`${name}:${result}`) }
  );
  const t = await fetchTranscript('abc');
  assert.equal(t.provider, 'scrapecreators');
  assert.deepEqual(seen, ['supadata:skip', 'scrapecreators:ok']);
});

test('chain: unavailable vs fetch errors', async () => {
  const none = createTranscriptChain([supadataProvider({ apiKeys: ['k'], fetch: mockFetch(() => ({ status: 206 })) })]);
  await assert.rejects(none('abc'), TranscriptUnavailableError);
  const down = createTranscriptChain([supadataProvider({ apiKeys: ['k'], fetch: mockFetch(() => ({ status: 503 })) })]);
  await assert.rejects(down('abc'), TranscriptFetchError);
});
