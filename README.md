# Sanverse Animated Excalidraw

A local, personal video-presentation tool built on the official Excalidraw React component. Draw normally, assign reveal steps, then play the scene in a separate read-only presentation view while recording your screen.

## Install on another laptop

Requires Git and Node.js 20.19 or newer. Clone the repository, install the exact locked dependencies, and start the local app:

```powershell
git clone git@github.com:budhasantosh010/excalidraw-animation-presentation.git
cd excalidraw-animation-presentation
npm ci
npm run dev
```

If SSH is not configured on the new laptop, clone with `https://github.com/budhasantosh010/excalidraw-animation-presentation.git` instead. Open the local URL printed by Vite (normally `http://localhost:5173`). No API key is required for the editor, presentations, image upload, or Iconify search.

## 60-second workflow

1. Draw a title, shapes, arrows, and labels in Excalidraw.
2. Optionally click **Add 16:9 frame** to create a video-sized scene.
3. Select one element, leave the effect on **Auto**, then click **Assign + next**. Auto gives shapes and images a scale-plus-fade entrance, fades text, and draws arrows, lines, and freehand strokes. Connected and bound objects keep independent steps; multi-select objects only when you intentionally want them on the same step.
4. Repeat for the remaining steps. Colored canvas badges and the Sequence panel show the order. Use the explicit effect menu only when you want to override Auto.
5. Click **Present**, then **Play**. Choose a playback speed, press Space to play/pause, or use Left/Right Arrow for manual stepping. Fullscreen and record with OBS or Windows Game Bar.
6. Click **Save** to keep the drawing, animation metadata, and referenced images in an `.excalidraw` file. Use **Open** to restore it later.

With frames, **Present** plays the selected frame, or the first frame when none is selected. With no frames it plays the whole canvas. Move inserted assets into a frame so they are attached to that frame and included in its presentation.

## Images and logos

Open **Assets** in the upper-right corner. The custom uploader accepts PNG, JPEG, WebP, and GIF raster images up to 12 MB and 25 megapixels. You can also paste images directly onto the Excalidraw canvas, where Excalidraw handles them through its own native path. A newly inserted image is not automatically attached to a frame; move or group it into the frame when needed.

Search Iconify without an account or API key, then click a result to insert its validated SVG on the canvas. Iconify aggregates many icon sets with different licenses, so check the chosen set's license before publishing a video or other work.

Select exactly one image and click **Remove background** to run background removal locally in the browser. The first removal downloads model and WebAssembly assets and can be slow; later runs benefit from the browser cache. If model download or browser execution fails, the editor remains usable and reports a retry/external-remover fallback.

## What this morning build includes

- Full Excalidraw editor
- Ordered reveal steps assigned independently per selected object, including connected and bound objects
- Separate read-only presentation player
- Auto effect selection, fade/pop/draw-on/appear effects, autoplay speed controls, keyboard navigation, fullscreen, and 16:9 framing
- Save/open with versioned animation metadata and referenced image files
- Local image insertion, zero-signup Iconify search, and optional in-browser background removal

Current limitations: no arbitrary keyframe/timeline editor, path-motion animation, audio synchronization, direct video export, Pexels/Brandfetch integration, or hosted collaboration. Draw-on applies to arrows, lines, and freehand strokes; shapes and text use entrance effects. Screen recording is the intended export path. Icon search and the first background-removal run require an internet connection.

## License note

Excalidraw is MIT-licensed. `@imgly/background-removal` 1.7.0 is distributed under the GNU Affero General Public License v3 (AGPL-3.0). This build is intended for local personal use. Redistribution, modification for distribution, or hosted/network use requires a license-compliance review; this note is not legal advice.

## Checks

```powershell
npm run test -- --run
npm run lint
npx tsc -b --pretty false
npm run build
```
