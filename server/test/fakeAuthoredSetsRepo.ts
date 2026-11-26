/**
 * In-memory `AuthoredSetsRepo` for tests — mirrors the `daily_sets` upsert
 * (PK = daily_date) without a network or credentials.
 */

import type { AuthoredSetsRepo } from "../src/daily/authoredSetsRepo.js";
import type { AuthoredDailySet } from "../src/daily/authoredSets.js";

export interface FakeAuthoredSetsRepo extends AuthoredSetsRepo {
  readonly rows: AuthoredDailySet[];
}

export function makeFakeAuthoredSetsRepo(opts: { failWith?: Error } = {}): FakeAuthoredSetsRepo {
  const byDate = new Map<string, AuthoredDailySet>();
  return {
    get rows() {
      return [...byDate.values()];
    },
    async upsert(authored: AuthoredDailySet): Promise<void> {
      if (opts.failWith) throw opts.failWith;
      byDate.set(authored.dailyDate, authored); // PK = daily_date → replace
    },
    async list(): Promise<AuthoredDailySet[]> {
      if (opts.failWith) throw opts.failWith;
      return [...byDate.values()];
    },
    async delete(dailyDate: string): Promise<void> {
      if (opts.failWith) throw opts.failWith;
      byDate.delete(dailyDate);
    },
  };
}
