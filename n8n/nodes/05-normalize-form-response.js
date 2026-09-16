// Node: "Normalize Form Response" — Code node, mode: Run Once for Each Item
// One row of the Google Form's response sheet → { intake_id, channel, received_at, raw_text, submitted_by, file_id }.
// Column names are the Form's question titles. They are matched loosely (case-insensitive, and the timestamp
// column may be "Timestamp" or "Marca temporal" depending on the account's language), so a renamed question
// does not silently break the intake.

const row = $json;
const keys = Object.keys(row);
const find = (re) => keys.find((k) => re.test(k));

const tsKey = find(/timestamp|marca temporal|fecha/i) || keys[0];
const channelKey = find(/^channel$|canal/i);
const textKey = find(/intake text|texto/i);
const nameKey = find(/your name|nombre/i);
const fileKey = find(/intake file|archivo|file/i);

const timestamp = String(row[tsKey] ?? '').trim();
const channel = String((channelKey && row[channelKey]) || 'other').trim();
const pasted = String((textKey && row[textKey]) || '').trim();
const submitted_by = String((nameKey && row[nameKey]) || '').trim() || 'not provided';

// A file-upload answer is one or more Google Drive links: https://drive.google.com/open?id=<FILE_ID>
const fileAnswer = String((fileKey && row[fileKey]) || '');
const fileMatch = fileAnswer.includes('drive.google.com') ? fileAnswer.match(/[-\w]{25,}/) : null;
const file_id = fileMatch ? fileMatch[0] : '';

if (!pasted && !file_id) {
  throw new Error(`Form response at ${timestamp || 'unknown time'} has neither intake text nor an uploaded file. Nothing to process.`);
}

// Stable id per form response so re-polling the same row updates the sheet row instead of duplicating it.
const intake_id = `gform-${timestamp.replace(/\D/g, '') || Date.now()}`;
const parsed = new Date(timestamp);
const received_at = Number.isNaN(parsed.getTime()) ? timestamp : parsed.toISOString();

return { json: { intake_id, channel, received_at, raw_text: pasted, submitted_by, file_id } };
