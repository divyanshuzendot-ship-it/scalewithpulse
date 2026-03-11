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
  ) {
    return this.metaService.getHierarchy(id, query);
  }

  @Get('ad-accounts/:id/report')
  async getReport(@Param('id') id: string, @Query() query: DateRangeQueryDto) {
    return this.metaService.getReport(id, query);
  }

  @Get('ad-accounts/:id/trends')
  async getDailyTrends(
    @Param('id') id: string,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.metaService.getDailyTrends(id, query);
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
