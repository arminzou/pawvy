import {
  DndContext,
  DragOverlay,
  PointerSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { AlertTriangle, Clock, Flag, FolderOpen, GripVertical, Hash, MoreHorizontal, Plus, User, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { api } from '../../lib/api';
import type { Project, Task, TaskStatus } from '../../lib/api';
import { formatDate, formatDateTimeSmart, formatRelativeTime } from '../../lib/date';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Chip } from '../../components/ui/Chip';
import { Input } from '../../components/ui/Input';
import { Menu } from '../../components/ui/Menu';

const COLUMNS: { key: TaskStatus; title: string }[] = [
  { key: 'backlog', title: 'Backlog' },
  { key: 'in_progress', title: 'In Progress' },
  { key: 'review', title: 'Review' },
  { key: 'done', title: 'Done' },
];

export type KanbanSortKey = 'updated' | 'created' | 'due' | 'priority';
export type KanbanSortDir = 'asc' | 'desc';

function statusLabel(s: TaskStatus) {
  return COLUMNS.find((c) => c.key === s)?.title ?? s;
}

export function KanbanBoard({
  tasks,
  tasksAll,
  tasksRef,
  onSetTasks,
  onRefresh,
  onEditTask,
  onQuickCreate,
  selectedIds,
  onToggleSelection,
  showCheckboxes,
  sortKey,
  sortDir,
  projects,
  currentProjectId,
}: {
  tasks: Task[];
  tasksAll: Task[];
  tasksRef: { current: Task[] };
  onSetTasks: Dispatch<SetStateAction<Task[]>>;
  onRefresh: () => Promise<void>;
  onEditTask: (t: Task) => void;
  onQuickCreate: (status: TaskStatus, title: string) => Promise<void> | void;
  selectedIds?: Set<number>;
  onToggleSelection?: (id: number) => void;
  showCheckboxes?: boolean;
  sortKey: KanbanSortKey;
  sortDir: KanbanSortDir;
  projects?: Project[];
  currentProjectId?: number | null;
}) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeRect, setActiveRect] = useState<{ width: number; height: number } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );



  function parseDateValue(raw: string | null | undefined): number {
    if (!raw) return 0;
    let d: Date;
    if (raw.includes('T')) {
      d = new Date(raw);
    } else if (raw.includes(' ')) {
      d = new Date(raw.replace(' ', 'T') + 'Z');
    } else {
      d = new Date(`${raw}T00:00:00`);
    }
    return Number.isFinite(d.getTime()) ? d.getTime() : 0;
  }

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      backlog: [],
      in_progress: [],
      review: [],
      done: [],
    };

    for (const t of tasks) {
      const bucket = map[t.status as TaskStatus];
      if (bucket) bucket.push(t);
    }

    const priorityOrder: Record<string, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
      '': 4,
    };

    const compare = (a: Task, b: Task) => {
      let cmp = 0;
      switch (sortKey) {
        case 'created':
          cmp = parseDateValue(a.created_at) - parseDateValue(b.created_at);
          break;
        case 'due': {
          const aDue = a.due_date ? parseDateValue(a.due_date) : sortDir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
          const bDue = b.due_date ? parseDateValue(b.due_date) : sortDir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
          cmp = aDue - bDue;
          break;
        }
        case 'priority': {
          const aKey = priorityOrder[String(a.priority ?? '').trim()] ?? 99;
          const bKey = priorityOrder[String(b.priority ?? '').trim()] ?? 99;
          cmp = aKey - bKey;
          break;
        }
        case 'updated':
        default:
          cmp = parseDateValue(a.updated_at ?? a.created_at) - parseDateValue(b.updated_at ?? b.created_at);
          break;
      }

      if (cmp === 0) cmp = a.id - b.id;
      return sortDir === 'asc' ? cmp : -cmp;
    };

    for (const k of Object.keys(map) as TaskStatus[]) {
      map[k].sort(compare);
    }

    return map;
  }, [tasks, sortKey, sortDir]);

  const activeTask = useMemo(() => {
    if (!activeTaskId) return null;
    return tasksAll.find((t) => String(t.id) === activeTaskId) ?? null;
  }, [activeTaskId, tasksAll]);

  async function onDragEnd(evt: DragEndEvent) {
    const { active, over } = evt;
    setActiveTaskId(null);
    setActiveRect(null);
    if (!over) return;

    const activeId = String(active.id);
    const overKey = String(over.id);

    const targetStatus = COLUMNS.find((c) => c.key === overKey)?.key ?? null;
    if (!targetStatus) return;

    const activeTask = tasksRef.current.find((t) => String(t.id) === activeId);
    if (!activeTask || activeTask.status === targetStatus) return;

    onSetTasks((prev) => prev.map((t) => (t.id === activeTask.id ? { ...t, status: targetStatus } : t)));

    try {
      await api.updateTask(activeTask.id, { status: targetStatus });
    } finally {
      await onRefresh();
    }
  }

  return (
    <div className="h-full">
      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        autoScroll
        onDragStart={(evt) => {
          setActiveTaskId(String(evt.active.id));
          const rect = evt.active.rect.current?.initial ?? evt.active.rect.current?.translated;
          if (rect?.width && rect?.height) setActiveRect({ width: rect.width, height: rect.height });
        }}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveTaskId(null);
          setActiveRect(null);
        }}
      >
        <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.key}
              id={col.key}
              title={col.title}
              count={byStatus[col.key].length}
              tasks={byStatus[col.key]}
              activeTaskId={activeTaskId}
              onOpenTask={onEditTask}
              onQuickCreate={onQuickCreate}
              selectedIds={selectedIds}
              onToggleSelection={onToggleSelection}
              showCheckboxes={showCheckboxes}
              projects={projects}
              currentProjectId={currentProjectId}
            />
          ))}
        </div>

        <DragOverlay adjustScale={false}>
          {activeTask ? (
            <div style={activeRect ? { width: activeRect.width, height: activeRect.height } : undefined}>
              <TaskCard task={activeTask} dragging projects={projects} currentProjectId={currentProjectId} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function KanbanColumn({
  id,
  title,
  count,
  tasks,
  activeTaskId,
  onOpenTask,
  onQuickCreate,
  selectedIds,
  onToggleSelection,
  showCheckboxes,
  projects,
  currentProjectId,
}: {
  id: TaskStatus;
  title: string;
  count: number;
  tasks: Task[];
  activeTaskId: string | null;
  onOpenTask: (t: Task) => void;
  onQuickCreate: (status: TaskStatus, title: string) => Promise<void> | void;
  selectedIds?: Set<number>;
  onToggleSelection?: (id: number) => void;
  showCheckboxes?: boolean;
  projects?: Project[];
  currentProjectId?: number | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const showDropHint = !!activeTaskId && isOver;

  const [quickOpen, setQuickOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);
  const quickRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!quickOpen) return;
    requestAnimationFrame(() => quickRef.current?.focus());
  }, [quickOpen]);

  async function submitQuick() {
    const trimmed = quickTitle.trim();
    if (!trimmed || quickSaving) return;

    setQuickSaving(true);
    try {
      await onQuickCreate(id, trimmed);
      setQuickTitle('');
      requestAnimationFrame(() => quickRef.current?.focus());
    } finally {
      setQuickSaving(false);
    }
  }

  return (
    <div
      className={clsx(
        'flex min-h-[20rem] flex-col rounded-xl border border-[rgb(var(--cb-column-border))] bg-[rgb(var(--cb-surface-muted))] shadow-sm transition',
        showDropHint && 'ring-2 ring-[rgb(var(--cb-accent)/0.1)] shadow-md',
      )}
      data-testid={`kanban-column-${id}`}
    >
      <div className="flex items-center justify-between px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-semibold text-[rgb(var(--cb-text))]">{title}</div>
          <div className="rounded-full bg-[rgb(var(--cb-accent-soft))] px-1.5 py-0.5 text-[11px] font-medium text-[rgb(var(--cb-text))]">{count}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-lg text-[rgb(var(--cb-text-muted))] hover:text-[rgb(var(--cb-text))]"
            onClick={() => {
              setQuickOpen((v) => !v);
              setQuickTitle('');
            }}
            title={quickOpen ? `Close quick add` : `Quick add to ${title}`}
            aria-label={quickOpen ? `Close quick add` : `Quick add to ${title}`}
          >
            {quickOpen ? <X size={14} /> : <Plus size={14} />}
          </Button>
          <Menu
            align="right"
            items={[
              {
                key: 'add',
                label: quickOpen ? 'Focus quick add' : 'Quick add task',
                onSelect: () => {
                  if (!quickOpen) setQuickOpen(true);
                  requestAnimationFrame(() => quickRef.current?.focus());
                },
              },
              {
                key: 'close',
                label: 'Close quick add',
                disabled: !quickOpen,
                onSelect: () => {
                  setQuickOpen(false);
                  setQuickTitle('');
                },
              },
            ]}
            trigger={({ toggle }) => (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-8 w-8 rounded-lg text-[rgb(var(--cb-text-muted))] hover:text-[rgb(var(--cb-text))]"
                title="Menu"
                aria-label="Menu"
                onClick={toggle}
              >
                <MoreHorizontal size={14} />
              </Button>
            )}
          />
        </div>
      </div>

      <div
        ref={setNodeRef}
        data-testid={`kanban-drop-${id}`}
        className={clsx(
          'relative flex-1 p-2',
        )}
      >
        {showDropHint ? (
          <div className="pointer-events-none absolute inset-2 rounded-xl bg-[rgb(var(--cb-accent)/0.04)]" />
        ) : null}

        {quickOpen ? (
          <div className="mb-2 rounded-xl border border-[rgb(var(--cb-border))] bg-[rgb(var(--cb-surface))] p-2 shadow-sm">
            <Input
              ref={quickRef}
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              placeholder={`Add to ${title}…`}
              disabled={quickSaving}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setQuickOpen(false);
                  setQuickTitle('');
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitQuick();
                }
              }}
            />
            <div className="mt-1 text-[11px] text-[rgb(var(--cb-text-muted))]">Enter to create · Esc to cancel</div>
          </div>
        ) : null}

        <div className="flex min-h-[18rem] flex-col gap-1.5">
          {tasks.map((t) => (
            <DraggableTask
              key={t.id}
              task={t}
              onOpen={() => onOpenTask(t)}
              isSelected={selectedIds?.has(t.id)}
              onToggleSelection={onToggleSelection}
              showCheckbox={showCheckboxes}
              projects={projects}
              currentProjectId={currentProjectId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function statusChipClasses(status: TaskStatus) {
  return clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', {
    'bg-slate-100 text-slate-700 ring-slate-200': status === 'backlog',
    'bg-indigo-100 text-indigo-800 ring-indigo-200': status === 'in_progress',
    'bg-purple-100 text-purple-800 ring-purple-200': status === 'review',
    'bg-emerald-100 text-emerald-800 ring-emerald-200': status === 'done',
  });
}

function priorityChipClasses(priority: Task['priority']) {
  return clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', {
    'bg-slate-100 text-slate-700 ring-slate-200': priority === 'low',
    'bg-blue-100 text-blue-800 ring-blue-200': priority === 'medium',
    'bg-amber-100 text-amber-900 ring-amber-200': priority === 'high',
    'bg-red-100 text-red-800 ring-red-200': priority === 'urgent',
  });
}

