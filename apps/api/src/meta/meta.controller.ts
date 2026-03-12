import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { DateRangeQueryDto } from './dto/date-range.query.dto';
import { MetaService } from './meta.service';

@Controller('v1/meta')
export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  @Get('ad-accounts')
  async getAdAccounts() {
    return this.metaService.getAdAccounts();
  }

  @Get('ad-accounts/:id/hierarchy')
  async getHierarchy(
    @Param('id') id: string,
    @Query() query: DateRangeQueryDto,
    @Query('projectId') projectId?: string,
    @Query('product') product?: string,
  ) {
    return this.metaService.getHierarchy(id, query, { projectId, product });
  }

  @Get('ad-accounts/:id/report')
  async getReport(
    @Param('id') id: string,
    @Query() query: DateRangeQueryDto,
    @Query('projectId') projectId?: string,
    @Query('product') product?: string,
  ) {
    return this.metaService.getReport(id, query, { projectId, product });
  }

  @Get('ad-accounts/:id/trends')
  async getDailyTrends(
    @Param('id') id: string,
    @Query() query: DateRangeQueryDto,
    @Query('projectId') projectId?: string,
    @Query('product') product?: string,
  ) {
    return this.metaService.getDailyTrends(id, query, { projectId, product });
  }

  @Get('ad-accounts/:id/incrementality')
  async getIncrementality(
    @Param('id') id: string,
    @Query('projectId') projectId?: string,
    @Query('product') product?: string,
  ): Promise<unknown> {
    return this.metaService.getIncrementality(id, { projectId, product });
  }

  @Get('ad-accounts/:id/creative-fatigue')
  async getCreativeFatigue(
    @Param('id') id: string,
    @Query('projectId') projectId?: string,
    @Query('product') product?: string,
  ): Promise<unknown> {
    return this.metaService.getCreativeFatigue(id, { projectId, product });
  }

  @Post('sync/daily')
  async runDailySync(
    @Body()
    payload?: {
      accountIds?: string[];
      changedBy?: string;
    },
  ) {
    return this.metaService.runDailySync(payload);
  }

  @Post('sync/backfill')
  async runBackfillSync(
    @Body()
    payload?: {
      accountIds?: string[];
      since?: string;
      until?: string;
      changedBy?: string;
    },
  ) {
    return this.metaService.runBackfillSync(payload);
  }

  @Get('sync/status')
  async getSyncStatus(@Query('limit') limit?: string) {
    const parsed = Number.parseInt(limit ?? '20', 10);
    return this.metaService.getSyncStatus(
      Number.isFinite(parsed) ? parsed : 20,
    );
  }
}
