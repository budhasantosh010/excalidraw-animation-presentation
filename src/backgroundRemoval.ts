export type BackgroundRemovalProgress = {
  asset: string
  current: number
  total: number
  percent: number
}

export const removeImageBackground = async (
  image: Blob | string,
  onProgress?: (progress: BackgroundRemovalProgress) => void,
): Promise<Blob> => {
  const { removeBackground } = await import('@imgly/background-removal')

  return removeBackground(image, {
    output: { format: 'image/png' },
    progress: (asset, current, total) => {
      onProgress?.({
        asset,
        current,
        total,
        percent: total > 0 ? Math.round((current / total) * 100) : 0,
      })
    },
  })
}
