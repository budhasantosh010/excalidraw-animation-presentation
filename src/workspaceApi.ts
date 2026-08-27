import type { PersistedProjectRecord } from '../mcp/persistence/contracts.ts'

export type WorkspaceRecord = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type ProjectSummary = {
  workspaceId: string
  projectId: string
  name: string
  currentRevision: number
  createdAt: string
  updatedAt: string
  trash: { state: 'active' } | { state: 'trashed'; id: string; trashedAt: string }
}

export type RevisionPreview = {
  revisionNumber: number
  source: string
  label: string | null
  createdAt: string
  isCurrent: boolean
  elementCount: number
  animatedElementCount: number
  stepCount: number
  assetCount: number
}

const request = async <Result>(path: string, init?: RequestInit) => {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body
      ? { 'Content-Type': 'application/json', ...init.headers }
      : init?.headers,
  })
  const body = (await response.json()) as unknown
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : undefined
    throw new Error(
      message ?? `Request failed (${response.status}).`,
    )
  }
  return body as Result
}

export const workspaceApi = {
  bootstrap: () =>
    request<{
      workspaces: WorkspaceRecord[]
      selectedWorkspaceId: string | null
      projects: ProjectSummary[]
    }>('/bootstrap'),
  createWorkspace: (name: string) =>
    request<WorkspaceRecord>('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  listProjects: (
    workspaceId: string,
    options: { query?: string; includeTrashed?: boolean } = {},
  ) => {
    const query = new URLSearchParams({ workspaceId })
    if (options.query) query.set('query', options.query)
    if (options.includeTrashed) query.set('includeTrashed', 'true')
    return request<ProjectSummary[]>(`/projects?${query}`)
  },
  createProject: (input: {
    workspaceId: string
    name: string
    snapshot: PersistedProjectRecord['snapshot']
    extension: PersistedProjectRecord['extension']
  }) =>
    request<PersistedProjectRecord>('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getProject: (projectId: string) =>
    request<PersistedProjectRecord>(`/projects/${projectId}`),
  listRevisions: (projectId: string) =>
    request<RevisionPreview[]>(`/projects/${projectId}/revisions`),
  action: <Result = PersistedProjectRecord>(
    projectId: string,
    body: Record<string, unknown>,
  ) =>
    request<Result>(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
}
