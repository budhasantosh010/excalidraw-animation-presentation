# Riley-Style Animated Excalidraw Personal Video Tool Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a local, personal, browser-based Excalidraw video-presentation tool in this folder that lets the user draw normally, assign selected objects to ordered animation steps, preview those steps with simple entrance effects, search and insert visual assets, remove raster-image backgrounds locally, save/reopen the enriched `.excalidraw` file, and record a clean fullscreen presentation without conventional video-timeline editing.

**Architecture:** Embed the published `@excalidraw/excalidraw` React component instead of forking its monorepo. Store our animation metadata in each Excalidraw element's supported `customData`, keep the editor scene immutable during playback, and render presentation mode through a separate read-only Excalidraw instance. Add the animation toolbar, sequence panel, asset panel, local background-removal adapter, persistence layer, and fail-closed validation entirely in the host Vite application.

**Tech Stack:** Vite, React, TypeScript, `@excalidraw/excalidraw`, Zod, Vitest, React Testing Library, Playwright, Iconify API, optional Pexels/Brandfetch providers, `@imgly/background-removal`, browser File System APIs, IndexedDB/localStorage, Git.

---

## 1. Working directory and current state

All work must stay under:

```text
C:\Users\Lenovo\Music\Startups\YT Automations\A1 Talking Head Youtube Video\Sanverse YT Channel\excalidraw animation with codex
```

At planning time:

- The folder is empty.
- It is not a Git repository.
- There is no existing application to preserve.
- Node.js/npm availability has not yet been verified.
- No provider credentials have been configured.

The first implementation task must therefore verify the machine, initialize Git, and scaffold the app. Do not clone the full Excalidraw repository into this folder unless the public-API feasibility gate explicitly fails.

## 2. Truthful product boundary

### Verified target from Riley's supplied demo

The supplied recording clearly shows:

- the normal Excalidraw editing experience;
- numbered animation/reveal assignments displayed on the canvas;
- multiple elements sharing the same number;
- presentation mode progressing from `0 / N` through numbered cumulative reveals;
- a right-side image-search panel;
- search results being inserted into the drawing;
- rectangular/named areas used as presentation/video scenes;
- clean presentation playback suitable for screen recording.

### Claimed but not proven by the recording

- which logo/image provider Riley used;
- which background-removal implementation Riley used;
- whether he has a built-in MP4 exporter;
- whether he supports arbitrary slide, zoom, or draw-on effects;
- his exact line count, package structure, or implementation time per feature.

### V1 non-goals

These features must not block the Riley-equivalent tool:

- built-in MP4/H.264 export;
- a Premiere/After Effects-style timeline;
- arbitrary property keyframes;
- motion paths;
- audio editing;
- accounts, collaboration, or cloud sync;
- mobile support;
- desktop installer packaging;
- AI image generation;
- automatic video creation from a script;
- perfect background removal for every possible image;
- stroke-accurate arrow/freehand draw-on animation.

Draw-on animation is a post-V1 extension. The initial contract includes `appear`, `fade`, and a simple `slide` entrance. If `slide` destabilizes the morning prototype, `appear` and `fade` ship first; the Riley recording only requires cumulative reveal behavior.

## 3. Goal endpoint / definition of done

The project is complete only when the following end-to-end contract is satisfied.

### 3.1 Startup and editor

1. Running `npm install` and `npm run dev` from the working folder starts the application without manual file edits.
2. The terminal prints a local URL and opening it in Edge/Chrome shows the full Excalidraw editor.
3. The user can draw, type, create arrows, group elements, create frames, insert local images, undo, redo, pan, and zoom using the native Excalidraw behavior.
4. The custom application controls do not cover or break essential Excalidraw controls.
5. Reloading the page restores the most recent valid autosave after explicit user confirmation.

### 3.2 Animation authoring

6. Selecting one or more elements and clicking `Assign next step` assigns them to the next reveal step.
7. The user can assign an explicit step number, remove an assignment, move a step earlier/later, and merge multiple selected elements into the same step.
8. Step assignment is stored under versioned `customData.sanverseAnimation` without replacing unrelated `customData`.
9. Bound text/container pairs and grouped elements are assigned as one logical reveal unit so they cannot unintentionally appear in different steps.
10. Step numbers are shown as colored, non-exported badges near assigned objects while editing.
11. The sequence panel lists every step, its element count, entrance effect, duration, and hold duration.
12. Reordering steps updates both the panel and canvas badges deterministically.
13. Undo/redo works for animation assignments.

### 3.3 Presentation behavior

14. Clicking `Present` opens a clean read-only player using a frozen copy of the current scene.
15. No editor toolbar, selection handles, step badges, or asset panels appear in presentation mode.
16. Presentation begins at `0 / N`; elements marked as persistent remain visible and numbered reveal elements begin hidden.
17. Space/Right Arrow advances, Left Arrow reverses, `R` restarts, `F` toggles fullscreen, and Escape exits.
18. Every element assigned to the same step appears at the same time.
19. `appear` is instantaneous, `fade` interpolates opacity, and `slide` interpolates a short offset plus opacity.
20. Automatic playback follows configured durations/holds and can be paused/resumed.
21. Returning backward reconstructs the exact earlier cumulative state; it does not try to reverse a partially completed animation.
22. The final presentation state visually matches the editor scene with animation badges omitted.

### 3.4 Scenes/video framing

23. The user can create a standard 1920×1080 `Video Scene` frame.
24. A selected Excalidraw frame can be designated as the active presentation scene.
25. Presentation mode fits that frame to the viewport at 16:9 without exposing objects outside it.
26. Multiple frames can be ordered as scenes and played sequentially using hard cuts.
27. Each scene has independent reveal steps and timing.

### 3.5 Assets

28. The asset panel contains `Logos`, `Photos`, and `Upload/Paste` routes.
29. Logo search works without a paid account using Iconify/Simple Icons; optional Brandfetch support is isolated behind a provider adapter.
30. Photo search works when a Pexels key is supplied; missing credentials produce a setup message rather than a crash.
31. Clicking an asset downloads it, converts it to an Excalidraw binary file, and inserts it into the current scene.
32. Chosen assets are embedded/cached in the project so presentation does not depend on the original URL.
33. Every result retains source/provider/attribution metadata where the provider requires it.

