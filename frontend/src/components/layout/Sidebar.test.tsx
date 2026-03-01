import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { Sidebar } from './Sidebar';

vi.mock('../../hooks/useAgents', () => ({
  useAgents: () => ({ agents: [] }),
}));

vi.mock('../../lib/api', () => ({
  api: {
    createProject: vi.fn(),
  },
}));

vi.mock('../../lib/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderSidebar(overrides: Partial<ComponentProps<typeof Sidebar>> = {}) {
  const props: ComponentProps<typeof Sidebar> = {
    projectName: 'All Projects',
    projects: [
      {
        id: 1,
        name: 'Existing Project',
        slug: 'existing-project',
        path: '/tmp/existing-project',
        description: null,
        icon: null,
        color: '#6366f1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
    ],
    currentProjectId: null,
    onProjectChange: vi.fn(),
    onRefreshProjects: vi.fn(),
    onDeleteProject: vi.fn(),
    onRenameProject: vi.fn(),
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    viewsOpen: false,
    onToggleViewsOpen: vi.fn(),
    filtersOpen: false,
    onToggleFiltersOpen: vi.fn(),
    view: 'all',
    onView: vi.fn(),
    viewItems: [
      { key: 'all', label: 'All', count: 0 },
      { key: 'backlog', label: 'Backlog', count: 0 },
      { key: 'in_progress', label: 'In Progress', count: 0 },
      { key: 'review', label: 'Review', count: 0 },
      { key: 'done', label: 'Done', count: 0 },
    ],
    savedViews: [],
    activeSavedViewId: null,
    onApplySavedView: vi.fn(),
    onSaveCurrentView: vi.fn(),
    onSaveViewName: vi.fn(),
    onDeleteSavedView: vi.fn(),
    assignee: 'all',
    onAssignee: vi.fn(),
    hideDone: false,
    onHideDone: vi.fn(),
    blocked: false,
    onBlocked: vi.fn(),
    due: 'any',
    onDue: vi.fn(),
    tag: 'all',
    tagOptions: [],
    onTag: vi.fn(),
    showArchived: false,
    onShowArchived: vi.fn(),
    showSomeday: false,
    onShowSomeday: vi.fn(),
    onArchiveDone: vi.fn(),
    context: 'all',
    onContext: vi.fn(),
    currentContextKey: null,
    onReset: vi.fn(),
    ...overrides,
  };

  return { ...render(<Sidebar {...props} />), props };
}

async function openRegisterProjectForm() {
  await userEvent.click(screen.getByRole('button', { name: /add project/i }));
  await screen.findByLabelText(/folder path/i);
}

describe('Sidebar manual project registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expands the register form from the Add project button', async () => {
    renderSidebar();

    await openRegisterProjectForm();

    expect(screen.getByLabelText(/folder path/i)).toBeTruthy();
    expect(screen.getByLabelText(/project name/i)).toBeTruthy();
  });

  it('auto-derives name from path placeholder when name is left blank', async () => {
    renderSidebar();
    await openRegisterProjectForm();

    const pathInput = screen.getByLabelText(/folder path/i);
    await userEvent.type(pathInput, '/tmp/my-project');

    const nameInput = screen.getByLabelText(/project name/i) as HTMLInputElement;
    expect(nameInput.placeholder).toBe('my-project');
  });

  it('submits registration, refreshes projects, auto-selects created project, and shows success toast', async () => {
    const createProjectMock = vi.mocked(api.createProject);
    const onProjectChange = vi.fn();
    const onRefreshProjects = vi.fn().mockResolvedValue(undefined);
    createProjectMock.mockResolvedValue({
      id: 42,
      name: 'Manual Project',
      slug: 'manual-project',
      path: '/tmp/manual-project',
      description: null,
      icon: null,
      color: null,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    });

    renderSidebar({ onProjectChange, onRefreshProjects });
    await openRegisterProjectForm();

    await userEvent.type(screen.getByLabelText(/folder path/i), '/tmp/manual-project');
    await userEvent.type(screen.getByLabelText(/project name/i), 'Manual Project');
    await userEvent.click(screen.getByRole('button', { name: 'Register project' }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith({
        name: 'Manual Project',
        path: '/tmp/manual-project',
      });
    });
    await waitFor(() => expect(onRefreshProjects).toHaveBeenCalledTimes(1));
    expect(onProjectChange).toHaveBeenCalledWith(42);
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Project "Manual Project" registered');
  });

  it('uses derived name when project name is left blank', async () => {
    const createProjectMock = vi.mocked(api.createProject);
    createProjectMock.mockResolvedValue({
      id: 43,
      name: 'my-project',
      slug: 'my-project',
      path: '/tmp/my-project',
      description: null,
      icon: null,
      color: null,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    });

    renderSidebar();
    await openRegisterProjectForm();

    await userEvent.type(screen.getByLabelText(/folder path/i), '/tmp/my-project');
    await userEvent.click(screen.getByRole('button', { name: 'Register project' }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith({
        name: 'my-project',
        path: '/tmp/my-project',
      });
    });
  });

  it('shows actionable conflict toast when project path is already registered', async () => {
    const createProjectMock = vi.mocked(api.createProject);
    createProjectMock.mockRejectedValue(new Error('409 Conflict: {"error":"Project path already registered"}'));

    renderSidebar();
    await openRegisterProjectForm();

    await userEvent.type(screen.getByLabelText(/folder path/i), '/tmp/existing-project');
    await userEvent.click(screen.getByRole('button', { name: 'Register project' }));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'This folder is already registered as a project. Choose a different path or open the existing project.',
      );
    });
    expect(screen.getByLabelText(/folder path/i)).toBeTruthy();
  });

  it('shows actionable invalid-path toast for backend 400 responses', async () => {
    const createProjectMock = vi.mocked(api.createProject);
    createProjectMock.mockRejectedValue(
      new Error('400 Bad Request: {"error":"path must resolve to an absolute path"}'),
    );

    renderSidebar();
    await openRegisterProjectForm();

    await userEvent.type(screen.getByLabelText(/folder path/i), './relative/path');
    await userEvent.click(screen.getByRole('button', { name: 'Register project' }));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'Invalid folder path. Use an absolute path and resolve any environment variables before submitting.',
      );
    });
    expect(screen.getByLabelText(/folder path/i)).toBeTruthy();
  });

  it('collapses the form on Cancel', async () => {
    renderSidebar();
    await openRegisterProjectForm();

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByLabelText(/folder path/i)).toBeNull();
    expect(screen.getByRole('button', { name: /add project/i })).toBeTruthy();
  });

  it('collapses the form on Escape key', async () => {
    renderSidebar();
    await openRegisterProjectForm();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByLabelText(/folder path/i)).toBeNull();
  });
});
