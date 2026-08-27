import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SequencePanel } from './SequencePanel'

describe('collapsible sequence panel', () => {
  it('shows the sequence and a minimize action while expanded', () => {
    const markup = renderToStaticMarkup(
      <SequencePanel collapsed={false} onCollapsedChange={() => undefined}>
        <span>Step 1</span>
      </SequencePanel>,
    )

    expect(markup).toContain('Reveal sequence')
    expect(markup).toContain('Step 1')
    expect(markup).toContain('Minimize sequence panel')
    expect(markup).not.toContain('Open sequence panel')
  })

  it('returns the canvas area and leaves a reachable reopen action', () => {
    const markup = renderToStaticMarkup(
      <SequencePanel collapsed onCollapsedChange={() => undefined}>
        <span>Step 1</span>
      </SequencePanel>,
    )

    expect(markup).not.toContain('Reveal sequence')
    expect(markup).not.toContain('Step 1')
    expect(markup).toContain('Open sequence panel')
  })
})