### 3.6 Background removal

34. Selecting a raster image enables `Remove background`.
35. The original image is retained until the processed result is previewed and accepted.
36. Processing runs locally through the selected browser-side adapter and reports model-download/progress state.
37. Accepting replaces the image's `fileId` while preserving position, size, crop, rotation, groups, and animation assignment.
38. Undo restores the original file.
39. Failures leave the original image untouched and show a useful error.

### 3.7 Save/open and integrity

40. `Save` downloads or writes a standard `.excalidraw` JSON file containing elements, app state, files, and custom animation metadata.
41. `Open` loads files produced by this tool and normal Excalidraw files without animation metadata.
42. Save → reload → open preserves element IDs, files, groups, bindings, step assignments, effects, timing, frame ordering, and unrelated `customData`.
43. Invalid animation metadata is reported before playback and can be repaired or removed; it is never silently guessed.
44. Fatal missing-image or corrupt-project errors block presentation instead of skipping content.

### 3.8 Real workflow proof

45. The user creates one real 30–60 second Sanverse video segment with at least:
    - two 1920×1080 scenes;
    - ten reveal steps;
    - text, arrows, grouped shapes, one logo, and one raster image;
    - at least one background-removed image;
    - manual and automatic playback.
46. The segment is recorded cleanly at 1080p using OBS or Windows Game Bar.
47. The reveal animation requires no conventional video-timeline editing after recording.
48. Save/reopen and offline playback of that test project succeeds.

### 3.9 Quality endpoint

49. `npm test` passes all unit/component tests.
50. `npm run test:e2e` passes the critical Playwright workflow.
51. `npm run build` completes without TypeScript or bundling errors.
52. No API key, model credential, downloaded personal image, or generated `.excalidraw` project is committed accidentally.
53. A README explains installation, running, controls, provider setup, saving, recording, limitations, and licensing.

## 4. Morning endpoint versus hardened V1

### Morning endpoint — useable by lunchtime

The morning build is considered successful when items 1–22, 23–25, 28–29, 31–32, 34–39, 40–42, and one single-scene recording work. This produces the core Riley experience:

```text
Draw -> select -> assign numbers -> present -> reveal -> record
```

### Hardened V1 endpoint

The full definition of done above adds multi-scene ordering, photo-provider setup, failure handling, offline asset caching, data-integrity validation, automated tests, documentation, and the real two-scene proof project.

The morning target must not be delayed by hardened-V1 work. Conversely, a morning prototype must not be described as fully reliable until the hardened gates pass.

## 5. Proposed final repository layout

```text
excalidraw animation with codex/
├── .env.example
├── .gitignore
├── .hermes/
│   └── plans/
│       └── 2026-07-14_120116-riley-style-animated-excalidraw-full-plan.md
├── README.md
├── THIRD_PARTY_NOTICES.md
├── index.html
├── package.json
├── package-lock.json
├── playwright.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── vite.config.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── app.css
│   ├── components/
│   │   ├── editor/
│   │   │   ├── ExcalidrawWorkspace.tsx
│   │   │   ├── AnimationToolbar.tsx
│   │   │   ├── SequencePanel.tsx
│   │   │   ├── StepBadgeOverlay.tsx
│   │   │   └── VideoSceneControls.tsx
│   │   ├── player/
│   │   │   ├── PresentationMode.tsx
│   │   │   ├── PresentationControls.tsx
│   │   │   └── PresentationError.tsx
│   │   ├── assets/
│   │   │   ├── AssetPanel.tsx
│   │   │   ├── AssetGrid.tsx
│   │   │   └── BackgroundRemovalDialog.tsx
│   │   └── common/
│   │       ├── ErrorBoundary.tsx
│   │       └── ProgressOverlay.tsx
│   ├── context/
│   │   └── ProjectContext.tsx
│   ├── hooks/
│   │   ├── useKeyboardShortcuts.ts
│   │   ├── useAutosave.ts
│   │   └── useStepBadges.ts
│   ├── lib/
│   │   ├── animation/
│   │   │   ├── schema.ts
│   │   │   ├── metadata.ts
│   │   │   ├── selectionClosure.ts
│   │   │   ├── assignStep.ts
│   │   │   ├── normalizeSteps.ts
│   │   │   ├── compilePresentation.ts
│   │   │   ├── interpolateElements.ts
│   │   │   └── validateAnimation.ts
│   │   ├── excalidraw/
│   │   │   ├── adapter.ts
│   │   │   ├── projectFile.ts
│   │   │   ├── insertImage.ts
│   │   │   └── coordinates.ts
│   │   ├── assets/
│   │   │   ├── types.ts
│   │   │   ├── iconifyProvider.ts
│   │   │   ├── pexelsProvider.ts
│   │   │   ├── brandfetchProvider.ts
│   │   │   └── fetchAndCacheAsset.ts
│   │   ├── background/
│   │   │   ├── removeBackground.ts
│   │   │   └── replaceImageFile.ts
│   │   ├── storage/
│   │   │   ├── autosave.ts
│   │   │   └── settings.ts
│   │   └── ids.ts
│   ├── state/
│   │   ├── projectReducer.ts
│   │   └── types.ts
│   └── test/
│       └── setup.ts
├── tests/
│   ├── fixtures/
│   │   ├── mixed-elements.excalidraw
│   │   └── corrupt-animation.excalidraw
│   ├── unit/
│   │   ├── animation-schema.test.ts
│   │   ├── selection-closure.test.ts
│   │   ├── assign-step.test.ts
│   │   ├── normalize-steps.test.ts
│   │   ├── compile-presentation.test.ts
│   │   ├── interpolate-elements.test.ts
│   │   ├── project-file.test.ts
│   │   └── background-replacement.test.ts
│   ├── components/
│   │   ├── AnimationToolbar.test.tsx
│   │   ├── SequencePanel.test.tsx
│   │   └── PresentationMode.test.tsx
│   └── e2e/
│       ├── editor-smoke.spec.ts
│       ├── assign-present.spec.ts
│       ├── save-reopen.spec.ts
│       └── asset-background.spec.ts
└── work/
    └── manual-test-projects/
```

## 6. Core data contracts

### 6.1 Animation metadata

Create `src/lib/animation/schema.ts` with one versioned schema. Do not scatter arbitrary keys across components.

