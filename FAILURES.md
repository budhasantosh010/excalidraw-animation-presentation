# Failure Log

Updated: 2026-08-26

This is the single failure log for the Animated Excalidraw agency-workspace expansion. Secrets, private routes, and unrelated cloud-project details are intentionally excluded.

## Fixed release blockers

### Recovery journal accepted a stale or future base revision

- What: A browser recovery write could persist a candidate whose expected revision did not equal the durable project revision.
- Where: `src/recovery/recoveryJournal.ts`, `write()`.
- When/how: Reproduced by writing against durable revision 1 with expected revision 2.
- Why: The expected revision was parsed but never compared with the durable revision.
- Impact: Recovery could offer an invalid candidate based on history that never existed.
- Tried/result: Exact optimistic-revision validation now runs before any storage mutation; the regression passes.
- Solution: Reject every recovery write unless its expected revision exactly matches the supplied durable record.

### Recovery acknowledgement could erase a newer browser-context edit

- What: Acknowledging one journal could delete a different journal written between assessment and removal.
- Where: `src/recovery/recoveryJournal.ts`, `acknowledge()` and `remove()`.
- When/how: Reproduced by replacing the main journal from a second simulated browser context during acknowledgement.
- Why: The old flow performed multiple reads followed by an unconditional shared-key deletion.
- Impact: A newer unsaved edit could be silently lost.
- Tried/result: Exact-identity acknowledgement tombstones replaced physical deletion; the concurrent-write regression passes.
- Solution: Acknowledge only the observed identity and keep differently identified journals visible.

### Fingerprint equality alone marked recovery content durable

- What: Matching noncryptographic fingerprints were treated as proof that journal and durable content were identical.
- Where: `src/recovery/recoveryJournal.ts`, recovery assessment.
- When/how: Found during the recovery-journal quality review.
- Why: The fingerprint comparison had no canonical-content confirmation.
- Impact: A rare hash collision could suppress a legitimate recovery offer.
- Tried/result: Fingerprints are now only a precheck followed by exact canonical content comparison; focused tests pass.
- Solution: Require both fingerprint equality and exact canonical snapshot, extension, and asset-hash equality.

### Browser recovery code pulled Node-only dependencies into the app build

- What: The production TypeScript build followed a Node filesystem import in the recovery test and a Node-only MCP type dependency from the shared persistence contract.
- Where: `src/recovery/recoveryJournal.test.ts` and `mcp/persistence/contracts.ts`.
- When/how: Detected by the required production build after the first focused recovery test passed.
- Why: Browser-scoped code crossed the browser/server runtime boundary through imports.
- Impact: The standalone application could not pass its production type build.
- Tried/result: Fixtures now use static JSON imports and the shared contract declares its browser-safe structural snapshot type locally; the production build passes.
- Solution: Keep shared persistence contracts runtime-neutral and keep Node APIs out of browser-owned source files.

### Fresh databases created an unnecessary intermediate migration backup

- What: A brand-new database was backed up between schema versions 1 and 2 during its first initialization.
- Where: `mcp/persistence/database.ts`, migration loop.
- When/how: Detected by the revision-asset migration regression on an empty new database path.
- Why: Backup eligibility used the in-loop schema version instead of whether durable storage existed before startup.
- Impact: First launch created a useless backup and violated the clean-initialization contract.
- Tried/result: Backups now run only when the database existed before startup; existing databases still receive one backup before each pending migration.
- Solution: Base backup eligibility on pre-open file existence, not versions created during the same initialization.

### Project-level asset links could not preserve historical revisions

- What: Every historical revision read the project’s current asset links, and writes could not change membership.
- Where: Schema v1 and `mcp/persistence/project-repository.ts`.
- When/how: Exposed when implementing safe revision restore and exact historical reads.
- Why: Assets were linked only by project ID rather than immutable revision ID.
- Impact: Restoring or exporting a historical image-bearing revision could use the wrong files.
- Tried/result: Schema v2 adds validated revision-scoped links, migrates legacy links, and updates current links atomically; focused and MCP regressions pass.
- Solution: Store and read asset membership by revision while retaining project links as the current-revision index.

