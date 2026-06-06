# /run-alpha-cycle

Use the `run-alpha-cycle` skill with an explicit mission id to let Alpha inspect mission state, read the active validated phase bundle, select/activate the next phase agent, and continue the route-backed workflow cycle.

Do not bypass executor routes or native subagents.

If this is the first cycle after an interruption, run `/resume-mission` first; do not continue from remembered state.
