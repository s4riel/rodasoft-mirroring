/**
 * SIAT (Servicio de Impuestos Nacionales, Bolivia) types and catalogs.
 * Values come from the SIN technical specification; validate against the current version
 * and against the synchronized catalogs (sincronizarParametrica*) before going to production.
 */
export enum EnvironmentCode {
  Production = 1,
  Test = 2,
}

export enum ModalityCode {
  ElectronicOnline = 1,
  ComputerizedOnline = 2,
}

export enum EmissionType {
  Online = 1,
  Offline = 2,
  Bulk = 3,
}

/** 1 = with tax credit, 2 = without tax credit, 3 = adjustment document */
export enum InvoiceDocumentType {
  WithTaxCredit = 1,
  WithoutTaxCredit = 2,
  AdjustmentDocument = 3,
}

/** Sector 1 = Purchase-Sale (the one Rodalaser uses; confirm in Phase 0). 24 = Credit-debit note. */
export enum SectorDocumentType {
  PurchaseSale = 1,
  CreditDebitNote = 24,
}

export interface SiatCredentials {
  environment: EnvironmentCode;
  modality: ModalityCode;
  nit: string;
  systemCode: string;
  /** SIAT delegated token. Sent as header `apikey: TokenApi <token>`. */
  token: string;
  /** Services base URL, e.g. https://pilotosiatservicios.impuestos.gob.bo/v2 */
  baseUrl: string;
}

export interface PointOfSaleRef {
  branchCode: number;
  pointOfSaleCode: number;
}

export interface ServiceMessage {
  code: number;
  description: string;
}

export interface CuisResult {
  code: string;
  validUntil: string;
  success: boolean;
  messages?: ServiceMessage[];
}

export interface CufdResult {
  code: string;
  controlCode: string;
  address: string;
  validUntil: string;
  success: boolean;
  messages?: ServiceMessage[];
}

export interface CommunicationResult {
  success: boolean;
  messages?: ServiceMessage[];
}
