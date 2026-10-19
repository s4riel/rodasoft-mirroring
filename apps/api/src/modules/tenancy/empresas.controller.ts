import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { EmpresasService } from './empresas.service';

@ApiTags('empresas')
@Controller('empresas')
export class EmpresasController {
  constructor(private readonly empresas: EmpresasService) {}

  @Public()
  @Get(':slug/publico')
  publico(@Param('slug') slug: string) {
    return this.empresas.publico(slug.toLowerCase());
  }
}
