import { Global, Module } from '@nestjs/common';
import { EmpresasController } from './empresas.controller';
import { EmpresasService } from './empresas.service';
import { TenantGuard } from './tenant.guard';

@Global()
@Module({
  controllers: [EmpresasController],
  providers: [EmpresasService, TenantGuard],
  exports: [EmpresasService, TenantGuard],
})
export class TenancyModule {}
