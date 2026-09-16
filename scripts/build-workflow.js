#!/usr/bin/env node
// Assembles workflow/intake-triage.n8n.json from prompts/, samples/, n8n/nodes/ and n8n/extraction-schema.json.
// Run: node scripts/build-workflow.js   → then import the JSON in n8n (Workflows → Import from file).
// Editing a prompt or a Code node? Edit the source file and rebuild; never hand-edit the export.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const id = () => crypto.randomUUID();

// ---------- samples → items for the Load node ----------
const webform = JSON.parse(read('samples/intake-2-webform.json'));
const webformText = [
  `[Web form submission — ${webform.form} — SYNTHETIC TEST DATA]`,
  `Submitted: ${webform.submitted_at}`,
  ...Object.entries(webform.fields).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v === '' ? '(blank)' : v}`),
].join('\n');

const SAMPLES = [
  { intake_id: 'intake-1', channel: 'voicemail', received_at: '2026-04-27T08:42:00-05:00', raw_text: read('samples/intake-1-voicemail.txt').trim(), submitted_by: 'batch (sample data)' },
  { intake_id: 'intake-2', channel: 'web_form', received_at: webform.submitted_at, raw_text: webformText, submitted_by: 'batch (sample data)' },
  { intake_id: 'intake-3', channel: 'referral_email', received_at: '2026-04-29T16:47:00-05:00', raw_text: read('samples/intake-3-referral-email.txt').trim(), submitted_by: 'batch (sample data)' },
];

const code = (file) => read(`n8n/nodes/${file}`).replace('__SAMPLES__', JSON.stringify(SAMPLES, null, 2));
const schema = JSON.stringify(JSON.parse(read('n8n/extraction-schema.json')), null, 2);
const summarySchema = JSON.stringify(JSON.parse(read('n8n/summary-schema.json')), null, 2);
const extractionPrompt = read('prompts/01-extraction.system.md').trim();
const summaryPrompt = read('prompts/02-summary.system.md').trim();

for (const p of [extractionPrompt, summaryPrompt]) {
  // n8n ≥ 1.8x escapes braces in system messages itself; older versions treat them as template variables.
  if (/[{}]/.test(p)) console.warn('warning: a system prompt contains curly braces — fine on n8n 2.x, breaks older versions.');
}

// ---------- node factories ----------
// Deliverable runs on claude-sonnet-5 (see README → Model choice). Override for a different environment:
//   MODEL=claude-opus-5 node scripts/build-workflow.js
const MODEL = process.env.MODEL || 'claude-sonnet-5';
const anthropic = (name, x, y) => ({
  parameters: {
    model: { __rl: true, mode: 'id', value: MODEL },
    // No temperature/top_p/top_k: Claude Opus 5 / Sonnet 5 return HTTP 400 if any sampling param is sent.
    // 16000 max tokens because adaptive thinking (on by default on Opus 5) is billed inside max_tokens.
    options: { maxTokensToSample: 16000 },
  },
  id: id(),
  name,
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  typeVersion: 1.3,
  position: [x, y],
});

// Append-or-update keyed on intake_id: re-running an intake refreshes its row instead of duplicating it.
const sheetsUpsert = (name, x, y) => ({
  parameters: {
    operation: 'appendOrUpdate',
    documentId: { __rl: true, mode: 'list', value: '' },
    sheetName: { __rl: true, mode: 'list', value: '' },
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['intake_id'], schema: [] },
    options: { handlingExtraData: 'ignoreIt' }, // fields without a header column (e.g. follow_up_contact) are not written
  },
  id: id(),
  name,
  type: 'n8n-nodes-base.googleSheets',
  typeVersion: 4.5,
  position: [x, y],
});

// Alert e-mails go through Gmail with the same Google OAuth client as Sheets. The recipient comes
// from the ALERT_EMAIL environment variable so no personal address is ever written into this export.
const gmailAlert = (name, x, y, subject, body) => ({
  parameters: {
    sendTo: '={{ $env.ALERT_EMAIL }}',
    subject,
    emailType: 'text',
    message: body,
    options: { appendAttribution: false },
  },
  id: id(),
  name,
  type: 'n8n-nodes-base.gmail',
  typeVersion: 2.1,
  position: [x, y],
  onError: 'continueRegularOutput',
});

// The Sheets upsert (auto-map mode) passes items through unchanged, so the alert can read the row from $json.
const V = "$json";
const alertReason = `{{ ${V}.status === 'NEEDS FOLLOW-UP' ? 'NEEDS FOLLOW-UP' : 'HIGH URGENCY' }}`;
const followUpSubject = `=[Intake triage] ${alertReason} — {{ ${V}.intake_id }} ({{ ${V}.channel }}) — urgency {{ ${V}.urgency }}`;
const followUpBody =
  `={{ ${V}.status === 'NEEDS FOLLOW-UP' ? 'An intake could not be completed automatically and needs a human.' : 'An intake was rated HIGH urgency and is ready for attorney review. Please look at it today.' }}\n\n` +
  `Intake: {{ ${V}.intake_id }} via {{ ${V}.channel }}, received {{ ${V}.received_at }}\n` +
  `Urgency: {{ ${V}.urgency }} — {{ ${V}.urgency_reason }}\n\n` +
  `Missing: {{ ${V}.missing_fields }}\n` +
  `Who can supply it: {{ ${V}.follow_up_contact }}\n` +
  `Checks: {{ ${V}.warnings }}\n\n` +
  `Summary:\n{{ ${V}.summary }}\n\n` +
  `The full row (with source quotes and the original text) is in the "Intake Review Queue" sheet.`;

const E = "$json";
const errorSubject = `=[Intake triage] PIPELINE ERROR — {{ ${E}.intake_id }} ({{ ${E}.channel }})`;
const errorBody =
  `=The AI step failed for this intake. Nothing was extracted; process it manually.\n\n` +
  `Intake: {{ ${E}.intake_id }} via {{ ${E}.channel }}, received {{ ${E}.received_at }}\n` +
  `Error: {{ ${E}.warnings }}\n\n` +
  `The original text is preserved in the "Intake Review Queue" sheet (status PIPELINE ERROR). Please notify the workflow owner.`;

// ---------- nodes ----------
const nodes = [
  // ---- Live entry point #2: a Google Form. Its responses land in a Google Sheet; n8n polls that sheet. ----
  {
    parameters: {
      pollTimes: { item: [{ mode: 'everyMinute' }] },
      documentId: { __rl: true, mode: 'list', value: '' },
      sheetName: { __rl: true, mode: 'list', value: '' },
      event: 'rowAdded',
      options: {},
    },
    id: id(),
    name: 'Google Form Responses',
    type: 'n8n-nodes-base.googleSheetsTrigger',
    typeVersion: 1,
    position: [-260, -200],
  },
  { parameters: { mode: 'runOnceForEachItem', jsCode: code('05-normalize-form-response.js') }, id: id(), name: 'Normalize Form Response', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-40, -200] },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: id(), leftValue: '={{ $json.file_id }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    },
    id: id(),
    name: 'Form has file?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [180, -200],
  },
  {
    parameters: {
      resource: 'file',
      operation: 'download',
      fileId: { __rl: true, mode: 'id', value: '={{ $json.file_id }}' },
      options: { binaryPropertyName: 'data' },
    },
    id: id(),
    name: 'Download Uploaded File',
    type: 'n8n-nodes-base.googleDrive',
    typeVersion: 3,
    position: [400, -280],
  },
  {
    parameters: { operation: 'text', binaryPropertyName: 'data', destinationKey: 'data', options: { keepSource: 'json' } },
    id: id(),
    name: 'Read Downloaded File',
    type: 'n8n-nodes-base.extractFromFile',
    typeVersion: 1,
    position: [620, -280],
  },
  { parameters: { mode: 'runOnceForEachItem', jsCode: code('06-attach-file-text.js') }, id: id(), name: 'Attach File Text', type: 'n8n-nodes-base.code', typeVersion: 2, position: [840, -280] },
  // ---- Live entry point: a web form (paste text or upload a file). Runs one intake at a time. ----
  {
    parameters: {
      formTitle: 'New intake',
      formDescription: 'Paste the voicemail transcript, web-form submission or referral email — or upload it as a file. The AI extracts the facts with source quotes, writes a five-sentence summary and adds a row to the Intake Review Queue.',
      formFields: {
        values: [
          {
            fieldLabel: 'Channel',
            fieldType: 'dropdown',
            fieldOptions: { values: [{ option: 'voicemail' }, { option: 'web_form' }, { option: 'referral_email' }, { option: 'other' }] },
            requiredField: true,
          },
          { fieldLabel: 'Intake text', fieldType: 'textarea', placeholder: 'Paste the intake here (leave empty if you upload a file)' },
          { fieldLabel: 'Intake file', fieldType: 'file', acceptFileTypes: '.txt,.json,.eml,.md', multipleFiles: false },
        ],
      },
      options: {},
    },
    id: id(),
    name: 'Intake Form',
    type: 'n8n-nodes-base.formTrigger',
    typeVersion: 2.2,
    position: [-260, 120],
    webhookId: id(),
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [
          { id: id(), leftValue: '={{ Boolean($binary && $binary.Intake_file) }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id: id(),
    name: 'File uploaded?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [-40, 120],
  },
  {
    // keepSource must be set explicitly: with an empty options collection the node drops the incoming JSON.
    parameters: { operation: 'text', binaryPropertyName: 'Intake_file', destinationKey: 'data', options: { keepSource: 'json' } },
    id: id(),
    name: 'Read Uploaded File',
    type: 'n8n-nodes-base.extractFromFile',
    typeVersion: 1,
    position: [180, 40],
  },
  { parameters: { mode: 'runOnceForEachItem', jsCode: code('00-normalize-form-intake.js') }, id: id(), name: 'Normalize Form Intake', type: 'n8n-nodes-base.code', typeVersion: 2, position: [400, 120] },
  { parameters: {}, id: id(), name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 400] },
  { parameters: { jsCode: code('01-load-sample-intakes.js') }, id: id(), name: 'Load Sample Intakes', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 400] },
  {
    parameters: {
      assignments: {
        assignments: [
          { id: id(), name: 'intake_id', value: '={{ $json.intake_id }}', type: 'string' },
          { id: id(), name: 'channel', value: '={{ $json.channel }}', type: 'string' },
          { id: id(), name: 'received_at', value: '={{ $json.received_at }}', type: 'string' },
          { id: id(), name: 'raw_text', value: '={{ $json.raw_text }}', type: 'string' },
          { id: id(), name: 'submitted_by', value: "={{ $json.submitted_by || 'not provided' }}", type: 'string' },
        ],
      },
      options: {},
    },
    id: id(),
    name: 'Normalize Intake',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [440, 400],
  },
  {
    parameters: {
      promptType: 'define',
      // The Intake ID header is the routing key the model echoes back (see Traceability Guard).
      text: '=INTAKE ID (copy this exact value into intake_id.value; it is never NOT FOUND): {{ $json.intake_id }}\n\nINTAKE TEXT:\n{{ $json.raw_text }}',
      hasOutputParser: true,
      messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: extractionPrompt }] },
    },
    id: id(),
    name: 'Extract Facts',
    type: '@n8n/n8n-nodes-langchain.chainLlm',
    typeVersion: 1.4,
    position: [680, 400],
    onError: 'continueErrorOutput',
  },
  anthropic('Anthropic (Extract)', 620, 620),
  {
    parameters: { schemaType: 'manual', inputSchema: schema, autoFix: false },
    id: id(),
    name: 'Extraction Schema',
    type: '@n8n/n8n-nodes-langchain.outputParserStructured',
    typeVersion: 1.3,
    position: [820, 620],
  },
  { parameters: { mode: 'runOnceForEachItem', jsCode: code('02-traceability-guard.js') }, id: id(), name: 'Traceability Guard', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1000, 400] },
  {
    parameters: {
      promptType: 'define',
      text: "=Intake ID: {{ $json.intake_id }}\n\n{{ $json.record_text }}\n\nMissing fields: {{ $json.missing_fields.length ? $json.missing_fields.join(', ') : 'none' }}",
      hasOutputParser: true,
      messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: summaryPrompt }] },
    },
    id: id(),
    name: 'Attorney Summary',
    type: '@n8n/n8n-nodes-langchain.chainLlm',
    typeVersion: 1.4,
    position: [1240, 400],
    onError: 'continueErrorOutput',
  },
  anthropic('Anthropic (Summary)', 1180, 620),
  {
    parameters: { schemaType: 'manual', inputSchema: summarySchema, autoFix: false },
    id: id(),
    name: 'Summary Schema',
    type: '@n8n/n8n-nodes-langchain.outputParserStructured',
    typeVersion: 1.3,
    position: [1380, 620],
  },
  { parameters: { mode: 'runOnceForEachItem', jsCode: code('03-validate-summary.js') }, id: id(), name: 'Validate Summary', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1560, 400] },
  sheetsUpsert('Review Queue (upsert)', 1800, 400),
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          { id: id(), leftValue: '={{ $json.status }}', rightValue: 'NEEDS FOLLOW-UP', operator: { type: 'string', operation: 'equals' } },
          { id: id(), leftValue: '={{ $json.urgency }}', rightValue: 'HIGH', operator: { type: 'string', operation: 'equals' } },
        ],
        combinator: 'or',
      },
      options: {},
    },
    id: id(),
    name: 'Alert a human?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [2060, 400],
  },
  gmailAlert('Alert: needs attention', 2320, 300, followUpSubject, followUpBody),
  { parameters: { mode: 'runOnceForEachItem', jsCode: code('04-build-error-row.js') }, id: id(), name: 'Build Error Row', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1560, 860] },
  sheetsUpsert('Pipeline Error (upsert)', 1800, 860),
  gmailAlert('Alert: pipeline error', 2060, 860, errorSubject, errorBody),
];

// ---------- connections ----------
const main = (from, to, outputIndex = 0) => ({ from, to, type: 'main', outputIndex });
const links = [
  main('Google Form Responses', 'Normalize Form Response'),
  main('Normalize Form Response', 'Form has file?'),
  main('Form has file?', 'Download Uploaded File', 0),
  main('Form has file?', 'Normalize Intake', 1),
  main('Download Uploaded File', 'Read Downloaded File'),
  main('Read Downloaded File', 'Attach File Text'),
  main('Attach File Text', 'Normalize Intake'),
  main('Intake Form', 'File uploaded?'),
  main('File uploaded?', 'Read Uploaded File', 0),
  main('File uploaded?', 'Normalize Form Intake', 1),
  main('Read Uploaded File', 'Normalize Form Intake'),
  main('Normalize Form Intake', 'Normalize Intake'),
  main('Manual Trigger', 'Load Sample Intakes'),
  main('Load Sample Intakes', 'Normalize Intake'),
  main('Normalize Intake', 'Extract Facts'),
  main('Extract Facts', 'Traceability Guard', 0),
  main('Extract Facts', 'Build Error Row', 1),
  main('Traceability Guard', 'Attorney Summary'),
  main('Attorney Summary', 'Validate Summary', 0),
  main('Attorney Summary', 'Build Error Row', 1),
  main('Validate Summary', 'Review Queue (upsert)'),
  main('Review Queue (upsert)', 'Alert a human?'),
  main('Alert a human?', 'Alert: needs attention', 0),
  main('Build Error Row', 'Pipeline Error (upsert)'),
  main('Pipeline Error (upsert)', 'Alert: pipeline error'),
  { from: 'Anthropic (Extract)', to: 'Extract Facts', type: 'ai_languageModel', outputIndex: 0 },
  { from: 'Extraction Schema', to: 'Extract Facts', type: 'ai_outputParser', outputIndex: 0 },
  { from: 'Anthropic (Summary)', to: 'Attorney Summary', type: 'ai_languageModel', outputIndex: 0 },
  { from: 'Summary Schema', to: 'Attorney Summary', type: 'ai_outputParser', outputIndex: 0 },
];

const connections = {};
for (const l of links) {
  connections[l.from] ??= {};
  connections[l.from][l.type] ??= [];
  while (connections[l.from][l.type].length <= l.outputIndex) connections[l.from][l.type].push([]);
  connections[l.from][l.type][l.outputIndex].push({ node: l.to, type: l.type, index: 0 });
}

const names = new Set(nodes.map((n) => n.name));
for (const l of links) for (const n of [l.from, l.to]) if (!names.has(n)) throw new Error(`Unknown node in connections: ${n}`);

const workflow = {
  id: 'intake-triage-v1', // required by `n8n import:workflow`; ignored by the UI importer
  name: 'AI Intake Triage',
  nodes,
  connections,
  settings: { executionOrder: 'v1' },
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
};

const out = path.join(ROOT, 'workflow/intake-triage.n8n.json');
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + '\n');
console.log(`wrote ${path.relative(ROOT, out)} — ${nodes.length} nodes, ${links.length} connections`);

// Paste-able snippet of just the form branch (select-all → copy → Cmd+V on the n8n canvas), for adding the
// live entry point to an already-configured workflow without re-importing and re-selecting credentials.
const snippetFor = (names) => ({
  nodes: nodes.filter((n) => names.includes(n.name)),
  connections: Object.fromEntries(
    Object.entries(connections)
      .filter(([from]) => names.includes(from))
      .map(([from, byType]) => [from, { main: byType.main.map((outs) => outs.filter((c) => names.includes(c.node))) }]),
  ),
});
fs.mkdirSync(path.join(ROOT, 'workflow/snippets'), { recursive: true });
for (const [file, names, tail] of [
  ['form-branch.json', ['Intake Form', 'File uploaded?', 'Read Uploaded File', 'Normalize Form Intake'], 'Normalize Form Intake'],
  ['google-form-branch.json', ['Google Form Responses', 'Normalize Form Response', 'Form has file?', 'Download Uploaded File', 'Read Downloaded File', 'Attach File Text'], 'Attach File Text (and the "false" output of Form has file?)'],
]) {
  fs.writeFileSync(path.join(ROOT, 'workflow/snippets', file), JSON.stringify(snippetFor(names), null, 2) + '\n');
  console.log(`wrote workflow/snippets/${file} — paste it on the canvas, then connect "${tail}" → "Normalize Intake"`);
}
