---
name: run-phase
description: Execute the current phase from a validated phase bundle and route-backed automation only.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Run Phase


Use this skill to perform phase work.

Rules:
- Read the validated phase bundle first.
- Use only required executor route IDs from the bundle.
- Never call scripts by path.
- Write only phase outputs allowed by the bundle.
- After producing phase output, run `npm --prefix conventions/scripts run executor -- --route validate_phase_output`.
- Then run `npm --prefix conventions/scripts run executor -- --route validate_semantic_completeness`.
- Do not proceed to handoff or gate until validation passes.

