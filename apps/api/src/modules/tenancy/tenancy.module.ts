import { Global, Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { TenantGuard } from './tenant.guard';

@Global()
@Module({
  controllers: [CompaniesController],
  providers: [CompaniesService, TenantGuard],
  exports: [CompaniesService, TenantGuard],
})
export class TenancyModule {}
