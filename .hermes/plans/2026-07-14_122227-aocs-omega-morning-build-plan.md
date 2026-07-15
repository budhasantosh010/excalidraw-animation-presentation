# AOCS Omega Morning Build Plan — Riley-Style Animated Excalidraw

## Plan status

- This is the execution plan for the first working build.
- It supersedes the **execution order** in `2026-07-14_120116-riley-style-animated-excalidraw-full-plan.md`.
- The earlier 1,707-line document remains the post-proof hardening roadmap and reference architecture.
- This turn is planning only. No application code is created by this plan.

## 1. AOCS Omega decision

### Classification

- **Problem type:** Type 2 — partially known.
- **Risk:** Medium.
- **Fractal depth:** 1.
- **Required verification:** one direct builder path, one adversarial challenge, deterministic checks only where failure would silently corrupt work.
- **Deadline type:** aggressive 50%-probability morning deadline, not a guaranteed delivery time.

### Root problem

> Starting from an empty folder, create the shortest closed loop that takes a normal Excalidraw scene to an ordered, clean, recordable animated presentation without requiring the user to write code or edit every reveal in a video timeline.

### AOCS Universal Goal-Achievement loop

```text
Draw in Excalidraw
    ↓
Select objects and assign reveal numbers
    ↓
Freeze scene into a separate read-only player
    ↓
Advance reveals with Space / autoplay
    ↓
Record a real Sanverse segment
    ↓
User feedback identifies the next bottleneck
```

If this loop closes, the product exists. Everything else is refinement.

### Blackboard: knowns and unknowns

| Claim | Provenance | Confidence | Consequence |
|---|---|---:|---|
| Excalidraw can be embedded as a React component | Official documentation / reality-test pending locally | 98% | Do not clone the full monorepo first. |
| Excalidraw elements support persistent `customData` | Official documentation | 98% | Store reveal metadata inside the drawing. |
| Separate editor/player instances prevent playback from corrupting edit history | Architectural reasoning | 92% | Keep the dual-instance architecture. |
| Simple cumulative reveal reproduces the visible Riley demo | Supplied video inspection | 94% | `appear` and `fade` are sufficient for proof. |
| Smooth per-element fade will work through repeated player updates | LLM-hypothesized until local spike | 70% | Validate immediately; fall back to hard reveal. |
| Programmatic searched-image insertion will be straightforward | LLM-hypothesized | 60% | Upload/paste must be the fallback. |
| Browser background removal integrates within 30 minutes | LLM-hypothesized | 55% | Strict timebox and external-service fallback. |
| Full Riley-like tool is guaranteed in one morning | Unsupported | 0% | Treat it as plausible, not promised. |

### Scoring engine

Weighted score = Impact×0.35 + Leverage×0.25 + Urgency×0.20 + Learning×0.20.

| Vertical | I | L | U | V | Score | Decision |
|---|---:|---:|---:|---:|---:|---|
| Working editor → assigned steps → separate player | 10 | 10 | 10 | 10 | 10.0 | Stop everything; build first. |
| Minimal group/bound-text selection closure | 9 | 9 | 9 | 8 | 8.8 | Build inside the vertical slice. |
| Save/open metadata round-trip | 9 | 9 | 8 | 9 | 8.8 | Build immediately after player. |
| Toolbar, badges and sequence controls | 8 | 8 | 7 | 7 | 7.6 | Build after the player proof. |
| Frame fit / clean fullscreen recording | 9 | 9 | 8 | 8 | 8.6 | Required before the real recording. |
| Iconify/logo insertion | 7 | 7 | 5 | 6 | 6.5 | Build after the core loop. |
| Background removal | 6 | 6 | 4 | 5 | 5.4 | Timebox; do not block recording. |
| Full Playwright/component suite | 4 | 2 | 2 | 6 | 3.6 | Park until proof. |
| Error-code taxonomy/preflight dashboard | 3 | 2 | 2 | 5 | 3.0 | Park until real failures exist. |
| Extensive documentation/licence packaging | 3 | 3 | 2 | 4 | 3.0 | Park until proof. |

