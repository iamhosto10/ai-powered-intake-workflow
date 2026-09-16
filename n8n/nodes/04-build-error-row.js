// Node: "Build Error Row" — Code node, mode: Run Once for Each Item
// Reached only through the error output of an LLM chain (API failure, invalid JSON, timeout).
// Nothing is silently dropped: the intake still gets a row, with status PIPELINE ERROR and the
// original text intact, and the alert branch tells a human to handle it manually.

// Error outputs DO carry item pairing (unlike successful LLM outputs), but only one hop back.
// A summary failure pairs to Traceability Guard; an extraction failure pairs to Normalize Intake.
// Both carry intake_id / channel / received_at / raw_text.
let src;
try { src = $('Traceability Guard').item.json; } catch (e) { src = null; }
if (!src || !src.raw_text) src = $('Normalize Intake').item.json;
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
const err = $json.error;
const message = typeof err === 'string' ? err : err && err.message ? err.message : JSON.stringify(err ?? 'unknown error');

return {
  json: {
    status: 'PIPELINE ERROR',
    urgency: NOT_FOUND,
    urgency_reason: '',
    client_name: NOT_FOUND,
    summary: 'Not generated - the AI step failed. Read the source text and process this intake manually.',
    missing_fields: 'all (not processed)',
    contact_name: NOT_FOUND,
    contact_phone: NOT_FOUND,
    contact_email: NOT_FOUND,
    facility: NOT_FOUND,
    injury_type: NOT_FOUND,
    date_of_incident: NOT_FOUND,
    referral_source: NOT_FOUND,
    channel: src.channel,
    submitted_by: src.submitted_by || 'not provided',
    received_at: fmtDate(src.received_at),
    intake_id: src.intake_id,
    warnings: `pipeline error: ${message}`,
    source_text: fitCell(src.raw_text),
    record_json: JSON.stringify({ _model: (() => { try { return $('Anthropic (Extract)').params.model.value; } catch (e) { return 'unknown'; } })() }),
    processed_at: fmtDate(new Date().toISOString()),
    follow_up_contact: NOT_FOUND,
  },
};
