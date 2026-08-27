import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ExportPanel } from './ExportPanel'

describe('ExportPanel', () => {
  it('offers source, still, video, progress, and cancellation controls', () => {
    const markup = renderToStaticMarkup(
      <ExportPanel
        getSnapshot={() => ({ elements: [], appState: {}, files: {} })}
        onClose={() => undefined}
      />,
    )

    expect(markup).toContain('Animated Excalidraw')
    expect(markup).toContain('PNG')
    expect(markup).toContain('SVG')
    expect(markup).toContain('WebM video')
    expect(markup).toContain('MP4 (when supported)')
    expect(markup).toContain('Download')
    expect(markup).toContain('Cancel')
  })
})
