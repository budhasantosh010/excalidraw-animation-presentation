export type ExportFormat = 'excalidraw' | 'json' | 'png' | 'svg' | 'webm' | 'mp4'
export type ExportRange = 'all' | 'scene' | 'selection'

export type ExportOptions = {
  format: ExportFormat
  width: number
  height: number
  fps: number
  durationMs: number
  transparent: boolean
  range: ExportRange
}

const FORMATS: ExportFormat[] = ['excalidraw', 'json', 'png', 'svg', 'webm', 'mp4']
const RANGES: ExportRange[] = ['all', 'scene', 'selection']

const boundedInteger = (
  label: string,
  value: number,
  minimum: number,
  maximum: number,
) => {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Export ${label} must be between ${minimum} and ${maximum}.`)
  }
  return Math.round(value)
}

export const normalizeExportOptions = (
  options: ExportOptions,
): ExportOptions => {
  if (!FORMATS.includes(options.format)) throw new Error('Unsupported export format.')
  if (!RANGES.includes(options.range)) throw new Error('Unsupported export range.')
  return {
    format: options.format,
    width: boundedInteger('width', options.width, 64, 7680),
    height: boundedInteger('height', options.height, 64, 4320),
    fps: boundedInteger('frame rate', options.fps, 1, 60),
    durationMs: boundedInteger('duration', options.durationMs, 100, 600_000),
    transparent: Boolean(options.transparent),
    range: options.range,
  }
}

export const estimateExport = (options: ExportOptions) => {
  const frameCount = Math.ceil(options.durationMs / 1000 * options.fps)
  return {
    frameCount,
    rawFrameBytes: options.width * options.height * 4 * frameCount,
  }
}

export const validateExportSupport = (
  format: ExportFormat,
  isTypeSupported: (mimeType: string) => boolean = (mimeType) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType),
): { supported: boolean; mimeType?: string; reason?: string } => {
  if (format === 'webm') {
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find(isTypeSupported)
    return mimeType
      ? { supported: true, mimeType }
      : { supported: false, reason: 'WebM export is not supported by this browser.' }
  }
  if (format === 'mp4') {
    const mimeType = ['video/mp4;codecs=avc1.42E01E', 'video/mp4']
      .find(isTypeSupported)
    return mimeType
      ? { supported: true, mimeType }
      : {
          supported: false,
          reason: 'MP4 export is not supported by this browser. Export WebM instead.',
        }
  }
  return { supported: true }
}
