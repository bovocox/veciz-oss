/**
 * Round-robin API key pool with per-key cooldown.
 *
 * Free tiers of transcript APIs are small (e.g. 100 credits/month per key), so a
 * pipeline often rotates several keys. A key that hits a quota or rate limit is
 * benched for `cooldownMs` and the next one is tried; once every key is benched,
 * `next()` returns null so the caller can fall through to another provider
 * instead of hammering exhausted keys.
 */
export class KeyPool {
  private readonly keys: string[];
  private readonly cooldownMs: number;
  private readonly benchedUntil = new Map<string, number>();
  private cursor = 0;
  private readonly now: () => number;

  constructor(keys: string[], options: { cooldownMs?: number; now?: () => number } = {}) {
    this.keys = keys.map((k) => k.trim()).filter(Boolean);
    this.cooldownMs = options.cooldownMs ?? 20 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.keys.length;
  }

  /** Next usable key, or null when the pool is empty or every key is cooling down. */
  next(): string | null {
    for (let i = 0; i < this.keys.length; i++) {
      const key = this.keys[(this.cursor + i) % this.keys.length];
      const until = this.benchedUntil.get(key) ?? 0;
      if (until <= this.now()) {
        this.cursor = (this.cursor + i + 1) % this.keys.length;
        return key;
      }
    }
    return null;
  }

  /** Take a key out of rotation for `ms` (defaults to the pool cooldown). */
  bench(key: string, ms: number = this.cooldownMs): void {
    this.benchedUntil.set(key, this.now() + ms);
  }
}