### Read-only editor element types blocked mutable persistence regressions

- What: Tightening the persisted snapshot element type to Excalidraw’s read-only element union broke tests that intentionally mutate detached copies.
- Where: `mcp/persistence/contracts.ts` and recovery/contract regression tests.
- When/how: Detected by both MCP and application TypeScript checks after adding revision preview summaries.
- Why: The durable JSON contract is mutable plain data, while Excalidraw’s editor-facing type is read-only.
- Impact: Typechecks failed even though runtime parsing and storage were correct.
- Tried/result: The persistence contract remains a validated mutable JSON record, and the single animation-summary boundary uses an explicit checked type bridge; both typechecks pass.
- Solution: Keep persistence DTOs mutable and apply editor-specific read-only types only at editor API boundaries.

### Bare Express Router lacked response helpers inside Vite middleware

- What: The first live `/api/bootstrap` request failed because `response.status` was unavailable.
- Where: `mcp/workspace-api.ts` mounted through `vite.config.ts`.
- When/how: Reproduced on the first real localhost request after the static checks passed.
- Why: A standalone Express Router does not install the full Express request/response prototype layer when mounted directly into Vite Connect.
- Impact: The workspace API returned Vite’s error page and the dashboard could not load; no durable data was written.
- Tried/result: The same routes now run through a full Express application mounted as middleware; the live bootstrap succeeds.
- Solution: Use the Express application adapter, not a bare Router, at the Vite Connect boundary.

### Browser serialization replaced the canonical local source

- What: Opening a valid project immediately failed recovery-journal validation with `Invalid project snapshot source; expected local`.
- Where: Excalidraw browser serialization entering `src/WorkspaceShell.tsx`.
- When/how: Reproduced consistently in the live editor after opening the two-step proof project.
- Why: Excalidraw replaces the supplied export source with `window.location.origin` in browser builds.
- Impact: Autosave and crash recovery could not accept otherwise valid editor changes.
- Tried/result: A focused diagnostic exposed the exact nested cause; the boundary now normalizes only `source` back to the established `local` contract, with a regression test.
- Solution: Normalize browser-export source at the persistence boundary while preserving the complete serialized document.

### Opening a project created a revision without a user edit

- What: A cold open of revision 3 immediately autosaved revision 4 even though the user changed nothing.
- Where: `src/Editor.tsx` scene-change reporting during Excalidraw hydration.
- When/how: Reproduced in the required browser cold-reopen test after drawing and saving a third element.
- Why: The first hydrated scene normalized an empty `boundElements` value from `null` to `[]`, while the change key also treated selection and viewport movement as durable edits.
- Impact: Version history accumulated false revisions and panning or selecting could trigger unnecessary writes.
- Tried/result: The change key now starts from the loaded scene and tracks element versions, persisted app state, and file membership only; hydration, selection, and viewport changes are ignored.
- Solution: Detect durable scene changes rather than transient editor-state or hydration normalization.

### Late autosave response could replace a newly opened project

- What: An autosave response could update the active project state after the user had already opened, duplicated, or switched to another project.
- Where: `src/WorkspaceShell.tsx`, autosave completion handling.
- When/how: Found during the bounded pre-commit concurrency review.
- Why: The response unconditionally replaced `projectRef` without proving that its captured project record was still active.
- Impact: Subsequent edits from the visible new canvas could be associated with the previously saved project.
- Tried/result: Autosave still commits and acknowledges its journal, but updates visible state only when the exact captured project record remains active.
- Solution: Bind asynchronous save results to the project state that initiated them and ignore stale UI results.

### Autosave cleanup failure could disguise a successful commit

