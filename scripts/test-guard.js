#!/usr/bin/env node
// Offline test for the Code nodes (no n8n, no API calls). Simulates n8n's $json / $('Node').item.
// Run: node scripts/test-guard.js
//   1. A fabricated evidence quote must be reverted to NOT FOUND (the rule works).
//   2. A verbatim quote must survive, including quote/dash/whitespace normalisation.
//   3. An inferred ISO date from a relative expression must be reverted.
//   4. Validate Summary: sentence count and leaked-number detection.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const nodeSrc = (f) => fs.readFileSync(path.join(ROOT, 'n8n/nodes', f), 'utf8');

// Run a "Run Once for Each Item" Code node body with mocked n8n globals.
function runNode(file, { $json, nodes, $itemIndex = 0 }) {
  // nodes[name] may be one item or a list; .all() returns the list, .item the first (error-path pairing).
  const list = (name) => (Array.isArray(nodes[name]) ? nodes[name] : [nodes[name]]).map((json) => ({ json }));
  const $ = (name) => ({ all: () => list(name), item: list(name)[0], params: { model: { value: 'claude-opus-5' } } });
  const fn = new Function('$', '$json', '$itemIndex', nodeSrc(file));
  return fn($, $json, $itemIndex).json;
}

const raw = fs.readFileSync(path.join(ROOT, 'samples/intake-3-referral-email.txt'), 'utf8').trim();
const normalize = { intake_id: 'intake-3', channel: 'referral_email', received_at: '2026-04-29T16:47:00-05:00', raw_text: raw };

const fact = (value, evidence) => ({ value, evidence });
const NF = 'NOT FOUND';

// --- Simulated model output for intake-3, with two deliberate violations ---
const modelOutput = {
  intake_id: { value: 'intake-3', evidence: null },
  potential_client_name: fact('Mrs. Venkataraman', 'his mother, Mrs. Venkataraman'), // FABRICATED quote → must revert
  contact_name: fact('Priya Venkataraman', 'Priya Venkataraman'),
  relationship_to_client: fact('referring attorney', "I'm referring a matter that's outside our practice area"),
  contact_information: {
    phone: fact('(773) 555-0177', 'Direct: (773) 555-0177'),
    email: fact('pvenkataraman.test@example.com', 'From: Priya Venkataraman <pvenkataraman.test@example.com>'),
  },
  facility_or_provider: fact('Cedar Hollow Care Center', 'who is a resident at Cedar Hollow Care Center'),
  date_of_incident: { value: 'went unreported for some time', evidence: 'went unreported for some time', normalized_iso: '2026-04-01' }, // inferred ISO → must revert
  injury_type: fact('pressure ulcers', 'she developed pressure ulcers there'),
  referral_source: fact('Priya Venkataraman, Venkataraman Family Law, PLLC', 'Venkataraman Family Law, PLLC'),
  urgency_flag: { value: 'HIGH', reason: 'The mother is still a resident and the family wants to move quickly.', evidence: 'wants to move quickly' },
};

const guarded = runNode('02-traceability-guard.js', { $json: { output: modelOutput }, nodes: { 'Normalize Intake': normalize } });

assert.strictEqual(guarded.record.potential_client_name.value, NF, 'fabricated client name must be reverted');
assert.strictEqual(guarded.record.potential_client_name.evidence, null);
assert.strictEqual(guarded.record.facility_or_provider.value, 'Cedar Hollow Care Center', 'verbatim quote must survive');
assert.strictEqual(guarded.record.date_of_incident.normalized_iso, NF, 'inferred ISO date must be reverted');
assert.strictEqual(guarded.record.urgency_flag.value, 'HIGH');
assert.ok(guarded.validation_warnings.some((w) => w.startsWith('potential_client_name:')), 'warning for fabricated quote');
assert.ok(guarded.validation_warnings.some((w) => w.startsWith('date_of_incident.normalized_iso:')), 'warning for inferred date');
assert.strictEqual(guarded.review_required, true);
assert.ok(guarded.core_gaps.includes('potential_client_name'));
assert.ok(guarded.record_text.includes('Potential client (injured person): NOT FOUND'));
console.log('✔ guard: fabricated evidence reverted, verbatim evidence kept, inferred date reverted');

// --- Normalisation: curly quotes / em dash / extra spaces in the model's quote must still match ---
const curly = runNode('02-traceability-guard.js', {
  $json: { output: { ...modelOutput, injury_type: fact('pressure ulcers', 'she developed  pressure ulcers there') } },
  nodes: { 'Normalize Intake': normalize },
});
assert.strictEqual(curly.record.injury_type.value, 'pressure ulcers', 'whitespace differences are tolerated');
console.log('✔ guard: whitespace/quote-style normalisation tolerated, wording is not');

