/**
 * SIAT spike - week S0 (project risk no. 1).
 * Goal: prove against the PILOT environment that we can
 *   1) talk to the SIN,  2) obtain a CUIS,  3) obtain a CUFD,
 *   4) sign an XML with the company's digital signature and compute the CUF.
 *
 * Usage:  pnpm siat:spike          (reads the SIAT_* variables from .env)
 *         pnpm siat:spike --sign   (also tests signing with the .p12)
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  buildCuf,
  EmissionType,
  EnvironmentCode,
  InvoiceDocumentType,
  loadP12,
  ModalityCode,
  packageFile,
  SectorDocumentType,
  signXml,
  SiatCodesClient,
} from '../../libs/siat/src';

const env = (k: string, required = true): string => {
  const v = process.env[k] ?? '';
  if (required && !v) {
    console.error(`✗ Missing variable ${k} in .env`);
    process.exit(1);
  }
  return v;
};

async function main() {
  const client = new SiatCodesClient({
    environment: Number(env('SIAT_ENVIRONMENT')) as EnvironmentCode,
    modality: Number(env('SIAT_MODALITY')) as ModalityCode,
    nit: env('SIAT_NIT'),
    systemCode: env('SIAT_SYSTEM_CODE'),
    token: env('SIAT_TOKEN'),
    baseUrl: env('SIAT_BASE_URL'),
  });
  const pv = {
    branchCode: Number(env('SIAT_BRANCH_CODE')),
    pointOfSaleCode: Number(env('SIAT_POINT_OF_SALE_CODE')),
  };

  console.log('1) verifyCommunication…');
  console.dir(await client.verifyCommunication(), { depth: 5 });

  console.log('2) CUIS…');
  const cuis = await client.cuis(pv);
  console.dir(cuis, { depth: 5 });
  if (!cuis?.code) throw new Error('Could not obtain a CUIS (check token, NIT, system code and modality)');

  console.log('3) CUFD…');
  const cufd = await client.cufd(pv, cuis.code);
  console.dir(cufd, { depth: 5 });
  if (!cufd?.code) throw new Error('Could not obtain a CUFD');

  const cuf = buildCuf({
    nit: env('SIAT_NIT'),
    issuedAt: new Date(),
    branchCode: pv.branchCode,
    modalityCode: Number(env('SIAT_MODALITY')),
    emissionType: EmissionType.Online,
    invoiceDocumentType: InvoiceDocumentType.WithTaxCredit,
    sectorDocumentType: SectorDocumentType.PurchaseSale,
    invoiceNumber: 1,
    pointOfSaleCode: pv.pointOfSaleCode,
    controlCode: cufd.controlCode,
  });
  console.log('   Test CUF:', cuf);

  if (process.argv.includes('--sign')) {
    const p12Path = env('SIAT_P12_PATH');
    if (!existsSync(p12Path)) throw new Error(`${p12Path} does not exist`);
    const signature = loadP12(readFileSync(p12Path), env('SIAT_P12_PASSWORD', false));
    console.log(`4) Signature of ${signature.holder}, expires ${signature.validUntil.toISOString().slice(0, 10)}`);
    // Minimal XML just to test the signature; the real XML follows the facturaElectronicaCompraVenta XSD
    const xml = `<?xml version="1.0" encoding="UTF-8"?><facturaElectronicaCompraVenta><cabecera><nitEmisor>${env('SIAT_NIT')}</nitEmisor><cuf>${cuf}</cuf></cabecera></facturaElectronicaCompraVenta>`;
    const signed = signXml(xml, signature);
    const pkg = packageFile(signed);
    console.log(`   Signed XML (${signed.length} characters), gzip ${pkg.bytes} bytes, hash ${pkg.fileHash}`);
  }

  console.log('\n✓ SIAT spike complete. Next: build the XML per the XSD and call recepcionFactura (ServicioFacturacionCompraVenta).');
}

main().catch((err) => {
  console.error('\n✗ SIAT spike failed:', err?.message ?? err);
  if (err?.root?.Envelope) console.dir(err.root.Envelope, { depth: 6 });
  process.exit(1);
});