### AOCS conclusion

The previous plan violated AOCS's own rules by applying high-depth verification to a medium-risk personal prototype before closing the core loop. The corrected approach is:

1. Question every requested layer.
2. Cut everything that does not produce a recordable reveal.
3. Build a crude vertical slice.
4. Verify it directly in the browser.
5. Add the next highest-leverage feature.
6. Stop polishing once the real segment records successfully.

## 2. Morning endpoint

### Goal A — mandatory core proof

By the end of the core build, the user can:

1. Run one command and open a full Excalidraw editor locally.
2. Draw normal Excalidraw text, shapes, arrows, groups and frames.
3. Select one or more objects.
4. Assign them to reveal step 1, 2, 3, and so on.
5. See the assigned number either on the canvas or in a minimal step list.
6. Choose a 16:9 Excalidraw frame as the presentation area.
7. Enter a separate clean read-only presentation.
8. Start at `0 / N` with future elements hidden.
9. Press Space/Right Arrow to reveal the next step.
10. Press Left Arrow to move to the preceding stable step.
11. Use `appear` reliably and `fade` if the local spike is smooth.
12. Save the drawing to `.excalidraw` and reopen it with assignments intact.
13. Enter fullscreen and record one real 30–60 second Sanverse segment.

If these thirteen conditions pass, the morning is successful even if asset search and background removal are incomplete.

### Goal B — Riley-like stretch parity

After Goal A passes, add as much as the remaining morning permits:

14. Search transparent logos through Iconify.
15. Click a result to insert it into the canvas.
16. Upload/paste arbitrary raster images.
17. Remove a selected raster background locally, preview it, and accept/cancel.
18. Use simple autoplay timings.

Goal B is not allowed to delay or invalidate Goal A.

### Explicitly not in the morning endpoint

- Playwright or large component-test suite.
- Multi-provider photo search.
- Brandfetch account integration.
- Multiple scene transitions beyond a hard cut.
- MP4 export.
- Desktop installer.
- Collaboration, accounts or cloud sync.
- Error-code taxonomy and repair dashboard.
- General animation timeline.
- Arbitrary easing/property keyframes.
- Draw-on arrow/freehand animation.

Draw-on becomes the **first post-recording visual feature**, not sixth in a generic backlog.

## 3. Minimal architecture

```text
src/
├── App.tsx                  # owns editor/player mode and frozen snapshot
├── Editor.tsx               # Excalidraw editor + minimal toolbar/panels
├── Presentation.tsx         # second read-only Excalidraw instance
├── animation.ts             # metadata, closure, assign, compile, interpolate
├── projectFile.ts           # save/open .excalidraw
├── assets.ts                # Iconify search + fetch/insert image
├── backgroundRemoval.ts     # browser remover adapter + replacement
├── app.css
└── animation.test.ts        # only high-value deterministic tests
```

No reducer framework, global store, provider registry, error taxonomy, or layered adapter tree is created before the proof. Extract modules only when the file becomes difficult to reason about or a second implementation actually exists.

### Dependencies

```text
vite
react
typescript
@excalidraw/excalidraw
@imgly/background-removal   # installed only when Goal A passes
vitest                     # one deterministic test file
```

Iconify uses its HTTP API and needs no npm package or account.

## 4. Minimal data contract

The contract stays versioned, but it is deliberately small.

```ts
export type SanverseAnimation = {
  version: 1;
  sceneId: string;
  step: number;
  effect: "appear" | "fade";
};
```

Stored as:

```ts
element.customData = {
  ...element.customData,
  sanverseAnimation: {
    version: 1,
    sceneId: activeFrame.id,
    step: 3,
    effect: "fade",
  },
};
```

