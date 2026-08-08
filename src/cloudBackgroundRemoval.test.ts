import { expect, it } from 'vitest'

import { removeImageBackground } from './cloudBackgroundRemoval.ts'

it('fails clearly instead of shipping AGPL background removal in the hosted site', async () => {
  await expect(
    removeImageBackground(new Blob(['image'], { type: 'image/png' })),
  ).rejects.toThrow(/local desktop version/i)
})