- What: Revision retention cleanup could throw after the new revision committed and make the HTTP save appear failed.
- Where: `mcp/workspace-api.ts`, save action after `projects.update()`.
- When/how: Found during the bounded pre-commit failure-isolation review.
- Why: Best-effort pruning ran in the request's success path without an isolation boundary.
- Impact: The browser would retain its recovery journal and a retry could conflict with the already-committed revision.
- Tried/result: Pruning failures are now logged and isolated while the committed revision is returned successfully.
- Solution: Never let post-commit maintenance change the outcome reported for the durable save.

### Current-version database could be structurally empty

- What: A database could set the current `user_version` while lacking the migration ledger and application tables.
- Where: `mcp/persistence/database.ts`, database readiness validation.
- When/how: Reproduced by creating an empty SQLite file and setting `user_version = 1`.
- Why: Startup trusted the version number without validating the applied migration identity or schema.
- Impact: The app could report storage ready and fail later during a write.
- Tried/result: Added ledger, integrity, foreign-key, and required-schema tests; all now pass.
- Solution: Validate the exact migration ledger and canonical schema before returning a ready database.

### Damaged table shape passed readiness checks

- What: A required table with the correct name but a missing column, constraint, foreign key, or index could pass startup.
- Where: `mcp/persistence/database.ts`, v1 schema validation.
- When/how: Reproduced by dropping `trash.trashed_at` while retaining the `trash` table.
- Why: The first validator checked table names only.
- Impact: Corruption would surface late during repository operations.
- Tried/result: Added a normalized canonical SQLite schema signature and malformed-table regression; it passes.
- Solution: Compare every required table and explicit index with the schema generated by the canonical migration SQL.

### Node support claim exceeded the SQLite driver's range

- What: The app claimed all Node versions above 20.19 while the native SQLite package supports Node 20 and 22 through 26.
- Where: `package.json` engine declaration.
- When/how: Found during independent dependency review after adding `better-sqlite3@12.11.1`.
- Why: The old open-ended engine range predated the native dependency.
- Impact: Installation could fail on Node 21 or 27+ despite the manifest claiming support.
- Tried/result: Intersected Vite and SQLite support; local Node 24 checks and builds pass.
- Solution: Keep the engine range at `^20.19.0 || >=22.12.0 <27` while this driver version is pinned.

### Trashed projects accepted new revisions

- What: `update()` could create revisions after a project had been moved to trash.
- Where: `mcp/persistence/project-repository.ts`, revision update transaction.
- When/how: Reproduced by creating, trashing, then updating a project.
- Why: Update intentionally loaded trashed records for lookup but did not reject their state.
- Impact: Autosave or MCP writes could mutate a project the user believed deleted.
- Tried/result: Added fail-closed checks before construction and inside the immediate transaction; the no-extra-revision regression passes.
- Solution: Require restore before any new revision can be written.

### Concurrent asset cleanup could delete another store's file

- What: After a database-registration race, one asset store could remove the shared final content-addressed file created or registered by another store.
- Where: `mcp/persistence/asset-store.ts`, database-failure cleanup.
- When/how: Reproduced with two independent stores writing identical bytes to the same database and asset root.
- Why: Final-file ownership cannot be proven after a concurrent registration failure.
- Impact: A valid asset database row could be left without its durable file.
- Tried/result: Final files are now retained as recoverable orphans; retries validate and adopt them, and concurrent/dedup tests pass.
- Solution: Delete only uniquely owned temporary files and never delete the shared final hash path after registration failure.

### Oversized asset input was copied before rejection

- What: The store cloned a `Uint8Array` before checking its configured maximum size.
- Where: `mcp/persistence/asset-store.ts`, input validation.
- When/how: Reproduced with an oversized typed array whose iterator throws if copying begins.
- Why: Defensive detachment occurred too early.
- Impact: A rejected upload could temporarily double its memory use.
- Tried/result: Size validation now precedes copying; the copy-bomb regression passes.
- Solution: Check `byteLength` first and clone only accepted inputs.

