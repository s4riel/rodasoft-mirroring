import forge from 'node-forge';

/** A self-signed PKCS#12 bundle for tests: holder `commonName`, valid from yesterday until `validUntil`. */
export function buildTestP12(password: string, validUntil: Date, commonName = 'Rodalaser Test'): Buffer {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000 * 2);
  cert.validity.notAfter = validUntil;
  const attrs = [{ name: 'commonName', value: commonName }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}
