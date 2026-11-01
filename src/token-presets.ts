/**
 * Optional tokenizer presets for popular model families.
 *
 * These are heuristics tuned for common model tokenizers. For exact counts,
 * plug in a real tokenizer (e.g. tiktoken) via {@link createTokenEstimator}.
 *
 * | Preset     | Heuristic       | Best for                         |
 * | ---------- | --------------- | -------------------------------- |
 * | chars/4    | ceil(chars / 4) | Default; good for prose-heavy   |
 * | claude-3   | ceil(chars / 3) | Claude code/context; denser tokens |
 * | gpt-4      | ceil(chars / 4) | GPT-4; similar to default        |
 * | mistral    | ceil(chars / 4) | Mistral; similar to default      |
 */

import { createTokenEstimator } from './tokens.js';
import type { TokenEstimator } from './types.js';

/** Claude models produce denser tokens on code; ~3 chars/token. */
export const claudeEstimator: TokenEstimator = createTokenEstimator(
  'claude-3/chars-3',
  (text) => Math.ceil(text.length / 3),
);

/** GPT-4 family; ~4 chars/token, same as the built-in default. */
export const gpt4Estimator: TokenEstimator = createTokenEstimator(
  'gpt-4/chars-4',
  (text) => Math.ceil(text.length / 4),
);

/** Mistral family; ~4 chars/token. */
export const mistralEstimator: TokenEstimator = createTokenEstimator(
  'mistral/chars-4',
  (text) => Math.ceil(text.length / 4),
);

/** Registry of named presets. */
export const TOKENIZER_PRESETS: Record<string, TokenEstimator> = {
  'claude-3': claudeEstimator,
  'gpt-4': gpt4Estimator,
  'gpt-4o': gpt4Estimator,
  'mistral': mistralEstimator,
  default: createTokenEstimator('chars/4', (text) => Math.ceil(text.length / 4)),
};

/** Look up a preset by name; returns undefined if not found. */
export function getPreset(name: string): TokenEstimator | undefined {
  return TOKENIZER_PRESETS[name];
}