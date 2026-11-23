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
 * Answers: a fast typist (well under ~3 answers/s sustained, with short
 * bursts) never hits this, but a script firing the whole country list is
 * throttled after the first handful.
 */
export const DEFAULT_ANSWER_LIMIT: BucketConfig = { burst: 8, refillPerSec: 6 };

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
