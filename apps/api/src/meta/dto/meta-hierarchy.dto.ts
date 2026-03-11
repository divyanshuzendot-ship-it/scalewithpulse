export interface MetaCreativeNodeDto {
  id: string;
  name?: string;
  title?: string;
  body?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  objectStoryId?: string;
}

export interface MetaEntityMetricsDto {
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
  metrics?: MetaEntityMetricsDto;
  ads: MetaAdNodeDto[];
}

export interface MetaCampaignNodeDto {
  id: string;
  name: string;
  status?: string;
  objective?: string;
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
