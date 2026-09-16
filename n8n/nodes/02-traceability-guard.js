// Node: "Traceability Guard" — Code node, mode: Run Once for Each Item
//
// THE RULE (Goal 03 — traceability and honesty):
//   A fact survives only if its `evidence` quote appears VERBATIM in the source intake text.
//   The prompt asks the model not to guess; this node guarantees it. Anything that fails the
//   check is reverted to NOT FOUND and logged in validation_warnings. Nothing is ever "fixed up".

const NOT_FOUND = 'NOT FOUND';

// n8n's LLM chain nodes do not preserve item pairing on successful outputs, so we cannot ask
// "which input produced this?". Instead the model echoes the intake_id we put at the top of its
// message, and we look the source intake up by that key. A mismatch stops the run loudly rather
// than silently checking one intake's facts against another intake's text.
const rec = JSON.parse(JSON.stringify($json.output || {}));
const echoed = rec.intake_id && typeof rec.intake_id === 'object' ? rec.intake_id.value : rec.intake_id;
const intakeId = String(echoed ?? '').trim();
delete rec.intake_id;

const sources = $('Normalize Intake').all().map((i) => i.json);
let source = sources.find((s) => s.intake_id === intakeId);
// Fallbacks that never guess: a single intake in this run is unambiguous; and if no item was lost upstream
// (same count in and out of the LLM node) positions still line up. Anything else stops the run.
if (!source && sources.length === 1) source = sources[0];
if (!source && $('Extract Facts').all().length === sources.length) source = sources[$itemIndex];
if (!source) {
  throw new Error(`Traceability Guard: model output carries intake_id "${intakeId}" which matches no source intake, and the run is ambiguous (${sources.length} intakes)`);
}
const raw = String(source.raw_text || '');
const MAX_EVIDENCE_CHARS = 300; // a "quote" longer than this is not a citation, it's a paste

// Normalisation is deliberately minimal: case, quote style, dash style, whitespace.
// It never touches letters or digits, so a paraphrase still fails.
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[“”"‘’']/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

const SOURCE = norm(raw);
const warnings = [];
const missing = [];

function guard(path, fact) {
  if (!fact || typeof fact !== 'object') {
    warnings.push(`${path}: absent from model output -> set to ${NOT_FOUND}`);
    missing.push(path);
    return { value: NOT_FOUND, evidence: null };
  }
  const value = String(fact.value ?? '').trim();
  if (!value || value.toUpperCase() === NOT_FOUND) {
    fact.value = NOT_FOUND;
    fact.evidence = null;
    missing.push(path);
    return fact;
  }
  const ev = norm(fact.evidence);
  let reason = null;
  if (!ev) reason = 'no evidence quote provided';
  else if (ev.length > MAX_EVIDENCE_CHARS) reason = 'evidence quote too long to be a verbatim citation';
  else if (!SOURCE.includes(ev)) reason = 'evidence quote not found verbatim in source';
  if (reason) {
    warnings.push(`${path}: ${reason} -> value "${value}" reverted to ${NOT_FOUND}`);
    fact.value = NOT_FOUND;
    fact.evidence = null;
    missing.push(path);
  }
  return fact;
}

rec.potential_client_name = guard('potential_client_name', rec.potential_client_name);
rec.contact_name = guard('contact_name', rec.contact_name);
rec.relationship_to_client = guard('relationship_to_client', rec.relationship_to_client);
rec.contact_information = rec.contact_information || {};
rec.contact_information.phone = guard('contact_information.phone', rec.contact_information.phone);
rec.contact_information.email = guard('contact_information.email', rec.contact_information.email);
rec.facility_or_provider = guard('facility_or_provider', rec.facility_or_provider);
rec.date_of_incident = guard('date_of_incident', rec.date_of_incident);
rec.injury_type = guard('injury_type', rec.injury_type);
rec.referral_source = guard('referral_source', rec.referral_source);
rec.urgency_flag = guard('urgency_flag', rec.urgency_flag);

// Urgency must be one of the allowed labels — anything else is not a rating.
const URGENCY = ['HIGH', 'MEDIUM', 'LOW', NOT_FOUND];
if (!URGENCY.includes(rec.urgency_flag.value)) {
  warnings.push(`urgency_flag: "${rec.urgency_flag.value}" is not HIGH/MEDIUM/LOW -> reverted to ${NOT_FOUND}`);
  rec.urgency_flag.value = NOT_FOUND;
}
rec.urgency_flag.reason = rec.urgency_flag.value === NOT_FOUND ? '' : String(rec.urgency_flag.reason ?? '');

// Date rule: a normalised ISO date is allowed only when the quoted evidence itself contains a
// complete absolute date with a year. "Right after Easter" stays as words; the human decides.
const dateEvidence = norm(rec.date_of_incident.evidence);
const hasAbsoluteDate =
  /\b(19|20)\d{2}\b/.test(dateEvidence) || /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}\b/.test(dateEvidence);
