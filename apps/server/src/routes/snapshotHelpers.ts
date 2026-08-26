/** Collect source file paths using the same walk rules as the indexer. */
export async function collectSourceFiles(root: string): Promise<string[]> {
  const fsp = (await import('node:fs')).promises;
  const path = await import('node:path');
  const out: string[] = [];
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let entries;
    try { entries = await fsp.readdir(absDir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '.build' || e.name === '.latex-studio') continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        // skip build artifacts even outside .build
        if (/\.(aux|log|fls|fdb_latexmk|synctex\.gz|bbl|bcf|run\.xml)$/i.test(e.name)) continue;
        await walk(path.join(absDir, e.name), rel);
      } else if (
        /\.(aux|log|fls|fdb_latexmk|synctex\.gz|synctex\.busy|bbl|bcf|run\.xml|out|toc|lof|lot|blg|xdv)$/i.test(e.name)
      ) {
        continue;
      } else {
        out.push(rel);
      }
    }
  };
  await walk(path.resolve(root), '');
  return out.sort();
}
