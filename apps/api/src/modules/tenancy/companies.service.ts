import { Injectable, NotFoundException } from '@nestjs/common';
import { RecordStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class CompaniesService {
  private cache = new Map<string, { id: string; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** slug → id with a 60 s cache (companies almost never change). */
  async idBySlug(slug: string): Promise<string> {
    const hit = this.cache.get(slug);
    if (hit && Date.now() - hit.at < 60_000) return hit.id;
    const company = await this.prisma.company.findFirst({
      where: { slug, status: RecordStatus.ACTIVE },
      select: { id: true },
    });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: `Company "${slug}" does not exist` });
    this.cache.set(slug, { id: company.id, at: Date.now() });
    return company.id;
  }

  /** Public data to paint the sign-in screen (BC-01, BC-01d). */
  async getPublic(slug: string) {
    const c = await this.prisma.company.findFirst({
      where: { slug, status: RecordStatus.ACTIVE },
      select: { slug: true, tradeName: true, brand: true },
    });
    if (!c) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: `Company "${slug}" does not exist` });
    return c;
  }
}