```ts
import { z } from "zod";

export const EntranceEffectSchema = z.enum(["appear", "fade", "slide"]);

export const ElementAnimationSchema = z.object({
  version: z.literal(1),
  sceneId: z.string().min(1),
  stepId: z.string().min(1),
});

export const StepSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().min(1),
  effect: EntranceEffectSchema.default("fade"),
  durationMs: z.number().int().min(0).max(5000).default(250),
  holdMs: z.number().int().min(0).max(60000).default(800),
});

export const SceneSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  order: z.number().int().min(1),
  width: z.number().positive().default(1920),
  height: z.number().positive().default(1080),
  steps: z.array(StepSchema),
});

export type EntranceEffect = z.infer<typeof EntranceEffectSchema>;
export type ElementAnimation = z.infer<typeof ElementAnimationSchema>;
export type AnimationStep = z.infer<typeof StepSchema>;
export type VideoScene = z.infer<typeof SceneSchema>;
```

Element assignment is stored in:

```ts
element.customData.sanverseAnimation = {
  version: 1,
  sceneId: "scene-...",
  stepId: "step-...",
};
```

Scene configuration is stored on the Excalidraw frame element:

```ts
frame.customData.sanverseVideoScene = {
  version: 1,
  id: "scene-...",
  order: 1,
  width: 1920,
  height: 1080,
  steps: [...],
};
```

This keeps normal `.excalidraw` compatibility and avoids a proprietary project format.

### 6.2 Player compilation result

```ts
export type CompiledStep = {
  sceneId: string;
  stepId: string;
  order: number;
  effect: EntranceEffect;
  durationMs: number;
  holdMs: number;
  enteringElementIds: ReadonlySet<string>;
  visibleElementIds: ReadonlySet<string>;
};

export type CompiledScene = {
  scene: VideoScene;
  frameElementId: string;
  persistentElementIds: ReadonlySet<string>;
  steps: readonly CompiledStep[];
};
```

Compilation accepts a frozen editor snapshot and never mutates it.

## 7. Public-API feasibility gate

Before building the full feature set, prove these operations in a small spike using only documented/exported package APIs:

1. Capture the `ExcalidrawImperativeAPI` instance.
2. Read selected IDs from `api.getAppState().selectedElementIds`.
3. Read elements and files.
4. Update element `customData` without breaking native undo/redo.
5. Preserve custom data after save/open.
6. Render custom controls through `renderTopRightUI` or supported children.
7. Add a downloaded image file and matching image element.
8. Run a second read-only Excalidraw instance as the presentation player.
9. Update cloned player elements repeatedly for a fade without corrupting source versions.
10. Compute canvas badge coordinates during pan/zoom.

### Fork decision

Continue with the npm package unless selection access, element metadata mutation, or image insertion is fundamentally impossible through exported APIs.

Do not fork merely because:

- a custom button is not inside the exact native toolbar;
- the sidebar looks slightly different;
- badge placement needs a host overlay;
- an internal helper would be convenient.

If a hard blocker exists, create a written `docs/FORK_DECISION.md` showing the failing spike and exact missing capability before any fork is authorized.

## 8. Implementation tasks

### Task 1: Verify prerequisites and initialize Git

**Objective:** Establish a reproducible empty repository without changing global machine configuration.

**Files:**
- Create: `.gitignore`
- Create: `.env.example`

**Step 1: Verify tools**

Run:

```powershell
node --version
npm --version
git --version
```

Expected: all commands exit 0. Record versions in the implementation log.

**Step 2: Initialize Git**

Run:

```powershell
git init -b main
```

Expected: an empty repository on `main`.

**Step 3: Create ignore rules**

`.gitignore` must include:

```gitignore
node_modules/
dist/
playwright-report/
test-results/
coverage/
.env
.env.local
*.log
work/manual-test-projects/*.excalidraw
```

**Step 4: Create environment template**

```dotenv
VITE_PEXELS_API_KEY=
VITE_BRANDFETCH_CLIENT_ID=
```

**Step 5: Verify no secret is tracked**

Run: `git status --short`

Expected: only `.gitignore`, `.env.example`, and the saved plan are visible.

**Step 6: Commit**

```powershell
git add .gitignore .env.example .hermes
git commit -m "chore: initialize animated excalidraw project"
```

### Task 2: Scaffold Vite React TypeScript app

**Objective:** Display the default Vite app and establish build/test scripts.

**Files:**
- Create: Vite template files
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/test/setup.ts`

**Step 1: Scaffold in the current folder**

Run:

```powershell
npm create vite@latest . -- --template react-ts
npm install
```

Expected: Vite React TypeScript project generated without nesting another folder.

**Step 2: Install runtime dependencies**

```powershell
npm install @excalidraw/excalidraw zod nanoid idb-keyval @imgly/background-removal
```

**Step 3: Install test dependencies**

```powershell
npm install -D vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test
npx playwright install chromium
```

**Step 4: Add scripts**

`package.json` scripts must include:

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui"
}
```

**Step 5: Add test setup**

`src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

**Step 6: Run verification**

```powershell
npm run build
npm run dev
```

Expected: build passes and the Vite page opens locally.

**Step 7: Commit**

```powershell
git add package.json package-lock.json index.html src vite.config.ts tsconfig*.json
git commit -m "chore: scaffold vite react application"
```

### Task 3: Embed Excalidraw and prove the imperative API

**Objective:** Replace the template with a full-screen Excalidraw editor and expose the API through one adapter.

**Files:**
- Create: `src/components/editor/ExcalidrawWorkspace.tsx`
- Create: `src/lib/excalidraw/adapter.ts`
- Modify: `src/App.tsx`
- Modify: `src/app.css`
- Test: `tests/components/ExcalidrawWorkspace.test.tsx`

**Step 1: Write the failing component smoke test**

Test that the workspace container fills the viewport and invokes the API callback. Mock the heavy Excalidraw component for the unit test.

**Step 2: Run the test**

Run: `npm test -- ExcalidrawWorkspace`

Expected: FAIL because the component does not exist.

**Step 3: Implement the workspace**

Use dynamic React state for the imperative API:

```tsx
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

