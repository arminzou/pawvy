import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, CheckCircle2, ChevronDown, Clock, Trash2 } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import type { AssigneeType, Project, Task, TaskPriority, TaskStatus } from '../../lib/api';
import { formatDateTimeFull } from '../../lib/date';
import { useAgents } from '../../hooks/useAgents';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Chip } from '../../components/ui/Chip';
import { Input } from '../../components/ui/Input';
import { Panel } from '../../components/ui/Panel';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { Menu } from '../../components/ui/Menu';

const COLUMNS: { key: TaskStatus; title: string }[] = [
  { key: 'backlog', title: 'Backlog' },
  { key: 'in_progress', title: 'In Progress' },
  { key: 'review', title: 'Review' },
  { key: 'done', title: 'Done' },
];

function normalizeTag(value: string): string {
  return value.trim();
}

function mergeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of tags) {
    const t = normalizeTag(raw);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(t);
  }
  return next;
}

function hasTag(tags: string[], tag: string): boolean {
  const target = normalizeTag(tag).toLowerCase();
  if (!target) return false;
  return tags.some((t) => t.toLowerCase() === target);
}

function parseTaskIdCsv(raw: string): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const id = Number(trimmed);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// tag toggling handled by TagPicker

function TagPicker({
  availableTags,
  value,
  onChange,
  placeholder = 'Add tag (press Enter)',
}: {
  availableTags: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = normalizeTag(query);
  const selected = useMemo(() => mergeTags(value), [value]);
  const options = useMemo(() => mergeTags(availableTags), [availableTags]);
  const unselected = useMemo(() => options.filter((tag) => !hasTag(selected, tag)), [options, selected]);
  const suggested = useMemo(() => {
    const needle = normalizedQuery.toLowerCase();
    const matches = unselected.filter((tag) => !needle || tag.toLowerCase().includes(needle));
    // Keep the suggestions area stable: when query has no matches, fall back to default suggestions.
    return (matches.length > 0 ? matches : unselected).slice(0, 8);
  }, [normalizedQuery, unselected]);
  const canCreate = normalizedQuery.length > 0 && !hasTag(options, normalizedQuery) && !hasTag(selected, normalizedQuery);
  const exactMatch = useMemo(
    () => unselected.find((tag) => tag.toLowerCase() === normalizedQuery.toLowerCase()) ?? null,
    [normalizedQuery, unselected],
  );

  function addTag(tag: string) {
    const normalized = normalizeTag(tag);
    if (!normalized) return;
    onChange(mergeTags([...selected, normalized]));
    setQuery('');
  }

  function removeTag(tag: string) {
    onChange(selected.filter((t) => t.toLowerCase() !== tag.toLowerCase()));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            if (!normalizedQuery) return;
            e.preventDefault();
            if (exactMatch) {
              addTag(exactMatch);
              return;
            }
            if (canCreate) addTag(normalizedQuery);
          }}
        />
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <Chip key={tag} variant="soft" className="shrink-0 pr-1">
              <span className="max-w-[140px] truncate" title={tag}>
                {tag}
              </span>
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`Remove tag ${tag}`}
                className="rounded-full px-1 text-[10px] text-[rgb(var(--cb-text-muted))] transition hover:text-[rgb(var(--cb-text))]"
              >
                ×
              </button>
            </Chip>
          ))}
        </div>
      ) : null}

      {suggested.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="shrink-0 text-xs text-[rgb(var(--cb-text-muted))]">Suggested:</span>
          {suggested.map((tag) => (
            <button
              key={tag}
              type="button"
              className="transition hover:scale-[1.02]"
              onClick={() => addTag(tag)}
              title={`Add tag ${tag}`}
            >
              <Chip variant="neutral">{tag}</Chip>
            </button>
          ))}
        </div>
      ) : null}

    </div>
  );
}

type MenuOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

