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
  metrics?: EntityMetrics;
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
  metrics?: EntityMetrics;
  ads: MetaAd[];
}

interface MetaCampaign {
  id: string;
  name: string;
  status?: string;
  objective?: string;
  metrics?: EntityMetrics;
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

interface EntityMetrics {
  spend: number;
  impressions: number;
  reach: number;
  purchases: number;
  revenue: number;
  outboundClicks: number;
  cpir: number;
  cpa: number;
  roas: number;
}

interface ReportSummary {
  spend: Metric;
  purchaseValue: Metric;
  outboundClicks: Metric;
  costPerOutboundClick: Metric;
  purchases: Metric;
  cpa: Metric;
  cpir: Metric;
  cpm: Metric;
  frequency: Metric;
  impressions: Metric;
  reach: Metric;
  hookRate: Metric;
  holdRate: Metric;
  conversionRate: Metric;
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
  cpir: number;
  cpa: number;
  cpcOutbound: number;
  cpm: number;
  frequency: number;
  impressions: number;
  reach: number;
  aov: number;
  conversionRate: number;
  hookRate: number;
  holdRate: number;
}

interface MetaTrendsResponse {
  accountId: string;
  range: {
    since: string;
    until: string;
  };
  points: TrendPoint[];
}

interface ProjectRecord {
  id: string;
  name: string;
  adAccountIds: string[];
  targets: {
    cpaTarget: number | null;
    roasTarget: number | null;
    dailySpendTarget: number | null;
  };
  campaignTargets: Record<
    string,
    {
      cpaTarget: number | null;
      roasTarget: number | null;
    }
  >;
}

interface TargetHistoryEntry {
  id: string;
  campaignId: string | null;
  targetType: 'cpa' | 'roas' | 'daily_spend';
  oldValue: number | null;
  newValue: number | null;
  changedBy: string;
  changedAt: string;
  source: 'project_setup' | 'project_update' | 'campaign_override';
}

interface PersistedTag {
  entity_type: EntityType;
  entity_id: string;
  category_key: string;
  value: string;
}

interface TagLineage {
  campaignId?: string;
  adSetId?: string;
}

type ExpandedMetricKey = 'purchaseValue' | 'roas7dClick' | null;
type ScreenKey = 'overview' | 'optimization' | 'trends' | 'creative' | 'breakdown';
type EntityType = 'campaign' | 'adset' | 'ad';

const TAG_CATEGORY_OPTIONS: Array<{
  key: string;
  label: string;
  values: string[];
}> = [
  { key: 'buying_type', label: 'Buying Type', values: ['CBO', 'ABO'] },
  {
    key: 'creative_format',
    label: 'Creative Format',
    values: ['Video', 'Image', 'Carousel'],
  },
  {
    key: 'collaboration',
    label: 'Collaboration',
    values: ['Collab', 'Non-Collab'],
  },
  { key: 'page_type', label: 'Page Type', values: ['Brand Page', 'Non-Brand Page'] },
  {
    key: 'attribution',
    label: 'Attribution',
    values: ['Incremental', '7-Day Click', '1-Day Click'],
  },
  { key: 'content_type', label: 'Content Type', values: ['UGC', 'Non-UGC'] },
  { key: 'offer_status', label: 'Offer Status', values: ['Offer', 'BAU'] },
  { key: 'product', label: 'Product', values: [] },
];

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

function formatMetricValue(
  value: number,
  type: 'currency' | 'number' | 'roas' | 'percent',
  currency: string,
) {
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

  if (type === 'percent') {
    return `${value.toFixed(2)}%`;
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

function median(values: number[]) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }

  return sorted[middle]!;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function percentDiff(current: number, target: number) {
  if (target === 0) {
    return 0;
  }
  return ((current - target) / Math.abs(target)) * 100;
}

function getTagValue(
  tags: PersistedTag[],
  entityType: EntityType,
  entityId: string,
  categoryKey: string,
) {
  const match = tags.find((tag) => {
    return (
      tag.entity_type === entityType &&
      tag.entity_id === entityId &&
      tag.category_key === categoryKey
    );
  });
  return match?.value ?? '';
}

function getEffectiveTagWithSource(
  tags: PersistedTag[],
  entityType: EntityType,
  entityId: string,
  categoryKey: string,
  lineage?: TagLineage,
) {
  const direct = getTagValue(tags, entityType, entityId, categoryKey);
  if (direct) {
    return { value: direct, source: 'direct' as const };
  }

  if (entityType === 'ad') {
    const fromAdSet = lineage?.adSetId
      ? getTagValue(tags, 'adset', lineage.adSetId, categoryKey)
      : '';
    if (fromAdSet) {
      return { value: fromAdSet, source: 'adset' as const };
    }
  }

  if (entityType === 'ad' || entityType === 'adset') {
    const fromCampaign = lineage?.campaignId
      ? getTagValue(tags, 'campaign', lineage.campaignId, categoryKey)
      : '';
    if (fromCampaign) {
      return { value: fromCampaign, source: 'campaign' as const };
    }
  }

  return { value: 'Untagged', source: 'none' as const };
}

function fatigueBadgeFromCpir(cpir: number, medianCpir: number, roas: number) {
  if (cpir > medianCpir * 1.2 && roas < 1.5) {
    return { label: 'Fatigued', tone: 'bad' as const };
  }
  if (cpir > medianCpir || roas < 2) {
    return { label: 'Watch', tone: 'warn' as const };
  }
  return { label: 'Healthy', tone: 'good' as const };
}

function SimpleLineChart({
  points,
  lines,
}: {
  points: TrendPoint[];
  lines: Array<{ key: keyof TrendPoint; label: string; color: string }>;
}) {
  const width = 920;
  const height = 250;
  const padding = 26;

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
      const coords = points.map((point, index) => {
          const raw = point[line.key];
          const value = typeof raw === 'number' ? raw : 0;
          const x =
            padding +
            (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
          const y =
            height -
            padding -
            ((value - minValue) / (adjustedMax - minValue)) * (height - padding * 2);
          return { x, y };
        });
      const path = coords.map((coord) => `${coord.x},${coord.y}`).join(' ');
      const areaPath = `${path} ${coords[coords.length - 1]?.x ?? padding},${height - padding} ${coords[0]?.x ?? padding},${height - padding}`;
      const lastPoint = coords[coords.length - 1] ?? { x: padding, y: height - padding };
      return { ...line, path, areaPath, lastPoint };
    });
  }, [lines, points]);

  if (!points.length) {
    return <p className="muted">No trend data available for this period.</p>;
  }

  return (
    <div className="simple-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="simple-chart" role="img" aria-label="Trend chart">
        {[0, 1, 2, 3, 4].map((step) => {
          const y = padding + (step / 4) * (height - padding * 2);
          return (
            <line
              key={`grid-y-${step}`}
              x1={padding}
              y1={y}
              x2={width - padding}
              y2={y}
              className="chart-grid"
            />
          );
        })}
        {chartPoints.map((line) => (
          <g key={line.label}>
            <polygon points={line.areaPath} fill={line.color} opacity="0.06" />
            <polyline
              fill="none"
              stroke={line.color}
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={line.path}
            />
            <circle cx={line.lastPoint.x} cy={line.lastPoint.y} r="3.6" fill={line.color} />
          </g>
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
  const [optExpandedCampaigns, setOptExpandedCampaigns] = useState<string[]>([]);
  const [optExpandedAdSets, setOptExpandedAdSets] = useState<string[]>([]);
  const [expandedMetric, setExpandedMetric] = useState<ExpandedMetricKey>(null);
  const [expandedCreatives, setExpandedCreatives] = useState<string[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState<boolean>(false);
  const [isLoadingHierarchy, setIsLoadingHierarchy] = useState<boolean>(false);
  const [isDownloadingCreative, setIsDownloadingCreative] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [selectedCreative, setSelectedCreative] = useState<CreativeModalState | null>(null);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [targetHistory, setTargetHistory] = useState<TargetHistoryEntry[]>([]);
  const [campaignTargetDrafts, setCampaignTargetDrafts] = useState<
    Record<string, { cpaTarget: number | null; roasTarget: number | null }>
  >({});
  const [persistedTags, setPersistedTags] = useState<PersistedTag[]>([]);
  const [tagCatalogOptions, setTagCatalogOptions] = useState(TAG_CATEGORY_OPTIONS);
  const [customBreakdownApiRows, setCustomBreakdownApiRows] = useState<
    Array<{
      label: string;
      spend: number;
      cpa: number | null;
      roas: number | null;
      cpir: number | null;
      conversionRate: number | null;
    }>
  >([]);
  const [isGeneratingBreakdown, setIsGeneratingBreakdown] = useState<boolean>(false);
  const [isSavingTargets, setIsSavingTargets] = useState<boolean>(false);
  const [cpaTarget, setCpaTarget] = useState<number>(500);
  const [roasTarget, setRoasTarget] = useState<number>(3);
  const [dailySpendTarget, setDailySpendTarget] = useState<number>(50000);
  const [breakdownTag1, setBreakdownTag1] = useState<string>('buying_type');
  const [breakdownTag2, setBreakdownTag2] = useState<string>('creative_format');
  const [breakdownTag3, setBreakdownTag3] = useState<string>('');
  const [breakdownTag4, setBreakdownTag4] = useState<string>('');
  const [activeScreen, setActiveScreen] = useState<ScreenKey>('overview');
  const [openTagPanelKey, setOpenTagPanelKey] = useState<string | null>(null);
  const tagCatalogByKey = useMemo(() => {
    return new Map(tagCatalogOptions.map((item) => [item.key, item]));
  }, [tagCatalogOptions]);

  const adRows = useMemo(() => {
    if (!hierarchy) {
      return [] as Array<{
        campaignId: string;
        campaignName: string;
        adSetId: string;
        adSetName: string;
        adId: string;
        adName: string;
        creativeId?: string;
        creativeName?: string;
        creativeImageUrl?: string;
        creativeThumbnailUrl?: string;
        metrics: EntityMetrics;
      }>;
    }

    const rows: Array<{
      campaignId: string;
      campaignName: string;
      adSetId: string;
      adSetName: string;
      adId: string;
      adName: string;
        creativeId?: string;
        creativeName?: string;
        creativeImageUrl?: string;
        creativeThumbnailUrl?: string;
        metrics: EntityMetrics;
      }> = [];

    for (const campaign of hierarchy.campaigns) {
      for (const adset of campaign.adsets) {
        for (const ad of adset.ads) {
          rows.push({
            campaignId: campaign.id,
            campaignName: campaign.name,
            adSetId: adset.id,
            adSetName: adset.name,
            adId: ad.id,
            adName: ad.name,
            creativeId: ad.creative?.id,
            creativeName: ad.creative?.name,
            creativeImageUrl: ad.creative?.imageUrl,
            creativeThumbnailUrl: ad.creative?.thumbnailUrl,
            metrics: ad.metrics ?? {
              spend: 0,
              impressions: 0,
              reach: 0,
              purchases: 0,
              revenue: 0,
              outboundClicks: 0,
              cpir: 0,
              cpa: 0,
              roas: 0,
            },
          });
        }
      }
    }

    return rows;
  }, [hierarchy]);

  const creativeRows = useMemo(() => {
    const map = new Map<
      string,
      {
        creativeId: string;
        creativeName: string;
        creativeThumbnailUrl?: string;
        creativeImageUrl?: string;
        adCount: number;
        metrics: EntityMetrics;
        ads: Array<{
          adId: string;
          adName: string;
          campaignName: string;
          adSetName: string;
          metrics: EntityMetrics;
        }>;
      }
    >();

    for (const row of adRows) {
      if (!row.creativeId) {
        continue;
      }
      const current = map.get(row.creativeId) ?? {
        creativeId: row.creativeId,
        creativeName: row.creativeName ?? 'Creative',
        creativeThumbnailUrl: row.creativeThumbnailUrl,
        creativeImageUrl: row.creativeImageUrl,
        adCount: 0,
        metrics: {
          spend: 0,
          impressions: 0,
          reach: 0,
          purchases: 0,
          revenue: 0,
          outboundClicks: 0,
          cpir: 0,
          cpa: 0,
          roas: 0,
        },
        ads: [],
      };
      const nextMetrics = {
        spend: current.metrics.spend + row.metrics.spend,
        impressions: current.metrics.impressions + row.metrics.impressions,
        reach: current.metrics.reach + row.metrics.reach,
        purchases: current.metrics.purchases + row.metrics.purchases,
        revenue: current.metrics.revenue + row.metrics.revenue,
        outboundClicks: current.metrics.outboundClicks + row.metrics.outboundClicks,
        cpir: 0,
        cpa: 0,
        roas: 0,
      };
      nextMetrics.cpir = nextMetrics.reach > 0 ? (nextMetrics.spend * 1000) / nextMetrics.reach : 0;
      nextMetrics.cpa = nextMetrics.purchases > 0 ? nextMetrics.spend / nextMetrics.purchases : 0;
      nextMetrics.roas = nextMetrics.spend > 0 ? nextMetrics.revenue / nextMetrics.spend : 0;
      map.set(row.creativeId, {
        ...current,
        creativeThumbnailUrl:
          current.creativeThumbnailUrl ?? row.creativeThumbnailUrl,
        creativeImageUrl: current.creativeImageUrl ?? row.creativeImageUrl,
        adCount: current.adCount + 1,
        metrics: nextMetrics,
        ads: [
          ...current.ads,
          {
            adId: row.adId,
            adName: row.adName,
            campaignName: row.campaignName,
            adSetName: row.adSetName,
            metrics: row.metrics,
          },
        ],
      });
    }

    return [...map.values()]
      .map((item) => ({
        ...item,
        ads: [...item.ads].sort((a, b) => b.metrics.spend - a.metrics.spend),
      }))
      .sort((a, b) => b.metrics.spend - a.metrics.spend);
  }, [adRows]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAccounts() {
      setIsLoadingAccounts(true);
      setError('');

      try {
        const response = await fetch('/api/projects', {
          signal: controller.signal,
          cache: 'no-store',
        });

        const payload = (await response.json()) as {
          data?: ProjectRecord[];
          message?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error(payload.message ?? 'Failed to load projects');
        }

        const map = new Map<string, MetaAdAccount>();
        for (const projectItem of payload.data) {
          for (const adAccountId of projectItem.adAccountIds) {
            map.set(adAccountId, {
              id: adAccountId,
              accountId: adAccountId,
              name: `${projectItem.name} • ${adAccountId}`,
            });
          }
        }

        const projectAccounts = [...map.values()];
        setAccounts(projectAccounts);
        if (projectAccounts.length > 0) {
          setSelectedAccount(projectAccounts[0]?.accountId ?? '');
        } else {
          setError(
            'No project-linked ad accounts found. Create a project and attach account IDs from Project Setup.',
          );
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
      setExpandedCreatives([]);
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

  async function ensureProjectForAccount(accountId: string) {
    const listResponse = await fetch(
      `/api/projects?adAccountId=${encodeURIComponent(accountId)}`,
      { cache: 'no-store' },
    );
    const listPayload = (await listResponse.json()) as {
      data?: ProjectRecord[];
      message?: string;
    };

    if (!listResponse.ok) {
      throw new Error(listPayload.message ?? 'Failed to load projects');
    }

    const existing = listPayload.data?.[0];
    if (existing) {
      return existing;
    }

    const createResponse = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Account ${accountId}`,
        adAccountIds: [accountId],
        targets: {
          cpaTarget,
          roasTarget,
          dailySpendTarget,
        },
        changedBy: 'dashboard-user',
      }),
    });
    const created = (await createResponse.json()) as ProjectRecord & {
      message?: string;
    };
    if (!createResponse.ok) {
      throw new Error(created.message ?? 'Failed to create project');
    }
    return created;
  }

  async function loadProjectState(accountId: string) {
    const loadedProject = await ensureProjectForAccount(accountId);
    setProject(loadedProject);
    setCpaTarget(loadedProject.targets.cpaTarget ?? 0);
    setRoasTarget(loadedProject.targets.roasTarget ?? 0);
    setDailySpendTarget(loadedProject.targets.dailySpendTarget ?? 0);
    setCampaignTargetDrafts(loadedProject.campaignTargets ?? {});

    const historyResponse = await fetch(
      `/api/projects/${encodeURIComponent(loadedProject.id)}/target-history`,
      { cache: 'no-store' },
    );
    const historyPayload = (await historyResponse.json()) as {
      data?: TargetHistoryEntry[];
      message?: string;
    };
    if (!historyResponse.ok) {
      throw new Error(historyPayload.message ?? 'Failed to load target history');
    }
    setTargetHistory(historyPayload.data ?? []);

    const catalogResponse = await fetch(
      `/api/projects/${encodeURIComponent(loadedProject.id)}/tag-catalog`,
      { cache: 'no-store' },
    );
    const catalogPayload = (await catalogResponse.json()) as {
      data?: Array<{ key: string; label: string; values: string[] }>;
      message?: string;
    };
    if (!catalogResponse.ok) {
      throw new Error(catalogPayload.message ?? 'Failed to load tag catalog');
    }
    setTagCatalogOptions(
      catalogPayload.data && catalogPayload.data.length > 0
        ? catalogPayload.data
        : TAG_CATEGORY_OPTIONS,
    );

    const tagsResponse = await fetch(
      `/api/projects/${encodeURIComponent(loadedProject.id)}/tags?accountId=${encodeURIComponent(accountId)}`,
      { cache: 'no-store' },
    );
    const tagsPayload = (await tagsResponse.json()) as {
      data?: PersistedTag[];
      message?: string;
    };
    if (!tagsResponse.ok) {
      throw new Error(tagsPayload.message ?? 'Failed to load tags');
    }
    setPersistedTags(tagsPayload.data ?? []);
  }

  async function handleSaveTargets() {
    if (!project) {
      return;
    }
    setIsSavingTargets(true);
    setError('');
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/targets`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cpaTarget,
            roasTarget,
            dailySpendTarget,
            changedBy: 'dashboard-user',
          }),
        },
      );
      const payload = (await response.json()) as ProjectRecord & {
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Failed to save targets');
      }
      setProject(payload);
      await loadProjectState(project.adAccountIds[0] ?? effectiveAccountId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save targets.');
    } finally {
      setIsSavingTargets(false);
    }
  }

  async function handleSaveCampaignTarget(campaignId: string) {
    if (!project) {
      return;
    }
    const draft = campaignTargetDrafts[campaignId] ?? {
      cpaTarget: null,
      roasTarget: null,
    };
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/campaign-targets/${encodeURIComponent(campaignId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cpaTarget: draft.cpaTarget,
            roasTarget: draft.roasTarget,
            changedBy: 'dashboard-user',
          }),
        },
      );
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Failed to save campaign override');
      }
      await loadProjectState(project.adAccountIds[0] ?? effectiveAccountId);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save campaign override.',
      );
    }
  }

  async function handleSaveTag(
    entityType: EntityType,
    entityId: string,
    categoryKey: string,
    value: string | null,
  ) {
    if (!project) {
      return;
    }
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/tags`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: effectiveAccountId,
            entityType,
            entityId,
            categoryKey,
            value,
            changedBy: 'dashboard-user',
          }),
        },
      );
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Failed to save tag');
      }
      await loadProjectState(project.adAccountIds[0] ?? effectiveAccountId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save tag');
    }
  }

  async function generateCustomBreakdown() {
    if (!project) {
      return;
    }
    setIsGeneratingBreakdown(true);
    try {
      const tagKeys = [breakdownTag1, breakdownTag2, breakdownTag3, breakdownTag4]
        .filter(Boolean);
      const response = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/custom-breakdown`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: effectiveAccountId,
            since,
            until,
            tagKeys,
          }),
        },
      );
      const payload = (await response.json()) as {
        rows?: Array<{
          label: string;
          spend: number;
          cpa: number | null;
          roas: number | null;
          cpir: number | null;
          conversionRate: number | null;
        }>;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Failed to generate custom breakdown');
      }
      setCustomBreakdownApiRows(payload.rows ?? []);
    } catch (breakdownError) {
      setError(
        breakdownError instanceof Error
          ? breakdownError.message
          : 'Failed to generate breakdown.',
      );
    } finally {
      setIsGeneratingBreakdown(false);
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

  function toggleCreativeRow(creativeId: string) {
    setExpandedCreatives((current) => {
      return current.includes(creativeId)
        ? current.filter((id) => id !== creativeId)
        : [...current, creativeId];
    });
  }

  function toggleOptimizationCampaign(campaignId: string) {
    setOptExpandedCampaigns((current) => {
      return current.includes(campaignId)
        ? current.filter((id) => id !== campaignId)
        : [...current, campaignId];
    });
  }

  function toggleOptimizationAdSet(adSetId: string) {
    setOptExpandedAdSets((current) => {
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
    void loadProjectState(selectedAccount).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load project state.');
    });
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

  useEffect(() => {
    if (activeScreen !== 'breakdown' || !project || !effectiveAccountId) {
      return;
    }
    void generateCustomBreakdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeScreen,
    project?.id,
    effectiveAccountId,
    since,
    until,
    breakdownTag1,
    breakdownTag2,
    breakdownTag3,
    breakdownTag4,
  ]);

  const avgDailySpend = useMemo(() => {
    if (!trends?.points?.length) {
      return 0;
    }
    return trends.points.reduce((sum, point) => sum + point.spend, 0) / trends.points.length;
  }, [trends]);

  const customBreakdownDisplayRows = useMemo(() => {
    return customBreakdownApiRows.slice(0, 200).map((row) => ({
      key: row.label,
      label: row.label,
      spend: row.spend,
      cpa: row.cpa,
      roas: row.roas,
      cpir: row.cpir,
      conversionRate: row.conversionRate,
    }));
  }, [customBreakdownApiRows]);

  const creativeScatterRows = useMemo(() => {
    const valid = adRows.filter(
      (row) => row.metrics.spend > 0 && row.metrics.reach > 0,
    );
    const excludedCount = adRows.length - valid.length;
    const sortedCpir = valid
      .map((row) => row.metrics.cpir)
      .sort((a, b) => a - b);
    const medianCpir = median(sortedCpir);
    const p25 =
      sortedCpir.length > 0
        ? sortedCpir[Math.floor((sortedCpir.length - 1) * 0.25)] ?? 0
        : 0;
    const p75 =
      sortedCpir.length > 0
        ? sortedCpir[Math.floor((sortedCpir.length - 1) * 0.75)] ?? 0
        : 0;

    return {
      rows: valid.slice(0, 120),
      excludedCount,
      medianCpir,
      p25,
      p75,
    };
  }, [adRows]);

  function renderTagEditor(
    entityType: EntityType,
    entityId: string,
    categoryKey: string,
    lineage?: TagLineage,
  ) {
    const category = tagCatalogByKey.get(categoryKey);
    const values = category?.values ?? [];
    const currentValue = getTagValue(persistedTags, entityType, entityId, categoryKey);
    const effective = getEffectiveTagWithSource(
      persistedTags,
      entityType,
      entityId,
      categoryKey,
      lineage,
    );
    const effectiveSourceLabel =
      effective.source === 'direct'
        ? 'direct'
        : effective.source === 'adset'
          ? 'from ad set'
          : effective.source === 'campaign'
            ? 'from campaign'
            : 'none';

    if (values.length === 0) {
      return (
        <div className="tag-editor-cell">
          <input
            key={`${entityType}-${entityId}-${categoryKey}-${currentValue}`}
            type="text"
            className="inline-input"
            placeholder="Untagged"
            defaultValue={currentValue}
            onBlur={(event) => {
              void handleSaveTag(
                entityType,
                entityId,
                categoryKey,
                event.target.value.trim() || null,
              );
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
          />
          <span className="tag-effective-note">
            Effective: {effective.value} ({effectiveSourceLabel})
          </span>
        </div>
      );
    }

    return (
      <div className="tag-editor-cell">
        <select
          value={currentValue}
          onChange={(event) =>
            void handleSaveTag(entityType, entityId, categoryKey, event.target.value || null)
          }
        >
          <option value="">Untagged</option>
          {values.map((value) => (
            <option key={`${categoryKey}-${value}`} value={value}>
              {value}
            </option>
          ))}
        </select>
        <span className="tag-effective-note">
          Effective: {effective.value} ({effectiveSourceLabel})
        </span>
      </div>
    );
  }

  function renderTagPanel(
    entityType: EntityType,
    entityId: string,
    lineage?: TagLineage,
  ) {
    return (
      <div className="tag-panel-grid">
        {tagCatalogOptions.map((category) => (
          <div key={`${entityType}-${entityId}-${category.key}`} className="tag-panel-item">
            <p className="tag-panel-label">{category.label}</p>
            {renderTagEditor(entityType, entityId, category.key, lineage)}
          </div>
        ))}
      </div>
    );
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

          <nav className="dash-nav" aria-label="Dashboard screens">
            {[
              { key: 'overview' as const, label: 'Overview' },
              { key: 'optimization' as const, label: 'Optimization' },
              { key: 'trends' as const, label: 'Trends' },
              { key: 'creative' as const, label: 'Creative' },
              { key: 'breakdown' as const, label: 'Custom Breakdown' },
            ].map((screen) => (
              <button
                key={screen.key}
                type="button"
                className={`side-tab ${activeScreen === screen.key ? 'active' : ''}`}
                onClick={() => setActiveScreen(screen.key)}
              >
                {screen.label}
              </button>
            ))}
          </nav>

          <div className="dash-side-actions">
            <a href="/dashboard/projects" className="secondary-btn inline-anchor">
              Project Setup
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
              <p className="hero-kicker">ScaleWithPulse Performance Suite</p>
              <h1>Meta Ads Performance + Hierarchy</h1>
              <p className="hero-copy">
                KPI dashboard with targets, hierarchy drilldown, optimization tagging, trend analytics, and custom breakdowns.
              </p>
            </div>
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
 
          {activeScreen === 'overview' ? (
          <section className="table-card">
            <header className="table-header">
              <h2>Project Targets (Setup Inputs)</h2>
              <p className="muted">
                {project ? `Project: ${project.name}` : 'Loading project...'}
              </p>
            </header>
            <div className="target-grid">
              <label>
                CPA Target
                <input
                  type="number"
                  min={1}
                  value={cpaTarget}
                  onChange={(event) => setCpaTarget(Number(event.target.value) || 0)}
                />
              </label>
              <label>
                ROAS Target
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={roasTarget}
                  onChange={(event) => setRoasTarget(Number(event.target.value) || 0)}
                />
              </label>
              <label>
                Daily Spend Target
                <input
                  type="number"
                  min={1}
                  value={dailySpendTarget}
                  onChange={(event) => setDailySpendTarget(Number(event.target.value) || 0)}
                />
              </label>
            </div>
            <div className="target-actions">
              <button type="button" onClick={() => void handleSaveTargets()} disabled={!project || isSavingTargets}>
                {isSavingTargets ? 'Saving...' : 'Save Targets'}
              </button>
            </div>
          </section>
          ) : null}

      {report && activeScreen === 'overview' ? (
        <section className="summary-section">
          <header className="table-header">
            <h2>Account Summary</h2>
            <p className="muted">
              Top-line performance for {since} to {until}
            </p>
          </header>
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
              { key: 'cpa', label: 'CPA', type: 'currency' as const, metric: report.summary.cpa },
              {
                key: 'costPerOutboundClick',
                label: 'CPC (Outbound)',
                type: 'currency' as const,
                metric: report.summary.costPerOutboundClick,
              },
              { key: 'cpir', label: 'CPIR', type: 'currency' as const, metric: report.summary.cpir },
              { key: 'cpm', label: 'CPM', type: 'currency' as const, metric: report.summary.cpm },
              {
                key: 'frequency',
                label: 'Frequency',
                type: 'number' as const,
                metric: report.summary.frequency,
              },
              {
                key: 'conversionRate',
                label: 'Conversion Rate',
                type: 'percent' as const,
                metric: report.summary.conversionRate,
              },
            ].map((card) => {
              const expanded = expandedMetric === card.key;
              const primaryKpi = ['spend', 'purchaseValue', 'purchases', 'roas'].includes(card.key);
              return (
                <article
                  key={card.key}
                  className={`summary-card-v2 ${expanded ? 'expanded' : ''} ${card.expandable ? 'expandable' : ''} ${primaryKpi ? 'primary-kpi' : 'secondary-kpi'}`}
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

      {report && activeScreen === 'overview' ? (
        <section className="alerts-grid">
          <article className={`alert-card ${report.summary.cpa.current <= cpaTarget ? 'good' : 'bad'}`}>
            <h3>CPA Deviation</h3>
            <p>
              Current: {formatMetricValue(report.summary.cpa.current, 'currency', report.currency)} | Target:{' '}
              {formatMetricValue(cpaTarget, 'currency', report.currency)}
            </p>
            <p className="muted">{formatPercent(Math.abs(percentDiff(report.summary.cpa.current, cpaTarget)))} deviation</p>
          </article>
          <article className={`alert-card ${report.summary.roas.current >= roasTarget ? 'good' : 'bad'}`}>
            <h3>ROAS Deviation</h3>
            <p>
              Current: {report.summary.roas.current.toFixed(2)}x | Target: {roasTarget.toFixed(2)}x
            </p>
            <p className="muted">{formatPercent(Math.abs(percentDiff(report.summary.roas.current, roasTarget)))} deviation</p>
          </article>
          <article
            className={`alert-card ${
              avgDailySpend <= dailySpendTarget * 1.1 && avgDailySpend >= dailySpendTarget * 0.9 ? 'warn' : 'bad'
            }`}
          >
            <h3>Spend Deviation</h3>
            <p>
              Avg Daily: {formatMetricValue(avgDailySpend, 'currency', report.currency)} | Target:{' '}
              {formatMetricValue(dailySpendTarget, 'currency', report.currency)}
            </p>
            <p className="muted">{formatPercent(Math.abs(percentDiff(avgDailySpend, dailySpendTarget)))} deviation</p>
          </article>
        </section>
      ) : null}

      {trends && activeScreen === 'overview' ? (
        <section className="table-card">
          <header className="table-header">
            <h2>Key Trend Charts</h2>
            <p className="muted">Primary performance trends for spend, revenue, efficiency, and delivery.</p>
          </header>
          <div className="kpi-charts-grid">
            <article className="chart-card">
              <h3>Spend vs Revenue</h3>
              <SimpleLineChart
                points={trends.points}
                lines={[
                  { key: 'spend', label: 'Spend', color: '#2563eb' },
                  { key: 'revenue', label: 'Revenue', color: '#10b981' },
                ]}
              />
            </article>
            <article className="chart-card">
              <h3>ROAS Trends</h3>
              <SimpleLineChart
                points={trends.points}
                lines={[
                  { key: 'roas7dClick', label: 'ROAS 7d Click', color: '#7c3aed' },
                  { key: 'roasBlend', label: 'ROAS Blend', color: '#0ea5e9' },
                ]}
              />
            </article>
            <article className="chart-card">
              <h3>Efficiency Trends (CPA / CPIR)</h3>
              <SimpleLineChart
                points={trends.points}
                lines={[
                  { key: 'cpa', label: 'CPA', color: '#f97316' },
                  { key: 'cpir', label: 'CPIR', color: '#ef4444' },
                ]}
              />
            </article>
          </div>
        </section>
      ) : null}

      {trends && activeScreen === 'trends' ? (
        <section className="table-card">
          <header className="table-header">
            <h2>Trends Library</h2>
            <p className="muted">Cross-metric trend analysis for efficiency, conversion, delivery, and attribution signals.</p>
          </header>
          <div className="kpi-charts-grid">
            <article className="chart-card">
              <h3>CPA vs ROAS</h3>
              <SimpleLineChart
                points={trends.points}
                lines={[
                  { key: 'cpa', label: 'CPA', color: '#f97316' },
                  { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9' },
                ]}
              />
            </article>
            <article className="chart-card">
              <h3>CPIR vs Spend</h3>
              <SimpleLineChart
                points={trends.points}
                lines={[
                  { key: 'cpir', label: 'CPIR', color: '#ef4444' },
                  { key: 'spend', label: 'Spend', color: '#2563eb' },
                ]}
              />
            </article>
            <article className="chart-card">
              <h3>Conversion Rate vs AOV</h3>
              <SimpleLineChart
                points={trends.points}
                lines={[
                  { key: 'conversionRate', label: 'Conversion Rate', color: '#0891b2' },
                  { key: 'aov', label: 'AOV', color: '#6366f1' },
                ]}
              />
            </article>
            <article className="chart-card">
              <h3>CPM vs Frequency</h3>
              <SimpleLineChart
                points={trends.points}
                lines={[
                  { key: 'cpm', label: 'CPM', color: '#e11d48' },
                  { key: 'frequency', label: 'Frequency', color: '#9333ea' },
                ]}
              />
            </article>
            <article className="chart-card">
              <h3>Impressions vs Reach</h3>
              <SimpleLineChart
                points={trends.points}
                lines={[
                  { key: 'impressions', label: 'Impressions', color: '#2563eb' },
                  { key: 'reach', label: 'Reach', color: '#059669' },
                ]}
              />
            </article>
            <article className="chart-card">
              <h3>Hook Rate vs Hold Rate</h3>
              <SimpleLineChart
                points={trends.points}
                lines={[
                  { key: 'hookRate', label: 'Hook Rate', color: '#f97316' },
                  { key: 'holdRate', label: 'Hold Rate', color: '#0ea5e9' },
                ]}
              />
            </article>
            <article className="chart-card">
              <h3>7d Click vs 1d View Revenue</h3>
              <SimpleLineChart
                points={trends.points}
                lines={[
                  { key: 'revenue7dClick', label: 'Revenue 7d Click', color: '#4f46e5' },
                  { key: 'revenue1dView', label: 'Revenue 1d View', color: '#14b8a6' },
                ]}
              />
            </article>
          </div>
        </section>
      ) : null}

      {hierarchy && activeScreen === 'overview' ? (
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

      {hierarchy && activeScreen === 'optimization' ? (
        <section className="table-card table-v2">
          <header className="table-header">
            <h2>Optimization Workspace</h2>
            <p className="muted">Campaign, ad set, and ad metrics with direct tags, inherited tags, and override targets.</p>
          </header>
          <p className="muted inheritance-guide">
            Inheritance rule:
            <span className="inheritance-pill">Ad: ad → ad set → campaign</span>
            <span className="inheritance-pill">Ad Set: ad set → campaign</span>
            <span className="inheritance-pill">Campaign: campaign only</span>
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Spend</th>
                  <th>CPA</th>
                  <th>ROAS</th>
                  <th>CPIR</th>
                  <th>Purchases</th>
                  <th>CPA Target</th>
                  <th>ROAS Target</th>
                  <th>Tags</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {hierarchy.campaigns.map((campaign) => {
                  const campaignExpanded = optExpandedCampaigns.includes(campaign.id);
                  return (
                  <Fragment key={`opt-${campaign.id}`}>
                    <tr className="row-campaign">
                      <td>
                        <button
                          type="button"
                          className="fold-btn"
                          onClick={() => {
                            toggleOptimizationCampaign(campaign.id);
                          }}
                        >
                          <span className={`chev ${campaignExpanded ? 'open' : ''}`}>▸</span>
                          <span className="level-pill level-campaign">Campaign</span>
                          <span>{campaign.name}</span>
                        </button>
                      </td>
                      <td>{formatMetricValue(campaign.metrics?.spend ?? 0, 'currency', report?.currency ?? 'INR')}</td>
                      <td>{formatMetricValue(campaign.metrics?.cpa ?? 0, 'currency', report?.currency ?? 'INR')}</td>
                      <td>{(campaign.metrics?.roas ?? 0).toFixed(2)}x</td>
                      <td>{formatMetricValue(campaign.metrics?.cpir ?? 0, 'currency', report?.currency ?? 'INR')}</td>
                      <td>{formatMetricValue(campaign.metrics?.purchases ?? 0, 'number', report?.currency ?? 'INR')}</td>
                      <td>
                        <input
                          type="number"
                          className="inline-input"
                          value={campaignTargetDrafts[campaign.id]?.cpaTarget ?? cpaTarget}
                          onChange={(event) =>
                            setCampaignTargetDrafts((current) => ({
                              ...current,
                              [campaign.id]: {
                                cpaTarget: Number(event.target.value) || 0,
                                roasTarget: current[campaign.id]?.roasTarget ?? roasTarget,
                              },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="inline-input"
                          step={0.1}
                          value={campaignTargetDrafts[campaign.id]?.roasTarget ?? roasTarget}
                          onChange={(event) =>
                            setCampaignTargetDrafts((current) => ({
                              ...current,
                              [campaign.id]: {
                                cpaTarget: current[campaign.id]?.cpaTarget ?? cpaTarget,
                                roasTarget: Number(event.target.value) || 0,
                              },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary-btn compact-btn"
                          onClick={() =>
                            setOpenTagPanelKey((current) =>
                              current === `campaign-${campaign.id}` ? null : `campaign-${campaign.id}`,
                            )
                          }
                        >
                          {openTagPanelKey === `campaign-${campaign.id}` ? 'Hide Tags' : 'Edit Tags'}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary-btn compact-btn"
                          onClick={() => void handleSaveCampaignTarget(campaign.id)}
                        >
                          Save Override
                        </button>
                      </td>
                    </tr>
                    {openTagPanelKey === `campaign-${campaign.id}` ? (
                      <tr className="row-tag-panel">
                        <td colSpan={10}>
                          {renderTagPanel('campaign', campaign.id, {
                            campaignId: campaign.id,
                          })}
                        </td>
                      </tr>
                    ) : null}
                    {campaignExpanded
                      ? campaign.adsets.map((adset) => {
                          const adSetExpanded = optExpandedAdSets.includes(adset.id);
                          return (
                      <Fragment key={`opt-${adset.id}`}>
                        <tr className="row-adset">
                          <td>
                            <button
                              type="button"
                              className="fold-btn indent-1"
                              onClick={() => {
                                toggleOptimizationAdSet(adset.id);
                              }}
                            >
                              <span className={`chev ${adSetExpanded ? 'open' : ''}`}>▸</span>
                              <span className="level-pill level-adset">Ad Set</span>
                              <span>{adset.name}</span>
                            </button>
                          </td>
                          <td>{formatMetricValue(adset.metrics?.spend ?? 0, 'currency', report?.currency ?? 'INR')}</td>
                          <td>{formatMetricValue(adset.metrics?.cpa ?? 0, 'currency', report?.currency ?? 'INR')}</td>
                          <td>{(adset.metrics?.roas ?? 0).toFixed(2)}x</td>
                          <td>{formatMetricValue(adset.metrics?.cpir ?? 0, 'currency', report?.currency ?? 'INR')}</td>
                          <td>{formatMetricValue(adset.metrics?.purchases ?? 0, 'number', report?.currency ?? 'INR')}</td>
                          <td>—</td>
                          <td>—</td>
                          <td>
                            <button
                              type="button"
                              className="secondary-btn compact-btn"
                              onClick={() =>
                                setOpenTagPanelKey((current) =>
                                  current === `adset-${adset.id}` ? null : `adset-${adset.id}`,
                                )
                              }
                            >
                              {openTagPanelKey === `adset-${adset.id}` ? 'Hide Tags' : 'Edit Tags'}
                            </button>
                          </td>
                          <td>—</td>
                        </tr>
                        {openTagPanelKey === `adset-${adset.id}` ? (
                          <tr className="row-tag-panel">
                            <td colSpan={10}>
                              {renderTagPanel('adset', adset.id, {
                                campaignId: campaign.id,
                                adSetId: adset.id,
                              })}
                            </td>
                          </tr>
                        ) : null}
                        {adSetExpanded
                          ? adset.ads.map((ad) => (
                          <Fragment key={`opt-${ad.id}`}>
                            <tr className="row-ad">
                              <td>
                                <div className="fold-btn indent-2">
                                  <span className="chev spacer">•</span>
                                  <span className="level-pill level-ad">Ad</span>
                                  <span>{ad.name}</span>
                                </div>
                              </td>
                              <td>{formatMetricValue(ad.metrics?.spend ?? 0, 'currency', report?.currency ?? 'INR')}</td>
                              <td>{formatMetricValue(ad.metrics?.cpa ?? 0, 'currency', report?.currency ?? 'INR')}</td>
                              <td>{(ad.metrics?.roas ?? 0).toFixed(2)}x</td>
                              <td>{formatMetricValue(ad.metrics?.cpir ?? 0, 'currency', report?.currency ?? 'INR')}</td>
                              <td>{formatMetricValue(ad.metrics?.purchases ?? 0, 'number', report?.currency ?? 'INR')}</td>
                              <td>—</td>
                              <td>—</td>
                              <td>
                                <button
                                  type="button"
                                  className="secondary-btn compact-btn"
                                  onClick={() =>
                                    setOpenTagPanelKey((current) =>
                                      current === `ad-${ad.id}` ? null : `ad-${ad.id}`,
                                    )
                                  }
                                >
                                  {openTagPanelKey === `ad-${ad.id}` ? 'Hide Tags' : 'Edit Tags'}
                                </button>
                              </td>
                              <td>—</td>
                            </tr>
                            {openTagPanelKey === `ad-${ad.id}` ? (
                              <tr className="row-tag-panel">
                                <td colSpan={10}>
                                  {renderTagPanel('ad', ad.id, {
                                    campaignId: campaign.id,
                                    adSetId: adset.id,
                                  })}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
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
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Changed At</th>
                  <th>Scope</th>
                  <th>Target Type</th>
                  <th>Old</th>
                  <th>New</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {targetHistory.slice(0, 40).map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.changedAt).toLocaleString()}</td>
                    <td>{entry.campaignId ? `Campaign ${entry.campaignId}` : 'Project'}</td>
                    <td>{entry.targetType}</td>
                    <td>{entry.oldValue ?? '—'}</td>
                    <td>{entry.newValue ?? '—'}</td>
                    <td>{entry.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {adRows.length && activeScreen === 'creative' ? (
        <section className="table-card table-v2">
          <header className="table-header">
            <h2>Creative Performance</h2>
            <p className="muted">CPIR scatter + creative grouped report with expandable ad rows.</p>
          </header>
          <div className="scatter-grid scatter-chart-card">
            {(() => {
              const points = creativeScatterRows.rows;
              const width = 900;
              const height = 290;
              const padding = 34;
              const maxSpend = Math.max(...points.map((row) => row.metrics.spend), 1);
              const maxCpir = Math.max(...points.map((row) => row.metrics.cpir), 1);
              const medianY =
                height -
                padding -
                (creativeScatterRows.medianCpir / maxCpir) * (height - padding * 2);

              return (
                <>
                  <svg viewBox={`0 0 ${width} ${height}`} className="creative-scatter-svg" role="img" aria-label="CPIR scatter plot">
                    {[0, 1, 2, 3, 4].map((step) => {
                      const y = padding + (step / 4) * (height - padding * 2);
                      return (
                        <line
                          key={`scatter-grid-${step}`}
                          x1={padding}
                          y1={y}
                          x2={width - padding}
                          y2={y}
                          className="chart-grid"
                        />
                      );
                    })}
                    <line
                      x1={padding}
                      y1={medianY}
                      x2={width - padding}
                      y2={medianY}
                      className="median-line"
                    />
                    {points.map((row) => {
                      const x =
                        padding + (row.metrics.spend / maxSpend) * (width - padding * 2);
                      const y =
                        height -
                        padding -
                        (row.metrics.cpir / maxCpir) * (height - padding * 2);
                      const radius = Math.max(
                        4,
                        Math.min(13, (row.metrics.spend / maxSpend) * 13),
                      );
                      const color =
                        points.length < 5
                          ? '#64748b'
                          : row.metrics.cpir <= creativeScatterRows.p25
                            ? '#16a34a'
                            : row.metrics.cpir >= creativeScatterRows.p75
                              ? '#dc2626'
                              : '#f59e0b';
                      return (
                        <circle
                          key={`scatter-dot-${row.adId}`}
                          cx={x}
                          cy={y}
                          r={radius}
                          fill={color}
                          opacity="0.8"
                        >
                          <title>
                            {`${row.adName} | Spend ${row.metrics.spend.toFixed(2)} | CPIR ${row.metrics.cpir.toFixed(2)} | Reach ${row.metrics.reach.toFixed(0)}`}
                          </title>
                        </circle>
                      );
                    })}
                  </svg>
                  <p className="muted">
                    Median CPIR line: {formatMetricValue(creativeScatterRows.medianCpir, 'currency', report?.currency ?? 'INR')}
                    {creativeScatterRows.excludedCount > 0
                      ? ` | Excluded ${creativeScatterRows.excludedCount} ads with spend/reach gaps`
                      : ''}
                  </p>
                </>
              );
            })()}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Creative</th>
                  <th>Format</th>
                  <th>Ads</th>
                  <th>Spend</th>
                  <th>ROAS</th>
                  <th>CTR</th>
                  <th>Hook</th>
                  <th>Hold</th>
                  <th>CPIR</th>
                  <th>Fatigue</th>
                </tr>
              </thead>
              <tbody>
                {creativeRows.slice(0, 50).map((creative) => {
                  const isExpanded = expandedCreatives.includes(creative.creativeId);
                  const ctr =
                    creative.metrics.impressions > 0
                      ? (creative.metrics.outboundClicks / creative.metrics.impressions) * 100
                      : 0;
                  const fatigue = fatigueBadgeFromCpir(
                    creative.metrics.cpir,
                    creativeScatterRows.medianCpir,
                    creative.metrics.roas,
                  );
                  const format = creative.creativeThumbnailUrl
                    ? 'Video'
                    : creative.creativeImageUrl
                      ? 'Image'
                      : 'Unknown';
                  return (
                    <Fragment key={`creative-row-${creative.creativeId}`}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className="fold-btn"
                            onClick={() => toggleCreativeRow(creative.creativeId)}
                          >
                            <span className={`chev ${isExpanded ? 'open' : ''}`}>▸</span>
                            {creative.creativeThumbnailUrl || creative.creativeImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={creative.creativeThumbnailUrl ?? creative.creativeImageUrl}
                                alt={creative.creativeName}
                                className="creative-thumb"
                              />
                            ) : (
                              <span className="creative-thumb placeholder">∎</span>
                            )}
                            <span>{creative.creativeName} <span className="mono">({creative.creativeId})</span></span>
                          </button>
                        </td>
                        <td><span className="status-pill">{format}</span></td>
                        <td>{creative.adCount}</td>
                        <td>{formatMetricValue(creative.metrics.spend, 'currency', report?.currency ?? 'INR')}</td>
                        <td>{creative.metrics.roas.toFixed(2)}x</td>
                        <td>{ctr.toFixed(2)}%</td>
                        <td>N/A</td>
                        <td>N/A</td>
                        <td>{formatMetricValue(creative.metrics.cpir, 'currency', report?.currency ?? 'INR')}</td>
                        <td><span className={`status-pill fatigue-${fatigue.tone}`}>{fatigue.label}</span></td>
                      </tr>
                      {isExpanded
                        ? creative.ads.map((ad) => {
                            const adCtr =
                              ad.metrics.impressions > 0
                                ? (ad.metrics.outboundClicks / ad.metrics.impressions) * 100
                                : 0;
                            return (
                              <tr key={`creative-ad-${ad.adId}`} className="row-ad">
                                <td>
                                  <div className="fold-btn indent-1">
                                    <span className="chev spacer">•</span>
                                    <span>{ad.adName}</span>
                                    <span className="muted">
                                      ({ad.campaignName} / {ad.adSetName})
                                    </span>
                                  </div>
                                </td>
                                <td>—</td>
                                <td>1</td>
                                <td>{formatMetricValue(ad.metrics.spend, 'currency', report?.currency ?? 'INR')}</td>
                                <td>{ad.metrics.roas.toFixed(2)}x</td>
                                <td>{adCtr.toFixed(2)}%</td>
                                <td>N/A</td>
                                <td>N/A</td>
                                <td>{formatMetricValue(ad.metrics.cpir, 'currency', report?.currency ?? 'INR')}</td>
                                <td>—</td>
                              </tr>
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

      {activeScreen === 'breakdown' ? (
        <section className="table-card table-v2">
          <header className="table-header">
            <h2>Custom Breakdown</h2>
            <p className="muted">Multi-tag breakdown (up to 4 dimensions) with DB-backed inheritance and aggregated KPIs.</p>
          </header>
          <div className="breakdown-controls">
            <label>
              Tag 1
              <select value={breakdownTag1} onChange={(event) => setBreakdownTag1(event.target.value)}>
                {tagCatalogOptions.map((category) => (
                  <option key={`bd1-${category.key}`} value={category.key}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tag 2
              <select value={breakdownTag2} onChange={(event) => setBreakdownTag2(event.target.value)}>
                {tagCatalogOptions.map((category) => (
                  <option key={`bd2-${category.key}`} value={category.key}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tag 3 (Optional)
              <select value={breakdownTag3} onChange={(event) => setBreakdownTag3(event.target.value)}>
                <option value="">None</option>
                {tagCatalogOptions.map((category) => (
                  <option key={`bd3-${category.key}`} value={category.key}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tag 4 (Optional)
              <select value={breakdownTag4} onChange={(event) => setBreakdownTag4(event.target.value)}>
                <option value="">None</option>
                {tagCatalogOptions.map((category) => (
                  <option key={`bd4-${category.key}`} value={category.key}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="target-actions">
              <button
                type="button"
                onClick={() => void generateCustomBreakdown()}
                disabled={isGeneratingBreakdown}
              >
                {isGeneratingBreakdown ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tag Combination</th>
                  <th>Spend</th>
                  <th>CPA</th>
                  <th>ROAS</th>
                  <th>CPIR</th>
                  <th>Conversion Rate</th>
                </tr>
              </thead>
              <tbody>
                {customBreakdownDisplayRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{formatMetricValue(row.spend, 'currency', report?.currency ?? 'INR')}</td>
                    <td>{row.cpa !== null ? formatMetricValue(row.cpa, 'currency', report?.currency ?? 'INR') : '—'}</td>
                    <td>{row.roas !== null ? `${row.roas.toFixed(2)}x` : '—'}</td>
                    <td>{row.cpir !== null ? formatMetricValue(row.cpir, 'currency', report?.currency ?? 'INR') : '—'}</td>
                    <td>{row.conversionRate !== null ? `${row.conversionRate.toFixed(2)}%` : '—'}</td>
                  </tr>
                ))}
                {customBreakdownDisplayRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No breakdown rows yet for this date range/tags.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
        </section>
      </div>

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
