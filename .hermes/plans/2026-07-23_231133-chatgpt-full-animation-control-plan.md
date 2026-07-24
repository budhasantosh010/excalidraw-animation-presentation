# ChatGPT Full Excalidraw Animation Control — Revised Lean Plan

## Planning Status

Phase 1 approved for implementation. Phases 2 through 5 remain unapproved.

## Approved Phase 1 Clarifications

- ChatGPT does not automatically see or inspect the rendered pixels. The user
  visually inspects the embedded board, ChatGPT reads structured project state,
  and the user tells ChatGPT what to change.
- `create_animation` and `open_animation_studio` must each return the filename,
  revision, concise structured project summary, complete widget-only project
  snapshot, and UI resource URI.
- The widget loads that exact snapshot and revision immediately without a file
  picker. Missing, invalid, or blank project data produces an explicit error
  instead of a silently successful blank canvas.

## Goal

The existing Animation MCP needs exactly three capabilities:

1. Give ChatGPT complete deterministic control over the Excalidraw project.
2. Give ChatGPT complete control over animation scenes, steps and effects.
3. Load the real existing editor/player directly inside ChatGPT through an MCP
   App resource served by the existing MCP server on port `3002`.

Nothing else is part of this phase.

## Explicit Non-Goals

Do not add:

- automatic visual verification
- browser screenshots or preview submission
- visual grading
- technical scoring
- automatic correction loops
- Playwright
- Puppeteer
- image generation
- image-control tools
- `finalize_animation`
- a visual finalization gate
- a second application
- a second MCP server
- a second public endpoint
- a public port `5173` or `5199` requirement
- a separate Vite development server during normal ChatGPT use

The user can inspect the actual embedded editor/player and tell ChatGPT what to
change. Visual judgment remains conversational and is not implemented inside
the MCP.

## Current State to Preserve

- Existing standalone React + Excalidraw application.
- Existing animation metadata:

  `customData.sanverseAnimation`

- Existing effects:

  `auto`, `appear`, `fade`, `pop`, `draw`

- Connected elements can retain independent steps.
- Existing TypeScript MCP server.
- Existing localhost binding:

  `127.0.0.1:3002`

- Existing secret MCP route.
- Existing Host validation and `MCP_ALLOWED_HOSTS`.
- Existing Origin policy:
  - missing Origin allowed
  - `https://chatgpt.com` allowed
  - `https://chat.openai.com` allowed
  - other present Origins rejected
- Existing Tailscale Funnel.
- Existing atomic/path-confined project storage.
- Existing standalone application behavior.

## Narrow Architecture

```text
User describes an animation in ChatGPT
        |
        v
ChatGPT calls create_animation
        |
        v
Existing MCP writes a real .excalidraw project
        |
        +--> returns nonzero scene/object/step counts
        |
        v
Same tool result points to the MCP App resource
        |
        v
Existing editor/player renders directly inside ChatGPT
        |
        +--> user can Play/Pause/Previous/Next/Restart
        +--> user can manually edit the board
        |
        v
ChatGPT calls get_animation and revise_animation
        |
        v
Same embedded UI reloads the new project revision
        |
        v
Manual UI edits are persisted through save_animation_snapshot
```

There is one runtime process:

```text
Existing MCP server
127.0.0.1:3002
```

The same server exposes:

- the MCP tools
- one MCP App UI resource
- the bundled existing editor/player
- the project files

The UI resource is:

```text
ui://sanverse/animation-studio-v1.html
```

Use the official MCP Apps package:

```text
@modelcontextprotocol/ext-apps
```

No separate local application is started for normal ChatGPT use.

## Final Tool Set

### Model-visible tools

#### 1. `get_animation_status`

Purpose:

- prove the Animation MCP is loaded
- tell ChatGPT exactly what it can do

Returns:

- server health
- schema version
- complete model-visible tool names
- supported element types
- supported animation effects
- supported revision-operation types
- whether the MCP App UI resource is registered
- the UI resource URI

This tool does not solve connector discovery by itself because it cannot be
called until the connector is loaded. ChatGPT must first discover/load the
connector instead of interpreting “not currently loaded” as “unavailable.”

#### 2. `list_animations`