### Asset filesystem probe errors escaped untyped

- What: A non-`ENOENT` read failure while probing a final asset path escaped as a raw filesystem error.
- Where: `mcp/persistence/asset-store.ts`, pre-registration final-file probe.
- When/how: Reproduced with an injected `EACCES` read error.
- Why: The probe distinguished missing and corrupt files but did not normalize other I/O failures.
- Impact: Callers could not handle all storage failures through the typed asset error contract.
- Tried/result: Non-missing I/O failures now preserve their cause inside `AssetStorageError`; integrity errors remain distinct.
- Solution: Wrap final-path I/O failures consistently while preserving explicit integrity errors.

### Unchanged autosave could leave stale durable autosave state

- What: After a newer manual revision, an identical autosave could skip revision creation while leaving `autosave_state` on the older revision.
- Where: `mcp/services/autosave-service.ts`, unchanged-content path.
- When/how: Reproduced with autosave revision 2, manual revision 3, then identical content at revision 3.
- Why: No-op detection returned before reconciling the durable autosave marker.
- Impact: Recovery comparison could falsely treat current durable content as stale.
- Tried/result: The unchanged path now upserts the exact current revision/hash/snapshot/time without creating revision 4.
- Solution: Reconcile autosave metadata transactionally even when content needs no new revision.

### Reordered identical asset hashes caused a false autosave failure

- What: Asset membership validation treated hashes as a set, but persistence forwarded caller order to an order-sensitive repository guard.
- Where: `mcp/services/autosave-service.ts`.
- When/how: Reproduced by reversing the same two stored asset hashes.
- Why: Validation and persistence used different canonical ordering rules.
- Impact: A valid autosave could be rejected despite unchanged asset membership.
- Tried/result: Accepted membership now reuses durable canonical ordering; the reorder regression passes.
- Solution: Persist the current canonical asset order whenever membership is unchanged.

### Async diagnostic callbacks could reject unhandled

- What: An async `onError` or `onConflict` callback could return a rejected promise outside synchronous `try/catch`.
- Where: `mcp/services/autosave-service.ts`, diagnostic isolation helper.
- When/how: Reproduced with a real rejecting async `onError` callback.
- Why: The callback contract allowed async functions but ignored returned thenables.
- Impact: A diagnostic hook could create an unhandled rejection after autosave handled the primary failure.
- Tried/result: Returned promises/thenables now have rejection handlers attached without being awaited; the regression passes.
- Solution: Consume diagnostic thenable rejections while keeping diagnostics nonblocking.

## Environment and test-runner failures

### Sandboxed Git staging could not create the index lock

- What: The first scoped `git add` attempt failed with permission denied while creating `.git/index.lock`.
- Where: The managed workspace sandbox's read-only `.git` boundary.
- When/how: It occurred at the final local-commit gate after all verification passed.
- Why: Product files are writable in the sandbox, but Git metadata requires approved local execution.
- Impact: No files were staged or changed by the failed attempt.
- Tried/result: The same exact scoped staging command is rerun with approved Git-metadata access.
- Solution: Use approved local execution for Git metadata while keeping the explicit file allowlist.

### PowerShell parsed an unquoted annotated-tag dereference

- What: A final read-only `git rev-parse` check received an empty argument instead of the annotated-tag dereference suffix.
- Where: The PowerShell verification command after the local commit.
- When/how: PowerShell interpreted the unquoted `^{}` characters before Git received them.
- Why: The Git revision expression was not passed as one literal argument.
- Impact: Only that optional tag-peel check failed; the rollback tag and commit were unchanged.
- Tried/result: The tag itself had already been listed successfully and remains preserved.
- Solution: Quote Git revision expressions containing `^{}` in PowerShell.

### Direct Node serialization diagnostic could not load Excalidraw

