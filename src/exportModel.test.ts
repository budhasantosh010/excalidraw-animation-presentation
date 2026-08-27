import { describe, expect, it } from 'vitest'

import {
  estimateExport,
  normalizeExportOptions,
  validateExportSupport,
} from './exportModel'

describe('export contract', () => {
  it('normalizes a bounded YouTube export', () => {
    expect(normalizeExportOptions({
      format: 'webm',
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 4000,
      transparent: false,
      range: 'all',
    })).toEqual({
      format: 'webm',
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 4000,
      transparent: false,
      range: 'all',
    })
  })

  it('rejects unsafe dimensions and durations before export starts', () => {
    expect(() => normalizeExportOptions({
      format: 'png',
      width: 9000,
      height: 1080,
      fps: 30,
      durationMs: 4000,
      transparent: false,
      range: 'all',
    })).toThrow('width')
    expect(() => normalizeExportOptions({
      format: 'webm',
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 900_000,
      transparent: false,
      range: 'all',
    })).toThrow('duration')
  })

  it('estimates deterministic frame and raw-memory totals', () => {
    expect(estimateExport(normalizeExportOptions({
      format: 'webm',
      width: 1280,
      height: 720,
      fps: 30,
      durationMs: 2000,
      transparent: false,
      range: 'scene',
    }))).toEqual({ frameCount: 60, rawFrameBytes: 221_184_000 })
  })

  it('reports MP4 truthfully when no supported recorder is available', () => {
    expect(validateExportSupport('mp4', () => false)).toEqual({
      supported: false,
      reason: 'MP4 export is not supported by this browser. Export WebM instead.',
    })
  })
})
