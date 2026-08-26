import fs from 'node:fs';

const f = 'apps/server/src/services/projectIndexService.ts';
let c = fs.readFileSync(f, 'utf8');

if (!c.includes('getDebugInfo')) {
  const anchor = '  private parseWithCache(';
  const helpers = `  private sha1(s: string): string {
    return createHash('sha1').update(s, 'utf8').digest('hex');
  }

  /** Persistent per-file cache lives inside the workspace (.latex-studio/) —
   *  automatically per-project and gitignored. Schema/parser version mismatch
   *  or corruption discards it (auto-rebuild). */
  private ensureDiskCache(root: string): void {
    if (this.diskLoadedRoot === root) return;
    this.diskFiles.clear();
    this.diskBib.clear();
    this.diskLoadedRoot = root;
    this.diskDirty = false;
    try {
      const p = this.diskCachePath(root);
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as {
        schemaVersion?: number;
        parserVersion?: string;
        files?: Record<string, { hash: string; parsed: FileParseResult }>;
        bib?: Record<string, { hash: string; entries: unknown }>;
      };
      if (raw.schemaVersion !== GRAPH_SCHEMA_VERSION || raw.parserVersion !== PARSER_VERSION) return;
      for (const [rel, v] of Object.entries(raw.files ?? {})) {
        if (v?.hash && v?.parsed) this.diskFiles.set(rel, { hash: v.hash, parsed: v.parsed });
      }
      for (const [rel, v] of Object.entries(raw.bib ?? {})) {
        if (v?.hash && Array.isArray(v.entries)) {
          this.diskBib.set(rel, { hash: v.hash, entries: v.entries as ReturnType<typeof parseBibDocumentEntries> });
        }
      }
    } catch {
      /* missing/corrupt → clean rebuild */
    }
  }

  private diskCachePath(root: string): string {
    return path.join(root, '.latex-studio', 'cache', \`fileparse-v\${GRAPH_SCHEMA_VERSION}.json\`);
  }

  /** Best-effort write-behind; corruption on next load → clean rebuild. */
  private persistDiskCacheIfDirty(): void {
    if (!this.diskDirty || !this.builtForRoot) return;
    try {
      const p = this.diskCachePath(this.builtForRoot);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const payload = {
        schemaVersion: GRAPH_SCHEMA_VERSION,
        parserVersion: PARSER_VERSION,
        savedAt: Date.now(),
        files: Object.fromEntries(this.diskFiles),
        bib: Object.fromEntries(this.diskBib),
      };
      fs.writeFileSync(p, JSON.stringify(payload));
      this.diskDirty = false;
    } catch {
      /* best-effort */
    }
  }

  getDebugInfo() {
    const idx = this.current;
    const edgesByKind: Record<string, number> = {};
    const edges = (idx as unknown as { edges?: { kind: string }[] })?.edges ?? [];
    for (const e of edges) edgesByKind[e.kind] = (edgesByKind[e.kind] ?? 0) + 1;
    return {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      parserVersion: PARSER_VERSION,
      rev: this.rev,
      builtForRoot: this.builtForRoot,
      nodes: {
        files: idx?.files.length ?? 0,
        sections: idx?.sections.length ?? 0,
        labels: idx?.labels.length ?? 0,
        references: idx?.references.length ?? 0,
        citations: idx?.citations.length ?? 0,
        figures: idx?.figures.length ?? 0,
        tables: idx?.tables.length ?? 0,
        equations: idx?.equations.length ?? 0,
        packages: idx?.packages.length ?? 0,
        bibEntries: idx?.bibEntries.length ?? 0,
      },
      edges: edgesByKind,
      lastPass: this.lastStats,
      recentBatches: this.recentBatches.slice(-10),
      watcherActive: this.watcherActive,
      watchedRoot: this.watcher.watchedRoot,
      diskCache: { entries: this.diskFiles.size + this.diskBib.size, dirty: this.diskDirty },
    };
  }

`;
  c = c.replace(anchor, helpers + anchor);
}

// record watcher batches + persist after commit
if (!c.includes('recentBatches.unshift')) {
  c = c.replace(
    '    this.watcher.onChange = (paths) => {',
    `    this.watcher.onChange = (paths) => {
      this.recentBatches.unshift({ at: Date.now(), paths });
      if (this.recentBatches.length > 10) this.recentBatches.pop();`
  );
}
if (!c.includes('persistDiskCacheIfDirty()')) {
  c = c.replace(
    '    if (!rerun) this.pendingBufferAt = 0;',
    `    if (!rerun) this.pendingBufferAt = 0;
    this.persistDiskCacheIfDirty();`
  );
}

fs.writeFileSync(f, c);
console.log('ok', /getDebugInfo/.test(c), /persistDiskCacheIfDirty\(\);/.test(c), /recentBatches\.unshift/.test(c));