- What: A temporary command-line probe failed before it could serialize an editor snapshot.
- Where: A one-off `npx tsx -e` diagnostic importing the browser Excalidraw bundle.
- When/how: It occurred while isolating the live recovery-journal validation failure.
- Why: Excalidraw's browser runtime requires `window`, which is unavailable in a plain Node process.
- Impact: Only that diagnostic path was unusable; no product code or durable data was changed.
- Tried/result: Browser-side nested-cause instrumentation exposed the exact source-field mismatch instead.
- Solution: Reproduce browser serialization in a browser-capable test or instrument the browser boundary, not raw Node.

### Recovery-journal review subagent reached its usage limit

- What: The delegated recovery-journal implementation task stopped before producing files.
- Where: The `p1_recovery_journal` subagent execution environment.
- When/how: It occurred immediately after dispatch when the agent reported its account usage limit.
- Why: The delegated model had no remaining usage allowance.
- Impact: Delegation stopped, but no repository files were modified or corrupted.
- Tried/result: The primary agent resumed the bounded task locally and completed the focused tests.
- Solution: Continue locally or retry delegation after the usage allowance resets; never block product work on the delegate.

### Sandboxed Vitest/Vite process spawn failed

- What: Some test/build launches failed with `spawn EPERM` before loading the Vite configuration.
- Where: Windows sandbox process creation, outside application code.
- When/how: Occurred when Vitest or Vite attempted to spawn a local worker under restricted execution.
- Why: The managed sandbox denied the child process.
- Impact: A valid test run could not start inside that restriction.
- Tried/result: Re-ran the same command with approved local process execution; tests passed.
- Solution: Run approved Vitest/Vite gates outside the restricted child-process sandbox.

### Unrelated cloud test is auto-discovered by the unscoped test command

- What: Literal `npm test -- --run` discovers a protected `implementing in cloud` test that is not a Vitest suite.
- Where: The separate untracked `implementing in cloud/` workspace.
- When/how: Occurs only when test discovery is run against the entire working folder.
- Why: That separate project sits under the same filesystem root.
- Impact: The unscoped command can exit nonzero even when all Animation Studio tests pass.
- Tried/result: No change was made to the protected folder; verification is scoped to `src` and `mcp`.
- Solution: Exclude the protected cloud workspace or run Vitest only against `src` and `mcp`.

## Deferred non-blocking issues

### Dependency audit findings are not yet triaged

- What: `npm install` reports 16 dependency-tree findings: 12 moderate and 4 high.
- Where: Current npm dependency graph.
- When/how: Reported after installing the pinned SQLite runtime and type package.
- Why: The report includes the full pre-existing and transitive dependency tree; ownership has not been isolated.
- Impact: Unknown until a bounded audit identifies reachable production paths.
- Tried/result: Automatic `npm audit fix` was intentionally not run because it can make unrelated breaking upgrades.
- Solution: Run a separate reachability-focused audit and upgrade only confirmed affected packages.

### Project name conflicts depend on SQLite message text

- What: Project name-conflict mapping checks part of SQLite's English error message.
- Where: `mcp/persistence/project-repository.ts`.
- When/how: Triggered by a duplicate canonical project name in one workspace.
- Why: SQLite does not expose a named constraint in the current schema.
- Impact: A future driver message change could return a generic constraint error instead of the typed conflict.
- Tried/result: Current focused duplicate-name test passes.
- Solution: Add a named preflight lookup while retaining the database constraint as the atomic authority.

### Substring search will not scale indefinitely

- What: Project search uses `LIKE '%query%'`.
- Where: `mcp/persistence/project-repository.ts` list/search query.
- When/how: Relevant only with a very large local project collection.
- Why: Leading-wildcard search cannot use the normal name index efficiently.
- Impact: Search latency may grow linearly at agency-scale project counts.
- Tried/result: Deterministic and escaped search behavior is tested; no large-scale performance work was added.
- Solution: Add SQLite FTS only after measured project counts make current search slow.

