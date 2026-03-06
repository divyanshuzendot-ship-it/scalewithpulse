'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';

interface MetaAdAccount {
  id: string;
  accountId: string;
  name: string;
}

interface MetaAd {
  id: string;
  name: string;
  status?: string;
  creative?: {
    id: string;
    name?: string;
    title?: string;
    body?: string;
    imageUrl?: string;
    thumbnailUrl?: string;
    objectStoryId?: string;
  };
}

interface CreativeModalState {
  adId: string;
  adName: string;
  creative: NonNullable<MetaAd['creative']>;
}

interface MetaAdSet {
  id: string;
  name: string;
  status?: string;
  ads: MetaAd[];
}

interface MetaCampaign {
  id: string;
  name: string;
  status?: string;
  objective?: string;
  adsets: MetaAdSet[];
}

interface MetaHierarchy {
  accountId: string;
  range?: {
    since: string;
    until: string;
  };
  totals: {
    campaigns: number;
    adsets: number;
    ads: number;
  };
  campaigns: MetaCampaign[];
}

interface Metric {
  current: number;
  previous: number;
}

interface ReportSummary {
  spend: Metric;
  purchaseValue: Metric;
  outboundClicks: Metric;
  costPerOutboundClick: Metric;
  purchases: Metric;
  cpir: Metric;
  roas: Metric;
  roas7dClick: Metric;
}

interface MetaReportResponse {
  accountId: string;
  range: {
    since: string;
    until: string;
  };
  previousRange: {
    since: string;
    until: string;
  };
  currency: string;
  summary: ReportSummary;
}

interface TrendPoint {
  date?: string;
  spend: number;
  purchases: number;
  revenue: number;
  revenue7dClick: number;
  revenue1dView: number;
  roas7dClick: number;
  roasBlend: number;
  aov: number;
  conversionRate: number;
}

interface MetaTrendsResponse {
  accountId: string;
  range: {
    since: string;
    until: string;
  };
  points: TrendPoint[];
}

type ExpandedMetricKey = 'purchaseValue' | 'roas7dClick' | null;

