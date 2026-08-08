import type { BackgroundRemovalProgress } from './backgroundRemoval.ts'

export const removeImageBackground = async (
  _image: Blob | string,
  _onProgress?: (progress: BackgroundRemovalProgress) => void,
): Promise<Blob> => {
  throw new Error(
    'Background removal is available only in the local desktop version.',
  )
}
