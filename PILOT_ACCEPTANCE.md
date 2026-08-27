# Agency Workspace Pilot Acceptance

## Ready pilot projects

- `Agency funnel pilot`: client acquisition/process animation with bindings, independent steps, timed movement, and a camera track.
- `Talking head visual pilot`: YouTube insert with fade, draw, pop, timed movement, and a camera track.

## Automated reliability evidence

- Durable revision create/open/update/old-revision round trips are covered by `mcp/project-control.test.ts`.
- MCP create/list/revise/open exact-revision handoff is covered by `mcp/server.test.ts`.
- Autosave interruption and recovery are covered by the Phase 1 recovery tests.
- Source, PNG, SVG, WebM, cancellation, and truthful MP4 support detection are covered by Phase 3 tests; PNG and WebM also passed live browser output checks.
- Both seeded pilots were reopened in the standalone workspace at revision 1 after a local server restart.
- Restoring revision 1 after a revision 2 edit now creates revision 3 with the original element state, preserving the full revision history.

## User acceptance still required

These results cannot be inferred from automated tests. Record them after using both pilots in actual work:

| Measure | Previous workflow | Animation Studio | Result |
| --- | ---: | ---: | --- |
| Agency deliverable minutes | pending | pending | pending |
| Talking-head insert minutes | pending | pending | pending |
| Revisions needed | pending | pending | pending |
| Export usable without repair | pending | pending | pending |

Phase 5 is accepted only after both deliverables are used in real work, the time or quality improvement is recorded, and no data-loss issue remains.
