import {
  type SiatCancelResult,
  type SiatCreditNoteSubmission,
  type SiatCufd,
  type SiatCuis,
  type SiatGateway,
  type SiatCatalogs,
  type SiatInvoiceStatusResult,
  type SiatInvoiceSubmission,
  type SiatNitResult,
  type SiatPointOfSaleRegistration,
  type SiatSendResult,
  SiatUnavailableError,
} from './gateway';
import { SIMULATED_CATALOGS } from './simulated-catalogs';
import type { PointOfSaleRef } from './types';

export type SimulatorMode = 'ONLINE' | 'OFFLINE';

/** What the simulated SIN remembers, so a status query or a repeated cancel behave like the real one. */
export interface SimulatedSiatStore {
  accepted(cuf: string): Promise<string | null>;
  remember(cuf: string, receptionCode: string): Promise<void>;
  isCancelled(cuf: string): Promise<boolean>;
  markCancelled(cuf: string): Promise<void>;
  /**
   * The code the simulated SIN gives a point of sale: the same for the same branch and name, otherwise the next one above every
   * code of the branch (`knownCodes` are the ones the caller already holds). Two concurrent calls never get the same code.
   */
  registerPointOfSale(branchCode: number, name: string, knownCodes: readonly number[]): Promise<number>;
}

export class InMemorySiatStore implements SimulatedSiatStore {
  private readonly receptions = new Map<string, string>();
  private readonly cancelled = new Set<string>();
  private readonly pointsOfSale = new Map<string, number>();

  async accepted(cuf: string) {
    return this.receptions.get(cuf) ?? null;
  }
  async remember(cuf: string, receptionCode: string) {
    this.receptions.set(cuf, receptionCode);
  }
  async isCancelled(cuf: string) {
    return this.cancelled.has(cuf);
  }
  async markCancelled(cuf: string) {
    this.cancelled.add(cuf);
  }
  async registerPointOfSale(branchCode: number, name: string, knownCodes: readonly number[]) {
    const key = `${branchCode}:${name.trim().toLowerCase()}`;
    const known = this.pointsOfSale.get(key);
    if (known !== undefined) return known;
    const inBranch = [...this.pointsOfSale].filter(([k]) => k.startsWith(`${branchCode}:`)).map(([, code]) => code);
    const code = Math.max(0, ...knownCodes, ...inBranch) + 1;
    this.pointsOfSale.set(key, code);
    return code;
  }
}

/** NITs starting with this prefix do not exist for the simulated SIN. */
export const SIMULATED_UNKNOWN_NIT_PREFIX = '999';
export const SIMULATED_NIT_REJECTION_CODE = 1037;
/** A credit note whose invoice the simulated SIN does not hold as valid. */
export const SIMULATED_INVOICE_NOT_VALID_CODE = 906;
export const SIMULATED_CUFD_HOURS = 24;
export const SIMULATED_CUIS_DAYS = 365;
const UNKNOWN_NIT_MESSAGE = 'NIT INVALIDO';

/**
 * Deterministic stand-in for the SIN (decision of HU-FAC-01…10): offline when told so, rejects the NITs that start with `999`
 * unless the invoice carries the exception flag, and keeps what it accepted and cancelled in an injected store. It also accepts
 * credit notes of the invoices it holds as valid and hands out CUIS and CUFD codes (HU-FAC-12, HU-FAC-13). Nothing here is
 * certified against the real service.
 */
