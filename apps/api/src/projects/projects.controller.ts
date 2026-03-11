import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('v1/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async list(@Query('adAccountId') adAccountId?: string) {
    return { data: await this.projectsService.list(adAccountId) };
  }

  @Post()
  create(
    @Body()
    payload: {
      name: string;
      adAccountIds: string[];
      targets?: {
        cpaTarget?: number | null;
        roasTarget?: number | null;
        dailySpendTarget?: number | null;
      };
      changedBy?: string;
    },
  ) {
    return this.projectsService.create(payload);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.projectsService.get(id);
  }

  @Patch(':id/targets')
  updateTargets(
    @Param('id') id: string,
    @Body()
    payload: {
      cpaTarget?: number | null;
      roasTarget?: number | null;
      dailySpendTarget?: number | null;
      changedBy?: string;
    },
  ) {
    return this.projectsService.updateTargets(id, payload, payload.changedBy);
  }

  @Get(':id/target-history')
  async targetHistory(@Param('id') id: string) {
    return { data: await this.projectsService.listTargetHistory(id) };
  }

  @Get(':id/campaign-targets')
  async campaignTargets(@Param('id') id: string) {
    return { data: await this.projectsService.listCampaignTargets(id) };
  }

  @Put(':id/campaign-targets/:campaignId')
  upsertCampaignTarget(
    @Param('id') id: string,
    @Param('campaignId') campaignId: string,
    @Body()
    payload: {
      cpaTarget?: number | null;
      roasTarget?: number | null;
      changedBy?: string;
    },
  ) {
    return this.projectsService.upsertCampaignTargets(
      id,
      campaignId,
      payload,
      payload.changedBy,
    );
  }

  @Patch(':id/ad-accounts')
  replaceAdAccounts(
    @Param('id') id: string,
    @Body() payload: { adAccountIds: string[] },
  ) {
    return this.projectsService.replaceProjectAdAccounts(
      id,
      payload.adAccountIds,
    );
  }

  @Get(':id/tag-catalog')
  tagCatalog() {
    return { data: this.projectsService.getTagCatalog() };
  }

  @Get(':id/tags')
  async listTags(
    @Param('id') id: string,
    @Query('accountId') accountId: string,
  ) {
    return { data: await this.projectsService.listEntityTags(id, accountId) };
  }

  @Put(':id/tags')
  upsertTag(
    @Param('id') id: string,
    @Body()
    payload: {
      accountId: string;
      entityType: 'campaign' | 'adset' | 'ad';
      entityId: string;
      categoryKey: string;
      value: string | null;
      changedBy?: string;
    },
  ) {
    return this.projectsService.upsertEntityTag({
      projectId: id,
      accountId: payload.accountId,
      entityType: payload.entityType,
      entityId: payload.entityId,
      categoryKey: payload.categoryKey,
      value: payload.value,
      changedBy: payload.changedBy,
    });
  }

  @Post(':id/custom-breakdown')
  customBreakdown(
    @Param('id') id: string,
    @Body()
    payload: {
      accountId: string;
      since: string;
      until: string;
      tagKeys: string[];
    },
  ) {
    return this.projectsService.buildCustomBreakdown({
      projectId: id,
      accountId: payload.accountId,
      since: payload.since,
      until: payload.until,
      tagKeys: payload.tagKeys,
    });
  }
}
