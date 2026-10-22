# SIAT spike (S0)

End-to-end test against the SIN **pilot environment** before building Invoicing.

## Requirements (provided by the client / the accountant)
1. System registered in the online SIAT (Mis sistemas) for the **Electronic Online** modality → `SIAT_SYSTEM_CODE`.
2. **Delegated token** of the pilot environment → `SIAT_TOKEN`.
3. Company NIT → `SIAT_NIT`; branch 0 and point of sale 0 to start (`SIAT_BRANCH_CODE`, `SIAT_POINT_OF_SALE_CODE`).
4. **Digital signature** certificate `.p12` and its password (copied to `./secrets/firma.p12`, git-ignored folder).

## Run
```bash
cp .env.example .env   # fill in the SIAT_* variables
pnpm siat:spike          # communication + CUIS + CUFD + CUF
pnpm siat:spike --sign   # also signs an XML with the .p12
```

## Definition of done
- [ ] `verificarComunicacion` answers `transaccion: true`.
- [ ] A CUIS and a CUFD are obtained for point of sale 0.
- [ ] An XML is signed with the company's signature.
- [ ] (S1) `recepcionFactura` accepts a purchase-sale invoice and `verificacionEstadoFactura` returns it as valid.
- [ ] The SIN's official example case is added to `libs/siat/src/lib/cuf.spec.ts`.

> URLs, method names and signature parameters come from the SIN technical specification; if the SIN publishes a new version, adjust `libs/siat` and its tests.