export function ExcalidrawWorkspace() {
  return (
    <div className="workspace">
      <Excalidraw
        excalidrawAPI={(api) => {
          // Store through ProjectContext in the next task.
          window.__sanverseExcalidrawApi = api;
        }}
      />
    </div>
  );
}
```

The temporary window assignment exists only for the feasibility spike and must be removed by Task 5.

**Step 4: Add CSS**

```css
html,
body,
#root,
.app,
.workspace {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}
```

**Step 5: Verify manually**

Confirm rectangle, text, arrow, grouping, image insertion, undo, pan, and zoom.

**Step 6: Run tests/build**

```powershell
npm test -- ExcalidrawWorkspace
npm run build
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add src tests
git commit -m "feat: embed full-screen excalidraw editor"
```

### Task 4: Define and test animation schemas

**Objective:** Establish one validated metadata contract before UI code writes data.

**Files:**
- Create: `src/lib/animation/schema.ts`
- Create: `src/lib/animation/metadata.ts`
- Test: `tests/unit/animation-schema.test.ts`

**Step 1: Write failing tests**

Cover:

- valid v1 element metadata;
- valid scene with ordered steps;
- rejection of step zero, negative durations, unknown effects, and unknown versions;
- preservation of unrelated custom data;
- safe parse returns a structured error rather than throwing into the UI.

**Step 2: Run tests**

Run: `npm test -- animation-schema`

Expected: FAIL because schemas do not exist.

**Step 3: Implement schemas**

Use the contracts in Section 6. Export `parseElementAnimation`, `parseVideoScene`, `withElementAnimation`, and `withoutElementAnimation`.

`withElementAnimation` must merge instead of replace:

```ts
export function withElementAnimation(element, animation) {
  return {
    ...element,
    customData: {
      ...(element.customData ?? {}),
      sanverseAnimation: animation,
    },
  };
}
```

**Step 4: Run tests**

Run: `npm test -- animation-schema`

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/lib/animation tests/unit/animation-schema.test.ts
git commit -m "feat: define versioned animation metadata"
```

### Task 5: Create project state and remove spike globals

**Objective:** Centralize API, elements, app state, files, mode, and project-dirty state without adding a state-management dependency.

**Files:**
- Create: `src/state/types.ts`
- Create: `src/state/projectReducer.ts`
- Create: `src/context/ProjectContext.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/editor/ExcalidrawWorkspace.tsx`
- Test: `tests/unit/project-reducer.test.ts`

**Step 1: Write reducer tests**

Test `API_READY`, `SCENE_CHANGED`, `ENTER_PRESENTATION`, `EXIT_PRESENTATION`, `SET_ACTIVE_SCENE`, `MARK_SAVED`, and `LOAD_PROJECT`.

**Step 2: Run and verify failure**

Run: `npm test -- project-reducer`

Expected: FAIL.

**Step 3: Implement reducer/context**

The scene snapshot must contain:

```ts
type SceneSnapshot = {
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
};
```

`onChange` must update the context and mark dirty only after initial load.

**Step 4: Remove `window.__sanverseExcalidrawApi`**

All components consume the context.

**Step 5: Test/build**

```powershell
npm test -- project-reducer
npm run build
```

**Step 6: Commit**

```powershell
git add src tests
git commit -m "feat: add centralized project state"
```

### Task 6: Resolve logical selection closure

**Objective:** Prevent grouped and bound pieces from being assigned to conflicting animation steps.

**Files:**
- Create: `src/lib/animation/selectionClosure.ts`
- Test: `tests/unit/selection-closure.test.ts`
- Create: `tests/fixtures/mixed-elements.excalidraw`

**Step 1: Create a real fixture**

The fixture must include:

- rectangle with bound text;
- arrow with label/bindings;
- three grouped shapes;
- standalone text;
- image;
- frame containing all objects;
- unrelated `customData` on one object.

**Step 2: Write failing closure tests**

Test that selecting:

- a container includes bound text;
- bound text includes its container;
- one group member includes every member sharing the active group ID;
- one object does not pull in unrelated arrows unless explicitly selected or bound;
- deleted elements are excluded;
- frame elements are not assigned as content accidentally.

**Step 3: Run failure**

Run: `npm test -- selection-closure`

Expected: FAIL.

**Step 4: Implement graph traversal**

Build maps for ID, group ID, `containerId`, and `boundElements`. Traverse until no new IDs are found.

**Step 5: Run tests**

Expected: PASS with deterministic sorted IDs.

**Step 6: Commit**

```powershell
git add src/lib/animation/selectionClosure.ts tests
git commit -m "feat: resolve grouped and bound reveal units"
```

### Task 7: Assign, remove, and normalize steps

**Objective:** Implement pure immutable animation-authoring operations.

**Files:**
- Create: `src/lib/animation/assignStep.ts`
- Create: `src/lib/animation/normalizeSteps.ts`
- Test: `tests/unit/assign-step.test.ts`
- Test: `tests/unit/normalize-steps.test.ts`

**Step 1: Write failing tests**

Cover:

- assigning selected closure to new step;
- assigning to an existing step;
- removing assignment;
- no mutation of source elements;
- unrelated custom data retained;
- one scene cannot reference another scene's step;
- normalizing orders from `1, 4, 9` to `1, 2, 3` while preserving stable step IDs;
- merging steps;
- moving earlier/later at boundaries.

**Step 2: Implement minimal pure functions**

```ts
assignElementsToStep(snapshot, selectedIds, sceneId, stepId)
removeElementsFromStep(snapshot, selectedIds)
createNextStep(scene)
moveStep(scene, stepId, delta)
mergeSteps(scene, sourceStepId, targetStepId)
normalizeStepOrders(scene)
```

**Step 3: Verify**

Run: `npm test -- assign-step normalize-steps`

Expected: PASS.

**Step 4: Commit**

```powershell
git add src/lib/animation tests/unit
git commit -m "feat: add deterministic step authoring operations"
```

### Task 8: Add the animation toolbar

**Objective:** Let the user assign and clear steps from selected elements.

**Files:**
- Create: `src/components/editor/AnimationToolbar.tsx`
- Modify: `src/components/editor/ExcalidrawWorkspace.tsx`
- Test: `tests/components/AnimationToolbar.test.tsx`

**Step 1: Write component tests**

Test disabled state with no selection, next-step assignment, explicit numeric assignment, clear assignment, present button, and visible current assignment summary.

