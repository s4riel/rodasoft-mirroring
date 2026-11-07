import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

/** The strict body and query validation of the quote and order endpoints, failing with the project's error shape. */
export const salesValidationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: (errors: ValidationError[]) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Invalid request',
      details: errors.map((e) => ({ field: e.property, constraints: e.constraints })),
    }),
});