function defaultSinceDate() {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatStatus(status?: string) {
  if (!status) {
    return 'UNKNOWN';
  }

  return status.replaceAll('_', ' ');
}

function safeFileName(value: string) {
  return value
    .replaceAll(/[^a-zA-Z0-9-_]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .toLowerCase();
}

function extensionFromUrl(url: string) {
  const clean = url.split('?')[0] ?? '';
  if (clean.endsWith('.png')) {
    return 'png';
  }

  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) {
    return 'jpg';
  }

  if (clean.endsWith('.webp')) {
    return 'webp';
  }

  if (clean.endsWith('.mp4')) {
    return 'mp4';
  }

  return 'jpg';
}

function formatMetricValue(value: number, type: 'currency' | 'number' | 'roas', currency: string) {
  if (type === 'currency') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  if (type === 'roas') {
    return `${value.toFixed(2)}x`;
  }

  return new Intl.NumberFormat('en-US').format(value);
}

function formatDelta(current: number, previous: number, asPercent = true) {
  if (previous === 0) {
    if (current === 0) {
      return '0.00%';
    }
    return '+100.00%';
  }

  const delta = asPercent ? ((current - previous) / Math.abs(previous)) * 100 : current - previous;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(2)}%`;
}

function SimpleLineChart({
  points,
  lines,
}: {
  points: TrendPoint[];
  lines: Array<{ key: keyof TrendPoint; label: string; color: string }>;
}) {
  const width = 760;
  const height = 220;
  const padding = 20;

  const chartPoints = useMemo(() => {
    const rawValues = points.flatMap((point) => {
      return lines.map((line) => {
        const value = point[line.key];
        return typeof value === 'number' ? value : 0;
      });
    });

    const minValue = rawValues.length > 0 ? Math.min(...rawValues) : 0;
    const maxValue = rawValues.length > 0 ? Math.max(...rawValues) : 0;
    const adjustedMax = maxValue === minValue ? maxValue + 1 : maxValue;

    return lines.map((line) => {
      const path = points
        .map((point, index) => {
          const raw = point[line.key];
          const value = typeof raw === 'number' ? raw : 0;
          const x =
            padding +
            (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
          const y =
            height -
            padding -
            ((value - minValue) / (adjustedMax - minValue)) * (height - padding * 2);
          return `${x},${y}`;
        })
        .join(' ');

      return { ...line, path };
    });
  }, [lines, points]);

  if (!points.length) {
    return <p className="muted">No trend data available for this period.</p>;
  }

  return (
    <div className="simple-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="simple-chart" role="img" aria-label="Trend chart">
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} className="chart-grid" />
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          className="chart-grid"
        />
        {chartPoints.map((line) => (
          <polyline
            key={line.label}
            fill="none"
            stroke={line.color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={line.path}
          />
        ))}
      </svg>
      <div className="chart-legend">
        {chartPoints.map((line) => (
          <span key={line.label}>
            <i style={{ backgroundColor: line.color }} /> {line.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [accountSearch, setAccountSearch] = useState<string>('');
  const [since, setSince] = useState<string>(defaultSinceDate());
  const [until, setUntil] = useState<string>(today());
  const [hierarchy, setHierarchy] = useState<MetaHierarchy | null>(null);
  const [report, setReport] = useState<MetaReportResponse | null>(null);
  const [trends, setTrends] = useState<MetaTrendsResponse | null>(null);
  const [expandedCampaigns, setExpandedCampaigns] = useState<string[]>([]);
  const [expandedAdSets, setExpandedAdSets] = useState<string[]>([]);
  const [expandedMetric, setExpandedMetric] = useState<ExpandedMetricKey>(null);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState<boolean>(false);
  const [isLoadingHierarchy, setIsLoadingHierarchy] = useState<boolean>(false);
  const [isDownloadingCreative, setIsDownloadingCreative] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [selectedCreative, setSelectedCreative] = useState<CreativeModalState | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAccounts() {
      setIsLoadingAccounts(true);
      setError('');

      try {
        const response = await fetch('/api/meta/ad-accounts', {
          signal: controller.signal,
        });

        const payload = (await response.json()) as { data?: MetaAdAccount[]; message?: string };

        if (!response.ok || !payload.data) {
          throw new Error(payload.message ?? 'Failed to load ad accounts');
        }

        setAccounts(payload.data);
        if (payload.data.length > 0) {
          setSelectedAccount(payload.data[0]?.accountId ?? '');
        }
      } catch (loadError) {
        if ((loadError as { name?: string }).name === 'AbortError') {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Failed to load accounts.');
      } finally {
        setIsLoadingAccounts(false);
      }
    }

    void loadAccounts();
    return () => {
      controller.abort();
    };
  }, []);

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) {
      return accounts;
    }

    return accounts.filter((account) => {
      return (
        account.name.toLowerCase().includes(query) ||
        account.accountId.toLowerCase().includes(query)
      );
    });
  }, [accountSearch, accounts]);

  const searchedAccountId = useMemo(() => {
    const query = accountSearch.trim();
    return /^\d+$/.test(query) ? query : '';
  }, [accountSearch]);

  const effectiveAccountId = useMemo(
    () => searchedAccountId || selectedAccount,
    [searchedAccountId, selectedAccount],
  );

  const canFetchHierarchy = useMemo(
    () => Boolean(effectiveAccountId && since && until),
    [effectiveAccountId, since, until],
  );

  async function loadDashboard() {
    if (!canFetchHierarchy) {
      return;
    }

    setIsLoadingHierarchy(true);
    setError('');

    try {
      const params = new URLSearchParams({ since, until });
      const [hierarchyResponse, reportResponse, trendsResponse] = await Promise.all([
        fetch(
          `/api/meta/ad-accounts/${encodeURIComponent(effectiveAccountId)}/hierarchy?${params.toString()}`,
        ),
        fetch(
          `/api/meta/ad-accounts/${encodeURIComponent(effectiveAccountId)}/report?${params.toString()}`,
        ),
        fetch(
          `/api/meta/ad-accounts/${encodeURIComponent(effectiveAccountId)}/trends?${params.toString()}`,
        ),
      ]);

      const hierarchyPayload = (await hierarchyResponse.json()) as MetaHierarchy & { message?: string };
      const reportPayload = (await reportResponse.json()) as MetaReportResponse & { message?: string };
      const trendsPayload = (await trendsResponse.json()) as MetaTrendsResponse & { message?: string };

      if (!hierarchyResponse.ok) {
        throw new Error(hierarchyPayload.message ?? 'Failed to load hierarchy');
      }

      if (!reportResponse.ok) {
        throw new Error(reportPayload.message ?? 'Failed to load report');
      }

      if (!trendsResponse.ok) {
        throw new Error(trendsPayload.message ?? 'Failed to load trends');
      }

      setHierarchy(hierarchyPayload);
      setReport(reportPayload);
      setTrends(trendsPayload);
      setExpandedCampaigns([]);
      setExpandedAdSets([]);
      setExpandedMetric(null);
      setSelectedCreative(null);
    } catch (loadError) {
      setHierarchy(null);
      setReport(null);
      setTrends(null);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load dashboard data.');
    } finally {
      setIsLoadingHierarchy(false);
    }
  }

  async function handleCreativeDownload() {
    if (!selectedCreative) {
      return;
    }

    const downloadUrl = selectedCreative.creative.imageUrl ?? selectedCreative.creative.thumbnailUrl;
    if (!downloadUrl) {
      return;
    }

    setIsDownloadingCreative(true);
    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error('Unable to fetch creative asset.');
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const baseName = safeFileName(
        selectedCreative.creative.name ?? selectedCreative.adName ?? `creative-${selectedCreative.creative.id}`,
      );
      const extension = extensionFromUrl(downloadUrl);
      link.href = blobUrl;
      link.download = `${baseName || selectedCreative.creative.id}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setIsDownloadingCreative(false);
    }
  }

  function toggleCampaign(campaignId: string) {
    setExpandedCampaigns((current) => {
      return current.includes(campaignId)
        ? current.filter((id) => id !== campaignId)
        : [...current, campaignId];
    });
  }

  function toggleAdSet(adSetId: string) {
    setExpandedAdSets((current) => {
      return current.includes(adSetId)
        ? current.filter((id) => id !== adSetId)
        : [...current, adSetId];
    });
  }

  useEffect(() => {
    if (!selectedAccount) {
      return;
    }

    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount]);

  useEffect(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) {
      return;
    }

    const exactMatch = accounts.find((account) => {
      return (
        account.accountId.toLowerCase() === query ||
        account.name.toLowerCase() === query
      );
    });

    if (exactMatch && exactMatch.accountId !== selectedAccount) {
      setSelectedAccount(exactMatch.accountId);
    }
  }, [accountSearch, accounts, selectedAccount]);

  useEffect(() => {
    if (!selectedCreative) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedCreative(null);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedCreative]);

  return (
    <main className="dashboard-shell dashboard-v2">
      <section className="hero-card">
        <div>
          <p className="hero-kicker">ScaleWithPulse Internal</p>
          <h1>Meta Ads Performance + Hierarchy</h1>
          <p className="hero-copy">
            Zip-style dashboard with summary cards, expandable trend views, and foldable campaign to ad hierarchy.
          </p>
        </div>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="secondary-btn">Sign out</button>
        </form>
      </section>

      <section className="controls-card controls-v2">
        <div className="controls-top-row">
          <p className="muted">
            Accounts loaded: <strong>{accounts.length}</strong>
            {accountSearch.trim() ? ` | Matching search: ${filteredAccounts.length}` : ''}
            {searchedAccountId ? ` | Using typed ID: ${searchedAccountId}` : ''}
          </p>
        </div>
        <div className="control-grid">
          <label>
            Search account
            <input
              type="text"
              placeholder="Search by account ID or name"
              value={accountSearch}
              onChange={(event) => {
                setAccountSearch(event.target.value);
              }}
            />
          </label>
          <label>
            Select account
            <select
              value={selectedAccount}
              onChange={(event) => {
                setSelectedAccount(event.target.value);
              }}
              disabled={isLoadingAccounts || filteredAccounts.length === 0}
            >
              {filteredAccounts.map((account) => (
                <option key={account.id} value={account.accountId}>
                  {account.name} ({account.accountId})
                </option>
              ))}
            </select>
          </label>
          <label>
            Since
            <input
              type="date"
              value={since}
              onChange={(event) => {
                setSince(event.target.value);
              }}
            />
          </label>
          <label>
            Until
            <input
              type="date"
              value={until}
              onChange={(event) => {
                setUntil(event.target.value);
              }}
            />
          </label>
          <button type="button" onClick={() => void loadDashboard()} disabled={!canFetchHierarchy || isLoadingHierarchy}>
            {isLoadingHierarchy ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}

      {report ? (
        <section className="summary-section">
          <div className="summary-grid">
            {[
              { key: 'spend', label: 'Spend', type: 'currency' as const, metric: report.summary.spend },
              {
                key: 'purchaseValue',
                label: 'Revenue',
                type: 'currency' as const,
                metric: report.summary.purchaseValue,
                expandable: true,
              },
              { key: 'purchases', label: 'Purchases', type: 'number' as const, metric: report.summary.purchases },
              { key: 'roas', label: 'ROAS', type: 'roas' as const, metric: report.summary.roas },
              {
                key: 'roas7dClick',
                label: 'ROAS (7d Click)',
                type: 'roas' as const,
                metric: report.summary.roas7dClick,
                expandable: true,
              },
              {
                key: 'outboundClicks',
                label: 'Outbound Clicks',
                type: 'number' as const,
                metric: report.summary.outboundClicks,
              },
              {
                key: 'costPerOutboundClick',
                label: 'CPC (Outbound)',
                type: 'currency' as const,
                metric: report.summary.costPerOutboundClick,
              },
              { key: 'cpir', label: 'CPIR', type: 'currency' as const, metric: report.summary.cpir },
            ].map((card) => {
              const expanded = expandedMetric === card.key;
              return (
                <article
                  key={card.key}
                  className={`summary-card-v2 ${expanded ? 'expanded' : ''} ${card.expandable ? 'expandable' : ''}`}
                  onClick={
                    card.expandable
                      ? () => {
                          setExpandedMetric(expanded ? null : (card.key as ExpandedMetricKey));
                        }
                      : undefined
                  }
                >
                  <p className="metric-label">{card.label}</p>
                  <p className="metric-value">
                    {formatMetricValue(card.metric.current, card.type, report.currency)}
                  </p>
                  <p className={`metric-delta ${card.metric.current >= card.metric.previous ? 'up' : 'down'}`}>
                    {formatDelta(card.metric.current, card.metric.previous)}
                  </p>
                  {expanded && card.key === 'purchaseValue' ? (
                    <div className="chart-panel">
                      <SimpleLineChart
                        points={trends?.points ?? []}
                        lines={[
                          { key: 'revenue', label: 'Revenue', color: '#2563eb' },
                          { key: 'aov', label: 'AOV', color: '#0ea5e9' },
                        ]}
                      />
                    </div>
                  ) : null}
                  {expanded && card.key === 'roas7dClick' ? (
                    <div className="chart-panel">
                      <SimpleLineChart
                        points={trends?.points ?? []}
                        lines={[
                          { key: 'roas7dClick', label: 'ROAS 7d Click', color: '#7c3aed' },
                          { key: 'roasBlend', label: 'ROAS Blend', color: '#10b981' },
                        ]}
                      />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {hierarchy ? (
        <section className="table-card table-v2">
          <header className="table-header">
            <h2>Campaign Hierarchy (Foldable)</h2>
            <p className="muted">
              Campaigns: {hierarchy.totals.campaigns} | Ad Sets: {hierarchy.totals.adsets} | Ads: {hierarchy.totals.ads}
            </p>
          </header>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Objective / Creative</th>
                </tr>
              </thead>
              <tbody>
                {hierarchy.campaigns.map((campaign) => {
                  const campaignExpanded = expandedCampaigns.includes(campaign.id);
                  return (
                    <Fragment key={`campaign-group-${campaign.id}`}>
                      <tr key={`campaign-${campaign.id}`} className="row-campaign">
                        <td>
                          <button
                            type="button"
                            className="fold-btn"
                            onClick={() => {
                              toggleCampaign(campaign.id);
                            }}
                          >
                            <span className={`chev ${campaignExpanded ? 'open' : ''}`}>▸</span>
                            <span className="level-pill level-campaign">Campaign</span>
                            <span>{campaign.name}</span>
                          </button>
                        </td>
                        <td className="mono">{campaign.id}</td>
                        <td><span className="status-pill">{formatStatus(campaign.status)}</span></td>
                        <td>{campaign.objective ?? '-'}</td>
                      </tr>
                      {campaignExpanded
                        ? campaign.adsets.map((adset) => {
                            const adSetExpanded = expandedAdSets.includes(adset.id);
                            return (
                              <Fragment key={`adset-group-${adset.id}`}>
                                <tr key={`adset-${adset.id}`} className="row-adset">
                                  <td>
                                    <button
                                      type="button"
                                      className="fold-btn indent-1"
                                      onClick={() => {
                                        toggleAdSet(adset.id);
                                      }}
                                    >
                                      <span className={`chev ${adSetExpanded ? 'open' : ''}`}>▸</span>
                                      <span className="level-pill level-adset">Ad Set</span>
                                      <span>{adset.name}</span>
                                    </button>
                                  </td>
                                  <td className="mono">{adset.id}</td>
                                  <td><span className="status-pill">{formatStatus(adset.status)}</span></td>
                                  <td>-</td>
                                </tr>
                                {adSetExpanded
                                  ? adset.ads.map((ad) => (
                                      <tr key={`ad-${ad.id}`} className="row-ad">
                                        <td>
                                          <div className="fold-btn indent-2">
                                            <span className="chev spacer">•</span>
                                            <span className="level-pill level-ad">Ad</span>
                                            <span>{ad.name}</span>
                                          </div>
                                        </td>
                                        <td className="mono">{ad.id}</td>
                                        <td><span className="status-pill">{formatStatus(ad.status)}</span></td>
                                        <td>
                                          {ad.creative
                                            ? (
                                              <button
                                                type="button"
                                                className="link-btn"
                                                onClick={() => {
                                                  setSelectedCreative({
                                                    adId: ad.id,
                                                    adName: ad.name,
                                                    creative: ad.creative!,
                                                  });
                                                }}
                                              >
                                                {ad.creative.name ?? 'Creative'} ({ad.creative.id})
                                              </button>
                                            )
                                            : '-'}
                                        </td>
                                      </tr>
                                    ))
                                  : null}
                              </Fragment>
                            );
                          })
                        : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {selectedCreative ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => {
            setSelectedCreative(null);
          }}
        >
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Creative details"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="modal-header">
              <div>
                <h2>Creative Details</h2>
                <p className="muted">Ad: {selectedCreative.adName} ({selectedCreative.adId})</p>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => {
                    void handleCreativeDownload();
                  }}
                  disabled={isDownloadingCreative || !(selectedCreative.creative.imageUrl || selectedCreative.creative.thumbnailUrl)}
                >
                  {isDownloadingCreative ? 'Downloading...' : 'Download creative'}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    setSelectedCreative(null);
                  }}
                >
                  Close
                </button>
              </div>
            </header>
            <div className="modal-content">
              <p><strong>Creative ID:</strong> {selectedCreative.creative.id}</p>
              <p><strong>Name:</strong> {selectedCreative.creative.name ?? '-'}</p>
              <p><strong>Title:</strong> {selectedCreative.creative.title ?? '-'}</p>
              <p><strong>Body:</strong> {selectedCreative.creative.body ?? '-'}</p>
              <p><strong>Object Story ID:</strong> {selectedCreative.creative.objectStoryId ?? '-'}</p>
              {selectedCreative.creative.imageUrl || selectedCreative.creative.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedCreative.creative.imageUrl ?? selectedCreative.creative.thumbnailUrl}
                  alt={selectedCreative.creative.name ?? 'Creative preview'}
                  className="creative-preview"
                />
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
