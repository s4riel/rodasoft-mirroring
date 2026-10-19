import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoRegistro } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class EmpresasService {
  private cache = new Map<string, { id: string; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** slug → id con caché de 60 s (las empresas casi no cambian). */
  async idBySlug(slug: string): Promise<string> {
    const hit = this.cache.get(slug);
    if (hit && Date.now() - hit.at < 60_000) return hit.id;
    const empresa = await this.prisma.empresa.findFirst({
      where: { slug, estado: EstadoRegistro.ACTIVO },
      select: { id: true },
    });
    if (!empresa) throw new NotFoundException({ code: 'EMPRESA_NO_EXISTE', message: `La empresa "${slug}" no existe` });
    this.cache.set(slug, { id: empresa.id, at: Date.now() });
    return empresa.id;
  }

  /** Datos públicos para pintar la pantalla de inicio de sesión (BC-01, BC-01d). */
  async publico(slug: string) {
    const e = await this.prisma.empresa.findFirst({
      where: { slug, estado: EstadoRegistro.ACTIVO },
      select: { slug: true, nombreComercial: true, brand: true },
    });
    if (!e) throw new NotFoundException({ code: 'EMPRESA_NO_EXISTE', message: `La empresa "${slug}" no existe` });
    return e;
  }
}
