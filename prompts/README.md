# Prompts used in the workflow

| File | Used by node | Model | Temperature |
|---|---|---|---|
| `01-extraction.system.md` | **Extract Facts** (Basic LLM Chain, system message) | `claude-sonnet-5` | n/a (not sent) |
| `02-summary.system.md` | **Attorney Summary** (Basic LLM Chain, system message) | `claude-sonnet-5` | n/a (not sent) |

The **user message** of *Extract Facts* is the raw intake text (`{{ $json.raw_text }}`). The Structured Output Parser attached to the chain appends the JSON schema (`n8n/extraction-schema.json`) as format instructions, so the schema lives in one place.

The **user message** of *Attorney Summary* is **not** the raw intake. It is `record_text`, a flat rendering of the *validated* record produced by the Traceability Guard, plus the list of missing fields. The writer therefore cannot reintroduce a fact the guard discarded.

## Why two calls instead of one
Extraction and writing pull in opposite directions: extraction must be literal and conservative; the summary must be fluent and readable. Splitting them lets a deterministic check (the guard) sit between the two, so the summary is generated only from facts that passed the check.

## Prompt-authoring notes
- No curly braces in the system prompts: n8n's LangChain chain treats `{` `}` as template variables.
- Rule wording is intentionally blunt ("copied EXACTLY, character for character") because the guard rejects paraphrased quotes.
- The "no abbreviations ending in a period" rule exists only so the five-sentence check in *Validate Summary* is reliable.
