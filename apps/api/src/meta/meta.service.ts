import { BadRequestException, Injectable } from '@nestjs/common';
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
  };
}

interface GraphAdInsight {
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
}

@Injectable()
export class MetaService {
  constructor(private readonly metaClient: MetaGraphClient) {}

  async getAdAccounts(): Promise<{ data: MetaAdAccountDto[] }> {
    const accounts = await this.metaClient.getAllPages<GraphAdAccount>(
      'me/adaccounts',
      {
        fields:
          'id,account_id,name,account_status,currency,timezone_name,business_name',
        limit: 100,
      },
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
        limit: 200,
      }),
      this.metaClient.getAllPages<GraphAdSet>(`${accountPath}/adsets`, {
        fields: 'id,campaign_id,name,status',
        limit: 200,
      }),
      this.metaClient.getAllPages<GraphAd>(`${accountPath}/ads`, {
        fields: 'id,campaign_id,adset_id,name,status,creative{id,name}',
        limit: 200,
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
