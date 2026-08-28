import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'

import type { PersistedProjectRecord } from '../mcp/persistence/contracts.ts'
import { Editor, type EditorSnapshot } from './Editor'
import { Presentation } from './Presentation'
import { serializeProject } from './projectFile'
import { createRecoveryJournal, type RecoveryJournalIdentity } from './recovery/recoveryJournal'
import { useControllerPlacement } from './useControllerPlacement'
import { parseWorkspaceSnapshot } from './workspaceSnapshot'
import {
  getEditorControllerLeftInset,
  getWorkspaceSidebarWidth,
} from './workspaceLayout'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import {
  workspaceApi,
  type ProjectSummary,
  type RevisionPreview,
  type WorkspaceRecord,
} from './workspaceApi'

const EMPTY_SNAPSHOT = {
  type: 'excalidraw' as const,
  version: 2 as const,
  source: 'local' as const,
  elements: [],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {},
}

const toEditorSnapshot = (
  snapshot: PersistedProjectRecord['snapshot'],
): EditorSnapshot => ({
  elements: snapshot.elements as ExcalidrawElement[],
  appState: snapshot.appState as Partial<AppState>,
  files: snapshot.files as BinaryFiles,
  frameId:
    (snapshot.elements.find(
      (element) => element.type === 'frame' && element.isDeleted !== true,
    )?.id as string | undefined) ?? null,
})

const toProjectSnapshot = (
  snapshot: EditorSnapshot,
): PersistedProjectRecord['snapshot'] =>
  parseWorkspaceSnapshot(
    serializeProject(snapshot.elements, snapshot.appState, snapshot.files),
  )