**Step 2: Run failure**

Run: `npm test -- AnimationToolbar`

**Step 3: Implement using `renderTopRightUI`**

Controls:

```text
[Video Scene] [−] [Step number] [+] [Assign next] [Clear] [Sequence] [Present]
```

Do not patch the native toolbar.

**Step 4: Update the editor through one undoable `updateScene`**

Use the package's current `CaptureUpdateAction.IMMEDIATELY` equivalent verified by the spike.

**Step 5: Test manually**

Draw rectangle + bound text, select rectangle, assign step, undo, redo.

**Step 6: Run test/build and commit**

```powershell
npm test -- AnimationToolbar
npm run build
git add src tests
git commit -m "feat: add reveal-step authoring toolbar"
```

### Task 9: Render step badges accurately

**Objective:** Show non-destructive ordered badges that follow pan and zoom and never enter exports.

**Files:**
- Create: `src/lib/excalidraw/coordinates.ts`
- Create: `src/hooks/useStepBadges.ts`
- Create: `src/components/editor/StepBadgeOverlay.tsx`
- Test: `tests/unit/coordinates.test.ts`
- Test: `tests/components/StepBadgeOverlay.test.tsx`

**Step 1: Write coordinate tests**

Test scene-to-overlay conversion at:

- zoom 1 with zero scroll;
- zoom 2;
- positive/negative scroll;
- container offset;
- resized viewport.

**Step 2: Implement coordinate conversion**

Prefer an exported Excalidraw coordinate helper if available. Otherwise use a tested formula based on `appState.scrollX`, `scrollY`, and `zoom.value`.

**Step 3: Render one badge per logical reveal unit**

Use the unit's common bounds and stable colors derived from step order. Badges are HTML with `pointer-events: none`.

**Step 4: Subscribe to scene/app-state changes**

Badges update during move, zoom, pan, group, and undo/redo.

**Step 5: Verify badges are not in saved Excalidraw elements**

This avoids badge pollution and synchronization bugs.

**Step 6: Run tests and commit**

```powershell
npm test -- coordinates StepBadgeOverlay
git add src tests
git commit -m "feat: overlay non-destructive reveal badges"
```

### Task 10: Add video-scene frames

**Objective:** Create and configure 1920×1080 frames as presentation scenes.

**Files:**
- Create: `src/components/editor/VideoSceneControls.tsx`
- Create: `src/lib/animation/createVideoScene.ts`
- Test: `tests/unit/create-video-scene.test.ts`

**Step 1: Write failing tests**

Test new frame dimensions, unique scene ID, scene order, empty steps, and preservation through restore/save.

**Step 2: Implement scene creation**

Create or restore a valid Excalidraw frame element at the viewport center and attach `sanverseVideoScene` metadata.

**Step 3: Add controls**

Actions:

- `New 16:9 scene`;
- `Make selected frame a scene`;
- `Set active scene`;
- `Move scene earlier/later`.

**Step 4: Validate no duplicate scene IDs/orders**

**Step 5: Run tests/build and commit**

```powershell
npm test -- create-video-scene
npm run build
git add src tests
git commit -m "feat: add ordered 16:9 video scenes"
```

### Task 11: Build the sequence panel

**Objective:** Provide a canonical ordered view for scenes, steps, effects, and timing.

**Files:**
- Create: `src/components/editor/SequencePanel.tsx`
- Test: `tests/components/SequencePanel.test.tsx`

**Step 1: Write failing tests**

Test step list, element counts, select step, move earlier/later, merge, delete, effect selection, duration validation, and empty state.

**Step 2: Implement panel**

Use buttons first, not drag-and-drop. Drag-and-drop adds complexity and accessibility risk without improving the morning workflow.

Each row displays:

```text
2 | 4 elements | Fade | 250ms | Hold 800ms | ↑ ↓ Merge Delete
```

**Step 3: Validate fields before updating scene metadata**

**Step 4: Keep selected step synchronized with canvas selection**

**Step 5: Test and commit**

```powershell
npm test -- SequencePanel
git add src tests
git commit -m "feat: add animation sequence panel"
```

### Task 12: Compile and validate presentation scenes

**Objective:** Convert a frozen editor snapshot into deterministic cumulative playback stages and block invalid scenes.

**Files:**
- Create: `src/lib/animation/compilePresentation.ts`
- Create: `src/lib/animation/validateAnimation.ts`
- Test: `tests/unit/compile-presentation.test.ts`
- Create: `tests/fixtures/corrupt-animation.excalidraw`

**Step 1: Write failing compiler tests**

Cover:

- persistent unassigned elements visible at step zero;
- step one visibility;
- cumulative visibility;
- elements in another frame excluded;
- frame z-order preserved;
- same input returns deeply equal output;
- source frozen input is not mutated;
- missing step reference is fatal;
- missing image file is fatal;
- duplicate scene/step IDs are fatal;
- invalid metadata version is fatal;
- object outside frame is a warning, not silent inclusion.

**Step 2: Implement validator**

Return:

```ts
type ValidationResult = {
  errors: Array<{ code: string; message: string; elementId?: string }>;
  warnings: Array<{ code: string; message: string; elementId?: string }>;
};
```

No thrown exception should cross into React for known data errors.

**Step 3: Implement compiler**

Sort scenes/steps explicitly. Precompute entering and visible ID sets.

**Step 4: Run tests**

