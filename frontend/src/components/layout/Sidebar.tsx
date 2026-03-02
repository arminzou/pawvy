import { ChevronLeft, ChevronRight, ChevronDown, Folder, FolderPlus, Plus, User, Trash2, Pencil, Save, Sliders } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type TaskStatus, type Project } from '../../lib/api';
import { useAgents } from '../../hooks/useAgents';
import { toast } from '../../lib/toast';
import { Chip } from '../ui/Chip';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Input } from '../ui/Input';
import { Menu } from '../ui/Menu';
import { ModalShell } from '../ui/ModalShell';
import { PromptModal } from '../ui/PromptModal';
import { Select } from '../ui/Select';

type AssigneeFilter = 'all' | (string & {});

type DueFilter = 'any' | 'overdue' | 'soon' | 'has' | 'none';

type TagFilter = 'all' | (string & {});

type ContextFilter = 'all' | 'current' | (string & {});

type SavedView = {
  id: string;
  name: string;
};

export function Sidebar({
  projectName,
  projects,
  currentProjectId,
  onProjectChange,
  onRefreshProjects,
  onDeleteProject,
  onRenameProject,
  collapsed,
  onToggleCollapsed,
  viewsOpen,
  onToggleViewsOpen,
  filtersOpen,
  onToggleFiltersOpen,
  view,
  onView,
  viewItems,
  savedViews,
  activeSavedViewId,
  onApplySavedView,
  onSaveCurrentView,
  onSaveViewName,
  onDeleteSavedView,
  onRenameSavedView,
  onUpdateSavedViewFilters,
  assignee,
  onAssignee,
  hideDone,
  onHideDone,
  blocked,
  onBlocked,
  due,
  onDue,
  tag,
  tagOptions,
  onTag,
  showArchived,
  onShowArchived,
  showSomeday,
  onShowSomeday,
  onArchiveDone,
  onAssignUnassignedTasks,
  context,
  onContext,
  currentContextKey,
  onReset,
  onMyQueue,
  myQueueActive,
  myQueueCount,
}: {
  projectName: string;
  projects?: Project[];
  currentProjectId?: number | null;
  onProjectChange?: (id: number | null) => void;
  onRefreshProjects?: () => void | Promise<void>;
  onDeleteProject?: (id: number) => void | Promise<void>;
  onRenameProject?: (id: number, name: string) => void | Promise<void>;

  collapsed: boolean;
  onToggleCollapsed: () => void;

  viewsOpen: boolean;
  onToggleViewsOpen: () => void;

  filtersOpen: boolean;
  onToggleFiltersOpen: () => void;

  view: 'all' | TaskStatus;
  onView: (v: 'all' | TaskStatus) => void;
  viewItems: Array<{ key: 'all' | TaskStatus; label: string; count: number }>;

  savedViews: SavedView[];
  activeSavedViewId: string | null;
  onApplySavedView: (id: string) => void;
  onSaveCurrentView: () => void;
  onSaveViewName: (v: string) => void;
  onDeleteSavedView: (id: string) => void;
  onRenameSavedView?: (id: string) => void;
  onUpdateSavedViewFilters?: (id: string) => void;

  assignee: AssigneeFilter;
  onAssignee: (v: AssigneeFilter) => void;

  hideDone: boolean;
  onHideDone: (v: boolean) => void;

  blocked: boolean;
  onBlocked: (v: boolean) => void;

  due: DueFilter;
  onDue: (v: DueFilter) => void;

  tag: TagFilter;
  tagOptions: string[];
  onTag: (v: TagFilter) => void;

  showArchived: boolean;
  onShowArchived: (v: boolean) => void;

  showSomeday: boolean;
  onShowSomeday: (v: boolean) => void;

  onArchiveDone: () => void | Promise<void>;
  onAssignUnassignedTasks?: (projectId: number) => void | Promise<void>;

  context: ContextFilter;
  onContext: (v: ContextFilter) => void;
  currentContextKey: string | null;

  onReset: () => void;

  onMyQueue?: () => void;
  myQueueActive?: boolean;
  myQueueCount?: number;
}) {
  const { agents } = useAgents();

  // Count active filters (non-default values)
  const activeFilterCount = [
    assignee !== 'all',
    context !== 'all',
    hideDone,
    blocked,
    due !== 'any',
    tag !== 'all',
  ].filter(Boolean).length;

  const filterChips = [
    {
      key: 'assignee',
      show: assignee !== 'all',
      label: assignee === '' ? 'Unassigned' : assignee,
      title: 'Clear assignee filter',
      onClear: () => onAssignee('all'),
    },
    {
      key: 'hide-done',
      show: hideDone,
      label: 'Hide done',
      title: 'Clear hide done',
      onClear: () => onHideDone(false),
    },
    {
      key: 'blocked',
      show: blocked,
      label: 'Blocked only',
      title: 'Clear blocked filter',
      onClear: () => onBlocked(false),
    },
    {
      key: 'due',
      show: due !== 'any',
      label: `Due: ${due}`,
      title: 'Clear due filter',
      onClear: () => onDue('any'),
    },
    {
      key: 'tag',
      show: tag !== 'all',
      label: `#${tag}`,
      title: 'Clear tag filter',
      onClear: () => onTag('all'),
    },
    {
      key: 'context',
      show: context !== 'all',
      label: `Context: ${context === 'current' ? currentContextKey || 'current' : context}`,
      title: 'Clear context filter',
      onClear: () => onContext('all'),
    },
  ].filter((chip) => chip.show);

  const filterMenus: Array<{
    key: string;
    label: string;
    value: string;
    options: FilterOption[];
    onChange: (value: string) => void;
    enabled?: boolean;
  }> = [
    {
      key: 'assignee',
      label: 'Assignee',
      value: assignee,
      onChange: (value) => onAssignee(value as AssigneeFilter),
      options: [
        { value: 'all', label: 'All' },
        ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
        { value: '', label: '(unassigned)' },
      ],
    },
    {
      key: 'due',
      label: 'Due',
      value: due,
      onChange: (value) => onDue(value as DueFilter),
      options: [
        { value: 'any', label: 'Any' },
        { value: 'overdue', label: 'Overdue' },
        { value: 'soon', label: 'Due soon (7d)' },
        { value: 'has', label: 'Has due date' },
        { value: 'none', label: 'No due date' },
      ],
    },
    {
      key: 'tag',
      label: 'Tag',
      value: tag === 'all' ? 'all' : String(tag),
      onChange: (value) => onTag((value || 'all') as TagFilter),
      options: [{ value: 'all', label: 'All' }, ...tagOptions.map((t) => ({ value: t, label: t }))],
    },
    {
      key: 'context',
      label: 'Context (branch/worktree)',
      value: context,
      onChange: (value) => onContext((value || 'all') as ContextFilter),
      enabled: Boolean(currentContextKey),
      options: [
        { value: 'all', label: 'All contexts' },
        { value: 'current', label: `Current: ${currentContextKey}` },
      ],
    },
  ];

  const filterToggles = [
    { key: 'hide-done', label: 'Hide done', checked: hideDone, onChange: (value: boolean) => onHideDone(value) },
    { key: 'blocked', label: 'Blocked only', checked: blocked, onChange: (value: boolean) => onBlocked(value) },
    { key: 'archived', label: 'Show archived', checked: showArchived, onChange: (value: boolean) => onShowArchived(value) },
    { key: 'someday', label: 'Show saved', checked: showSomeday, onChange: (value: boolean) => onShowSomeday(value) },
  ];

  const activeSavedView = activeSavedViewId ? savedViews.find((x) => x.id === activeSavedViewId) : null;
  const currentViewLabel = activeSavedView?.name ?? viewItems.find((it) => it.key === view)?.label ?? 'All';

  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerPath, setRegisterPath] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const registerPathRef = useRef<HTMLInputElement | null>(null);
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);
  const [confirmDeleteView, setConfirmDeleteView] = useState<{ id: string; name: string } | null>(null);
  const [assignProjectModalOpen, setAssignProjectModalOpen] = useState(false);
  const [assignProjectId, setAssignProjectId] = useState<number | null>(null);
  const [renameProjectId, setRenameProjectId] = useState<number | null>(null);
  const savedViewsRef = useRef<HTMLDivElement | null>(null);
  const currentViewRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!viewsOpen) return;

    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (savedViewsRef.current?.contains(target)) return;
      if (currentViewRef.current?.contains(target)) return;
      onToggleViewsOpen();
    }

    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [viewsOpen, onToggleViewsOpen]);

  const filterChipClass =
    'inline-flex items-center rounded-md bg-white px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 active:bg-slate-100 active:translate-y-px active:shadow-inner';

  function parseApiError(error: unknown): { status: number | null; backendMessage: string | null; rawMessage: string } {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const statusMatch = rawMessage.match(/^(\d{3})\s/);
    const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : null;

    const bodyStart = rawMessage.indexOf('{');
    if (bodyStart >= 0) {
      const bodyText = rawMessage.slice(bodyStart);
      try {
        const parsed = JSON.parse(bodyText) as { error?: unknown; message?: unknown };
        const backendMessage =
          typeof parsed.error === 'string'
            ? parsed.error
            : typeof parsed.message === 'string'
              ? parsed.message
              : null;
        return { status, backendMessage, rawMessage };
      } catch {
        // fall through to raw text handling
      }
    }

    return { status, backendMessage: null, rawMessage };
  }

  function mapCreateProjectError(error: unknown): string {
    const { status, backendMessage, rawMessage } = parseApiError(error);
    const normalizedMessage = (backendMessage ?? rawMessage).toLowerCase();

    if (status === 409 || normalizedMessage.includes('already registered') || normalizedMessage.includes('already exists')) {
      return 'This folder is already registered as a project. Choose a different path or open the existing project.';
    }

    if (
      status === 400
      || normalizedMessage.includes('path is required')
      || normalizedMessage.includes('path contains unresolved')
      || normalizedMessage.includes('path must resolve to an absolute path')
    ) {
      return 'Invalid folder path. Use an absolute path and resolve any environment variables before submitting.';
    }

    return `Failed to register project: ${backendMessage ?? rawMessage}`;
  }

  function derivedProjectName(path: string): string {
    return path.split('/').filter(Boolean).at(-1) ?? '';
  }

  function closeRegisterForm() {
    setRegisterOpen(false);
    setRegisterPath('');
    setRegisterName('');
  }

  async function handleRegisterProjectSubmit() {
    const path = registerPath.trim();
    const name = registerName.trim() || derivedProjectName(path);
    if (!name || !path) return;

    setRegisterSubmitting(true);
    try {
      const created = await api.createProject({ name, path });
      await onRefreshProjects?.();
      onProjectChange?.(created.id);
      toast.success(`Project "${created.name}" registered`);
      closeRegisterForm();
    } catch (err) {
      toast.error(mapCreateProjectError(err));
    } finally {
      setRegisterSubmitting(false);
    }
  }

  // Collapsed state - show only toggle button on desktop
  const collapsedToggle = (
    <aside className="hidden h-full w-10 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col lg:items-center lg:py-3">
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200 active:translate-y-px active:shadow-inner"
        onClick={onToggleCollapsed}
        title="Expand sidebar"
        aria-label="Expand sidebar"
      >
        <ChevronRight size={18} />
      </button>
    </aside>
  );

  return (
    <>
      {collapsed ? collapsedToggle : null}
      <aside
        className={`h-full w-full border-slate-200 bg-white lg:w-72 lg:border-r${collapsed ? ' lg:hidden' : ''}`}
      >
      <div className="px-4 py-4">
        <div>
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Project</div>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 active:bg-slate-200 active:translate-y-px active:shadow-inner"
              onClick={onToggleCollapsed}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft size={18} />
            </button>
          </div>
          <div className="min-w-0">
            {projects && onProjectChange ? (
              <>
              <div className="mt-1 flex items-center gap-1">
              <div className="relative flex-1">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-900 transition hover:bg-slate-50 active:bg-slate-100 active:translate-y-px active:shadow-inner"
                  onClick={() => setProjectMenuOpen((v) => !v)}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Folder size={16} className="shrink-0 text-slate-400" />
                    <span className="truncate">{projectName}</span>
                  </span>
                  <ChevronDown size={14} className={`shrink-0 text-slate-400 transition ${projectMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {projectMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setProjectMenuOpen(false)} />
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto cb-menu">
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 text-left transition cb-menu-item ${
                          currentProjectId === null
                            ? 'bg-indigo-50 font-semibold text-indigo-700'
                            : 'text-slate-700'
                        }`}
                        onClick={() => {
                          onProjectChange(null);
                          setProjectMenuOpen(false);
                        }}
                      >
                        <Folder size={16} className="shrink-0 text-slate-400" />
                        <span>All Projects</span>
                      </button>
                      <div className="cb-menu-separator" />
                      {projects.map((p) => (
                        <div
                          key={p.id}
                          className={`flex w-full items-center gap-2 text-sm transition cb-menu-item ${
                            currentProjectId === p.id
                              ? 'bg-indigo-50 font-semibold text-indigo-700'
                              : 'text-slate-700'
                          }`}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left"
                            onClick={() => {
                              onProjectChange(p.id);
                              setProjectMenuOpen(false);
                            }}
                          >
                            <span
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
                              style={{ backgroundColor: p.color || '#6366f1' }}
                            >
                              <Folder size={10} className="text-white" />
                            </span>
                            <span className="truncate">{p.name}</span>
                          </button>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200 active:translate-y-px active:shadow-inner"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameProjectId(p.id);
                                setProjectMenuOpen(false);
                              }}
                              title={`Rename project "${p.name}"`}
                              aria-label={`Rename project "${p.name}"`}
                            >
                              <Pencil size={14} />
                            </button>
                            {onDeleteProject && (
                              <button
                                type="button"
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-red-50 hover:text-red-600 active:bg-red-100 active:translate-y-px active:shadow-inner"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const ok = window.confirm(`Delete project "${p.name}"? This will unlink all associated tasks.`);
                                  if (ok) {
                                    onDeleteProject(p.id);
                                    setProjectMenuOpen(false);
                                  }
                                }}
                                title={`Delete project "${p.name}"`}
                                aria-label={`Delete project "${p.name}"`}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {onAssignUnassignedTasks && projects?.length ? (
                        <>
                          <div className="cb-menu-separator" />
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 text-left text-xs font-semibold text-slate-700 cb-menu-item"
                            onClick={() => {
                              const projectList = projects ?? [];
                              const fallbackProjectId =
                                currentProjectId ?? (projectList.length === 1 ? projectList[0].id : null);
                              setAssignProjectId(fallbackProjectId);
                              setAssignProjectModalOpen(true);
                              setProjectMenuOpen(false);
                            }}
                          >
                            Assign unassigned tasks
                          </button>
                        </>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 active:bg-slate-200 active:translate-y-px"
                onClick={() => setRegisterOpen((v) => !v)}
                title="Add project"
                aria-label="Add project"
              >
                <Plus size={15} />
              </button>
              </div>

              </>
            ) : (
              <div className="mt-1 truncate text-base font-semibold text-slate-900">{projectName}</div>
            )}
          </div>
        </div>

        {onMyQueue && (
          <button
            type="button"
            className={`mt-4 flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition active:translate-y-px active:shadow-inner ${
              myQueueActive
                ? 'border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800'
                : 'border-indigo-100 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 active:bg-indigo-200'
            }`}
            onClick={onMyQueue}
          >
            <span className="flex items-center gap-2">
              <User size={16} />
              <span>My Queue</span>
            </span>
            {myQueueCount !== undefined && myQueueCount > 0 && (
              <Chip
                variant="strong"
                className={myQueueActive ? 'bg-white/20 text-white' : 'bg-indigo-200 text-indigo-800'}
              >
                {myQueueCount}
              </Chip>
            )}
          </button>
        )}

        {showSaveViewModal && (
          <PromptModal
            title="Save view"
            message="Name this view so you can reuse it later."
            placeholder="View name"
            confirmLabel="Save"
            onClose={() => setShowSaveViewModal(false)}
            onConfirm={(value) => {
              onSaveViewName(value);
              queueMicrotask(() => onSaveCurrentView());
              setShowSaveViewModal(false);
            }}
          />
        )}

        {confirmDeleteView && (
          <ConfirmModal
            title="Delete saved view?"
            message={`This will remove "${confirmDeleteView.name}". You can save it again later.`}
            confirmLabel="Delete"
            onClose={() => setConfirmDeleteView(null)}
            onConfirm={() => {
              onDeleteSavedView(confirmDeleteView.id);
              setConfirmDeleteView(null);
            }}
          />
        )}

        {registerOpen ? (
          <ModalShell onClose={() => { if (!registerSubmitting) closeRegisterForm(); }}>
            <div className="flex flex-col gap-5 text-left">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
                  <FolderPlus size={20} />
                </div>
                <div>
                  <div className="text-base font-semibold text-[rgb(var(--cb-text))]">Add project</div>
                  <div className="text-xs text-[rgb(var(--cb-text-muted))]">Register a local folder as a project</div>
                </div>
              </div>

              <label className="block">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--cb-text-muted))]">Path</div>
                <Input
                  ref={registerPathRef}
                  value={registerPath}
                  onChange={(e) => setRegisterPath(e.target.value)}
                  placeholder="~/repos/projects/example"
                  aria-label="Folder path"
                  disabled={registerSubmitting}
                  autoFocus
                  className="font-mono"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRegisterProjectSubmit();
                    if (e.key === 'Escape') closeRegisterForm();
                  }}
                />
              </label>

              <label className="block">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--cb-text-muted))]">Name</div>
                <Input
                  value={registerName}
                  onChange={(e) => setRegisterName(e.target.value)}
                  placeholder={derivedProjectName(registerPath) || 'project-name'}
                  aria-label="Project name"
                  disabled={registerSubmitting}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRegisterProjectSubmit();
                    if (e.key === 'Escape') closeRegisterForm();
                  }}
                />
                {registerPath.trim() && !registerName.trim() && (
                  <div className="mt-1.5 text-xs text-[rgb(var(--cb-text-muted))]">
                    Will use <span className="font-mono font-medium">{derivedProjectName(registerPath)}</span> if left blank
                  </div>
                )}
              </label>

              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" disabled={registerSubmitting} onClick={closeRegisterForm}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={registerSubmitting || !registerPath.trim()}
                  onClick={() => void handleRegisterProjectSubmit()}
                >
                  {registerSubmitting ? 'Registering…' : 'Register project'}
                </Button>
              </div>
            </div>
          </ModalShell>
        ) : null}

        {assignProjectModalOpen && onAssignUnassignedTasks ? (
          <ModalShell onClose={() => setAssignProjectModalOpen(false)}>
            <div className="flex flex-col gap-4 text-left">
              <div>
                <div className="text-lg font-semibold text-[rgb(var(--cb-text))]">Assign unassigned tasks</div>
                <div className="mt-1 text-sm text-[rgb(var(--cb-text-muted))]">
                  Choose which project should receive tasks without a project.
                </div>
              </div>

              <label className="text-sm">
                <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Target project</div>
                <Select
                  value={assignProjectId ?? ''}
                  onChange={(e) => setAssignProjectId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">(select a project)</option>
                  {projects?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </label>

              <div className="mt-2 flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setAssignProjectModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!assignProjectId}
                  onClick={() => {
                    if (!assignProjectId) return;
                    onAssignUnassignedTasks(assignProjectId);
                    setAssignProjectModalOpen(false);
                  }}
                >
                  Assign
                </Button>
              </div>
            </div>
          </ModalShell>
        ) : null}

        {renameProjectId !== null && projects ? (
          <PromptModal
            title="Rename project"
            message="Enter a new name for this project"
            defaultValue={projects.find((p) => p.id === renameProjectId)?.name ?? ''}
            confirmLabel="Rename"
            variant="primary"
            onClose={() => setRenameProjectId(null)}
            onConfirm={async (newName) => {
              const trimmed = newName.trim();
              if (!trimmed) return;
              await onRenameProject?.(renameProjectId, trimmed);
              setRenameProjectId(null);
            }}
          />
        ) : null}

        <div className="mt-4">
          <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span>Views</span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 active:bg-slate-100"
                onClick={() => setShowSaveViewModal(true)}
              >
                <Save size={12} className="shrink-0" />
                <span className="leading-none">Save as</span>
              </button>
            </div>
          </div>

          <div className="relative">
            <button
              ref={currentViewRef}
              type="button"
              className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 active:bg-slate-100 active:translate-y-px active:shadow-inner"
              onClick={onToggleViewsOpen}
            >
              <span className="truncate">{currentViewLabel}</span>
              <ChevronDown size={14} className={`shrink-0 text-slate-400 transition ${viewsOpen ? 'rotate-180' : ''}`} />
            </button>

            {viewsOpen && savedViews.length ? (
              <div
                ref={savedViewsRef}
                className="absolute left-0 right-0 z-30 mt-1 cb-menu"
              >
                <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Saved views</div>
                <div className="flex flex-col gap-1">
                  {savedViews.map((sv) => (
                    <SavedViewButton
                      key={sv.id}
                      active={activeSavedViewId === sv.id}
                      label={sv.name}
                      onClick={() => {
                        onApplySavedView(sv.id);
                        onToggleViewsOpen();
                      }}
                      onDelete={() => setConfirmDeleteView({ id: sv.id, name: sv.name })}
                      onRename={onRenameSavedView ? () => onRenameSavedView(sv.id) : undefined}
                      onUpdateFilters={onUpdateSavedViewFilters ? () => onUpdateSavedViewFilters(sv.id) : undefined}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-2 flex flex-col gap-1">
            {viewItems.map((it) => (
              <ViewButton
                key={String(it.key)}
                active={view === it.key}
                label={it.label}
                count={it.count}
                onClick={() => onView(it.key)}
              />
            ))}
          </div>

        </div>
        <div className="mt-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-2">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-50 active:bg-slate-100 active:translate-y-px active:shadow-inner"
              onClick={onToggleFiltersOpen}
            >
              <span className="flex items-center gap-2">
                Filters
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                    {activeFilterCount}
                  </span>
                )}
              </span>
              <span className="text-slate-400">
                <IconChevron open={filtersOpen} />
              </span>
            </button>

            {filtersOpen ? (
              <div className="mt-1 rounded-xl bg-white/60 p-2">
                <div className="flex flex-col gap-2 px-1">
                  {activeFilterCount > 0 && (
                    <div className="flex flex-wrap gap-1 rounded-lg border border-indigo-100 bg-indigo-50 p-2">
                      {filterChips.map((chip) => (
                        <button
                          key={chip.key}
                          type="button"
                          className={filterChipClass}
                          onClick={chip.onClear}
                          title={chip.title}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {filterMenus
                    .filter((menu) => menu.enabled !== false)
                    .map((menu) => (
                      <FilterMenu
                        key={menu.key}
                        label={menu.label}
                        value={menu.value}
                        onChange={menu.onChange}
                        options={menu.options}
                      />
                    ))}

                  {filterToggles.map((toggle) => (
                    <div
                      key={toggle.key}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-800"
                    >
                      <span>{toggle.label}</span>
                      <Checkbox
                        size="sm"
                        aria-label={toggle.label}
                        checked={toggle.checked}
                        onChange={(e) => toggle.onChange(e.target.checked)}
                      />
                    </div>
                  ))}

                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => void onArchiveDone()}
                  >
                    Archive done
                  </Button>

                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={onReset}
                  >
                    Reset
                  </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              className="mt-2 w-full"
              onClick={onReset}
            >
              Reset
            </Button>
          )}
          </div>
        </div>

      </div>
    </aside>
    </>
  );
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={14}
      aria-hidden="true"
      className={open ? 'rotate-90 transition' : 'transition'}
      strokeWidth={2}
    />
  );
}

function ViewButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        active
          ? 'flex w-full items-center justify-between rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition active:bg-slate-800 active:translate-y-px active:shadow-inner'
          : 'flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50 active:bg-slate-100 active:translate-y-px active:shadow-inner'
      }
      onClick={onClick}
    >
      <span>{label}</span>
      <Chip variant={active ? 'strong' : 'soft'} className={active ? 'bg-white/15 text-white' : undefined}>
        {count}
      </Chip>
    </button>
  );
}

type FilterOption = {
  value: string;
  label: string;
};

function FilterMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  const current = options.find((opt) => opt.value === value) ?? options[0];

  return (
    <label className="text-sm">
      <div className="mb-1 text-xs font-medium text-slate-600">{label}</div>
      <Menu
        align="left"
        density="compact"
        menuClassName="w-full max-w-full"
        trigger={({ open, toggle }) => (
          <button
            type="button"
            className="cb-input flex w-full items-center justify-between gap-2 text-left"
            onClick={toggle}
          >
            <span className="truncate">{current?.label ?? value}</span>
            <ChevronDown size={14} className={`shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
        items={options.map((opt, idx) => ({
          key: `${opt.value || 'empty'}:${idx}`,
          label: opt.label,
          checked: opt.value === value,
          onSelect: () => onChange(opt.value),
        }))}
      />
    </label>
  );
}

function SavedViewButton({
  active,
  label,
  onClick,
  onDelete,
  onRename,
  onUpdateFilters,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  onDelete: () => void;
  onRename?: () => void;
  onUpdateFilters?: () => void;
}) {
  return (
    <div
      className={
        active
          ? 'flex w-full items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-900 shadow-sm'
          : 'flex w-full items-center justify-between gap-2 rounded-xl border border-transparent px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:border-slate-200 hover:bg-slate-50 hover:shadow-sm'
      }
    >
      <button
        type="button"
        className="min-w-0 flex-1 truncate px-1 py-1 text-left"
        onClick={onClick}
        title={label}
      >
        {label}
      </button>
      <div className="flex items-center gap-1">
        {onUpdateFilters && (
          <button
            type="button"
            className={
              active
                ? 'rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 active:bg-indigo-200 active:translate-y-px active:shadow-inner'
                : 'rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-50 active:bg-slate-100 active:translate-y-px active:shadow-inner'
            }
            onClick={onUpdateFilters}
            title="Update filters"
            aria-label={`Update filters for ${label}`}
          >
            <Sliders size={12} />
          </button>
        )}
        {onRename && (
          <button
            type="button"
            className={
              active
                ? 'rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 active:bg-indigo-200 active:translate-y-px active:shadow-inner'
                : 'rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-50 active:bg-slate-100 active:translate-y-px active:shadow-inner'
            }
            onClick={onRename}
            title="Rename"
            aria-label={`Rename ${label}`}
          >
            <Pencil size={12} />
          </button>
        )}
        <button
          type="button"
          className={
            active
              ? 'rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 active:bg-indigo-200 active:translate-y-px active:shadow-inner'
              : 'rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-50 active:bg-slate-100 active:translate-y-px active:shadow-inner'
          }
          onClick={onDelete}
          title="Delete"
          aria-label={`Delete ${label}`}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