No separate step IDs, timing schema, scene schema or migrations are created in the morning. Numeric steps are enough for the proof. The full roadmap can introduce stable IDs if real editing reveals that renumbering is a problem.

### Essential pure functions

```ts
getSelectionClosure(elements, selectedIds): Set<string>
assignStep(elements, ids, sceneId, step, effect): ExcalidrawElement[]
clearStep(elements, ids): ExcalidrawElement[]
compileAtStep(elements, sceneId, currentStep, progress): ExcalidrawElement[]
getStepCount(elements, sceneId): number
```

### Minimal selection closure

Expand only:

1. selected elements;
2. elements sharing a selected element's active `groupIds`;
3. bound container ↔ text relationships;
4. arrow labels if represented as bound text.

Do not build a generic dependency graph before a real scene demonstrates the need.

## 5. Execution sequence

## Stage 0 — Machine and folder check

**Timebox:** 10 minutes.

1. Work only in:

```text
C:\Users\Lenovo\Music\Startups\YT Automations\A1 Talking Head Youtube Video\Sanverse YT Channel\excalidraw animation with codex
```

2. Verify:

```powershell
node --version
npm --version
git --version
```

3. Initialize Git if absent.
4. Scaffold Vite React TypeScript directly into this folder.
5. Install `@excalidraw/excalidraw`.
6. Start the dev server.

**Gate 0:** A blank full Excalidraw editor is visible and drawing works.

If Node is missing, installing Node is the only active task. Do not continue planning or code around it.

## Stage 1 — Core vertical slice before all polish

**Timebox:** 60 minutes after Gate 0.

### Step 1.1 — Capture editor state

- Store the Excalidraw imperative API in `App.tsx`.
- Mirror the current elements/app state/files through `onChange`.
- Display selected element count in a temporary plain HTML button row.

### Step 1.2 — Assign reveal numbers

- Add `Assign next`.
- Read `selectedElementIds`.
- Compute minimal selection closure.
- Write `customData.sanverseAnimation`.
- Use one normal Excalidraw history capture so Undo works if the package supports it cleanly.

### Step 1.3 — Create the frozen player

- Clicking `Present` copies elements, app state and files into a frozen snapshot.
- Unmount/hide the editor.
- Mount a second Excalidraw instance with `viewModeEnabled` and hidden UI.
- At `currentStep = 0`, set future assigned elements to effective opacity 0.
- Space increments `currentStep`.
- Left decrements to the previous stable state.

### Step 1.4 — First reality test

The user draws:

- title text;
- one rectangle with bound text;
- one arrow;
- one grouped pair of shapes.

Assign steps 1–4 and present.

**Gate 1 — stop-everything gate:** All four steps reveal in the intended order without modifying the editor source.

No badges, asset search, background removal, testing framework, documentation or styling is allowed before Gate 1 passes.

### Kill-switch for Stage 1

- First failure: inspect package API and fix directly.
- Same path fails twice: stop and reframe.
- If repeated player updates are the blocker, use instantaneous `appear` with a remounted/static stage.
- If public metadata updates are impossible, document the exact missing API before considering a minimal fork.

## Stage 2 — Make the core usable

**Timebox:** 45 minutes.

1. Replace temporary buttons with a compact toolbar:

```text
[−] [Step] [+] [Assign next] [Clear] [Appear/Fade] [Present]
```

2. Add a minimal ordered step list with element counts.
3. Add `R` restart, Escape exit and `F` fullscreen.
4. Add fade with `requestAnimationFrame` only after `appear` is stable.
5. Preserve original opacity (`original × progress`).
6. Add simple numbered badges.

### Badge timebox

Spend no more than 25 minutes on badge positioning.

Fallback order:

1. canvas-following HTML badges;
2. badges only for currently selected elements;
3. numbered rows in the sequence list.

**Gate 2:** The user can author and present without opening dev tools or editing JSON.

## Stage 3 — 16:9 frame and persistence

