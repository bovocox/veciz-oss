import type { FetchOptions, Transcript, TranscriptProvider } from './types.ts';

export class TranscriptUnavailableError extends Error {
  readonly attempts: { provider: string; reason: string }[];
  constructor(attempts: { provider: string; reason: string }[]) {
    super(`transcript unavailable (${attempts.map((a) => `${a.provider}: ${a.reason}`).join('; ')})`);
    this.name = 'TranscriptUnavailableError';
    this.attempts = attempts;
  }
}

export class TranscriptFetchError extends Error {
  readonly attempts: { provider: string; reason: string }[];
  constructor(attempts: { provider: string; reason: string }[]) {
    super(`no provider could fetch the transcript (${attempts.map((a) => `${a.provider}: ${a.reason}`).join('; ')})`);
    this.name = 'TranscriptFetchError';
    this.attempts = attempts;
  }
}

export interface ChainOptions {
  /**
   * Stop at the first provider that says "no captions". Off by default: a second opinion is
   * usually free (uncharged empty answer) and providers occasionally disagree.
   */
  stopOnUnavailable?: boolean;
  onAttempt?: (provider: string, result: 'ok' | 'unavailable' | 'skip', reason?: string) => void;
}

/**
 * Try providers in order — put the one with the cheapest / renewing quota first.
 * Resolves with the first transcript; rejects with TranscriptUnavailableError when at least one
 * provider said the video has no captions and none succeeded, otherwise TranscriptFetchError.
 */
export function createTranscriptChain(providers: TranscriptProvider[], options: ChainOptions = {}) {
  return async function fetchTranscript(videoId: string, fetchOptions: FetchOptions = {}): Promise<Transcript> {
    const attempts: { provider: string; reason: string }[] = [];
    let sawUnavailable = false;

    for (const p of providers) {
      const r = await p.fetchTranscript(videoId, fetchOptions);
      options.onAttempt?.(p.name, r.kind, r.kind === 'ok' ? undefined : r.reason);
      if (r.kind === 'ok') return r.transcript;
      attempts.push({ provider: p.name, reason: r.reason });
      if (r.kind === 'unavailable') {
        sawUnavailable = true;
        if (options.stopOnUnavailable) break;
      }
    }
    throw sawUnavailable ? new TranscriptUnavailableError(attempts) : new TranscriptFetchError(attempts);
  };
}
