import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

/**
 * "Enveloped" XMLDSig signature using the company's digital-signature certificate (.p12).
 * Parameters follow the SIN specification for the Electronic Online modality:
 *   - RSA-SHA256, SHA-256 digest
 *   - Inclusive C14N canonicalization with comments, reference URI=""
 * WARNING: verify against the current specification and with the pilot environment validator.
 */
export interface DigitalSignature {
  privateKeyPem: string;
  certificatePem: string;
  /** Certificate expiry date (30-day warning in FS-31) */
  validUntil: Date;
  holder: string;
}

export function loadP12(p12: Buffer, password: string): DigitalSignature {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12.toString('binary')));
  const pkcs12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  const keyBag =
    pkcs12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    pkcs12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  const certBag = pkcs12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0];
  if (!keyBag?.key || !certBag?.cert) throw new Error('The .p12 file does not contain a private key and certificate');
  const cn = certBag.cert.subject.getField('CN');
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
    certificatePem: forge.pki.certificateToPem(certBag.cert),
    validUntil: certBag.cert.validity.notAfter,
    holder: cn ? String(cn.value) : '',
  };
}

const C14N_WITH_COMMENTS = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315#WithComments';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

export function signXml(xml: string, signature: DigitalSignature): string {
  const sig = new SignedXml({
    privateKey: signature.privateKeyPem,
    publicCert: signature.certificatePem,
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