**Timebox:** 45 minutes.

1. Use an existing Excalidraw frame as the active scene.
2. Add `New 16:9 frame` only if public frame creation is straightforward.
3. Fit the selected frame to the presentation viewport.
4. Exclude or clip objects outside the frame.
5. Add Save and Open using the standard `.excalidraw` structure.
6. Verify unrelated `customData`, image files, groups and bindings are preserved.

### Deterministic verification file

Add one `animation.test.ts` containing only:

1. group closure test;
2. bound text/container closure test;
3. assignment does not mutate input;
4. step 0/1/N visibility test;
5. fade progress 0/0.5/1 test;
6. save/open metadata round-trip test.

Run:

```powershell
npm test
npm run build
```

**Gate 3:** Save → reload → Open preserves the working four-step presentation.

This is the only automated verification required before the real recording.

## Stage 4 — Record before building asset integrations

**Timebox:** 20 minutes.

1. Create one 15–30 second real Sanverse scene.
2. Use at least eight reveal steps.
3. Include text, grouped shapes and arrows.
4. Enter fullscreen presentation.
5. Record with OBS or Game Bar.
6. Watch the recording once.
7. Write the three largest workflow problems in `MORNING_NOTES.md`.

**Gate 4 — product-exists gate:** A clean animated clip exists outside the application.

Only after Gate 4 does the build proceed to logo search/background removal. This prevents a broken animation product with polished asset tooling.

## Stage 5 — Upload/paste and Iconify logos

**Timebox:** 45 minutes.

### Step 5.1 — Upload/paste first

- Prove local image insertion through the native Excalidraw image path or a minimal programmatic helper.
- Save/reopen and confirm the image is embedded.

### Step 5.2 — Iconify search

- Search the Iconify API, initially restricted to Simple Icons.
- Display up to a small first page of transparent logos.
- Clicking a result fetches the SVG and sends it through the same proven insertion path.
- Keep provider/source metadata only if it is trivial; do not delay insertion.

**Gate 5:** Search “OpenAI” or “Blender,” insert a logo, disconnect the network, reopen the saved drawing, and see the logo.

### Asset kill-switch

If programmatic image insertion fails twice:

- keep Upload/Paste;
- add `Copy logo` so the user pastes into Excalidraw;
- move direct insertion to the afternoon.

The workflow remains useful.

## Stage 6 — Background removal stretch

**Timebox:** 30–40 minutes.

1. Install `@imgly/background-removal` only now.
2. Select a raster image.
3. Convert its embedded data URL to a Blob.
4. Process locally.
5. Show before/after.
6. Accept replaces only the image file; Cancel changes nothing.
7. Retain original for Undo.

**Gate 6:** One real image is processed and survives Save/Open.

### Background-removal kill-switch

If model loading, bundling or performance fails twice:

1. preserve the adapter interface;
2. switch temporarily to remove.bg if the user accepts an API key;
3. otherwise use the external remove.bg website and paste the result;
4. record the blocker for afternoon repair.

Background removal must never invalidate Goal A.

## Stage 7 — Final morning proof

1. Update the real Sanverse scene with a searched logo and processed image if available.
2. Save.
3. Reload/Open.
4. Disconnect network.
5. Present all steps.
6. Record the final 30–60 second clip.
7. Confirm no editor controls, selection handles, badges or missing assets appear.
8. Stop.

Do not begin hardening merely because time remains. First assess whether the tool made the video workflow faster.

## 6. Human verification script

The user is the primary UI verifier for the morning, but the test must be structured rather than casual.

After each gate, the user answers only:

```text
1. What did you expect?
2. What actually happened?
3. What single thing blocks the next gate?
```

Feedback examples:

- “The fade is too slow” → adjust duration constant.
- “Rectangle appears before its text” → fix closure.
- “The arrow disappears after going back” → fix stage compilation.
- “Logo insertion changes aspect ratio” → fix insertion dimensions.