// --- Validate Summary ---
const goodSummary =
  'A referring attorney reports that her client\'s mother, whose name was not provided, may have suffered neglect. ' +
  'It happened at Cedar Hollow Care Center and the date was not provided. ' +
  'The injury is pressure ulcers that reportedly went unreported for some time, and the family has photos. ' +
  'The client\'s name and contact details are missing and can be obtained from Priya Venkataraman at (773) 555-0177. ' +
  'Call the referring attorney today; urgency is HIGH because the resident is still at the facility.';
const row = runNode('03-validate-summary.js', { $json: { output: { intake_id: 'intake-3', summary: goodSummary } }, nodes: { 'Traceability Guard': guarded } });
assert.strictEqual(JSON.parse(row.record_json)._summary_sentence_count, 5);
assert.ok(!row.warnings.includes('summary'), 'no summary problems (guard warnings are expected here)');
assert.strictEqual(row.status, 'NEEDS FOLLOW-UP');
assert.strictEqual(row.client_name, NF);
console.log('✔ validate: 5 sentences accepted, status NEEDS FOLLOW-UP, flat row built');

const leaky = goodSummary.replace('(773) 555-0177', '(312) 555-0000') + ' Extra sentence.';
const bad = runNode('03-validate-summary.js', { $json: { output: { intake_id: 'intake-3', summary: leaky } }, nodes: { 'Traceability Guard': guarded } });
assert.strictEqual(JSON.parse(bad.record_json)._summary_sentence_count, 6);
assert.ok(bad.warnings !== 'none');
assert.ok(bad.warnings.includes('expected 5'));
assert.ok(bad.warnings.includes('number not in the source'));
console.log('✔ validate: 6 sentences + leaked phone number flagged (summary kept, not discarded)');

// --- Regression: initials and a trailing period after an email must not produce false positives ---
const tricky =
  'Marcus T. Bellweather developed pressure ulcers during a rehab stay at Riverbend Rehabilitation. ' +
  'The date was not provided and Dr. Smith is not mentioned anywhere. ' +
  'The injury is pressure ulcers and he is healing at home. ' +
  'His phone is missing and he can be reached at m.bellweather.test@example.com. ' +
  'Contact Marcus T. Bellweather by email; urgency is MEDIUM.';
const trickySource = { ...guarded, raw_text: 'email: m.bellweather.test@example.com\nfull name: Marcus T. Bellweather', intake_id: 'intake-2' };
const t = runNode('03-validate-summary.js', { $json: { output: { intake_id: 'intake-2', summary: tricky } }, nodes: { 'Traceability Guard': trickySource } });
assert.strictEqual(JSON.parse(t.record_json)._summary_sentence_count, 5, 'initials (T.) and titles (Dr.) are not sentence ends');
assert.ok(!t.warnings.includes('summary'), 'email followed by a period is still recognised');
console.log('✔ validate: initials/titles not counted as sentence ends; email + period not flagged');

// --- Tolerance: null in normalized_iso / reason must not break anything ---
const nulls = runNode('02-traceability-guard.js', {
  $json: { output: { ...modelOutput, date_of_incident: { value: NF, evidence: null, normalized_iso: null }, urgency_flag: { value: 'LOW', reason: null, evidence: 'Let me know if you need anything from me.' } } },
  nodes: { 'Normalize Intake': [normalize] },
});
assert.strictEqual(nulls.record.date_of_incident.normalized_iso, NF);
assert.strictEqual(nulls.record.urgency_flag.reason, '');
console.log('✔ guard: null normalized_iso/reason tolerated');

// --- Routing key: wrong/missing id is fine when the run has a single intake (forms), or positions line up ---
const single = runNode('02-traceability-guard.js', { $json: { output: { ...modelOutput, intake_id: { value: 'NOT FOUND', evidence: null } } }, nodes: { 'Normalize Intake': [normalize] } });
assert.strictEqual(single.intake_id, 'intake-3', 'single-intake run resolves without the echoed id');
const two = [ { intake_id: 'intake-1', channel: 'voicemail', received_at: 'x', raw_text: 'unrelated' }, normalize ];
const byPos = runNode('02-traceability-guard.js', { $json: { output: { ...modelOutput, intake_id: 'garbage' } }, nodes: { 'Normalize Intake': two, 'Extract Facts': two }, $itemIndex: 1 });
assert.strictEqual(byPos.intake_id, 'intake-3', 'positions line up when nothing was lost upstream');
// ...but an ambiguous run (an item was lost upstream and the id is wrong) must stop loudly
assert.throws(
  () => runNode('02-traceability-guard.js', { $json: { output: { ...modelOutput, intake_id: 'intake-9' } }, nodes: { 'Normalize Intake': two, 'Extract Facts': [normalize] } }),
  /run is ambiguous/,
);
// and with several sources present, the guard must pick the right one by key, not by position
const other = { intake_id: 'intake-1', channel: 'voicemail', received_at: 'x', raw_text: 'unrelated text' };
const byKey = runNode('02-traceability-guard.js', { $json: { output: modelOutput }, nodes: { 'Normalize Intake': [other, normalize] } });
assert.strictEqual(byKey.intake_id, 'intake-3');
assert.strictEqual(byKey.record.facility_or_provider.value, 'Cedar Hollow Care Center');
console.log('✔ routing: unknown intake_id throws; lookup is by key, not by position');

