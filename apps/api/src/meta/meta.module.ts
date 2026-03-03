import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';
import { MetaGraphClient } from './meta.client';

@Module({
  controllers: [MetaController],
  providers: [MetaService, MetaGraphClient],
})
export class MetaModule {}