if (rec.date_of_incident.value === NOT_FOUND || !hasAbsoluteDate) {
  if (rec.date_of_incident.normalized_iso && rec.date_of_incident.normalized_iso !== NOT_FOUND) {
    warnings.push(
      `date_of_incident.normalized_iso: "${rec.date_of_incident.normalized_iso}" was inferred from a relative expression -> reverted to ${NOT_FOUND}`,
    );
  }
  rec.date_of_incident.normalized_iso = NOT_FOUND;
}

// Readiness: an attorney can act only if we know who, how to reach them, where, and what injury.
const has = (f) => f && f.value !== NOT_FOUND;
const coreGaps = [];
if (!has(rec.potential_client_name)) coreGaps.push('potential_client_name');
if (!has(rec.contact_information.phone) && !has(rec.contact_information.email)) coreGaps.push('contact_information (phone or email)');
if (!has(rec.injury_type)) coreGaps.push('injury_type');
if (!has(rec.facility_or_provider)) coreGaps.push('facility_or_provider');
const review_required = coreGaps.length > 0 || warnings.length > 0;

// Who can fill the gaps: the contact who wrote in, else the referral source.
const followUp = [
  has(rec.contact_name) ? rec.contact_name.value : null,
  has(rec.relationship_to_client) ? `(${rec.relationship_to_client.value})` : null,
  has(rec.contact_information.phone) ? rec.contact_information.phone.value : null,
  has(rec.contact_information.email) ? rec.contact_information.email.value : null,
]
  .filter(Boolean)
  .join(' ');
const follow_up_contact = followUp || (has(rec.referral_source) ? `referral source: ${rec.referral_source.value}` : NOT_FOUND);

// Flat rendering of the VALIDATED record — this is the only thing the summary writer sees.
const line = (label, f) => `${label}: ${f.value}` + (has(f) && f.evidence ? `  [source: "${f.evidence}"]` : '');
const record_text = [
  `Intake ${source.intake_id} via ${source.channel}, received ${source.received_at}`,
  line('Potential client (injured person)', rec.potential_client_name),
  line('Contact person', rec.contact_name),
  line('Relationship to client', rec.relationship_to_client),
  line('Contact phone', rec.contact_information.phone),
  line('Contact email', rec.contact_information.email),
  line('Facility or provider', rec.facility_or_provider),
  line('Date of incident (as stated)', rec.date_of_incident),
  `Date of incident (normalised): ${rec.date_of_incident.normalized_iso}`,
  line('Injury type', rec.injury_type),
  line('Referral source', rec.referral_source),
  `Urgency: ${rec.urgency_flag.value}` + (rec.urgency_flag.reason ? ` - ${rec.urgency_flag.reason}` : ''),
  `Missing fields: ${missing.length ? missing.join(', ') : 'none'}`,
  `Who can supply missing information: ${follow_up_contact}`,
].join('\n');

return {
  json: {
    intake_id: source.intake_id,
    channel: source.channel,
    received_at: source.received_at,
    submitted_by: source.submitted_by || 'not provided',
    raw_text: raw,
    record: rec,
    record_text,
    missing_fields: missing,
    missing_count: missing.length,
    core_gaps: coreGaps,
    validation_warnings: warnings,
    review_required,
    follow_up_contact,
    processed_at: new Date().toISOString(),
    // Read the real model ID from the Anthropic node so the sheet never lies about which model ran.
    model: (() => { try { return $('Anthropic (Extract)').params.model.value; } catch (e) { return 'unknown'; } })(),
  },
};
