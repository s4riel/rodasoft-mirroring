import { BadRequestException, Controller, Get, Query, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { APPROVAL_TYPES, APPROVAL_TYPE_PERMISSION, type ApprovalInboxResponse, type ApprovalInboxSummary, type ApprovalType } from '@rodasoft/domain';
import { IsIn, IsOptional } from 'class-validator';
import { RequireAnyPermission } from '../../access/require-permissions.decorator';
import { ApprovalsInboxService } from './approvals-inbox.service';

class ListApprovalsQueryDto {
  @ApiPropertyOptional({ enum: APPROVAL_TYPES })
  @IsOptional()
  @IsIn(APPROVAL_TYPES)
  type?: ApprovalType;
}

const filterPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: (errors: ValidationError[]) =>
    new BadRequestException({ code: 'INVALID_FILTER', message: 'Invalid filter', details: errors.map((e) => ({ field: e.property, constraints: e.constraints })) }),
});

/**
 * VP-25 · everything that waits for a decision, in one place (HU-VEN-29). Read only: each request is still decided through the
 * endpoint of its own type, so the audit entry, the state machine and the side effects stay where they are. Whoever holds any of
 * the four approve permissions may open it, and sees only the types they hold.
 */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/approvals')
@RequireAnyPermission(...APPROVAL_TYPES.map((type) => APPROVAL_TYPE_PERMISSION[type]))
export class ApprovalsController {
  constructor(private readonly inbox: ApprovalsInboxService) {}

  @Get()
  list(@Query(filterPipe) query: ListApprovalsQueryDto): Promise<ApprovalInboxResponse> {
    return this.inbox.list(query.type);
  }

  /** The count behind the badge of the Aprobaciones tab. Declared before any `:id` route. */
  @Get('summary')
  summary(): Promise<ApprovalInboxSummary> {
    return this.inbox.summary();
  }
}
