import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'

import type { EditorSnapshot } from './Editor'

type UnknownRecord = Record<string, unknown>

export type McpAppProject = {
  filename: string
  revision: number
  summary: UnknownRecord
  snapshot: EditorSnapshot
}

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const parseMcpAppProject = (
  result: unknown,
  requestedFilename?: string,
): McpAppProject => {
  if (!isRecord(result)) throw new Error('Project result is missing.')

  const summary = result.structuredContent
  const meta = result._meta
  if (!isRecord(summary) || !isRecord(meta)) {
    throw new Error('Project summary or snapshot metadata is missing.')
  }

  const filename = meta.filename
  const revision = meta.revision
  const projectSnapshot = meta.projectSnapshot
  if (
    typeof filename !== 'string' ||
    !filename.endsWith('.excalidraw') ||
    !Number.isSafeInteger(revision) ||
    Number(revision) < 1
  ) {
    throw new Error('Project filename or revision is invalid.')
  }
  if (requestedFilename && filename !== requestedFilename) {
    throw new Error('Project filename does not match requested filename.')
  }
  if (
    summary.filename !== filename ||
    summary.revision !== revision ||
    !isRecord(projectSnapshot) ||
    projectSnapshot.type !== 'excalidraw' ||
    !Array.isArray(projectSnapshot.elements) ||
    !isRecord(projectSnapshot.appState) ||
    !isRecord(projectSnapshot.files)
  ) {
    throw new Error('Project snapshot is invalid or does not match its summary.')
  }

  const elements = projectSnapshot.elements as Array<
    ExcalidrawElement & { type: string; isDeleted?: boolean }
  >
  const drawableElements = elements.filter(
    (element) => !element.isDeleted && element.type !== 'frame',
  )
  if (!drawableElements.length) {
    throw new Error('Project snapshot contains no drawable elements.')
  }

  const frame = elements.find(
    (element) => !element.isDeleted && element.type === 'frame',
  )
  return {
    filename,
    revision: Number(revision),
    summary,
    snapshot: {
      elements,
      appState: projectSnapshot.appState as Partial<AppState>,
      files: projectSnapshot.files as BinaryFiles,
      frameId: frame?.id ?? null,
    },
  }
}
