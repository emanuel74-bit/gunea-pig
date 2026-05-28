---
name: run-gate
description: Run and validate a script-produced gate result for the current phase transition.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Run Gate


Run in order:

1. `npm --prefix conventions/scripts run executor -- --route run_gate_check`
2. `npm --prefix conventions/scripts run executor -- --route validate_gate_result`

Gate results are script-produced only. If the gate is blocked or invalid, do not invoke handoff; invoke `revision-loop`.

