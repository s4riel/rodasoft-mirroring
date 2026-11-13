import { type SiatCancelResult, type SiatGateway, type SiatInvoiceStatusResult, type SiatInvoiceSubmission, type SiatNitResult, type SiatSendResult, SiatUnavailableError } from './gateway';

export type SimulatorMode = 'ONLINE' | 'OFFLINE';

/** What the simulated SIN remembers, so a status query or a repeated cancel behave like the real one. */
export interface SimulatedSiatStore {
  accepted(cuf: string): Promise<string | null>;
  remember(cuf: string, receptionCode: string): Promise<void>;
  isCancelled(cuf: string): Promise<boolean>;
  markCancelled(cuf: string): Promise<void>;
}

export class InMemorySiatStore implements SimulatedSiatStore {
  private readonly receptions = new Map<string, string>();
  private readonly cancelled = new Set<string>();

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
}

/** NITs starting with this prefix do not exist for the simulated SIN. */
export const SIMULATED_UNKNOWN_NIT_PREFIX = '999';
export const SIMULATED_NIT_REJECTION_CODE = 1037;
const UNKNOWN_NIT_MESSAGE = 'NIT INVALIDO';

/**
 * Deterministic stand-in for the SIN (decision of HU-FAC-01…10): offline when told so, rejects the NITs that start with `999`
 * unless the invoice carries the exception flag, and keeps what it accepted and cancelled in an injected store. Nothing here is
 * certified against the real service.
 */
export class SimulatedSiatGateway implements SiatGateway {
  constructor(
    private readonly mode: () => SimulatorMode | Promise<SimulatorMode>,
    private readonly store: SimulatedSiatStore = new InMemorySiatStore(),
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
}