### Corrupt revision JSON lacks project context in its error

- What: Stored malformed JSON fails closed but surfaces the raw JSON parsing message.
- Where: `mcp/persistence/project-repository.ts`, record reconstruction.
- When/how: Only when durable revision JSON is externally corrupted.
- Why: Parsing currently delegates directly to `JSON.parse` before contract validation.
- Impact: Diagnosis is less direct; data is not accepted or overwritten.
- Tried/result: Fail-closed behavior remains intact.
- Solution: Wrap parse errors with project and revision identifiers while preserving the cause.

### Asset hash comparison is order-sensitive during update

- What: The update guard compares asset-hash arrays by serialized order even though SQLite stores the links as a set.
- Where: `mcp/persistence/project-repository.ts`.
- When/how: A caller supplies the same hashes in a different order.
- Why: Revision-scoped asset membership belongs to the next asset-storage micro-phase.
- Impact: A harmless reorder is rejected; no assets are lost.
- Tried/result: Missing assets and changed membership already fail atomically.
- Solution: Canonically sort and deduplicate asset hashes when revision-scoped asset storage is implemented.

### Injected workspace timestamps are not independently validated

- What: Test/runtime dependency injection can return a non-canonical timestamp.
- Where: `mcp/persistence/workspace-repository.ts`.
- When/how: Only if a custom `now()` dependency is faulty.
- Why: Production uses `new Date().toISOString()` and timestamp parsing is enforced on project records.
- Impact: A custom adapter could persist a malformed workspace timestamp.
- Tried/result: Production timestamp generation and deterministic tests pass.
- Solution: Validate injected timestamps with the shared canonical ISO rule when services are wired.

### Failed thumbnail revisions cannot retry in one scheduler instance

- What: The coalescing scheduler records the latest revision before rendering, so rescheduling the same revision after renderer failure is ignored.
- Where: `mcp/services/thumbnail-scheduler.ts`.
- When/how: Only when thumbnail rendering fails and the same revision is retried without restarting the scheduler.
- Why: Coalescing currently prioritizes preventing obsolete work over retry state.
- Impact: The durable project is safe, but its thumbnail may remain stale until a newer revision or app restart.
- Tried/result: Rendering failures are isolated and never roll back project work; retry policy was not expanded in this slice.
- Solution: Track successful and failed revision state separately when the concrete thumbnail renderer is wired.

### Thumbnail scheduler retains one revision marker per project

- What: `latestRevision` keeps a small entry for every project encountered during the scheduler lifetime.
- Where: `mcp/services/thumbnail-scheduler.ts`.
- When/how: Accumulates during a very long-running process that touches many projects.
- Why: The map prevents older jobs from replacing newer work.
- Impact: Small unbounded metadata growth, not project-data loss.
- Tried/result: No eviction policy was added without observed scale evidence.
- Solution: Evict idle project markers after a bounded retention period when measured usage warrants it.

### Project move preserves its prior updated timestamp

- What: Moving a project between workspaces does not change `projects.updated_at`.
- Where: `mcp/services/project-file-service.ts`.
- When/how: Every successful move operation.
- Why: The timestamp currently represents content revision time rather than filing/location changes.
- Impact: Recent-project ordering will not treat a move as a content edit.
- Tried/result: Snapshot, revisions, assets, and timestamps remain otherwise exact.
- Solution: Keep this behavior if `updatedAt` means content time; otherwise add a separate metadata-change timestamp.

## Intentional current limitation

### Existing create/update paths do not schedule thumbnails yet

- What: The scheduler is integrated with duplication but not with every existing create/update call site.
- Where: Persistence service integration boundary.
- Why: Wiring the existing UI/MCP save paths belongs to Micro 1.7 and would broaden this backend-only slice.
- Impact: New or edited projects may not receive thumbnails until workspace UI integration; durable saves are unaffected.
- Solution: Inject the scheduler after successful create/update commits during Micro 1.7.
