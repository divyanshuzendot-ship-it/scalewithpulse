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
    objectType?: string;
    createdTime?: string;
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
  dailyBudget?: number;
  lifetimeBudget?: number;
  metrics?: EntityMetrics;
  ads: MetaAd[];
}

interface MetaCampaign {
  id: string;
  name: string;
  status?: string;
  objective?: string;
  buyingType?: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
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
  clicks: number;
  purchases: number;
  revenue: number;
  revenueIncremental: number;
  revenueFirstClick: number;
  outboundClicks: number;
  cpir: number;
  cpa: number;
  roas: number;
  iroas: number;
  fcRoas: number;
  incrementalityStatus?: 'achieving' | 'not_achieved' | 'losing' | 'insufficient';
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
  outboundClicks?: number;
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
  virality?: number;
  top3SpendShare?: number | null;
  videoSpendShare?: number | null;
  staticSpendShare?: number | null;
  placementTopShare?: number | null;
  ageTopShare?: number | null;
  newCreativeRate?: number | null;
  newCreativeSpendShare?: number | null;
  viralityWeighted?: number;
  top3SpendShareWeighted?: number;
  videoSpendShareWeighted?: number;
  staticSpendShareWeighted?: number;
  placementTopShareWeighted?: number;
  ageTopShareWeighted?: number;
  newCreativeRateWeighted?: number;
  newCreativeSpendShareWeighted?: number;
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
  status?: 'active' | 'paused' | 'archived' | 'deleted';
  adAccountIds: string[];
  products: string[];
  optimizationMethod: 'first_click_present' | 'first_click_absent';
  deviationThresholdPct?: number;
  targets: {
    cpaTarget: number | null;
    roasTarget: number | null;
    dailySpendTarget: number | null;
    revenueTarget?: number | null;
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
  targetType: 'cpa' | 'roas' | 'daily_spend' | 'revenue';
  oldValue: number | null;
  newValue: number | null;
  changedBy: string;
  changedAt: string;
  source: 'project_setup' | 'project_update' | 'campaign_override';
}

interface CreativeFatigueEntry {
  status: 'healthy' | 'watch' | 'fatigued' | 'insufficient';
  cpirTrend: 'rising' | 'falling' | 'flat' | 'insufficient';
  cpirSlope: number | null;
  cpirPValue: number | null;
  cpirDays: number;
  ctrTrend: 'rising' | 'falling' | 'flat' | 'insufficient';
  ctrSlope: number | null;
  ctrPValue: number | null;
  ctrDays: number;
}

interface IncrementalityEntry {
  status: 'achieving' | 'not_achieved' | 'losing' | 'insufficient';
  cpirTrend: 'rising' | 'falling' | 'flat' | 'insufficient';
  cpirSlope: number | null;
  cpirPValue: number | null;
  ctrTrend: 'rising' | 'falling' | 'flat' | 'insufficient';
  ctrSlope: number | null;
  ctrPValue: number | null;
  spendShare: 'stable' | 'shifting' | 'unavailable';
}

interface IncrementalityResponse {
  window: { since: string; until: string } | null;
  campaigns: Record<string, IncrementalityEntry>;
  adsets: Record<string, IncrementalityEntry>;
  ads: Record<string, IncrementalityEntry>;
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
type TrendGranularity = 'daily' | 'weekly';
type TrendMetricFormat = 'currency' | 'number' | 'roas' | 'percent';
type BreakdownMetricKey =
  | 'spend'
  | 'cpa'
  | 'roas'
  | 'cpir'
  | 'conversionRate'
  | 'mroas';

interface TrendDataPoint {
  date?: string;
  spend?: number;
  purchases?: number;
  cpa?: number | null;
  roasBlend?: number | null;
  roas7dClick?: number | null;
  cpm?: number | null;
  cpir?: number | null;
  conversionRate?: number | null;
  aov?: number | null;
  frequency?: number | null;
  hookRate?: number | null;
  holdRate?: number | null;
  revenue?: number;
  revenue7dClick?: number;
  revenue1dView?: number;
  impressions?: number;
  reach?: number;
  outboundClicks?: number;
  cpcOutbound?: number | null;
  cpaTargetStep?: number | null;
  roasTargetStep?: number | null;
  mroas?: number | null;
  iroas?: number | null;
  virality?: number | null;
  top3SpendShare?: number | null;
  videoSpendShare?: number | null;
  staticSpendShare?: number | null;
  placementTopShare?: number | null;
  ageTopShare?: number | null;
  newCreativeRate?: number | null;
  newCreativeSpendShare?: number | null;
}

interface TrendLineSpec {
  key: keyof TrendDataPoint;
  label: string;
  color: string;
  dashed?: boolean;
  formatter?: TrendMetricFormat;
}

interface TrendChartSpec {
  id: string;
  title: string;
  subtitle: string;
  lines: TrendLineSpec[];
  unavailableReason?: string;
}

const BREAKDOWN_METRIC_OPTIONS: Array<{
  key: BreakdownMetricKey;
  label: string;
  format: TrendMetricFormat;
}> = [
  { key: 'spend', label: 'Spend', format: 'currency' },
  { key: 'cpa', label: 'CPA', format: 'currency' },
  { key: 'roas', label: 'ROAS', format: 'roas' },
  { key: 'cpir', label: 'CPIR', format: 'currency' },
  { key: 'conversionRate', label: 'Conversion Rate', format: 'percent' },
  { key: 'mroas', label: 'mROAS', format: 'roas' },
];

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

function combineMetric(current: number, previous: number): Metric {
  return { current, previous };
}

function aggregateReportResponses(responses: MetaReportResponse[]): MetaReportResponse | null {
  if (!responses.length) {
    return null;
  }

  const spendCurrent = responses.reduce((sum, item) => sum + item.summary.spend.current, 0);
  const spendPrevious = responses.reduce((sum, item) => sum + item.summary.spend.previous, 0);
  const revenueCurrent = responses.reduce((sum, item) => sum + item.summary.purchaseValue.current, 0);
  const revenuePrevious = responses.reduce((sum, item) => sum + item.summary.purchaseValue.previous, 0);
  const outboundCurrent = responses.reduce((sum, item) => sum + item.summary.outboundClicks.current, 0);
  const outboundPrevious = responses.reduce((sum, item) => sum + item.summary.outboundClicks.previous, 0);
  const purchasesCurrent = responses.reduce((sum, item) => sum + item.summary.purchases.current, 0);
  const purchasesPrevious = responses.reduce((sum, item) => sum + item.summary.purchases.previous, 0);
  const impressionsCurrent = responses.reduce((sum, item) => sum + item.summary.impressions.current, 0);
  const impressionsPrevious = responses.reduce((sum, item) => sum + item.summary.impressions.previous, 0);
  const reachCurrent = responses.reduce((sum, item) => sum + item.summary.reach.current, 0);
  const reachPrevious = responses.reduce((sum, item) => sum + item.summary.reach.previous, 0);
  const revenue7dCurrent = responses.reduce(
    (sum, item) => sum + item.summary.roas7dClick.current * item.summary.spend.current,
    0,
  );
  const revenue7dPrevious = responses.reduce(
    (sum, item) => sum + item.summary.roas7dClick.previous * item.summary.spend.previous,
    0,
  );

  const views3sCurrent = responses.reduce(
    (sum, item) => sum + (item.summary.hookRate.current * item.summary.impressions.current) / 100,
    0,
  );
  const views3sPrevious = responses.reduce(
    (sum, item) => sum + (item.summary.hookRate.previous * item.summary.impressions.previous) / 100,
    0,
  );
  const thruplaysCurrent = responses.reduce(
    (sum, item) =>
      sum + ((item.summary.holdRate.current * item.summary.hookRate.current * item.summary.impressions.current) / 10000),
    0,
  );
  const thruplaysPrevious = responses.reduce(
    (sum, item) =>
      sum + ((item.summary.holdRate.previous * item.summary.hookRate.previous * item.summary.impressions.previous) / 10000),
    0,
  );

  const range = responses[0]!.range;
  const previousRange = responses[0]!.previousRange;

  return {
    accountId: 'all',
    range,
    previousRange,
    currency: 'INR',
    summary: {
      spend: combineMetric(spendCurrent, spendPrevious),
      purchaseValue: combineMetric(revenueCurrent, revenuePrevious),
      outboundClicks: combineMetric(outboundCurrent, outboundPrevious),
      costPerOutboundClick: combineMetric(
        outboundCurrent > 0 ? spendCurrent / outboundCurrent : 0,
        outboundPrevious > 0 ? spendPrevious / outboundPrevious : 0,
      ),
      purchases: combineMetric(purchasesCurrent, purchasesPrevious),
      cpa: combineMetric(
        purchasesCurrent > 0 ? spendCurrent / purchasesCurrent : 0,
        purchasesPrevious > 0 ? spendPrevious / purchasesPrevious : 0,
      ),
      cpir: combineMetric(
        reachCurrent > 0 ? (spendCurrent * 1000) / reachCurrent : 0,
        reachPrevious > 0 ? (spendPrevious * 1000) / reachPrevious : 0,
      ),
      cpm: combineMetric(
        impressionsCurrent > 0 ? (spendCurrent * 1000) / impressionsCurrent : 0,
        impressionsPrevious > 0 ? (spendPrevious * 1000) / impressionsPrevious : 0,
      ),
      frequency: combineMetric(
        reachCurrent > 0 ? impressionsCurrent / reachCurrent : 0,
        reachPrevious > 0 ? impressionsPrevious / reachPrevious : 0,
      ),
      impressions: combineMetric(impressionsCurrent, impressionsPrevious),
      reach: combineMetric(reachCurrent, reachPrevious),
      hookRate: combineMetric(
        impressionsCurrent > 0 ? (views3sCurrent / impressionsCurrent) * 100 : 0,
        impressionsPrevious > 0 ? (views3sPrevious / impressionsPrevious) * 100 : 0,
      ),
      holdRate: combineMetric(
        views3sCurrent > 0 ? (thruplaysCurrent / views3sCurrent) * 100 : 0,
        views3sPrevious > 0 ? (thruplaysPrevious / views3sPrevious) * 100 : 0,
      ),
      conversionRate: combineMetric(
        outboundCurrent > 0 ? (purchasesCurrent / outboundCurrent) * 100 : 0,
        outboundPrevious > 0 ? (purchasesPrevious / outboundPrevious) * 100 : 0,
      ),
      roas: combineMetric(
        spendCurrent > 0 ? revenueCurrent / spendCurrent : 0,
        spendPrevious > 0 ? revenuePrevious / spendPrevious : 0,
      ),
      roas7dClick: combineMetric(
        spendCurrent > 0 ? revenue7dCurrent / spendCurrent : 0,
        spendPrevious > 0 ? revenue7dPrevious / spendPrevious : 0,
      ),
    },
  };
}

function aggregateTrendsResponses(responses: MetaTrendsResponse[]): MetaTrendsResponse | null {
  if (!responses.length) {
    return null;
  }

  const byDate = new Map<string, TrendPoint>();
  for (const response of responses) {
    for (const point of response.points) {
      const date = point.date ?? '';
      if (!date) {
        continue;
      }
      const current = byDate.get(date) ?? {
        date,
        spend: 0,
        purchases: 0,
        revenue: 0,
        revenue7dClick: 0,
        revenue1dView: 0,
        roas7dClick: 0,
        roasBlend: 0,
        cpir: 0,
        cpa: 0,
        cpcOutbound: 0,
        cpm: 0,
        frequency: 0,
        impressions: 0,
        reach: 0,
        aov: 0,
        conversionRate: 0,
        hookRate: 0,
        holdRate: 0,
        virality: 0,
        top3SpendShare: null,
        videoSpendShare: null,
        staticSpendShare: null,
        placementTopShare: null,
        ageTopShare: null,
        newCreativeRate: null,
        newCreativeSpendShare: null,
      };
      byDate.set(date, {
        ...current,
        spend: current.spend + point.spend,
        purchases: current.purchases + point.purchases,
        revenue: current.revenue + point.revenue,
        revenue7dClick: current.revenue7dClick + point.revenue7dClick,
        revenue1dView: current.revenue1dView + point.revenue1dView,
        impressions: current.impressions + point.impressions,
        reach: current.reach + point.reach,
        virality: (current.virality ?? 0) + (point.virality ?? 0),
        top3SpendShare:
          current.top3SpendShare === null && point.top3SpendShare === undefined
            ? null
            : ((current.top3SpendShare ?? 0) + (point.top3SpendShare ?? 0)),
        videoSpendShare:
          current.videoSpendShare === null && point.videoSpendShare === undefined
            ? null
            : ((current.videoSpendShare ?? 0) + (point.videoSpendShare ?? 0)),
        staticSpendShare:
          current.staticSpendShare === null && point.staticSpendShare === undefined
            ? null
            : ((current.staticSpendShare ?? 0) + (point.staticSpendShare ?? 0)),
        placementTopShare:
          current.placementTopShare === null && point.placementTopShare === undefined
            ? null
            : ((current.placementTopShare ?? 0) + (point.placementTopShare ?? 0)),
        ageTopShare:
          current.ageTopShare === null && point.ageTopShare === undefined
            ? null
            : ((current.ageTopShare ?? 0) + (point.ageTopShare ?? 0)),
        newCreativeRate:
          current.newCreativeRate === null && point.newCreativeRate === undefined
            ? null
            : ((current.newCreativeRate ?? 0) + (point.newCreativeRate ?? 0)),
        newCreativeSpendShare:
          current.newCreativeSpendShare === null && point.newCreativeSpendShare === undefined
            ? null
            : ((current.newCreativeSpendShare ?? 0) + (point.newCreativeSpendShare ?? 0)),
      });
    }
  }

  const points = [...byDate.values()]
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    .map((point) => ({
      ...point,
      roas7dClick: point.spend > 0 ? point.revenue7dClick / point.spend : 0,
      roasBlend: point.spend > 0 ? point.revenue / point.spend : 0,
      cpir: point.reach > 0 ? (point.spend * 1000) / point.reach : 0,
      cpa: point.purchases > 0 ? point.spend / point.purchases : 0,
      cpcOutbound: point.impressions > 0 ? point.spend / Math.max(point.impressions, 1) : 0,
      cpm: point.impressions > 0 ? (point.spend * 1000) / point.impressions : 0,
      frequency: point.reach > 0 ? point.impressions / point.reach : 0,
      aov: point.purchases > 0 ? point.revenue / point.purchases : 0,
      conversionRate:
        point.impressions > 0 ? (point.purchases / Math.max(point.impressions, 1)) * 100 : 0,
      hookRate: 0,
      holdRate: 0,
      virality: point.virality ?? 0,
      top3SpendShare: point.top3SpendShare ?? null,
      videoSpendShare: point.videoSpendShare ?? null,
      staticSpendShare: point.staticSpendShare ?? null,
      placementTopShare: point.placementTopShare ?? null,
      ageTopShare: point.ageTopShare ?? null,
      newCreativeRate: point.newCreativeRate ?? null,
      newCreativeSpendShare: point.newCreativeSpendShare ?? null,
    }));

  return {
    accountId: 'all',
    range: responses[0]!.range,
    points,
  };
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

function formatTrendMetricValue(
  value: number | null | undefined,
  format: TrendMetricFormat,
  currency: string,
) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  if (format === 'currency') {
    return formatMetricValue(value, 'currency', currency);
  }
  if (format === 'roas') {
    return `${value.toFixed(2)}x`;
  }
  if (format === 'percent') {
    return `${value.toFixed(2)}%`;
  }
  return formatMetricValue(value, 'number', currency);
}

function weekStartIso(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function asNumber(value: string | number | null | undefined) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatBudgetValue(
  dailyBudget: number | undefined,
  lifetimeBudget: number | undefined,
  currency: string,
) {
  if (dailyBudget && dailyBudget > 0) {
    return `${formatMetricValue(dailyBudget, 'currency', currency)} /day`;
  }
  if (lifetimeBudget && lifetimeBudget > 0) {
    return `${formatMetricValue(lifetimeBudget, 'currency', currency)} lifetime`;
  }
  return '—';
}

function percentDiff(current: number, target: number) {
  if (target === 0) {
    return 0;
  }
  return ((current - target) / Math.abs(target)) * 100;
}

function getPreviousRangeClient(since: string, until: string) {
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  const dayMs = 24 * 60 * 60 * 1000;
  const spanDays = Math.floor((end.getTime() - start.getTime()) / dayMs) + 1;
  const previousEnd = new Date(start.getTime() - dayMs);
  const previousStart = new Date(previousEnd.getTime() - (spanDays - 1) * dayMs);
  return {
    since: previousStart.toISOString().slice(0, 10),
    until: previousEnd.toISOString().slice(0, 10),
  };
}

function rollingMroasPoints(points: TrendPoint[], windowDays = 14) {
  const dailyMroas: Array<{ date: string; value: number | null }> = [];
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1];
    if (!current || !previous || !current.date) {
      continue;
    }
    const deltaSpend = current.spend - previous.spend;
    const deltaRevenue = current.revenue - previous.revenue;
    if (Math.abs(deltaSpend) <= 0.01) {
      dailyMroas.push({ date: current.date, value: null });
      continue;
    }
    dailyMroas.push({
      date: current.date,
      value: deltaRevenue / Math.abs(deltaSpend),
    });
  }

