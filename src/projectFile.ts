import { loadFromBlob, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'

export const serializeProject = (
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
): string => serializeAsJSON(elements, appState, files, 'local')

export const filterReferencedFiles = (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): BinaryFiles => {
  const referencedFileIds = new Set<string>()
  for (const element of elements) {
    if (!element.isDeleted && element.type === 'image' && element.fileId) {
      referencedFileIds.add(element.fileId)
    }
  }

  return Object.fromEntries(
    Object.entries(files).filter(([fileId]) => referencedFileIds.has(fileId)),
  ) as BinaryFiles
}

const assertLooksLikeProject = (text: string) => {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray((data as { elements?: unknown }).elements)
  ) {
    throw new Error('That file does not contain an Excalidraw scene.')
  }
}

export const loadProjectFile = async (
  file: File,
  localAppState: AppState,
  localElements: readonly ExcalidrawElement[],
) => {
  if (!/\.(excalidraw|json)$/i.test(file.name)) {
    throw new Error('Choose an .excalidraw or .json file.')
  }

  assertLooksLikeProject(await file.text())
  return loadFromBlob(file, localAppState, localElements)
}
