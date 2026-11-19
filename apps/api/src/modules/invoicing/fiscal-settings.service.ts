import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type CodeHealth,
  expiryHealth,
  type FiscalChecklistRow,
  type FiscalSectionStatus,
  type FiscalSettingsSummary,
  homologationProgress,
  isProductionConfirmation,
  type ProductionReadiness,
  productionReadiness,
  SIAT_CATALOGS,
  type SiatConnectionStatus,
} from '@rodasoft/domain';
import { loadP12 } from '@rodasoft/siat';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretsService } from '../../common/security/secrets.service';
import { SettingsService } from '../../common/settings/settings.service';
import { invoicingErrors } from './invoicing.errors';

/** The signature file the ERP accepts: a PKCS#12 bundle is a few kilobytes. */
export const SIGNATURE_MAX_BYTES = 256 * 1024;

export interface SignatureUpload {
  buffer: Buffer;
  size: number;
  originalname: string;
}

const status = (ok: boolean, warning = false): FiscalSectionStatus => (ok ? (warning ? 'WARNING' : 'OK') : 'PENDING');

/**
 * The fiscal configuration of the company (HU-FAC-22, 23, 27): the summary with its checklist, the digital signature and the SIAT
 * credentials (stored encrypted, never returned, never audited with their value), the economic activity and the switch to
 * production. Nothing secret leaves this service: the payload only says whether it is stored and until when it is valid.
 */
