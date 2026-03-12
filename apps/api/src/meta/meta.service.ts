import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DateRangeQueryDto } from './dto/date-range.query.dto';
import { MetaAdAccountDto } from './dto/meta-ad-account.dto';
import {
  MetaAdSetNodeDto,
  MetaCampaignNodeDto,
  MetaEntityMetricsDto,
  MetaHierarchyResponseDto,
} from './dto/meta-hierarchy.dto';
import { MetaGraphClient } from './meta.client';
import { Pool } from 'pg';

interface GraphCampaign {
  id: string;
  name: string;
  status?: string;
  objective?: string;
  buying_type?: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

interface GraphAdSet {
  id: string;
  campaign_id?: string;
  name: string;
  status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

interface GraphAd {
  id: string;
  campaign_id?: string;
  adset_id?: string;
  name: string;
  status?: string;
  created_time?: string;
  creative?: {
    id: string;
    name?: string;
    title?: string;
    body?: string;
    image_url?: string;
    thumbnail_url?: string;
    effective_object_story_id?: string;
    object_type?: string;
  };
}

interface GraphAdInsight {
  date_start?: string;
  date_stop?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  cpp?: string;
  actions?: GraphMetricEntry[];
  action_values?: GraphMetricEntry[];
  outbound_clicks?: GraphMetricEntry[];
}

interface GraphMetricEntry {
  action_type?: string;
  value?: string;
  ['1d_click']?: string;
  ['7d_click']?: string;
  ['1d_view']?: string;
  ['7d_click_1d_view']?: string;
  ['28d_click_1d_view']?: string;
  incrementality?: string;
}

interface GraphCampaignPlacementInsight {
  date_start?: string;
  campaign_id?: string;
  spend?: string;
  publisher_platform?: string;
  platform_position?: string;
}

interface GraphCampaignAgeInsight {
  date_start?: string;
  campaign_id?: string;
  spend?: string;
  age?: string;
}

interface GraphAccountInsight {
  date_start?: string;
  date_stop?: string;
  spend?: string;
  account_currency?: string;
  cpp?: string;
  cpm?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  frequency?: string;
  actions?: GraphMetricEntry[];
  action_values?: GraphMetricEntry[];
  cost_per_action_type?: GraphMetricEntry[];
  outbound_clicks?: GraphMetricEntry[];
}

interface DailyInsightRow {
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  purchases: number;
  outboundClicks: number;
  revenue7dClick: number;
  revenue1dView: number;
  revenueIncremental: number;
  revenueFc: number;
  videoViews3s: number;
  thruPlays: number;
  postShares: number;
  postComments: number;
  postReactions: number;
  postSaves: number;
}

type SyncType = 'daily' | 'backfill';
type SyncStatus = 'running' | 'success' | 'failed';
type TrendLabel = 'rising' | 'falling' | 'flat' | 'insufficient';
type IncrementalityStatus =
  | 'achieving'
  | 'not_achieved'
  | 'losing'
  | 'insufficient';

interface IncrementalityEntityResult {
  status: IncrementalityStatus;
  cpirTrend: TrendLabel;
  cpirSlope: number | null;
  cpirPValue: number | null;
  ctrTrend: TrendLabel;
  ctrSlope: number | null;
  ctrPValue: number | null;
  spendShare: 'stable' | 'shifting' | 'unavailable';
}

interface IncrementalityResponse {
  window: { since: string; until: string } | null;
  campaigns: Record<string, IncrementalityEntityResult>;
  adsets: Record<string, IncrementalityEntityResult>;
  ads: Record<string, IncrementalityEntityResult>;
}

interface CreativeFatigueResult {
  status: 'healthy' | 'watch' | 'fatigued' | 'insufficient';
  cpirTrend: TrendLabel;
  cpirSlope: number | null;
  cpirPValue: number | null;
  cpirDays: number;
  ctrTrend: TrendLabel;
  ctrSlope: number | null;
  ctrPValue: number | null;
  ctrDays: number;
}

@Injectable()
export class MetaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetaService.name);
  private schedulerInterval: NodeJS.Timeout | null = null;
  private readonly schedulerEnabled =
    (process.env.META_SYNC_ENABLE_DAILY ?? 'false') === 'true';
  private readonly schedulerHourIst = Number.parseInt(
    process.env.META_SYNC_HOUR_IST ?? '4',
    10,
  );
  private lastSchedulerRunDate: string | null = null;
  private schedulerRunning = false;
  private readonly pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:54329/scalewithpulse',
  });

  constructor(private readonly metaClient: MetaGraphClient) {}

  async onModuleInit() {
    await this.initAnalyticsSchema();
    this.startDailyScheduler();
  }

  async onModuleDestroy() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    await this.pool.end();
  }

  async getAdAccounts(): Promise<{ data: MetaAdAccountDto[] }> {
    const result = await this.pool.query<{ account_id: string }>(
      `
        SELECT DISTINCT account_id
        FROM (
          SELECT account_id FROM daily_insights_account
          UNION
          SELECT account_id FROM campaign_cache
          UNION
          SELECT account_id FROM adset_cache
          UNION
          SELECT account_id FROM ad_cache
        ) account_sources
        ORDER BY account_id ASC
      `,
    );

    return {
      data: result.rows.map((row) => ({
        id: `act_${row.account_id}`,
        accountId: row.account_id,
        name: `Account ${row.account_id}`,
      })),
    };
  }

  async getHierarchy(
    rawAccountId: string,
    query: DateRangeQueryDto,
    options?: { projectId?: string; product?: string },
  ): Promise<MetaHierarchyResponseDto> {
    const accountId = this.normalizeAccountId(rawAccountId);
    const range = this.validateRange(query);
    const productAdIds = await this.resolveProductAdIds(accountId, options);
    const hierarchy = await this.readHierarchyFromDb(
      accountId,
      range,
      productAdIds,
    );
    const incrementality = await this.getIncrementality(rawAccountId, options);
    for (const campaign of hierarchy.campaigns) {
      campaign.metrics = {
        ...(campaign.metrics ?? this.emptyMetrics()),
        incrementalityStatus: incrementality.campaigns[campaign.id]?.status,
      };
      for (const adset of campaign.adsets) {
        adset.metrics = {
          ...(adset.metrics ?? this.emptyMetrics()),
          incrementalityStatus: incrementality.adsets[adset.id]?.status,
        };
        for (const ad of adset.ads) {
          ad.metrics = {
            ...(ad.metrics ?? this.emptyMetrics()),
            incrementalityStatus: incrementality.ads[ad.id]?.status,
          };
        }
      }
    }
    return hierarchy;
  }

  async getReport(
    rawAccountId: string,
    query: DateRangeQueryDto,
    options?: { projectId?: string; product?: string },
  ) {
    const accountId = this.normalizeAccountId(rawAccountId);
    const range = this.validateRange(query);
    if (!range) {
      throw new BadRequestException('Both since and until are required.');
    }

    const productAdIds = await this.resolveProductAdIds(accountId, options);
    const previousRange = this.getPreviousRange(range.since, range.until);
    const [dbCurrent, dbPrevious] = await Promise.all([
      productAdIds
        ? this.readAdDailyRows(
            accountId,
            range.since,
            range.until,
            productAdIds,
          )
        : this.readAccountDailyRows(accountId, range.since, range.until),
      productAdIds
        ? this.readAdDailyRows(
            accountId,
            previousRange.since,
            previousRange.until,
            productAdIds,
          )
        : this.readAccountDailyRows(
            accountId,
            previousRange.since,
            previousRange.until,
          ),
    ]);
    const currentAgg = this.aggregateAccountDailyRows(dbCurrent);
    const previousAgg = this.aggregateAccountDailyRows(dbPrevious);

    const currentSpend = currentAgg.spend;
    const previousSpend = previousAgg.spend;
    const currentRevenue7d = currentAgg.revenue7dClick;
    const previousRevenue7d = previousAgg.revenue7dClick;
    const currentRevenue1d = currentAgg.revenue1dView;
    const previousRevenue1d = previousAgg.revenue1dView;
    const currentRevenue = currentRevenue7d + currentRevenue1d;
    const previousRevenue = previousRevenue7d + previousRevenue1d;
    const currentOutboundClicks = currentAgg.outboundClicks;
    const previousOutboundClicks = previousAgg.outboundClicks;
    const currentPurchases = currentAgg.purchases;
    const previousPurchases = previousAgg.purchases;
    const currentImpressions = currentAgg.impressions;
    const previousImpressions = previousAgg.impressions;
    const currentReach = currentAgg.reach;
    const previousReach = previousAgg.reach;
    const currentVideoViews3s = currentAgg.videoViews3s;
    const previousVideoViews3s = previousAgg.videoViews3s;
    const currentThruPlays = currentAgg.thruPlays;
    const previousThruPlays = previousAgg.thruPlays;

    return {
      accountId,
      range,
      previousRange,
      currency: 'INR',
      summary: {
        spend: this.metric(currentSpend, previousSpend),
        purchaseValue: this.metric(currentRevenue, previousRevenue),
        outboundClicks: this.metric(
          currentOutboundClicks,
          previousOutboundClicks,
        ),
        costPerOutboundClick: this.metric(
          currentOutboundClicks > 0 ? currentSpend / currentOutboundClicks : 0,
          previousOutboundClicks > 0
            ? previousSpend / previousOutboundClicks
            : 0,
        ),
        purchases: this.metric(currentPurchases, previousPurchases),
        cpa: this.metric(
          currentPurchases > 0 ? currentSpend / currentPurchases : 0,
          previousPurchases > 0 ? previousSpend / previousPurchases : 0,
        ),
        cpir: this.metric(
          currentAgg.reach > 0
            ? (currentAgg.spend * 1000) / currentAgg.reach
            : 0,
          previousAgg.reach > 0
            ? (previousAgg.spend * 1000) / previousAgg.reach
            : 0,
        ),
        cpm: this.metric(
          currentAgg.impressions > 0
            ? (currentAgg.spend * 1000) / currentAgg.impressions
            : 0,
          previousAgg.impressions > 0
            ? (previousAgg.spend * 1000) / previousAgg.impressions
            : 0,
        ),
        frequency: this.metric(
          currentAgg.reach > 0 ? currentAgg.impressions / currentAgg.reach : 0,
          previousAgg.reach > 0
            ? previousAgg.impressions / previousAgg.reach
            : 0,
        ),
        impressions: this.metric(currentImpressions, previousImpressions),
        reach: this.metric(currentReach, previousReach),
        hookRate: this.metric(
          currentImpressions > 0
            ? (currentVideoViews3s / currentImpressions) * 100
            : 0,
          previousImpressions > 0
            ? (previousVideoViews3s / previousImpressions) * 100
            : 0,
        ),
        holdRate: this.metric(
          currentVideoViews3s > 0
            ? (currentThruPlays / currentVideoViews3s) * 100
            : 0,
          previousVideoViews3s > 0
            ? (previousThruPlays / previousVideoViews3s) * 100
            : 0,
        ),
        conversionRate: this.metric(
          currentOutboundClicks > 0
            ? (currentPurchases / currentOutboundClicks) * 100
            : 0,
          previousOutboundClicks > 0
            ? (previousPurchases / previousOutboundClicks) * 100
            : 0,
        ),
        roas: this.metric(
          currentSpend > 0 ? currentRevenue / currentSpend : 0,
          previousSpend > 0 ? previousRevenue / previousSpend : 0,
        ),
        roas7dClick: this.metric(
          currentSpend > 0 ? currentRevenue7d / currentSpend : 0,
          previousSpend > 0 ? previousRevenue7d / previousSpend : 0,
        ),
      },
    };
  }

  async getDailyTrends(
    rawAccountId: string,
    query: DateRangeQueryDto,
    options?: { projectId?: string; product?: string },
  ) {
    const accountId = this.normalizeAccountId(rawAccountId);
    const range = this.validateRange(query);
    if (!range) {
      throw new BadRequestException('Both since and until are required.');
    }

    const productAdIds = await this.resolveProductAdIds(accountId, options);
    const dbRows = productAdIds
      ? await this.readAdDailyRows(
          accountId,
          range.since,
          range.until,
          productAdIds,
        )
      : await this.readAccountDailyRows(accountId, range.since, range.until);
    const top3SpendShareByDate = await this.readTop3SpendShareByDate(
      accountId,
      range.since,
      range.until,
      productAdIds ?? null,
    );
    const creativeFormatSharesByDate = await this.readCreativeFormatSharesByDate(
      accountId,
      range.since,
      range.until,
      productAdIds ?? null,
    );
    const newCreativeSharesByDate = await this.readNewCreativeSharesByDate(
      accountId,
      range.since,
      range.until,
      productAdIds ?? null,
    );
    const placementTopShareByDate = await this.readTopPlacementShareByDate(
      accountId,
      range.since,
      range.until,
    );
    const ageTopShareByDate = await this.readTopAgeShareByDate(
      accountId,
      range.since,
      range.until,
    );

    return {
      accountId,
      range,
      points: dbRows.map((row) => {
        const spend = row.spend;
        const revenue7dClick = row.revenue7dClick;
        const revenue1dView = row.revenue1dView;
        const purchases = row.purchases;
        const outboundClicks = row.outboundClicks;
        const revenue = revenue7dClick + revenue1dView;
        const roas7dClick = spend > 0 ? revenue7dClick / spend : 0;
        const roasBlend = spend > 0 ? revenue / spend : 0;
        const cpir = row.reach > 0 ? (spend * 1000) / row.reach : 0;
        const cpa = purchases > 0 ? spend / purchases : 0;
        const cpcOutbound = outboundClicks > 0 ? spend / outboundClicks : 0;
        const impressions = row.impressions;
        const reach = row.reach;
        const cpm = impressions > 0 ? (spend * 1000) / impressions : 0;
        const frequency = reach > 0 ? impressions / reach : 0;
        const videoViews3s = row.videoViews3s;
        const thruPlays = row.thruPlays;
        const virality =
          impressions > 0
            ? ((row.postShares * 5 +
                row.postComments * 2 +
                row.postReactions +
                row.postSaves * 5) /
                (impressions / 1000))
            : 0;
        const formatShares = creativeFormatSharesByDate.get(row.date);
        const newCreativeShares = newCreativeSharesByDate.get(row.date);

        return {
          date: row.date,
          spend,
          purchases,
          revenue,
          revenue7dClick,
          revenue1dView,
          roas7dClick,
          roasBlend,
          cpir,
          cpa,
          cpcOutbound,
          cpm,
          frequency,
          impressions,
          reach,
          aov: purchases > 0 ? revenue / purchases : 0,
          conversionRate:
            outboundClicks > 0 ? (purchases / outboundClicks) * 100 : 0,
          hookRate:
            impressions > 0
              ? (videoViews3s / Math.max(impressions, 1)) * 100
              : 0,
          holdRate:
            videoViews3s > 0
              ? (thruPlays / Math.max(videoViews3s, 1)) * 100
              : 0,
          virality,
          top3SpendShare: top3SpendShareByDate.get(row.date) ?? null,
          videoSpendShare: formatShares?.video ?? null,
          staticSpendShare: formatShares?.image ?? null,
          placementTopShare: placementTopShareByDate.get(row.date) ?? null,
          ageTopShare: ageTopShareByDate.get(row.date) ?? null,
          newCreativeRate: newCreativeShares?.rate ?? null,
          newCreativeSpendShare: newCreativeShares?.share ?? null,
        };
      }),
    };
  }

  async getIncrementality(
    rawAccountId: string,
    options?: { projectId?: string; product?: string },
  ): Promise<IncrementalityResponse> {
    const accountId = this.normalizeAccountId(rawAccountId);
    const productAdIds = await this.resolveProductAdIds(accountId, options);
    if (productAdIds && productAdIds.length === 0) {
      return {
        window: null,
        campaigns: {},
        adsets: {},
        ads: {},
      };
    }

    const maxDateResult = await this.pool.query<{ max_date: string | null }>(
      `SELECT MAX(date) AS max_date FROM ad_insights_daily WHERE account_id = $1`,
      [accountId],
    );
    const maxDate = maxDateResult.rows[0]?.max_date;
    if (!maxDate) {
      return {
        window: null,
        campaigns: {},
        adsets: {},
        ads: {},
      };
    }

    const untilDate = new Date(`${maxDate}T00:00:00Z`);
    const sinceDate = new Date(untilDate);
    sinceDate.setUTCDate(sinceDate.getUTCDate() - 6);
    const since = sinceDate.toISOString().slice(0, 10);
    const until = untilDate.toISOString().slice(0, 10);

    const rowsResult = await this.pool.query<{
      date: string;
      campaign_id: string;
      adset_id: string;
      ad_id: string;
      spend: string;
      reach: string;
      impressions: string;
      clicks: string;
    }>(
      `
        SELECT
          date,
          campaign_id,
          adset_id,
          ad_id,
          spend,
          reach,
          impressions,
          clicks
        FROM ad_insights_daily
        WHERE account_id = $1
          AND date BETWEEN $2 AND $3
          AND ($4::text[] IS NULL OR ad_id = ANY($4::text[]))
      `,
      [accountId, since, until, productAdIds ?? null],
    );

    const dailyRows = rowsResult.rows.map((row) => ({
      date: row.date,
      campaignId: row.campaign_id,
      adSetId: row.adset_id,
      adId: row.ad_id,
      spend: this.toNumber(row.spend),
      reach: this.toNumber(row.reach),
      impressions: this.toNumber(row.impressions),
      clicks: this.toNumber(row.clicks),
    }));

    const campaignSpendShare = await this.computeCampaignSpendShareStability(
      accountId,
      since,
      until,
    );
    const adSetCampaignMap = await this.loadAdSetCampaignMap(accountId);
    const adCampaignMap = await this.loadAdCampaignMap(accountId);

    const campaigns = this.buildIncrementalityByLevel(
      dailyRows,
      'campaign',
      campaignSpendShare,
    );
    const adsets = this.buildIncrementalityByLevel(
      dailyRows,
      'adset',
      campaignSpendShare,
      adSetCampaignMap,
    );
    const ads = this.buildIncrementalityByLevel(
      dailyRows,
      'ad',
      campaignSpendShare,
      adCampaignMap,
    );

    return {
      window: { since, until },
      campaigns,
      adsets,
      ads,
    };
  }

  async getCreativeFatigue(
    rawAccountId: string,
    options?: { projectId?: string; product?: string },
  ) {
    const accountId = this.normalizeAccountId(rawAccountId);
    const productAdIds = await this.resolveProductAdIds(accountId, options);
    if (productAdIds && productAdIds.length === 0) {
      return {
        window: null,
        creatives: {} as Record<string, CreativeFatigueResult>,
      };
    }

    const maxDateResult = await this.pool.query<{ max_date: string | null }>(
      `
        SELECT MAX(ai.date) AS max_date
        FROM ad_insights_daily ai
        WHERE ai.account_id = $1
          AND ($2::text[] IS NULL OR ai.ad_id = ANY($2::text[]))
      `,
      [accountId, productAdIds ?? null],
    );
    const maxDate = maxDateResult.rows[0]?.max_date;
    if (!maxDate) {
      return {
        window: null,
        creatives: {} as Record<string, CreativeFatigueResult>,
      };
    }

    const untilDate = new Date(`${maxDate}T00:00:00Z`);
    const sinceDate = new Date(untilDate);
    sinceDate.setUTCDate(sinceDate.getUTCDate() - 6);
    const since = sinceDate.toISOString().slice(0, 10);
    const until = untilDate.toISOString().slice(0, 10);

    const rowsResult = await this.pool.query<{
      date: string;
      creative_id: string;
      spend: string;
      reach: string;
      impressions: string;
      clicks: string;
    }>(
      `
        SELECT
          ai.date,
          ac.creative_id,
          SUM(ai.spend) AS spend,
          SUM(ai.reach) AS reach,
          SUM(ai.impressions) AS impressions,
          SUM(ai.clicks) AS clicks
        FROM ad_insights_daily ai
        JOIN ad_cache ac
          ON ac.account_id = ai.account_id
         AND ac.ad_id = ai.ad_id
        WHERE ai.account_id = $1
          AND ai.date BETWEEN $2 AND $3
          AND ac.creative_id IS NOT NULL
          AND ($4::text[] IS NULL OR ai.ad_id = ANY($4::text[]))
        GROUP BY ai.date, ac.creative_id
      `,
      [accountId, since, until, productAdIds ?? null],
    );

    const grouped = new Map<
      string,
      Array<{
        date: string;
        spend: number;
        reach: number;
        impressions: number;
        clicks: number;
      }>
    >();
    for (const row of rowsResult.rows) {
      const current = grouped.get(row.creative_id) ?? [];
      current.push({
        date: row.date,
        spend: this.toNumber(row.spend),
        reach: this.toNumber(row.reach),
        impressions: this.toNumber(row.impressions),
        clicks: this.toNumber(row.clicks),
      });
      grouped.set(row.creative_id, current);
    }

    const creatives: Record<string, CreativeFatigueResult> = {};
    for (const [creativeId, series] of grouped) {
      const byDate = new Map<
        string,
        { spend: number; reach: number; impressions: number; clicks: number }
      >();
      for (const point of series) {
        const current = byDate.get(point.date) ?? {
          spend: 0,
          reach: 0,
          impressions: 0,
          clicks: 0,
        };
        byDate.set(point.date, {
          spend: current.spend + point.spend,
          reach: current.reach + point.reach,
          impressions: current.impressions + point.impressions,
          clicks: current.clicks + point.clicks,
        });
      }

      const sortedDates = [...byDate.keys()].sort((a, b) => a.localeCompare(b));
      const cpirX: number[] = [];
      const cpirY: number[] = [];
      const ctrX: number[] = [];
      const ctrY: number[] = [];
      for (let index = 0; index < sortedDates.length; index += 1) {
        const date = sortedDates[index];
        const point = byDate.get(date)!;
        if (point.spend > 0 && point.reach > 0) {
          cpirX.push(index + 1);
          cpirY.push((point.spend * 1000) / point.reach);
        }
        if (point.impressions > 0) {
          ctrX.push(index + 1);
          ctrY.push((point.clicks / point.impressions) * 100);
        }
      }

      const cpirTrend = this.evaluateTrend(cpirX, cpirY);
      const ctrTrend = this.evaluateTrend(ctrX, ctrY);
      let status: CreativeFatigueResult['status'] = 'insufficient';
      if (cpirTrend.trend === 'insufficient' || ctrTrend.trend === 'insufficient') {
        status = 'insufficient';
      } else if (cpirTrend.trend === 'rising' && ctrTrend.trend === 'falling') {
        status = 'fatigued';
      } else if (cpirTrend.trend === 'rising' || ctrTrend.trend === 'falling') {
        status = 'watch';
      } else {
        status = 'healthy';
      }

      creatives[creativeId] = {
        status,
        cpirTrend: cpirTrend.trend,
        cpirSlope: cpirTrend.slope,
        cpirPValue: cpirTrend.pValue,
        cpirDays: cpirX.length,
        ctrTrend: ctrTrend.trend,
        ctrSlope: ctrTrend.slope,
        ctrPValue: ctrTrend.pValue,
        ctrDays: ctrX.length,
      };
    }

    return {
      window: { since, until },
      creatives,
    };
  }

  async runDailySync(payload?: { accountIds?: string[]; changedBy?: string }) {
    const accountIds = await this.resolveSyncAccountIds(payload?.accountIds);
    if (!accountIds.length) {
      return {
        message: 'No project-linked ad accounts found for daily sync.',
        syncedAccounts: 0,
      };
    }

    const range = this.getYesterdayIstRange();
    const result = await this.syncAccounts({
      type: 'daily',
      accountIds,
      since: range.since,
      until: range.until,
      changedBy: payload?.changedBy ?? 'manual',
    });

    return {
      message: 'Daily sync completed.',
      ...result,
      ...range,
    };
  }

  async runBackfillSync(payload?: {
    accountIds?: string[];
    since?: string;
    until?: string;
    changedBy?: string;
  }) {
    const accountIds = await this.resolveSyncAccountIds(payload?.accountIds);
    if (!accountIds.length) {
      return {
        message: 'No project-linked ad accounts found for backfill.',
        syncedAccounts: 0,
      };
    }

    const range = this.resolveBackfillRange(payload?.since, payload?.until);
    const result = await this.syncAccounts({
      type: 'backfill',
      accountIds,
      since: range.since,
      until: range.until,
      changedBy: payload?.changedBy ?? 'manual',
    });

    return {
      message: 'Backfill sync completed.',
      ...result,
      ...range,
    };
  }

  async getSyncStatus(limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const result = await this.pool.query<{
      id: string;
      sync_type: SyncType;
      account_id: string;
      status: SyncStatus;
      since: string;
      until: string;
      changed_by: string;
      started_at: string;
      finished_at: string | null;
      rows_written: number;
      error_message: string | null;
    }>(
      `
        SELECT
          id,
          sync_type,
          account_id,
          status,
          since,
          until,
          changed_by,
          started_at,
          finished_at,
          rows_written,
          error_message
        FROM meta_sync_runs
        ORDER BY started_at DESC
        LIMIT $1
      `,
      [safeLimit],
    );

    return { data: result.rows };
  }

  private startDailyScheduler() {
    if (!this.schedulerEnabled) {
      return;
    }

    this.schedulerInterval = setInterval(
      () => {
        void this.tryRunScheduledDailySync();
      },
      5 * 60 * 1000,
    );
    void this.tryRunScheduledDailySync();
  }

  private async tryRunScheduledDailySync() {
    if (this.schedulerRunning) {
      return;
    }

    const now = new Date();
    const istNow = this.toIstDate(now);
    const dateKey = this.toDateKey(istNow);
    const hour = Number.parseInt(istNow.toISOString().slice(11, 13), 10);
    const minute = Number.parseInt(istNow.toISOString().slice(14, 16), 10);

    if (hour !== this.schedulerHourIst || minute > 15) {
      return;
    }
    if (this.lastSchedulerRunDate === dateKey) {
      return;
    }

    this.schedulerRunning = true;
    this.lastSchedulerRunDate = dateKey;
    try {
      await this.runDailySync({ changedBy: 'scheduler' });
      this.logger.log(`Daily sync completed for ${dateKey} (IST scheduler).`);
    } catch (error) {
      this.logger.error(
        `Daily sync failed for ${dateKey} (IST scheduler).`,
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.schedulerRunning = false;
    }
  }

  private toIstDate(value: Date) {
    return new Date(value.getTime() + 330 * 60 * 1000);
  }

  private toDateKey(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private getYesterdayIstRange() {
    const istNow = this.toIstDate(new Date());
    const end = new Date(istNow.getTime() - 86_400_000);
    const key = this.toDateKey(end);
    return { since: key, until: key };
  }

  private resolveBackfillRange(since?: string, until?: string) {
    if (since && !this.isIsoDate(since)) {
      throw new BadRequestException('since must be in YYYY-MM-DD format.');
    }
    if (until && !this.isIsoDate(until)) {
      throw new BadRequestException('until must be in YYYY-MM-DD format.');
    }

    if (since && until) {
      if (since > until) {
        throw new BadRequestException(
          'since must be less than or equal to until.',
        );
      }
      return { since, until };
    }

    const yesterday = this.getYesterdayIstRange().until;
    if (since && !until) {
      if (since > yesterday) {
        throw new BadRequestException('since cannot be in the future.');
      }
      return { since, until: yesterday };
    }
    if (!since && until) {
      const start = new Date(`${until}T00:00:00Z`);
      start.setUTCDate(start.getUTCDate() - 89);
      return { since: start.toISOString().slice(0, 10), until };
    }

    const start = new Date(`${yesterday}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 89);
    return {
      since: start.toISOString().slice(0, 10),
      until: yesterday,
    };
  }

  private async resolveSyncAccountIds(inputAccountIds?: string[]) {
    const accountIds =
      inputAccountIds && inputAccountIds.length > 0
        ? inputAccountIds.map((id) => this.normalizeAccountId(id))
        : await this.listProjectAccountIds();
    return [...new Set(accountIds)];
  }

  private async listProjectAccountIds() {
    const result = await this.pool.query<{ ad_account_id: string }>(
      `
        SELECT DISTINCT paa.ad_account_id
        FROM project_ad_accounts paa
        JOIN projects p ON p.id = paa.project_id
        WHERE paa.removed_at IS NULL
          AND p.status = 'active'
        ORDER BY ad_account_id ASC
      `,
    );
    return result.rows
      .map((row) => this.normalizeAccountId(row.ad_account_id))
      .filter((id) => /^\d+$/.test(id));
  }

  private async syncAccounts(payload: {
    type: SyncType;
    accountIds: string[];
    since: string;
    until: string;
    changedBy: string;
  }) {
    let success = 0;
    let failed = 0;
    let rowsWritten = 0;

    for (const accountId of payload.accountIds) {
      const runId = randomUUID();
      await this.markProjectAccountSyncState(accountId, payload.type, 'running');
      await this.createSyncRun({
        id: runId,
        type: payload.type,
        accountId,
        since: payload.since,
        until: payload.until,
        changedBy: payload.changedBy,
      });

      try {
        const written = await this.syncAccountRange(
          accountId,
          payload.since,
          payload.until,
        );
        rowsWritten += written;
        success += 1;
        await this.completeSyncRun(runId, 'success', written, null);
        await this.markProjectAccountSyncState(
          accountId,
          payload.type,
          'success',
        );
      } catch (error) {
        failed += 1;
        const message =
          error instanceof Error ? error.message : 'Unknown sync error.';
        await this.completeSyncRun(runId, 'failed', 0, message);
        await this.markProjectAccountSyncState(accountId, payload.type, 'failed');
      }
    }

    return {
      syncedAccounts: payload.accountIds.length,
      success,
      failed,
      rowsWritten,
    };
  }

  private async syncAccountRange(
    accountId: string,
    since: string,
    until: string,
  ) {
    const accountPath = `act_${accountId}`;
    let rowsWritten = 0;

    const accountDailyRows = await this.fetchAccountInsights(
      accountPath,
      since,
      until,
      true,
    );
    await this.persistAccountInsightsRows(accountId, accountDailyRows);
    rowsWritten += accountDailyRows.length;

    const [campaigns, adsets, ads] = await Promise.all([
      this.metaClient.getAllPages<GraphCampaign>(`${accountPath}/campaigns`, {
        fields:
          'id,name,status,objective,buying_type,daily_budget,lifetime_budget',
        limit: 100,
        effective_status: '["ACTIVE","PAUSED"]',
      }),
      this.metaClient.getAllPages<GraphAdSet>(`${accountPath}/adsets`, {
        fields: 'id,campaign_id,name,status,daily_budget,lifetime_budget',
        limit: 100,
        effective_status: '["ACTIVE","PAUSED"]',
      }),
      this.metaClient.getAllPages<GraphAd>(`${accountPath}/ads`, {
        fields:
          'id,campaign_id,adset_id,name,status,created_time,creative{id,name,title,body,image_url,thumbnail_url,effective_object_story_id,object_type}',
        limit: 100,
        effective_status: '["ACTIVE","PAUSED"]',
      }),
    ]);
    await this.persistHierarchyEntities(accountId, campaigns, adsets, ads);
    rowsWritten += campaigns.length + adsets.length + ads.length;

    const chunks = this.splitDateRange(since, until, 7);
    for (const chunk of chunks) {
      const [adRangeRows, adDailyRows, placementRows, ageRows] =
        await Promise.all([
          this.fetchAdInsights(accountPath, chunk.since, chunk.until),
          this.fetchAdInsightsDaily(accountPath, chunk.since, chunk.until),
          this.fetchCampaignPlacementInsights(
            accountPath,
            chunk.since,
            chunk.until,
          ),
          this.fetchCampaignAgeInsights(accountPath, chunk.since, chunk.until),
        ]);
      await this.persistAdRangeInsights(
        accountId,
        chunk.since,
        chunk.until,
        adRangeRows,
      );
      await this.persistAdDailyInsights(
        accountId,
        chunk.since,
        chunk.until,
        adDailyRows,
      );
      await this.persistCampaignPlacementBreakdowns(
        accountId,
        chunk.since,
        chunk.until,
        placementRows,
      );
      await this.persistCampaignAgeBreakdowns(
        accountId,
        chunk.since,
        chunk.until,
        ageRows,
      );
      rowsWritten += adRangeRows.length;
      rowsWritten += adDailyRows.length;
      rowsWritten += placementRows.length;
      rowsWritten += ageRows.length;
    }

    return rowsWritten;
  }

  private async markProjectAccountSyncState(
    accountId: string,
    type: SyncType,
    status: 'running' | 'success' | 'failed',
  ) {
    const now = new Date().toISOString();
    if (type === 'backfill') {
      await this.pool.query(
        `
          UPDATE project_ad_accounts
          SET backfill_status = $2,
              backfill_started_at = CASE
                WHEN $2 = 'in_progress' THEN COALESCE(backfill_started_at, $3::timestamptz)
                ELSE backfill_started_at
              END,
              backfill_completed_at = CASE
                WHEN $2 IN ('completed', 'failed') THEN $3::timestamptz
                ELSE backfill_completed_at
              END,
              last_sync_at = CASE
                WHEN $4::boolean THEN $3::timestamptz
                ELSE last_sync_at
              END,
              last_sync_status = CASE
                WHEN $4::boolean THEN $5
                ELSE last_sync_status
              END
          WHERE ad_account_id = $1
            AND removed_at IS NULL
        `,
        [
          accountId,
          status === 'running'
            ? 'in_progress'
            : status === 'success'
              ? 'completed'
              : 'failed',
          now,
          status !== 'running',
          status === 'success' ? 'success' : 'failed',
        ],
      );
      return;
    }

    if (status === 'running') {
      return;
    }

    await this.pool.query(
      `
        UPDATE project_ad_accounts
        SET last_sync_at = $2,
            last_sync_status = $3
        WHERE ad_account_id = $1
          AND removed_at IS NULL
      `,
      [accountId, now, status === 'success' ? 'success' : 'failed'],
    );
  }

  private splitDateRange(since: string, until: string, chunkDays: number) {
    const result: Array<{ since: string; until: string }> = [];
    let cursor = new Date(`${since}T00:00:00Z`);
    const end = new Date(`${until}T00:00:00Z`);

    while (cursor <= end) {
      const chunkStart = new Date(cursor);
      const chunkEnd = new Date(cursor);
      chunkEnd.setUTCDate(chunkEnd.getUTCDate() + chunkDays - 1);
      if (chunkEnd > end) {
        chunkEnd.setTime(end.getTime());
      }

      result.push({
        since: chunkStart.toISOString().slice(0, 10),
        until: chunkEnd.toISOString().slice(0, 10),
      });

      cursor = new Date(chunkEnd);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return result;
  }

  private async createSyncRun(payload: {
    id: string;
    type: SyncType;
    accountId: string;
    since: string;
    until: string;
    changedBy: string;
  }) {
    await this.pool.query(
      `
        INSERT INTO meta_sync_runs (
          id, sync_type, account_id, status, since, until, changed_by, started_at
        ) VALUES (
          $1, $2, $3, 'running', $4, $5, $6, NOW()
        )
      `,
      [
        payload.id,
        payload.type,
        payload.accountId,
        payload.since,
        payload.until,
        payload.changedBy,
      ],
    );
  }

  private async completeSyncRun(
    id: string,
    status: Exclude<SyncStatus, 'running'>,
    rowsWritten: number,
    errorMessage: string | null,
  ) {
    await this.pool.query(
      `
        UPDATE meta_sync_runs
        SET
          status = $2,
          rows_written = $3,
          error_message = $4,
          finished_at = NOW()
        WHERE id = $1
      `,
      [id, status, rowsWritten, errorMessage],
    );
  }

  private normalizeAccountId(rawAccountId: string): string {
    const accountId = rawAccountId.replace(/^act_/, '');

    if (!/^\d+$/.test(accountId)) {
      throw new BadRequestException('Ad account id must be numeric.');
    }

    return accountId;
  }

  private validateRange(query: DateRangeQueryDto):
    | {
        since: string;
        until: string;
      }
    | undefined {
    const { since, until } = query;

    if (!since && !until) {
      return undefined;
    }

    if (!since || !until) {
      throw new BadRequestException('Both since and until must be provided.');
    }

    if (!this.isIsoDate(since) || !this.isIsoDate(until)) {
      throw new BadRequestException('Date format must be YYYY-MM-DD.');
    }

    if (since > until) {
      throw new BadRequestException(
        'since must be less than or equal to until.',
      );
    }

    return { since, until };
  }

  private isIsoDate(date: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(date);
  }

  private metric(current: number, previous: number) {
    return { current, previous };
  }

  private toNumber(value?: string): number {
    if (!value) {
      return 0;
    }

    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private toNullableNumber(value?: string | null): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private getPreviousRange(since: string, until: string) {
    const sinceDate = new Date(`${since}T00:00:00Z`);
    const untilDate = new Date(`${until}T00:00:00Z`);
    const diffInDays = Math.max(
      0,
      Math.round((untilDate.getTime() - sinceDate.getTime()) / 86_400_000),
    );

    const previousUntil = new Date(sinceDate.getTime() - 86_400_000);
    const previousSince = new Date(
      previousUntil.getTime() - diffInDays * 86_400_000,
    );

    return {
      since: previousSince.toISOString().slice(0, 10),
      until: previousUntil.toISOString().slice(0, 10),
    };
  }

  private metricValueByActionType(
    values: GraphMetricEntry[] | undefined,
    actionType: string,
    key: keyof GraphMetricEntry = 'value',
  ): number {
    if (!values?.length) {
      return 0;
    }

    const exact = values.find((entry) => entry.action_type === actionType);
    const fallback =
      actionType === 'purchase'
        ? values.find((entry) => entry.action_type === 'omni_purchase')
        : undefined;
    const entry = exact ?? fallback;

    if (!entry) {
      return 0;
    }

    const value = entry[key];
    return typeof value === 'string' ? this.toNumber(value) : 0;
  }

  private getAttributedRevenue(
    insight: GraphAccountInsight | undefined,
    attributionWindow: '7d_click' | '1d_view',
  ): number {
    return this.metricValueByActionType(
      insight?.action_values,
      'omni_purchase',
      attributionWindow,
    );
  }

  private getPurchases(insight: GraphAccountInsight | undefined): number {
    return this.metricValueByActionType(insight?.actions, 'purchase', 'value');
  }

  private getOutboundClicks(insight: GraphAccountInsight | undefined): number {
    if (!insight?.outbound_clicks?.length) {
      return 0;
    }

    return insight.outbound_clicks.reduce((sum, entry) => {
      return sum + this.toNumber(entry.value);
    }, 0);
  }

  private getMetricActionValue(
    insight: GraphAccountInsight | undefined,
    actionTypes: string[],
  ): number {
    if (!insight?.actions?.length) {
      return 0;
    }

    return actionTypes.reduce((sum, actionType) => {
      return sum + this.metricValueByActionType(insight.actions, actionType);
    }, 0);
  }

  private buildAdMetricsMap(rows: GraphAdInsight[]) {
    const map = new Map<string, MetaEntityMetricsDto>();

    for (const row of rows) {
      if (!row.ad_id) {
        continue;
      }

      const current = map.get(row.ad_id) ?? this.emptyMetrics();
      const spend = current.spend + this.toNumber(row.spend);
      const impressions = current.impressions + this.toNumber(row.impressions);
      const reach = current.reach + this.toNumber(row.reach);
      const clicks = current.clicks + this.toNumber(row.clicks);
      const purchases =
        current.purchases +
        this.metricValueByActionType(row.actions, 'purchase', 'value');
      const revenue =
        current.revenue +
        this.getAttributedRevenueFromActionValues(row.action_values);
      const revenueIncremental =
        current.revenueIncremental +
        this.getIncrementalRevenueFromActionValues(row.action_values);
      const revenueFirstClick =
        current.revenueFirstClick +
        this.metricValueByActionType(
          row.action_values,
          'purchase_fc_facebook_event',
          'value',
        );
      const outboundClicks =
        current.outboundClicks + this.sumMetricEntries(row.outbound_clicks);

      const cpir = reach > 0 ? (spend * 1000) / reach : this.toNumber(row.cpp);
      const cpa = purchases > 0 ? spend / purchases : 0;
      const roas = spend > 0 ? revenue / spend : 0;

      map.set(row.ad_id, {
        spend,
        impressions,
        reach,
        clicks,
        purchases,
        revenue,
        revenueIncremental,
        revenueFirstClick,
        outboundClicks,
        cpir,
        cpa,
        roas,
        iroas: spend > 0 ? revenueIncremental / spend : 0,
        fcRoas: spend > 0 ? revenueFirstClick / spend : 0,
      });
    }

    return map;
  }

  private emptyMetrics(): MetaEntityMetricsDto {
    return {
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
    };
  }

  private aggregateMetrics(
    items: MetaEntityMetricsDto[],
  ): MetaEntityMetricsDto {
    const totals = items.reduce<MetaEntityMetricsDto>(
      (acc, item) => ({
        spend: acc.spend + item.spend,
        impressions: acc.impressions + item.impressions,
        reach: acc.reach + item.reach,
        clicks: acc.clicks + item.clicks,
        purchases: acc.purchases + item.purchases,
        revenue: acc.revenue + item.revenue,
        revenueIncremental: acc.revenueIncremental + item.revenueIncremental,
        revenueFirstClick: acc.revenueFirstClick + item.revenueFirstClick,
        outboundClicks: acc.outboundClicks + item.outboundClicks,
        cpir: 0,
        cpa: 0,
        roas: 0,
        iroas: 0,
        fcRoas: 0,
      }),
      this.emptyMetrics(),
    );

    return {
      ...totals,
      cpir: totals.reach > 0 ? (totals.spend * 1000) / totals.reach : 0,
      cpa: totals.purchases > 0 ? totals.spend / totals.purchases : 0,
      roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
      iroas: totals.spend > 0 ? totals.revenueIncremental / totals.spend : 0,
      fcRoas: totals.spend > 0 ? totals.revenueFirstClick / totals.spend : 0,
    };
  }

  private getAttributedRevenueFromActionValues(
    values: GraphMetricEntry[] | undefined,
  ): number {
    const omni =
      this.metricValueByActionType(values, 'omni_purchase', '7d_click') +
      this.metricValueByActionType(values, 'omni_purchase', '1d_view');
    if (omni > 0) {
      return omni;
    }

    return (
      this.metricValueByActionType(values, 'purchase', '7d_click') +
      this.metricValueByActionType(values, 'purchase', '1d_view')
    );
  }

  private getIncrementalRevenueFromActionValues(
    values: GraphMetricEntry[] | undefined,
  ): number {
    const omni = this.metricValueByActionType(
      values,
      'omni_purchase',
      'incrementality' as keyof GraphMetricEntry,
    );
    if (omni > 0) {
      return omni;
    }
    return this.metricValueByActionType(
      values,
      'purchase',
      'incrementality' as keyof GraphMetricEntry,
    );
  }

  private sumMetricEntries(values: GraphMetricEntry[] | undefined): number {
    if (!values?.length) {
      return 0;
    }

    return values.reduce((sum, entry) => sum + this.toNumber(entry.value), 0);
  }

  private async initAnalyticsSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS daily_insights_account (
        account_id TEXT NOT NULL,
        date TEXT NOT NULL,
        spend NUMERIC NOT NULL DEFAULT 0,
        impressions NUMERIC NOT NULL DEFAULT 0,
        reach NUMERIC NOT NULL DEFAULT 0,
        clicks NUMERIC NOT NULL DEFAULT 0,
        purchases NUMERIC NOT NULL DEFAULT 0,
        outbound_clicks NUMERIC NOT NULL DEFAULT 0,
        revenue_7d_click NUMERIC NOT NULL DEFAULT 0,
        revenue_1d_view NUMERIC NOT NULL DEFAULT 0,
        revenue_incremental NUMERIC NOT NULL DEFAULT 0,
        revenue_fc NUMERIC NOT NULL DEFAULT 0,
        video_views_3s NUMERIC NOT NULL DEFAULT 0,
        thruplays NUMERIC NOT NULL DEFAULT 0,
        post_shares NUMERIC NOT NULL DEFAULT 0,
        post_comments NUMERIC NOT NULL DEFAULT 0,
        post_reactions NUMERIC NOT NULL DEFAULT 0,
        post_saves NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, date)
      );

      ALTER TABLE daily_insights_account
        ADD COLUMN IF NOT EXISTS clicks NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS revenue_incremental NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS revenue_fc NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS post_shares NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS post_comments NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS post_reactions NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS post_saves NUMERIC NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS campaign_cache (
        account_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NULL,
        objective TEXT NULL,
        buying_type TEXT NULL,
        daily_budget NUMERIC NULL,
        lifetime_budget NUMERIC NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, campaign_id)
      );

      CREATE TABLE IF NOT EXISTS adset_cache (
        account_id TEXT NOT NULL,
        adset_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NULL,
        daily_budget NUMERIC NULL,
        lifetime_budget NUMERIC NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, adset_id)
      );

      ALTER TABLE campaign_cache
        ADD COLUMN IF NOT EXISTS buying_type TEXT NULL,
        ADD COLUMN IF NOT EXISTS daily_budget NUMERIC NULL,
        ADD COLUMN IF NOT EXISTS lifetime_budget NUMERIC NULL;

      ALTER TABLE adset_cache
        ADD COLUMN IF NOT EXISTS daily_budget NUMERIC NULL,
        ADD COLUMN IF NOT EXISTS lifetime_budget NUMERIC NULL;

      CREATE TABLE IF NOT EXISTS ad_cache (
        account_id TEXT NOT NULL,
        ad_id TEXT NOT NULL,
        adset_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NULL,
        creative_id TEXT NULL,
        creative_name TEXT NULL,
        creative_title TEXT NULL,
        creative_body TEXT NULL,
        creative_image_url TEXT NULL,
        creative_thumbnail_url TEXT NULL,
        creative_object_story_id TEXT NULL,
        creative_object_type TEXT NULL,
        created_time TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, ad_id)
      );

      ALTER TABLE ad_cache
        ADD COLUMN IF NOT EXISTS creative_object_type TEXT NULL,
        ADD COLUMN IF NOT EXISTS created_time TIMESTAMPTZ NULL;

      CREATE TABLE IF NOT EXISTS ad_insights_range (
        account_id TEXT NOT NULL,
        since TEXT NOT NULL,
        until TEXT NOT NULL,
        campaign_id TEXT NULL,
        adset_id TEXT NULL,
        ad_id TEXT NOT NULL,
        spend NUMERIC NOT NULL DEFAULT 0,
        impressions NUMERIC NOT NULL DEFAULT 0,
        reach NUMERIC NOT NULL DEFAULT 0,
        purchases NUMERIC NOT NULL DEFAULT 0,
        outbound_clicks NUMERIC NOT NULL DEFAULT 0,
        revenue_7d_click NUMERIC NOT NULL DEFAULT 0,
        revenue_1d_view NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, since, until, ad_id)
      );

      CREATE TABLE IF NOT EXISTS ad_insights_daily (
        account_id TEXT NOT NULL,
        date TEXT NOT NULL,
        campaign_id TEXT NULL,
        adset_id TEXT NULL,
        ad_id TEXT NOT NULL,
        spend NUMERIC NOT NULL DEFAULT 0,
        impressions NUMERIC NOT NULL DEFAULT 0,
        reach NUMERIC NOT NULL DEFAULT 0,
        clicks NUMERIC NOT NULL DEFAULT 0,
        purchases NUMERIC NOT NULL DEFAULT 0,
        outbound_clicks NUMERIC NOT NULL DEFAULT 0,
        revenue_7d_click NUMERIC NOT NULL DEFAULT 0,
        revenue_1d_view NUMERIC NOT NULL DEFAULT 0,
        revenue_incremental NUMERIC NOT NULL DEFAULT 0,
        revenue_fc NUMERIC NOT NULL DEFAULT 0,
        video_views_3s NUMERIC NOT NULL DEFAULT 0,
        thruplays NUMERIC NOT NULL DEFAULT 0,
        post_shares NUMERIC NOT NULL DEFAULT 0,
        post_comments NUMERIC NOT NULL DEFAULT 0,
        post_reactions NUMERIC NOT NULL DEFAULT 0,
        post_saves NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, date, ad_id)
      );

      ALTER TABLE ad_insights_daily
        ADD COLUMN IF NOT EXISTS clicks NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS revenue_incremental NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS revenue_fc NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS video_views_3s NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS thruplays NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS post_shares NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS post_comments NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS post_reactions NUMERIC NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS post_saves NUMERIC NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS campaign_breakdown_placement_daily (
        account_id TEXT NOT NULL,
        date TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        placement_key TEXT NOT NULL,
        spend NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, date, campaign_id, placement_key)
      );

      CREATE TABLE IF NOT EXISTS campaign_breakdown_age_daily (
        account_id TEXT NOT NULL,
        date TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        age TEXT NOT NULL,
        spend NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, date, campaign_id, age)
      );

      CREATE INDEX IF NOT EXISTS idx_ad_insights_daily_account_date
      ON ad_insights_daily (account_id, date, ad_id);

      CREATE TABLE IF NOT EXISTS meta_sync_runs (
        id TEXT PRIMARY KEY,
        sync_type TEXT NOT NULL,
        account_id TEXT NOT NULL,
        status TEXT NOT NULL,
        since TEXT NOT NULL,
        until TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ NULL,
        rows_written INTEGER NOT NULL DEFAULT 0,
        error_message TEXT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_meta_sync_runs_started_at
      ON meta_sync_runs (started_at DESC);
    `);
  }

  private async persistAccountInsightsRows(
    accountId: string,
    rows: GraphAccountInsight[],
  ) {
    for (const row of rows) {
      const date = row.date_start;
      if (!date) {
        continue;
      }

      await this.pool.query(
        `
          INSERT INTO daily_insights_account (
            account_id,
            date,
            spend,
            impressions,
            reach,
            clicks,
            purchases,
            outbound_clicks,
            revenue_7d_click,
            revenue_1d_view,
            revenue_incremental,
            revenue_fc,
            video_views_3s,
            thruplays,
            post_shares,
            post_comments,
            post_reactions,
            post_saves,
            updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW()
          )
          ON CONFLICT (account_id, date) DO UPDATE SET
            spend = EXCLUDED.spend,
            impressions = EXCLUDED.impressions,
            reach = EXCLUDED.reach,
            clicks = EXCLUDED.clicks,
            purchases = EXCLUDED.purchases,
            outbound_clicks = EXCLUDED.outbound_clicks,
            revenue_7d_click = EXCLUDED.revenue_7d_click,
            revenue_1d_view = EXCLUDED.revenue_1d_view,
            revenue_incremental = EXCLUDED.revenue_incremental,
            revenue_fc = EXCLUDED.revenue_fc,
            video_views_3s = EXCLUDED.video_views_3s,
            thruplays = EXCLUDED.thruplays,
            post_shares = EXCLUDED.post_shares,
            post_comments = EXCLUDED.post_comments,
            post_reactions = EXCLUDED.post_reactions,
            post_saves = EXCLUDED.post_saves,
            updated_at = NOW()
        `,
        [
          accountId,
          date,
          this.toNumber(row.spend),
          this.toNumber(row.impressions),
          this.toNumber(row.reach),
          this.toNumber(row.clicks),
          this.getPurchases(row),
          this.getOutboundClicks(row),
          this.getAttributedRevenue(row, '7d_click'),
          this.getAttributedRevenue(row, '1d_view'),
          this.metricValueByActionType(
            row.action_values,
            'omni_purchase',
            'incrementality',
          ) ||
            this.metricValueByActionType(
              row.action_values,
              'purchase',
              'incrementality',
            ),
          this.metricValueByActionType(
            row.action_values,
            'purchase_fc_facebook_event',
            'value',
          ),
          this.getMetricActionValue(row, [
            'video_view',
            'video_p3_watched_actions',
          ]),
          this.getMetricActionValue(row, [
            'video_thruplay_watched_actions',
            'thruplay',
          ]),
          this.metricValueByActionType(row.actions, 'post', 'value'),
          this.metricValueByActionType(row.actions, 'comment', 'value'),
          this.metricValueByActionType(row.actions, 'post_reaction', 'value'),
          this.metricValueByActionType(
            row.actions,
            'onsite_conversion.post_save',
            'value',
          ),
        ],
      );
    }
  }

  private async readAccountDailyRows(
    accountId: string,
    since: string,
    until: string,
  ): Promise<DailyInsightRow[]> {
    const result = await this.pool.query<{
      date: string;
      spend: string;
      impressions: string;
      reach: string;
      clicks: string;
      purchases: string;
      outbound_clicks: string;
      revenue_7d_click: string;
      revenue_1d_view: string;
      revenue_incremental: string;
      revenue_fc: string;
      video_views_3s: string;
      thruplays: string;
      post_shares: string;
      post_comments: string;
      post_reactions: string;
      post_saves: string;
    }>(
      `
        SELECT
          date,
          spend,
          impressions,
          reach,
          clicks,
          purchases,
          outbound_clicks,
          revenue_7d_click,
          revenue_1d_view,
          revenue_incremental,
          revenue_fc,
          video_views_3s,
          thruplays,
          post_shares,
          post_comments,
          post_reactions,
          post_saves
        FROM daily_insights_account
        WHERE account_id = $1
          AND date BETWEEN $2 AND $3
        ORDER BY date ASC
      `,
      [accountId, since, until],
    );

    return result.rows.map((row) => ({
      date: row.date,
      spend: this.toNumber(row.spend),
      impressions: this.toNumber(row.impressions),
      reach: this.toNumber(row.reach),
      clicks: this.toNumber(row.clicks),
      purchases: this.toNumber(row.purchases),
      outboundClicks: this.toNumber(row.outbound_clicks),
      revenue7dClick: this.toNumber(row.revenue_7d_click),
      revenue1dView: this.toNumber(row.revenue_1d_view),
      revenueIncremental: this.toNumber(row.revenue_incremental),
      revenueFc: this.toNumber(row.revenue_fc),
      videoViews3s: this.toNumber(row.video_views_3s),
      thruPlays: this.toNumber(row.thruplays),
      postShares: this.toNumber(row.post_shares),
      postComments: this.toNumber(row.post_comments),
      postReactions: this.toNumber(row.post_reactions),
      postSaves: this.toNumber(row.post_saves),
    }));
  }

  private async readAdDailyRows(
    accountId: string,
    since: string,
    until: string,
    adIds: string[],
  ): Promise<DailyInsightRow[]> {
    if (adIds.length === 0) {
      return [];
    }

    const result = await this.pool.query<{
      date: string;
      spend: string;
      impressions: string;
      reach: string;
      clicks: string;
      purchases: string;
      outbound_clicks: string;
      revenue_7d_click: string;
      revenue_1d_view: string;
      revenue_incremental: string;
      revenue_fc: string;
      video_views_3s: string;
      thruplays: string;
      post_shares: string;
      post_comments: string;
      post_reactions: string;
      post_saves: string;
    }>(
      `
        SELECT
          date,
          SUM(spend) AS spend,
          SUM(impressions) AS impressions,
          SUM(reach) AS reach,
          SUM(clicks) AS clicks,
          SUM(purchases) AS purchases,
          SUM(outbound_clicks) AS outbound_clicks,
          SUM(revenue_7d_click) AS revenue_7d_click,
          SUM(revenue_1d_view) AS revenue_1d_view,
          SUM(revenue_incremental) AS revenue_incremental,
          SUM(revenue_fc) AS revenue_fc,
          SUM(video_views_3s) AS video_views_3s,
          SUM(thruplays) AS thruplays,
          SUM(post_shares) AS post_shares,
          SUM(post_comments) AS post_comments,
          SUM(post_reactions) AS post_reactions,
          SUM(post_saves) AS post_saves
        FROM ad_insights_daily
        WHERE account_id = $1
          AND date BETWEEN $2 AND $3
          AND ad_id = ANY($4::text[])
        GROUP BY date
        ORDER BY date ASC
      `,
      [accountId, since, until, adIds],
    );

    return result.rows.map((row) => ({
      date: row.date,
      spend: this.toNumber(row.spend),
      impressions: this.toNumber(row.impressions),
      reach: this.toNumber(row.reach),
      clicks: this.toNumber(row.clicks),
      purchases: this.toNumber(row.purchases),
      outboundClicks: this.toNumber(row.outbound_clicks),
      revenue7dClick: this.toNumber(row.revenue_7d_click),
      revenue1dView: this.toNumber(row.revenue_1d_view),
      revenueIncremental: this.toNumber(row.revenue_incremental),
      revenueFc: this.toNumber(row.revenue_fc),
      videoViews3s: this.toNumber(row.video_views_3s),
      thruPlays: this.toNumber(row.thruplays),
      postShares: this.toNumber(row.post_shares),
      postComments: this.toNumber(row.post_comments),
      postReactions: this.toNumber(row.post_reactions),
      postSaves: this.toNumber(row.post_saves),
    }));
  }

  private aggregateAccountDailyRows(rows: DailyInsightRow[]) {
    return rows.reduce(
      (acc, row) => ({
        spend: acc.spend + row.spend,
        impressions: acc.impressions + row.impressions,
        reach: acc.reach + row.reach,
        clicks: acc.clicks + row.clicks,
        purchases: acc.purchases + row.purchases,
        outboundClicks: acc.outboundClicks + row.outboundClicks,
        revenue7dClick: acc.revenue7dClick + row.revenue7dClick,
        revenue1dView: acc.revenue1dView + row.revenue1dView,
        revenueIncremental: acc.revenueIncremental + row.revenueIncremental,
        revenueFc: acc.revenueFc + row.revenueFc,
        videoViews3s: acc.videoViews3s + row.videoViews3s,
        thruPlays: acc.thruPlays + row.thruPlays,
        postShares: acc.postShares + row.postShares,
        postComments: acc.postComments + row.postComments,
        postReactions: acc.postReactions + row.postReactions,
        postSaves: acc.postSaves + row.postSaves,
      }),
      {
        spend: 0,
        impressions: 0,
        reach: 0,
        clicks: 0,
        purchases: 0,
        outboundClicks: 0,
        revenue7dClick: 0,
        revenue1dView: 0,
        revenueIncremental: 0,
        revenueFc: 0,
        videoViews3s: 0,
        thruPlays: 0,
        postShares: 0,
        postComments: 0,
        postReactions: 0,
        postSaves: 0,
      },
    );
  }

  private async readTop3SpendShareByDate(
    accountId: string,
    since: string,
    until: string,
    adIds: string[] | null,
  ) {
    const result = await this.pool.query<{
      date: string;
      top3_spend_share: string;
    }>(
      `
        WITH per_ad AS (
          SELECT date, ad_id, SUM(spend) AS spend
          FROM ad_insights_daily
          WHERE account_id = $1
            AND date BETWEEN $2 AND $3
            AND ($4::text[] IS NULL OR ad_id = ANY($4::text[]))
          GROUP BY date, ad_id
        ),
        ranked AS (
          SELECT
            date,
            ad_id,
            spend,
            ROW_NUMBER() OVER (PARTITION BY date ORDER BY spend DESC, ad_id) AS rn
          FROM per_ad
        )
        SELECT
          r.date,
          CASE
            WHEN SUM(r.spend) > 0
              THEN (SUM(CASE WHEN r.rn <= 3 THEN r.spend ELSE 0 END) / SUM(r.spend)) * 100
            ELSE 0
          END AS top3_spend_share
        FROM ranked r
        GROUP BY r.date
        ORDER BY r.date ASC
      `,
      [accountId, since, until, adIds],
    );

    return new Map(result.rows.map((row) => [row.date, this.toNumber(row.top3_spend_share)]));
  }

  private async readCreativeFormatSharesByDate(
    accountId: string,
    since: string,
    until: string,
    adIds: string[] | null,
  ) {
    const result = await this.pool.query<{
      date: string;
      video_spend_share: string;
      image_spend_share: string;
    }>(
      `
        SELECT
          ai.date,
          CASE
            WHEN SUM(ai.spend) > 0
              THEN SUM(CASE WHEN UPPER(COALESCE(ac.creative_object_type, '')) = 'VIDEO' THEN ai.spend ELSE 0 END) / SUM(ai.spend) * 100
            ELSE 0
          END AS video_spend_share,
          CASE
            WHEN SUM(ai.spend) > 0
              THEN SUM(
                CASE
                  WHEN UPPER(COALESCE(ac.creative_object_type, '')) IN ('PHOTO', 'IMAGE')
                    THEN ai.spend
                  ELSE 0
                END
              ) / SUM(ai.spend) * 100
            ELSE 0
          END AS image_spend_share
        FROM ad_insights_daily ai
        LEFT JOIN ad_cache ac
          ON ac.account_id = ai.account_id
         AND ac.ad_id = ai.ad_id
        WHERE ai.account_id = $1
          AND ai.date BETWEEN $2 AND $3
          AND ($4::text[] IS NULL OR ai.ad_id = ANY($4::text[]))
        GROUP BY ai.date
        ORDER BY ai.date ASC
      `,
      [accountId, since, until, adIds],
    );

    return new Map(
      result.rows.map((row) => [
        row.date,
        {
          video: this.toNumber(row.video_spend_share),
          image: this.toNumber(row.image_spend_share),
        },
      ]),
    );
  }

  private async readNewCreativeSharesByDate(
    accountId: string,
    since: string,
    until: string,
    adIds: string[] | null,
  ) {
    const result = await this.pool.query<{
      date: string;
      new_creative_rate: string;
      new_creative_spend_share: string;
    }>(
      `
        WITH first_seen AS (
          SELECT
            ad_id,
            MIN(date) AS first_date
          FROM ad_insights_daily
          WHERE account_id = $1
            AND date BETWEEN $2 AND $3
            AND ($4::text[] IS NULL OR ad_id = ANY($4::text[]))
          GROUP BY ad_id
        ),
        per_day AS (
          SELECT
            ai.date,
            ai.ad_id,
            SUM(ai.spend) AS spend,
            MIN(fs.first_date) AS first_date
          FROM ad_insights_daily ai
          JOIN first_seen fs ON fs.ad_id = ai.ad_id
          WHERE ai.account_id = $1
            AND ai.date BETWEEN $2 AND $3
            AND ($4::text[] IS NULL OR ai.ad_id = ANY($4::text[]))
          GROUP BY ai.date, ai.ad_id
        )
        SELECT
          date,
          CASE
            WHEN COUNT(*) > 0
              THEN (COUNT(*) FILTER (WHERE first_date = date)::numeric / COUNT(*)::numeric) * 100
            ELSE 0
          END AS new_creative_rate,
          CASE
            WHEN SUM(spend) > 0
              THEN (SUM(spend) FILTER (WHERE first_date = date) / SUM(spend)) * 100
            ELSE 0
          END AS new_creative_spend_share
        FROM per_day
        GROUP BY date
        ORDER BY date ASC
      `,
      [accountId, since, until, adIds],
    );

    return new Map(
      result.rows.map((row) => [
        row.date,
        {
          rate: this.toNumber(row.new_creative_rate),
          share: this.toNumber(row.new_creative_spend_share),
        },
      ]),
    );
  }

  private async readTopPlacementShareByDate(
    accountId: string,
    since: string,
    until: string,
  ) {
    const result = await this.pool.query<{
      date: string;
      top_share: string;
    }>(
      `
        WITH per_placement AS (
          SELECT date, placement_key, SUM(spend) AS spend
          FROM campaign_breakdown_placement_daily
          WHERE account_id = $1
            AND date BETWEEN $2 AND $3
          GROUP BY date, placement_key
        ),
        totals AS (
          SELECT date, SUM(spend) AS total_spend
          FROM per_placement
          GROUP BY date
        ),
        ranked AS (
          SELECT
            p.date,
            p.spend,
            ROW_NUMBER() OVER (PARTITION BY p.date ORDER BY p.spend DESC, p.placement_key) AS rn
          FROM per_placement p
        )
        SELECT
          r.date,
          CASE
            WHEN t.total_spend > 0
              THEN (MAX(CASE WHEN r.rn = 1 THEN r.spend ELSE 0 END) / t.total_spend) * 100
            ELSE 0
          END AS top_share
        FROM ranked r
        JOIN totals t ON t.date = r.date
        GROUP BY r.date, t.total_spend
        ORDER BY r.date ASC
      `,
      [accountId, since, until],
    );

    return new Map(result.rows.map((row) => [row.date, this.toNumber(row.top_share)]));
  }

  private async readTopAgeShareByDate(
    accountId: string,
    since: string,
    until: string,
  ) {
    const result = await this.pool.query<{
      date: string;
      top_share: string;
    }>(
      `
        WITH per_age AS (
          SELECT date, age, SUM(spend) AS spend
          FROM campaign_breakdown_age_daily
          WHERE account_id = $1
            AND date BETWEEN $2 AND $3
          GROUP BY date, age
        ),
        totals AS (
          SELECT date, SUM(spend) AS total_spend
          FROM per_age
          GROUP BY date
        ),
        ranked AS (
          SELECT
            a.date,
            a.spend,
            ROW_NUMBER() OVER (PARTITION BY a.date ORDER BY a.spend DESC, a.age) AS rn
          FROM per_age a
        )
        SELECT
          r.date,
          CASE
            WHEN t.total_spend > 0
              THEN (MAX(CASE WHEN r.rn = 1 THEN r.spend ELSE 0 END) / t.total_spend) * 100
            ELSE 0
          END AS top_share
        FROM ranked r
        JOIN totals t ON t.date = r.date
        GROUP BY r.date, t.total_spend
        ORDER BY r.date ASC
      `,
      [accountId, since, until],
    );

    return new Map(result.rows.map((row) => [row.date, this.toNumber(row.top_share)]));
  }

  private async persistHierarchyEntities(
    accountId: string,
    campaigns: GraphCampaign[],
    adsets: GraphAdSet[],
    ads: GraphAd[],
  ) {
    for (const campaign of campaigns) {
      await this.pool.query(
        `
          INSERT INTO campaign_cache (
            account_id, campaign_id, name, status, objective, buying_type, daily_budget, lifetime_budget, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (account_id, campaign_id) DO UPDATE SET
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            objective = EXCLUDED.objective,
            buying_type = EXCLUDED.buying_type,
            daily_budget = EXCLUDED.daily_budget,
            lifetime_budget = EXCLUDED.lifetime_budget,
            updated_at = NOW()
        `,
        [
          accountId,
          campaign.id,
          campaign.name,
          campaign.status ?? null,
          campaign.objective ?? null,
          campaign.buying_type ?? null,
          this.toNullableNumber(campaign.daily_budget),
          this.toNullableNumber(campaign.lifetime_budget),
        ],
      );
    }

    for (const adset of adsets) {
      if (!adset.campaign_id) {
        continue;
      }
      await this.pool.query(
        `
          INSERT INTO adset_cache (
            account_id, adset_id, campaign_id, name, status, daily_budget, lifetime_budget, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (account_id, adset_id) DO UPDATE SET
            campaign_id = EXCLUDED.campaign_id,
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            daily_budget = EXCLUDED.daily_budget,
            lifetime_budget = EXCLUDED.lifetime_budget,
            updated_at = NOW()
        `,
        [
          accountId,
          adset.id,
          adset.campaign_id,
          adset.name,
          adset.status ?? null,
          this.toNullableNumber(adset.daily_budget),
          this.toNullableNumber(adset.lifetime_budget),
        ],
      );
    }

    for (const ad of ads) {
      if (!ad.campaign_id || !ad.adset_id) {
        continue;
      }
      await this.pool.query(
        `
          INSERT INTO ad_cache (
            account_id,
            ad_id,
            adset_id,
            campaign_id,
            name,
            status,
            creative_id,
            creative_name,
            creative_title,
            creative_body,
            creative_image_url,
            creative_thumbnail_url,
            creative_object_story_id,
            creative_object_type,
            created_time,
            updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()
          )
          ON CONFLICT (account_id, ad_id) DO UPDATE SET
            adset_id = EXCLUDED.adset_id,
            campaign_id = EXCLUDED.campaign_id,
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            creative_id = EXCLUDED.creative_id,
            creative_name = EXCLUDED.creative_name,
            creative_title = EXCLUDED.creative_title,
            creative_body = EXCLUDED.creative_body,
            creative_image_url = EXCLUDED.creative_image_url,
            creative_thumbnail_url = EXCLUDED.creative_thumbnail_url,
            creative_object_story_id = EXCLUDED.creative_object_story_id,
            creative_object_type = EXCLUDED.creative_object_type,
            created_time = EXCLUDED.created_time,
            updated_at = NOW()
        `,
        [
          accountId,
          ad.id,
          ad.adset_id,
          ad.campaign_id,
          ad.name,
          ad.status ?? null,
          ad.creative?.id ?? null,
          ad.creative?.name ?? null,
          ad.creative?.title ?? null,
          ad.creative?.body ?? null,
          ad.creative?.image_url ?? null,
          ad.creative?.thumbnail_url ?? null,
          ad.creative?.effective_object_story_id ?? null,
          ad.creative?.object_type ?? null,
          ad.created_time ?? null,
        ],
      );
    }
  }

  private async persistAdRangeInsights(
    accountId: string,
    since: string,
    until: string,
    rows: GraphAdInsight[],
  ) {
    await this.pool.query(
      `DELETE FROM ad_insights_range WHERE account_id = $1 AND since = $2 AND until = $3`,
      [accountId, since, until],
    );

    for (const row of rows) {
      if (!row.ad_id) {
        continue;
      }
      await this.pool.query(
        `
          INSERT INTO ad_insights_range (
            account_id,
            since,
            until,
            campaign_id,
            adset_id,
            ad_id,
            spend,
            impressions,
            reach,
            purchases,
            outbound_clicks,
            revenue_7d_click,
            revenue_1d_view,
            updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
          )
        `,
        [
          accountId,
          since,
          until,
          row.campaign_id ?? null,
          row.adset_id ?? null,
          row.ad_id,
          this.toNumber(row.spend),
          this.toNumber(row.impressions),
          this.toNumber(row.reach),
          this.metricValueByActionType(row.actions, 'purchase', 'value'),
          this.sumMetricEntries(row.outbound_clicks),
          this.metricValueByActionType(
            row.action_values,
            'omni_purchase',
            '7d_click',
          ) ||
            this.metricValueByActionType(
              row.action_values,
              'purchase',
              '7d_click',
            ),
          this.metricValueByActionType(
            row.action_values,
            'omni_purchase',
            '1d_view',
          ) ||
            this.metricValueByActionType(
              row.action_values,
              'purchase',
              '1d_view',
            ),
        ],
      );
    }
  }

  private async persistAdDailyInsights(
    accountId: string,
    since: string,
    until: string,
    rows: GraphAdInsight[],
  ) {
    await this.pool.query(
      `
        DELETE FROM ad_insights_daily
        WHERE account_id = $1
          AND date BETWEEN $2 AND $3
      `,
      [accountId, since, until],
    );

    for (const row of rows) {
      if (!row.ad_id || !row.date_start) {
        continue;
      }
      await this.pool.query(
        `
          INSERT INTO ad_insights_daily (
            account_id,
            date,
            campaign_id,
            adset_id,
            ad_id,
            spend,
            impressions,
            reach,
            clicks,
            purchases,
            outbound_clicks,
            revenue_7d_click,
            revenue_1d_view,
            revenue_incremental,
            revenue_fc,
            video_views_3s,
            thruplays,
            post_shares,
            post_comments,
            post_reactions,
            post_saves,
            updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW()
          )
          ON CONFLICT (account_id, date, ad_id) DO UPDATE SET
            campaign_id = EXCLUDED.campaign_id,
            adset_id = EXCLUDED.adset_id,
            spend = EXCLUDED.spend,
            impressions = EXCLUDED.impressions,
            reach = EXCLUDED.reach,
            clicks = EXCLUDED.clicks,
            purchases = EXCLUDED.purchases,
            outbound_clicks = EXCLUDED.outbound_clicks,
            revenue_7d_click = EXCLUDED.revenue_7d_click,
            revenue_1d_view = EXCLUDED.revenue_1d_view,
            revenue_incremental = EXCLUDED.revenue_incremental,
            revenue_fc = EXCLUDED.revenue_fc,
            video_views_3s = EXCLUDED.video_views_3s,
            thruplays = EXCLUDED.thruplays,
            post_shares = EXCLUDED.post_shares,
            post_comments = EXCLUDED.post_comments,
            post_reactions = EXCLUDED.post_reactions,
            post_saves = EXCLUDED.post_saves,
            updated_at = NOW()
        `,
        [
          accountId,
          row.date_start,
          row.campaign_id ?? null,
          row.adset_id ?? null,
          row.ad_id,
          this.toNumber(row.spend),
          this.toNumber(row.impressions),
          this.toNumber(row.reach),
          this.toNumber(row.clicks),
          this.metricValueByActionType(row.actions, 'purchase', 'value'),
          this.sumMetricEntries(row.outbound_clicks),
          this.metricValueByActionType(
            row.action_values,
            'omni_purchase',
            '7d_click',
          ) ||
            this.metricValueByActionType(
              row.action_values,
              'purchase',
              '7d_click',
            ),
          this.metricValueByActionType(
            row.action_values,
            'omni_purchase',
            '1d_view',
          ) ||
            this.metricValueByActionType(
              row.action_values,
              'purchase',
              '1d_view',
            ),
          this.metricValueByActionType(
            row.action_values,
            'omni_purchase',
            'incrementality',
          ) ||
            this.metricValueByActionType(
              row.action_values,
              'purchase',
              'incrementality',
            ),
          this.metricValueByActionType(
            row.action_values,
            'purchase_fc_facebook_event',
            'value',
          ),
          this.getMetricActionValue(row, ['video_play_actions', 'video_view']),
          this.getMetricActionValue(row, [
            'video_thruplay_watched_actions',
            'thruplay',
          ]),
          this.metricValueByActionType(row.actions, 'post', 'value'),
          this.metricValueByActionType(row.actions, 'comment', 'value'),
          this.metricValueByActionType(row.actions, 'post_reaction', 'value'),
          this.metricValueByActionType(
            row.actions,
            'onsite_conversion.post_save',
            'value',
          ),
        ],
      );
    }
  }

  private async persistCampaignPlacementBreakdowns(
    accountId: string,
    since: string,
    until: string,
    rows: GraphCampaignPlacementInsight[],
  ) {
    await this.pool.query(
      `
        DELETE FROM campaign_breakdown_placement_daily
        WHERE account_id = $1
          AND date BETWEEN $2 AND $3
      `,
      [accountId, since, until],
    );

    for (const row of rows) {
      if (!row.date_start || !row.campaign_id) {
        continue;
      }
      const placementKey = `${row.publisher_platform ?? 'unknown'}:${row.platform_position ?? 'unknown'}`;
      await this.pool.query(
        `
          INSERT INTO campaign_breakdown_placement_daily (
            account_id, date, campaign_id, placement_key, spend, updated_at
          ) VALUES ($1,$2,$3,$4,$5,NOW())
          ON CONFLICT (account_id, date, campaign_id, placement_key) DO UPDATE SET
            spend = EXCLUDED.spend,
            updated_at = NOW()
        `,
        [
          accountId,
          row.date_start,
          row.campaign_id,
          placementKey,
          this.toNumber(row.spend),
        ],
      );
    }
  }

  private async persistCampaignAgeBreakdowns(
    accountId: string,
    since: string,
    until: string,
    rows: GraphCampaignAgeInsight[],
  ) {
    await this.pool.query(
      `
        DELETE FROM campaign_breakdown_age_daily
        WHERE account_id = $1
          AND date BETWEEN $2 AND $3
      `,
      [accountId, since, until],
    );

    for (const row of rows) {
      if (!row.date_start || !row.campaign_id || !row.age) {
        continue;
      }
      await this.pool.query(
        `
          INSERT INTO campaign_breakdown_age_daily (
            account_id, date, campaign_id, age, spend, updated_at
          ) VALUES ($1,$2,$3,$4,$5,NOW())
          ON CONFLICT (account_id, date, campaign_id, age) DO UPDATE SET
            spend = EXCLUDED.spend,
            updated_at = NOW()
        `,
        [
          accountId,
          row.date_start,
          row.campaign_id,
          row.age,
          this.toNumber(row.spend),
        ],
      );
    }
  }

  private async readHierarchyFromDb(
    accountId: string,
    range:
      | {
          since: string;
          until: string;
        }
      | undefined,
    productAdIds?: string[] | null,
  ): Promise<MetaHierarchyResponseDto> {
    const campaignRows = await this.pool.query<{
      campaign_id: string;
      name: string;
      status: string | null;
      objective: string | null;
      buying_type: string | null;
      daily_budget: string | null;
      lifetime_budget: string | null;
    }>(
      `
        SELECT campaign_id, name, status, objective, buying_type, daily_budget, lifetime_budget
        FROM campaign_cache
        WHERE account_id = $1
        ORDER BY name ASC
      `,
      [accountId],
    );
    const adsetRows = await this.pool.query<{
      adset_id: string;
      campaign_id: string;
      name: string;
      status: string | null;
      daily_budget: string | null;
      lifetime_budget: string | null;
    }>(
      `
        SELECT adset_id, campaign_id, name, status, daily_budget, lifetime_budget
        FROM adset_cache
        WHERE account_id = $1
      `,
      [accountId],
    );
    const adRows = await this.pool.query<{
      ad_id: string;
      adset_id: string;
      campaign_id: string;
      name: string;
      status: string | null;
      creative_id: string | null;
      creative_name: string | null;
      creative_title: string | null;
      creative_body: string | null;
      creative_image_url: string | null;
      creative_thumbnail_url: string | null;
      creative_object_story_id: string | null;
      creative_object_type: string | null;
      created_time: string | null;
    }>(
      `
        SELECT
          ad_id,
          adset_id,
          campaign_id,
          name,
          status,
          creative_id,
          creative_name,
          creative_title,
          creative_body,
          creative_image_url,
          creative_thumbnail_url,
          creative_object_story_id,
          creative_object_type,
          created_time
        FROM ad_cache
        WHERE account_id = $1
      `,
      [accountId],
    );

    const adMetricsMap = new Map<string, MetaEntityMetricsDto>();
    const adIdFilter = productAdIds ? new Set(productAdIds) : null;
    if (range) {
      if (adIdFilter && adIdFilter.size === 0) {
        return {
          accountId,
          range,
          totals: { campaigns: 0, adsets: 0, ads: 0 },
          campaigns: [],
        };
      }
      const insightRows = await this.pool.query<{
        ad_id: string;
        spend: string;
        impressions: string;
        reach: string;
        clicks: string;
        purchases: string;
        outbound_clicks: string;
        revenue_7d_click: string;
        revenue_1d_view: string;
        revenue_incremental: string;
        revenue_fc: string;
      }>(
        `
          SELECT
            ad_id,
            SUM(spend) AS spend,
            SUM(impressions) AS impressions,
            SUM(reach) AS reach,
            SUM(clicks) AS clicks,
            SUM(purchases) AS purchases,
            SUM(outbound_clicks) AS outbound_clicks,
            SUM(revenue_7d_click) AS revenue_7d_click,
            SUM(revenue_1d_view) AS revenue_1d_view,
            SUM(revenue_incremental) AS revenue_incremental,
            SUM(revenue_fc) AS revenue_fc
          FROM ad_insights_daily
          WHERE account_id = $1
            AND date BETWEEN $2 AND $3
            AND ($4::text[] IS NULL OR ad_id = ANY($4::text[]))
          GROUP BY ad_id
        `,
        [accountId, range.since, range.until, productAdIds ?? null],
      );

      for (const row of insightRows.rows) {
        const spend = this.toNumber(row.spend);
        const reach = this.toNumber(row.reach);
        const purchases = this.toNumber(row.purchases);
        const revenue =
          this.toNumber(row.revenue_7d_click) +
          this.toNumber(row.revenue_1d_view);
        const revenueIncremental = this.toNumber(row.revenue_incremental);
        const revenueFirstClick = this.toNumber(row.revenue_fc);
        adMetricsMap.set(row.ad_id, {
          spend,
          impressions: this.toNumber(row.impressions),
          reach,
          clicks: this.toNumber(row.clicks),
          purchases,
          revenue,
          revenueIncremental,
          revenueFirstClick,
          outboundClicks: this.toNumber(row.outbound_clicks),
          cpir: reach > 0 ? (spend * 1000) / reach : 0,
          cpa: purchases > 0 ? spend / purchases : 0,
          roas: spend > 0 ? revenue / spend : 0,
          iroas: spend > 0 ? revenueIncremental / spend : 0,
          fcRoas: spend > 0 ? revenueFirstClick / spend : 0,
        });
      }
    }

    const campaignMap = new Map<string, MetaCampaignNodeDto>();
    for (const campaign of campaignRows.rows) {
      campaignMap.set(campaign.campaign_id, {
        id: campaign.campaign_id,
        name: campaign.name,
        status: campaign.status ?? undefined,
        objective: campaign.objective ?? undefined,
        buyingType: campaign.buying_type ?? undefined,
        dailyBudget: this.toNullableNumber(campaign.daily_budget) ?? undefined,
        lifetimeBudget:
          this.toNullableNumber(campaign.lifetime_budget) ?? undefined,
        metrics: this.emptyMetrics(),
        adsets: [],
      });
    }

    const adsetMap = new Map<string, MetaAdSetNodeDto>();
    for (const adset of adsetRows.rows) {
      const parent = campaignMap.get(adset.campaign_id);
      if (!parent) {
        continue;
      }
      const node: MetaAdSetNodeDto = {
        id: adset.adset_id,
        name: adset.name,
        status: adset.status ?? undefined,
        dailyBudget: this.toNullableNumber(adset.daily_budget) ?? undefined,
        lifetimeBudget:
          this.toNullableNumber(adset.lifetime_budget) ?? undefined,
        metrics: this.emptyMetrics(),
        ads: [],
      };
      adsetMap.set(adset.adset_id, node);
      parent.adsets.push(node);
    }

    for (const ad of adRows.rows) {
      if (adIdFilter && !adIdFilter.has(ad.ad_id)) {
        continue;
      }
      const parent = adsetMap.get(ad.adset_id);
      if (!parent) {
        continue;
      }
      const metrics = adMetricsMap.get(ad.ad_id) ?? this.emptyMetrics();
      if (range && !adMetricsMap.has(ad.ad_id)) {
        continue;
      }
      parent.ads.push({
        id: ad.ad_id,
        name: ad.name,
        status: ad.status ?? undefined,
        metrics,
        creative: ad.creative_id
          ? {
              id: ad.creative_id,
              name: ad.creative_name ?? undefined,
              title: ad.creative_title ?? undefined,
              body: ad.creative_body ?? undefined,
              imageUrl: ad.creative_image_url ?? undefined,
              thumbnailUrl: ad.creative_thumbnail_url ?? undefined,
              objectStoryId: ad.creative_object_story_id ?? undefined,
              objectType: ad.creative_object_type ?? undefined,
              createdTime: ad.created_time ?? undefined,
            }
          : undefined,
      });
    }

    const campaigns = [...campaignMap.values()]
      .map((campaign) => ({
        ...campaign,
        adsets: campaign.adsets.filter(
          (adset) => adset.ads.length > 0 || !range,
        ),
      }))
      .filter((campaign) => campaign.adsets.length > 0 || !range);

    for (const campaign of campaigns) {
      for (const adset of campaign.adsets) {
        adset.metrics = this.aggregateMetrics(
          adset.ads.map((ad) => ad.metrics ?? this.emptyMetrics()),
        );
      }
      campaign.metrics = this.aggregateMetrics(
        campaign.adsets.map((adset) => adset.metrics ?? this.emptyMetrics()),
      );
    }

    return {
      accountId,
      range,
      totals: {
        campaigns: campaigns.length,
        adsets: campaigns.reduce(
          (sum, campaign) => sum + campaign.adsets.length,
          0,
        ),
        ads: campaigns.reduce(
          (sum, campaign) =>
            sum + campaign.adsets.reduce((s, adset) => s + adset.ads.length, 0),
          0,
        ),
      },
      campaigns,
    };
  }

  private async loadAdSetCampaignMap(accountId: string) {
    const result = await this.pool.query<{
      adset_id: string;
      campaign_id: string;
    }>(
      `
        SELECT adset_id, campaign_id
        FROM adset_cache
        WHERE account_id = $1
      `,
      [accountId],
    );
    const map = new Map<string, string>();
    for (const row of result.rows) {
      map.set(row.adset_id, row.campaign_id);
    }
    return map;
  }

  private async loadAdCampaignMap(accountId: string) {
    const result = await this.pool.query<{
      ad_id: string;
      campaign_id: string;
    }>(
      `
        SELECT ad_id, campaign_id
        FROM ad_cache
        WHERE account_id = $1
      `,
      [accountId],
    );
    const map = new Map<string, string>();
    for (const row of result.rows) {
      map.set(row.ad_id, row.campaign_id);
    }
    return map;
  }

  private async computeCampaignSpendShareStability(
    accountId: string,
    since: string,
    until: string,
  ) {
    const [placementResult, ageResult] = await Promise.all([
      this.pool.query<{
        campaign_id: string;
        date: string;
        placement_key: string;
        spend: string;
      }>(
        `
          SELECT campaign_id, date, placement_key, spend
          FROM campaign_breakdown_placement_daily
          WHERE account_id = $1
            AND date BETWEEN $2 AND $3
        `,
        [accountId, since, until],
      ),
      this.pool.query<{
        campaign_id: string;
        date: string;
        age: string;
        spend: string;
      }>(
        `
          SELECT campaign_id, date, age, spend
          FROM campaign_breakdown_age_daily
          WHERE account_id = $1
            AND date BETWEEN $2 AND $3
        `,
        [accountId, since, until],
      ),
    ]);

    const perCampaign = new Map<
      string,
      {
        placement: Map<string, Map<string, number>>;
        age: Map<string, Map<string, number>>;
      }
    >();

    const getCampaignStore = (campaignId: string) => {
      const current = perCampaign.get(campaignId);
      if (current) {
        return current;
      }
      const created = {
        placement: new Map<string, Map<string, number>>(),
        age: new Map<string, Map<string, number>>(),
      };
      perCampaign.set(campaignId, created);
      return created;
    };

    for (const row of placementResult.rows) {
      const store = getCampaignStore(row.campaign_id);
      const byPlacement =
        store.placement.get(row.placement_key) ?? new Map<string, number>();
      byPlacement.set(row.date, this.toNumber(row.spend));
      store.placement.set(row.placement_key, byPlacement);
    }

    for (const row of ageResult.rows) {
      const store = getCampaignStore(row.campaign_id);
      const byAge = store.age.get(row.age) ?? new Map<string, number>();
      byAge.set(row.date, this.toNumber(row.spend));
      store.age.set(row.age, byAge);
    }

    const output = new Map<
      string,
      { stable: boolean | null; reason: 'stable' | 'shifting' | 'unavailable' }
    >();

    for (const [campaignId, store] of perCampaign) {
      const placementStability = this.evaluateSpendShareShift(store.placement);
      const ageStability = this.evaluateSpendShareShift(store.age);
      if (placementStability === null || ageStability === null) {
        output.set(campaignId, { stable: null, reason: 'unavailable' });
        continue;
      }
      const stable = placementStability && ageStability;
      output.set(campaignId, {
        stable,
        reason: stable ? 'stable' : 'shifting',
      });
    }

    return output;
  }

  private evaluateSpendShareShift(
    dimensionMap: Map<string, Map<string, number>>,
  ): boolean | null {
    if (dimensionMap.size === 0) {
      return null;
    }

    const allDates = new Set<string>();
    for (const byDate of dimensionMap.values()) {
      for (const date of byDate.keys()) {
        allDates.add(date);
      }
    }
    const sortedDates = [...allDates].sort((a, b) => a.localeCompare(b));
    if (sortedDates.length < 5) {
      return null;
    }

    const totalByDate = new Map<string, number>();
    for (const date of sortedDates) {
      let total = 0;
      for (const byDate of dimensionMap.values()) {
        total += byDate.get(date) ?? 0;
      }
      totalByDate.set(date, total);
    }

    for (const byDate of dimensionMap.values()) {
      const x: number[] = [];
      const y: number[] = [];
      for (let index = 0; index < sortedDates.length; index += 1) {
        const date = sortedDates[index];
        const total = totalByDate.get(date) ?? 0;
        if (total <= 0) {
          continue;
        }
        const share = ((byDate.get(date) ?? 0) / total) * 100;
        x.push(index + 1);
        y.push(share);
      }
      if (x.length < 5) {
        continue;
      }
      const trend = this.evaluateTrend(x, y);
      if (trend.pValue !== null && trend.pValue < 0.05) {
        return false;
      }
    }
    return true;
  }

  private buildIncrementalityByLevel(
    rows: Array<{
      date: string;
      campaignId: string;
      adSetId: string;
      adId: string;
      spend: number;
      reach: number;
      impressions: number;
      clicks: number;
    }>,
    level: 'campaign' | 'adset' | 'ad',
    campaignSpendShare: Map<
      string,
      { stable: boolean | null; reason: 'stable' | 'shifting' | 'unavailable' }
    >,
    levelToCampaign?: Map<string, string>,
  ): Record<string, IncrementalityEntityResult> {
    const grouped = new Map<
      string,
      Array<{
        date: string;
        spend: number;
        reach: number;
        impressions: number;
        clicks: number;
      }>
    >();
    for (const row of rows) {
      const key =
        level === 'campaign'
          ? row.campaignId
          : level === 'adset'
            ? row.adSetId
            : row.adId;
      if (!key) {
        continue;
      }
      const current = grouped.get(key) ?? [];
      current.push({
        date: row.date,
        spend: row.spend,
        reach: row.reach,
        impressions: row.impressions,
        clicks: row.clicks,
      });
      grouped.set(key, current);
    }

    const output: Record<string, IncrementalityEntityResult> = {};

    for (const [entityId, series] of grouped) {
      const byDate = new Map<
        string,
        { spend: number; reach: number; impressions: number; clicks: number }
      >();
      for (const point of series) {
        const current = byDate.get(point.date) ?? {
          spend: 0,
          reach: 0,
          impressions: 0,
          clicks: 0,
        };
        byDate.set(point.date, {
          spend: current.spend + point.spend,
          reach: current.reach + point.reach,
          impressions: current.impressions + point.impressions,
          clicks: current.clicks + point.clicks,
        });
      }

      const sortedDates = [...byDate.keys()].sort((a, b) => a.localeCompare(b));
      const cpirX: number[] = [];
      const cpirY: number[] = [];
      const ctrX: number[] = [];
      const ctrY: number[] = [];
      for (let index = 0; index < sortedDates.length; index += 1) {
        const date = sortedDates[index];
        const point = byDate.get(date)!;
        if (point.spend > 0 && point.reach > 0) {
          cpirX.push(index + 1);
          cpirY.push((point.spend * 1000) / point.reach);
        }
        if (point.spend > 0 && point.impressions > 0) {
          ctrX.push(index + 1);
          ctrY.push((point.clicks / point.impressions) * 100);
        }
      }

      const cpirTrend = this.evaluateTrend(cpirX, cpirY);
      const ctrTrend = this.evaluateTrend(ctrX, ctrY);
      const campaignId =
        level === 'campaign'
          ? entityId
          : (levelToCampaign?.get(entityId) ?? '');
      const campaignShare = campaignSpendShare.get(campaignId);
      const spendShare: 'stable' | 'shifting' | 'unavailable' =
        campaignShare?.reason ?? 'unavailable';

      let status: IncrementalityStatus = 'insufficient';
      if (cpirTrend.trend === 'insufficient') {
        status = 'insufficient';
      } else if (cpirTrend.trend === 'rising') {
        status = 'losing';
      } else if (cpirTrend.trend === 'falling' && spendShare === 'stable') {
        status = 'achieving';
      } else {
        status = 'not_achieved';
      }

      output[entityId] = {
        status,
        cpirTrend: cpirTrend.trend,
        cpirSlope: cpirTrend.slope,
        cpirPValue: cpirTrend.pValue,
        ctrTrend: ctrTrend.trend,
        ctrSlope: ctrTrend.slope,
        ctrPValue: ctrTrend.pValue,
        spendShare,
      };
    }

    return output;
  }

  private evaluateTrend(x: number[], y: number[]) {
    if (x.length < 5 || y.length < 5 || x.length !== y.length) {
      return {
        trend: 'insufficient' as TrendLabel,
        slope: null as number | null,
        pValue: null as number | null,
      };
    }

    const n = x.length;
    const xMean = x.reduce((sum, value) => sum + value, 0) / n;
    const yMean = y.reduce((sum, value) => sum + value, 0) / n;
    let ssxx = 0;
    let ssxy = 0;
    for (let i = 0; i < n; i += 1) {
      const dx = x[i] - xMean;
      ssxx += dx * dx;
      ssxy += dx * (y[i] - yMean);
    }
    if (ssxx <= 0) {
      return {
        trend: 'insufficient' as TrendLabel,
        slope: null,
        pValue: null,
      };
    }
    const slope = ssxy / ssxx;
    const intercept = yMean - slope * xMean;
    let sse = 0;
    for (let i = 0; i < n; i += 1) {
      const predicted = intercept + slope * x[i];
      const residual = y[i] - predicted;
      sse += residual * residual;
    }
    if (n <= 2) {
      return { trend: 'insufficient' as TrendLabel, slope, pValue: null };
    }
    const seSlope = Math.sqrt(sse / (n - 2) / ssxx);
    if (!Number.isFinite(seSlope) || seSlope <= 0) {
      return { trend: 'flat' as TrendLabel, slope, pValue: 1 };
    }
    const tStat = slope / seSlope;
    const pValue = 2 * (1 - this.normalCdf(Math.abs(tStat)));
    const trend: TrendLabel =
      pValue < 0.05 ? (slope > 0 ? 'rising' : 'falling') : 'flat';
    return { trend, slope, pValue };
  }

  private normalCdf(x: number) {
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  private erf(x: number) {
    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * absX);
    const y =
      1 -
      ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
        t *
        Math.exp(-absX * absX);
    return sign * y;
  }

  private async resolveProductAdIds(
    accountId: string,
    options?: { projectId?: string; product?: string },
  ): Promise<string[] | null> {
    const product = options?.product?.trim();
    if (!product) {
      return null;
    }
    if (!options?.projectId) {
      throw new BadRequestException(
        'projectId is required when product filter is applied.',
      );
    }

    const result = await this.pool.query<{ ad_id: string }>(
      `
        SELECT ac.ad_id
        FROM ad_cache ac
        LEFT JOIN project_entity_tags ad_tag
          ON ad_tag.project_id = $1
         AND ad_tag.account_id = $2
         AND ad_tag.entity_type = 'ad'
         AND ad_tag.entity_id = ac.ad_id
         AND ad_tag.category_key = 'product'
        LEFT JOIN project_entity_tags adset_tag
          ON adset_tag.project_id = $1
         AND adset_tag.account_id = $2
         AND adset_tag.entity_type = 'adset'
         AND adset_tag.entity_id = ac.adset_id
         AND adset_tag.category_key = 'product'
        LEFT JOIN project_entity_tags campaign_tag
          ON campaign_tag.project_id = $1
         AND campaign_tag.account_id = $2
         AND campaign_tag.entity_type = 'campaign'
         AND campaign_tag.entity_id = ac.campaign_id
         AND campaign_tag.category_key = 'product'
        WHERE ac.account_id = $2
          AND COALESCE(
            NULLIF(ad_tag.value, ''),
            NULLIF(adset_tag.value, ''),
            NULLIF(campaign_tag.value, '')
          ) = $3
      `,
      [options.projectId, accountId, product],
    );

    return result.rows.map((row) => row.ad_id);
  }

  private fetchAccountInsights(
    accountPath: string,
    since: string,
    until: string,
    byDay = false,
  ) {
    return this.metaClient.getAllPages<GraphAccountInsight>(
      `${accountPath}/insights`,
      {
        level: 'account',
        fields:
          'date_start,date_stop,account_currency,spend,cpp,cpm,impressions,reach,clicks,frequency,actions,action_values,cost_per_action_type,outbound_clicks',
        limit: 100,
        action_attribution_windows:
          '["1d_view","1d_click","7d_click","28d_click","incrementality"]',
        time_increment: byDay ? 1 : undefined,
        time_range: JSON.stringify({ since, until }),
      },
    );
  }

  private async fetchActiveAdIds(
    accountPath: string,
    since: string,
    until: string,
  ): Promise<Set<string>> {
    const rows = await this.metaClient.getAllPages<GraphAdInsight>(
      `${accountPath}/insights`,
      {
        level: 'ad',
        fields: 'ad_id,adset_id,campaign_id',
        limit: 500,
        time_range: JSON.stringify({ since, until }),
      },
    );

    const ids = new Set<string>();
    for (const row of rows) {
      if (row.ad_id) {
        ids.add(row.ad_id);
      }
    }

    return ids;
  }

  private fetchAdInsights(accountPath: string, since: string, until: string) {
    return this.metaClient.getAllPages<GraphAdInsight>(
      `${accountPath}/insights`,
      {
        level: 'ad',
        fields:
          'ad_id,adset_id,campaign_id,spend,impressions,reach,cpp,actions,action_values,outbound_clicks',
        limit: 500,
        action_attribution_windows:
          '["1d_view","1d_click","7d_click","28d_click","incrementality"]',
        time_range: JSON.stringify({ since, until }),
      },
    );
  }

  private fetchAdInsightsDaily(
    accountPath: string,
    since: string,
    until: string,
  ) {
    return this.metaClient.getAllPages<GraphAdInsight>(
      `${accountPath}/insights`,
      {
        level: 'ad',
        fields:
          'date_start,date_stop,ad_id,adset_id,campaign_id,spend,impressions,reach,clicks,cpp,actions,action_values,outbound_clicks',
        limit: 500,
        action_attribution_windows:
          '["1d_view","1d_click","7d_click","28d_click","incrementality"]',
        time_increment: 1,
        time_range: JSON.stringify({ since, until }),
      },
    );
  }

  private fetchCampaignPlacementInsights(
    accountPath: string,
    since: string,
    until: string,
  ) {
    return this.metaClient.getAllPages<GraphCampaignPlacementInsight>(
      `${accountPath}/insights`,
      {
        level: 'campaign',
        fields:
          'date_start,campaign_id,spend,publisher_platform,platform_position',
        breakdowns: 'publisher_platform,platform_position',
        limit: 500,
        time_increment: 1,
        time_range: JSON.stringify({ since, until }),
      },
    );
  }

  private fetchCampaignAgeInsights(
    accountPath: string,
    since: string,
    until: string,
  ) {
    return this.metaClient.getAllPages<GraphCampaignAgeInsight>(
      `${accountPath}/insights`,
      {
        level: 'campaign',
        fields: 'date_start,campaign_id,spend,age',
        breakdowns: 'age',
        limit: 500,
        time_increment: 1,
        time_range: JSON.stringify({ since, until }),
      },
    );
  }
}
