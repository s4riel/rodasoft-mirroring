import { BadRequestException } from '@nestjs/common';

/** Errors of the approvals inbox (HU-VEN-29). The ERP translates each `code` into Spanish. */
export const approvalErrors = {
  invalidFilter: (field: string) => new BadRequestException({ code: 'INVALID_FILTER', message: 'Invalid filter', details: [{ field }] }),
};
