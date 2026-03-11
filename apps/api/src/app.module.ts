import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AccessContractsModule } from './access/access-contracts.module';
import { MetaModule } from './meta/meta.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [AccessContractsModule, MetaModule, ProjectsModule],
  controllers: [AppController],
})
export class AppModule {}
