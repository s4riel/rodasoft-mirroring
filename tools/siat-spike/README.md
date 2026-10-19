# Spike SIAT (S0)

Prueba de punta a punta contra el **ambiente piloto** del SIN antes de construir Facturación.

## Requisitos (los entrega el cliente / el contador)
1. Sistema registrado en el SIAT en línea (Mis sistemas) para la modalidad **Electrónica en Línea** → `SIAT_CODIGO_SISTEMA`.
2. **Token delegado** del ambiente piloto → `SIAT_TOKEN`.
3. NIT de la empresa → `SIAT_NIT`; sucursal 0 y punto de venta 0 para empezar.
4. Certificado de **firma digital** `.p12` y su contraseña (se copia a `./secrets/firma.p12`, carpeta ignorada por git).

## Ejecutar
```bash
cp .env.example .env   # completar las variables SIAT_*
pnpm siat:spike          # comunicación + CUIS + CUFD + CUF
pnpm siat:spike --firmar # además firma un XML con el .p12
```

## Criterio de "hecho"
- [ ] `verificarComunicacion` responde `transaccion: true`.
- [ ] Se obtiene CUIS y CUFD para el punto de venta 0.
- [ ] Se firma un XML con la firma de la empresa.
- [ ] (S1) `recepcionFactura` acepta una factura de compra-venta y `verificacionEstadoFactura` la devuelve válida.
- [ ] Caso del ejemplo oficial del SIN agregado a `libs/siat/src/lib/cuf.spec.ts`.

> Las URLs, los nombres de métodos y los parámetros de firma salen de la especificación técnica del SIN; si el SIN publica una versión nueva, ajustar `libs/siat` y sus pruebas.
