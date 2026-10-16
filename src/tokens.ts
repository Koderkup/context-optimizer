import { createHash } from 'node:crypto';

import type { TokenEstimator } from './types.js';

/**
 * Default character-based token estimator (chars / 4, rounded up).
 *
 * This is an ESTIMATE: real tokenizers vary by language and content
 * (code, unicode and rare symbols can be 1.5-3x denser than prose).
 * For exact counts, supply your own {@link TokenEstimator}.
 */
export const defaultTokenEstimator: TokenEstimator = {
  name: 'chars/4',
  estimate(text: string): number {
    if (text.length === 0) return 0;
    return Math.ceil(text.length / 4);
  },
};

/** Create a custom estimator from a function, with a label for reports. */
export function createTokenEstimator(name: string, fn: (text: string) => number): TokenEstimator {
  return { name, estimate: fn };
}

/** Deterministic content hash (sha256, hex). */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Stable short id from content: `prefix_<8 hex chars>`.
 * Uses sha256 so ids are deterministic across processes and platforms.
 */
export function shortHash(prefix: string, input: string): string {
  return `${prefix}_${sha256(input).slice(0, 8)}`;
}
