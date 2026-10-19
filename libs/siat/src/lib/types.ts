/**
 * Tipos y catálogos del SIAT (Servicio de Impuestos Nacionales, Bolivia).
 * Los valores vienen de la especificación técnica del SIN; validar contra la versión vigente
 * y contra los catálogos sincronizados (sincronizarParametrica*) antes de pasar a producción.
 */
export enum CodigoAmbiente {
  Produccion = 1,
  Pruebas = 2,
}

export enum CodigoModalidad {
  ElectronicaEnLinea = 1,
  ComputarizadaEnLinea = 2,
}

export enum TipoEmision {
  EnLinea = 1,
  FueraDeLinea = 2,
  Masiva = 3,
}

/** 1 = con derecho a crédito fiscal, 2 = sin derecho, 3 = documento de ajuste */
export enum TipoFacturaDocumento {
  ConCreditoFiscal = 1,
  SinCreditoFiscal = 2,
  DocumentoAjuste = 3,
}

/** Sector 1 = Compra-Venta (el que usa Rodalaser; confirmar en Fase 0). 24 = Nota de crédito-débito. */
export enum TipoDocumentoSector {
  CompraVenta = 1,
  NotaCreditoDebito = 24,
}

export interface SiatCredenciales {
  ambiente: CodigoAmbiente;
  modalidad: CodigoModalidad;
  nit: string;
  codigoSistema: string;
  /** Token delegado del SIAT. Se envía como header `apikey: TokenApi <token>`. */
  token: string;
  /** Base de servicios, p. ej. https://pilotosiatservicios.impuestos.gob.bo/v2 */
  baseUrl: string;
}

export interface PuntoVentaRef {
  codigoSucursal: number;
  codigoPuntoVenta: number;
}

export interface MensajeServicio {
  codigo: number;
  descripcion: string;
}

export interface RespuestaCuis {
  codigo: string;
  fechaVigencia: string;
  transaccion: boolean;
  mensajesList?: MensajeServicio[];
}

export interface RespuestaCufd {
  codigo: string;
  codigoControl: string;
  direccion: string;
  fechaVigencia: string;
  transaccion: boolean;
  mensajesList?: MensajeServicio[];
}

export interface RespuestaComunicacion {
  transaccion: boolean;
  mensajesList?: MensajeServicio[];
}