export class SimulatedSiatGateway implements SiatGateway {
  constructor(
    private readonly mode: () => SimulatorMode | Promise<SimulatorMode>,
    private readonly store: SimulatedSiatStore = new InMemorySiatStore(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async requireOnline(): Promise<void> {
    if ((await this.mode()) === 'OFFLINE') throw new SiatUnavailableError('The simulated SIAT is offline');
  }

  async verifyCommunication() {
    return { success: (await this.mode()) === 'ONLINE' };
  }

  async verifyNit(nit: string): Promise<SiatNitResult> {
    await this.requireOnline();
    if (nit.startsWith(SIMULATED_UNKNOWN_NIT_PREFIX)) return { valid: false, messages: [{ code: SIMULATED_NIT_REJECTION_CODE, description: UNKNOWN_NIT_MESSAGE }] };
    return { valid: true, messages: [] };
  }

  async sendInvoice(invoice: SiatInvoiceSubmission): Promise<SiatSendResult> {
    await this.requireOnline();
    const unknownNit = invoice.customer.documentType === 5 && invoice.customer.documentNumber.startsWith(SIMULATED_UNKNOWN_NIT_PREFIX);
    if (unknownNit && !invoice.nitException) {
      return { status: 'REJECTED', code: SIMULATED_NIT_REJECTION_CODE, messages: [{ code: SIMULATED_NIT_REJECTION_CODE, description: UNKNOWN_NIT_MESSAGE }] };
    }
    const receptionCode = `SIM-${invoice.cuf.slice(0, 12)}`;
    await this.store.remember(invoice.cuf, receptionCode);
    return { status: 'ACCEPTED', receptionCode, messages: [] };
  }

  async invoiceStatus(cuf: string): Promise<SiatInvoiceStatusResult> {
    await this.requireOnline();
    const receptionCode = await this.store.accepted(cuf);
    if (receptionCode === null) return { status: 'UNKNOWN', receptionCode: null };
    return { status: (await this.store.isCancelled(cuf)) ? 'CANCELLED' : 'ACCEPTED', receptionCode };
  }

  async cancelInvoice(cuf: string, reasonCode: number): Promise<SiatCancelResult> {
    await this.requireOnline();
    if ((await this.store.accepted(cuf)) === null) return { cancelled: false, messages: [{ code: 905, description: 'FACTURA NO ENCONTRADA' }] };
    if (reasonCode < 1 || reasonCode > 4) return { cancelled: false, messages: [{ code: 903, description: 'MOTIVO DE ANULACION INVALIDO' }] };
    // cancelling twice is not an error for the SIN: the invoice is already cancelled
    await this.store.markCancelled(cuf);
    return { cancelled: true };
  }

  /** A note is accepted when its invoice is one the simulated SIN holds as valid, with the same `999` NIT rule as an invoice. */
  async sendCreditNote(note: SiatCreditNoteSubmission): Promise<SiatSendResult> {
    await this.requireOnline();
    if ((await this.store.accepted(note.invoiceCuf)) === null || (await this.store.isCancelled(note.invoiceCuf))) {
      return {
        status: 'REJECTED',
        code: SIMULATED_INVOICE_NOT_VALID_CODE,
        messages: [{ code: SIMULATED_INVOICE_NOT_VALID_CODE, description: 'FACTURA ORIGINAL NO VIGENTE' }],
      };
    }
    const unknownNit = note.customer.documentType === 5 && note.customer.documentNumber.startsWith(SIMULATED_UNKNOWN_NIT_PREFIX);
    if (unknownNit && !note.nitException) {
      return { status: 'REJECTED', code: SIMULATED_NIT_REJECTION_CODE, messages: [{ code: SIMULATED_NIT_REJECTION_CODE, description: UNKNOWN_NIT_MESSAGE }] };
    }
    const receptionCode = `SIM-NC-${note.cuf.slice(0, 12)}`;
    await this.store.remember(note.cuf, receptionCode);
    return { status: 'ACCEPTED', receptionCode, messages: [] };
  }

  /** A new CUFD every call, valid for 24 hours like the real one. */
  async requestCufd(pointOfSale: PointOfSaleRef): Promise<SiatCufd> {
    await this.requireOnline();
    const now = this.clock();
    const stamp = now.getTime().toString(36).toUpperCase();
    return {
      code: `SIMCUFD-${pointOfSale.branchCode}-${pointOfSale.pointOfSaleCode}-${stamp}`,
      controlCode: `SIM${stamp.slice(-5)}`,
      address: 'DIRECCION SIMULADA',
      expiresAt: new Date(now.getTime() + SIMULATED_CUFD_HOURS * 3_600_000),
    };
  }

  /** The CUIS of a point of sale is stable and lasts a year. */
  async requestCuis(pointOfSale: PointOfSaleRef): Promise<SiatCuis> {
    await this.requireOnline();
    return {
      code: `SIMCUIS-${pointOfSale.branchCode}-${pointOfSale.pointOfSaleCode}`,
      expiresAt: new Date(this.clock().getTime() + SIMULATED_CUIS_DAYS * 86_400_000),
    };
  }

  /** Hands out consecutive codes per branch; registering the same branch and name again is not an error and returns the same code. */
  async registerPointOfSale(registration: SiatPointOfSaleRegistration): Promise<{ code: number }> {
    await this.requireOnline();
    return { code: await this.store.registerPointOfSale(registration.branchCode, registration.name, registration.knownCodes) };
  }

  async closePointOfSale(_pointOfSale: PointOfSaleRef): Promise<void> {
    await this.requireOnline();
  }

  async syncCatalogs(_pointOfSale: PointOfSaleRef): Promise<SiatCatalogs> {
    await this.requireOnline();
    return SIMULATED_CATALOGS;
  }
}
