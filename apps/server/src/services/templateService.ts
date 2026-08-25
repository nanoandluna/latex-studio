import fs from 'node:fs';
import path from 'node:path';
import type { TemplateManifest } from '@latex-studio/shared';

/**
 * Template Package System.
 *
 * Templates are DATA packages under <repo>/templates/<id>/:
 *   templates/ieee/manifest.json   ← id/name/version/mainFile/files[]
 *   templates/ieee/main.tex        ← the files listed in the manifest
 *
 * Nothing is hardcoded in React; community template dirs can be added later
 * by pointing LS_TEMPLATES_DIR at an additional root.
 */

function templateRoots(): string[] {
  const roots: string[] = [];
  if (process.env.LS_TEMPLATES_DIR) roots.push(process.env.LS_TEMPLATES_DIR);
  // repo layout: apps/server/{dist,src}/services → repoRoot/templates
  roots.push(path.resolve(process.cwd(), '../../templates'));
  return [...new Set(roots)].filter((r) => fs.existsSync(r));
}

export function listTemplates(): TemplateManifest[] {
  const out: TemplateManifest[] = [];
  for (const root of templateRoots()) {
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(root).filter((d) => fs.statSync(path.join(root, d)).isDirectory());
    } catch {
      continue;
    }
    for (const dir of dirs) {
      try {
        const manifestPath = path.join(root, dir, 'manifest.json');
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as TemplateManifest;
        if (typeof m.id !== 'string' || typeof m.mainFile !== 'string' || !Array.isArray(m.files)) {
          continue;
        }
        // manifest must only reference files that exist
        const allExist = m.files.every((f) => !f.includes('..') && fs.existsSync(path.join(root, dir, f)));
        if (allExist) {
          out.push({ ...m, description: m.description ?? '' });
        }
      } catch {
        /* malformed template → skip */
      }
    }
  }
  return out;
}

export function getTemplate(id: string): { manifest: TemplateManifest; root: string } | null {
  return listTemplates()
    .map((m) => ({ manifest: m }))
    .map(({ manifest }) => {
      for (const root of templateRoots()) {
        const r = path.join(root, manifest.id);
        if (fs.existsSync(path.join(r, 'manifest.json'))) return { manifest, root: r };
      }
      return null;
    })
    .find((x): x is { manifest: TemplateManifest; root: string } => x !== null && x.manifest.id === id) ?? null;
}

/** Copy template files into targetDir. Refuses to overwrite existing files. */
export function instantiateTemplate(
  id: string,
  targetDir: string
): { mainFile: string; written: string[] } | null {
  const tpl = getTemplate(id);
  if (!tpl) return null;
  const { manifest, root } = tpl;

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new Error(`Target directory is not empty: ${targetDir}`);
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const written: string[] = [];
  for (const rel of manifest.files) {
    if (rel.includes('..') || path.isAbsolute(rel)) {
      throw new Error(`Template file escapes its package: ${rel}`);
    }
    const src = path.join(root, rel);
    const dest = path.join(targetDir, rel);
    if (fs.existsSync(dest)) continue; // never overwrite
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest);
    written.push(rel);
  }
  return { mainFile: manifest.mainFile, written };
}
