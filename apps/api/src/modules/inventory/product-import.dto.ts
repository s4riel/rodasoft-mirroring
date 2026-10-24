import { ApiPropertyOptional } from '@nestjs/swagger';
import { IMPORT_MODES, type ImportMode } from '@rodasoft/domain';
import { IsIn, IsOptional } from 'class-validator';

/** Fields of the import calls next to the file. */
export class ImportFieldsDto {
  @ApiPropertyOptional({ enum: IMPORT_MODES, default: 'create_only', description: 'create_only refuses products that already exist; create_or_update updates them' })
  @IsOptional()
  @IsIn(IMPORT_MODES)
  mode: ImportMode = 'create_only';
}
