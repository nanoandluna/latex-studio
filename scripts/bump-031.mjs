import fs from 'node:fs';

for (const p of [
  'package.json',
  'apps/server/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
  'packages/latex-parser/package.json',
]) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.version = '0.3.1';
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}

let c = fs.readFileSync('README.md', 'utf8');
c = c.replace(
  '## Known limitations (V0.2.x — final)',
  '## Known limitations (v0.3.1)'
);
c = c.replace(
  '> Local-first + Web UI + LaTeX IDE + PDF Preview — no cloud, no accounts, fully offline.',
  '> **Local-first Research LaTeX IDE** — Web UI + LaTeX Intelligence + PDF Preview. No cloud, no accounts, fully offline.'
);

// mark V0.2.3 shipped + insert V0.3.0/V0.3.1 entries after it
const v023 =
  '- ~~V0.2.3 — Compatibility Final~~ ✅ V0.2.x frozen';
if (!c.includes('V0.3.1 — Intelligence Hardening')) {
  c = c.replace(
    v023,
    v023 +
      `
- **V0.3.0 — Research Workspace Intelligence** ✅ shipped: Project Graph · File Watcher · Inspectors · Diagnostics ("Research Health") · Writing checks · Recent projects · Template packages — [plan](docs/V0.3-PLAN.md)
- **V0.3.1 — Intelligence Hardening** ✅ shipped: GRAPH_SCHEMA_VERSION versioning · persistent per-file parse cache (\`.latex-studio/\`, schema-gated, corruption auto-rebuild) · stress benchmarks 500/1000 files via \`pnpm test:stress\` · Graph Debug observability (\`GET /api/graph/debug\` + palette dump) · research-thesis real fixture`
  );
}

// remove the old V0.3 planning line if still present
c = c.replace(
  /\n- \*\*V0\.3 — Research Workspace Intelligence\*\*[^~]*?plan\]\(docs\/V0\.3-PLAN\.md\)/,
  ''
);

// positioning for V0.4 per review: Research Copilot
c = c.replace('- **V0.4 — AI-native LaTeX**', '- **V0.4 — Research Copilot**: project-aware AI');

fs.writeFileSync('README.md', c);
console.log('readme bumped to 0.3.1');