Cosmetic preferences that do not block the next gate are parked until Gate 4.

## 7. Adversarial review

### Specialist proposal

Build the dual-instance vertical slice first, validate by recording, then add assets. Use versioned metadata and minimal closure from the beginning because retrofitting those after authoring content risks data loss.

### Red-team attack

1. A second Excalidraw instance may not smoothly accept repeated opacity/version updates.
2. Native history may reject externally modified elements with unchanged versions.
3. Badge coordinates may consume the same time as the player.
4. Frame clipping/fitting may rely on internal helpers.
5. Image insertion and background-model loading can consume the entire morning.
6. Human-only testing can miss save corruption until work is lost.

### Contrarian model

The absolute fastest implementation may be a fork that directly modifies Excalidraw internals, matching how Riley may have worked. However, this creates an unverified dependency on repo internals and a larger installation/build surface. It is retained as a fallback, not the opening move.

### Judge

- Dual-instance npm-package architecture: accepted for the first spike.
- Full morning parity including background removal: human-review confidence only; not guaranteed.
- Minimal save/compile tests: required because manual testing is insufficient for silent metadata corruption.
- Full automated suite before proof: rejected as low leverage.
- Fork-first approach: rejected until a public API fails twice with documented evidence.

### Observer / chaos variable

**Chaos variable:** What if Riley’s apparent animation is not live element interpolation at all, but exported screenshots/stages cross-faded by a wrapper?

Response: the morning goal does not require internal interpolation. If live opacity updates stutter, compile static cumulative stages and cross-fade whole rendered layers. Preserve the external behavior, not the assumed internal mechanism.

## 8. Confidence and reality prediction

### Predictions

- Full Excalidraw editor visible within 30 minutes after dependencies install: **90%**.
- Hard-reveal dual-instance proof within 90 minutes of editor startup: **75%**.
- Fade, frame fit and save/open working within the same sitting: **70%**.
- Iconify direct insertion working that morning: **60%**.
- Browser background removal working that morning: **50%**.
- A clean recordable clip even if assets/background fall back to paste/external processing: **80%**.

The plan is therefore credible as an aggressive build, not a promise. The human gate is required because several confidence values are below AOCS’s 95% automatic-accept threshold.

## 9. First afternoon priorities

Only real morning failures may reorder this list.

1. **Draw-on arrow/freehand animation** — examine `excalidraw-animate`, exported SVG paths and stroke-dash animation.
2. **Record timings** — narrate/tap Space once, save cue timestamps, replay automatically.
3. Fix the three blockers recorded in `MORNING_NOTES.md`.
4. Multiple ordered scenes with hard cuts.
5. Replace-image while preserving position/step.
6. General photo search if repeated use justifies it.
7. Add automated coverage only for observed regressions.
8. Revisit the original full roadmap for durability work.

## 10. Completion report for the morning

The implementation report must state:

```text
CORE LOOP
- Editor: pass/fail
- Assign steps: pass/fail
- Separate player: pass/fail
- Frame/fullscreen: pass/fail
- Save/open: pass/fail
- Real recorded clip: exact path or blocker

STRETCH
- Iconify: pass/fallback/not attempted
- Background removal: pass/fallback/not attempted
- Fade: smooth/fallback to appear

VERIFICATION
- npm test: result
- npm run build: result
- Manual gates passed: 0–7

TRUTHFUL LIMITS
- Exact remaining problems, with no “complete” claim unless Gate 4 passed.
```

## 11. AOCS final directive

The single active bottleneck is always the next unopened gate.

```text
Gate 0 editor
  → Gate 1 reveal player
    → Gate 2 usable authoring
      → Gate 3 persistence
        → Gate 4 recorded proof
          → Gate 5 assets
            → Gate 6 background removal
              → Gate 7 final proof
```

No parallel polish. No enterprise ceremony. No claim of success before a real video file exists.
