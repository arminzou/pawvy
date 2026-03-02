import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import type { AgentSettingsProfile } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Panel } from '../../components/ui/Panel';

type DraftRow = {
  display_name: string;
  avatar: string;
  description: string;
};

export function SettingsPage() {
  const [agents, setAgents] = useState<AgentSettingsProfile[]>([]);
  const [claudeTasks, setClaudeTasks] = useState<Awaited<ReturnType<typeof api.listClaudeTasks>> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [loading, setLoading] = useState(true);
  const [claudeLoading, setClaudeLoading] = useState(true);
  const [savingAgentId, setSavingAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listAgentSettings();
      setAgents(res.agents);
      setDrafts(
        Object.fromEntries(
          res.agents.map((agent) => [
            agent.id,
            {
              display_name: agent.display_name ?? '',
              avatar: agent.avatar ?? '',
              description: agent.description ?? '',
            },
          ]),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function refreshClaudeTasks() {
    setClaudeLoading(true);
    try {
      setClaudeTasks(await api.listClaudeTasks());
    } catch {
      setClaudeTasks(null);
    } finally {
      setClaudeLoading(false);
    }
  }

  useEffect(() => {
    void refreshClaudeTasks();
  }, []);

  const dirtyIds = useMemo(() => {
    const ids: string[] = [];
    for (const agent of agents) {
      const draft = drafts[agent.id];
      if (!draft) continue;
      if (
        draft.display_name !== (agent.display_name ?? '') ||
        draft.avatar !== (agent.avatar ?? '') ||
        draft.description !== (agent.description ?? '')
      ) {
        ids.push(agent.id);
      }
    }
    return new Set(ids);
  }, [agents, drafts]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[rgb(var(--cb-text))]">Agents</h2>
          <div className="text-sm text-[rgb(var(--cb-text-muted))]">
            Cosmetic profile fields for agent display in Pawvy.
          </div>
        </div>
        <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {loading ? <div className="text-sm text-[rgb(var(--cb-text-muted))]">Loading…</div> : null}
      {error ? <Panel className="border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</Panel> : null}

      {!loading && agents.length === 0 ? (
        <Panel className="p-4 text-sm text-[rgb(var(--cb-text-muted))]">No agents discovered yet.</Panel>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {agents.map((agent) => {
          const draft = drafts[agent.id] ?? {
            display_name: agent.display_name ?? '',
            avatar: agent.avatar ?? '',
            description: agent.description ?? '',
          };
          const dirty = dirtyIds.has(agent.id);
          const saving = savingAgentId === agent.id;

          return (
            <Panel key={agent.id} className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[rgb(var(--cb-text))]">{agent.id}</div>
                  <div className="text-xs text-[rgb(var(--cb-text-muted))]">Source: {agent.source}</div>
                </div>
                <div className="text-2xl">{draft.avatar || '🐱'}</div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-[rgb(var(--cb-text-muted))]">
                  Display name
                  <Input
                    className="mt-1"
                    value={draft.display_name}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDrafts((prev) => ({
                        ...prev,
                        [agent.id]: { ...draft, display_name: value },
                      }));
                    }}
                    placeholder="Agent display name"
                  />
                </label>

                <label className="block text-xs font-medium text-[rgb(var(--cb-text-muted))]">
                  Avatar
                  <Input
                    className="mt-1"
                    value={draft.avatar}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDrafts((prev) => ({
                        ...prev,
                        [agent.id]: { ...draft, avatar: value },
                      }));
                    }}
                    placeholder="Emoji or short avatar text"
                  />
                </label>

                <label className="block text-xs font-medium text-[rgb(var(--cb-text-muted))]">
                  Description
                  <textarea
                    className="cb-input mt-1 w-full"
                    rows={3}
                    value={draft.description}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDrafts((prev) => ({
                        ...prev,
                        [agent.id]: { ...draft, description: value },
                      }));
                    }}
                    placeholder="Short cosmetic profile text"
                  />
                </label>
              </div>

              <div className="mt-3 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!dirty || saving}
                  onClick={() => {
                    setDrafts((prev) => ({
                      ...prev,
                      [agent.id]: {
                        display_name: agent.display_name ?? '',
                        avatar: agent.avatar ?? '',
                        description: agent.description ?? '',
                      },
                    }));
                  }}
                >
                  Reset
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!dirty || saving}
                  onClick={async () => {
                    setSavingAgentId(agent.id);
                    try {
                      const updated = await api.updateAgentSetting(agent.id, {
                        display_name: draft.display_name.trim() || null,
                        avatar: draft.avatar.trim() || null,
                        description: draft.description.trim() || null,
                      });
                      setAgents((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
                      setDrafts((prev) => ({
                        ...prev,
                        [updated.id]: {
                          display_name: updated.display_name ?? '',
                          avatar: updated.avatar ?? '',
                          description: updated.description ?? '',
                        },
                      }));
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setSavingAgentId(null);
                    }
                  }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-[rgb(var(--cb-text))]">Claude Native Tasks</div>
            <div className="text-xs text-[rgb(var(--cb-text-muted))]">
              Linked view from `~/.claude/tasks` with status, dependencies, and mapped Pawvy task hints.
            </div>
          </div>
          <Button variant="secondary" size="sm" disabled={claudeLoading} onClick={() => void refreshClaudeTasks()}>
            Refresh
          </Button>
        </div>

        {claudeLoading ? <div className="text-sm text-[rgb(var(--cb-text-muted))]">Loading Claude tasks…</div> : null}

        {claudeTasks ? (
          <div className="space-y-3">
            <div className="text-xs text-[rgb(var(--cb-text-muted))]">
              Base dir: <span className="font-mono">{claudeTasks.base_dir}</span> • workspaces {claudeTasks.workspaces.length} • tasks {claudeTasks.tasks.length}
            </div>

            {claudeTasks.workspaces.length > 0 ? (
              <div className="overflow-auto rounded-lg border border-[rgb(var(--cb-border))]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[rgb(var(--cb-surface-muted))] text-[rgb(var(--cb-text-muted))]">
                    <tr>
                      <th className="px-2 py-1.5">Workspace</th>
                      <th className="px-2 py-1.5">Updated</th>
                      <th className="px-2 py-1.5">Highwatermark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claudeTasks.workspaces.map((workspace) => (
                      <tr key={workspace.workspace_id} className="border-t border-[rgb(var(--cb-border))]">
                        <td className="px-2 py-1.5 font-mono">{workspace.workspace_id}</td>
                        <td className="px-2 py-1.5">{workspace.updated_at ? new Date(workspace.updated_at).toLocaleString() : '—'}</td>
                        <td className="px-2 py-1.5">{workspace.highwatermark ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {claudeTasks.tasks.length > 0 ? (
              <div className="overflow-auto rounded-lg border border-[rgb(var(--cb-border))]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[rgb(var(--cb-surface-muted))] text-[rgb(var(--cb-text-muted))]">
                    <tr>
                      <th className="px-2 py-1.5">Task</th>
                      <th className="px-2 py-1.5">Status</th>
                      <th className="px-2 py-1.5">Deps</th>
                      <th className="px-2 py-1.5">Updated</th>
                      <th className="px-2 py-1.5">Pawvy Mapping</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claudeTasks.tasks.slice(0, 150).map((task) => (
                      <tr key={`${task.source_file}:${task.id}`} className="border-t border-[rgb(var(--cb-border))]">
                        <td className="px-2 py-1.5">
                          <div className="font-medium text-[rgb(var(--cb-text))]">{task.title}</div>
                          <div className="font-mono text-[11px] text-[rgb(var(--cb-text-muted))]">{task.id}</div>
                        </td>
                        <td className="px-2 py-1.5">{task.status}</td>
                        <td className="px-2 py-1.5">
                          {task.dependencies.length > 0 ? task.dependencies.join(', ') : '—'}
                        </td>
                        <td className="px-2 py-1.5">{task.updated_at ? new Date(task.updated_at).toLocaleString() : '—'}</td>
                        <td className="px-2 py-1.5">
                          {task.mapped_task_id ? (
                            <span>
                              #{task.mapped_task_id}
                              {task.mapped_task_title ? ` ${task.mapped_task_title}` : ''}
                              {task.mapped_task_status ? ` (${task.mapped_task_status})` : ''}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-[rgb(var(--cb-text-muted))]">No native task files found yet.</div>
            )}
          </div>
        ) : !claudeLoading ? (
          <div className="text-sm text-[rgb(var(--cb-text-muted))]">Could not read `~/.claude/tasks` in this session.</div>
        ) : null}
      </Panel>
    </div>
  );
}
