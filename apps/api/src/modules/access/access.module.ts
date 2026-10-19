import { Global, Module } from '@nestjs/common';
import { ContextoController } from './contexto.controller';
import { MembershipService } from './membership.service';
import { PermissionsGuard } from './permissions.guard';

@Global()
@Module({
  controllers: [ContextoController],
  providers: [MembershipService, PermissionsGuard],
  exports: [MembershipService, PermissionsGuard],
})
export class AccessModule {}
