// Node: "Attach File Text" — Code node, mode: Run Once for Each Item
// After "Read Downloaded File" put the uploaded file's contents in $json.data, merge it into raw_text.
// Pasted text wins when both were provided; the file is the fallback. Drops the transport fields.

// Belt and braces: if the Drive/Extract nodes dropped the JSON (Extract From File does so unless
// "Keep Source" is explicitly set), recover the intake fields from the node that built them.
let origin = {};
try { origin = $('Normalize Form Response').item.json || {}; } catch (e) { origin = {}; }
const j = { ...origin, ...$json };
const pasted = String(j.raw_text ?? '').trim();
const fromFile = String(j.data ?? '').trim();
const raw_text = pasted || fromFile;

if (!raw_text) {
  throw new Error(`Uploaded file for ${j.intake_id} is empty or could not be read as text.`);
}

return {
  json: {
    intake_id: j.intake_id,
    channel: j.channel,
    received_at: j.received_at,
    raw_text,
    submitted_by: j.submitted_by,
  },
};