  return dailyMroas.map((point, index) => {
    const window = dailyMroas
      .slice(Math.max(0, index - windowDays + 1), index + 1)
      .map((item) => item.value)
      .filter((value): value is number => typeof value === 'number');
    return {
      date: point.date,
      value: window.length >= 3 ? median(window) : null,
    };
  });
}

function aggregateTrendPoints(points: TrendDataPoint[], granularity: TrendGranularity) {
  if (granularity === 'daily') {
    return points;
  }

  const weeklyMap = new Map<
    string,
    {
      date: string;
      spend: number;
      purchases: number;
      revenue: number;
      revenue7dClick: number;
      revenue1dView: number;
      impressions: number;
      reach: number;
      outboundClicks: number;
      cpaTargetStep: number | null;
      roasTargetStep: number | null;
      viralityWeighted: number;
      top3SpendShareWeighted: number;
      videoSpendShareWeighted: number;
      staticSpendShareWeighted: number;
      placementTopShareWeighted: number;
      ageTopShareWeighted: number;
      newCreativeRateWeighted: number;
      newCreativeSpendShareWeighted: number;
    }
  >();
  for (const point of points) {
    const date = point.date;
    if (!date) {
      continue;
    }
    const week = weekStartIso(date);
    const current = weeklyMap.get(week) ?? {
      date: week,
      spend: 0,
      purchases: 0,
      revenue: 0,
      revenue7dClick: 0,
      revenue1dView: 0,
      impressions: 0,
      reach: 0,
      outboundClicks: 0,
      cpaTargetStep: null,
      roasTargetStep: null,
      viralityWeighted: 0,
      top3SpendShareWeighted: 0,
      videoSpendShareWeighted: 0,
      staticSpendShareWeighted: 0,
      placementTopShareWeighted: 0,
      ageTopShareWeighted: 0,
      newCreativeRateWeighted: 0,
      newCreativeSpendShareWeighted: 0,
    };
    const spend = asNumber(point.spend);
    current.spend = asNumber(current.spend) + asNumber(point.spend);
    current.purchases = asNumber(current.purchases) + asNumber(point.purchases);
    current.revenue = asNumber(current.revenue) + asNumber(point.revenue);
    current.revenue7dClick = asNumber(current.revenue7dClick) + asNumber(point.revenue7dClick);
    current.revenue1dView = asNumber(current.revenue1dView) + asNumber(point.revenue1dView);
    current.impressions = asNumber(current.impressions) + asNumber(point.impressions);
    current.reach = asNumber(current.reach) + asNumber(point.reach);
    current.outboundClicks = asNumber(current.outboundClicks) + asNumber(point.outboundClicks);
    current.viralityWeighted = asNumber(current.viralityWeighted) + asNumber(point.virality) * spend;
    current.top3SpendShareWeighted =
      asNumber(current.top3SpendShareWeighted) + asNumber(point.top3SpendShare) * spend;
    current.videoSpendShareWeighted =
      asNumber(current.videoSpendShareWeighted) + asNumber(point.videoSpendShare) * spend;
    current.staticSpendShareWeighted =
      asNumber(current.staticSpendShareWeighted) + asNumber(point.staticSpendShare) * spend;
    current.placementTopShareWeighted =
      asNumber(current.placementTopShareWeighted) + asNumber(point.placementTopShare) * spend;
    current.ageTopShareWeighted =
      asNumber(current.ageTopShareWeighted) + asNumber(point.ageTopShare) * spend;
    current.newCreativeRateWeighted =
      asNumber(current.newCreativeRateWeighted) + asNumber(point.newCreativeRate) * spend;
    current.newCreativeSpendShareWeighted =
      asNumber(current.newCreativeSpendShareWeighted) + asNumber(point.newCreativeSpendShare) * spend;
    current.cpaTargetStep = point.cpaTargetStep ?? current.cpaTargetStep ?? null;
    current.roasTargetStep = point.roasTargetStep ?? current.roasTargetStep ?? null;
    weeklyMap.set(week, current);
  }

  return [...weeklyMap.values()]
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    .map((point) => {
      const spend = point.spend ?? 0;
      const purchases = point.purchases ?? 0;
      const revenue = point.revenue ?? 0;
      const revenue7dClick = point.revenue7dClick ?? 0;
      const revenue1dView = point.revenue1dView ?? 0;
      const impressions = point.impressions ?? 0;
      const reach = point.reach ?? 0;
      const outboundClicks = point.outboundClicks ?? 0;
      return {
        ...point,
        spend,
        purchases,
        revenue,
        revenue7dClick,
        revenue1dView,
        roas7dClick: spend > 0 ? revenue7dClick / spend : null,
        roasBlend: spend > 0 ? revenue / spend : null,
        cpir: reach > 0 ? (spend * 1000) / reach : null,
        cpa: purchases > 0 ? spend / purchases : null,
        cpcOutbound: outboundClicks > 0 ? spend / outboundClicks : null,
        cpm: impressions > 0 ? (spend * 1000) / impressions : null,
        frequency: reach > 0 ? impressions / reach : null,
        aov: purchases > 0 ? revenue / purchases : null,
        conversionRate: outboundClicks > 0 ? (purchases / outboundClicks) * 100 : null,
        virality: spend > 0 ? asNumber(point.viralityWeighted) / spend : null,
        top3SpendShare: spend > 0 ? asNumber(point.top3SpendShareWeighted) / spend : null,
        videoSpendShare: spend > 0 ? asNumber(point.videoSpendShareWeighted) / spend : null,
        staticSpendShare: spend > 0 ? asNumber(point.staticSpendShareWeighted) / spend : null,
        placementTopShare: spend > 0 ? asNumber(point.placementTopShareWeighted) / spend : null,
        ageTopShare: spend > 0 ? asNumber(point.ageTopShareWeighted) / spend : null,
        newCreativeRate: spend > 0 ? asNumber(point.newCreativeRateWeighted) / spend : null,
        newCreativeSpendShare:
          spend > 0 ? asNumber(point.newCreativeSpendShareWeighted) / spend : null,
      };
    });
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

function fatigueBadgeFromModel(model: CreativeFatigueEntry | undefined) {
  if (!model) {
    return null;
  }
  if (model.status === 'fatigued') {
    return { label: 'Fatigued', tone: 'bad' as const };
  }
  if (model.status === 'watch') {
    return { label: 'Watch', tone: 'warn' as const };
  }
  if (model.status === 'healthy') {
    return { label: 'Healthy', tone: 'good' as const };
  }
  return { label: 'Insufficient', tone: 'warn' as const };
}

function incrementalityBadgeFromCpir(
  status: EntityMetrics['incrementalityStatus'] | undefined,
  cpir: number,
  medianCpir: number,
) {
  if (status === 'achieving') {
    return { label: 'Achieving', tone: 'good' as const };
  }
  if (status === 'losing') {
    return { label: 'Losing', tone: 'bad' as const };
  }
  if (status === 'not_achieved') {
    return { label: 'Not Achieved', tone: 'warn' as const };
  }
  if (status === 'insufficient') {
    return { label: 'Insufficient data', tone: 'warn' as const };
  }
  if (medianCpir <= 0) {
    return { label: 'Insufficient data', tone: 'warn' as const };
  }
  if (cpir <= medianCpir * 0.9) {
    return { label: 'Achieving', tone: 'good' as const };
  }
  if (cpir >= medianCpir * 1.1) {
    return { label: 'Losing', tone: 'bad' as const };
  }
  return { label: 'Not Achieved', tone: 'warn' as const };
}

function SimpleLineChart({
  points,
  lines,
  currency = 'INR',
  emptyMessage = 'No trend data available for this period.',
  interactive = false,
}: {
  points: TrendDataPoint[];
  lines: TrendLineSpec[];
  currency?: string;
  emptyMessage?: string;
  interactive?: boolean;
}) {
  const width = 920;
  const height = 250;
  const padding = 26;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<Array<keyof TrendDataPoint>>([]);

  const visibleLines = useMemo(() => {
    return lines.filter((line) => !hiddenKeys.includes(line.key));
  }, [hiddenKeys, lines]);

  const chartPoints = useMemo(() => {
    const rawValues = points.flatMap((point) => {
      return visibleLines.map((line) => {
        const value = point[line.key];
        return typeof value === 'number' ? value : null;
      });
    }).filter((value): value is number => typeof value === 'number');

    const minValue = rawValues.length > 0 ? Math.min(...rawValues) : 0;
    const maxValue = rawValues.length > 0 ? Math.max(...rawValues) : 0;
    const adjustedMax = maxValue === minValue ? maxValue + 1 : maxValue;

    return visibleLines.map((line) => {
      const coords = points.map((point, index) => {
        const raw = point[line.key];
        const value = typeof raw === 'number' ? raw : null;
        const x = padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
        if (value === null) {
          return { x, y: null, value: null };
        }
        const y =
          height -
          padding -
          ((value - minValue) / Math.max(adjustedMax - minValue, 0.0001)) * (height - padding * 2);
        return { x, y, value };
      });

      const segments: Array<Array<{ x: number; y: number }>> = [];
      let currentSegment: Array<{ x: number; y: number }> = [];
      for (const coord of coords) {
        if (coord.y === null) {
          if (currentSegment.length > 0) {
            segments.push(currentSegment);
            currentSegment = [];
          }
          continue;
        }
        currentSegment.push({ x: coord.x, y: coord.y });
      }
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
      }
      const lastSegment = segments[segments.length - 1] ?? [];
      const lastPoint = lastSegment[lastSegment.length - 1] ?? { x: padding, y: height - padding };

      return {
        ...line,
        segments,
        lastPoint,
        values: coords.map((coord) => coord.value),
      };
    });
  }, [points, visibleLines]);

  const tooltipRows = useMemo(() => {
    if (hoverIndex === null) {
      return [];
    }
    return chartPoints.map((line) => ({
      key: line.key,
      label: line.label,
      color: line.color,
      value: line.values[hoverIndex] ?? null,
      format: line.formatter ?? 'number',
    }));
  }, [chartPoints, hoverIndex]);

  if (!points.length) {
    return <p className="muted">{emptyMessage}</p>;
  }

  if (!visibleLines.length) {
    return <p className="muted">All lines are hidden. Click a legend item to show metrics.</p>;
  }

  function toggleLine(key: keyof TrendDataPoint) {
    setHiddenKeys((current) => {
      return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    });
  }

  function handleMouseMove(event: { currentTarget: SVGSVGElement; clientX: number }) {
    if (!interactive || points.length === 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    const normalized = Math.max(0, Math.min(1, relativeX / Math.max(rect.width, 1)));
    const nearest = Math.round(normalized * Math.max(points.length - 1, 0));
    setHoverIndex(nearest);
  }

  const hoverX =
    hoverIndex === null
      ? null
      : padding + (hoverIndex / Math.max(points.length - 1, 1)) * (width - padding * 2);

  return (
    <div className="simple-chart-wrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="simple-chart"
        role="img"
        aria-label="Trend chart"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
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
            {line.segments.map((segment, index) => (
              <polyline
                key={`${line.key}-segment-${index}`}
                fill="none"
                stroke={line.color}
                strokeWidth="2.6"
                strokeDasharray={line.dashed ? '7 5' : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
                points={segment.map((coord) => `${coord.x},${coord.y}`).join(' ')}
              />
            ))}
            <circle cx={line.lastPoint.x} cy={line.lastPoint.y} r="3.6" fill={line.color} />
          </g>
        ))}
        {interactive && hoverX !== null ? (
          <line x1={hoverX} y1={padding} x2={hoverX} y2={height - padding} className="chart-crosshair" />
        ) : null}
      </svg>
      <div className="chart-legend">
        {lines.map((line) => {
          const hidden = hiddenKeys.includes(line.key);
          return (
            <button
              key={line.label}
              type="button"
              className={`chart-legend-btn ${hidden ? 'muted' : ''}`}
              onClick={() => toggleLine(line.key)}
            >
            <i style={{ backgroundColor: line.color }} /> {line.label}
            </button>
          );
        })}
      </div>
      {interactive && hoverIndex !== null ? (
        <div className="chart-tooltip">
          <p className="muted">Date: {points[hoverIndex]?.date ?? '—'}</p>
          {tooltipRows.map((row) => (
            <p key={`${row.key}-value`}>
              <span style={{ color: row.color }}>{row.label}</span>: {formatTrendMetricValue(row.value, row.format, currency)}
            </p>
          ))}
        </div>
      ) : null}
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
  const [selectedProduct, setSelectedProduct] = useState<string>('__all__');
  const [previousCreativeIds, setPreviousCreativeIds] = useState<string[]>([]);
  const [targetHistory, setTargetHistory] = useState<TargetHistoryEntry[]>([]);
  const [creativeFatigue, setCreativeFatigue] = useState<Record<string, CreativeFatigueEntry>>({});
  const [incrementalityDetails, setIncrementalityDetails] = useState<IncrementalityResponse | null>(null);
  const [openIncrementalityKey, setOpenIncrementalityKey] = useState<string | null>(null);
  const [openFatigueCreativeId, setOpenFatigueCreativeId] = useState<string | null>(null);
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
      mroas: number | null;
    }>
  >([]);
  const [isGeneratingBreakdown, setIsGeneratingBreakdown] = useState<boolean>(false);
  const [isSavingTargets, setIsSavingTargets] = useState<boolean>(false);
  const [cpaTarget, setCpaTarget] = useState<number>(500);
  const [roasTarget, setRoasTarget] = useState<number>(3);
  const [dailySpendTarget, setDailySpendTarget] = useState<number>(50000);
  const [revenueTarget, setRevenueTarget] = useState<number>(100000);
  const [deviationThresholdPct, setDeviationThresholdPct] = useState<number>(10);
  const [breakdownTag1, setBreakdownTag1] = useState<string>('buying_type');
  const [breakdownTag2, setBreakdownTag2] = useState<string>('creative_format');
  const [breakdownTag3, setBreakdownTag3] = useState<string>('');
  const [breakdownTag4, setBreakdownTag4] = useState<string>('');
  const [breakdownMetrics, setBreakdownMetrics] = useState<BreakdownMetricKey[]>([
    'spend',
    'cpa',
    'roas',
    'cpir',
  ]);
  const [breakdownSort, setBreakdownSort] = useState<{
    key: BreakdownMetricKey;
    direction: 'desc' | 'asc';
  }>({ key: 'spend', direction: 'desc' });
  const [expandedTrendChartId, setExpandedTrendChartId] = useState<string | null>(null);
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('daily');
  const [missingTagReviewMode, setMissingTagReviewMode] = useState<boolean>(false);
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
        creativeObjectType?: string;
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
        creativeObjectType?: string;
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
            creativeObjectType: ad.creative?.objectType,
            metrics: ad.metrics ?? {
              spend: 0,
              impressions: 0,
              reach: 0,
              clicks: 0,
              purchases: 0,
              revenue: 0,
              revenueIncremental: 0,
              revenueFirstClick: 0,
              outboundClicks: 0,
              cpir: 0,
              cpa: 0,
              roas: 0,
              iroas: 0,
              fcRoas: 0,
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
        format: 'video' | 'image' | 'carousel' | 'unknown';
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
        format:
          row.creativeObjectType?.toUpperCase() === 'VIDEO'
            ? 'video'
            : row.creativeObjectType?.toUpperCase() === 'CAROUSEL'
              ? 'carousel'
              : row.creativeObjectType?.toUpperCase() === 'PHOTO' ||
                  row.creativeObjectType?.toUpperCase() === 'IMAGE'
                ? 'image'
                : 'unknown',
        adCount: 0,
        metrics: {
          spend: 0,
          impressions: 0,
          reach: 0,
          clicks: 0,
          purchases: 0,
          revenue: 0,
          revenueIncremental: 0,
          revenueFirstClick: 0,
          outboundClicks: 0,
          cpir: 0,
          cpa: 0,
          roas: 0,
          iroas: 0,
          fcRoas: 0,
        },
        ads: [],
      };
      const nextMetrics = {
        spend: current.metrics.spend + row.metrics.spend,
        impressions: current.metrics.impressions + row.metrics.impressions,
        reach: current.metrics.reach + row.metrics.reach,
        clicks: current.metrics.clicks + row.metrics.clicks,
        purchases: current.metrics.purchases + row.metrics.purchases,
        revenue: current.metrics.revenue + row.metrics.revenue,
        revenueIncremental:
          current.metrics.revenueIncremental + row.metrics.revenueIncremental,
        revenueFirstClick:
          current.metrics.revenueFirstClick + row.metrics.revenueFirstClick,
        outboundClicks: current.metrics.outboundClicks + row.metrics.outboundClicks,
        cpir: 0,
        cpa: 0,
        roas: 0,
        iroas: 0,
        fcRoas: 0,
      };
      nextMetrics.cpir = nextMetrics.reach > 0 ? (nextMetrics.spend * 1000) / nextMetrics.reach : 0;
      nextMetrics.cpa = nextMetrics.purchases > 0 ? nextMetrics.spend / nextMetrics.purchases : 0;
      nextMetrics.roas = nextMetrics.spend > 0 ? nextMetrics.revenue / nextMetrics.spend : 0;
      nextMetrics.iroas =
        nextMetrics.spend > 0
          ? nextMetrics.revenueIncremental / nextMetrics.spend
          : 0;
      nextMetrics.fcRoas =
        nextMetrics.spend > 0
          ? nextMetrics.revenueFirstClick / nextMetrics.spend
          : 0;
      map.set(row.creativeId, {
        ...current,
        creativeThumbnailUrl:
          current.creativeThumbnailUrl ?? row.creativeThumbnailUrl,
        creativeImageUrl: current.creativeImageUrl ?? row.creativeImageUrl,
        format:
          current.format !== 'unknown'
            ? current.format
            : row.creativeObjectType?.toUpperCase() === 'VIDEO'
              ? 'video'
              : row.creativeObjectType?.toUpperCase() === 'CAROUSEL'
                ? 'carousel'
                : row.creativeObjectType?.toUpperCase() === 'PHOTO' ||
                    row.creativeObjectType?.toUpperCase() === 'IMAGE'
                  ? 'image'
                  : 'unknown',
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
          if (projectItem.status && projectItem.status !== 'active') {
            continue;
          }
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
  const projectAccountIds = useMemo(() => project?.adAccountIds ?? [], [project]);
  const isAllAccountsOverview =
    activeScreen === 'overview' && effectiveAccountId === '__all__';
  const computedRevenueTarget =
    dailySpendTarget > 0 && roasTarget > 0 ? dailySpendTarget * roasTarget : 0;
  const effectiveRevenueTarget =
    computedRevenueTarget > 0 ? computedRevenueTarget : revenueTarget;

  const canFetchHierarchy = useMemo(
    () =>
      Boolean(
        since &&
          until &&
          ((effectiveAccountId && effectiveAccountId !== '__all__') ||
            (effectiveAccountId === '__all__' && projectAccountIds.length > 0)),
      ),
    [effectiveAccountId, projectAccountIds.length, since, until],
  );

  async function loadDashboard() {
    if (!canFetchHierarchy) {
      return;
    }

    setIsLoadingHierarchy(true);
    setError('');

    try {
      const params = new URLSearchParams({ since, until });
      if (project?.id) {
        params.set('projectId', project.id);
      }
      if (selectedProduct !== '__all__') {
        params.set('product', selectedProduct);
      }
      const previousRange = getPreviousRangeClient(since, until);
      const previousParams = new URLSearchParams({
        since: previousRange.since,
        until: previousRange.until,
      });
      if (project?.id) {
        previousParams.set('projectId', project.id);
      }
      if (selectedProduct !== '__all__') {
        previousParams.set('product', selectedProduct);
      }
      if (isAllAccountsOverview && projectAccountIds.length > 0) {
        const responses = await Promise.all(
          projectAccountIds.map(async (accountId) => {
            const [hierarchyResponse, reportResponse, trendsResponse, previousHierarchyResponse] = await Promise.all([
              fetch(
                `/api/meta/ad-accounts/${encodeURIComponent(accountId)}/hierarchy?${params.toString()}`,
              ),
              fetch(
                `/api/meta/ad-accounts/${encodeURIComponent(accountId)}/report?${params.toString()}`,
              ),
              fetch(
                `/api/meta/ad-accounts/${encodeURIComponent(accountId)}/trends?${params.toString()}`,
              ),
              fetch(
                `/api/meta/ad-accounts/${encodeURIComponent(accountId)}/hierarchy?${previousParams.toString()}`,
              ),
            ]);

            const hierarchyPayload = (await hierarchyResponse.json()) as MetaHierarchy & { message?: string };
            const reportPayload = (await reportResponse.json()) as MetaReportResponse & { message?: string };
            const trendsPayload = (await trendsResponse.json()) as MetaTrendsResponse & { message?: string };
            const previousHierarchyPayload =
              (await previousHierarchyResponse.json()) as MetaHierarchy & { message?: string };

            if (!hierarchyResponse.ok) {
              throw new Error(hierarchyPayload.message ?? `Failed to load hierarchy for ${accountId}`);
            }
            if (!reportResponse.ok) {
              throw new Error(reportPayload.message ?? `Failed to load report for ${accountId}`);
            }
            if (!trendsResponse.ok) {
              throw new Error(trendsPayload.message ?? `Failed to load trends for ${accountId}`);
            }
            if (!previousHierarchyResponse.ok) {
              throw new Error(
                previousHierarchyPayload.message ?? `Failed to load previous hierarchy for ${accountId}`,
              );
            }
            return { hierarchyPayload, reportPayload, trendsPayload, previousHierarchyPayload };
          }),
        );

        const aggregatedReport = aggregateReportResponses(
          responses.map((item) => item.reportPayload),
        );
        const aggregatedTrends = aggregateTrendsResponses(
          responses.map((item) => item.trendsPayload),
        );

        const mergedCampaigns = responses.flatMap((item) => {
          return item.hierarchyPayload.campaigns.map((campaign) => ({
            ...campaign,
            id: `${item.hierarchyPayload.accountId}:${campaign.id}`,
            name: `${campaign.name} (${item.hierarchyPayload.accountId})`,
            adsets: campaign.adsets.map((adset) => ({
              ...adset,
              id: `${item.hierarchyPayload.accountId}:${adset.id}`,
              ads: adset.ads.map((ad) => ({
                ...ad,
                id: `${item.hierarchyPayload.accountId}:${ad.id}`,
              })),
            })),
          }));
        });

        setHierarchy({
          accountId: 'all',
          range: responses[0]?.hierarchyPayload.range,
          totals: {
            campaigns: mergedCampaigns.length,
            adsets: mergedCampaigns.reduce((sum, campaign) => sum + campaign.adsets.length, 0),
            ads: mergedCampaigns.reduce(
              (sum, campaign) => sum + campaign.adsets.reduce((inner, adset) => inner + adset.ads.length, 0),
              0,
            ),
          },
          campaigns: mergedCampaigns,
        });
        setReport(aggregatedReport);
        setTrends(aggregatedTrends);
        setCreativeFatigue({});
        setIncrementalityDetails(null);
        setPreviousCreativeIds(
          responses.flatMap((item) =>
            item.previousHierarchyPayload.campaigns.flatMap((campaign) =>
              campaign.adsets.flatMap((adset) =>
                adset.ads
                  .map((ad) => ad.creative?.id)
                  .filter((id): id is string => Boolean(id)),
              ),
            ),
          ),
        );
      } else {
        const [hierarchyResponse, reportResponse, trendsResponse, previousHierarchyResponse, creativeFatigueResponse, incrementalityResponse] = await Promise.all([
          fetch(
            `/api/meta/ad-accounts/${encodeURIComponent(effectiveAccountId)}/hierarchy?${params.toString()}`,
          ),
          fetch(
            `/api/meta/ad-accounts/${encodeURIComponent(effectiveAccountId)}/report?${params.toString()}`,
          ),
          fetch(
            `/api/meta/ad-accounts/${encodeURIComponent(effectiveAccountId)}/trends?${params.toString()}`,
          ),
          fetch(
            `/api/meta/ad-accounts/${encodeURIComponent(effectiveAccountId)}/hierarchy?${previousParams.toString()}`,
          ),
          fetch(
            `/api/meta/ad-accounts/${encodeURIComponent(effectiveAccountId)}/creative-fatigue?${params.toString()}`,
          ),
          fetch(
            `/api/meta/ad-accounts/${encodeURIComponent(effectiveAccountId)}/incrementality?${params.toString()}`,
          ),
        ]);

        const hierarchyPayload = (await hierarchyResponse.json()) as MetaHierarchy & { message?: string };
        const reportPayload = (await reportResponse.json()) as MetaReportResponse & { message?: string };
        const trendsPayload = (await trendsResponse.json()) as MetaTrendsResponse & { message?: string };
        const previousHierarchyPayload =
          (await previousHierarchyResponse.json()) as MetaHierarchy & { message?: string };
        const creativeFatiguePayload = (await creativeFatigueResponse.json()) as {
          creatives?: Record<string, CreativeFatigueEntry>;
          message?: string;
        };
        const incrementalityPayload = (await incrementalityResponse.json()) as IncrementalityResponse & {
          message?: string;
        };

        if (!hierarchyResponse.ok) {
          throw new Error(hierarchyPayload.message ?? 'Failed to load hierarchy');
        }

        if (!reportResponse.ok) {
          throw new Error(reportPayload.message ?? 'Failed to load report');
        }

        if (!trendsResponse.ok) {
          throw new Error(trendsPayload.message ?? 'Failed to load trends');
        }
        if (!previousHierarchyResponse.ok) {
          throw new Error(
            previousHierarchyPayload.message ?? 'Failed to load previous hierarchy',
          );
        }
        if (!creativeFatigueResponse.ok) {
          throw new Error(creativeFatiguePayload.message ?? 'Failed to load creative fatigue');
        }
        if (!incrementalityResponse.ok) {
          throw new Error(incrementalityPayload.message ?? 'Failed to load incrementality diagnostics');
        }

        setHierarchy(hierarchyPayload);
        setReport(reportPayload);
        setTrends(trendsPayload);
        setCreativeFatigue(creativeFatiguePayload.creatives ?? {});
        setIncrementalityDetails(incrementalityPayload);
        setPreviousCreativeIds(
          previousHierarchyPayload.campaigns.flatMap((campaign) =>
            campaign.adsets.flatMap((adset) =>
              adset.ads
                .map((ad) => ad.creative?.id)
                .filter((id): id is string => Boolean(id)),
            ),
          ),
        );
      }

      setExpandedCampaigns([]);
      setExpandedAdSets([]);
      setExpandedCreatives([]);
      setExpandedMetric(null);
      setSelectedCreative(null);
      setOpenFatigueCreativeId(null);
      setOpenIncrementalityKey(null);
    } catch (loadError) {
      setHierarchy(null);
      setReport(null);
      setTrends(null);
      setCreativeFatigue({});
      setIncrementalityDetails(null);
      setPreviousCreativeIds([]);
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
          revenueTarget: effectiveRevenueTarget > 0 ? effectiveRevenueTarget : null,
        },
        deviationThresholdPct,
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
    setRevenueTarget(loadedProject.targets.revenueTarget ?? 0);
    setDeviationThresholdPct(loadedProject.deviationThresholdPct ?? 10);
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
    setSelectedProduct((current) => {
      if (current === '__all__') {
        return current;
      }
      return loadedProject.products.includes(current) ? current : '__all__';
    });
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
            revenueTarget: computedRevenueTarget > 0 ? computedRevenueTarget : null,
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
      const settingsResponse = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/settings`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviationThresholdPct,
          }),
        },
      );
      const settingsPayload = (await settingsResponse.json()) as { message?: string };
      if (!settingsResponse.ok) {
        throw new Error(settingsPayload.message ?? 'Failed to save project settings');
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
    if (selectedBreakdownTagKeys.length === 0) {
      setError('Select at least one tag before generating breakdown.');
      return;
    }
    setIsGeneratingBreakdown(true);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/custom-breakdown`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: effectiveAccountId,
            since,
            until,
            tagKeys: selectedBreakdownTagKeys,
            product: selectedProduct === '__all__' ? null : selectedProduct,
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
          mroas: number | null;
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
    if (selectedAccount !== '__all__') {
      void loadProjectState(selectedAccount).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load project state.');
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount]);

  useEffect(() => {
    if (!selectedAccount) {
      return;
    }
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct]);

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
    if (activeScreen !== 'overview') {
      return;
    }
    if (searchedAccountId) {
      return;
    }
    if (projectAccountIds.length > 1 && selectedAccount !== '__all__') {
      setSelectedAccount('__all__');
    }
  }, [activeScreen, projectAccountIds.length, searchedAccountId, selectedAccount]);

