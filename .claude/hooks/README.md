# Claude Code Hooks

Project hooks are configured in `.claude/settings.json`.

All hooks must use the universal invoke_route wrapper:

`npm --prefix conventions/scripts run invoke:route -- --route <route_id>`

Hooks must not call `conventions/scripts/*.ts` directly. The invoke_route wrapper resolves the central executor map and keeps script invocation aligned with the convention system.