Run: `npm test -- compile-presentation`

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/lib/animation tests
git commit -m "feat: compile and validate presentation stages"
```

### Task 13: Implement player interpolation

**Objective:** Generate render elements for appear, fade, and slide without mutating source elements.

**Files:**
- Create: `src/lib/animation/interpolateElements.ts`
- Test: `tests/unit/interpolate-elements.test.ts`

**Step 1: Write failing tests**

At progress `0`, `0.5`, and `1`, verify:

- `appear` remains hidden until complete;
- `fade` opacity equals `originalOpacity × progress`;
- `slide` x/y offset approaches zero and opacity approaches original;
- earlier visible steps remain unchanged;
- future steps stay hidden;
- original opacity 40 ends at 40, not 100;
- source arrays/objects are unchanged.

**Step 2: Implement interpolation**

Keep one fixed slide preset in V1, e.g. 32 scene pixels upward. Do not build an easing editor. Use one exported easing function.

**Step 3: Run tests and commit**

```powershell
npm test -- interpolate-elements
git add src/lib/animation tests/unit/interpolate-elements.test.ts
git commit -m "feat: interpolate reveal entrance effects"
```

### Task 14: Build clean presentation mode

**Objective:** Play compiled scenes in a separate read-only Excalidraw surface.

**Files:**
- Create: `src/components/player/PresentationMode.tsx`
- Create: `src/components/player/PresentationControls.tsx`
- Create: `src/components/player/PresentationError.tsx`
- Create: `src/hooks/useKeyboardShortcuts.ts`
- Test: `tests/components/PresentationMode.test.tsx`

**Step 1: Write failing tests**

Test:

- starts at 0/N;
- next/back/restart;
- no editor controls;
- same-step elements appear together;
- fatal validation shows error screen;
- automatic playback can pause/resume;
- leaving presentation does not modify editor snapshot.

**Step 2: Implement a frozen snapshot on entry**

Do not subscribe player rendering to live editor `onChange`.

**Step 3: Use `requestAnimationFrame`**

Advance progress according to the current step's `durationMs`. Apply full element updates to only the player API and use non-history capture.

**Step 4: Implement keys**

```text
Space / Right -> next
Left          -> previous stable stage
R             -> restart
P             -> pause/resume auto
F             -> fullscreen
Escape        -> exit
```

**Step 5: Fit selected frame**

Use `scrollToContent` or the package's frame fit API verified in the feasibility spike.

**Step 6: Test a 150-element fixture**

Target: no visibly dropped interaction and stable fade on the user's machine. If canvas updates stutter, reduce fade update frequency to 30fps; do not patch the renderer.

**Step 7: Run tests/build and commit**

```powershell
npm test -- PresentationMode
npm run build
git add src tests
git commit -m "feat: add clean keyboard-driven presentation mode"
```

### Task 15: Implement save, open, and autosave

**Objective:** Preserve normal Excalidraw compatibility and recover the last valid local session.

**Files:**
- Create: `src/lib/excalidraw/projectFile.ts`
- Create: `src/lib/storage/autosave.ts`
- Create: `src/hooks/useAutosave.ts`
- Modify: `src/components/editor/AnimationToolbar.tsx`
- Test: `tests/unit/project-file.test.ts`

**Step 1: Write failing round-trip tests**

Create a scene with files, groups, bindings, unrelated custom data, scene metadata, and step metadata. Serialize, parse, and compare required fields.

**Step 2: Implement using current Excalidraw export/restore utilities**

Verify the package exports during the spike. If helpers are unavailable, emit the standard schema:

```ts
{
  type: "excalidraw",
  version: 2,
  source: "sanverse-animated-excalidraw",
  elements,
  appState,
  files,
}
```

**Step 3: Add save/open controls**

Use Chromium File System Access API when available, download/upload fallback otherwise.

**Step 4: Add debounced autosave**

Store only after schema validation. Retain `lastKnownGood` separately from the in-progress snapshot.

**Step 5: Add recovery prompt**

Never automatically overwrite a manually opened file with autosave.

**Step 6: Run tests and manual round trip**

```powershell
npm test -- project-file
npm run build
```

**Step 7: Commit**

```powershell
git add src tests
git commit -m "feat: save open and recover animated excalidraw projects"
```

### Task 16: Define asset-provider interface and Iconify search

**Objective:** Add fast logo search without hardwiring the UI to one vendor.

**Files:**
- Create: `src/lib/assets/types.ts`
- Create: `src/lib/assets/iconifyProvider.ts`
- Create: `src/components/assets/AssetPanel.tsx`
- Create: `src/components/assets/AssetGrid.tsx`
- Test: `tests/unit/iconify-provider.test.ts`

**Step 1: Define provider contract**

```ts
export type AssetResult = {
  id: string;
  provider: "iconify" | "pexels" | "brandfetch" | "upload";
  title: string;
  previewUrl: string;
  downloadUrl: string;
  mimeType: string;
  attribution?: string;
  sourceUrl?: string;
};

