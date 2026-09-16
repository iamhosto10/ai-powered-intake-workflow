#!/usr/bin/env node
// Generates samples/intake-4-oversized.txt (~6 MB, git-ignored): a realistic "wrong file attached" intake —
// a voicemail-system export that dumps months of call logs after the actual message.
// It is far above the model's 1M-token context, so the Anthropic API rejects it (HTTP 400, not billed),
// "Extract Facts" routes it to its error output, and the PIPELINE ERROR branch runs end to end.
// Run: node scripts/make-oversized-sample.js   → then upload the file through the "New intake" form.

const fs = require('fs');
const path = require('path');

const TARGET_BYTES = 6 * 1024 * 1024;
const out = path.join(__dirname, '..', 'samples', 'intake-4-oversized.txt');

const header = `[Voicemail system export — SYNTHETIC TEST DATA, no real persons or facilities]
Export requested by: front desk · Range: 2025-10-01 to 2026-04-30 · Format: full log with transcripts
WARNING: this export contains every event recorded by the PBX in the selected range.

=== MESSAGE 1 of 4,118 ===
Received: Thu, 30 Apr 2026 11:05 · Main office line · Duration 0:48
Hi, this is Robert Anand, I'm calling for my father, Kumar Anand, he's at Lakeside Manor and he had a fall last Tuesday, April 21st, 2026. Left wrist fracture. My number is 312-555-0164. Please call me.

=== EVENT LOG (all lines) ===
`;

const filler = [
  'RING  ext=101 caller=+1312555XXXX trunk=SIP/1 duration=00:00:00 result=NO_ANSWER',
  'HANGUP ext=101 cause=16 reason=NORMAL_CLEARING',
  'VOICEMAIL box=101 msg_id=%ID% length=0:07 transcript="(silence)"',
  'TRANSFER from=101 to=104 result=OK',
  'DTMF ext=104 digits=#',
  'FAX_DETECT ext=104 result=NONE',
  'RING  ext=104 caller=+1773555XXXX trunk=SIP/2 duration=00:01:12 result=ANSWERED',
  'VOICEMAIL box=104 msg_id=%ID% length=0:03 transcript="(hangup)"',
];

const fd = fs.openSync(out, 'w');
fs.writeSync(fd, header);
let bytes = Buffer.byteLength(header);
let i = 0;
while (bytes < TARGET_BYTES) {
  const ts = new Date(Date.UTC(2025, 9, 1) + i * 137_000).toISOString().replace('T', ' ').slice(0, 19);
  const line = `${ts} ${filler[i % filler.length].replace('%ID%', String(100000 + i))}\n`;
  fs.writeSync(fd, line);
  bytes += Buffer.byteLength(line);
  i++;
}
fs.closeSync(fd);
console.log(`wrote ${path.relative(process.cwd(), out)} — ${(bytes / 1024 / 1024).toFixed(1)} MB, ${i.toLocaleString()} log lines (~${Math.round(bytes / 4 / 1000)}k tokens, above the 1M context limit)`);
