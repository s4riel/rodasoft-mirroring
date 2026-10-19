/**
 * Spike SIAT — semana S0 (riesgo n.º 1 del proyecto).
 * Objetivo: demostrar contra el ambiente PILOTO que podemos
 *   1) comunicarnos con el SIN,  2) obtener CUIS,  3) obtener CUFD,
 *   4) firmar un XML con la firma digital de la empresa y calcular el CUF.
 *
 * Uso:  pnpm siat:spike            (lee las variables SIAT_* de .env)
 *       pnpm siat:spike --firmar   (además prueba la firma con el .p12)
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  buildCuf,
  cargarP12,
  CodigoAmbiente,
  CodigoModalidad,
  empaquetarArchivo,
  firmarXml,
  SiatCodigosClient,
  TipoDocumentoSector,
  TipoEmision,
  TipoFacturaDocumento,
} from '../../libs/siat/src';

const env = (k: string, required = true): string => {
  const v = process.env[k] ?? '';
  if (required && !v) {
    console.error(`✗ Falta la variable ${k} en .env`);
    process.exit(1);
  }
  return v;
};

async function main() {
  const client = new SiatCodigosClient({
    ambiente: Number(env('SIAT_AMBIENTE')) as CodigoAmbiente,
    modalidad: Number(env('SIAT_MODALIDAD')) as CodigoModalidad,
    nit: env('SIAT_NIT'),
    codigoSistema: env('SIAT_CODIGO_SISTEMA'),
    token: env('SIAT_TOKEN'),
    baseUrl: env('SIAT_BASE_URL'),
  });
  const pv = {
    codigoSucursal: Number(env('SIAT_CODIGO_SUCURSAL')),
    codigoPuntoVenta: Number(env('SIAT_CODIGO_PUNTO_VENTA')),
  };

  console.log('1) verificarComunicacion…');
  console.dir(await client.verificarComunicacion(), { depth: 5 });

  console.log('2) CUIS…');
  const cuis = await client.cuis(pv);
  console.dir(cuis, { depth: 5 });
  if (!cuis?.codigo) throw new Error('No se obtuvo CUIS (revisar token, NIT, código de sistema y modalidad)');

  console.log('3) CUFD…');
  const cufd = await client.cufd(pv, cuis.codigo);
  console.dir(cufd, { depth: 5 });
  if (!cufd?.codigo) throw new Error('No se obtuvo CUFD');

  const cuf = buildCuf({
    nit: env('SIAT_NIT'),
    fechaEmision: new Date(),
    codigoSucursal: pv.codigoSucursal,
    codigoModalidad: Number(env('SIAT_MODALIDAD')),
    tipoEmision: TipoEmision.EnLinea,
    tipoFacturaDocumento: TipoFacturaDocumento.ConCreditoFiscal,
    tipoDocumentoSector: TipoDocumentoSector.CompraVenta,
    numeroFactura: 1,
    codigoPuntoVenta: pv.codigoPuntoVenta,
    codigoControl: cufd.codigoControl,
  });
  console.log('   CUF de prueba:', cuf);

  if (process.argv.includes('--firmar')) {
    const p12Path = env('SIAT_P12_PATH');
    if (!existsSync(p12Path)) throw new Error(`No existe ${p12Path}`);
    const firma = cargarP12(readFileSync(p12Path), env('SIAT_P12_PASSWORD', false));
    console.log(`4) Firma de ${firma.titular}, vence ${firma.validoHasta.toISOString().slice(0, 10)}`);
    // XML mínimo solo para probar la firma; el XML real sigue el XSD de facturaElectronicaCompraVenta
    const xml = `<?xml version="1.0" encoding="UTF-8"?><facturaElectronicaCompraVenta><cabecera><nitEmisor>${env('SIAT_NIT')}</nitEmisor><cuf>${cuf}</cuf></cabecera></facturaElectronicaCompraVenta>`;
    const firmado = firmarXml(xml, firma);
    const paquete = empaquetarArchivo(firmado);
    console.log(`   XML firmado (${firmado.length} caracteres), gzip ${paquete.bytes} bytes, hash ${paquete.hashArchivo}`);
  }

  console.log('\n✓ Spike SIAT completo. Siguiente: armar el XML según el XSD y llamar a recepcionFactura (ServicioFacturacionCompraVenta).');
}

main().catch((err) => {
  console.error('\n✗ Spike SIAT falló:', err?.message ?? err);
  if (err?.root?.Envelope) console.dir(err.root.Envelope, { depth: 6 });
  process.exit(1);
});
