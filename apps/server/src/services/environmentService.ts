import type { LatexEnvironment } from '@latex-studio/shared';
import { detectEnvironment } from '../compiler/detector.js';

let cached: { env: LatexEnvironment; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getEnvironment(force = false): Promise<LatexEnvironment> {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.env;
  }
  const env = detectEnvironment(force);
  cached = { env, at: Date.now() };
  return env;
}
