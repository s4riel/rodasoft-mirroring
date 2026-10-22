import { Global, Module } from '@nestjs/common';
import { ContextController } from './context.controller';
import { MembershipService } from './membership.service';
import { PermissionsGuard } from './permissions.guard';

@Global()
@Module({
  controllers: [ContextController],
  providers: [MembershipService, PermissionsGuard],
  exports: [MembershipService, PermissionsGuard],
})
export class AccessModule {}
