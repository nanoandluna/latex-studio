import fs from 'node:fs';

// 1) watcher onChange logging
let c = fs.readFileSync('apps/server/src/services/projectIndexService.ts', 'utf8');
c = c.replace(
  '    this.watcher.onChange = () => {\n      void this.refresh().catch(() => {});\n    };',
  `    this.watcher.onChange = (paths) => {
      if (process.env.LS_DEBUG) console.error('[watcher] batch:', paths.length);
      void this.refresh().catch(() => {});
    };`
);
c = c.replace(
  '  private async doRefresh(): Promise<IndexRefreshResult> {\n    const started = Date.now();',
  '  private async doRefresh(): Promise<IndexRefreshResult> {\n    if (process.env.LS_DEBUG) console.error("[idx] refresh enter");\n    const started = Date.now();'
);
fs.writeFileSync('apps/server/src/services/projectIndexService.ts', c);

// 2) fileWatcher scheduled log
c = fs.readFileSync('apps/server/src/services/fileWatcher.ts', 'utf8');
c = c.replace(
  '      }, 150);',
  `      }, 150);
      if (process.env.LS_DEBUG) console.error('[watcher] scheduled');`
);
fs.writeFileSync('apps/server/src/services/fileWatcher.ts', c);

// 3) probe: remove disable flag
c = fs.readFileSync('apps/server/probe-upd.ts', 'utf8');
c = c.replace("process.env.LS_DISABLE_WATCHER = '1';\n", '');
fs.writeFileSync('apps/server/probe-upd.ts', c);

console.log('instrumented');
