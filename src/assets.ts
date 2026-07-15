import {
  convertToExcalidrawElements,
  getDataURL,
} from '@excalidraw/excalidraw'
import type { FileId } from '@excalidraw/excalidraw/element/types'
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types'

const SUPPORTED_RASTER_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_IMAGE_PIXELS = 25_000_000
const MAX_IMAGE_DIMENSION = 16_384
const MAX_IMAGE_WIDTH = 600
const MAX_IMAGE_HEIGHT = 450

type ImageIngestionOptions = {
  allowSvg?: boolean
}

export type IconifyResult = {
  id: string
  url: string
}

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')

const createFileId = async (file: Blob): Promise<FileId> => {
  const digest = await crypto.subtle.digest('SHA-1', await file.arrayBuffer())
  return toHex(digest) as FileId
}

const validateImageBlob = (
  file: File | Blob,
  { allowSvg = false }: ImageIngestionOptions = {},
) => {
  if (file.size === 0) throw new Error('The image file is empty.')
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`Images must be 12 MB or smaller (this file is ${(file.size / 1024 / 1024).toFixed(1)} MB).`)
  }
  if (!SUPPORTED_RASTER_TYPES.has(file.type) && !(allowSvg && file.type === 'image/svg+xml')) {
    throw new Error('Choose a PNG, JPEG, WebP, or GIF image (12 MB maximum).')
  }
}

const getImageDimensions = (file: File | Blob) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const objectURL = URL.createObjectURL(file)
    const image = new Image()
    const cleanup = () => {
      image.onload = null
      image.onerror = null
      URL.revokeObjectURL(objectURL)
    }
    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight }
      cleanup()
      if (
        dimensions.width < 1 ||
        dimensions.height < 1 ||
        dimensions.width > MAX_IMAGE_DIMENSION ||
        dimensions.height > MAX_IMAGE_DIMENSION ||
        dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
      ) {
        reject(new Error('Images must be 25 megapixels or smaller, with sane dimensions.'))
        return
      }
      resolve(dimensions)
    }
    image.onerror = () => {
      cleanup()
      reject(new Error('The image could not be decoded.'))
    }
    image.src = objectURL
  })

const fitImage = (width: number, height: number) => {
  const ratio = Math.min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height, 1)
  return {
    width: Math.max(1, width * ratio),
    height: Math.max(1, height * ratio),
  }
}

export const createBinaryFileData = async (
  file: File | Blob,
  options: ImageIngestionOptions = {},
): Promise<BinaryFileData> => {
  validateImageBlob(file, options)

  return {
    id: await createFileId(file),
    dataURL: await getDataURL(file),
    mimeType: file.type as BinaryFileData['mimeType'],
    created: Date.now(),
    lastRetrieved: Date.now(),
  }
}

export const insertImageFile = async (
  api: ExcalidrawImperativeAPI,
  file: File | Blob,
  options: ImageIngestionOptions = {},
) => {
  validateImageBlob(file, options)
  const natural = await getImageDimensions(file)
  const binaryFile = await createBinaryFileData(file, options)
  const size = fitImage(natural.width, natural.height)
  const appState = api.getAppState()
  const zoom = appState.zoom.value || 1
  const centerX = -appState.scrollX + appState.width / zoom / 2
  const centerY = -appState.scrollY + appState.height / zoom / 2
  const [element] = convertToExcalidrawElements(
    [
      {
        type: 'image',
        x: centerX - size.width / 2,
        y: centerY - size.height / 2,
        width: size.width,
        height: size.height,
        fileId: binaryFile.id,
        status: 'saved',
        scale: [1, 1],
        crop: null,
      },
    ],
    { regenerateIds: true },
  )

  if (!element) throw new Error('The image element could not be created.')

  const elements = [...api.getSceneElements(), element]
  api.addFiles([binaryFile])
  api.updateScene({
    elements,
    appState: { selectedElementIds: { [element.id]: true } },
  })
  requestAnimationFrame(() => {
    api.scrollToContent([element], { fitToContent: false, animate: false })
  })

  return { element, binaryFile }
}

const parseIconId = (value: unknown): IconifyResult | null => {
  if (typeof value !== 'string') return null
  const match = /^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/i.exec(value)
  if (!match) return null
  const [, prefix, name] = match
  return {
    id: `${prefix}:${name}`,
    url: `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`,
  }
}

export const searchIconify = async (
  query: string,
  signal?: AbortSignal,
): Promise<IconifyResult[]> => {
  const normalized = query.trim()
  if (!normalized) throw new Error('Enter a logo or icon name.')

  const response = await fetch(
    `https://api.iconify.design/search?query=${encodeURIComponent(normalized)}&limit=24`,
    { signal },
  )
  if (!response.ok) throw new Error(`Icon search failed (${response.status}).`)

  const body = (await response.json()) as { icons?: unknown }
  if (!Array.isArray(body.icons)) throw new Error('Icon search returned an invalid response.')
  return body.icons.map(parseIconId).filter((icon): icon is IconifyResult => Boolean(icon)).slice(0, 24)
}

export const fetchIconifyFile = async (icon: IconifyResult): Promise<File> => {
  const validated = parseIconId(icon.id)
  if (!validated || validated.url !== icon.url) throw new Error('That icon id is invalid.')

  const response = await fetch(validated.url)
  if (!response.ok) throw new Error(`Icon download failed (${response.status}).`)
  const blob = await response.blob()
  const contentType = response.headers.get('content-type') ?? blob.type
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'image/svg+xml') {
    throw new Error('Iconify did not return an SVG image.')
  }
  const file = new File([blob], `${validated.id.replace(':', '-')}.svg`, {
    type: 'image/svg+xml',
  })
  validateImageBlob(file, { allowSvg: true })
  return file
}
