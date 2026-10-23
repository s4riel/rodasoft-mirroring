import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  PayloadTooLargeException,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { checkUpload, UPLOAD_CONTENT_TYPE, type UploadKind } from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../common/cls';
import { RequirePermissions } from '../access/require-permissions.decorator';
import { StorageService } from '../../common/storage/storage.service';
import { UploadFieldsDto } from './product-write.dto';

/** The part of a multipart file the controller reads (memory storage). */
interface UploadedBinary {
  buffer: Buffer;
  size: number;
}

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

/** Largest file the parser keeps in memory: the datasheet limit. Each kind is checked against its own limit. */
const MAX_PARSED_BYTES = 10 * 1024 * 1024;

/**
 * Photos and datasheets of a product (HU-INV-06). The file is checked by its content and by the limit of its kind; the
 * response gives the storage key, which the product stores in `photos` or `datasheetUrl`.
 */
@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class UploadsController {
  constructor(
    private readonly storage: StorageService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Post('uploads')
  @HttpCode(201)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('inventory.products.edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PARSED_BYTES, files: 1 } }))
  async upload(
    @UploadedFile() file: UploadedBinary | undefined,
    @Body(fieldsPipe) fields: UploadFieldsDto,
  ): Promise<{ key: string; kind: UploadKind; contentType: string; size: number }> {
    if (!file) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field: 'file', code: 'FILE_REQUIRED' }] });
    }
    const checked = checkUpload(fields.kind, file.buffer);
    if ('rejection' in checked) {
      if (checked.rejection === 'FILE_TOO_LARGE') {
        throw new PayloadTooLargeException({ code: 'FILE_TOO_LARGE', message: 'The file is larger than the limit for this kind' });
      }
      throw new UnsupportedMediaTypeException({ code: 'UNSUPPORTED_FILE_TYPE', message: 'The file type is not accepted for this kind' });
    }
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Missing company in context');
    const key = await this.storage.save(companyId, fields.kind, file.buffer, checked.type);
    return { key, kind: fields.kind, contentType: UPLOAD_CONTENT_TYPE[checked.type], size: file.size };
  }
}
