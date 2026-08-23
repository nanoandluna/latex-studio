import type { BuildOptions, BuildRecord, CompilerId } from '@latex-studio/shared';

export const PORT = Number(process.env.PORT ?? 3210);

export const BUILD_TIMEOUT_MS = 180_000;
export const BUILD_OUTDIR = '.build';