Returns each saved project with:

- filename
- project name
- revision
- scene count
- drawable element count
- animated element count
- step count
- last modified time

Frames must not be counted as drawable content.

#### 3. `get_animation`

Purpose:

Give ChatGPT the exact current state before it performs precise edits.

Inputs:

- `filename`
- `detail`: `summary | full`

Returns:

- revision
- project name
- scenes and scene order
- element IDs
- element types
- geometry
- rotation
- text
- style
- group IDs
- frame membership
- layer order
- arrow/line bindings
- text/container bindings
- animation scene, step and effect
- resolved effect when the stored effect is `auto`

ChatGPT must call this before dependent revisions when it does not already have
the latest revision and element IDs.

#### 4. `create_animation`

Creates the initial complete project.

Inputs:

- project name
- `creativeMode`
- ordered scenes
- drawable elements
- coordinates and dimensions
- text
- styles
- connections
- layer order
- animation steps
- animation effects

Supported `creativeMode` values:

- `exact`
  - follow the request literally
- `clean`
  - improve spacing, alignment and readability
- `expressive`
  - add hierarchy, zones, visual flow and supporting objects
- `full`
  - let ChatGPT control the overall composition, visual hierarchy, supporting
    objects, colors, layout, camera flow and animation sequence while
    preserving explicit user requirements

The MCP does not provide creative reasoning. ChatGPT provides the reasoning;
the MCP provides deterministic controls capable of expressing it.

`create_animation` must attach:

```text
ui://sanverse/animation-studio-v1.html
```

The ChatGPT host then renders the created project inside the conversation.

The tool returns:

- filename
- revision
- scene count
- drawable element count
- total serialized element count
- animated element count
- step count
- effect counts
- UI resource URI
- `uiResourceAttached`

It must not return `uiOpened: true` merely because the resource was attached.
Only the ChatGPT host and a visible populated widget prove that the UI opened.

#### 5. `revise_animation`

One atomic batch-operation tool that gives ChatGPT full board and animation
control.

Required inputs:

- `filename`
- `baseRevision`
- `idempotencyKey`
- `operations[]`

Every call either applies all operations or none of them.

Every successful call increments the project revision.

##### Project and scene operations

- `rename_project`
- `add_scene`
- `update_scene`
- `delete_scene`
- `duplicate_scene`
- `reorder_scenes`
- `set_scene_background`
- `set_scene_camera`
- `set_scene_padding`

##### Element creation and removal

- `add_element`
- `update_element`
- `delete_element`
- `duplicate_element`

Supported element types:

- `rectangle`
- `ellipse`
- `diamond`
- `text`
- `arrow`
- `line`
- `freedraw`
- `frame`

Images and image generation remain excluded.

##### Geometry operations

- `move_element`
- `resize_element`
- `rotate_element`
- `translate_elements`
- `scale_elements`
- `mirror_elements`
- `align_elements`
- `distribute_elements`

##### Style and text operations

- `set_element_style`
- `set_element_text`
- `set_font_properties`
- `set_text_alignment`
- `set_roundness`

Only real Excalidraw properties supported by the installed Excalidraw version
may be accepted.

##### Layer and grouping operations

- `bring_forward`
- `send_backward`
- `bring_to_front`
- `send_to_back`
- `group_elements`
- `ungroup_elements`
- `set_frame_membership`
- `remove_frame_membership`

##### Connection and path operations

- `connect_elements`
- `disconnect_element`
- `set_arrowheads`
- `set_element_points`
- `set_freedraw_points`
- `set_line_elbow`
- `bind_text_to_container`
- `unbind_text_from_container`

##### Animation operations

- `set_animation_step`
- `set_animation_effect`
- `clear_animation`
- `insert_step`
- `delete_step`
- `move_step`
- `renumber_steps`
- `set_scene_sequence`

Supported effects remain:

- `appear`
- `fade`
- `pop`
- `draw`
- `auto`

Do not add duration, delay or easing metadata unless the existing real
animation renderer first supports and consumes it.

Connected elements retain independent animation steps. Binding an arrow to a
shape must not force the arrow and shape onto one step.

#### 6. `validate_animation`

Deterministic technical validation only.

Inputs:

