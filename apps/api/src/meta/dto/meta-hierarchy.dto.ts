export interface MetaCreativeNodeDto {
  id: string;
  name?: string;
  title?: string;
  body?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  objectStoryId?: string;
}

export interface MetaAdNodeDto {
  id: string;
  name: string;
  status?: string;
  creative?: MetaCreativeNodeDto;
}

export interface MetaAdSetNodeDto {
  id: string;
  name: string;
  status?: string;
  ads: MetaAdNodeDto[];
}

export interface MetaCampaignNodeDto {
  id: string;
  name: string;
  status?: string;
  objective?: string;
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
