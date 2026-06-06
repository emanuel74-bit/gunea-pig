# /run-phase

Use the `run-phase` skill to execute the current phase from the validated bundle, preferring a compiled `implementation_and_refactoring` context bundle as supporting compact context when available.

Do not bypass executor routes, validated phase bundles, or native subagents. Compiled context bundles are supporting context only.

Before loading broad convention context, run `npm --prefix conventions/scripts run invoke:route -- --route compile_context_bundle --scope implementation_and_refactoring` and read `.ai/context/compiled-context-bundle.yaml` as preferred compact supporting context.