  useEffect(() => {
    if (activeScreen === 'overview') {
      return;
    }
    if (selectedAccount === '__all__') {
      const fallback = projectAccountIds[0] ?? accounts[0]?.accountId ?? '';
      if (fallback) {
        setSelectedAccount(fallback);
      }
    }
  }, [accounts, activeScreen, projectAccountIds, selectedAccount]);

  useEffect(() => {
    if (!expandedTrendChartId) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setExpandedTrendChartId(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [expandedTrendChartId]);

  const avgDailySpend = useMemo(() => {
    if (!trends?.points?.length) {
      return 0;
    }
    return trends.points.reduce((sum, point) => sum + point.spend, 0) / trends.points.length;
  }, [trends]);
  const deviationThreshold = Math.max(deviationThresholdPct, 0) / 100;

  const trendPointsWithTargets = useMemo(() => {
    const base = trends?.points ?? [];
    const cpaChanges = targetHistory
      .filter((item) => item.campaignId === null && item.targetType === 'cpa' && item.newValue !== null)
      .map((item) => ({ date: item.changedAt.slice(0, 10), value: item.newValue as number }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const roasChanges = targetHistory
      .filter((item) => item.campaignId === null && item.targetType === 'roas' && item.newValue !== null)
      .map((item) => ({ date: item.changedAt.slice(0, 10), value: item.newValue as number }))
      .sort((a, b) => a.date.localeCompare(b.date));

    function resolveSteppedValue(
      date: string,
      changes: Array<{ date: string; value: number }>,
      fallback: number,
    ) {
      let value = fallback > 0 ? fallback : null;
      for (const change of changes) {
        if (change.date <= date) {
          value = change.value;
        }
      }
      return value;
    }

    return base.map((point) => {
      const date = point.date ?? '';
      return {
        ...point,
        cpaTargetStep: date ? resolveSteppedValue(date, cpaChanges, cpaTarget) : null,
        roasTargetStep: date ? resolveSteppedValue(date, roasChanges, roasTarget) : null,
      };
    });
  }, [cpaTarget, roasTarget, targetHistory, trends]);

  const trendPointsForDisplay = useMemo(() => {
    return aggregateTrendPoints(trendPointsWithTargets, trendGranularity);
  }, [trendGranularity, trendPointsWithTargets]);

  const selectedBreakdownTagKeys = useMemo(() => {
    return [breakdownTag1, breakdownTag2, breakdownTag3, breakdownTag4].filter(Boolean);
  }, [breakdownTag1, breakdownTag2, breakdownTag3, breakdownTag4]);

  const customBreakdownDisplayRows = useMemo(() => {
    type Node = {
      key: string;
      label: string;
      level: number;
      spend: number;
      purchases: number;
      revenue: number;
      reach: number;
      outboundClicks: number;
      children: Map<string, Node>;
    };
    const root: Node = {
      key: 'root',
      label: 'root',
      level: -1,
      spend: 0,
      purchases: 0,
      revenue: 0,
      reach: 0,
      outboundClicks: 0,
      children: new Map(),
    };
    const leafMroasByLabel = new Map<string, number | null>();

    for (const row of customBreakdownApiRows) {
      const purchases = row.cpa && row.cpa > 0 ? row.spend / row.cpa : 0;
      const revenue = row.roas && row.roas > 0 ? row.roas * row.spend : 0;
      const reach = row.cpir && row.cpir > 0 ? (row.spend * 1000) / row.cpir : 0;
      const outboundClicks =
        row.conversionRate && row.conversionRate > 0 && purchases > 0
          ? purchases / (row.conversionRate / 100)
          : 0;
      const parts = row.label.split(' / ').map((item) => item.trim()).filter(Boolean);
      const values = parts.length > 0 ? parts : ['Untagged'];
      leafMroasByLabel.set(values.join(' / '), row.mroas ?? null);
      root.spend += row.spend;
      root.purchases += purchases;
      root.revenue += revenue;
      root.reach += reach;
      root.outboundClicks += outboundClicks;

      let current = root;
      for (let index = 0; index < values.length; index += 1) {
        const part = values[index] ?? 'Untagged';
        const key = `${current.key}>${part}`;
        const existing = current.children.get(key) ?? {
          key,
          label: part,
          level: index,
          spend: 0,
          purchases: 0,
          revenue: 0,
          reach: 0,
          outboundClicks: 0,
          children: new Map<string, Node>(),
        };
        existing.spend += row.spend;
        existing.purchases += purchases;
        existing.revenue += revenue;
        existing.reach += reach;
        existing.outboundClicks += outboundClicks;
        current.children.set(key, existing);
        current = existing;
      }
    }

    function metricValue(node: Node, key: BreakdownMetricKey) {
      if (key === 'spend') {
        return node.spend;
      }
      if (key === 'cpa') {
        return node.purchases > 0 ? node.spend / node.purchases : null;
      }
      if (key === 'roas') {
        return node.spend > 0 ? node.revenue / node.spend : null;
      }
      if (key === 'cpir') {
        return node.reach > 0 ? (node.spend * 1000) / node.reach : null;
      }
      if (key === 'conversionRate') {
        return node.outboundClicks > 0 ? (node.purchases / node.outboundClicks) * 100 : null;
      }
      return null;
    }

    function sortNodes(nodes: Node[]) {
      const direction = breakdownSort.direction === 'desc' ? -1 : 1;
      return [...nodes].sort((a, b) => {
        if (a.label === 'Untagged' && b.label !== 'Untagged') {
          return 1;
        }
        if (b.label === 'Untagged' && a.label !== 'Untagged') {
          return -1;
        }
        const aValue = metricValue(a, breakdownSort.key);
        const bValue = metricValue(b, breakdownSort.key);
        const safeA = typeof aValue === 'number' ? aValue : -Infinity;
        const safeB = typeof bValue === 'number' ? bValue : -Infinity;
        return (safeA - safeB) * direction;
      });
    }

    const flattened: Array<{
      key: string;
      label: string;
      level: number;
      spend: number;
      cpa: number | null;
      roas: number | null;
      cpir: number | null;
      conversionRate: number | null;
      mroas: number | null;
      isTotal?: boolean;
    }> = [];

    function walk(nodes: Node[]) {
      for (const node of sortNodes(nodes)) {
        flattened.push({
          key: node.key,
          label: node.label,
          level: node.level,
          spend: node.spend,
          cpa: metricValue(node, 'cpa'),
          roas: metricValue(node, 'roas'),
          cpir: metricValue(node, 'cpir'),
          conversionRate: metricValue(node, 'conversionRate'),
          mroas: leafMroasByLabel.get(node.key.split('>').slice(1).join(' / ')) ?? null,
        });
        walk([...node.children.values()]);
      }
    }

    walk([...root.children.values()]);
    flattened.push({
      key: 'total',
      label: 'TOTAL',
      level: 0,
      spend: root.spend,
      cpa: metricValue(root, 'cpa'),
      roas: metricValue(root, 'roas'),
      cpir: metricValue(root, 'cpir'),
      conversionRate: metricValue(root, 'conversionRate'),
      mroas: null,
      isTotal: true,
    });
    return flattened.slice(0, 500);
  }, [breakdownSort, customBreakdownApiRows]);

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

  const overviewCpaScatter = useMemo(() => {
    const valid = adRows.filter(
      (row) => row.metrics.spend > 0 && row.metrics.purchases > 0,
    );
    const excludedCount = adRows.filter(
      (row) => row.metrics.spend > 0 && row.metrics.purchases <= 0,
    ).length;
    const totalSpend = valid.reduce((sum, row) => sum + row.metrics.spend, 0);
    const belowSpend = valid
      .filter((row) => row.metrics.cpa <= cpaTarget)
      .reduce((sum, row) => sum + row.metrics.spend, 0);
    return {
      rows: valid.slice(0, 200),
      excludedCount,
      belowSpendPct: totalSpend > 0 ? (belowSpend / totalSpend) * 100 : 0,
      aboveSpendPct:
        totalSpend > 0 ? ((totalSpend - belowSpend) / totalSpend) * 100 : 0,
    };
  }, [adRows, cpaTarget]);

  const overviewCpirScatter = useMemo(() => {
    const valid = adRows.filter(
      (row) => row.metrics.spend > 0 && row.metrics.reach > 0,
    );
    const cpirValues = valid.map((row) => row.metrics.cpir).sort((a, b) => a - b);
    return {
      rows: valid.slice(0, 200),
      medianCpir: median(cpirValues),
    };
  }, [adRows]);

  const overviewCreativeVelocity = useMemo(() => {
    const totalSpend = adRows.reduce((sum, row) => sum + row.metrics.spend, 0);
    const top3Spend = [...adRows]
      .sort((a, b) => b.metrics.spend - a.metrics.spend)
      .slice(0, 3)
      .reduce((sum, row) => sum + row.metrics.spend, 0);

    const currentCreatives = new Set(
      adRows
        .map((row) => row.creativeId)
        .filter((value): value is string => Boolean(value)),
    );
    const previousSet = new Set(previousCreativeIds);
    const newCreativeIds = [...currentCreatives].filter(
      (creativeId) => !previousSet.has(creativeId),
    );
    const newCreativeSet = new Set(newCreativeIds);
    const newCreativeSpend = adRows.reduce((sum, row) => {
      if (!row.creativeId || !newCreativeSet.has(row.creativeId)) {
        return sum;
      }
      return sum + row.metrics.spend;
    }, 0);

    return {
      top3SpendShare: totalSpend > 0 ? (top3Spend / totalSpend) * 100 : 0,
      newCreativeRate:
        currentCreatives.size > 0
          ? (newCreativeIds.length / currentCreatives.size) * 100
          : 0,
      newCreativeSpendShare:
        totalSpend > 0 ? (newCreativeSpend / totalSpend) * 100 : 0,
    };
  }, [adRows, previousCreativeIds]);

  const rollingMroas = useMemo(() => {
    if (!trendPointsWithTargets.length) {
      return [] as Array<{ date: string; value: number | null }>;
    }
    return rollingMroasPoints(trendPointsWithTargets, 14);
  }, [trendPointsWithTargets]);

  const trendsChartLibrary = useMemo(() => {
    const base: TrendChartSpec[] = [
      {
        id: 'chart-1',
        title: '1. CPA vs ROAS',
        subtitle: 'Baseline efficiency trend',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'cpaTargetStep', label: 'CPA Target', color: '#334155', dashed: true, formatter: 'currency' },
          { key: 'roasTargetStep', label: 'ROAS Target', color: '#7c3aed', dashed: true, formatter: 'roas' },
        ],
      },
      {
        id: 'chart-2',
        title: '2. CPA vs ROAS vs Virality',
        subtitle: 'Engagement-weighted virality vs efficiency',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'virality', label: 'Virality', color: '#22c55e', formatter: 'number' },
        ],
      },
      {
        id: 'chart-3',
        title: '3. CPA vs ROAS vs Top 3 Spend Share',
        subtitle: 'Creative concentration',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'top3SpendShare', label: 'Top 3 Spend Share', color: '#22c55e', formatter: 'percent' },
        ],
      },
      {
        id: 'chart-4',
        title: '4. CPA vs ROAS vs Video Spend Share',
        subtitle: 'Video format mix and efficiency',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'videoSpendShare', label: 'Video Spend Share', color: '#22c55e', formatter: 'percent' },
        ],
      },
      {
        id: 'chart-5',
        title: '5. CPA vs ROAS vs Static Spend Share',
        subtitle: 'Image/static format mix and efficiency',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'staticSpendShare', label: 'Static Spend Share', color: '#22c55e', formatter: 'percent' },
        ],
      },
      {
        id: 'chart-6',
        title: '6. CPA vs ROAS vs CPIR',
        subtitle: 'Reach + acquisition efficiency',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'cpir', label: 'CPIR', color: '#ef4444', dashed: true, formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
        ],
      },
      {
        id: 'chart-7',
        title: '7. CPA vs ROAS vs Placement Spend Share',
        subtitle: 'Top placement spend share vs efficiency',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'placementTopShare', label: 'Top Placement Share', color: '#22c55e', formatter: 'percent' },
        ],
      },
      {
        id: 'chart-8',
        title: '8. CPA vs ROAS vs Age Spend Share',
        subtitle: 'Top age-bucket spend share vs efficiency',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'ageTopShare', label: 'Top Age Share', color: '#22c55e', formatter: 'percent' },
        ],
      },
      {
        id: 'chart-9',
        title: '9. CPA vs ROAS vs CRC',
        subtitle: 'Creative refresh cadence',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'newCreativeRate', label: 'CRC %', color: '#22c55e', formatter: 'percent' },
        ],
      },
      {
        id: 'chart-10',
        title: '10. CPA vs ROAS vs New Creative Rate',
        subtitle: 'New creative velocity',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'newCreativeRate', label: 'New Creative Rate', color: '#22c55e', formatter: 'percent' },
        ],
      },
      {
        id: 'chart-11',
        title: '11. CPA vs ROAS vs New Creative Spend Share',
        subtitle: 'Spend share to new creatives',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'newCreativeSpendShare', label: 'New Creative Spend Share', color: '#22c55e', formatter: 'percent' },
        ],
      },
      {
        id: 'chart-12',
        title: '12. CPA vs Spend',
        subtitle: 'Scatter lives in Overview/Creative cards',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'spend', label: 'Spend', color: '#2563eb', formatter: 'currency' },
        ],
      },
      {
        id: 'chart-13',
        title: '13. CPA vs ROAS vs Changes Made',
        subtitle: 'Change-history overlay',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
        ],
        unavailableReason: 'Changes overlay requires Activity History daily counts.',
      },
      {
        id: 'chart-14',
        title: '14. CPA vs ROAS vs Conversion Rate',
        subtitle: 'Funnel efficiency',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'conversionRate', label: 'Conversion Rate', color: '#0f766e', formatter: 'percent' },
        ],
      },
      {
        id: 'chart-15',
        title: '15. Spend Pacing (Hourly)',
        subtitle: 'Spend pacing trend',
        lines: [{ key: 'spend', label: 'Spend', color: '#2563eb', formatter: 'currency' }],
      },
      {
        id: 'chart-16',
        title: '16. CPA vs ROAS vs Hook Rate',
        subtitle: 'Video hook performance',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'hookRate', label: 'Hook Rate', color: '#7c3aed', formatter: 'percent' },
        ],
      },
      {
        id: 'chart-17',
        title: '17. CPA vs ROAS vs Hold Rate',
        subtitle: 'Video hold performance',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'holdRate', label: 'Hold Rate', color: '#9333ea', formatter: 'percent' },
        ],
      },
      {
        id: 'chart-18',
        title: '18. Incremental vs 1DC vs View Revenue',
        subtitle: 'Attribution composition',
        lines: [
          { key: 'revenue', label: 'Revenue', color: '#10b981', formatter: 'currency' },
          { key: 'revenue7dClick', label: 'Revenue 7d Click', color: '#2563eb', formatter: 'currency' },
          { key: 'revenue1dView', label: 'Revenue 1d View', color: '#14b8a6', formatter: 'currency' },
        ],
      },
      {
        id: 'chart-19',
        title: '19. ROAS vs IROAS vs mROAS',
        subtitle: 'Reported vs incremental vs marginal',
        lines: [
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
          { key: 'iroas', label: 'IROAS', color: '#16a34a', formatter: 'roas' },
          { key: 'mroas', label: 'mROAS', color: '#a855f7', formatter: 'roas' },
        ],
      },
      {
        id: 'chart-20',
        title: '20. CPA vs ROAS vs CPM',
        subtitle: 'Media cost pressure',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'cpm', label: 'CPM', color: '#e11d48', dashed: true, formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
        ],
      },
      {
        id: 'chart-21a',
        title: '21a. Audience Segment Spend Share',
        subtitle: 'Prospecting vs engaged vs existing',
        lines: [{ key: 'spend', label: 'Spend', color: '#2563eb', formatter: 'currency' }],
        unavailableReason: 'Audience segment breakdown sync is pending.',
      },
      {
        id: 'chart-21b',
        title: '21b. Audience Segment Frequency',
        subtitle: 'Segment-level frequency',
        lines: [{ key: 'frequency', label: 'Frequency', color: '#9333ea', formatter: 'number' }],
        unavailableReason: 'Audience segment breakdown sync is pending.',
      },
      {
        id: 'chart-22',
        title: '22. CPA vs ROAS vs Ad Rejection Rate',
        subtitle: 'Rejection impact',
        lines: [
          { key: 'cpa', label: 'CPA', color: '#f97316', formatter: 'currency' },
          { key: 'roasBlend', label: 'ROAS', color: '#0ea5e9', formatter: 'roas' },
        ],
        unavailableReason: 'Ad rejection history overlay requires activity events.',
      },
      {
        id: 'chart-23',
        title: '23. Rolling 14-Day Median mROAS',
        subtitle: 'Marginal efficiency over time',
        lines: [{ key: 'mroas', label: 'mROAS', color: '#0ea5e9', formatter: 'roas' }],
      },
    ];
    return base;
  }, []);

  const trendPointsForCharts = useMemo(() => {
    const mroasByDate = new Map(rollingMroas.map((item) => [item.date, item.value]));
    return trendPointsForDisplay.map((point) => ({
      ...point,
      mroas: point.date ? mroasByDate.get(point.date) ?? null : null,
      iroas: asNumber(point.spend) > 0 ? asNumber(point.revenue) / asNumber(point.spend) : null,
      virality: point.virality ?? null,
    }));
  }, [rollingMroas, trendPointsForDisplay]);

  const expandedTrendChart = useMemo(() => {
    return trendsChartLibrary.find((item) => item.id === expandedTrendChartId) ?? null;
  }, [expandedTrendChartId, trendsChartLibrary]);

  const optimizationMedianCpir = useMemo(() => {
    if (!hierarchy) {
      return 0;
    }
    const values = hierarchy.campaigns
      .map((campaign) => campaign.metrics?.cpir ?? 0)
      .filter((value) => value > 0)
      .sort((a, b) => a - b);
    return median(values);
  }, [hierarchy]);

  const missingTagEntities = useMemo(() => {
    if (!hierarchy) {
      return { keys: new Set<string>(), count: 0 };
    }

    function hasMissingTag(
      entityType: EntityType,
      entityId: string,
      lineage?: TagLineage,
    ) {
      return tagCatalogOptions.some((category) => {
        const effective = getEffectiveTagWithSource(
          persistedTags,
          entityType,
          entityId,
          category.key,
          lineage,
        );
        return effective.value === 'Untagged';
      });
    }

    const keys = new Set<string>();
    for (const campaign of hierarchy.campaigns) {
      if ((campaign.metrics?.spend ?? 0) > 0 && hasMissingTag('campaign', campaign.id, { campaignId: campaign.id })) {
        keys.add(`campaign:${campaign.id}`);
      }
      for (const adset of campaign.adsets) {
        if (
          (adset.metrics?.spend ?? 0) > 0 &&
          hasMissingTag('adset', adset.id, { campaignId: campaign.id, adSetId: adset.id })
        ) {
          keys.add(`adset:${adset.id}`);
        }
        for (const ad of adset.ads) {
          if (
            (ad.metrics?.spend ?? 0) > 0 &&
            hasMissingTag('ad', ad.id, { campaignId: campaign.id, adSetId: adset.id })
          ) {
            keys.add(`ad:${ad.id}`);
          }
        }
      }
    }
    return { keys, count: keys.size };
  }, [hierarchy, persistedTags, tagCatalogOptions]);

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

  function toggleBreakdownMetric(metric: BreakdownMetricKey) {
    setBreakdownMetrics((current) => {
      if (current.includes(metric)) {
        if (current.length === 1) {
          return current;
        }
        return current.filter((item) => item !== metric);
      }
      return [...current, metric];
    });
  }

  function toggleBreakdownSort(metric: BreakdownMetricKey) {
    setBreakdownSort((current) => {
      if (current.key !== metric) {
        return { key: metric, direction: 'desc' };
      }
      return { key: metric, direction: current.direction === 'desc' ? 'asc' : 'desc' };
    });
  }

  function isTagOptionDisabled(optionKey: string, ownValue: string) {
    return selectedBreakdownTagKeys.includes(optionKey) && ownValue !== optionKey;
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
                  disabled={isLoadingAccounts || (filteredAccounts.length === 0 && projectAccountIds.length === 0)}
                >
                  {activeScreen === 'overview' && projectAccountIds.length > 1 ? (
                    <option value="__all__">All Accounts (Project)</option>
                  ) : null}
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
              <label>
                Product
                <select
                  value={selectedProduct}
                  onChange={(event) => {
                    setSelectedProduct(event.target.value);
                  }}
                >
                  <option value="__all__">All Products</option>
                  {(project?.products ?? []).map((productName) => (
                    <option key={`product-${productName}`} value={productName}>
                      {productName}
                    </option>
                  ))}
                </select>
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
              <label>
                Revenue Target
                <input
                  type="number"
                  min={1}
                  value={computedRevenueTarget}
                  readOnly
                />
              </label>
              <label>
                Deviation Threshold (%)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={deviationThresholdPct}
                  onChange={(event) => setDeviationThresholdPct(Number(event.target.value) || 0)}
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
          <article
            className={`alert-card ${
              report.summary.cpa.current <= cpaTarget * (1 + deviationThreshold)
                ? 'good'
                : 'bad'
            }`}
          >
            <h3>CPA Deviation</h3>
            <p>
              Current: {formatMetricValue(report.summary.cpa.current, 'currency', report.currency)} | Target:{' '}
              {formatMetricValue(cpaTarget, 'currency', report.currency)}
            </p>
            <p className="muted">{formatPercent(Math.abs(percentDiff(report.summary.cpa.current, cpaTarget)))} deviation</p>
          </article>
          <article
            className={`alert-card ${
              report.summary.roas.current >= roasTarget * (1 - deviationThreshold)
                ? 'good'
                : 'bad'
            }`}
          >
            <h3>ROAS Deviation</h3>
            <p>
              Current: {report.summary.roas.current.toFixed(2)}x | Target: {roasTarget.toFixed(2)}x
            </p>
            <p className="muted">{formatPercent(Math.abs(percentDiff(report.summary.roas.current, roasTarget)))} deviation</p>
          </article>
          <article
            className={`alert-card ${
              effectiveRevenueTarget > 0 &&
              report.summary.purchaseValue.current >=
                effectiveRevenueTarget * (1 - deviationThreshold)
                ? 'good'
                : 'bad'
            }`}
          >
            <h3>Revenue Deviation</h3>
            <p>
              Current: {formatMetricValue(report.summary.purchaseValue.current, 'currency', report.currency)} | Target:{' '}
              {formatMetricValue(effectiveRevenueTarget, 'currency', report.currency)}
            </p>
            <p className="muted">
              {formatPercent(Math.abs(percentDiff(report.summary.purchaseValue.current, effectiveRevenueTarget)))} deviation
            </p>
          </article>
          <article
            className={`alert-card ${
              avgDailySpend <= dailySpendTarget * (1 + deviationThreshold) &&
              avgDailySpend >= dailySpendTarget * (1 - deviationThreshold)
                ? 'warn'
                : 'bad'
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

      {activeScreen === 'overview' ? (
        <section className="table-card">
          <header className="table-header">
            <h2>Scatter + Edits</h2>
            <p className="muted">CPA/CPIR spend distribution and latest edits context.</p>
          </header>
          <div className="kpi-charts-grid">
            <article className="chart-card">
              <h3>CPA vs Spend</h3>
              {(() => {
                const width = 900;
                const height = 280;
                const padding = 32;
                const maxSpend = Math.max(
                  ...overviewCpaScatter.rows.map((row) => row.metrics.spend),
                  1,
                );
                const maxCpa = Math.max(
                  ...overviewCpaScatter.rows.map((row) => row.metrics.cpa),
                  1,
                );
                const targetY =
                  height -
                  padding -
                  (Math.min(cpaTarget, maxCpa) / maxCpa) * (height - padding * 2);

                return (
                  <>
                    <svg viewBox={`0 0 ${width} ${height}`} className="creative-scatter-svg" role="img" aria-label="CPA spend scatter">
                      {[0, 1, 2, 3, 4].map((step) => {
                        const y = padding + (step / 4) * (height - padding * 2);
                        return (
                          <line key={`overview-cpa-grid-${step}`} x1={padding} y1={y} x2={width - padding} y2={y} className="chart-grid" />
                        );
                      })}
                      {cpaTarget > 0 ? (
                        <line
                          x1={padding}
                          y1={targetY}
                          x2={width - padding}
                          y2={targetY}
                          className="median-line"
                        />
                      ) : null}
                      {overviewCpaScatter.rows.map((row) => {
                        const x =
                          padding +
                          (row.metrics.spend / maxSpend) * (width - padding * 2);
                        const y =
                          height -
                          padding -
                          (row.metrics.cpa / maxCpa) * (height - padding * 2);
                        return (
                          <circle
                            key={`overview-cpa-dot-${row.adId}`}
                            cx={x}
                            cy={y}
                            r={Math.max(4, Math.min(12, (row.metrics.spend / maxSpend) * 12))}
                            fill={row.metrics.cpa <= cpaTarget ? '#16a34a' : '#dc2626'}
                            opacity="0.8"
                          >
                            <title>
                              {`${row.adName} | Spend ${row.metrics.spend.toFixed(2)} | CPA ${row.metrics.cpa.toFixed(2)}`}
                            </title>
                          </circle>
                        );
                      })}
                    </svg>
                    <p className="muted">
                      Below CPA target: {overviewCpaScatter.belowSpendPct.toFixed(1)}% spend
                      {' | '}
                      Above CPA target: {overviewCpaScatter.aboveSpendPct.toFixed(1)}% spend
                      {overviewCpaScatter.excludedCount > 0
                        ? ` | Excluded ${overviewCpaScatter.excludedCount} ads with spend and no purchases`
                        : ''}
                    </p>
                  </>
                );
              })()}
            </article>
            <article className="chart-card">
              <h3>CPIR vs Spend</h3>
              {(() => {
                const width = 900;
                const height = 280;
                const padding = 32;
                const maxSpend = Math.max(
                  ...overviewCpirScatter.rows.map((row) => row.metrics.spend),
                  1,
                );
                const maxCpir = Math.max(
                  ...overviewCpirScatter.rows.map((row) => row.metrics.cpir),
                  1,
                );
                const medianY =
                  height -
                  padding -
                  (overviewCpirScatter.medianCpir / maxCpir) * (height - padding * 2);
                return (
                  <>
                    <svg viewBox={`0 0 ${width} ${height}`} className="creative-scatter-svg" role="img" aria-label="CPIR spend scatter">
                      {[0, 1, 2, 3, 4].map((step) => {
                        const y = padding + (step / 4) * (height - padding * 2);
                        return (
                          <line key={`overview-cpir-grid-${step}`} x1={padding} y1={y} x2={width - padding} y2={y} className="chart-grid" />
                        );
                      })}
                      <line x1={padding} y1={medianY} x2={width - padding} y2={medianY} className="median-line" />
                      {overviewCpirScatter.rows.map((row) => {
                        const x =
                          padding +
                          (row.metrics.spend / maxSpend) * (width - padding * 2);
                        const y =
                          height -
                          padding -
                          (row.metrics.cpir / maxCpir) * (height - padding * 2);
                        return (
                          <circle
                            key={`overview-cpir-dot-${row.adId}`}
                            cx={x}
                            cy={y}
                            r={Math.max(4, Math.min(12, (row.metrics.spend / maxSpend) * 12))}
                            fill={row.metrics.cpir <= overviewCpirScatter.medianCpir ? '#16a34a' : '#f59e0b'}
                            opacity="0.8"
                          >
                            <title>
                              {`${row.adName} | Spend ${row.metrics.spend.toFixed(2)} | CPIR ${row.metrics.cpir.toFixed(2)}`}
                            </title>
                          </circle>
                        );
                      })}
                    </svg>
                    <p className="muted">
                      Median CPIR: {formatMetricValue(overviewCpirScatter.medianCpir, 'currency', report?.currency ?? 'INR')}
                    </p>
                  </>
                );
              })()}
            </article>
            <article className="chart-card">
              <h3>Edits Info</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Changed At</th>
                      <th>Scope</th>
                      <th>Type</th>
                      <th>Old</th>
                      <th>New</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targetHistory.slice(0, 8).map((entry) => (
                      <tr key={`overview-edit-${entry.id}`}>
                        <td>{new Date(entry.changedAt).toLocaleString()}</td>
                        <td>{entry.campaignId ? 'Campaign' : 'Project'}</td>
                        <td>{entry.targetType}</td>
                        <td>{entry.oldValue ?? '—'}</td>
                        <td>{entry.newValue ?? '—'}</td>
                      </tr>
                    ))}
                    {targetHistory.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="muted">No edits logged yet.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {activeScreen === 'overview' ? (
        <section className="alerts-grid">
          <article className="alert-card good">
            <h3>Top 3 Spend Share</h3>
            <p>{overviewCreativeVelocity.top3SpendShare.toFixed(1)}%</p>
            <p className="muted">Share of total spend in top 3 ads.</p>
          </article>
          <article className="alert-card warn">
            <h3>New Creative Rate</h3>
            <p>{overviewCreativeVelocity.newCreativeRate.toFixed(1)}%</p>
            <p className="muted">Current creatives not active in previous period.</p>
          </article>
          <article className="alert-card bad">
            <h3>New Creative Spend Share</h3>
            <p>{overviewCreativeVelocity.newCreativeSpendShare.toFixed(1)}%</p>
            <p className="muted">Spend concentrated on newly active creatives.</p>
          </article>
        </section>
      ) : null}

      {activeScreen === 'overview' ? (
        <section className="table-card">
          <header className="table-header">
            <h2>Rolling 14-Day mROAS</h2>
            <p className="muted">Median of daily delta revenue over absolute delta spend.</p>
          </header>
          <div className="scatter-grid scatter-chart-card">
            {rollingMroas.filter((point) => point.value !== null).length >= 3 ? (
              <SimpleLineChart
                points={rollingMroas
                  .filter((point): point is { date: string; value: number } => point.value !== null)
                  .map((point) => ({
                    date: point.date,
                    spend: point.value,
                    purchases: 0,
                    revenue: 0,
                    revenue7dClick: 0,
                    revenue1dView: 0,
                    roas7dClick: 0,
                    roasBlend: 0,
                    cpir: 0,
                    cpa: 0,
                    cpcOutbound: 0,
                    cpm: 0,
                    frequency: 0,
                    impressions: 0,
                    reach: 0,
                    aov: 0,
                    conversionRate: 0,
                    hookRate: 0,
                    holdRate: 0,
                  }))}
                lines={[{ key: 'spend', label: 'Rolling mROAS', color: '#0ea5e9' }]}
              />
            ) : (
              <p className="muted">Insufficient data for rolling mROAS (min 3 valid points).</p>
            )}
          </div>
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
            <p className="muted">
              23 fixed cards. Click any card for expanded view with hover crosshair, legend toggles, and daily/weekly switch.
            </p>
          </header>
          <div className="trends-grid">
            {trendsChartLibrary.map((chart) => (
              <article
                key={chart.id}
                className="chart-card trend-card"
                role="button"
                tabIndex={0}
                onClick={() => {
                  setExpandedTrendChartId(chart.id);
                  setTrendGranularity('daily');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setExpandedTrendChartId(chart.id);
                    setTrendGranularity('daily');
                  }
                }}
              >
                <h3>{chart.title}</h3>
                <p className="muted">{chart.subtitle}</p>
                <SimpleLineChart
                  points={trendPointsForCharts}
                  lines={chart.lines}
                  currency={report?.currency ?? 'INR'}
                  emptyMessage="No data available for this period."
                />
                {chart.unavailableReason ? (
                  <p className="muted">{chart.unavailableReason}</p>
                ) : null}
              </article>
            ))}
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
                  <th>Budget Type</th>
                  <th>Budget</th>
                  <th>Objective / Creative</th>
                </tr>
              </thead>
              <tbody>
                {hierarchy.campaigns.map((campaign) => {
                  const campaignExpanded = expandedCampaigns.includes(campaign.id);
                  const campaignIsCbo =
                    (campaign.dailyBudget ?? 0) > 0 ||
                    (campaign.lifetimeBudget ?? 0) > 0;
                  const budgetType = campaignIsCbo ? 'CBO' : 'ABO';
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
                        <td>{budgetType}</td>
                        <td>
                          {campaignIsCbo
                            ? formatBudgetValue(
                                campaign.dailyBudget,
                                campaign.lifetimeBudget,
                                report?.currency ?? 'INR',
                              )
                            : '—'}
                        </td>
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
                                  <td>{budgetType}</td>
                                  <td>
                                    {!campaignIsCbo
                                      ? formatBudgetValue(
                                          adset.dailyBudget,
                                          adset.lifetimeBudget,
                                          report?.currency ?? 'INR',
                                        )
                                      : '—'}
                                  </td>
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
                                        <td>{budgetType}</td>
                                        <td>—</td>
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
            <p className="muted">
              Mode:{' '}
              {project?.optimizationMethod === 'first_click_present'
                ? 'First Click Data Present'
                : 'First Click Data Not Present'}
            </p>
          </header>
          <p className="muted inheritance-guide">
            Inheritance rule:
            <span className="inheritance-pill">Ad: ad → ad set → campaign</span>
            <span className="inheritance-pill">Ad Set: ad set → campaign</span>
            <span className="inheritance-pill">Campaign: campaign only</span>
          </p>
          {missingTagEntities.count > 0 ? (
            <section className="alerts-grid" style={{ marginBottom: 12 }}>
              <article className="alert-card warn">
                <h3>Missing Tag Alert</h3>
                <p>{missingTagEntities.count} entities with spend have missing tags.</p>
                <div className="target-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setMissingTagReviewMode((current) => !current)}
                  >
                    {missingTagReviewMode ? 'Show All' : 'Review'}
                  </button>
                </div>
              </article>
            </section>
          ) : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Spend</th>
                  <th>CPA</th>
                  <th>ROAS</th>
                  <th>CPIR</th>
                  <th>
                    {project?.optimizationMethod === 'first_click_present'
                      ? 'FC ROAS'
                      : 'IROAS'}
                  </th>
                  <th>Incrementality</th>
                  <th>CPA Target</th>
                  <th>ROAS Target</th>
                  <th>Tags</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {hierarchy.campaigns.map((campaign) => {
                  const campaignExpanded = optExpandedCampaigns.includes(campaign.id);
                  const campaignIncrementality = incrementalityBadgeFromCpir(
                    campaign.metrics?.incrementalityStatus,
                    campaign.metrics?.cpir ?? 0,
                    optimizationMedianCpir,
                  );
                  const campaignIncrementalityDetail = incrementalityDetails?.campaigns?.[campaign.id];
                  const adsetsForReview = campaign.adsets.filter((adset) => {
                    if (!missingTagReviewMode) {
                      return true;
                    }
                    if (missingTagEntities.keys.has(`adset:${adset.id}`)) {
                      return true;
                    }
                    return adset.ads.some((ad) => missingTagEntities.keys.has(`ad:${ad.id}`));
                  });
                  const campaignHasMissing = missingTagEntities.keys.has(`campaign:${campaign.id}`);
                  if (missingTagReviewMode && !campaignHasMissing && adsetsForReview.length === 0) {
                    return null;
                  }
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
                      <td>
                        {(
                          project?.optimizationMethod === 'first_click_present'
                            ? campaign.metrics?.fcRoas
                            : campaign.metrics?.iroas
                        )?.toFixed(2)}
                        x
                      </td>
                      <td>{formatMetricValue(campaign.metrics?.cpir ?? 0, 'currency', report?.currency ?? 'INR')}</td>
                      <td>{(campaign.metrics?.roas ?? 0).toFixed(2)}x</td>
                      <td>
                        <button
                          type="button"
                          className={`status-pill fatigue-${campaignIncrementality.tone} fatigue-badge-btn`}
                          onClick={() =>
                            setOpenIncrementalityKey((current) =>
                              current === `campaign:${campaign.id}` ? null : `campaign:${campaign.id}`,
                            )
                          }
                        >
                          {campaignIncrementality.label}
                        </button>
                        {openIncrementalityKey === `campaign:${campaign.id}` && campaignIncrementalityDetail ? (
                          <div className="fatigue-popover">
                            <p><strong>CPIR Trend:</strong> {campaignIncrementalityDetail.cpirTrend} | slope {campaignIncrementalityDetail.cpirSlope?.toFixed(4) ?? '—'} | p {campaignIncrementalityDetail.cpirPValue?.toFixed(4) ?? '—'}</p>
                            <p><strong>CTR Trend:</strong> {campaignIncrementalityDetail.ctrTrend} | slope {campaignIncrementalityDetail.ctrSlope?.toFixed(4) ?? '—'} | p {campaignIncrementalityDetail.ctrPValue?.toFixed(4) ?? '—'}</p>
                            <p><strong>Spend Share:</strong> {campaignIncrementalityDetail.spendShare}</p>
                            <p><strong>Window:</strong> {incrementalityDetails?.window?.since ?? '—'} to {incrementalityDetails?.window?.until ?? '—'}</p>
                          </div>
                        ) : null}
                      </td>
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
                        <td colSpan={11}>
                          {renderTagPanel('campaign', campaign.id, {
                            campaignId: campaign.id,
                          })}
                        </td>
                      </tr>
                    ) : null}
                    {campaignExpanded
                      ? adsetsForReview.map((adset) => {
                          const adSetExpanded = optExpandedAdSets.includes(adset.id);
                          const adSetIncrementality = incrementalityBadgeFromCpir(
                            adset.metrics?.incrementalityStatus,
                            adset.metrics?.cpir ?? 0,
                            optimizationMedianCpir,
                          );
                          const adSetIncrementalityDetail = incrementalityDetails?.adsets?.[adset.id];
                          const adsForReview = adset.ads.filter((ad) => {
                            if (!missingTagReviewMode) {
                              return true;
                            }
                            return missingTagEntities.keys.has(`ad:${ad.id}`);
                          });
                          if (
                            missingTagReviewMode &&
                            !missingTagEntities.keys.has(`adset:${adset.id}`) &&
                            adsForReview.length === 0
                          ) {
                            return null;
                          }
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
                          <td>
                            {(
                              project?.optimizationMethod === 'first_click_present'
                                ? adset.metrics?.fcRoas
                                : adset.metrics?.iroas
                            )?.toFixed(2)}
                            x
                          </td>
                          <td>{formatMetricValue(adset.metrics?.cpir ?? 0, 'currency', report?.currency ?? 'INR')}</td>
                          <td>{(adset.metrics?.roas ?? 0).toFixed(2)}x</td>
                          <td>
                            <button
                              type="button"
                              className={`status-pill fatigue-${adSetIncrementality.tone} fatigue-badge-btn`}
                              onClick={() =>
                                setOpenIncrementalityKey((current) =>
                                  current === `adset:${adset.id}` ? null : `adset:${adset.id}`,
                                )
                              }
                            >
                              {adSetIncrementality.label}
                            </button>
                            {openIncrementalityKey === `adset:${adset.id}` && adSetIncrementalityDetail ? (
                              <div className="fatigue-popover">
                                <p><strong>CPIR Trend:</strong> {adSetIncrementalityDetail.cpirTrend} | slope {adSetIncrementalityDetail.cpirSlope?.toFixed(4) ?? '—'} | p {adSetIncrementalityDetail.cpirPValue?.toFixed(4) ?? '—'}</p>
                                <p><strong>CTR Trend:</strong> {adSetIncrementalityDetail.ctrTrend} | slope {adSetIncrementalityDetail.ctrSlope?.toFixed(4) ?? '—'} | p {adSetIncrementalityDetail.ctrPValue?.toFixed(4) ?? '—'}</p>
                                <p><strong>Spend Share:</strong> {adSetIncrementalityDetail.spendShare}</p>
                                <p><strong>Window:</strong> {incrementalityDetails?.window?.since ?? '—'} to {incrementalityDetails?.window?.until ?? '—'}</p>
                              </div>
                            ) : null}
                          </td>
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
                            <td colSpan={11}>
                              {renderTagPanel('adset', adset.id, {
                                campaignId: campaign.id,
                                adSetId: adset.id,
                              })}
                            </td>
                          </tr>
                        ) : null}
                        {adSetExpanded
                          ? adsForReview.map((ad) => (
                          <Fragment key={`opt-${ad.id}`}>
                            {(() => {
                              const adIncrementality = incrementalityBadgeFromCpir(
                                ad.metrics?.incrementalityStatus,
                                ad.metrics?.cpir ?? 0,
                                optimizationMedianCpir,
                              );
                              const adIncrementalityDetail = incrementalityDetails?.ads?.[ad.id];
                              return (
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
                              <td>
                                {(
                                  project?.optimizationMethod === 'first_click_present'
                                    ? ad.metrics?.fcRoas
                                    : ad.metrics?.iroas
                                )?.toFixed(2)}
                                x
                              </td>
                              <td>{formatMetricValue(ad.metrics?.cpir ?? 0, 'currency', report?.currency ?? 'INR')}</td>
                              <td>{(ad.metrics?.roas ?? 0).toFixed(2)}x</td>
                              <td>
                                <button
                                  type="button"
                                  className={`status-pill fatigue-${adIncrementality.tone} fatigue-badge-btn`}
                                  onClick={() =>
                                    setOpenIncrementalityKey((current) =>
                                      current === `ad:${ad.id}` ? null : `ad:${ad.id}`,
                                    )
                                  }
                                >
                                  {adIncrementality.label}
                                </button>
                                {openIncrementalityKey === `ad:${ad.id}` && adIncrementalityDetail ? (
                                  <div className="fatigue-popover">
                                    <p><strong>CPIR Trend:</strong> {adIncrementalityDetail.cpirTrend} | slope {adIncrementalityDetail.cpirSlope?.toFixed(4) ?? '—'} | p {adIncrementalityDetail.cpirPValue?.toFixed(4) ?? '—'}</p>
                                    <p><strong>CTR Trend:</strong> {adIncrementalityDetail.ctrTrend} | slope {adIncrementalityDetail.ctrSlope?.toFixed(4) ?? '—'} | p {adIncrementalityDetail.ctrPValue?.toFixed(4) ?? '—'}</p>
                                    <p><strong>Spend Share:</strong> {adIncrementalityDetail.spendShare}</p>
                                    <p><strong>Window:</strong> {incrementalityDetails?.window?.since ?? '—'} to {incrementalityDetails?.window?.until ?? '—'}</p>
                                  </div>
                                ) : null}
                              </td>
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
                              );
                            })()}
                            {openTagPanelKey === `ad-${ad.id}` ? (
                              <tr className="row-tag-panel">
                                <td colSpan={11}>
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
                  const fatigueFallback = fatigueBadgeFromCpir(
                    creative.metrics.cpir,
                    creativeScatterRows.medianCpir,
                    creative.metrics.roas,
                  );
                  const fatigueModel = creativeFatigue[creative.creativeId];
                  const fatigue = fatigueBadgeFromModel(fatigueModel) ?? fatigueFallback;
                  const format =
                    creative.format === 'video'
                      ? 'Video'
                      : creative.format === 'image'
                        ? 'Image'
                        : creative.format === 'carousel'
                          ? 'Carousel'
                          : 'Unknown';
                  const hookRate =
                    creative.metrics.impressions > 0
                      ? (creative.metrics.clicks / creative.metrics.impressions) * 100
                      : null;
                  const holdRate =
                    creative.metrics.clicks > 0
                      ? (creative.metrics.outboundClicks / creative.metrics.clicks) * 100
                      : null;
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
                        <td>{creative.format === 'video' ? `${(hookRate ?? 0).toFixed(2)}%` : 'N/A'}</td>
                        <td>
                          {creative.format === 'video'
                            ? (holdRate === null ? '—' : `${holdRate.toFixed(2)}%`)
                            : 'N/A'}
                        </td>
                        <td>{formatMetricValue(creative.metrics.cpir, 'currency', report?.currency ?? 'INR')}</td>
                        <td>
                          <button
                            type="button"
                            className={`status-pill fatigue-${fatigue.tone} fatigue-badge-btn`}
                            onClick={() =>
                              setOpenFatigueCreativeId((current) =>
                                current === creative.creativeId ? null : creative.creativeId,
                              )
                            }
                          >
                            {fatigue.label}
                          </button>
                          {openFatigueCreativeId === creative.creativeId && fatigueModel ? (
                            <div className="fatigue-popover">
                              <p><strong>Window:</strong> Last 7 days</p>
                              <p>
                                <strong>CPIR Trend:</strong> {fatigueModel.cpirTrend}
                                {' | '}slope {fatigueModel.cpirSlope?.toFixed(4) ?? '—'}
                                {' | '}p {fatigueModel.cpirPValue?.toFixed(4) ?? '—'}
                                {' | '}days {fatigueModel.cpirDays}
                              </p>
                              <p>
                                <strong>CTR Trend:</strong> {fatigueModel.ctrTrend}
                                {' | '}slope {fatigueModel.ctrSlope?.toFixed(4) ?? '—'}
                                {' | '}p {fatigueModel.ctrPValue?.toFixed(4) ?? '—'}
                                {' | '}days {fatigueModel.ctrDays}
                              </p>
                            </div>
                          ) : null}
                        </td>
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
            <p className="muted">
              Nested pivot by tag order with configurable metrics and sortable columns. Click Generate to run query.
            </p>
          </header>
          <div className="breakdown-controls">
            <label>
              Tag 1
              <select value={breakdownTag1} onChange={(event) => setBreakdownTag1(event.target.value)}>
                {tagCatalogOptions.map((category) => (
                  <option
                    key={`bd1-${category.key}`}
                    value={category.key}
                    disabled={isTagOptionDisabled(category.key, breakdownTag1)}
                  >
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tag 2
              <select value={breakdownTag2} onChange={(event) => setBreakdownTag2(event.target.value)}>
                <option value="">None</option>
                {tagCatalogOptions.map((category) => (
                  <option
                    key={`bd2-${category.key}`}
                    value={category.key}
                    disabled={isTagOptionDisabled(category.key, breakdownTag2)}
                  >
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
                  <option
                    key={`bd3-${category.key}`}
                    value={category.key}
                    disabled={isTagOptionDisabled(category.key, breakdownTag3)}
                  >
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
                  <option
                    key={`bd4-${category.key}`}
                    value={category.key}
                    disabled={isTagOptionDisabled(category.key, breakdownTag4)}
                  >
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="breakdown-metric-grid">
            <p className="muted">Metrics</p>
            <div className="breakdown-metric-options">
              {BREAKDOWN_METRIC_OPTIONS.map((metric) => (
                <label key={`metric-${metric.key}`} className="metric-toggle">
                  <input
                    type="checkbox"
                    checked={breakdownMetrics.includes(metric.key)}
                    onChange={() => toggleBreakdownMetric(metric.key)}
                  />
                  {metric.label}
                </label>
              ))}
            </div>
            <div className="target-actions">
              <button
                type="button"
                onClick={() => void generateCustomBreakdown()}
                disabled={isGeneratingBreakdown || selectedBreakdownTagKeys.length === 0}
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
                  {breakdownMetrics.map((metric) => (
                    <th key={`head-${metric}`}>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => toggleBreakdownSort(metric)}
                      >
                        {BREAKDOWN_METRIC_OPTIONS.find((item) => item.key === metric)?.label ?? metric}
                        {breakdownSort.key === metric ? (breakdownSort.direction === 'desc' ? ' ↓' : ' ↑') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customBreakdownDisplayRows.map((row) => (
                  <tr key={row.key} className={row.isTotal ? 'row-campaign' : ''}>
                    <td style={{ paddingLeft: `${10 + row.level * 18}px` }}>
                      {row.isTotal ? <strong>{row.label}</strong> : row.label}
                    </td>
                    {breakdownMetrics.map((metric) => {
                      const value = row[metric];
                      const format = BREAKDOWN_METRIC_OPTIONS.find((item) => item.key === metric)?.format ?? 'number';
                      return (
                        <td key={`${row.key}-${metric}`}>
                          {formatTrendMetricValue(
                            typeof value === 'number' ? value : null,
                            format,
                            report?.currency ?? 'INR',
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {customBreakdownDisplayRows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(2, breakdownMetrics.length + 1)} className="muted">
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

      {expandedTrendChart ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => {
            setExpandedTrendChartId(null);
          }}
        >
          <section
            className="modal-card trend-modal"
            role="dialog"
            aria-modal="true"
            aria-label={expandedTrendChart.title}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="modal-header">
              <div>
                <h2>{expandedTrendChart.title}</h2>
                <p className="muted">{expandedTrendChart.subtitle}</p>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className={`secondary-btn ${trendGranularity === 'daily' ? 'active-toggle' : ''}`}
                  onClick={() => setTrendGranularity('daily')}
                >
                  Daily
                </button>
                <button
                  type="button"
                  className={`secondary-btn ${trendGranularity === 'weekly' ? 'active-toggle' : ''}`}
                  onClick={() => setTrendGranularity('weekly')}
                  disabled={trendPointsWithTargets.length < 7}
                >
                  Weekly
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    setExpandedTrendChartId(null);
                  }}
                >
                  Close
                </button>
              </div>
            </header>
            <div className="modal-content">
              <SimpleLineChart
                points={trendPointsForCharts}
                lines={expandedTrendChart.lines}
                currency={report?.currency ?? 'INR'}
                interactive
              />
              {expandedTrendChart.unavailableReason ? (
                <p className="muted">{expandedTrendChart.unavailableReason}</p>
              ) : null}
              {trendGranularity === 'weekly' && trendPointsWithTargets.length < 7 ? (
                <p className="muted">Select at least 7 days to enable weekly view.</p>
              ) : null}
            </div>
          </section>
        </div>
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
