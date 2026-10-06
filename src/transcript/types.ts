export interface TranscriptSegment {
  text: string;
  /** Start of the segment, milliseconds from the beginning of the video. */
  offsetMs: number;
  /** Segment length in milliseconds. */
  durationMs: number;
}

export interface Transcript {
  segments: TranscriptSegment[];
  /** Base language code of the returned track, e.g. "tr", "en". */
  lang: string;
  /** Base language codes of every caption track the video has. */
  availableLangs: string[];
  /** Name of the provider that produced this transcript. */
  provider: string;
}

/**
 * What a provider can answer:
 * - `ok`: a transcript was returned
 * - `unavailable`: the provider is sure the video has no usable captions (or does not exist)
 * - `skip`: the provider could not answer (no key, quota, network, 5xx); try the next one
 */
export type ProviderResult =
  | { kind: 'ok'; transcript: Transcript }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'skip'; reason: string };

export interface FetchOptions {
  /** Preferred language (ISO 639-1). Providers fall back to the video's original track. */
  lang?: string;
}

export interface TranscriptProvider {
  readonly name: string;
  fetchTranscript(videoId: string, options?: FetchOptions): Promise<ProviderResult>;
}

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}>;