export interface AssetProvider {
  search(query: string, signal?: AbortSignal): Promise<AssetResult[]>;
}
```

**Step 2: Write mocked API tests**

Test URL encoding, Simple Icons restriction, empty results, aborts, HTTP errors, and SVG URL mapping.

**Step 3: Implement Iconify provider**

Debounce search by approximately 250ms and cancel stale requests.

**Step 4: Build logo tab**

Show loading, empty, error, and results states.

**Step 5: Test and commit**

```powershell
npm test -- iconify-provider
git add src tests
git commit -m "feat: add searchable transparent logo assets"
```

### Task 17: Insert and cache remote assets in Excalidraw

**Objective:** Convert selected search/upload results into local Excalidraw image elements.

**Files:**
- Create: `src/lib/assets/fetchAndCacheAsset.ts`
- Create: `src/lib/excalidraw/insertImage.ts`
- Test: `tests/unit/insert-image.test.ts`

**Step 1: Write failing tests**

Test:

- fetch to Blob/data URL;
- deterministic or collision-safe file ID;
- MIME allowlist;
- maximum size rejection;
- SVG sanitization;
- correct aspect-ratio sizing;
- new image centered in active frame;
- file passed to `api.addFiles` before element update;
- attribution stored in `customData.sanverseAsset`;
- no remote dependency after insertion.

**Step 2: Implement binary-file creation**

Use package file-ID generation when exposed; otherwise SHA-256 via Web Crypto.

**Step 3: Implement valid image element creation**

Prefer exported element conversion/restore helpers. The feasibility spike must prove the required fields before this task.

**Step 4: Add Upload/Paste path**

Local images use the same insertion function.

**Step 5: Run tests/manual offline check**

Insert logo, disable network, reload from saved file, and verify it renders.

**Step 6: Commit**

```powershell
git add src tests
git commit -m "feat: insert and embed searched assets"
```

### Task 18: Add optional Pexels and Brandfetch providers

**Objective:** Support Riley-like general photo search and richer logo search without making credentials mandatory.

**Files:**
- Create: `src/lib/assets/pexelsProvider.ts`
- Create: `src/lib/assets/brandfetchProvider.ts`
- Modify: `src/components/assets/AssetPanel.tsx`
- Test: `tests/unit/asset-providers.test.ts`

**Step 1: Write mocked tests**

Cover missing key/client ID, successful mapping, attribution, HTTP 401/429, abort, and provider-disabled state.

**Step 2: Implement Pexels provider**

Read `VITE_PEXELS_API_KEY`. Because this is a personal local application, browser exposure is accepted for V1 and documented. If the tool is later hosted/shared, replace it with a local server proxy.

**Step 3: Implement Brandfetch provider**

Read `VITE_BRANDFETCH_CLIENT_ID`; keep Iconify as the no-account fallback.

**Step 4: Add setup UI**

Missing credentials show exact `.env.local` keys and restart instructions.

**Step 5: Commit**

```powershell
git add src tests .env.example
git commit -m "feat: add optional photo and brand providers"
```

### Task 19: Add local background removal

**Objective:** Process selected raster images locally, preview the result, and replace safely.

**Files:**
- Create: `src/lib/background/removeBackground.ts`
- Create: `src/lib/background/replaceImageFile.ts`
- Create: `src/components/assets/BackgroundRemovalDialog.tsx`
- Create: `src/components/common/ProgressOverlay.tsx`
- Test: `tests/unit/background-replacement.test.ts`

**Step 1: Write replacement tests without loading the ML model**

Mock the removal adapter. Verify original file retained, preview rejected leaves scene unchanged, preview accepted changes only `fileId` and intended custom data, undoable update, and failure leaves original untouched.

**Step 2: Implement adapter boundary**

```ts
export interface BackgroundRemovalAdapter {
  remove(input: Blob, onProgress?: (progress: number) => void): Promise<Blob>;
}
```

Wrap `@imgly/background-removal` behind this interface so licensing/performance choices can change later.

**Step 3: Restrict supported inputs**

Enable only for raster `image/png`, `image/jpeg`, and `image/webp`; SVG logos should not need removal.

**Step 4: Add dialog**

Show original/result side-by-side with `Accept`, `Cancel`, and explicit processing error.

**Step 5: Preserve original**

Store the original file ID in `customData.sanverseBackgroundRemoval.originalFileId` until undo/history makes it unnecessary.

**Step 6: Manual first-run test**

Verify model download progress and a real portrait/product image on the user's machine.

**Step 7: Test/build and commit**

```powershell
npm test -- background-replacement
npm run build
git add src tests
git commit -m "feat: remove image backgrounds locally with preview"
```

### Task 20: Add error boundary and preflight panel

**Objective:** Make failures explicit and prevent silent wrong playback.

**Files:**
- Create: `src/components/common/ErrorBoundary.tsx`
- Create: `src/components/editor/PreflightPanel.tsx`
- Modify: `src/components/editor/AnimationToolbar.tsx`
- Test: `tests/components/PreflightPanel.test.tsx`

**Step 1: Write tests**

Test warnings versus fatal errors, present button disabled on fatal errors, element-focus action, and no silent repair.

**Step 2: Implement codes**

At minimum:

```text
MISSING_ACTIVE_SCENE
DUPLICATE_SCENE_ID
DUPLICATE_STEP_ID
UNKNOWN_METADATA_VERSION
MISSING_STEP
MISSING_BINARY_FILE
BOUND_PAIR_STEP_CONFLICT
OUTSIDE_SCENE_FRAME
EMPTY_SCENE
```

**Step 3: Add explicit repair actions only where deterministic**

For example, renumber duplicate orders is deterministic; inventing a missing step effect is not.

**Step 4: Test and commit**

```powershell
npm test -- PreflightPanel
git add src tests
git commit -m "feat: fail closed on invalid presentation data"
```

### Task 21: Add end-to-end tests

**Objective:** Prove the user workflow in a real Chromium browser.

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/editor-smoke.spec.ts`
- Create: `tests/e2e/assign-present.spec.ts`
- Create: `tests/e2e/save-reopen.spec.ts`
- Create: `tests/e2e/asset-background.spec.ts`

**Step 1: Configure web server**

Playwright should start `npm run dev -- --host 127.0.0.1` and reuse the server locally.

**Step 2: Editor smoke**

Confirm app loads, canvas appears, and custom toolbar renders.

**Step 3: Assign/present workflow**

Use a seeded fixture rather than relying on brittle pointer drawing. Assign two steps, enter presentation, advance/back/restart, verify counter and visible stages.

**Step 4: Save/reopen**

Test serialization through an in-app test hook or downloaded file fixture and verify metadata round trip.

**Step 5: Asset/background**

Mock provider/model network at the browser boundary and verify insert → remove → accept → undo.

**Step 6: Run**

Run: `npm run test:e2e`

Expected: all critical tests pass in Chromium.

**Step 7: Commit**

```powershell
git add playwright.config.ts tests/e2e
git commit -m "test: cover animated excalidraw workflow end to end"
```

### Task 22: Create the real Sanverse proof project

**Objective:** Validate the tool against the actual video-production workflow rather than synthetic tests only.

**Files:**
- Create locally only: `work/manual-test-projects/sanverse-proof.excalidraw`
- Create: `work/manual-test-projects/TEST_NOTES.md`

**Step 1: Build two scenes**

Scene A: hook/title. Scene B: explanation/diagram.

**Step 2: Include representative content**

At least text, bound arrows, grouped objects, transparent logo, raster photo, and background-removed image.

**Step 3: Assign ten or more steps**

Use repeated same-step groups and at least two effects.

**Step 4: Test manual and auto playback**

Record issues with exact reproduction steps in `TEST_NOTES.md`.

**Step 5: Save/reopen and disconnect network**

Verify playback still works.

**Step 6: Record 1080p**

Use OBS or Game Bar; check no cursor, controls, clipping, badge, or remote-loading artifacts appear.

**Step 7: Fix only endpoint-blocking issues**

New feature ideas go to `README.md` future-work list; they do not expand V1 automatically.

### Task 23: Documentation, licenses, and final verification

**Objective:** Make the local tool reproducible and truthfully documented.

**Files:**
- Create: `README.md`
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `.env.example`

**Step 1: Document exact setup**

Include Node/npm prerequisites, install, run, build, test, provider configuration, and browser requirement.

**Step 2: Document workflow**

