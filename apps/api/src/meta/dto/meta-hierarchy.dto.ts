export interface MetaCreativeNodeDto {
  id: string;
  name?: string;
  title?: string;
  body?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  objectStoryId?: string;
  objectType?: string;
  createdTime?: string;
}

export interface MetaEntityMetricsDto {
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
  incrementalityStatus?:
    | 'achieving'
    | 'not_achieved'
    | 'losing'
    | 'insufficient';
}

export interface MetaAdNodeDto {
  id: string;
  name: string;
  status?: string;
  creative?: MetaCreativeNodeDto;
  metrics?: MetaEntityMetricsDto;
}

export interface MetaAdSetNodeDto {
  id: string;
  name: string;
  status?: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  metrics?: MetaEntityMetricsDto;
  ads: MetaAdNodeDto[];
}

export interface MetaCampaignNodeDto {
  id: string;
  name: string;
  status?: string;
  objective?: string;
  buyingType?: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  metrics?: MetaEntityMetricsDto;
  adsets: MetaAdSetNodeDto[];
}

export interface MetaHierarchyResponseDto {
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
  campaigns: MetaCampaignNodeDto[];
}
