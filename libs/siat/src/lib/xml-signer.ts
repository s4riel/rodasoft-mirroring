import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

/**
 * Firma XMLDSig "enveloped" con el certificado de firma digital de la empresa (.p12).
 * Parámetros según la especificación del SIN para la modalidad Electrónica en Línea:
 *   - RSA-SHA256, digest SHA-256
 *   - Canonicalización C14N inclusiva con comentarios, referencia URI=""
 * ⚠ Verificar contra la versión vigente de la especificación y con el validador del ambiente piloto.
 */
export interface FirmaDigital {
  privateKeyPem: string;
  certificatePem: string;
  /** Fecha de vencimiento del certificado (aviso de 30 días en FS-31) */
  validoHasta: Date;
  titular: string;
}

export function cargarP12(p12: Buffer, password: string): FirmaDigital {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12.toString('binary')));
  const pkcs12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  const keyBag =
    pkcs12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    pkcs12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  const certBag = pkcs12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0];
  if (!keyBag?.key || !certBag?.cert) throw new Error('El archivo .p12 no contiene llave privada y certificado');
  const cn = certBag.cert.subject.getField('CN');
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
    certificatePem: forge.pki.certificateToPem(certBag.cert),
    validoHasta: certBag.cert.validity.notAfter,
    titular: cn ? String(cn.value) : '',
  };
}

const C14N_WITH_COMMENTS = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315#WithComments';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

export function firmarXml(xml: string, firma: FirmaDigital): string {
  const sig = new SignedXml({
    privateKey: firma.privateKeyPem,
    publicCert: firma.certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath: '/*',
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [ENVELOPED, C14N_WITH_COMMENTS],
    isEmptyUri: true,
  });
  sig.computeSignature(xml, { location: { reference: '/*', action: 'append' } });
  return sig.getSignedXml();
}
