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
}

interface GraphAdSet {
  id: string;
  campaign_id?: string;
  name: string;
  status?: string;
}

interface GraphAd {
  id: string;
  campaign_id?: string;
  adset_id?: string;
  name: string;
  status?: string;
  creative?: {
    id: string;
    name?: string;
    title?: string;
    body?: string;
    image_url?: string;
    thumbnail_url?: string;
    effective_object_story_id?: string;
  };
}

interface GraphAdInsight {
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
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
  purchases: number;
  outboundClicks: number;
  revenue7dClick: number;
  revenue1dView: number;
  videoViews3s: number;
  thruPlays: number;
}

type SyncType = 'daily' | 'backfill';
type SyncStatus = 'running' | 'success' | 'failed';

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
  ): Promise<MetaHierarchyResponseDto> {
    const accountId = this.normalizeAccountId(rawAccountId);
    const range = this.validateRange(query);
    return this.readHierarchyFromDb(accountId, range);
  }

  async getReport(rawAccountId: string, query: DateRangeQueryDto) {
    const accountId = this.normalizeAccountId(rawAccountId);
    const range = this.validateRange(query);
    if (!range) {
      throw new BadRequestException('Both since and until are required.');
    }

    const previousRange = this.getPreviousRange(range.since, range.until);
    const [dbCurrent, dbPrevious] = await Promise.all([
      this.readAccountDailyRows(accountId, range.since, range.until),
      this.readAccountDailyRows(
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

  async getDailyTrends(rawAccountId: string, query: DateRangeQueryDto) {
    const accountId = this.normalizeAccountId(rawAccountId);
    const range = this.validateRange(query);
    if (!range) {
      throw new BadRequestException('Both since and until are required.');
    }

    const dbRows = await this.readAccountDailyRows(
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
        };
      }),
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
        SELECT DISTINCT ad_account_id
        FROM project_ad_accounts
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
      } catch (error) {
        failed += 1;
        const message =
          error instanceof Error ? error.message : 'Unknown sync error.';
        await this.completeSyncRun(runId, 'failed', 0, message);
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
        fields: 'id,name,status,objective',
        limit: 100,
        effective_status: '["ACTIVE","PAUSED"]',
      }),
      this.metaClient.getAllPages<GraphAdSet>(`${accountPath}/adsets`, {
        fields: 'id,campaign_id,name,status',
        limit: 100,
        effective_status: '["ACTIVE","PAUSED"]',
      }),
      this.metaClient.getAllPages<GraphAd>(`${accountPath}/ads`, {
        fields:
          'id,campaign_id,adset_id,name,status,creative{id,name,title,body,image_url,thumbnail_url,effective_object_story_id}',
        limit: 100,
        effective_status: '["ACTIVE","PAUSED"]',
      }),
    ]);
    await this.persistHierarchyEntities(accountId, campaigns, adsets, ads);
    rowsWritten += campaigns.length + adsets.length + ads.length;

    const chunks = this.splitDateRange(since, until, 7);
    for (const chunk of chunks) {
      const adRangeRows = await this.fetchAdInsights(
        accountPath,
        chunk.since,
        chunk.until,
      );
      await this.persistAdRangeInsights(
        accountId,
        chunk.since,
        chunk.until,
        adRangeRows,
      );
      rowsWritten += adRangeRows.length;
    }

    return rowsWritten;
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
      const purchases =
        current.purchases +
        this.metricValueByActionType(row.actions, 'purchase', 'value');
      const revenue =
        current.revenue +
        this.getAttributedRevenueFromActionValues(row.action_values);
      const outboundClicks =
        current.outboundClicks + this.sumMetricEntries(row.outbound_clicks);

      const cpir = reach > 0 ? (spend * 1000) / reach : this.toNumber(row.cpp);
      const cpa = purchases > 0 ? spend / purchases : 0;
      const roas = spend > 0 ? revenue / spend : 0;

      map.set(row.ad_id, {
        spend,
        impressions,
        reach,
        purchases,
        revenue,
        outboundClicks,
        cpir,
        cpa,
        roas,
      });
    }

    return map;
  }

  private emptyMetrics(): MetaEntityMetricsDto {
    return {
      spend: 0,
      impressions: 0,
      reach: 0,
      purchases: 0,
      revenue: 0,
      outboundClicks: 0,
      cpir: 0,
      cpa: 0,
      roas: 0,
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
        purchases: acc.purchases + item.purchases,
        revenue: acc.revenue + item.revenue,
        outboundClicks: acc.outboundClicks + item.outboundClicks,
        cpir: 0,
        cpa: 0,
        roas: 0,
      }),
      this.emptyMetrics(),
    );

    return {
      ...totals,
      cpir: totals.reach > 0 ? (totals.spend * 1000) / totals.reach : 0,
      cpa: totals.purchases > 0 ? totals.spend / totals.purchases : 0,
      roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
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
        purchases NUMERIC NOT NULL DEFAULT 0,
        outbound_clicks NUMERIC NOT NULL DEFAULT 0,
        revenue_7d_click NUMERIC NOT NULL DEFAULT 0,
        revenue_1d_view NUMERIC NOT NULL DEFAULT 0,
        video_views_3s NUMERIC NOT NULL DEFAULT 0,
        thruplays NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, date)
      );

      CREATE TABLE IF NOT EXISTS campaign_cache (
        account_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NULL,
        objective TEXT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, campaign_id)
      );

      CREATE TABLE IF NOT EXISTS adset_cache (
        account_id TEXT NOT NULL,
        adset_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, adset_id)
      );

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
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, ad_id)
      );

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
            purchases,
            outbound_clicks,
            revenue_7d_click,
            revenue_1d_view,
            video_views_3s,
            thruplays,
            updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()
          )
          ON CONFLICT (account_id, date) DO UPDATE SET
            spend = EXCLUDED.spend,
            impressions = EXCLUDED.impressions,
            reach = EXCLUDED.reach,
            purchases = EXCLUDED.purchases,
            outbound_clicks = EXCLUDED.outbound_clicks,
            revenue_7d_click = EXCLUDED.revenue_7d_click,
            revenue_1d_view = EXCLUDED.revenue_1d_view,
            video_views_3s = EXCLUDED.video_views_3s,
            thruplays = EXCLUDED.thruplays,
            updated_at = NOW()
        `,
        [
          accountId,
          date,
          this.toNumber(row.spend),
          this.toNumber(row.impressions),
          this.toNumber(row.reach),
          this.getPurchases(row),
          this.getOutboundClicks(row),
          this.getAttributedRevenue(row, '7d_click'),
          this.getAttributedRevenue(row, '1d_view'),
          this.getMetricActionValue(row, [
            'video_view',
            'video_p3_watched_actions',
          ]),
          this.getMetricActionValue(row, [
            'video_thruplay_watched_actions',
            'thruplay',
          ]),
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
      purchases: string;
      outbound_clicks: string;
      revenue_7d_click: string;
      revenue_1d_view: string;
      video_views_3s: string;
      thruplays: string;
    }>(
      `
        SELECT
          date,
          spend,
          impressions,
          reach,
          purchases,
          outbound_clicks,
          revenue_7d_click,
          revenue_1d_view,
          video_views_3s,
          thruplays
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
      purchases: this.toNumber(row.purchases),
      outboundClicks: this.toNumber(row.outbound_clicks),
      revenue7dClick: this.toNumber(row.revenue_7d_click),
      revenue1dView: this.toNumber(row.revenue_1d_view),
      videoViews3s: this.toNumber(row.video_views_3s),
      thruPlays: this.toNumber(row.thruplays),
    }));
  }

  private aggregateAccountDailyRows(rows: DailyInsightRow[]) {
    return rows.reduce(
      (acc, row) => ({
        spend: acc.spend + row.spend,
        impressions: acc.impressions + row.impressions,
        reach: acc.reach + row.reach,
        purchases: acc.purchases + row.purchases,
        outboundClicks: acc.outboundClicks + row.outboundClicks,
        revenue7dClick: acc.revenue7dClick + row.revenue7dClick,
        revenue1dView: acc.revenue1dView + row.revenue1dView,
        videoViews3s: acc.videoViews3s + row.videoViews3s,
        thruPlays: acc.thruPlays + row.thruPlays,
      }),
      {
        spend: 0,
        impressions: 0,
        reach: 0,
        purchases: 0,
        outboundClicks: 0,
        revenue7dClick: 0,
        revenue1dView: 0,
        videoViews3s: 0,
        thruPlays: 0,
      },
    );
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
          INSERT INTO campaign_cache (account_id, campaign_id, name, status, objective, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (account_id, campaign_id) DO UPDATE SET
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            objective = EXCLUDED.objective,
            updated_at = NOW()
        `,
        [
          accountId,
          campaign.id,
          campaign.name,
          campaign.status ?? null,
          campaign.objective ?? null,
        ],
      );
    }

    for (const adset of adsets) {
      if (!adset.campaign_id) {
        continue;
      }
      await this.pool.query(
        `
          INSERT INTO adset_cache (account_id, adset_id, campaign_id, name, status, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (account_id, adset_id) DO UPDATE SET
            campaign_id = EXCLUDED.campaign_id,
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            updated_at = NOW()
        `,
        [
          accountId,
          adset.id,
          adset.campaign_id,
          adset.name,
          adset.status ?? null,
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
            updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
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

  private async readHierarchyFromDb(
    accountId: string,
    range:
      | {
          since: string;
          until: string;
        }
      | undefined,
  ): Promise<MetaHierarchyResponseDto> {
    const campaignRows = await this.pool.query<{
      campaign_id: string;
      name: string;
      status: string | null;
      objective: string | null;
    }>(
      `
        SELECT campaign_id, name, status, objective
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
    }>(
      `
        SELECT adset_id, campaign_id, name, status
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
          creative_object_story_id
        FROM ad_cache
        WHERE account_id = $1
      `,
      [accountId],
    );

    const adMetricsMap = new Map<string, MetaEntityMetricsDto>();
    if (range) {
      const insightRows = await this.pool.query<{
        ad_id: string;
        spend: string;
        impressions: string;
        reach: string;
        purchases: string;
        outbound_clicks: string;
        revenue_7d_click: string;
        revenue_1d_view: string;
      }>(
        `
          SELECT
            ad_id,
            spend,
            impressions,
            reach,
            purchases,
            outbound_clicks,
            revenue_7d_click,
            revenue_1d_view
          FROM ad_insights_range
          WHERE account_id = $1
            AND since = $2
            AND until = $3
        `,
        [accountId, range.since, range.until],
      );

      for (const row of insightRows.rows) {
        const spend = this.toNumber(row.spend);
        const reach = this.toNumber(row.reach);
        const purchases = this.toNumber(row.purchases);
        const revenue =
          this.toNumber(row.revenue_7d_click) +
          this.toNumber(row.revenue_1d_view);
        adMetricsMap.set(row.ad_id, {
          spend,
          impressions: this.toNumber(row.impressions),
          reach,
          purchases,
          revenue,
          outboundClicks: this.toNumber(row.outbound_clicks),
          cpir: reach > 0 ? (spend * 1000) / reach : 0,
          cpa: purchases > 0 ? spend / purchases : 0,
          roas: spend > 0 ? revenue / spend : 0,
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
        metrics: this.emptyMetrics(),
        ads: [],
      };
      adsetMap.set(adset.adset_id, node);
      parent.adsets.push(node);
    }

    for (const ad of adRows.rows) {
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
          'date_start,date_stop,account_currency,spend,cpp,cpm,impressions,reach,frequency,actions,action_values,cost_per_action_type,outbound_clicks',
        limit: 100,
        action_attribution_windows:
          '["1d_view","1d_click","7d_click","28d_click"]',
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
          '["1d_view","1d_click","7d_click","28d_click"]',
        time_range: JSON.stringify({ since, until }),
      },
    );
  }
}
