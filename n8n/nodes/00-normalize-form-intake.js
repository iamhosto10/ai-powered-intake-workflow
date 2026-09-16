// Node: "Normalize Form Intake" — Code node, mode: Run Once for Each Item
// Turns a submission of the "New intake" form into the same shape the batch path produces:
//   { intake_id, channel, received_at, raw_text }
// The form offers two ways in: paste the text, or upload a file (.txt/.json/.eml/.md). If a file was
// uploaded, "Read Uploaded File" has already put its contents in $json.data. Pasted text wins if both exist.

// If the file was read by "Read Uploaded File", that node may have dropped the form fields; recover them.
let origin = {};
try { origin = $('Intake Form').item.json || {}; } catch (e) { origin = {}; }
const j = { ...origin, ...$json };
const pasted = String(j['Intake text'] ?? '').trim();
const fromFile = String(j.data ?? '').trim();
const raw_text = pasted || fromFile;

if (!raw_text) {
  throw new Error('The form was submitted with neither pasted text nor a file. Nothing to process.');
}

const now = new Date();
const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, ''); // e.g. 20260915T170521

return {
  json: {
    intake_id: `form-${stamp}`,
    channel: String(j['Channel'] ?? 'other'),
    received_at: now.toISOString(),
    raw_text,
    submitted_by: 'n8n form',
  },
};
