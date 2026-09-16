// Node: "Validate Summary" — Code node, mode: Run Once for Each Item
// Checks the attorney summary (Goal 02) and builds the flat row that goes to the review sheet.
//   1. Exactly five sentences.
//   2. No leaked specifics: any phone-like number, email, or year in the summary must exist in the source text.
// A failing summary is never discarded — it is flagged (summary_valid=false) and the intake is routed to follow-up.

const NOT_FOUND = 'NOT FOUND';

// Google Sheets caps a cell at 50,000 characters. Keep the original text readable in the row, but never let an
// oversized intake break the write (that would silence the very branch meant to report problems).
// Dates for humans: "27 Apr 2026 08:42" in the workflow's timezone (GENERIC_TIMEZONE), not ISO-8601.
const TZ = (() => { try { return $env.GENERIC_TIMEZONE || 'UTC'; } catch (e) { return 'UTC'; } })();
const fmtDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.day} ${p.month} ${p.year} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
};

const SHEET_CELL_MAX = 45000;
const fitCell = (s) => {
  const t = String(s ?? '');
  return t.length <= SHEET_CELL_MAX ? t : t.slice(0, SHEET_CELL_MAX) + `\n\n[... truncated for the sheet: ${t.length.toLocaleString()} characters in total ...]`;
};

// Same key-based lookup as the guard: the summary chain echoes intake_id, we find the guarded record by it.
const out = $json.output || {};
const echoed = out.intake_id && typeof out.intake_id === 'object' ? out.intake_id.value : out.intake_id;
const intakeId = String(echoed ?? '').trim();
const guarded = $('Traceability Guard').all().map((i) => i.json);
let g = guarded.find((s) => s.intake_id === intakeId);
if (!g && guarded.length === 1) g = guarded[0];
if (!g && $('Attorney Summary').all().length === guarded.length) g = guarded[$itemIndex];
if (!g) {
  throw new Error(`Validate Summary: summary carries intake_id "${intakeId}" which matches no guarded record, and the run is ambiguous (${guarded.length} records)`);
}
const r = g.record;

const summary = String(out.summary ?? '').replace(/\s+/g, ' ').trim();

// Sentence count. Periods that are not sentence ends are masked first: single-letter initials
// ("Marcus T. Bellweather") and common titles/abbreviations the model may legitimately keep.
const masked = summary
  .replace(/\b([A-Z])\.(?=\s)/g, '$1․')
  .replace(/\b(Mr|Mrs|Ms|Dr|Jr|Sr|St|No|vs|etc|Inc|Ltd|PLLC|LLC)\.(?=\s)/g, '$1․');
const sentences = masked.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [];
const problems = [];

if (sentences.length !== 5) problems.push(`summary has ${sentences.length} sentences, expected 5`);

const sourceDigits = g.raw_text.replace(/\D/g, '');
const sourceLower = g.raw_text.toLowerCase();
for (const token of summary.match(/[\d()+\-.\s]{7,}/g) || []) {
  const digits = token.replace(/\D/g, '');
  if (digits.length >= 7 && !sourceDigits.includes(digits)) problems.push(`summary contains a number not in the source: "${token.trim()}"`);
}
for (const raw of summary.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []) {
  const email = raw.replace(/[.,;:]+$/, ''); // drop sentence punctuation glued to the address
  if (!sourceLower.includes(email.toLowerCase())) problems.push(`summary contains an email not in the source: ${email}`);
}
for (const year of summary.match(/\b(19|20)\d{2}\b/g) || []) {
  if (!g.raw_text.includes(year)) problems.push(`summary contains a year not in the source: ${year}`);
}

const summary_valid = problems.length === 0;
const review_required = g.review_required || !summary_valid;
const status = review_required ? 'NEEDS FOLLOW-UP' : 'READY FOR ATTORNEY REVIEW';
const warnings = [...g.validation_warnings, ...problems];

// One flat row = one line in the "Intake Review Queue" sheet, ordered the way a paralegal reads it:
// decide (status, urgency) → who/what (client, summary, gaps, contact) → context → technical trail at the end.
// The Sheets node ignores fields that have no column, so follow_up_contact stays available to the alert e-mail
// without cluttering the sheet.
const contact = r.contact_name.value === NOT_FOUND ? NOT_FOUND
  : r.relationship_to_client.value === NOT_FOUND ? r.contact_name.value
  : `${r.contact_name.value} (${r.relationship_to_client.value})`;

return {
  json: {
    status,
    urgency: r.urgency_flag.value,
    urgency_reason: r.urgency_flag.reason || '',
    client_name: r.potential_client_name.value,
    summary,
    missing_fields: g.missing_fields.length ? g.missing_fields.join('; ') : 'none',
    contact_name: contact,
    contact_phone: r.contact_information.phone.value,
    contact_email: r.contact_information.email.value,
    facility: r.facility_or_provider.value,
    injury_type: r.injury_type.value,
    date_of_incident: r.date_of_incident.value,
    referral_source: r.referral_source.value,
    channel: g.channel,
    submitted_by: g.submitted_by || 'not provided',
    received_at: fmtDate(g.received_at),
    intake_id: g.intake_id,
    warnings: warnings.length ? warnings.join(' | ') : 'none',
    source_text: fitCell(g.raw_text),
    record_json: JSON.stringify({ _model: g.model, _summary_sentence_count: sentences.length, ...r }),
    processed_at: fmtDate(g.processed_at),
    // not a sheet column — used by the alert e-mail
    follow_up_contact: g.follow_up_contact,
  },
};