function MenuSelect({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: MenuOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const current = options.find((opt) => opt.value === value)
    ?? (placeholder ? { value: '', label: placeholder } : options[0]);

  return (
    <Menu
      align="left"
      density="compact"
      menuClassName="w-full max-w-full"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className="cb-input flex w-full items-center justify-between gap-2 text-left"
          onClick={toggle}
          title={current?.label ?? value}
        >
          <span className="truncate">{current?.label ?? value}</span>
          <ChevronDown size={14} className={`shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
      items={options.map((opt, idx) => ({
        key: `${opt.value || 'empty'}:${idx}`,
        label: opt.label,
        checked: opt.value === value,
        disabled: opt.disabled,
        onSelect: () => onChange(opt.value),
      }))}
    />
  );
}

function encodeAssignee(type: AssigneeType, id: string | null): string {
  if (!type || !id) return '';
  return `${type}:${id}`;
}

function decodeAssignee(value: string): { type: AssigneeType; id: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { type: null, id: null };
  const [type, ...rest] = trimmed.split(':');
  const id = rest.join(':').trim();
  if (!id) return { type: null, id: null };
  if (type === 'agent' || type === 'human') {
    return { type, id };
  }
  return { type: null, id: null };
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((el) => {
    // Skip elements that are not actually focusable in the layout.
    if (el.hasAttribute('disabled')) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    return true;
  });
}

function useFocusTrap({
  containerRef,
  active,
  onEscape,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  active: boolean;
  onEscape?: () => void;
}) {
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const containerEl = container;

    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && onEscapeRef.current) {
        e.preventDefault();
        onEscapeRef.current();
        return;
      }

      if (e.key !== 'Tab') return;

      const targets = getFocusableElements(containerEl);
      if (targets.length === 0) {
        e.preventDefault();
        containerEl.focus();
        return;
      }

      const first = targets[0];
      const last = targets[targets.length - 1];
      const current = document.activeElement;

      if (e.shiftKey) {
        if (current === first || !containerEl.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (current === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    function onFocusIn(e: FocusEvent) {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (containerEl.contains(target)) return;

      const targets = getFocusableElements(containerEl);
      (targets[0] ?? containerEl).focus();
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      queueMicrotask(() => prevFocus?.focus());
    };
  }, [active, containerRef]);
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      {children}
    </div>
  );
}

type EditTaskFormValues = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  tags: string[];
  assignedType: AssigneeType;
  assignedId: string | null;
  nonAgent: boolean;
  anchor: string;
  blockedReason: string;
  blockedByTaskIds: string;
  projectId: number | null;
  isSomeday: boolean;
};

export function EditTaskModal({
  task,
  onClose,
  onSave,
  onDelete,
  tagOptions = [],
  projects = [],
}: {
  task: Task;
  onClose: () => void;
  onSave: (patch: {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    due_date?: string | null;
    tags?: string[] | string;
    assigned_to_type?: AssigneeType;
    assigned_to_id?: string | null;
    non_agent?: boolean;
    anchor?: string | null;
    blocked_reason?: string | null;
    blocked_by_task_ids?: number[];
    project_id?: number | null;
    is_someday?: boolean;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
  tagOptions?: string[];
  projects?: Project[];
}) {
  const { agents } = useAgents();
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const availableTags = useMemo(() => mergeTags(tagOptions), [tagOptions]);

  const { control, register, handleSubmit, watch, setValue, formState } = useForm<EditTaskFormValues>({
    defaultValues: {
      title: task.title,
      description: task.description ?? '',
      status: task.status,
      priority: task.priority ?? null,
      dueDate: task.due_date ?? '',
      tags: mergeTags(Array.isArray(task.tags) ? task.tags : []),
      assignedType: task.assigned_to_type ?? null,
      assignedId: task.assigned_to_id ?? null,
      nonAgent: Boolean(task.non_agent),
      anchor: task.anchor ?? '',
      blockedReason: task.blocked_reason ?? '',
      blockedByTaskIds: task.blocked_by_task_ids.join(', '),
      projectId: task.project_id ?? null,
      isSomeday: Boolean(task.is_someday),
    },
  });

  const status = watch('status');
  const nonAgent = watch('nonAgent');
  const assignedType = watch('assignedType');

  const humanAssignees = useMemo(() => {
    const ids = new Set<string>(['armin']);
    if (task.assigned_to_type === 'human' && task.assigned_to_id) ids.add(task.assigned_to_id);
    return Array.from(ids).sort();
  }, [task.assigned_to_id, task.assigned_to_type]);

  const assigneeOptions = useMemo<MenuOption[]>(
    () => [
      { value: '', label: '(unassigned)' },
      ...agents.map((agent) => ({
        value: encodeAssignee('agent', agent.id),
        label: `${agent.name} (agent)`,
        disabled: nonAgent,
      })),
      ...humanAssignees.map((id) => ({
        value: encodeAssignee('human', id),
        label: `${id} (human)`,
      })),
    ],
    [agents, humanAssignees, nonAgent],
  );

  useEffect(() => {
    if (!nonAgent) return;
    if (assignedType !== 'agent') return;
    setValue('assignedType', null, { shouldDirty: true });
    setValue('assignedId', null, { shouldDirty: true });
  }, [assignedType, nonAgent, setValue]);

  const requestClose = useCallback(() => {
    if (saving || deleting) return;
    if (formState.isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onClose();
  }, [deleting, formState.isDirty, onClose, saving]);

  useFocusTrap({ containerRef: modalRef, active: true, onEscape: requestClose });

  const save = useCallback(() => {
    void handleSubmit(async (values) => {
      if (saving || deleting) return;
      setSaving(true);
      try {
        const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        await onSave({
          title: values.title.trim() || task.title,
          description: values.description.trim() ? values.description : null,
          status: values.status,
          priority: values.priority,
          due_date: values.dueDate.trim() ? values.dueDate.trim() : null,
          tags: mergeTags(values.tags),
          assigned_to_type: values.assignedType,
          assigned_to_id: values.assignedId,
          non_agent: values.nonAgent,
          anchor: values.anchor.trim() ? values.anchor.trim() : null,
          blocked_reason: values.blockedReason.trim() ? values.blockedReason : null,
          blocked_by_task_ids: parseTaskIdCsv(values.blockedByTaskIds),
          project_id: values.projectId,
          is_someday: values.isSomeday,
        });
        queueMicrotask(() => prev?.focus());
      } finally {
        setSaving(false);
      }
    })();
  }, [deleting, handleSubmit, onSave, saving, task.title]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  return (
    <ModalOverlay onClose={requestClose}>
      <div ref={modalRef} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-lg">
        <Panel
          role="dialog"
          aria-modal="true"
          aria-label={`Edit task ${task.id}`}
          className="w-full max-h-[calc(100vh-2rem)] overflow-y-auto cb-scrollbar-hidden p-4 shadow-[var(--cb-shadow-md)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="text-base font-semibold text-[rgb(var(--cb-text))]">Edit task #{task.id}</div>
              <div className="text-xs text-[rgb(var(--cb-text-muted))]">Status: {status}</div>
            </div>

            <div className="-mr-1 flex shrink-0 items-center">
              <Controller
                control={control}
                name="isSomeday"
                render={({ field }) => (
                  <div className="inline-flex h-9 items-center rounded-lg border border-[rgb(var(--cb-border))] bg-[rgb(var(--cb-surface))] px-2.5">
                    <Checkbox
                      size="sm"
                      checked={Boolean(field.value)}
                      onChange={(e) => field.onChange(e.target.checked)}
                      label="Save for later"
                      className="gap-1.5"
                      labelClassName="text-xs font-medium text-[rgb(var(--cb-text-muted))]"
                    />
                  </div>
                )}
              />
              <Controller
                control={control}
                name="nonAgent"
                render={({ field }) => (
                  <div className="ml-1 inline-flex h-9 items-center rounded-lg border border-[rgb(var(--cb-border))] bg-[rgb(var(--cb-surface))] px-2.5">
                    <Checkbox
                      size="sm"
                      checked={Boolean(field.value)}
                      onChange={(e) => field.onChange(e.target.checked)}
                      label="Personal reminder"
                      className="gap-1.5"
                      labelClassName="text-xs font-medium text-[rgb(var(--cb-text-muted))]"
                    />
                  </div>
                )}
              />
              <Button
                variant="ghost-danger"
                size="icon"
                className="ml-1"
                disabled={saving || deleting}
                onClick={() => setShowDeleteConfirm(true)}
                title="Delete task"
              >
                <Trash2 size={16} strokeWidth={1.75} />
              </Button>
              <Button variant="ghost" size="icon" onClick={requestClose} aria-label="Close">
                ✕
              </Button>
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-2.5">
            <label className="text-sm">
              <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Title</div>
              <Input
                {...register('title')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    save();
                  }
                }}
              />
            </label>

            <label className="text-sm">
              <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Description</div>
              <textarea
                {...register('description')}
                className="cb-input w-full"
                rows={5}
              />
            </label>

            <label className="text-sm">
              <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Tags</div>
              <Controller
                control={control}
                name="tags"
                render={({ field }) => (
                  <TagPicker availableTags={availableTags} value={field.value ?? []} onChange={field.onChange} />
                )}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Status</div>
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <MenuSelect
                      value={field.value}
                      onChange={(value) => field.onChange(value as TaskStatus)}
                      options={COLUMNS.map((c) => ({ value: c.key, label: c.title }))}
                    />
                  )}
                />
              </label>

              <label className="text-sm">
                <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Assignee</div>
                <Controller
                  control={control}
                  name="assignedId"
                  render={({ field }) => (
                    <MenuSelect
                      value={encodeAssignee(watch('assignedType'), field.value ?? null)}
                      onChange={(value) => {
                        const decoded = decodeAssignee(value);
                        setValue('assignedType', decoded.type, { shouldDirty: true });
                        field.onChange(decoded.id);
                      }}
                      options={assigneeOptions}
                    />
                  )}
                />
              </label>
            </div>

            <div>
              <button
                type="button"
                className="text-xs font-medium text-[rgb(var(--cb-accent))] hover:underline"
                onClick={() => setShowAdvanced((prev) => !prev)}
              >
                {showAdvanced ? 'Hide advanced' : 'Show advanced'}
              </button>
            </div>

            {showAdvanced ? (
              <>
                <label className="text-sm">
                  <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Blocked reason</div>
                  <textarea
                    {...register('blockedReason')}
                    className="cb-input w-full"
                    rows={2}
                    placeholder="Optional…"
                  />
                </label>

                <label className="text-sm">
                  <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Blocked by task IDs</div>
                  <Input
                    {...register('blockedByTaskIds')}
                    placeholder="e.g. 12, 18"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Project</div>
                    <Controller
                      control={control}
                      name="projectId"
                      render={({ field }) => (
                        <MenuSelect
                          value={field.value ? String(field.value) : ''}
                          onChange={(value) => field.onChange(value ? Number(value) : null)}
                          options={[
                            { value: '', label: '(unassigned)' },
                            ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                          ]}
                        />
                      )}
                    />
                  </label>

                  <label className="text-sm">
                    <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Priority</div>
                    <Controller
                      control={control}
                      name="priority"
                      render={({ field }) => (
                        <MenuSelect
                          value={field.value ?? ''}
                          onChange={(value) => field.onChange((value || null) as TaskPriority)}
                          options={[
                            { value: '', label: '(none)' },
                            { value: 'low', label: 'low' },
                            { value: 'medium', label: 'medium' },
                            { value: 'high', label: 'high' },
                            { value: 'urgent', label: 'urgent' },
                          ]}
                        />
                      )}
                    />
                  </label>

                  <label className="text-sm">
                    <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Due date</div>
                    <Input type="date" {...register('dueDate')} />
                  </label>

                  <label className="text-sm col-span-2">
                    <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Anchor (optional)</div>
                    <Input {...register('anchor')} placeholder="/path/to/context" />
                  </label>
                </div>

                <div className="rounded-xl border border-[rgb(var(--cb-border))] bg-[rgb(var(--cb-surface-muted))] p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--cb-text-muted))]">Timeline</div>
                  <div className="mt-2 flex flex-col gap-1.5 text-xs text-[rgb(var(--cb-text-muted))]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Calendar size={14} />
                        <span>Created</span>
                      </div>
                      <span className="font-medium text-[rgb(var(--cb-text))]" title={task.created_at}>
                        {formatDateTimeFull(task.created_at) || '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Clock size={14} />
                        <span>Updated</span>
                      </div>
                      <span className="font-medium text-[rgb(var(--cb-text))]" title={task.updated_at ?? task.created_at}>
                        {formatDateTimeFull(task.updated_at ?? task.created_at) || '—'}
                      </span>
                    </div>
                    {task.completed_at ? (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <CheckCircle2 size={14} />
                          <span>Completed</span>
                        </div>
                        <span className="font-medium text-[rgb(var(--cb-text))]" title={task.completed_at}>
                          {formatDateTimeFull(task.completed_at) || '—'}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            ) : null}

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-[rgb(var(--cb-border))] pt-4">
              <Button variant="primary" className="w-full sm:w-auto" disabled={saving || deleting} onClick={save}>
                Save Changes
              </Button>
            </div>

            <div className="text-[11px] text-[rgb(var(--cb-text-muted))]">
              Tip: <span className="font-medium">Ctrl/Cmd + Enter</span> saves. <span className="font-medium">Esc</span>{' '}
              closes.
            </div>
          </div>
        </Panel>
      </div>

      {showDeleteConfirm && (
        <ConfirmModal
          title="Delete Task"
          message={`Are you sure you want to delete task #${task.id}? This action cannot be undone.`}
          confirmLabel={deleting ? 'Deleting...' : 'Delete Task'}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await onDelete();
            } finally {
              setDeleting(false);
              setShowDeleteConfirm(false);
            }
          }}
          onClose={() => setShowDeleteConfirm(false)}
        />
      )}
      {showDiscardConfirm && (
        <ConfirmModal
          title="Discard unsaved changes?"
          message="You have unsaved edits in this task. Discard changes and close?"
          confirmLabel="Discard changes"
          onConfirm={() => {
            setShowDiscardConfirm(false);
            onClose();
          }}
          onClose={() => setShowDiscardConfirm(false)}
        />
      )}
    </ModalOverlay>
  );
}