function MetaRow({
  icon,
  label,
  value,
  title,
  mono,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-[rgb(var(--cb-text-muted))]" title={title}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[rgb(var(--cb-text-muted))] group-hover:text-[rgb(var(--cb-text))]">{icon}</span>
        <span className="truncate group-hover:text-[rgb(var(--cb-text))]">{label}</span>
      </div>
      <span className={clsx('shrink-0 font-medium text-[rgb(var(--cb-text))]', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

type DragHandleProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

const TaskCard = memo(
  function TaskCard({
    task,
    onOpen,
    dragging,
    isSelected,
    onToggleSelection,
    showCheckbox,
    dragHandleProps,
    projects,
    currentProjectId,
  }: {
    task: Task;
    onOpen?: () => void;
    dragging?: boolean;
    isSelected?: boolean;
    onToggleSelection?: (id: number) => void;
    showCheckbox?: boolean;
    dragHandleProps?: DragHandleProps;
    projects?: Project[];
    currentProjectId?: number | null;
  }) {
    // Compute project label: show only in "All Projects" view (currentProjectId === null)
    const projectLabel = (() => {
      if (currentProjectId !== null) return null; // Viewing specific project
      if (task.project_id == null) return null; // Task has no project
      const projectName = (projects || []).find(p => p.id === task.project_id)?.name;
      return projectName || `Project #${task.project_id}`;
    })();

    const dueLabel = formatDate(task.due_date);
    const updatedRelative = formatRelativeTime(task.updated_at ?? task.created_at);
    const updatedTitle = formatDateTimeSmart(task.updated_at ?? task.created_at);
    const assigneeLabel = task.assigned_to_id ?? '—';
    const dependencyBlocked = Boolean(task.is_dependency_blocked);
    const isBlocked = Boolean(task.blocked_reason || dependencyBlocked);
    const isReady = !isBlocked && task.status !== 'done';
    const anchorDisplay = (() => {
      if (!task.resolved_anchor) return null;
      const parts = task.resolved_anchor.split('/').filter(Boolean);
      if (parts.length <= 2) return task.resolved_anchor;
      return `.../${parts.slice(-2).join('/')}`;
    })();

    function handleCheckboxClick(e: React.MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelection?.(task.id);
    }

    return (
      <div
        data-testid={`task-card-${task.id}`}
        className={clsx(
          'group w-full rounded-lg border border-[rgb(var(--cb-border))] bg-[rgb(var(--cb-surface))] p-2 text-left shadow-sm will-change-transform hover:border-[rgb(var(--cb-accent)/0.34)] dark:hover:border-[rgb(var(--cb-accent-text)/0.40)]',
          dragging ? 'transition-none shadow-lg ring-1 ring-[rgb(var(--cb-border))]' : 'transition',
          isBlocked && !dragging ? 'opacity-75' : '',
          isSelected ? 'ring-2 ring-[rgb(var(--cb-accent)/0.2)]' : '',
        )}
      >
        <div className="flex items-start gap-2">
          {showCheckbox || isSelected ? (
            <button
              type="button"
              className="shrink-0 pt-0.5 outline-none"
              onClick={handleCheckboxClick}
            >
              <Checkbox checked={isSelected} size="sm" readOnly tabIndex={-1} />
            </button>
          ) : null}

          <button
            type="button"
            className="min-w-0 flex-1 whitespace-normal line-clamp-2 text-sm font-semibold leading-snug text-[rgb(var(--cb-text))] outline-none text-left"
            onClick={onOpen}
          >
            {task.title}
          </button>

          <Button
            type="button"
            className={clsx(
              'h-7 w-7 shrink-0 rounded-md p-0 text-[rgb(var(--cb-text-muted))] hover:text-[rgb(var(--cb-text))] cursor-grab active:cursor-grabbing'
            )}
            variant="ghost"
            size="icon"
            aria-label="Drag task"
            title="Drag task"
            data-testid={`task-drag-handle-${task.id}`}
            {...dragHandleProps}
          >
            <GripVertical size={16} />
          </Button>
        </div>

        <button
          type="button"
          className="w-full mt-1.5 outline-none text-left"
          onClick={onOpen}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={statusChipClasses(task.status)}>{statusLabel(task.status)}</span>
            {task.priority ? <span className={priorityChipClasses(task.priority)}>{task.priority}</span> : null}
            {task.blocked_reason ? (
              <Chip variant="neutral" className="text-[11px] py-0.5" title={task.blocked_reason}>
                blocked
              </Chip>
            ) : null}
            {dependencyBlocked ? (
              <Chip variant="neutral" className="text-[11px] py-0.5" title="Blocked by one or more dependency tasks">
                blocked by deps
              </Chip>
            ) : null}
            {isReady ? (
              <Chip variant="soft" className="text-[11px] py-0.5">
                ready
              </Chip>
            ) : null}
            {Array.isArray(task.tags) && task.tags.length
              ? task.tags.slice(0, 3).map((t) => (
                  <Chip key={t} variant="neutral" className="text-[11px] py-0.5">
                    {t}
                  </Chip>
                ))
              : null}
          </div>

          <div className="mt-2 flex flex-col gap-1">
            <MetaRow icon={<Hash size={14} />} label="Task ID" value={`#${task.id}`} mono />
            <MetaRow icon={<User size={14} />} label="Assignee" value={assigneeLabel} />
            {projectLabel ? <MetaRow icon={<FolderOpen size={14} />} label="Project" value={projectLabel} /> : null}
            {anchorDisplay ? (
              <MetaRow
                icon={<span className="text-[10px] font-bold opacity-70">ANC</span>}
                label={`Anchor (${task.anchor_source ?? 'path'})`}
                value={anchorDisplay}
                title={task.resolved_anchor ?? undefined}
              />
            ) : null}
            {task.context_key ? (
              <MetaRow
                icon={<span className="text-[10px] font-bold opacity-70">CTX</span>}
                label={task.context_type ?? 'context'}
                value={task.context_key}
              />
            ) : null}
            {task.blocked_reason ? <MetaRow icon={<AlertTriangle size={14} />} label="Blocked" value="Manual" title={task.blocked_reason} /> : null}
            {dependencyBlocked ? <MetaRow icon={<AlertTriangle size={14} />} label="Blocked" value="Dependencies" /> : null}
            {task.blocked_by_task_ids.length > 0 ? (
              <MetaRow icon={<Hash size={14} />} label="Blocked by" value={task.blocked_by_task_ids.map((id) => `#${id}`).join(', ')} />
            ) : null}
            {task.blocks_task_ids.length > 0 ? (
              <MetaRow icon={<Hash size={14} />} label="Unblocks" value={task.blocks_task_ids.map((id) => `#${id}`).join(', ')} />
            ) : null}
            {task.due_date ? <MetaRow icon={<Flag size={14} />} label="Due" value={dueLabel || '—'} title={task.due_date} /> : null}
            <div
              className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-[rgb(var(--cb-text-muted))]"
              title={updatedTitle || task.updated_at || task.created_at}
            >
              <Clock size={12} />
              <span>Updated</span>
              <span className="text-[rgb(var(--cb-text))]">{updatedRelative || '—'}</span>
            </div>
          </div>
        </button>
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.dragging === next.dragging &&
      prev.isSelected === next.isSelected &&
      prev.showCheckbox === next.showCheckbox &&
      prev.task.id === next.task.id &&
      prev.task.updated_at === next.task.updated_at &&
      prev.task.status === next.task.status &&
      prev.task.created_at === next.task.created_at &&
      prev.task.completed_at === next.task.completed_at &&
      prev.task.project_id === next.task.project_id &&
      prev.currentProjectId === next.currentProjectId &&
      prev.projects === next.projects
    );
  }
);

function DraggableTask({
  task,
  onOpen,
  isSelected,
  onToggleSelection,
  showCheckbox,
  projects,
  currentProjectId,
}: {
  task: Task;
  onOpen: () => void;
  isSelected?: boolean;
  onToggleSelection?: (id: number) => void;
  showCheckbox?: boolean;
  projects?: Project[];
  currentProjectId?: number | null;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(task.id),
  });

  const style = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    opacity: isDragging ? 0 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx('select-none w-full')}
    >
      <TaskCard
        task={task}
        onOpen={onOpen}
        dragging={isDragging}
        isSelected={isSelected}
        onToggleSelection={onToggleSelection}
        showCheckbox={showCheckbox}
        dragHandleProps={{ ...attributes, ...listeners }}
        projects={projects}
        currentProjectId={currentProjectId}
      />
    </div>
  );
}
