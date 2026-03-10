import { Controller, Get, Param, Query } from '@nestjs/common';
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
  async getReport(
    @Param('id') id: string,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.metaService.getReport(id, query);
  }

  @Get('ad-accounts/:id/trends')
  async getDailyTrends(
    @Param('id') id: string,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.metaService.getDailyTrends(id, query);
  }
}
