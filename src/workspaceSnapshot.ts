import type { PersistedProjectRecord } from '../mcp/persistence/contracts.ts'

export const parseWorkspaceSnapshot = (
  serialized: string,
): PersistedProjectRecord['snapshot'] => {
  const parsed = JSON.parse(serialized) as unknown
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { elements?: unknown }).elements)
  ) {
    throw new Error('The editor did not produce a valid Excalidraw snapshot.')
  }
  return {
    ...(parsed as PersistedProjectRecord['snapshot']),
    source: 'local',
  }
}
