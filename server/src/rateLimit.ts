/**
 * Tiny token-bucket rate limiter (per socket, in memory).
 *
 * A bucket holds up to `burst` tokens and refills continuously at
 * `refillPerSec`. Each event costs one token; with none left the event is
 * dropped. Refill is computed lazily from an injectable clock so tests can
 * drive it deterministically.
 */

export interface BucketConfig {
  /** Max tokens (events allowed back-to-back from a full bucket). */
  burst: number;
  /** Tokens regained per second. */
  refillPerSec: number;
}

/**
 * Answers: a generous BURST so a fast typist naming several countries
 * back-to-back stays smooth, with a sustained refill above the human-typing
 * floor (~4/s) so legitimate fast play is never throttled — in the versus
 * match this bucket also governs `submit_answer`. Rate-limiting deliberately
 * does NOT try to stop the daily answer-oracle brute force: a script typing at
 * human speed is indistinguishable from a human, so dropping below the ~4/s
 * floor would punish real players. The per-prompt countdown timer is what
 * actually bounds how many guesses a run can make against the secret set.
 */
export const DEFAULT_ANSWER_LIMIT: BucketConfig = { burst: 8, refillPerSec: 6 };

/**
 * Finish: a player finishes a run at most once; even retries are rare, so a
 * few per minute per IP is ample while bounding how often the (unbounded-body)
 * reconcile runs.
 */
export const DEFAULT_FINISH_LIMIT: BucketConfig = { burst: 5, refillPerSec: 0.1 };

/** Everything else (create/join/ready/settings/...): looser, but bounded. */
export const DEFAULT_EVENT_LIMIT: BucketConfig = { burst: 30, refillPerSec: 10 };

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly config: BucketConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = config.burst;
    this.last = now();
  }

  /** Spend one token if available. Returns false when rate limited. */
  take(): boolean {
    const t = this.now();
    const elapsed = Math.max(0, t - this.last) / 1000;
    this.last = t;
    this.tokens = Math.min(this.config.burst, this.tokens + elapsed * this.config.refillPerSec);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * A per-key store of token buckets with bounded memory: without eviction the
 * map grows one entry per distinct IP forever. We prune opportunistically on
 * access — buckets untouched for `ttlMs` are dropped — and hard-cap the map at
 * `maxEntries`, evicting the oldest-touched bucket when full. Allocation-light:
 * `last` is tracked on a plain record, no timers.
 */
export class BucketStore {
  private readonly buckets = new Map<string, { bucket: TokenBucket; touched: number }>();

  constructor(
    private readonly config: BucketConfig,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 10_000,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  /** The bucket for `key`, creating it if absent and pruning stale/overflow. */
  get(key: string): TokenBucket {
    const t = this.now();
    const existing = this.buckets.get(key);
    if (existing) {
      existing.touched = t;
      // Re-insert so Map key order tracks recency: the first key is the LRU.
      this.buckets.delete(key);
      this.buckets.set(key, existing);
      return existing.bucket;
    }
    // Opportunistic prune of entries past their TTL, then enforce the hard cap
    // by dropping the least-recently-touched entries until we have headroom.
    for (const [k, v] of this.buckets) {
      if (t - v.touched > this.ttlMs) this.buckets.delete(k);
    }
    while (this.buckets.size >= this.maxEntries) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
    const bucket = new TokenBucket(this.config, this.now);
    this.buckets.set(key, { bucket, touched: t });
    return bucket;
  }

  /** Number of tracked buckets (for tests/introspection). */
  get size(): number {
    return this.buckets.size;
  }
}