```text
Create scene -> draw -> group -> assign -> configure -> preflight -> present -> record -> save
```

**Step 3: Document controls and limitations**

State clearly that V1 does not export MP4 and background removal is probabilistic.

**Step 4: Document licensing**

- Excalidraw: MIT.
- `@imgly/background-removal`: AGPL; personal local use chosen for this project. Reassess before distribution.
- Asset-provider attribution requirements.

**Step 5: Run the complete gate**

```powershell
npm test
npm run test:e2e
npm run build
git status --short
```

Expected:

- all tests pass;
- build passes;
- only intentional documentation/fixture changes remain;
- no secrets or personal project files are staged.

**Step 6: Final commit**

```powershell
git add README.md THIRD_PARTY_NOTICES.md .env.example src tests package*.json
git commit -m "docs: complete animated excalidraw v1 handoff"
```

## 9. Morning execution order

For the first sitting, execute only this critical path:

```text
Task 1  Prerequisites/Git
Task 2  Vite scaffold
Task 3  Excalidraw editor
Task 4  Metadata schema
Task 5  Project state
Task 6  Selection closure (minimum bound/group rules)
Task 7  Assign steps
Task 8  Toolbar
Task 9  Badges
Task 12 Compiler/validation (minimum valid path)
Task 13 Fade interpolation
Task 14 Presentation mode
Task 15 Save/open
Task 16 Iconify logos
Task 17 Asset insertion
Task 19 Background removal
Task 22 One-scene recording proof
```

Defer multiple scenes, optional providers, comprehensive preflight, full E2E coverage, and polished documentation until the core proof is recorded.

### Timebox protection rules

1. If step badges take more than 30 minutes, use a simple fixed overlay or sequence panel and continue.
2. If group closure becomes complex, support user-created Excalidraw groups and bound text first; document unsupported exotic bindings.
3. If fade updates stutter, use `appear` for the proof and benchmark after recording.
4. If Iconify insertion is blocked by image-element construction, ship Upload/Paste first.
5. If IMG.LY model setup consumes more than 45 minutes, use remove.bg as a temporary adapter or defer background removal until after the recording proof.
6. Do not attempt draw-on animation during the morning critical path.
7. Do not package Electron/Tauri during the morning critical path.

## 10. Validation matrix

| Requirement | Unit | Component | E2E | Manual |
|---|---:|---:|---:|---:|
| Metadata round trip | Yes | — | Yes | Yes |
| Group/bound assignment | Yes | Yes | Yes | Yes |
| Step reorder/merge | Yes | Yes | Yes | Yes |
| Badge coordinates | Yes | Yes | — | Yes |
| Fade/slide interpolation | Yes | — | Yes | Yes |
| Back/restart determinism | Yes | Yes | Yes | Yes |
| Frame fit/cropping | Yes | Yes | Yes | Yes |
| Image insertion | Yes | Yes | Yes | Yes |
| Offline asset playback | Yes | — | Yes | Yes |
| Background replacement/undo | Yes | Yes | Yes | Yes |
| Missing file fail-closed | Yes | Yes | Yes | Yes |
| 1080p recording cleanliness | — | — | — | Yes |

## 11. Risks and explicit controls

### Excalidraw public API gap

Control: perform the feasibility spike before architecture spreads; centralize all package-specific operations in `src/lib/excalidraw/adapter.ts`.

### Native undo/history conflict

Control: authoring updates use one immediate history capture; playback runs in a separate API instance and never touches the editor.

### Badge drift

Control: HTML overlay driven from current app state and tested coordinate conversion; sequence panel remains canonical.

### Group/binding inconsistencies

Control: compute dependency closure before assignment and validate conflicts before presentation.

### Repeated scene updates stutter

Control: benchmark realistic fixtures, cap interactive animation at 30fps if necessary, keep `appear` as deterministic fallback.

### Image CORS/remote disappearance

Control: fetch and embed selected assets immediately; presentation reads only embedded files.

### Background removal quality

Control: preserve original, require preview/accept, never replace automatically, provide undo.

### IMG.LY licensing

Control: personal-local AGPL use is documented; isolate adapter so a different implementation can replace it before distribution.

### Provider keys

Control: `.env.local` ignored, providers optional, no keys in tests or Git, hosted version would require server proxy.

### Scope explosion

Control: use V1 non-goals and require a real recorded segment before accepting additional features.

## 12. Post-V1 extensions, ordered by value

Only consider after the goal endpoint passes:

1. `Record timings`: narrate and press Space; save cue timestamps for automatic replay.
2. Scene templates for Sanverse hooks, comparisons, workflows, and conclusions.
3. Replace image while preserving animation, size, and crop.
4. Duplicate scene and replace text/assets.
5. Camera pan/zoom between frames.
6. Draw-on arrows/freehand using exported SVG path animation or `excalidraw-animate` ideas.
7. Deterministic SVG-stage → FFmpeg MP4 export.
8. Transparent video export.
9. Tauri/Electron desktop packaging.

Each extension needs its own acceptance contract. None is silently included in V1.

## 13. Final completion report format

When implementation is finished, the handoff must report:

```text
Outcome:
- What now works end to end.

Verification:
- npm test: X passed
- npm run test:e2e: X passed
- npm run build: passed
- Real Sanverse proof: recorded successfully / exact blocker

Files:
- Main app entry
- Animation compiler
- Presentation player
- Asset/background modules
- README

Known limits:
- Truthful remaining rough edges.

Run:
1. cd exact-working-folder
2. npm install
3. configure optional .env.local
4. npm run dev
5. open displayed localhost URL
```

Do not report “complete” if the real save/reopen/offline/presentation recording proof has not passed.

## 14. Primary references

- Excalidraw repository and package installation: https://github.com/excalidraw/excalidraw
- Excalidraw imperative API: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api
- Excalidraw element `customData`: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/
- Excalidraw custom UI/render props: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/render-props
- Excalidraw export utilities: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export
- Existing animation reference: https://github.com/dai-shi/excalidraw-animate
- Iconify search API: https://iconify.design/docs/api/search.html
- Brandfetch developer registration: https://developers.brandfetch.com/register
- Pexels API: https://www.pexels.com/api/documentation/
- IMG.LY browser background removal and AGPL license: https://github.com/imgly/background-removal-js
