import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DateRangeQueryDto } from './dto/date-range.query.dto';
import { MetaAdAccountDto } from './dto/meta-ad-account.dto';
import {
  MetaAdNodeDto,
  MetaAdSetNodeDto,
  MetaCampaignNodeDto,
  MetaHierarchyResponseDto,
} from './dto/meta-hierarchy.dto';
import { MetaGraphClient } from './meta.client';

interface GraphAdAccount {
  id: string;
  account_id: string;
  name: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
  business_name?: string;
}

interface GraphCampaign {
  id: string;
  name: string;
  status?: string;
  objective?: string;
}

interface GraphBusiness {
  id: string;
  name: string;
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
  actions?: GraphMetricEntry[];
  action_values?: GraphMetricEntry[];
  cost_per_action_type?: GraphMetricEntry[];
  outbound_clicks?: GraphMetricEntry[];
}

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);

  constructor(private readonly metaClient: MetaGraphClient) {}

  async getAdAccounts(): Promise<{ data: MetaAdAccountDto[] }> {
    const [directAccounts, businesses] = await Promise.all([
      this.metaClient.getAllPages<GraphAdAccount>('me/adaccounts', {
        fields:
          'id,account_id,name,account_status,currency,timezone_name,business_name',
        limit: 100,
      }),
      this.metaClient.getAllPages<GraphBusiness>('me/businesses', {
        fields: 'id,name',
        limit: 100,
      }),
    ]);

    const accountMap = new Map<string, GraphAdAccount>();
    for (const account of directAccounts) {
      accountMap.set(account.account_id ?? account.id, account);
    }

    const businessAccountRequests = businesses.flatMap((business) => [
      this.metaClient.getAllPages<GraphAdAccount>(
        `${business.id}/owned_ad_accounts`,
        {
          fields:
            'id,account_id,name,account_status,currency,timezone_name,business_name',
          limit: 100,
        },
      ),
      this.metaClient.getAllPages<GraphAdAccount>(
        `${business.id}/client_ad_accounts`,
        {
          fields:
            'id,account_id,name,account_status,currency,timezone_name,business_name',
          limit: 100,
        },
      ),
    ]);

    const settledBusinessAccounts = await Promise.allSettled(
      businessAccountRequests,
    );

    for (const result of settledBusinessAccounts) {
      if (result.status !== 'fulfilled') {
        this.logger.warn('Failed to fetch business ad accounts for dropdown.');
        continue;
      }

      for (const account of result.value) {
        accountMap.set(account.account_id ?? account.id, account);
      }
    }

    const accounts = [...accountMap.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    return {
      data: accounts.map((account) => ({
        id: account.id,
        accountId: account.account_id,
        name: account.name,
        accountStatus: account.account_status,
        currency: account.currency,
        timezoneName: account.timezone_name,
        businessName: account.business_name,
      })),
    };
  }

  async getHierarchy(
    rawAccountId: string,
    query: DateRangeQueryDto,
  ): Promise<MetaHierarchyResponseDto> {
    const accountId = this.normalizeAccountId(rawAccountId);
    const range = this.validateRange(query);
    const accountPath = `act_${accountId}`;

    const [campaigns, adsets, ads, activeAdIds] = await Promise.all([
      this.metaClient.getAllPages<GraphCampaign>(`${accountPath}/campaigns`, {
        fields: 'id,name,status,objective',
        limit: 100,
      }),
      this.metaClient.getAllPages<GraphAdSet>(`${accountPath}/adsets`, {
        fields: 'id,campaign_id,name,status',
        limit: 100,
      }),
      this.metaClient.getAllPages<GraphAd>(`${accountPath}/ads`, {
        fields:
          'id,campaign_id,adset_id,name,status,creative{id,name,title,body,image_url,thumbnail_url,effective_object_story_id}',
        limit: 100,
      }),
      range
        ? this.fetchActiveAdIds(accountPath, range.since, range.until)
        : Promise.resolve(undefined),
    ]);

    const campaignMap = new Map<string, MetaCampaignNodeDto>();
    for (const campaign of campaigns) {
      campaignMap.set(campaign.id, {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        adsets: [],
      });
    }

    const adsetMap = new Map<string, MetaAdSetNodeDto>();
    for (const adset of adsets) {
      if (!adset.campaign_id || !campaignMap.has(adset.campaign_id)) {
        continue;
      }

      const adsetNode: MetaAdSetNodeDto = {
        id: adset.id,
        name: adset.name,
        status: adset.status,
        ads: [],
      };

      adsetMap.set(adset.id, adsetNode);
      campaignMap.get(adset.campaign_id)?.adsets.push(adsetNode);
    }

    for (const ad of ads) {
      if (!ad.adset_id || !adsetMap.has(ad.adset_id)) {
        continue;
      }

      if (activeAdIds && !activeAdIds.has(ad.id)) {
        continue;
      }

      const adNode: MetaAdNodeDto = {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        creative: ad.creative
          ? {
              id: ad.creative.id,
              name: ad.creative.name,
              title: ad.creative.title,
              body: ad.creative.body,
              imageUrl: ad.creative.image_url,
              thumbnailUrl: ad.creative.thumbnail_url,
              objectStoryId: ad.creative.effective_object_story_id,
            }
          : undefined,
      };

      adsetMap.get(ad.adset_id)?.ads.push(adNode);
    }

    const filteredCampaigns = [...campaignMap.values()]
      .map((campaign) => ({
        ...campaign,
        adsets: campaign.adsets
          .map((adset) => ({ ...adset, ads: adset.ads }))
          .filter((adset) => adset.ads.length > 0 || !activeAdIds),
      }))
      .filter((campaign) => campaign.adsets.length > 0 || !activeAdIds);

    const totalAdsets = filteredCampaigns.reduce(
      (count, campaign) => count + campaign.adsets.length,
      0,
    );
    const totalAds = filteredCampaigns.reduce(
      (count, campaign) =>
        count +
        campaign.adsets.reduce(
          (adCount, adset) => adCount + adset.ads.length,
          0,
        ),
      0,
    );

    return {
      accountId,
      range,
      totals: {
        campaigns: filteredCampaigns.length,
        adsets: totalAdsets,
        ads: totalAds,
      },
      campaigns: filteredCampaigns,
    };
  }

  async getReport(rawAccountId: string, query: DateRangeQueryDto) {
    const accountId = this.normalizeAccountId(rawAccountId);
    const range = this.validateRange(query);
    if (!range) {
      throw new BadRequestException('Both since and until are required.');
    }

    const previousRange = this.getPreviousRange(range.since, range.until);
    const accountPath = `act_${accountId}`;

    const [currentRows, previousRows] = await Promise.all([
      this.fetchAccountInsights(accountPath, range.since, range.until),
      this.fetchAccountInsights(
        accountPath,
        previousRange.since,
        previousRange.until,
      ),
    ]);

    const current = currentRows[0];
    const previous = previousRows[0];

    const currentSpend = this.toNumber(current?.spend);
    const previousSpend = this.toNumber(previous?.spend);
    const currentRevenue7d = this.getAttributedRevenue(current, '7d_click');
    const previousRevenue7d = this.getAttributedRevenue(previous, '7d_click');
    const currentRevenue1d = this.getAttributedRevenue(current, '1d_view');
    const previousRevenue1d = this.getAttributedRevenue(previous, '1d_view');
    const currentRevenue = currentRevenue7d + currentRevenue1d;
    const previousRevenue = previousRevenue7d + previousRevenue1d;
    const currentOutboundClicks = this.getOutboundClicks(current);
    const previousOutboundClicks = this.getOutboundClicks(previous);
    const currentPurchases = this.getPurchases(current);
    const previousPurchases = this.getPurchases(previous);

    return {
      accountId,
      range,
      previousRange,
      currency: current?.account_currency ?? previous?.account_currency ?? 'USD',
      summary: {
        spend: this.metric(currentSpend, previousSpend),
        purchaseValue: this.metric(currentRevenue, previousRevenue),
        outboundClicks: this.metric(currentOutboundClicks, previousOutboundClicks),
        costPerOutboundClick: this.metric(
          currentOutboundClicks > 0 ? currentSpend / currentOutboundClicks : 0,
          previousOutboundClicks > 0 ? previousSpend / previousOutboundClicks : 0,
        ),
        purchases: this.metric(currentPurchases, previousPurchases),
        cpir: this.metric(
          this.toNumber(current?.cpp),
          this.toNumber(previous?.cpp),
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

    const accountPath = `act_${accountId}`;
    const rows = await this.fetchAccountInsights(
      accountPath,
      range.since,
      range.until,
      true,
    );

    return {
      accountId,
      range,
      points: rows.map((row) => {
        const spend = this.toNumber(row.spend);
        const revenue7dClick = this.getAttributedRevenue(row, '7d_click');
        const revenue1dView = this.getAttributedRevenue(row, '1d_view');
        const purchases = this.getPurchases(row);
        const outboundClicks = this.getOutboundClicks(row);
        const revenue = revenue7dClick + revenue1dView;
        const roas7dClick = spend > 0 ? revenue7dClick / spend : 0;
        const roasBlend = spend > 0 ? revenue / spend : 0;

        return {
          date: row.date_start,
          spend,
          purchases,
          revenue,
          revenue7dClick,
          revenue1dView,
          roas7dClick,
          roasBlend,
          aov: purchases > 0 ? revenue / purchases : 0,
          conversionRate:
            outboundClicks > 0 ? (purchases / outboundClicks) * 100 : 0,
        };
      }),
    };
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
          'date_start,date_stop,account_currency,spend,cpp,actions,action_values,cost_per_action_type,outbound_clicks',
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
}
