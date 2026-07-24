import { useState } from 'react'
import '@excalidraw/excalidraw/index.css'
import './App.css'
import { Editor, type EditorSnapshot } from './Editor'
import { Presentation } from './Presentation'
import { useControllerPlacement } from './useControllerPlacement'

function App() {
  const [presentationSnapshot, setPresentationSnapshot] =
    useState<EditorSnapshot | null>(null)
  const controllerPlacement = useControllerPlacement()

  return (
    <>
      <div
        className={`editor-layer${presentationSnapshot ? ' editor-layer--presenting' : ''}`}
        aria-hidden={presentationSnapshot ? true : undefined}
        // React 18 renders inert={false} as a present (thus active) attribute;
        // only set it while presenting.
        {...(presentationSnapshot ? { inert: '' } : {})}
      >
        <Editor
          controllerPlacement={controllerPlacement}
          onPresent={setPresentationSnapshot}
        />
      </div>

      {presentationSnapshot ? (
        <Presentation
          controllerPlacement={controllerPlacement}
          snapshot={presentationSnapshot}
          onExit={() => setPresentationSnapshot(null)}
        />
      ) : null}
    </>
  )
}

export default App
