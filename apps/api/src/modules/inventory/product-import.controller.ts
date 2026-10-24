import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IMPORT_MAX_BYTES, type ImportCommitResponse, type ImportPreviewResponse } from '@rodasoft/domain';
import { RequirePermissions } from '../access/require-permissions.decorator';
import { ImportFieldsDto } from './product-import.dto';
import { type ImportFile, ProductImportService } from './product-import.service';
import { UploadLimitInterceptor } from './uploads.controller';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const fieldsPipe = new ValidationPipe({
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

const fileOf = (file: ImportFile | undefined): ImportFile => {
  if (!file) {
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field: 'file', code: 'FILE_REQUIRED' }] });
  }
  return file;
};

/** Excel product import (HU-INV-10): template, preview, commit and error report. The file is sent again on each call. */
@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/products/import')
export class ProductImportController {
  constructor(private readonly imports: ProductImportService) {}

  @Get('template')
  @RequirePermissions('inventory.products.import')
  @Header('Content-Type', XLSX_TYPE)
  @Header('Content-Disposition', 'attachment; filename="plantilla-productos.xlsx"')
  async template(): Promise<StreamableFile> {
    return new StreamableFile(await this.imports.template());
  }

  @Post('preview')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('inventory.products.import')
  @UseInterceptors(UploadLimitInterceptor, FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES, files: 1 } }))
  preview(@UploadedFile() file: ImportFile | undefined, @Body(fieldsPipe) fields: ImportFieldsDto): Promise<ImportPreviewResponse> {
    return this.imports.preview(fileOf(file), fields.mode);
  }

  @Post('commit')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('inventory.products.import', 'inventory.products.edit')
  @UseInterceptors(UploadLimitInterceptor, FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES, files: 1 } }))
  commit(@UploadedFile() file: ImportFile | undefined, @Body(fieldsPipe) fields: ImportFieldsDto): Promise<ImportCommitResponse> {
    return this.imports.commit(fileOf(file), fields.mode);
  }

  @Post('error-report')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('inventory.products.import')
  @Header('Content-Type', XLSX_TYPE)
  @Header('Content-Disposition', 'attachment; filename="errores-importacion.xlsx"')
  @UseInterceptors(UploadLimitInterceptor, FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES, files: 1 } }))
  async errorReport(@UploadedFile() file: ImportFile | undefined, @Body(fieldsPipe) fields: ImportFieldsDto): Promise<StreamableFile> {
    return new StreamableFile(await this.imports.errorReport(fileOf(file), fields.mode));
  }
}