// --- Error row ---
const errRow = runNode('04-build-error-row.js', { $json: { error: { message: 'Anthropic API 401' } }, nodes: { 'Normalize Intake': normalize } });
assert.strictEqual(errRow.status, 'PIPELINE ERROR');
assert.ok(errRow.warnings.includes('401'));
assert.strictEqual(errRow.source_text, raw);
console.log('✔ error row: PIPELINE ERROR with source text preserved');

// --- Oversized intake: the sheet cell limit must never break the error branch ---
const huge = { ...normalize, raw_text: 'x'.repeat(200000) };
const hugeRow = runNode('04-build-error-row.js', { $json: { error: 'prompt is too long' }, nodes: { 'Normalize Intake': huge } });
assert.ok(hugeRow.source_text.length < 50000, 'source_text must fit a Google Sheets cell');
assert.ok(hugeRow.source_text.includes('truncated for the sheet'));
console.log('✔ error row: 200k-char source truncated to fit a sheet cell');

// --- Form entry point: pasted text wins, file text is the fallback, neither = loud error ---
const f1 = runNode('00-normalize-form-intake.js', { $json: { Channel: 'referral_email', 'Intake text': '  hello  ', data: 'file text' }, nodes: {} });
assert.strictEqual(f1.raw_text, 'hello');
assert.strictEqual(f1.channel, 'referral_email');
assert.ok(/^form-\d{8}T\d{6}$/.test(f1.intake_id), f1.intake_id);
const f2 = runNode('00-normalize-form-intake.js', { $json: { Channel: 'voicemail', 'Intake text': '', data: 'file text' }, nodes: {} });
assert.strictEqual(f2.raw_text, 'file text');
assert.throws(() => runNode('00-normalize-form-intake.js', { $json: { Channel: 'other', 'Intake text': '' }, nodes: {} }), /neither pasted text nor a file/);
console.log('✔ form: pasted text > file text; empty submission throws');

// --- Sheet contract: both row builders emit exactly the header columns (+ the e-mail-only field) ---
const HEADERS = fs.readFileSync(path.join(ROOT, 'n8n/sheet-headers.csv'), 'utf8').trim().split(',');
for (const [name, r] of [['Validate Summary', row], ['Build Error Row', errRow]]) {
  const keys = Object.keys(r).filter((k) => k !== 'follow_up_contact');
  assert.deepStrictEqual(keys, HEADERS, `${name} columns must match n8n/sheet-headers.csv in order`);
}
assert.ok(row.contact_name.includes('(referring attorney)'));
console.log('✔ sheet: 20 paralegal-first columns, identical in both row builders');
assert.match(row.received_at, /^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/, `human date, got "${row.received_at}"`);
assert.match(errRow.processed_at, /^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/);
console.log(`✔ dates: human-readable (${row.received_at})`);

// --- Google Form response → intake (loose column matching, Drive link → file id, stable id) ---
const gf = runNode('05-normalize-form-response.js', { $json: { 'Marca temporal': '16/9/2026 10:15:32', Channel: 'referral_email', 'Intake text': '', 'Your name': 'Ana', 'Intake file': 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345' }, nodes: {} });
assert.strictEqual(gf.file_id, '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
assert.strictEqual(gf.intake_id, 'gform-1692026101532');
assert.strictEqual(gf.submitted_by, 'Ana');
assert.throws(() => runNode('05-normalize-form-response.js', { $json: { Timestamp: 'x', Channel: 'other', 'Intake text': '', 'Intake file': '' }, nodes: {} }), /neither intake text nor an uploaded file/);
const at = runNode('06-attach-file-text.js', { $json: { data: 'file contents here' }, nodes: { 'Normalize Form Response': gf } }); // json dropped upstream
assert.strictEqual(at.raw_text, 'file contents here');
assert.strictEqual(at.file_id, undefined, 'transport fields dropped');
assert.strictEqual(at.intake_id, gf.intake_id, 'intake fields recovered from Normalize Form Response');
assert.strictEqual(at.channel, 'referral_email');
const nf = runNode('00-normalize-form-intake.js', { $json: { data: 'file text' }, nodes: { 'Intake Form': { Channel: 'voicemail', 'Intake text': '' } } });
assert.strictEqual(nf.channel, 'voicemail', 'n8n form channel recovered after file extraction');
console.log('✔ google form: columns matched loosely, Drive id extracted, file text attached');

console.log('\nAll offline checks passed.');