@Injectable()
export class FiscalSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly secrets: SecretsService,
    private readonly settings: SettingsService,
  ) {}

  /** `GET invoicing/fiscal-settings`. */
  async summary(now = new Date()): Promise<FiscalSettingsSummary> {
    const companyId = this.company();
    const [row, warnDays, gateway] = await Promise.all([
      this.prisma.siatSettings.findUnique({ where: { companyId } }),
      this.settings.get('invoicing.signatureWarnDays'),
      this.settings.get('invoicing.siatGateway'),
    ]);
    const facts = await this.facts(now);
    const signatureHealth: CodeHealth = row?.signatureExpiresAt ? expiryHealth(row.signatureExpiresAt, now, warnDays) : 'OK';
    const tokenHealth: CodeHealth = row?.tokenExpiresAt ? expiryHealth(row.tokenExpiresAt, now, warnDays) : 'OK';
    const signaturePresent = Boolean(row?.signatureP12Encrypted);
    const tokenPresent = Boolean(row?.tokenEncrypted);
    const connection = (row?.connectionStatus ?? 'UNKNOWN') as SiatConnectionStatus;
    const progress = homologationProgress(facts.products, facts.homologated);

    const readiness = this.readiness(row, facts, gateway, now, warnDays);
    const checklist: FiscalChecklistRow[] = [
      { key: 'SIGNATURE', status: status(signaturePresent && signatureHealth !== 'EXPIRED', signatureHealth === 'EXPIRING'), detail: row?.signatureExpiresAt?.toISOString() ?? null },
      {
        key: 'CREDENTIALS',
        status: status(Boolean(row?.systemCode) && tokenPresent && tokenHealth !== 'EXPIRED', tokenHealth === 'EXPIRING'),
        detail: row?.tokenExpiresAt?.toISOString() ?? null,
      },
      { key: 'CONNECTION', status: connection === 'ONLINE' ? 'OK' : connection === 'OFFLINE' ? 'WARNING' : 'PENDING', detail: row?.connectionCheckedAt?.toISOString() ?? null },
      { key: 'POINTS_OF_SALE', status: status(facts.pointsOfSaleWithCuis > 0), detail: String(facts.pointsOfSaleActive) },
      { key: 'CATALOGS', status: status(facts.catalogsSynced), detail: facts.catalogsSyncedAt?.toISOString() ?? null },
      { key: 'ACTIVITY', status: status(Boolean(row?.mainActivityCode)), detail: row?.mainActivityCode ?? null },
      { key: 'HOMOLOGATION', status: progress.pending === 0 && progress.total > 0 ? 'OK' : progress.total === 0 ? 'PENDING' : 'WARNING', detail: `${progress.done}/${progress.total}` },
    ];
    return {
      environment: row?.environment ?? 'TEST',
      modality: row?.modality ?? 'ELECTRONIC_ONLINE',
      gateway,
      productionEnabledAt: row?.productionEnabledAt?.toISOString() ?? null,
      warnDays,
      connection: { status: connection, checkedAt: row?.connectionCheckedAt?.toISOString() ?? null },
      signature: {
        present: signaturePresent,
        fileName: signaturePresent ? (row?.signatureFileName ?? null) : null,
        holder: signaturePresent ? (row?.signatureHolder ?? null) : null,
        uploadedAt: row?.signatureUploadedAt?.toISOString() ?? null,
        expiresAt: row?.signatureExpiresAt?.toISOString() ?? null,
        health: signaturePresent ? signatureHealth : 'OK',
      },
      credentials: { systemCode: row?.systemCode ?? null, tokenPresent, tokenExpiresAt: row?.tokenExpiresAt?.toISOString() ?? null, tokenHealth: tokenPresent ? tokenHealth : 'OK' },
      activity: { mainActivityCode: row?.mainActivityCode ?? null, defaultProductCode: row?.defaultProductCode ?? null },
      pointsOfSale: { total: facts.pointsOfSaleTotal, active: facts.pointsOfSaleActive, withCuis: facts.pointsOfSaleWithCuis },
      catalogs: { synced: facts.catalogsSynced, syncedAt: facts.catalogsSyncedAt?.toISOString() ?? null },
      homologation: progress,
      checklist,
      production: readiness,
    };
  }

  /** Reads the `.p12`, checks its password and expiry and stores it encrypted. */
  async saveSignature(file: SignatureUpload, password: string, now = new Date()): Promise<FiscalSettingsSummary['signature']> {
    const companyId = this.company();
    let signature: ReturnType<typeof loadP12>;
    try {
      signature = loadP12(file.buffer, password);
    } catch {
      throw invoicingErrors.signatureInvalid();
    }
    if (signature.validUntil.getTime() <= now.getTime()) throw invoicingErrors.signatureExpired();

    const fileName = file.originalname.slice(0, 200);
    const data = {
      signatureP12Encrypted: this.secrets.encrypt(file.buffer),
      signaturePasswordEncrypted: this.secrets.encrypt(password),
      signatureExpiresAt: signature.validUntil,
      signatureHolder: signature.holder || null,
      signatureFileName: fileName,
      signatureUploadedAt: now,
    };
    const before = await this.prisma.siatSettings.findUnique({ where: { companyId }, select: { signatureExpiresAt: true, signatureHolder: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.siatSettings.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
      // the file and its password are never written to the audit log: only who holds it and until when it is valid
      await this.audit.log(
        {
          action: 'invoicing.signature.update',
          entity: 'SiatSettings',
          entityId: companyId,
          before: before ? { holder: before.signatureHolder, expiresAt: before.signatureExpiresAt?.toISOString() } : undefined,
          after: { holder: signature.holder, expiresAt: signature.validUntil.toISOString(), fileName },
        },
        tx,
      );
    });
    const warnDays = await this.settings.get('invoicing.signatureWarnDays');
    return {
      present: true,
      fileName,
      holder: signature.holder || null,
      uploadedAt: now.toISOString(),
      expiresAt: signature.validUntil.toISOString(),
      health: expiryHealth(signature.validUntil, now, warnDays),
    };
  }

  /** Saves the system code and the delegated token (encrypted) with the day the token expires. */
  async saveCredentials(input: { systemCode: string; token: string; tokenExpiresAt: string }): Promise<FiscalSettingsSummary['credentials']> {
    const companyId = this.company();
    const expiresAt = new Date(input.tokenExpiresAt);
    const data = { systemCode: input.systemCode.trim(), tokenEncrypted: this.secrets.encrypt(input.token.trim()), tokenExpiresAt: expiresAt };
    const before = await this.prisma.siatSettings.findUnique({ where: { companyId }, select: { systemCode: true, tokenExpiresAt: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.siatSettings.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
      await this.audit.log(
        {
          action: 'invoicing.credentials.update',
          entity: 'SiatSettings',
          entityId: companyId,
          before: before ? { systemCode: before.systemCode, tokenExpiresAt: before.tokenExpiresAt?.toISOString() } : undefined,
          after: { systemCode: data.systemCode, tokenExpiresAt: expiresAt.toISOString() },
        },
        tx,
      );
    });
    const warnDays = await this.settings.get('invoicing.signatureWarnDays');
    return { systemCode: data.systemCode, tokenPresent: true, tokenExpiresAt: expiresAt.toISOString(), tokenHealth: expiryHealth(expiresAt, new Date(), warnDays) };
  }

  /** Chooses the economic activity printed on the invoices and the code used for a product without one. Both must be in the synced catalogue. */
  async saveActivity(input: { mainActivityCode: string; defaultProductCode?: string | null }): Promise<FiscalSettingsSummary['activity']> {
    const companyId = this.company();
    const synced = await this.prisma.tenant.siatCatalogSync.count();
    if (synced === 0) throw invoicingErrors.catalogsNotSynced();
    const activity = await this.prisma.tenant.siatCatalogEntry.findFirst({ where: { catalog: 'ACTIVITY', code: input.mainActivityCode, active: true }, select: { code: true } });
    if (!activity) throw invoicingErrors.sinCodeUnknown('mainActivityCode');
    const defaultProductCode = input.defaultProductCode?.trim() || null;
    if (defaultProductCode) {
      const product = await this.prisma.tenant.siatCatalogEntry.findFirst({ where: { catalog: 'PRODUCT_SERVICE', code: defaultProductCode, active: true }, select: { code: true } });
      if (!product) throw invoicingErrors.sinCodeUnknown('defaultProductCode');
    }
    const before = await this.prisma.siatSettings.findUnique({ where: { companyId }, select: { mainActivityCode: true, defaultProductCode: true } });
    const data = { mainActivityCode: activity.code, defaultProductCode };
    await this.prisma.$transaction(async (tx) => {
      await tx.siatSettings.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
      await this.audit.log({ action: 'invoicing.activity.update', entity: 'SiatSettings', entityId: companyId, before: before ?? undefined, after: data }, tx);
    });
    return data;
  }

  /**
   * HU-FAC-27 · Passes the company from the SIAT test environment to production. Refused (409) while something is missing, and
   * only when the person typed the confirmation word exactly. One switch only, serialised on the settings row: there is no way
   * back from the ERP.
   */
  async enableProduction(confirmation: string, now = new Date()): Promise<{ environment: 'PRODUCTION'; productionEnabledAt: string }> {
    const companyId = this.company();
    const userId = this.cls.get('userId') ?? null;
    const [warnDays, gateway] = await Promise.all([this.settings.get('invoicing.signatureWarnDays'), this.settings.get('invoicing.siatGateway')]);
    return this.prisma.tenant.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO siat_settings (company_id, updated_at) VALUES (${companyId}::uuid, now()) ON CONFLICT (company_id) DO NOTHING`;
      await tx.$queryRaw`SELECT company_id FROM siat_settings WHERE company_id = ${companyId}::uuid FOR UPDATE`;
      const row = await tx.siatSettings.findUniqueOrThrow({ where: { companyId } });
      if (row.environment === 'PRODUCTION') throw invoicingErrors.alreadyProduction();
      const facts = await this.facts(now, tx);
      const readiness = this.readiness(row, facts, gateway, now, warnDays);
      if (!readiness.ready) throw invoicingErrors.productionRequirementsMissing(readiness.requirements);
      if (!isProductionConfirmation(confirmation)) throw invoicingErrors.confirmationMismatch();
      await tx.siatSettings.update({ where: { companyId }, data: { environment: 'PRODUCTION', productionEnabledAt: now, productionEnabledById: userId } });
      await this.audit.log(
        { action: 'invoicing.production.enable', entity: 'SiatSettings', entityId: companyId, before: { environment: 'TEST' }, after: { environment: 'PRODUCTION' } },
        tx as unknown as Prisma.TransactionClient,
      );
      return { environment: 'PRODUCTION' as const, productionEnabledAt: now.toISOString() };
    });
  }

  // ── helpers ──

  private readiness(
    row: Prisma.SiatSettingsGetPayload<object> | null,
    facts: Facts,
    gateway: string,
    now: Date,
    warnDays: number,
  ): ProductionReadiness {
    return productionReadiness({
      modality: row?.modality ?? 'ELECTRONIC_ONLINE',
      signature: { present: Boolean(row?.signatureP12Encrypted), health: row?.signatureExpiresAt ? expiryHealth(row.signatureExpiresAt, now, warnDays) : 'OK' },
      credentials: {
        systemCodePresent: Boolean(row?.systemCode),
        tokenPresent: Boolean(row?.tokenEncrypted),
        tokenHealth: row?.tokenExpiresAt ? expiryHealth(row.tokenExpiresAt, now, warnDays) : 'OK',
      },
      connection: (row?.connectionStatus ?? 'UNKNOWN') as SiatConnectionStatus,
      pointsOfSaleWithCuis: facts.pointsOfSaleWithCuis,
      catalogsSynced: facts.catalogsSynced,
      mainActivityChosen: Boolean(row?.mainActivityCode),
      productsPending: facts.products - facts.homologated,
      simulatedGateway: gateway === 'SIMULATED',
      simulatorAllowed: process.env['SIAT_ALLOW_SIMULATOR'] === 'true',
    });
  }

  /** What the checklist and the readiness count: points of sale, catalogues and products. */
  private async facts(now: Date, db?: Pick<PrismaService['tenant'], 'siatPointOfSale' | 'siatCatalogSync' | 'product'>): Promise<Facts> {
    const tenant = db ?? this.prisma.tenant;
    const [pointsTotal, pointsActive, pointsWithCuis, syncs, products, homologated] = await Promise.all([
      tenant.siatPointOfSale.count(),
      tenant.siatPointOfSale.count({ where: { status: 'ACTIVE' } }),
      tenant.siatPointOfSale.count({ where: { status: 'ACTIVE', cuis: { not: null }, cuisExpiresAt: { gt: now } } }),
      tenant.siatCatalogSync.findMany({ select: { catalog: true, syncedAt: true } }),
      tenant.product.count({ where: { status: 'ACTIVE' } }),
      tenant.product.count({ where: { status: 'ACTIVE', sinProductCode: { not: null }, NOT: { sinProductCode: '' } } }),
    ]);
    const syncedAll = SIAT_CATALOGS.every((catalog) => syncs.some((sync) => sync.catalog === catalog));
    const latest = syncs.reduce<Date | null>((max, sync) => (!max || sync.syncedAt > max ? sync.syncedAt : max), null);
    return {
      pointsOfSaleTotal: pointsTotal,
      pointsOfSaleActive: pointsActive,
      pointsOfSaleWithCuis: pointsWithCuis,
      catalogsSynced: syncedAll,
      catalogsSyncedAt: syncedAll ? latest : null,
      products,
      homologated,
    };
  }

  private company(): string {
    const id = this.cls.get('companyId');
    if (!id) throw new Error('No company in the request context');
    return id;
  }
}

interface Facts {
  pointsOfSaleTotal: number;
  pointsOfSaleActive: number;
  pointsOfSaleWithCuis: number;
  catalogsSynced: boolean;
  catalogsSyncedAt: Date | null;
  products: number;
  homologated: number;
}