- `filename`
- optional expected revision

Checks:

- valid Excalidraw file structure
- valid project metadata
- valid unique element IDs
- referenced element IDs exist
- valid arrow and line bindings
- valid text/container bindings
- valid frame and scene membership
- finite positions, dimensions, rotation and path points
- supported element types
- valid `customData.sanverseAnimation`
- valid integer step assignments
- supported animation effects
- effect compatibility with element type
- label/container animation consistency
- connected-element step independence
- nonempty drawable content when the project is supposed to contain a drawing

Returns:

- `valid`
- errors
- warnings
- revision
- scene count
- drawable element count
- animated element count
- step count
- effect counts

It does not:

- capture screenshots
- grade visual quality
- submit browser reports
- automatically correct the project
- block saving based on aesthetic judgment

#### 7. `open_animation_studio`

Opens or reopens an existing project inside ChatGPT.

Inputs:

- `filename`
- optional scene ID
- optional initial animation step

Uses:

```text
ui://sanverse/animation-studio-v1.html
```

Returns:

- concise structured project summary for ChatGPT
- full project snapshot for the widget through `_meta`
- revision
- UI resource URI
- `uiResourceAttached`

The embedded studio must:

- reuse the existing React, Excalidraw and animation renderer
- load the project without a file picker
- show the real editable canvas
- show the real player
- include Play
- include Pause
- include Previous
- include Next
- include Restart
- update when a newer project revision is returned
- show an explicit loading or parsing error instead of a silent blank canvas
- preserve normal standalone behavior

### App-only tool

#### 8. `save_animation_snapshot`

Hidden from the model:

```json
{
  "_meta": {
    "ui": {
      "visibility": ["app"]
    }
  }
}
```

Purpose:

Persist manual edits made inside the embedded editor.

Inputs:

- filename
- base revision
- idempotency key
- complete editor snapshot:
  - elements
  - app state required by the project format
  - files map, expected to remain empty in this phase

Behavior:

- validate the snapshot
- reject stale revisions
- write atomically
- increment the revision
- return new revision and project counts

Without this tool, a manual move or edit in the embedded UI could disappear
when ChatGPT performs the next revision.

## Full-Control Rules

### Stable IDs

Every project, scene and element needs a stable ID.

ChatGPT references IDs rather than canvas coordinates alone.

### Strict revisions

```text
create_animation
-> revision 1

get_animation
-> revision 1

revise_animation baseRevision 1
-> revision 2

save_animation_snapshot baseRevision 2
-> revision 3
```

Rules:

- creation starts at revision 1
- every write requires the current base revision
- every successful write increments the revision
- stale revisions are rejected
- a revision preserves all existing content unless an explicit delete,
  replacement or reorder operation says otherwise
- writes remain temporary-file + atomic-replacement operations
- repeated idempotency keys return the original result without applying the
  mutation twice

This replaces fragile checkpoint-style state guessing.

### Large animations

Large projects may be constructed over several calls:

```text
create_animation -> revision 1
get_animation -> revision 1
revise_animation -> revision 2
revise_animation -> revision 3
```

Each revision carries the previous state forward.

If a request is too large for one reliable tool call, ChatGPT should split it
into smaller batches without recreating or replacing the project.

## Preventing the Previous Excalidraw Failures

### Failure 1: “Not loaded” was treated as “unavailable”

Incorrect:

```text
Tool is not in the active tool list
-> declare Excalidraw unavailable
```

Required recovery:

```text
Tool is not in the active tool list
-> discover/load the Animation MCP
-> inspect the exposed resources and tools
-> call get_animation_status
-> continue
```

Plan requirements:

- `get_animation_status` returns the complete capability list once loaded
- the live ChatGPT test begins with explicit connector/tool discovery
- reconnect or refresh the connector after the tool list changes
- absence from one active tool list is never accepted as proof that the
  configured connector no longer exists

### Failure 2: “Saved state” was treated as “visible drawing”

A filename, revision, checkpoint or success response proves only that state was
saved. It does not prove the board contains drawable objects.

Required protections:

- reject zero drawable elements when drawable content was requested
- count frames separately from drawable objects
- return:
  - scene count
  - drawable element count
  - total serialized element count
  - animated element count
  - step count
  - effect counts
