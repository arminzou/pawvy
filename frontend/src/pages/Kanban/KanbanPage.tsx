import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '../../lib/api';
import type { Task, TaskStatus } from '../../lib/api';
import { toast } from '../../lib/toast';
import { BulkActionBar } from './BulkActionBar';
import { KanbanBoard, type KanbanSortDir, type KanbanSortKey } from './KanbanBoard';
import { KeyboardHelpModal } from './KeyboardHelpModal';
import { CreateTaskModal, EditTaskModal } from './TaskModals';
import { AppShell } from '../../components/layout/AppShell';
import { Sidebar } from '../../components/layout/Sidebar';
import { Topbar, type TopbarMode } from '../../components/layout/Topbar';
import { TaskTable } from './TaskTable';
import { Button } from '../../components/ui/Button';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { Input } from '../../components/ui/Input';
import { Panel } from '../../components/ui/Panel';
import { useProjects } from '../../hooks/useProjects';
import { useKanbanData } from './hooks/useKanbanData';
import type { WsStatus } from '../../hooks/useWebSocket';
import type { AgentProfileSources } from '../../components/layout/agentProfile';

const COLUMNS: { key: TaskStatus; title: string }[] = [
  { key: 'backlog', title: 'Backlog' },
  { key: 'in_progress', title: 'In Progress' },
  { key: 'review', title: 'Review' },
  { key: 'done', title: 'Done' },
];

type ViewFilter = 'all' | TaskStatus;

type AssigneeFilter = 'all' | (string & {});

type DueFilter = 'any' | 'overdue' | 'soon' | 'has' | 'none';

type TagFilter = 'all' | (string & {});

type ContextFilter = 'all' | 'current' | (string & {});

const SORT_OPTIONS: Record<KanbanSortKey, { label: string; defaultDir: KanbanSortDir }> = {
  updated: { label: 'Updated', defaultDir: 'desc' },
  created: { label: 'Created', defaultDir: 'desc' },
  due: { label: 'Due', defaultDir: 'asc' },
  priority: { label: 'Priority', defaultDir: 'asc' },
};

type SavedView = {
  id: string;
  name: string;
  filters: {
    view: ViewFilter;
    assignee: AssigneeFilter;
    hideDone: boolean;
    blocked: boolean;
    showArchived: boolean;
    showSomeday: boolean;
    due: DueFilter;
    tag: TagFilter;
    q: string;
  };
};

