import { createClientAsync, type Client } from 'soap';
import type {
  PuntoVentaRef,
  RespuestaComunicacion,
  RespuestaCufd,
  RespuestaCuis,
  SiatCredenciales,
} from './types';

/**
 * Cliente del servicio FacturacionCodigos (CUIS, CUFD, verificación de NIT).
 * Un cliente por empresa: cada una tiene su NIT, token y código de sistema.
 */
export class SiatCodigosClient {
  private client?: Client;

  constructor(private readonly cred: SiatCredenciales) {}

  private async soap(): Promise<Client> {
    if (!this.client) {
      this.client = await createClientAsync(`${this.cred.baseUrl}/FacturacionCodigos?wsdl`, {
        wsdl_headers: { apikey: `TokenApi ${this.cred.token}` },
      });
      this.client.addHttpHeader('apikey', `TokenApi ${this.cred.token}`);
    }
    return this.client;
  }

  async verificarComunicacion(): Promise<RespuestaComunicacion> {
    const c = await this.soap();
    const [res] = await c['verificarComunicacionAsync']({});
    return res?.return ?? res?.RespuestaComunicacion ?? res;
  }

  async cuis(pv: PuntoVentaRef): Promise<RespuestaCuis> {
    const c = await this.soap();
    const [res] = await c['cuisAsync']({
      SolicitudCuis: {
        codigoAmbiente: this.cred.ambiente,
        codigoModalidad: this.cred.modalidad,
        codigoPuntoVenta: pv.codigoPuntoVenta,
        codigoSistema: this.cred.codigoSistema,
        codigoSucursal: pv.codigoSucursal,
        nit: this.cred.nit,
      },
    });
    return res?.RespuestaCuis ?? res;
  }

  async cufd(pv: PuntoVentaRef, cuis: string): Promise<RespuestaCufd> {
    const c = await this.soap();
    const [res] = await c['cufdAsync']({
      SolicitudCufd: {
        codigoAmbiente: this.cred.ambiente,
        codigoModalidad: this.cred.modalidad,
        codigoPuntoVenta: pv.codigoPuntoVenta,
        codigoSistema: this.cred.codigoSistema,
        codigoSucursal: pv.codigoSucursal,
        cuis,
        nit: this.cred.nit,
      },
    });
    return res?.RespuestaCufd ?? res;
  }

  async verificarNit(pv: PuntoVentaRef, cuis: string, nitParaVerificacion: string) {
    const c = await this.soap();
    const [res] = await c['verificarNitAsync']({
      SolicitudVerificarNit: {
        codigoAmbiente: this.cred.ambiente,
        codigoModalidad: this.cred.modalidad,
        codigoSistema: this.cred.codigoSistema,
        codigoSucursal: pv.codigoSucursal,
        cuis,
        nit: this.cred.nit,
        nitParaVerificacion,
      },
    });
    return res?.RespuestaVerificarNit ?? res;
  }
}