- reject unknown referenced IDs
- reject a requested animation with zero assigned animation steps
- attach the real populated project snapshot to the UI resource
- show an explicit UI loading error rather than an apparently successful blank
  canvas

The live proof is:

```text
nonzero drawable element count
+
nonzero animation step count when animation was requested
+
real embedded editor visibly contains the objects
```

The following is not sufficient:

```text
tool returned success
```

## Files Likely to Change During Implementation

Only after execution is approved:

- `mcp/server.ts`
  - register seven model-visible tools
  - register one app-only tool
  - register and attach the MCP App UI resource
  - return structured content and widget `_meta`
  - preserve security middleware

- `mcp/animation-tools.ts`
  - project reads
  - strict scene/element schemas
  - full atomic operation engine
  - revisions and idempotency
  - technical validation
  - nonempty-board safeguards

- `mcp/server.test.ts`
  - exact tool contract
  - UI resource metadata
  - create/get/revise/validate/open/save flow
  - Host and Origin regression coverage

- `src/Editor.tsx`
  - accept an MCP-supplied project snapshot
  - preserve standalone file-open behavior
  - expose manual snapshots to the MCP App bridge

- `src/Presentation.tsx`
  - reuse the existing player in embedded mode
  - preserve existing animation behavior

- `src/App.tsx`
  - select standalone or MCP App mode

- `src/projectFile.ts`
  - support revision-preserving project load/save if required

- `src/animation.ts`
  - shared helpers only if required
  - no new animation metadata unless the real player consumes it

- `package.json`
  - add the official MCP Apps dependency and build entry only when execution is
    approved
  - no browser-automation dependency

Possible small files inside this same application:

- `src/mcp-app/AnimationStudioBridge.tsx`
- `src/mcp-app/openai.d.ts`

No new repository, external service or separate application.

## Revised Implementation Phases

### Phase 1 — Minimal real inline UI proof

Build only:

- official MCP App dependency
- `ui://sanverse/animation-studio-v1.html`
- attach the UI resource to `create_animation`
- add `open_animation_studio`
- load the actual project without a file picker
- Play
- Pause
- Previous
- Next
- Restart

First live gate:

1. Discover/load the Animation MCP in ChatGPT.
2. Call `get_animation_status`.
3. Call `create_animation` with real drawable elements and animation metadata.
4. Confirm the tool returns:
   - nonzero drawable element count
   - nonzero animated element count
   - nonzero step count
5. Confirm the real editor/player appears inline in ChatGPT.
6. Confirm the canvas visibly contains the expected objects.
7. Confirm Play, Pause, Previous, Next and Restart work.
8. Confirm the generated file still opens in the standalone application.

Do not proceed if the tool returns success but the inline canvas is blank.

### Phase 2 — Full board and project control

Add:

- `get_animation`
- strict project, scene and element schemas
- project/scene operations
- element CRUD
- geometry operations
- text and style operations
- layer operations
- grouping
- frame membership
- connections
- path control
- atomic revisions
- idempotency

Gate:

- create -> get -> multi-operation revise -> get round-trip
- all pre-existing elements remain unless explicitly deleted
- stale revisions are rejected
- large projects can be extended through multiple calls
- empty-board success is impossible for drawable requests

### Phase 3 — Full animation control

Add:

- assign step
- change step
- clear animation
- insert step
- delete step
- move step
- renumber steps
- set scene sequence
- set effects
- change effects
- deterministic technical validation

Gate:

- connected elements retain independent steps
- bound labels remain consistent with containers
- `auto`, `appear`, `fade`, `pop` and `draw` work through the existing player
- step mutations preserve unrelated elements and scenes
- invalid metadata fails without changing the file

### Phase 4 — Persist manual embedded-editor changes

Add:

- app-only `save_animation_snapshot`
- revision-aware save from the embedded editor
- automatic UI refresh after ChatGPT revisions
- explicit stale-edit conflict messages

Gate:

1. Move or edit an object manually inside ChatGPT.
2. Save the snapshot.
3. Ask ChatGPT to revise a different object.
4. Confirm the manual edit remains.
5. Confirm the standalone project contains both changes.

