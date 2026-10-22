import { createClientAsync, type Client } from 'soap';
import type { CommunicationResult, CufdResult, CuisResult, PointOfSaleRef, SiatCredentials } from './types';

/**
 * Client for the SIAT `FacturacionCodigos` service (CUIS, CUFD, NIT verification).
 * One client per company: each has its own NIT, token and system code.
 *
 * The SOAP request/response field names (`codigoAmbiente`, `codigoControl`, ...) are the SIN wire contract
 * and stay in Spanish; this class maps them to the English types in `types.ts`.
 */
export class SiatCodesClient {
  private client?: Client;

  constructor(private readonly credentials: SiatCredentials) {}

  private async soap(): Promise<Client> {
    if (!this.client) {
      this.client = await createClientAsync(`${this.credentials.baseUrl}/FacturacionCodigos?wsdl`, {
        wsdl_headers: { apikey: `TokenApi ${this.credentials.token}` },
      });
      this.client.addHttpHeader('apikey', `TokenApi ${this.credentials.token}`);
    }
    return this.client;
  }

  private common(pv: PointOfSaleRef) {
    return {
      codigoAmbiente: this.credentials.environment,
      codigoModalidad: this.credentials.modality,
      codigoPuntoVenta: pv.pointOfSaleCode,
      codigoSistema: this.credentials.systemCode,
      codigoSucursal: pv.branchCode,
      nit: this.credentials.nit,
    };
  }

  async verifyCommunication(): Promise<CommunicationResult> {
    const c = await this.soap();
    const [res] = await c['verificarComunicacionAsync']({});
    const raw = res?.return ?? res?.RespuestaComunicacion ?? res;
    return { success: !!raw?.transaccion, messages: mapMessages(raw?.mensajesList) };
  }

  async cuis(pv: PointOfSaleRef): Promise<CuisResult> {
    const c = await this.soap();
    const [res] = await c['cuisAsync']({ SolicitudCuis: this.common(pv) });
    const raw = res?.RespuestaCuis ?? res;
    return {
      code: raw?.codigo,
      validUntil: raw?.fechaVigencia,
      success: !!raw?.transaccion,
      messages: mapMessages(raw?.mensajesList),
    };
  }

  async cufd(pv: PointOfSaleRef, cuisCode: string): Promise<CufdResult> {
    const c = await this.soap();
    const [res] = await c['cufdAsync']({ SolicitudCufd: { ...this.common(pv), cuis: cuisCode } });
    const raw = res?.RespuestaCufd ?? res;
    return {
      code: raw?.codigo,
      controlCode: raw?.codigoControl,
      address: raw?.direccion,
      validUntil: raw?.fechaVigencia,
      success: !!raw?.transaccion,
      messages: mapMessages(raw?.mensajesList),
    };
  }

  async verifyNit(pv: PointOfSaleRef, cuisCode: string, nitToVerify: string) {
    const c = await this.soap();
    const [res] = await c['verificarNitAsync']({
      SolicitudVerificarNit: {
        codigoAmbiente: this.credentials.environment,
        codigoModalidad: this.credentials.modality,
        codigoSistema: this.credentials.systemCode,
        codigoSucursal: pv.branchCode,
        cuis: cuisCode,
        nit: this.credentials.nit,
        nitParaVerificacion: nitToVerify,
      },
    });
    const raw = res?.RespuestaVerificarNit ?? res;
    return { success: !!raw?.transaccion, messages: mapMessages(raw?.mensajesList) };
  }
}

function mapMessages(list: unknown): { code: number; description: string }[] | undefined {
  if (!list) return undefined;
  const items = Array.isArray(list) ? list : [list];
  return items.map((m: { codigo?: number; descripcion?: string }) => ({ code: m.codigo ?? 0, description: m.descripcion ?? '' }));
}