export function CreateTaskModal({
  initialStatus,
  initialProjectId,
  onClose,
  onCreate,
  tagOptions = [],
  projects = [],
}: {
  initialStatus?: TaskStatus;
  initialProjectId?: number | null;
  onClose: () => void;
  onCreate: (body: {
    title: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    due_date?: string | null;
    tags?: string[] | string;
    blocked_reason?: string | null;
    blocked_by_task_ids?: number[];
    assigned_to_type?: AssigneeType;
    assigned_to_id?: string | null;
    non_agent?: boolean;
    anchor?: string | null;
    project_id?: number | null;
    is_someday?: boolean;
  }) => Promise<void>;
  tagOptions?: string[];
  projects?: Project[];
}) {
  const { agents } = useAgents();
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const availableTags = useMemo(() => mergeTags(tagOptions), [tagOptions]);

  const { control, register, handleSubmit, setValue, watch, formState } = useForm<EditTaskFormValues>({
    defaultValues: {
      title: '',
      description: '',
      status: initialStatus ?? 'backlog',
      priority: null,
      dueDate: '',
      tags: [],
      assignedType: null,
      assignedId: null,
      nonAgent: false,
      anchor: '',
      blockedReason: '',
      blockedByTaskIds: '',
      projectId: initialProjectId ?? null,
      isSomeday: false,
    },
  });

  useEffect(() => {
    setValue('projectId', initialProjectId ?? null, { shouldDirty: false });
  }, [initialProjectId, setValue]);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (formState.isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onClose();
  }, [formState.isDirty, onClose, saving]);

  useFocusTrap({ containerRef: modalRef, active: true, onEscape: requestClose });

  const title = watch('title');
  const nonAgent = watch('nonAgent');
  const assignedType = watch('assignedType');
  const humanAssignees = useMemo(() => ['armin'], []);
  const assigneeOptions = useMemo<MenuOption[]>(
    () => [
      { value: '', label: '(unassigned)' },
      ...agents.map((agent) => ({
        value: encodeAssignee('agent', agent.id),
        label: `${agent.name} (agent)`,
        disabled: nonAgent,
      })),
      ...humanAssignees.map((id) => ({
        value: encodeAssignee('human', id),
        label: `${id} (human)`,
      })),
    ],
    [agents, humanAssignees, nonAgent],
  );
  const canCreate = title.trim().length > 0 && !saving;

  useEffect(() => {
    if (!nonAgent) return;
    if (assignedType !== 'agent') return;
    setValue('assignedType', null, { shouldDirty: true });
    setValue('assignedId', null, { shouldDirty: true });
  }, [assignedType, nonAgent, setValue]);

  const create = useCallback(() => {
    void handleSubmit(async (values) => {
      if (saving) return;
      const normalizedTitle = values.title.trim();
      if (!normalizedTitle) return;
      setSaving(true);
      try {
        await onCreate({
          title: normalizedTitle,
          description: values.description.trim() ? values.description : null,
          status: values.status,
          priority: values.priority,
          due_date: values.dueDate.trim() ? values.dueDate.trim() : null,
          tags: mergeTags(values.tags),
          blocked_reason: values.blockedReason.trim() ? values.blockedReason : null,
          blocked_by_task_ids: parseTaskIdCsv(values.blockedByTaskIds),
          assigned_to_type: values.assignedType,
          assigned_to_id: values.assignedId,
          non_agent: values.nonAgent,
          anchor: values.anchor.trim() ? values.anchor.trim() : null,
          project_id: values.projectId,
          is_someday: values.isSomeday,
        });
      } finally {
        setSaving(false);
      }
    })();
  }, [handleSubmit, onCreate, saving]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ctrl/Cmd+Enter to create from anywhere.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        create();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [create]);

  return (
    <ModalOverlay onClose={requestClose}>
      <div ref={modalRef} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-lg">
        <Panel
          role="dialog"
          aria-modal="true"
          aria-label="Create task"
          className="w-full max-h-[calc(100vh-2rem)] overflow-y-auto cb-scrollbar-hidden p-4 shadow-[var(--cb-shadow-md)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-[rgb(var(--cb-text))]">Create task</div>
              <div className="text-xs text-[rgb(var(--cb-text-muted))]">Fill in the basics. You can edit later.</div>
            </div>
            <div className="-mr-1 flex shrink-0 items-center gap-2">
              <Controller
                control={control}
                name="isSomeday"
                render={({ field }) => (
                  <div className="inline-flex h-9 items-center rounded-lg border border-[rgb(var(--cb-border))] bg-[rgb(var(--cb-surface))] px-2.5">
                    <Checkbox
                      size="sm"
                      checked={Boolean(field.value)}
                      onChange={(e) => field.onChange(e.target.checked)}
                      label="Save for later"
                      className="gap-1.5"
                      labelClassName="text-xs font-medium text-[rgb(var(--cb-text-muted))]"
                    />
                  </div>
                )}
              />
              <Controller
                control={control}
                name="nonAgent"
                render={({ field }) => (
                  <div className="inline-flex h-9 items-center rounded-lg border border-[rgb(var(--cb-border))] bg-[rgb(var(--cb-surface))] px-2.5">
                    <Checkbox
                      size="sm"
                      checked={Boolean(field.value)}
                      onChange={(e) => field.onChange(e.target.checked)}
                      label="Personal reminder"
                      className="gap-1.5"
                      labelClassName="text-xs font-medium text-[rgb(var(--cb-text-muted))]"
                    />
                  </div>
                )}
              />
              <Button variant="ghost" size="icon" onClick={requestClose} aria-label="Close">
                ✕
              </Button>
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-2.5">
            <label className="text-sm">
              <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Title</div>
              <Input
                {...register('title')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    create();
                  }
                }}
                placeholder="e.g. Refactor Kanban column headers"
              />
            </label>

            <label className="text-sm">
              <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Description</div>
              <textarea {...register('description')} className="cb-input w-full" rows={5} placeholder="Optional…" />
            </label>

            <label className="text-sm">
              <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Tags</div>
              <Controller
                control={control}
                name="tags"
                render={({ field }) => (
                  <TagPicker availableTags={availableTags} value={field.value ?? []} onChange={field.onChange} />
                )}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Status</div>
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <MenuSelect
                      value={field.value}
                      onChange={(value) => field.onChange(value as TaskStatus)}
                      options={COLUMNS.map((c) => ({ value: c.key, label: c.title }))}
                    />
                  )}
                />
              </label>

              <label className="text-sm">
                <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Assignee</div>
                <Controller
                  control={control}
                  name="assignedId"
                  render={({ field }) => (
                    <MenuSelect
                      value={encodeAssignee(watch('assignedType'), field.value ?? null)}
                      onChange={(value) => {
                        const decoded = decodeAssignee(value);
                        setValue('assignedType', decoded.type, { shouldDirty: true });
                        field.onChange(decoded.id);
                      }}
                      options={assigneeOptions}
                    />
                  )}
                />
              </label>
            </div>

            <div>
              <button
                type="button"
                className="text-xs font-medium text-[rgb(var(--cb-accent))] hover:underline"
                onClick={() => setShowAdvanced((prev) => !prev)}
              >
                {showAdvanced ? 'Hide advanced' : 'Show advanced'}
              </button>
            </div>

            {showAdvanced ? (
              <>
                <label className="text-sm">
                  <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Blocked reason</div>
                  <textarea {...register('blockedReason')} className="cb-input w-full" rows={2} placeholder="Optional…" />
                </label>

                <label className="text-sm">
                  <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Blocked by task IDs</div>
                  <Input
                    {...register('blockedByTaskIds')}
                    placeholder="e.g. 12, 18"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Project</div>
                    <Controller
                      control={control}
                      name="projectId"
                      render={({ field }) => (
                        <MenuSelect
                          value={field.value ? String(field.value) : ''}
                          onChange={(value) => field.onChange(value ? Number(value) : null)}
                          options={[
                            { value: '', label: '(unassigned)' },
                            ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                          ]}
                        />
                      )}
                    />
                  </label>

                  <label className="text-sm">
                    <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Priority</div>
                    <Controller
                      control={control}
                      name="priority"
                      render={({ field }) => (
                        <MenuSelect
                          value={field.value ?? ''}
                          onChange={(value) => field.onChange((value || null) as TaskPriority)}
                          options={[
                            { value: '', label: '(none)' },
                            { value: 'low', label: 'low' },
                            { value: 'medium', label: 'medium' },
                            { value: 'high', label: 'high' },
                            { value: 'urgent', label: 'urgent' },
                          ]}
                        />
                      )}
                    />
                  </label>

                  <label className="text-sm">
                    <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Due date</div>
                    <Input type="date" {...register('dueDate')} />
                  </label>

                  <label className="text-sm col-span-2">
                    <div className="mb-1 text-xs font-medium text-[rgb(var(--cb-text-muted))]">Anchor (optional)</div>
                    <Input {...register('anchor')} placeholder="/path/to/context" />
                  </label>
                </div>
              </>
            ) : null}

            <div className="mt-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={requestClose} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" onClick={create} disabled={!canCreate}>
                {saving ? 'Creating…' : 'Create'}
              </Button>
            </div>

            <div className="text-[11px] text-[rgb(var(--cb-text-muted))]">
              Tip: <span className="font-medium">Ctrl/Cmd + Enter</span> creates. <span className="font-medium">Esc</span>{' '}
              closes.
            </div>
          </div>
        </Panel>
      </div>
      {showDiscardConfirm && (
        <ConfirmModal
          title="Discard unsaved changes?"
          message="You have unsaved input for this new task. Discard changes and close?"
          confirmLabel="Discard changes"
          onConfirm={() => {
            setShowDiscardConfirm(false);
            onClose();
          }}
          onClose={() => setShowDiscardConfirm(false)}
        />
      )}
    </ModalOverlay>
  );
}
