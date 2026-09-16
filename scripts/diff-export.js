#!/usr/bin/env node
// Compares a workflow exported from the n8n UI (⋯ → Download) with the generated workflow/intake-triage.n8n.json.
// Run: node scripts/diff-export.js ~/Downloads/AI_Intake_Triage.json
// Reports: node set, connections, and per-node parameter differences (ignoring instance-specific ids,
// credentials, positions, cached lookups, and the model ID which is a deliberate per-environment choice).
// Also flags anything in the UI export that should never be committed (credential ids, document ids, emails).

const fs = require('fs');
const path = require('path');

const uiPath = process.argv[2];
if (!uiPath) {
  console.error('usage: node scripts/diff-export.js <path-to-ui-export.json>');
  process.exit(2);
}
const ui = JSON.parse(fs.readFileSync(uiPath, 'utf8'));
const gen = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflow/intake-triage.n8n.json'), 'utf8'));

const IGNORE = new Set(['id', 'position', 'webhookId', 'credentials', 'cachedResultName', 'cachedResultUrl', 'typeVersion', 'schema']);
const norm = (v) =>
  JSON.stringify(v, (k, val) => {
    if (IGNORE.has(k)) return undefined;
    if (k === 'value' && typeof val === 'string' && /^claude-/.test(val)) return 'claude-<model>';
    if (k === 'value' && typeof val === 'string' && /^[\w-]{30,}$|^gid=\d+$|^\d{6,}$/.test(val)) return '<instance-id>';
    if (typeof val === 'string') return val.replace(/\s+/g, ' ').trim();
    return val;
  });

const un = new Map(ui.nodes.map((n) => [n.name, n]));
const gn = new Map(gen.nodes.map((n) => [n.name, n]));
let problems = 0;

const onlyUi = [...un.keys()].filter((k) => !gn.has(k));
const onlyGen = [...gn.keys()].filter((k) => !un.has(k));
console.log(`nodes: ui=${un.size} generated=${gn.size}` + (onlyUi.length || onlyGen.length ? `  ONLY IN UI: ${onlyUi}  ONLY IN GENERATED: ${onlyGen}` : '  ✔ same set'));
problems += onlyUi.length + onlyGen.length;

const conns = (w) => Object.entries(w.connections).flatMap(([from, byType]) => Object.entries(byType).flatMap(([type, outs]) => outs.flatMap((o, i) => o.map((c) => `${from} [${type}:${i}] -> ${c.node}`)))).sort();
const cu = conns(ui), cg = conns(gen);
const missing = cg.filter((c) => !cu.includes(c)), extra = cu.filter((c) => !cg.includes(c));
console.log(`connections: ui=${cu.length} generated=${cg.length}` + (missing.length || extra.length ? `\n  missing in UI: ${missing}\n  extra in UI: ${extra}` : '  ✔ identical'));
problems += missing.length + extra.length;

const diffs = [];
for (const [name, g] of gn) {
  const u = un.get(name);
  if (u && norm(u.parameters) !== norm(g.parameters)) diffs.push(name);
}
console.log(diffs.length ? `parameter differences (worth a look, not necessarily wrong): ${diffs.join(', ')}` : 'parameters: ✔ equivalent');

const s = JSON.stringify(ui);
const leaks = {
  'credential refs': ui.nodes.filter((n) => n.credentials).length,
  'api keys': (s.match(/sk-ant-[\w-]+/g) || []).length,
  'non-example emails': [...new Set(s.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [])].filter((e) => !/example\.com|example-lawfirm\.test/.test(e)),
};
console.log('UI export contains:', JSON.stringify(leaks), '→ do not commit the UI export; commit the generated one.');
process.exit(problems ? 1 : 0);
