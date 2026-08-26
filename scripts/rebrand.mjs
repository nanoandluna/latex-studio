import fs from 'node:fs';

let c = fs.readFileSync('README.md', 'utf8');

// 1) 定位句 → 中文科研写作工作台
c = c.replace(
  /> \*\*Local-first Research LaTeX IDE\*\* — Web UI \+ LaTeX Intelligence \+ PDF Preview\. No cloud, no accounts, fully offline\./,
  '> **面向研究生与科研人员的本地优先科研写作工作台。**  \n> Local-first research writing workspace for graduate students and researchers — edit · compile · cite · inspect · preview. Offline. No account.'
);

// 2) Roadmap 整体替换为锁定版阶梯
const roadIdx = c.indexOf('## Roadmap');
if (roadIdx !== -1) {
  c =
    c.slice(0, roadIdx) +
    `## Roadmap

- ~~V0.1 — Local LaTeX Foundation~~ ✅
- ~~V0.1.x — Security / Hardening~~ ✅
- ~~V0.2.x — LaTeX IDE Intelligence · Real-world Hardening · Audit Cleanup~~ ✅
- ~~V0.3.x — Research Workspace Intelligence · Intelligence Hardening~~ ✅ — [plan](docs/V0.3-PLAN.md)
- **V0.4.0 — Writer's Safety + Search** ← next — [plan](docs/V0.4-PLAN.md)：Snapshot/History/Diff/Restore · Project Search & Replace（Replace All 自动快照）· Paper Statistics（CJK 双轨计数）· Auto-save · ZIP 导出导入
- **V0.4.1 — Hardening**: SSE Build Progress · large-project polish · crash/recovery 回归
- **V0.5.0 — Research Writing Workspace**: Citation Workspace · Terminology Consistency/Glossary · PDF 缩略图与阅读位置记忆 · 中文界面
- **V0.6.0 — Literature Bridge**: Zotero / Better BibTeX 工作流深化 · 文献 PDF 阅读
- **V0.7.0 — Long-term Reliability**: 快照格式演进 · 迁移 · 备份恢复加固
- **V1.0 — Graduate Research Workspace**

Product razor: 只做让研究生更快、更稳定、更清晰地完成一篇高质量论文的功能。

`;
}

fs.writeFileSync('README.md', c);
console.log(
  'roadmap replaced:',
  !/Research Copilot|AI-native|V0\.4 — Research Copilot/.test(c),
  '· positioning CN:',
  c.includes('面向研究生与科研人员的本地优先科研写作工作台')
);