export function KanbanPage({
  wsSignal,
  wsStatus,
  initialAgentIds,
  agentProfileSources,
  openTaskId,
  onOpenTaskConsumed,
}: {
  wsSignal?: { type?: string; data?: unknown } | null;
  wsStatus?: WsStatus;
  initialAgentIds?: string[];
  agentProfileSources?: AgentProfileSources;
  openTaskId?: number | null;
  onOpenTaskConsumed?: () => void;
}) {
  // URL routing
  const { projectId: urlProjectId } = useParams<{ projectId?: string }>();
  const navigate = useNavigate();

  // Compute initial project ID from URL first, then localStorage fallback
  const initialProjectId = useMemo(() => {
    if (urlProjectId) {
      const id = parseInt(urlProjectId, 10);
      if (!Number.isNaN(id)) return id;
    }
    // Fallback to localStorage only if no URL param
    try {
      const raw = window.localStorage.getItem('cb.v2.currentProjectId');
      if (raw === 'null' || raw === '') return null;
      return raw ? parseInt(raw, 10) : null;
    } catch {
      return null;
    }
  }, [urlProjectId]);

  // Project management
  const {
    projects,
    currentProjectId,
    currentProject,
    setCurrentProjectId,
    refresh: refreshProjects,
    updateProject: updateProjectLocal,
  } = useProjects(initialProjectId);

  // Sync URL changes with project state (URL is source of truth)
  useEffect(() => {
    const urlId = urlProjectId ? parseInt(urlProjectId, 10) : null;
    const targetId = urlId && !Number.isNaN(urlId) ? urlId : null;
    
    if (targetId !== currentProjectId) {
      setCurrentProjectId(targetId);
    }
  }, [urlProjectId, currentProjectId, setCurrentProjectId]);

  // Navigate when project changes from sidebar
  const handleProjectChange = useCallback((id: number | null) => {
    setCurrentProjectId(id);
    if (id === null) {
      navigate('/');
    } else {
      navigate(`/project/${id}`);
    }
  }, [setCurrentProjectId, navigate]);


  
  // Auto-ingest sessions on initial load
  useEffect(() => {
    api.ingestSessions().then(res => {
      if (res.inserted > 0) {
        toast.success(`Ingested ${res.inserted} new activities`);
        // We don't auto-refresh the main task board, but the activity feed will be updated.
      }
    }).catch(err => {
      console.error('Failed to auto-ingest sessions:', err);
      // Silently fail, this isn't a critical user-facing error.
    });
  }, []);

  const [view, setView] = useState<ViewFilter>(() => {
    try {
      const raw = window.localStorage.getItem('cb.v2.kanban.view') ?? 'all';
      return (raw === 'all' || raw === 'backlog' || raw === 'in_progress' || raw === 'review' || raw === 'done' ? raw : 'all') as ViewFilter;
    } catch {
      return 'all';
    }
  });

  const [sortKey, setSortKey] = useState<KanbanSortKey>(() => {
    try {
      const raw = window.localStorage.getItem('cb.v2.kanban.sortKey') ?? 'updated';
      return (raw in SORT_OPTIONS ? raw : 'updated') as KanbanSortKey;
    } catch {
      return 'updated';
    }
  });

  const [sortDir, setSortDir] = useState<KanbanSortDir>(() => {
    try {
      const raw = window.localStorage.getItem('cb.v2.kanban.sortDir') ?? 'desc';
      return raw === 'asc' || raw === 'desc' ? raw : 'desc';
    } catch {
      return 'desc';
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.kanban.sortKey', sortKey);
      window.localStorage.setItem('cb.v2.kanban.sortDir', sortDir);
    } catch {
      // ignore
    }
  }, [sortKey, sortDir]);

  const [hideDone, setHideDone] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('cb.v2.kanban.hideDone') === '1';
    } catch {
      return false;
    }
  });

  const [blocked, setBlocked] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('cb.v2.kanban.blocked') === '1';
    } catch {
      return false;
    }
  });

  const [showArchived, setShowArchived] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('cb.v2.kanban.showArchived') === '1';
    } catch {
      return false;
    }
  });

  const [showSomeday, setShowSomeday] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('cb.v2.kanban.showSomeday') === '1';
    } catch {
      return false;
    }
  });

  const { tasks, setTasks, tasksRef, loading, error, refresh } = useKanbanData({
    currentProjectId,
    showArchived,
    refreshProjects,
  });

  const [due, setDue] = useState<DueFilter>(() => {
    try {
      const raw = window.localStorage.getItem('cb.v2.kanban.due') ?? 'any';
      return (raw === 'any' || raw === 'overdue' || raw === 'soon' || raw === 'has' || raw === 'none' ? raw : 'any') as DueFilter;
    } catch {
      return 'any';
    }
  });

  const [tag, setTag] = useState<TagFilter>(() => {
    try {
      const raw = window.localStorage.getItem('cb.v2.kanban.tag') ?? 'all';
      return (raw?.trim() ? raw.trim() : 'all') as TagFilter;
    } catch {
      return 'all';
    }
  });

  const [context, setContext] = useState<ContextFilter>(() => {
    try {
      const raw = window.localStorage.getItem('cb.v2.kanban.context') ?? 'all';
      return (raw?.trim() ? raw.trim() : 'all') as ContextFilter;
    } catch {
      return 'all';
    }
  });

  const [currentContextKey, setCurrentContextKey] = useState<string | null>(null);

  const [assignee, setAssignee] = useState<AssigneeFilter>(() => {
    try {
      const raw = window.localStorage.getItem('cb.v2.kanban.assignee') ?? 'all';
      return (typeof raw === 'string' ? raw : 'all') as AssigneeFilter;
    } catch {
      return 'all';
    }
  });

  const [needsMe, setNeedsMe] = useState(false);

  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    try {
      const raw = window.localStorage.getItem('cb.v2.kanban.savedViews');
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((x) => typeof x === 'object' && x !== null)
        .map((x) => x as SavedView)
        .filter((x) => typeof x.id === 'string' && typeof x.name === 'string' && typeof x.filters === 'object' && x.filters);
    } catch {
      return [];
    }
  });

  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(null);
  const lastAppliedFiltersRef = useRef<SavedView['filters'] | null>(null);

  const [mode, setMode] = useState<TopbarMode>(() => {
    try {
      const raw = window.localStorage.getItem('cb.v2.kanban.mode') ?? 'board';
      return raw === 'table' ? 'table' : 'board';
    } catch {
      return 'board';
    }
  });

  const [q, setQ] = useState(() => {
    try {
      return window.localStorage.getItem('cb.v2.kanban.q') ?? '';
    } catch {
      return '';
    }
  });

  const searchRef = useRef<HTMLInputElement | null>(null);

  const [viewsOpen, setViewsOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('cb.v2.sidebar.viewsOpen') !== '0';
    } catch {
      return true;
    }
  });

  const [filtersOpen, setFiltersOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('cb.v2.sidebar.filtersOpen') !== '0';
    } catch {
      return true;
    }
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('cb.v2.sidebar.collapsed') === '1';
    } catch {
      return false;
    }
  });

  const [editTask, setEditTask] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<{ status?: TaskStatus } | null>(null);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [showRenameViewModal, setShowRenameViewModal] = useState(false);
  const [renameViewId, setRenameViewId] = useState<string | null>(null);
  const [renameViewName, setRenameViewName] = useState('');
  const renameViewRef = useRef<HTMLInputElement | null>(null);
  const [showUpdateViewConfirm, setShowUpdateViewConfirm] = useState(false);
  const [updateViewId, setUpdateViewId] = useState<string | null>(null);
  const [showDeleteViewConfirm, setShowDeleteViewConfirm] = useState(false);
  const [deleteViewId, setDeleteViewId] = useState<string | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  const overdueCount = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return tasks.filter((t) => {
      if (t.status === 'done' || !t.due_date) return false;
      const dueAt = new Date(t.due_date.includes('T') ? t.due_date : `${t.due_date}T00:00:00`);
      return dueAt < startOfToday;
    }).length;
  }, [tasks]);

  const toggleSelection = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!showRenameViewModal) return;
    requestAnimationFrame(() => renameViewRef.current?.focus());
  }, [showRenameViewModal]);

  const handleRenameView = useCallback(() => {
    const id = renameViewId;
    if (!id) return;
    const sv = savedViews.find((x) => x.id === id);
    if (!sv) return;

    const trimmed = renameViewName.trim();
    if (!trimmed || trimmed === sv.name) {
      setShowRenameViewModal(false);
      return;
    }

    setSavedViews((prev) =>
      prev.map((x) => (x.id === id ? { ...x, name: trimmed } : x))
    );
    toast.success(`View renamed to "${trimmed}"`);
    setShowRenameViewModal(false);
  }, [renameViewId, renameViewName, savedViews]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      const next = !prev;
      if (!next) clearSelection();
      return next;
    });
  }, [clearSelection]);

  // Clear selection when tasks change significantly (e.g., after delete)
  useEffect(() => {
    setSelectedIds((prev) => {
      const taskIds = new Set(tasks.map((t) => t.id));
      const next = new Set<number>();
      for (const id of prev) {
        if (taskIds.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  async function handleBulkAssign(assigneeId: string | null) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;

    try {
      const { updated } = await api.bulkAssignAssignee(
        ids,
        assigneeId ? 'agent' : null,
        assigneeId,
      );
      clearSelection();
      await refresh();

      const assigneeLabel = assigneeId ?? 'Unassigned';
      toast.success(`Assigned ${updated} task${updated === 1 ? '' : 's'} to ${assigneeLabel}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to assign tasks: ${msg}`);
    }
  }

  async function handleBulkProject(projectId: number | null) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;

    try {
      const { updated } = await api.bulkAssignProject(ids, projectId);
      clearSelection();
      await refresh();

      const targetLabel =
        projectId == null
          ? 'Unassigned'
          : (projects.find((p) => p.id === projectId)?.name ?? `Project #${projectId}`);
      toast.success(`Assigned ${updated} task${updated === 1 ? '' : 's'} to ${targetLabel}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to assign project: ${msg}`);
    }
  }

  async function handleBulkStatus(status: TaskStatus) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;

    try {
      const { updated } = await api.bulkUpdateStatus(ids, status);
      clearSelection();
      await refresh();
      toast.success(`Moved ${updated} task${updated === 1 ? '' : 's'} to ${status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to update status: ${msg}`);
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;

    try {
      const { deleted } = await api.bulkDeleteTasks(ids);
      clearSelection();
      await refresh();
      toast.success(`Deleted ${deleted} task${deleted === 1 ? '' : 's'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to delete tasks: ${msg}`);
    }
  }

  async function handleBulkDuplicate() {
    const ids = Array.from(selectedIds);
    const tasksToDuplicate = tasks.filter((t) => ids.includes(t.id));
    await Promise.all(tasksToDuplicate.map((t) => api.duplicateTask(t)));
    clearSelection();
    await refresh();
  }

  // Keyboard shortcuts (Kanban only)
  useEffect(() => {
    function isEditable(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isEditable(e.target)) return;

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setCreatePrefill(null);
        setCreateOpen(true);
      }

      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }

      // Clear bulk selection with Escape
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          e.preventDefault();
          clearSelection();
        }
      }

      // Show keyboard shortcuts help with ?
      if (e.key === '?') {
        e.preventDefault();
        setShowKeyboardHelp(true);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedIds.size, clearSelection]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.kanban.view', view);
    } catch {
      // ignore
    }
  }, [view]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.kanban.hideDone', hideDone ? '1' : '0');
    } catch {
      // ignore
    }
  }, [hideDone]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.kanban.blocked', blocked ? '1' : '0');
    } catch {
      // ignore
    }
  }, [blocked]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.kanban.showArchived', showArchived ? '1' : '0');
    } catch {
      // ignore
    }
  }, [showArchived]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.kanban.showSomeday', showSomeday ? '1' : '0');
    } catch {
      // ignore
    }
  }, [showSomeday]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.kanban.due', due);
    } catch {
      // ignore
    }
  }, [due]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.kanban.tag', tag);
    } catch {
      // ignore
    }
  }, [tag]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.kanban.context', context);
    } catch {
      // ignore
    }
  }, [context]);

  // Fetch current context key when project changes
  useEffect(() => {
    if (!currentProjectId) {
      setCurrentContextKey(null);
      return;
    }
    api.getProjectContext(currentProjectId)
      .then((ctx) => setCurrentContextKey(ctx.key))
      .catch(() => setCurrentContextKey(null));
  }, [currentProjectId]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.kanban.assignee', assignee);
    } catch {
      // ignore
    }
  }, [assignee]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.kanban.mode', mode);
    } catch {
      // ignore
    }
  }, [mode]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.kanban.q', q);
    } catch {
      // ignore
    }
  }, [q]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.kanban.savedViews', JSON.stringify(savedViews));
    } catch {
      // ignore
    }
  }, [savedViews]);

  // If user tweaks filters after applying a saved view, clear the active marker.
  useEffect(() => {
    if (!activeSavedViewId) return;
    const applied = lastAppliedFiltersRef.current;
    if (!applied) return;

    const now = { view, assignee, hideDone, blocked, showArchived, due, tag, q };
    const same =
      now.view === applied.view &&
      now.assignee === applied.assignee &&
      now.hideDone === applied.hideDone &&
      now.blocked === applied.blocked &&
      now.showArchived === applied.showArchived &&
      now.due === applied.due &&
      now.tag === applied.tag &&
      now.q === applied.q;

    if (!same) setActiveSavedViewId(null);
  }, [assignee, hideDone, blocked, q, showArchived, due, tag, view, activeSavedViewId]);

  function applySavedView(id: string) {
    const sv = savedViews.find((x) => x.id === id);
    if (!sv) return;

    const rawDue = (sv.filters as Partial<SavedView['filters']> | undefined)?.due;
    const normalizedDue: DueFilter =
      rawDue === 'any' || rawDue === 'overdue' || rawDue === 'soon' || rawDue === 'has' || rawDue === 'none'
        ? rawDue
        : 'any';

    const rawTag = (sv.filters as Partial<SavedView['filters']> | undefined)?.tag;
    const normalizedTag = typeof rawTag === 'string' && rawTag.trim() ? rawTag.trim() : 'all';

    const filters: SavedView['filters'] = {
      view: (sv.filters?.view ?? 'all') as ViewFilter,
      assignee: (sv.filters?.assignee ?? 'all') as AssigneeFilter,
      hideDone: Boolean(sv.filters?.hideDone),
      blocked: Boolean(sv.filters?.blocked),
      showArchived: Boolean(sv.filters?.showArchived),
      showSomeday: Boolean(sv.filters?.showSomeday),
      due: normalizedDue,
      tag: normalizedTag as TagFilter,
      q: (sv.filters?.q ?? '') as string,
    };

    lastAppliedFiltersRef.current = filters;
    setActiveSavedViewId(sv.id);

    setView(filters.view);
    setAssignee(filters.assignee);
    setHideDone(filters.hideDone);
    setBlocked(filters.blocked);
    setShowArchived(filters.showArchived);
    setShowSomeday(filters.showSomeday);
    setDue(filters.due);
    setTag(filters.tag);
    setQ(filters.q);
  }

  function saveCurrentView() {
    const trimmed = saveViewName.trim();
    if (!trimmed) return;

    const filters: SavedView['filters'] = { view, assignee, hideDone, blocked, showArchived, showSomeday, due, tag, q };
    const id = `sv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    const next: SavedView = { id, name: trimmed, filters };
    setSavedViews((prev) => [...prev, next]);

    lastAppliedFiltersRef.current = filters;
    setActiveSavedViewId(id);
    toast.success(`View "${trimmed}" saved`);
    setSaveViewName('');
  }

  function deleteSavedView(id: string) {
    const sv = savedViews.find((x) => x.id === id);
    if (!sv) return;

    setDeleteViewId(id);
    setShowDeleteViewConfirm(true);
  }

  function renameSavedView(id: string) {
    const sv = savedViews.find((x) => x.id === id);
    if (!sv) return;

    setRenameViewId(id);
    setRenameViewName(sv.name);
    setShowRenameViewModal(true);
  }

  function updateSavedViewFilters(id: string) {
    const sv = savedViews.find((x) => x.id === id);
    if (!sv) return;

    setUpdateViewId(id);
    setShowUpdateViewConfirm(true);
  }

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.sidebar.viewsOpen', viewsOpen ? '1' : '0');
    } catch {
      // ignore
    }
  }, [viewsOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.sidebar.filtersOpen', filtersOpen ? '1' : '0');
    } catch {
      // ignore
    }
  }, [filtersOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem('cb.v2.sidebar.collapsed', sidebarCollapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  // Open task requested from elsewhere (e.g. Activity tab)
  useEffect(() => {
    if (!openTaskId) return;
    const t = tasks.find((x) => x.id === openTaskId);
    if (!t) return;
    setEditTask(t);
    onOpenTaskConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTaskId, tasks]);

  // WS updates (simple in-memory apply)
  // Depend on the whole wsSignal object so consecutive same-type events are still processed.
  useEffect(() => {
    if (!wsSignal?.type) return;

    try {
      if (wsSignal.type === 'task_created' && wsSignal.data) {
        const t = wsSignal.data as Task;
        setTasks((prev) => {
          if (prev.some((x) => x.id === t.id)) return prev;
          return [t, ...prev];
        });
        return;
      }

      if (wsSignal.type === 'task_updated' && wsSignal.data) {
        const t = wsSignal.data as Task;
        setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
        return;
      }

      if (wsSignal.type === 'task_deleted' && wsSignal.data) {
        const data = wsSignal.data;
        if (typeof data === 'object' && data !== null && 'id' in data) {
          const id = Number((data as { id: unknown }).id);
          setTasks((prev) => prev.filter((x) => x.id !== id));
          return;
        }
      }

      const t = String(wsSignal.type);
      if (t.startsWith('task_') || t.startsWith('tasks_')) {
        refresh();
      }
    } catch {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsSignal]);

  const baseFiltered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const wantAssignee: string | null | 'all' = assignee === 'all' ? 'all' : assignee === '' ? null : assignee;
    const wantTag = (tag ?? 'all') === 'all' ? 'all' : String(tag);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const soonEnd = new Date(startOfToday);
    soonEnd.setDate(soonEnd.getDate() + 7);

    function parseDueDate(raw: string): Date | null {
      if (!raw) return null;
      const d = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
      if (!Number.isFinite(d.getTime())) return null;
      return d;
    }

    return tasks.filter((t) => {
      if (needsMe) {
        const isHumanTask = t.assigned_to_type === 'human' && t.status !== 'done';
        const isInReview = t.status === 'review';
        if (!isHumanTask && !isInReview) return false;
      } else {
        if (wantAssignee !== 'all' && (t.assigned_to_id ?? null) !== wantAssignee) return false;
      }
      if (wantTag !== 'all' && !(Array.isArray(t.tags) && t.tags.includes(wantTag))) return false;
      if (hideDone && t.status === 'done') return false;
      if (blocked && !t.blocked_reason && !t.is_dependency_blocked) return false;
      if (!showSomeday && t.is_someday) return false;

      // Context filtering
      if (context !== 'all' && currentContextKey) {
        const taskContext = t.context_key ?? null;
        if (context === 'current' && taskContext !== currentContextKey) return false;
      }

      if (due !== 'any') {
        const dueAt = parseDueDate(String(t.due_date ?? '').trim());
        const hasDue = !!dueAt;

        if (due === 'has' && !hasDue) return false;
        if (due === 'none' && hasDue) return false;

        if (due === 'overdue') {
          if (!hasDue) return false;
          if (dueAt! >= startOfToday) return false;
        }

        if (due === 'soon') {
          if (!hasDue) return false;
          if (dueAt! < startOfToday) return false;
          if (dueAt! > soonEnd) return false;
        }
      }

      if (!query) return true;
      const hay = `${t.title}\n${t.description ?? ''}\n${t.id}\n${t.status}\n${t.assigned_to_id ?? ''}\n${Array.isArray(t.tags) ? t.tags.join(' ') : ''}`.toLowerCase();
      return hay.includes(query);
    });
  }, [needsMe, assignee, tag, hideDone, blocked, showSomeday, q, tasks, due, context, currentContextKey]);

  const [tagOptions, setTagOptions] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    api
      .listTags()
      .then((tags) => {
        if (active) setTagOptions(tags);
      })
      .catch(() => {
        // swallow tag load errors; tagging still works from task data
      });

    return () => {
      active = false;
    };
  }, [tasks]);

  const viewCounts = useMemo(() => {
    const counts: Record<TaskStatus, number> = {
      backlog: 0,
      in_progress: 0,
      review: 0,
      done: 0,
    };
    for (const t of baseFiltered) {
      if (counts[t.status as TaskStatus] != null) counts[t.status as TaskStatus] += 1;
    }
    return counts;
  }, [baseFiltered]);

  const handleSortKey = useCallback((next: KanbanSortKey) => {
    setSortKey(next);
    setSortDir((prev) => (next === sortKey ? prev : SORT_OPTIONS[next].defaultDir));
  }, [sortKey]);

  const visibleTasks = useMemo(() => {
    if (needsMe || view === 'all') return baseFiltered;
    return baseFiltered.filter((t) => t.status === view);
  }, [needsMe, baseFiltered, view]);

  const handleDeleteProject = useCallback(async (id: number) => {
    try {
      await api.deleteProject(id, false); // false = unlink tasks, don't delete them
      // Switch to "All Projects" if we just deleted the current project
      if (currentProjectId === id) {
        setCurrentProjectId(null);
        navigate('/');
      }
      // Refresh project list
      await refreshProjects();
      toast.success('Project deleted');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to delete project: ${msg}`);
    }
  }, [currentProjectId, setCurrentProjectId, navigate, refreshProjects]);

  const handleRenameProject = useCallback(async (id: number, name: string) => {
    try {
      const updated = await api.updateProject(id, { name });
      updateProjectLocal(updated);
      toast.success(`Project renamed to "${updated.name}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to rename project: ${msg}`);
    }
  }, [updateProjectLocal]);

  const handleAssignUnassignedTasks = useCallback(async (projectId: number) => {
    try {
      const { updated } = await api.assignUnassignedTasks(projectId);
      await refresh();
      toast.success(`Assigned ${updated} task${updated === 1 ? '' : 's'} to this project`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to assign tasks: ${msg}`);
    }
  }, [refresh]);

  const projectName = currentProject?.name ?? (currentProjectId === null ? 'All Projects' : 'Pawvy');
  const boardName = 'Tasks';


  const viewItems = useMemo(
    () => [
      { key: 'all' as const, label: 'All', count: baseFiltered.length },
      ...COLUMNS.map((c) => ({ key: c.key, label: c.title, count: viewCounts[c.key] })),
    ],
    [baseFiltered.length, viewCounts],
  );

  const myQueueCount = useMemo(
    () => tasks.filter((t) => (t.assigned_to_type === 'human' && t.status !== 'done') || t.status === 'review').length,
    [tasks],
  );

  const sidebar = (
    <Sidebar
      projectName={projectName}
      projects={projects}
      currentProjectId={currentProjectId}
      onProjectChange={handleProjectChange}
      onRefreshProjects={refreshProjects}
      onDeleteProject={handleDeleteProject}
      onRenameProject={handleRenameProject}
      collapsed={sidebarCollapsed}
      onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
      viewsOpen={viewsOpen}
      onToggleViewsOpen={() => setViewsOpen((v) => !v)}
      filtersOpen={filtersOpen}
      onToggleFiltersOpen={() => setFiltersOpen((v) => !v)}
      view={view}
      onView={setView}
      viewItems={viewItems}
      savedViews={savedViews.map((sv) => ({ id: sv.id, name: sv.name }))}
      activeSavedViewId={activeSavedViewId}
      onApplySavedView={applySavedView}
      onSaveCurrentView={saveCurrentView}
      onSaveViewName={setSaveViewName}
      onAssignUnassignedTasks={handleAssignUnassignedTasks}
      onDeleteSavedView={deleteSavedView}
      onRenameSavedView={renameSavedView}
      onUpdateSavedViewFilters={updateSavedViewFilters}
      assignee={assignee}
      onAssignee={setAssignee}
      hideDone={hideDone}
      onHideDone={setHideDone}
      blocked={blocked}
      onBlocked={setBlocked}
      due={due}
      onDue={setDue}
      tag={tag}
      tagOptions={tagOptions}
      onTag={setTag}
      showArchived={showArchived}
      onShowArchived={setShowArchived}
      showSomeday={showSomeday}
      onShowSomeday={setShowSomeday}
      onArchiveDone={() => {
        setShowArchiveConfirm(true);
      }}
      context={context}
      onContext={setContext}
      currentContextKey={currentContextKey}
      onReset={() => {
        setQ('');
        setAssignee('all');
        setView('all');
        setNeedsMe(false);
        setHideDone(false);
        setBlocked(false);
        setShowArchived(false);
        setShowSomeday(false);
        setDue('any');
        setTag('all');
        setContext('all');
      }}
      onMyQueue={() => setNeedsMe((v) => !v)}
      myQueueActive={needsMe}
      myQueueCount={myQueueCount}
    />
  );

  const topbar = (
    <Topbar
      boardName={boardName}
      mode={mode}
      onMode={setMode}
      q={q}
      onQ={setQ}
      searchRef={searchRef}
      onCreate={() => {
        setCreatePrefill(null);
        setCreateOpen(true);
      }}
      showSelectionToggle={mode === 'board'}
      selectionActive={selectionMode}
      onToggleSelection={toggleSelectionMode}
      showSort={mode === 'board'}
      sortKey={sortKey}
      sortDir={sortDir}
      sortOptions={Object.entries(SORT_OPTIONS).map(([key, opt]) => ({ key, label: opt.label }))}
      onSortKey={(key) => handleSortKey(key as KanbanSortKey)}
      onSortDir={setSortDir}
    />
  );

  return (
    <>
      <AppShell
        sidebar={sidebar}
        sidebarCollapsed={sidebarCollapsed}
        topbar={topbar}
        wsSignal={wsSignal}
        wsStatus={wsStatus}
        initialAgentIds={initialAgentIds}
        agentProfileSources={agentProfileSources}
        contentClassName="cb-scrollbar-hover"
      >
        {overdueCount > 0 && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-600">
                !
              </span>
              <span className="font-medium">
                {overdueCount} task{overdueCount === 1 ? ' is' : 's are'} overdue.
              </span>
            </div>
            <button
              onClick={() => {
                setDue('overdue');
                setView('all');
              }}
              className="text-xs font-semibold uppercase tracking-wider text-red-600 hover:text-red-700 hover:underline"
            >
              View all
            </button>
          </div>
        )}
        {loading ? <div className="text-sm text-[rgb(var(--cb-text-muted))]">Loading…</div> : null}
        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <div>Failed to load tasks: {error}</div>
            <div className="mt-2">
              <button
                type="button"
                className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200"
                onClick={refresh}
              >
                Retry
              </button>
            </div>
          </div>
        ) : null}

        {!loading && visibleTasks.length === 0 ? (
          <div className="rounded-xl border border-[rgb(var(--cb-border))] bg-[rgb(var(--cb-surface))] p-8 text-center">
            {currentProjectId !== null && tasks.length === 0 ? (
              <div className="mx-auto max-w-md">
                <div className="mb-3 text-4xl">📂</div>
                <div className="mb-2 text-lg font-semibold text-[rgb(var(--cb-text))]">
                  {currentProject?.name ? `No tasks in ${currentProject.name}` : 'No tasks in this project'}
                </div>
                <div className="mb-4 text-sm text-[rgb(var(--cb-text-muted))]">
                  Get started by creating your first task
                </div>
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  Create First Task
                </Button>
              </div>
            ) : currentProjectId === null && tasks.length === 0 ? (
              <div className="mx-auto max-w-md">
                <div className="mb-3 text-4xl">🎯</div>
                <div className="mb-2 text-lg font-semibold text-[rgb(var(--cb-text))]">No tasks yet</div>
                <div className="mb-4 text-sm text-[rgb(var(--cb-text-muted))]">
                  Create your first task to get started
                </div>
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  Create Task
                </Button>
              </div>
            ) : (
              <div className="text-sm text-[rgb(var(--cb-text-muted))]">No tasks match your filters.</div>
            )}
          </div>
        ) : null}

        <div className={clsx((loading || error) && 'mt-3')}>
          {mode === 'table' ? (
            <TaskTable
              tasks={visibleTasks}
              onOpen={(t) => {
                setEditTask(t);
              }}
            />
          ) : (
            <KanbanBoard
              tasks={visibleTasks}
              tasksAll={tasks}
              tasksRef={tasksRef}
              onSetTasks={setTasks}
              onRefresh={refresh}
              onEditTask={(t) => setEditTask(t)}
              onQuickCreate={async (status, title) => {
                const trimmed = title.trim();
                if (!trimmed) return;

                const assignedToId =
                  assignee === 'all' ? null : assignee === '' ? null : assignee;

                await api.createTask({
                  title: trimmed,
                  status,
                  assigned_to_type: assignedToId ? 'agent' : null,
                  assigned_to_id: assignedToId,
                  project_id: currentProjectId ?? undefined,
                });
                await refresh();
              }}
              selectedIds={selectedIds}
              onToggleSelection={toggleSelection}
              showCheckboxes={selectionMode}
              sortKey={sortKey}
              sortDir={sortDir}
              projects={projects}
              currentProjectId={currentProjectId}
            />
          )}
        </div>
      </AppShell>

      {editTask ? (
        <EditTaskModal
          task={editTask}
          allTasks={tasks}
          tagOptions={tagOptions}
          projects={projects}
          onClose={() => setEditTask(null)}
          onSave={async (patch) => {
            const normalizedTags =
              typeof patch.tags === 'string'
                ? patch.tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                : patch.tags;

            await api.updateTask(editTask.id, { ...patch, tags: normalizedTags });
            setEditTask(null);
            await refresh();
          }}
          onDelete={async () => {
            await api.deleteTask(editTask.id);
            setEditTask(null);
            await refresh();
          }}        />
      ) : null}

      {createOpen ? (
        <CreateTaskModal
          initialStatus={createPrefill?.status}
          initialProjectId={currentProjectId}
          allTasks={tasks}
          tagOptions={tagOptions}
          projects={projects}
          onClose={() => {
            setCreateOpen(false);
            setCreatePrefill(null);
          }}
          onCreate={async (body) => {
            const normalizedTags =
              typeof body.tags === 'string'
                ? body.tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                : body.tags;

            await api.createTask({ ...body, tags: normalizedTags });
            setCreateOpen(false);
            setCreatePrefill(null);
            await refresh();
          }}
        />
      ) : null}

      {selectedIds.size > 0 ? (
        <BulkActionBar
          count={selectedIds.size}
          projects={projects}
          onClearSelection={clearSelection}
          onBulkAssign={handleBulkAssign}
          onBulkStatus={handleBulkStatus}
          onBulkProject={handleBulkProject}
          onBulkDelete={handleBulkDelete}
          onBulkDuplicate={handleBulkDuplicate}
        />
      ) : null}

      {showKeyboardHelp ? (
        <KeyboardHelpModal onClose={() => setShowKeyboardHelp(false)} />
      ) : null}

      {showArchiveConfirm && createPortal(
        <ConfirmModal
          title="Archive done tasks"
          message={`Archive all done tasks (${assignee === 'all' ? 'all assignees' : assignee === '' ? 'unassigned only' : assignee})?`}
          confirmLabel={archiveBusy ? 'Archiving...' : 'Archive done tasks'}
          variant="primary"
          onConfirm={async () => {
            if (archiveBusy) return;
            setArchiveBusy(true);
            try {
              const body = assignee === 'all'
                ? undefined
                : {
                    assigned_to_type: assignee === '' ? null : ('agent' as const),
                    assigned_to_id: assignee === '' ? null : assignee,
                  };
              await api.archiveDone(body);
              await refresh();
              setShowArchiveConfirm(false);
            } finally {
              setArchiveBusy(false);
            }
          }}
          onClose={() => setShowArchiveConfirm(false)}
        />,
        document.body
      )}

      {showRenameViewModal && createPortal(
        <RenameViewModal
          name={renameViewName}
          inputRef={renameViewRef}
          onNameChange={setRenameViewName}
          onClose={() => setShowRenameViewModal(false)}
          onConfirm={handleRenameView}
        />,
        document.body
      )}

      {showUpdateViewConfirm && createPortal(
        <ConfirmModal
          title="Update saved view"
          message={`Update "${savedViews.find((x) => x.id === updateViewId)?.name ?? 'this view'}" with current filters?`}
          confirmLabel="Update view"
          variant="primary"
          onConfirm={() => {
            const id = updateViewId;
            if (!id) return;
            const sv = savedViews.find((x) => x.id === id);
            if (!sv) return;

            const filters: SavedView['filters'] = { view, assignee, hideDone, blocked, showArchived, showSomeday, due, tag, q };
            setSavedViews((prev) =>
              prev.map((x) => (x.id === id ? { ...x, filters } : x))
            );
            lastAppliedFiltersRef.current = filters;
            setActiveSavedViewId(id);
            toast.success(`View "${sv.name}" filters updated`);
            setShowUpdateViewConfirm(false);
          }}
          onClose={() => setShowUpdateViewConfirm(false)}
        />,
        document.body
      )}

      {showDeleteViewConfirm && createPortal(
        <ConfirmModal
          title="Delete saved view"
          message={`Delete "${savedViews.find((x) => x.id === deleteViewId)?.name ?? 'this view'}"? This cannot be undone.`}
          confirmLabel="Delete view"
          variant="danger"
          onConfirm={() => {
            const id = deleteViewId;
            if (!id) return;
            const sv = savedViews.find((x) => x.id === id);
            if (!sv) return;

            setSavedViews((prev) => prev.filter((x) => x.id !== id));
            if (activeSavedViewId === id) {
              setActiveSavedViewId(null);
              lastAppliedFiltersRef.current = null;
            }
            toast.show(`View "${sv.name}" deleted`);
            setShowDeleteViewConfirm(false);
          }}
          onClose={() => setShowDeleteViewConfirm(false)}
        />,
        document.body
      )}
    </>
  );
}

type RenameViewModalProps = {
  name: string;
  inputRef: { current: HTMLInputElement | null };
  onNameChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

function RenameViewModal({ name, inputRef, onNameChange, onClose, onConfirm }: RenameViewModalProps) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm cb-modal-pop"
      >
        <Panel className="p-6 shadow-xl">
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-lg font-bold text-[rgb(var(--cb-text))]">Rename saved view</h3>
              <p className="mt-1 text-sm text-[rgb(var(--cb-text-muted))]">Update the name for this view.</p>
            </div>
            <Input
              ref={inputRef}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="View name"
            />
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={onConfirm}
              >
                Rename
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
