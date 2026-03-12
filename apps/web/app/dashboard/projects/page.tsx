'use client';

import { useEffect, useMemo, useState } from 'react';

interface ProjectRecord {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'archived' | 'deleted';
  adAccountIds: string[];
  products: string[];
  optimizationMethod: 'first_click_present' | 'first_click_absent';
  deviationThresholdPct: number;
  targets: {
    cpaTarget: number | null;
    roasTarget: number | null;
    dailySpendTarget: number | null;
    revenueTarget: number | null;
  };
}

interface SyncRunRecord {
  id: string;
  sync_type: 'daily' | 'backfill';
  account_id: string;
  status: 'running' | 'success' | 'failed';
  since: string;
  until: string;
  changed_by: string;
  started_at: string;
  finished_at: string | null;
  rows_written: number;
  error_message: string | null;
}

function parseAccountIds(input: string) {
  return input
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^\d+$/.test(item));
}

function parseProducts(input: string) {
  const seen = new Set<string>();
  return input
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((item) => item.slice(0, 100));
}

function defaultSinceDate() {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function ProjectSetupPage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [accountIdsInput, setAccountIdsInput] = useState<string>('');
  const [productsInput, setProductsInput] = useState<string>('');
  const [optimizationMethod, setOptimizationMethod] = useState<
    'first_click_present' | 'first_click_absent'
  >('first_click_absent');
  const [cpaTarget, setCpaTarget] = useState<number>(500);
  const [roasTarget, setRoasTarget] = useState<number>(3);
  const [dailySpendTarget, setDailySpendTarget] = useState<number>(50000);
  const [deviationThresholdPct, setDeviationThresholdPct] = useState<number>(10);
  const [editAccountIdsInput, setEditAccountIdsInput] = useState<string>('');
  const [editProductsInput, setEditProductsInput] = useState<string>('');
  const [editOptimizationMethod, setEditOptimizationMethod] = useState<
    'first_click_present' | 'first_click_absent'
  >('first_click_absent');
  const [editDeviationThresholdPct, setEditDeviationThresholdPct] = useState<number>(10);
  const [error, setError] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [syncRuns, setSyncRuns] = useState<SyncRunRecord[]>([]);
  const [isLoadingSync, setIsLoadingSync] = useState<boolean>(false);
  const [isRunningBackfill, setIsRunningBackfill] = useState<boolean>(false);
  const [backfillSince, setBackfillSince] = useState<string>(defaultSinceDate());
  const [backfillUntil, setBackfillUntil] = useState<string>(today());

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const projectSyncRuns = useMemo(() => {
    if (!selectedProject) {
      return [] as SyncRunRecord[];
    }
    const accountSet = new Set(selectedProject.adAccountIds);
    return syncRuns.filter((run) => accountSet.has(run.account_id)).slice(0, 50);
  }, [selectedProject, syncRuns]);
  const computedRevenueTarget =
    dailySpendTarget > 0 && roasTarget > 0 ? dailySpendTarget * roasTarget : 0;

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

  async function loadSyncRuns() {
    setIsLoadingSync(true);
    try {
      const response = await fetch('/api/meta/sync/status?limit=200', { cache: 'no-store' });
      const payload = (await response.json()) as {
        data?: SyncRunRecord[];
        message?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.message ?? 'Failed to load sync status.');
      }
      setSyncRuns(payload.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load sync status.');
    } finally {
      setIsLoadingSync(false);
    }
  }

  useEffect(() => {
    void loadProjects().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load projects.');
    });
    void loadSyncRuns().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load sync status.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedProject) {
      setEditAccountIdsInput('');
      setEditProductsInput('');
      setEditOptimizationMethod('first_click_absent');
      setEditDeviationThresholdPct(10);
      return;
    }
    setEditAccountIdsInput(selectedProject.adAccountIds.join(', '));
    setEditProductsInput(selectedProject.products.join(', '));
    setEditOptimizationMethod(selectedProject.optimizationMethod);
    setEditDeviationThresholdPct(selectedProject.deviationThresholdPct ?? 10);
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    void loadSyncRuns();
  }, [selectedProjectId]);

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
          products: parseProducts(productsInput),
          optimizationMethod,
          deviationThresholdPct,
          targets: {
            cpaTarget,
            roasTarget,
            dailySpendTarget,
            revenueTarget: computedRevenueTarget > 0 ? computedRevenueTarget : null,
          },
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
      setProductsInput('');
      setOptimizationMethod('first_click_absent');
      setDeviationThresholdPct(10);
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

  async function handleUpdateProducts() {
    if (!selectedProject) {
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(selectedProject.id)}/products`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            products: parseProducts(editProductsInput),
            changedBy: 'dashboard-user',
          }),
        },
      );

      const payload = (await response.json()) as {
        data?: string[];
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Failed to update products.');
      }

      await loadProjects();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update products.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateOptimizationMethod() {
    if (!selectedProject) {
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(selectedProject.id)}/settings`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            optimizationMethod: editOptimizationMethod,
            deviationThresholdPct: editDeviationThresholdPct,
          }),
        },
      );

      const payload = (await response.json()) as ProjectRecord & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Failed to update optimization method.');
      }
      await loadProjects();
      setSelectedProjectId(payload.id);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to update project settings.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateLifecycle(
    status: 'active' | 'paused' | 'archived' | 'deleted',
  ) {
    if (!selectedProject) {
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(selectedProject.id)}/settings`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      );
      const payload = (await response.json()) as ProjectRecord & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Failed to update project status.');
      }
      await loadProjects();
      setSelectedProjectId(payload.id);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to update project status.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRunBackfill(accountIds: string[]) {
    if (!accountIds.length) {
      return;
    }
    setIsRunningBackfill(true);
    setError('');
    try {
      const response = await fetch('/api/meta/sync/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountIds,
          since: backfillSince,
          until: backfillUntil,
          changedBy: 'dashboard-user',
        }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Failed to run backfill.');
      }
      await loadSyncRuns();
    } catch (backfillError) {
      setError(backfillError instanceof Error ? backfillError.message : 'Failed to run backfill.');
    } finally {
      setIsRunningBackfill(false);
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
                Products (comma-separated)
                <input
                  value={productsInput}
                  onChange={(event) => setProductsInput(event.target.value)}
                  placeholder="e.g. Shampoo, Conditioner, Serum"
                />
              </label>
              <label>
                Optimization Method
                <select
                  value={optimizationMethod}
                  onChange={(event) =>
                    setOptimizationMethod(
                      event.target.value as
                        | 'first_click_present'
                        | 'first_click_absent',
                    )
                  }
                >
                  <option value="first_click_absent">
                    First Click Data Not Present
                  </option>
                  <option value="first_click_present">
                    First Click Data Present
                  </option>
                </select>
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
              <label>
                Revenue Target
                <input
                  type="number"
                  value={computedRevenueTarget}
                  readOnly
                />
              </label>
              <label>
                Deviation Threshold (%)
                <input
                  type="number"
                  step={0.1}
                  value={deviationThresholdPct}
                  onChange={(event) => setDeviationThresholdPct(Number(event.target.value) || 0)}
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
              <label>
                Products
                <input
                  value={editProductsInput}
                  onChange={(event) => setEditProductsInput(event.target.value)}
                  placeholder="Comma-separated products"
                  disabled={!selectedProject}
                />
              </label>
              <label>
                Optimization Method
                <select
                  value={editOptimizationMethod}
                  onChange={(event) =>
                    setEditOptimizationMethod(
                      event.target.value as
                        | 'first_click_present'
                        | 'first_click_absent',
                    )
                  }
                  disabled={!selectedProject}
                >
                  <option value="first_click_absent">
                    First Click Data Not Present
                  </option>
                  <option value="first_click_present">
                    First Click Data Present
                  </option>
                </select>
              </label>
              <label>
                Deviation Threshold (%)
                <input
                  type="number"
                  step={0.1}
                  value={editDeviationThresholdPct}
                  onChange={(event) => setEditDeviationThresholdPct(Number(event.target.value) || 0)}
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
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleUpdateProducts()}
                disabled={!selectedProject || isSaving}
              >
                {isSaving ? 'Saving...' : 'Update Products'}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleUpdateOptimizationMethod()}
                disabled={!selectedProject || isSaving}
              >
                {isSaving ? 'Saving...' : 'Update Optimization Method'}
              </button>
            </div>
            <div className="target-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleUpdateLifecycle('active')}
                disabled={!selectedProject || isSaving || selectedProject.status === 'active'}
              >
                {isSaving ? 'Saving...' : 'Activate'}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleUpdateLifecycle('paused')}
                disabled={!selectedProject || isSaving || selectedProject.status === 'paused'}
              >
                {isSaving ? 'Saving...' : 'Pause'}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleUpdateLifecycle('archived')}
                disabled={!selectedProject || isSaving || selectedProject.status === 'archived'}
              >
                {isSaving ? 'Saving...' : 'Archive'}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleUpdateLifecycle('deleted')}
                disabled={!selectedProject || isSaving || selectedProject.status === 'deleted'}
              >
                {isSaving ? 'Saving...' : 'Delete'}
              </button>
            </div>
          </section>

          <section className="table-card table-v2">
            <header className="table-header">
              <h2>Backfill + Sync Status</h2>
              <p className="muted">
                {selectedProject
                  ? `Project: ${selectedProject.name}`
                  : 'Select a project to inspect sync status.'}
              </p>
            </header>
            <div className="target-grid">
              <label>
                Backfill Since
                <input
                  type="date"
                  value={backfillSince}
                  onChange={(event) => setBackfillSince(event.target.value)}
                />
              </label>
              <label>
                Backfill Until
                <input
                  type="date"
                  value={backfillUntil}
                  onChange={(event) => setBackfillUntil(event.target.value)}
                />
              </label>
              <div className="target-actions">
                <button
                  type="button"
                  onClick={() =>
                    void handleRunBackfill(selectedProject?.adAccountIds ?? [])
                  }
                  disabled={!selectedProject || isRunningBackfill}
                >
                  {isRunningBackfill ? 'Running...' : 'Backfill Project Accounts'}
                </button>
              </div>
            </div>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Range</th>
                    <th>Started</th>
                    <th>Finished</th>
                    <th>Rows</th>
                    <th>Error</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {projectSyncRuns.map((run) => (
                    <tr key={run.id}>
                      <td>{run.account_id}</td>
                      <td>{run.sync_type}</td>
                      <td><span className="status-pill">{run.status}</span></td>
                      <td>{run.since} to {run.until}</td>
                      <td>{new Date(run.started_at).toLocaleString()}</td>
                      <td>{run.finished_at ? new Date(run.finished_at).toLocaleString() : '—'}</td>
                      <td>{run.rows_written}</td>
                      <td>{run.error_message ?? '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="secondary-btn compact-btn"
                          onClick={() => void handleRunBackfill([run.account_id])}
                          disabled={isRunningBackfill}
                        >
                          Re-run
                        </button>
                      </td>
                    </tr>
                  ))}
                  {projectSyncRuns.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="muted">
                        {isLoadingSync
                          ? 'Loading sync runs...'
                          : 'No sync runs found for selected project accounts yet.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
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
                    <th>Status</th>
                    <th>Ad Accounts</th>
                    <th>Products</th>
                    <th>Optimization Method</th>
                    <th>CPA Target</th>
                    <th>ROAS Target</th>
                    <th>Daily Spend Target</th>
                    <th>Revenue Target</th>
                    <th>Deviation Threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id}>
                      <td>{project.name}</td>
                      <td>
                        <span className="status-pill">{project.status}</span>
                      </td>
                      <td>{project.adAccountIds.join(', ') || '—'}</td>
                      <td>{project.products.join(', ') || '—'}</td>
                      <td>
                        {project.optimizationMethod === 'first_click_present'
                          ? 'First Click Present'
                          : 'First Click Absent'}
                      </td>
                      <td>{project.targets.cpaTarget ?? '—'}</td>
                      <td>{project.targets.roasTarget ?? '—'}</td>
                      <td>{project.targets.dailySpendTarget ?? '—'}</td>
                      <td>{project.targets.revenueTarget ?? '—'}</td>
                      <td>{project.deviationThresholdPct ?? 10}%</td>
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
