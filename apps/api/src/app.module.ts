import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AccessContractsModule } from './access/access-contracts.module';
import { MetaModule } from './meta/meta.module';

@Module({
  imports: [AccessContractsModule, MetaModule],
  controllers: [AppController],
})
export class AppModule {}
