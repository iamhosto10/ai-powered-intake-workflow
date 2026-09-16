// Node: "Load Sample Intakes" — Code node, mode: Run Once for All Items
// Emits one item per synthetic intake. The samples below are inlined from ../samples/ by scripts/build-workflow.js.
// To run a single intake (e.g. for the Loom failure demo) set ONLY = 'intake-3'.

const ONLY = null; // null = all three | 'intake-1' | 'intake-2' | 'intake-3'

const SAMPLES = __SAMPLES__;

return SAMPLES
  .filter((s) => !ONLY || s.intake_id === ONLY)
  .map((s) => ({ json: s }));