export function WorkspaceShell() {
  const controllerPlacement = useControllerPlacement()
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    getWorkspaceSidebarWidth(window.innerWidth),
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('sanverse-workspace-sidebar-collapsed-v1') === 'true'
    } catch {
      return false
    }
  })
  const [presentationSnapshot, setPresentationSnapshot] =
    useState<EditorSnapshot | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [project, setProject] = useState<PersistedProjectRecord | null>(null)
  const [editorSnapshot, setEditorSnapshot] = useState<EditorSnapshot>(() =>
    toEditorSnapshot(EMPTY_SNAPSHOT),
  )
  const [editorGeneration, setEditorGeneration] = useState(0)
  const [query, setQuery] = useState('')
  const [showTrash, setShowTrash] = useState(false)
  const [revisions, setRevisions] = useState<RevisionPreview[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [status, setStatus] = useState('Loading workspace…')
  const projectRef = useRef<PersistedProjectRecord | null>(null)
  const pendingSnapshot = useRef<PersistedProjectRecord['snapshot'] | null>(null)
  const pendingIdentity = useRef<RecoveryJournalIdentity | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInFlight = useRef(false)
  const persistPendingRef = useRef<() => Promise<void>>(async () => undefined)
  const recovery = useMemo(
    () => createRecoveryJournal({ storage: window.localStorage }),
    [],
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'sanverse-workspace-sidebar-collapsed-v1',
        String(sidebarCollapsed),
      )
    } catch {
      // The panel still works when storage is unavailable.
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    const updateSidebarWidth = () => {
      setSidebarWidth(getWorkspaceSidebarWidth(window.innerWidth))
    }
    window.addEventListener('resize', updateSidebarWidth)
    return () => window.removeEventListener('resize', updateSidebarWidth)
  }, [])

  const setCurrentProject = useCallback(
    (next: PersistedProjectRecord, remount = false) => {
      projectRef.current = next
      setProject(next)
      if (remount) {
        setEditorSnapshot(toEditorSnapshot(next.snapshot))
        setEditorGeneration((value) => value + 1)
      }
    },
    [],
  )

  const refreshProjects = useCallback(
    async (targetWorkspaceId = workspaceId) => {
      if (!targetWorkspaceId) return
      const next = await workspaceApi.listProjects(targetWorkspaceId, {
        query,
        includeTrashed: showTrash,
      })
      setProjects(next)
    },
    [query, showTrash, workspaceId],
  )

  useEffect(() => {
    void workspaceApi
      .bootstrap()
      .then((result) => {
        setWorkspaces(result.workspaces)
        setWorkspaceId(result.selectedWorkspaceId ?? '')
        setProjects(result.projects)
        setStatus('Choose a project or create one.')
      })
      .catch((error: unknown) =>
        setStatus(error instanceof Error ? error.message : 'Workspace failed to load.'),
      )
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshProjects().catch((error: unknown) =>
        setStatus(error instanceof Error ? error.message : 'Project list failed.'),
      )
    }, 180)
    return () => clearTimeout(timer)
  }, [refreshProjects])

  const openProject = async (projectId: string) => {
    try {
      setStatus('Opening project…')
      let durable = await workspaceApi.getProject(projectId)
      const assessment = recovery.assess(durable)
      if (
        assessment.status === 'offer' &&
        window.confirm('Unsaved edits were recovered. Restore them now?')
      ) {
        durable = await workspaceApi.action(projectId, {
          action: 'save',
          source: 'recovery',
          expectedRevision: durable.revision.number,
          snapshot: assessment.journal.candidate.snapshot,
          extension: assessment.journal.candidate.extension,
        })
        recovery.acknowledge(durable, assessment.journal.identity)
        setStatus(`Recovered revision ${durable.revision.number}.`)
      } else if (assessment.status === 'conflict') {
        setStatus('Recovery conflict: durable history advanced; current revision opened safely.')
      } else {
        if (assessment.status === 'already-durable') {
          recovery.acknowledge(durable, assessment.journal.identity)
        }
        setStatus(`Opened revision ${durable.revision.number}.`)
      }
      pendingSnapshot.current = null
      pendingIdentity.current = null
      setCurrentProject(durable, true)
      setHistoryOpen(false)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Project failed to open.')
    }
  }

  const persistPending = useCallback(async () => {
    if (saveInFlight.current) return
    const current = projectRef.current
    const snapshot = pendingSnapshot.current
    const identity = pendingIdentity.current
    if (!current || !snapshot || !identity) return
    saveInFlight.current = true
    try {
      setStatus('Saving…')
      const saved = await workspaceApi.action(current.projectId, {
        action: 'save',
        expectedRevision: current.revision.number,
        snapshot,
        extension: current.extension,
      })
      if (pendingIdentity.current?.id === identity.id) {
        pendingSnapshot.current = null
        pendingIdentity.current = null
      }
      recovery.acknowledge(saved, identity)
      if (projectRef.current === current) {
        setCurrentProject(saved)
        setStatus(`Saved revision ${saved.revision.number}.`)
        await refreshProjects(saved.workspaceId)
      }
    } catch (error) {
      setStatus(
        `${error instanceof Error ? error.message : 'Autosave failed.'} Unsaved edits remain recoverable.`,
      )
    } finally {
      saveInFlight.current = false
      if (pendingSnapshot.current && pendingIdentity.current?.id !== identity.id) {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(
          () => void persistPendingRef.current(),
          0,
        )
      }
    }
  }, [recovery, refreshProjects, setCurrentProject])

  useEffect(() => {
    persistPendingRef.current = persistPending
  }, [persistPending])

  const handleSnapshotChange = useCallback(
    (snapshot: EditorSnapshot) => {
      const current = projectRef.current
      if (!current) return
      const canonical = toProjectSnapshot(snapshot)
      if (JSON.stringify(canonical) === JSON.stringify(current.snapshot)) return
      try {
        const journal = recovery.write(current, {
          expectedRevision: current.revision.number,
          snapshot: canonical,
          extension: current.extension,
          assetHashes: current.assetHashes,
        })
        pendingSnapshot.current = canonical
        pendingIdentity.current = journal.identity
        setStatus('Unsaved changes…')
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => void persistPending(), 800)
      } catch (error) {
        const cause =
          error instanceof Error && error.cause instanceof Error
            ? ` ${error.cause.message}`
            : ''
        setStatus(
          error instanceof Error
            ? `${error.message}${cause}`
            : 'Recovery journal failed.',
        )
      }
    },
    [persistPending, recovery],
  )

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    [],
  )

  const createProject = async () => {
    if (!workspaceId) return
    const name = window.prompt('Project name')?.trim()
    if (!name) return
    try {
      const created = await workspaceApi.createProject({
        workspaceId,
        name,
        snapshot: EMPTY_SNAPSHOT,
        extension: { version: 1 },
      })
      await refreshProjects(workspaceId)
      setCurrentProject(created, true)
      setStatus('Project created. Start drawing—changes autosave.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Project creation failed.')
    }
  }

  const createWorkspace = async () => {
    const name = window.prompt('Workspace name')?.trim()
    if (!name) return
    try {
      const created = await workspaceApi.createWorkspace(name)
      setWorkspaces((current) => [...current, created])
      setWorkspaceId(created.id)
      setProjects([])
      setStatus(`Workspace “${created.name}” created.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Workspace creation failed.')
    }
  }

  const projectAction = async (
    action: string,
    extra: Record<string, unknown> = {},
  ) => {
    const current = projectRef.current
    if (!current) return
    try {
      const changed = await workspaceApi.action(current.projectId, {
        action,
        ...extra,
      })
      if (action === 'trash') {
        projectRef.current = null
        setProject(null)
        setEditorSnapshot(toEditorSnapshot(EMPTY_SNAPSHOT))
        setEditorGeneration((value) => value + 1)
      } else {
        setCurrentProject(
          changed,
          action === 'restore-revision' || action === 'duplicate',
        )
      }
      await refreshProjects(current.workspaceId)
      setStatus(`${action.replace('-', ' ')} complete.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${action} failed.`)
    }
  }

  const openHistory = async () => {
    const current = projectRef.current
    if (!current) return
    try {
      setRevisions(await workspaceApi.listRevisions(current.projectId))
      setHistoryOpen(true)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'History failed to load.')
    }
  }

  return (
    <div
      className={`workspace-shell${sidebarCollapsed ? ' workspace-shell--sidebar-collapsed' : ''}`}
      style={{ '--workspace-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    >
      <WorkspaceSidebar
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      >
        <header>
          <div>
            <strong>Animation Studio</strong>
            <span>Durable workspace</span>
          </div>
          <button type="button" onClick={() => void createWorkspace()} title="New workspace">+</button>
        </header>
        <select
          aria-label="Workspace"
          value={workspaceId}
          onChange={(event) => {
            setWorkspaceId(event.target.value)
            setProject(null)
            projectRef.current = null
          }}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
          ))}
        </select>
        <div className="workspace-search">
          <input
            aria-label="Search projects"
            placeholder="Search projects"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" onClick={() => void createProject()}>New</button>
        </div>
        <label className="trash-toggle">
          <input type="checkbox" checked={showTrash} onChange={(event) => setShowTrash(event.target.checked)} />
          Show trash
        </label>
        <div className="workspace-projects">
          {projects.map((item) => (
            <button
              type="button"
              key={item.projectId}
              className={project?.projectId === item.projectId ? 'is-active' : undefined}
              onClick={() =>
                item.trash.state === 'trashed'
                  ? void workspaceApi.action(item.projectId, { action: 'restore-trash' }).then(() => refreshProjects())
                  : void openProject(item.projectId)
              }
            >
              <strong>{item.name}</strong>
              <span>Revision {item.currentRevision}{item.trash.state === 'trashed' ? ' · Restore' : ''}</span>
            </button>
          ))}
          {!projects.length ? <p>No projects here yet.</p> : null}
        </div>
        {project ? (
          <div className="workspace-actions">
            <button type="button" onClick={() => {
              const name = window.prompt('Rename project', project.name)?.trim()
              if (name) void projectAction('rename', { name })
            }}>Rename</button>
            <button type="button" onClick={() => {
              const name = window.prompt('Duplicate name', `${project.name} copy`)?.trim()
              if (name) void projectAction('duplicate', { name })
            }}>Duplicate</button>
            <button type="button" onClick={() => void openHistory()}>History</button>
            <button type="button" className="danger" onClick={() => void projectAction('trash')}>Trash</button>
          </div>
        ) : null}
        <output className="workspace-status">{status}</output>
      </WorkspaceSidebar>

      <main className="workspace-editor">
        {!project ? (
          <div className="workspace-empty">
            <strong>Your drawings persist here.</strong>
            <span>Create or open a project to begin.</span>
            <button type="button" onClick={() => void createProject()}>Create project</button>
          </div>
        ) : (
          <>
            <div className={`editor-layer${presentationSnapshot ? ' editor-layer--presenting' : ''}`} aria-hidden={presentationSnapshot ? true : undefined} {...(presentationSnapshot ? { inert: true } : {})}>
              <Editor
                key={`${project.projectId}:${editorGeneration}`}
                controllerPlacement={controllerPlacement}
                controllerLeftInset={getEditorControllerLeftInset({
                  presentationActive: presentationSnapshot !== null,
                  sidebarCollapsed,
                  sidebarWidth,
                })}
                initialSnapshot={editorSnapshot}
                onSnapshotChange={handleSnapshotChange}
                onPresent={setPresentationSnapshot}
              />
            </div>
          </>
        )}
      </main>

      {historyOpen && project ? (
        <aside className="revision-drawer" aria-label="Revision history">
          <header><strong>Version history</strong><button type="button" onClick={() => setHistoryOpen(false)}>×</button></header>
          {revisions.map((revision) => (
            <div key={revision.revisionNumber} className="revision-row">
              <div><strong>r{revision.revisionNumber} · {revision.source}</strong><span>{revision.label ?? 'Unnamed'} · {revision.elementCount} elements · {revision.stepCount} steps</span></div>
              {!revision.isCurrent ? <button type="button" onClick={() => void projectAction('restore-revision', { revisionNumber: revision.revisionNumber }).then(openHistory)}>Restore</button> : <span>Current</span>}
            </div>
          ))}
        </aside>
      ) : null}

      {presentationSnapshot ? (
        <Presentation controllerPlacement={controllerPlacement} snapshot={presentationSnapshot} onExit={() => setPresentationSnapshot(null)} />
      ) : null}
    </div>
  )
}
