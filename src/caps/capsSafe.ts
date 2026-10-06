/**
 * Turkish-safe uppercasing for UI labels.
 *
 * `textTransform: 'uppercase'` in React Native (and `toUpperCase()` without a locale) maps the
 * dotted "i" to "I" instead of "İ", so Turkish labels come out wrong: "Bugün için" →
 * "BUGÜN IÇIN" instead of "BUGÜN İÇİN". The dotless "ı" → "I" is already correct, so the only
 * fix needed before the platform uppercases is "i" → "İ".
 *
 * Use `capsSafe` on text you render with `textTransform: 'uppercase'`, or `upperTr` when you
 * uppercase the string yourself.
 */

export interface CapsOptions {
  /** Words to keep in their Latin uppercase form (brand names), matched case-insensitively. */
  preserve?: string[];
}

const TURKIC = new Set(['tr', 'az']);
const isTurkic = (lang: string | null | undefined) => TURKIC.has((lang || '').split(/[-_]/)[0].toLowerCase());
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function protect(text: string, preserve: string[], transform: (chunk: string) => string): string {
  if (preserve.length === 0) return transform(text);
  const re = new RegExp(`(${preserve.map(escape).join('|')})`, 'gi');
  return text
    .split(re)
    .map((part, i) => (i % 2 === 1 ? part.toUpperCase() : transform(part)))
    .join('');
}

/** Prepare text for `textTransform: 'uppercase'`. Non-Turkic languages pass through unchanged. */
export function capsSafe(text: string, lang: string | null | undefined, options: CapsOptions = {}): string {
  if (!isTurkic(lang)) return text;
  return protect(text, options.preserve ?? [], (chunk) => chunk.replace(/i/g, 'İ'));
}

/** Fully uppercase a string with Turkish rules (i→İ, ı→I), independent of the runtime locale. */
export function upperTr(text: string, options: CapsOptions = {}): string {
  return protect(text, options.preserve ?? [], (chunk) => chunk.replace(/i/g, 'İ').toUpperCase());
}
