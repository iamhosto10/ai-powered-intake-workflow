# AI Intake Triage — what it does and how to use it

*For intake staff and paralegals · Version 1 · Owner: Gerardo Ramírez*

## What this does

When a new intake arrives — a voicemail transcript, a website form, or a referral e-mail — you submit it through the **New intake** Google Form (paste the text or upload the file). Within a minute the assistant does three things:

1. **Pulls out the key facts** — who the potential client is, how to reach the contact, the facility, the date, the injury, how they found us, and how urgent it looks — and, for every fact, records the exact words in the original where it found it.
2. **Writes a five-sentence summary** an attorney can read in twenty seconds.
3. **Adds a row** to the **Intake Review Queue** sheet with a colour-coded status.

It does not call anyone, does not open a matter, and never deletes the original text (it is in the `source_text` column, and the file you uploaded stays in Drive).

## The three statuses

| Status | Meaning | What you do |
|---|---|---|
| 🟢 **READY FOR ATTORNEY REVIEW** | All core facts (who, how to reach them, where, what injury) were found and verified. | Read the summary, check the urgency, forward to the attorney. |
| 🟡 **NEEDS FOLLOW-UP** | Something essential is missing or could not be verified. You also get an e-mail. | The `missing_fields` column says what to ask; `contact_name` / `contact_phone` say whom. Make the call, then resubmit the intake with the new information (the row updates itself). |
| 🔴 **PIPELINE ERROR** | The assistant could not process this intake at all. You also get an e-mail. | Handle the intake by hand, as you do today, and report it (see below). |

A **HIGH** urgency also sends an e-mail even when the row is green — that means "look today", not "the AI decided".

## When to trust it

- A fact is trustworthy when it has a **source quote** next to it (open `record_json` at the far right, or click the cell). The assistant is built so that any fact **without** an exact quote from the original is thrown away and replaced with `NOT FOUND`.
- So **`NOT FOUND` is honest, not broken.** It means "the intake did not say this", and it is your cue to ask.
- The `warnings` column says `none` when every check passed. Anything else is a note about something the assistant refused to guess.

## When NOT to trust it

- **Urgency is a suggestion.** HIGH means look now; LOW never means ignore. The reason is in `urgency_reason`; judge it yourself.
- **Dates are kept as words.** "Right after Easter" stays exactly that; the assistant will not turn it into a calendar date. You do.
- **Labels can be a reading, not a copy.** "Referring attorney" next to a quote that says "I'm referring a matter" is a reasonable interpretation, verified as to where it came from — not a fact the caller stated.
- **Never act on the summary alone.** Before you call a client, open a matter, or decline a case, read the original text. It is one click away.
- Messy voicemails can confuse **who is the caller and who is the injured person**. Double-check before you address someone.

## When it breaks

Signs: a red row, rows that stop appearing after you submit, a fact with no quote, a summary that is not five sentences, or an e-mail with empty fields.

1. Process the intake manually, as you do today. Nothing is lost — the original is in the sheet, in Drive, and in your inbox.
2. Tell **Gerardo Ramírez** (workflow owner) with the **intake_id** from the sheet (or the time you submitted), what you expected, and a screenshot.
3. Do not edit the workflow yourself. If the owner is unavailable, keep working manually; the queue will catch up when the assistant is back.

*Synthetic data only during evaluation. Costs about 1.5 cents per intake.*