### Phase 5 — Live complete ChatGPT proof

Request:

> Create a full-creative animated Excalidraw explanation of how an AI agent
> turns a prompt into an output. Use at least eight drawable objects, connected
> arrows, independent reveal steps, all supported effects, and at least six
> animation steps. Open the editor inside ChatGPT after creation.

Manually verify:

- connector/tools were discovered
- the board is visibly populated
- all expected objects exist
- animation steps are assigned
- effects are assigned
- Play/Pause/Previous/Next/Restart work
- ChatGPT can read the exact project state
- ChatGPT can add, update, delete, move, style, group and connect objects
- ChatGPT can change steps and effects
- manual UI edits persist
- the `.excalidraw` file opens in the standalone app
- existing application and MCP tests pass

No automatic screenshot or visual-grading system is added.

## Test Plan

### Unit tests

- every `revise_animation` operation
- schema rejection for unsupported properties
- stable IDs
- revisions
- stale-revision rejection
- idempotent retries
- atomic rollback
- scene ordering
- geometry transforms
- layer ordering
- grouping
- frame membership
- connections and bindings
- path points
- step insertion/deletion/movement/renumbering
- effect assignment and resolution
- zero-drawable-element rejection
- nonzero result counts

### MCP integration tests

- initialize
- exact seven model-visible tools
- app-only save tool with app-only metadata
- `get_animation_status`
- list/create/get/revise/validate/open/save
- UI resource registration
- UI resource attached to create/open
- secret route preserved
- Host validation preserved
- missing/allowed/disallowed Origin behavior preserved
- public Funnel connection

### Application tests

- standalone editor unchanged
- embedded mode loads a supplied project without a file picker
- populated snapshot renders as populated canvas
- invalid snapshot shows an explicit error
- player controls work in embedded mode
- manual snapshot save preserves edits

### Live acceptance

The final acceptance test happens in the connected ChatGPT app because only the
ChatGPT host can prove that the MCP App resource actually renders inline.

The live test is manual/conversational. It does not require an automated visual
verification system.

## Risks and Controls

### Tool-list change requires connector refresh

Adding tools/resources may require refreshing or reconnecting the ChatGPT
connector.

Control:

- document the exact refresh step
- rediscover tools before declaring the connector unavailable

### Tool overload

Full control includes many operation types.

Control:

- keep one batch `revise_animation` tool
- use a strict discriminated union for operations
- expose the current state through `get_animation`
- keep tool descriptions concise

### Stale model state

ChatGPT may revise an older snapshot.

Control:

- require `baseRevision`
- reject stale writes
- require `get_animation` before dependent edits

### Blank canvas despite a successful response

Control:

- separate frame count from drawable element count
- reject empty drawable output when drawing was requested
- return explicit counts
- show UI load failures
- require visible inline population in the Phase 1 gate

### Standalone and embedded editors drift

Control:

- share the same React, Excalidraw, project-file and animation functions
- do not create a separate editor implementation

## Genuine Blockers

No blocker prevents planning.

Implementation has two external acceptance dependencies:

1. The installed ChatGPT surface must support the official MCP Apps UI resource
   and render it for this custom connector.
2. After adding tools/resources, the connector may need to be refreshed or
   reconnected before ChatGPT discovers the new surface.

These are live acceptance conditions, not reasons to build a second server or
external browser system.

## Definition of Done

The project is complete only when ChatGPT can:

1. Discover the Animation MCP instead of treating an unloaded tool as
   unavailable.
2. Create a nonempty animated Excalidraw project.
3. Receive truthful nonzero scene, drawable-element, animated-element, step and
   effect counts.
4. Open the real existing editor/player directly inside ChatGPT.
5. Read every supported scene and element.
6. Add, update, delete, duplicate, transform, style, group, layer and connect
   supported objects.
7. Assign, clear, insert, delete, move and renumber animation steps.
8. Assign and change `auto`, `appear`, `fade`, `pop` and `draw`.
9. Save manual embedded-editor changes.
10. Preserve all prior work across revision calls.
11. Open the resulting `.excalidraw` file in the standalone application.

No MCP-owned visual verification, image generation, browser automation, second
application or second server is part of completion.
