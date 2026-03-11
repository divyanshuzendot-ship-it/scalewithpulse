'use client';

import { useEffect, useMemo, useState } from 'react';

interface ProjectRecord {
  id: string;
  name: string;
  adAccountIds: string[];
  targets: {
    cpaTarget: number | null;
    roasTarget: number | null;
    dailySpendTarget: number | null;
  };
}

function parseAccountIds(input: string) {
  return input
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^\d+$/.test(item));
}

export default function ProjectSetupPage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [accountIdsInput, setAccountIdsInput] = useState<string>('');
  const [cpaTarget, setCpaTarget] = useState<number>(500);
  const [roasTarget, setRoasTarget] = useState<number>(3);
  const [dailySpendTarget, setDailySpendTarget] = useState<number>(50000);
  const [editAccountIdsInput, setEditAccountIdsInput] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  async function loadProjects() {
    const response = await fetch('/api/projects', { cache: 'no-store' });
    const payload = (await response.json()) as {
      data?: ProjectRecord[];
      message?: string;
    };
    if (!response.ok || !payload.data) {
      throw new Error(payload.message ?? 'Failed to load projects.');
    }

    setProjects(payload.data);
    if (!selectedProjectId && payload.data.length > 0) {
      setSelectedProjectId(payload.data[0]!.id);
    }
  }

  useEffect(() => {
    void loadProjects().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load projects.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedProject) {
      setEditAccountIdsInput('');
      return;
    }
    setEditAccountIdsInput(selectedProject.adAccountIds.join(', '));
  }, [selectedProject]);

  async function handleCreateProject() {
    setIsSaving(true);
    setError('');
    try {
      const adAccountIds = parseAccountIds(accountIdsInput);
      if (!name.trim() || adAccountIds.length === 0) {
        throw new Error('Project name and at least one numeric ad account ID are required.');
      }

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          adAccountIds,
          targets: { cpaTarget, roasTarget, dailySpendTarget },
          changedBy: 'dashboard-user',
        }),
      });

      const payload = (await response.json()) as ProjectRecord & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Failed to create project.');
      }

      await loadProjects();
      setSelectedProjectId(payload.id);
      setName('');
      setAccountIdsInput('');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to create project.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateProjectAccounts() {
    if (!selectedProject) {
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const adAccountIds = parseAccountIds(editAccountIdsInput);
      if (!adAccountIds.length) {
        throw new Error('At least one numeric ad account ID is required.');
      }

      const response = await fetch(`/api/projects/${encodeURIComponent(selectedProject.id)}/ad-accounts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adAccountIds }),
      });

      const payload = (await response.json()) as ProjectRecord & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Failed to update project accounts.');
      }

      await loadProjects();
      setSelectedProjectId(payload.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update project accounts.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="dashboard-shell dashboard-v2">
      <div className="dash-layout">
        <aside className="dash-sidebar">
          <div className="dash-logo">
            <p className="hero-kicker">Pulse</p>
            <h2>Performance Suite</h2>
            <p className="muted">Meta Ads workspace</p>
          </div>

          <nav className="dash-nav" aria-label="Dashboard navigation">
            <a href="/dashboard" className="side-tab">Overview</a>
            <a href="/dashboard" className="side-tab">Optimization</a>
            <a href="/dashboard" className="side-tab">Trends</a>
            <a href="/dashboard" className="side-tab">Creative</a>
            <a href="/dashboard" className="side-tab">Custom Breakdown</a>
            <span className="side-tab active" aria-current="page">Project Setup</span>
          </nav>

          <div className="dash-side-actions">
            <a href="/dashboard" className="secondary-btn inline-anchor">
              Back to Dashboard
            </a>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="secondary-btn">
                Sign out
              </button>
            </form>
          </div>
        </aside>

        <section className="dash-main">
          <section className="hero-card">
            <div>
              <p className="hero-kicker">Project Setup</p>
              <h1>Create Projects + Attach Ad Accounts</h1>
              <p className="hero-copy">
                Manual account mapping flow: add specific ad account IDs to projects, then use those accounts in dashboard.
              </p>
            </div>
          </section>

          {error ? <p className="error">{error}</p> : null}

          <section className="table-card">
            <header className="table-header">
              <h2>Create Project</h2>
            </header>
            <div className="target-grid">
              <label>
                Project Name
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Brand Alpha" />
              </label>
              <label>
                Ad Account IDs (comma-separated)
                <input
                  value={accountIdsInput}
                  onChange={(event) => setAccountIdsInput(event.target.value)}
                  placeholder="e.g. 1234567890, 2345678901"
                />
              </label>
              <label>
                CPA Target
                <input type="number" value={cpaTarget} onChange={(event) => setCpaTarget(Number(event.target.value) || 0)} />
              </label>
              <label>
                ROAS Target
                <input type="number" step={0.1} value={roasTarget} onChange={(event) => setRoasTarget(Number(event.target.value) || 0)} />
              </label>
              <label>
                Daily Spend Target
                <input
                  type="number"
                  value={dailySpendTarget}
                  onChange={(event) => setDailySpendTarget(Number(event.target.value) || 0)}
                />
              </label>
            </div>
            <div className="target-actions">
              <button type="button" onClick={() => void handleCreateProject()} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Create Project'}
              </button>
            </div>
          </section>

          <section className="table-card">
            <header className="table-header">
              <h2>Edit Project Accounts</h2>
            </header>
            <div className="target-grid">
              <label>
                Select Project
                <select
                  value={selectedProjectId}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                >
                  <option value="">Choose project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Attached Ad Account IDs
                <input
                  value={editAccountIdsInput}
                  onChange={(event) => setEditAccountIdsInput(event.target.value)}
                  placeholder="Comma-separated account IDs"
                  disabled={!selectedProject}
                />
              </label>
            </div>
            <div className="target-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleUpdateProjectAccounts()}
                disabled={!selectedProject || isSaving}
              >
                {isSaving ? 'Saving...' : 'Update Attached Accounts'}
              </button>
            </div>
          </section>

          <section className="table-card table-v2">
            <header className="table-header">
              <h2>Current Projects</h2>
            </header>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Ad Accounts</th>
                    <th>CPA Target</th>
                    <th>ROAS Target</th>
                    <th>Daily Spend Target</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id}>
                      <td>{project.name}</td>
                      <td>{project.adAccountIds.join(', ') || '—'}</td>
                      <td>{project.targets.cpaTarget ?? '—'}</td>
                      <td>{project.targets.roasTarget ?? '—'}</td>
                      <td>{project.targets.dailySpendTarget ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
