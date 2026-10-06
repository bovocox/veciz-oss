# veciz-oss

Small, dependency-free building blocks extracted from [Veciz AI](https://veciz.ai), an iOS app that turns the YouTube channels you follow into short written summaries.

- **Transcript chain** — fetch YouTube captions through a chain of providers ([Supadata](https://supadata.ai) → [ScrapeCreators](https://scrapecreators.com)), with per-provider API key rotation, native-captions-only by default, and a clear "no captions" vs. "couldn't fetch" result.
- **`capsSafe` / `upperTr`** — Turkish-safe uppercasing for UI labels (React Native's `textTransform: 'uppercase'` turns `i` into `I` instead of `İ`).

Requires Node.js 22.18+ (runs the TypeScript sources directly). No runtime dependencies.

## Transcript chain

```ts
import { createTranscriptChain, supadataProvider, scrapeCreatorsProvider } from 'veciz-oss';

const fetchTranscript = createTranscriptChain([
  // Cheapest / renewing quota first: free Supadata keys renew monthly…
  supadataProvider({ apiKeys: process.env.SUPADATA_KEYS!.split(',') }),
  // …prepaid ScrapeCreators credits never expire, so they make a good fallback.
  scrapeCreatorsProvider({ apiKeys: [process.env.SCRAPECREATORS_KEY!] }),
]);

const t = await fetchTranscript('dQw4w9WgXcQ', { lang: 'tr' });
console.log(t.provider, t.lang, t.segments.length);
// t.segments: [{ text, offsetMs, durationMs }]
```

### Why these defaults

These came out of running a summary pipeline in production on small free-tier quotas:

- **Native captions only.** Supadata's `mode=auto` silently falls back to AI transcription, billed per *minute* of video. A handful of long, caption-less videos can drain a monthly quota in a day. `mode: 'native'` costs one credit per request regardless of length; caption-less videos come back as `unavailable`.
- **One request per video.** Don't probe languages with a separate full transcript request — that doubles the cost. Ask for the preferred language; providers return the original track when it's missing.
- **Free second opinions.** ScrapeCreators doesn't charge for empty or not-found answers, so the chain keeps going after an `unavailable` by default (`stopOnUnavailable: false`).
- **Bench exhausted keys.** `429`/`402` take a key out of rotation instead of retrying it on every job; when all keys are benched the provider answers `skip` immediately and the chain moves on.
- **Long videos.** Supadata answers long videos with an async job id; the provider polls it (default 3 min timeout) instead of re-requesting, which would start a new billed job.

### Results and errors

| Provider result | Meaning |
| --- | --- |
| `ok` | transcript returned |
| `unavailable` | the video has no usable captions (or doesn't exist) |
| `skip` | the provider couldn't answer (no key, quota, rate limit, network, 5xx) |

The chain resolves with the first `ok`. Otherwise it rejects with `TranscriptUnavailableError` if any provider said "no captions", or `TranscriptFetchError` if every provider was skipped. Both carry `attempts: { provider, reason }[]`. Pass `onAttempt` to log every step.

### Writing a provider

```ts
import type { TranscriptProvider } from 'veciz-oss';

const myProvider: TranscriptProvider = {
  name: 'my-provider',
  async fetchTranscript(videoId, { lang } = {}) {
    // return { kind: 'ok', transcript } | { kind: 'unavailable', reason } | { kind: 'skip', reason }
  },
};
```

`KeyPool` (round-robin with cooldown) is exported for your own providers.

## Turkish-safe uppercasing

```tsx
import { capsSafe, upperTr } from 'veciz-oss';

<Text style={{ textTransform: 'uppercase' }}>{capsSafe('Bugün için', lang)}</Text>
// renders "BUGÜN İÇİN" instead of "BUGÜN IÇIN"

upperTr('istanbul premium', { preserve: ['premium'] }); // "İSTANBUL PREMIUM"
```

`capsSafe` only maps `i → İ` (the dotless `ı → I` is already correct) and passes non-Turkic languages through untouched. `preserve` keeps brand words in their Latin uppercase form.

## Development

```bash
npm test
```

## License

MIT
