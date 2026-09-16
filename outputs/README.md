# Outputs

Real outputs of the n8n workflow, copied from the **Validate Summary** node (the row that goes to the review sheet), with `record_json` expanded into `record` so the verbatim `evidence` behind every value is readable.

| File | What it shows |
|---|---|
| `intake-1.json` | Voicemail → READY FOR ATTORNEY REVIEW, urgency HIGH. Corrected phone number picked up; relative date kept as words, `normalized_iso: NOT FOUND`. |
| `intake-2.json` | Web form → READY, urgency MEDIUM. Facility recovered from the free-text description; blank form fields honestly `NOT FOUND`. |
| `intake-3.json` | Referral email → **NEEDS FOLLOW-UP** (Goal 04). Client never named → `NOT FOUND`; the referring attorney is the contact; alert e-mail sent. |
| `intake-4-oversized.error-row.json` | 6 MB "wrong attachment" → **PIPELINE ERROR** row. The API rejected the request (HTTP 400, not billed); original text preserved (truncated to fit a sheet cell); alert e-mail sent. |
| `test-run.sonnet.json` | An earlier development run, kept for comparison (older column layout). |

Model for all rows: `claude-sonnet-5` (see the README's *Model choice*). Columns match `n8n/sheet-headers.csv`.
