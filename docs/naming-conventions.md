# Naming conventions (English-only code)

**Rule:** everything that is code is in English: identifiers, file and folder names, DB tables/columns/enums,
DTO and response fields, error codes, permission keys, ERP route paths, log messages, tests and comments.
**Only user-facing content is Spanish (Bolivia)**: text rendered in the UI, e-mail bodies, and display labels
(`name` of default roles, permission `description`, seed display names such as branch names).
API error `message` is English; the ERP translates by `code` (see `apps/erp/src/app/core/api-error.ts`).

Official Bolivian/SIAT terms stay as they are because they are proper nouns, not Spanish words to translate:
`SIAT`, `SIN`, `NIT`, `CUF`, `CUFD`, `CUIS`, `CAFC`, `XMLDSig`. The field holding a NIT is `nit`.

## Domain glossary

| Spanish | English | Notes |
|---|---|---|
| empresa | company | `Company`, `companyId`, `company_id`, header `x-company`, slug `company2` (was `empresa2`) |
| sucursal | branch | `Branch`, `branchId`; SIN branch number is `code` |
| almacén | warehouse | `Warehouse`, `warehouseId`, `isMain`, `visibleInStore` |
| usuario | user | `User` |
| membresía | membership | `Membership`, `MembershipBranch`, `allBranches` |
| rol / permiso | role / permission | `Role`, `Permission`, `RolePermission` |
| razón social / nombre comercial | legal name / trade name | `legalName`, `tradeName` |
| clave | key | role `key` (`admin`, `management`, `cashier`, `warehouse`, `accountant`) |
| nombre / descripción | name / description | |
| código | code | |
| estado | status | enum `RecordStatus { ACTIVE, INACTIVE }` |
| moneda / zona horaria | currency / timezone | |
| dirección, ciudad, teléfono, latitud, longitud | address, city, phone, latitude, longitude | |
| punto de venta (SIAT) | point of sale | `SiatPointOfSale` |
| configuración SIAT | SIAT settings | `SiatSettings`; `environment` (`PRODUCTION`/`TEST`), `modality` (`ELECTRONIC_ONLINE`/`COMPUTERIZED_ONLINE`), `systemCode`, `tokenEncrypted`, `tokenExpiresAt`, `signatureP12Encrypted`, `signaturePasswordEncrypted`, `signatureExpiresAt`, `signatureHolder` |
| cufd código de control / dirección / vence | `cufdControlCode`, `cufdAddress`, `cufdExpiresAt`, `cuisExpiresAt`, `lastSyncedAt` | |
| auditoría | audit | `AuditLog { action, entity, entityId, before, after }` |
| outbox | outbox | `OutboxEvent { type, payload, idempotencyKey, attempts, availableAt, processedAt, error }` |
| familia (refresh) | family | `familyId` |
| expira / usado / revocado en | `expiresAt`, `usedAt`, `revokedAt` | |
| último acceso | `lastLoginAt` | |
| invitado por | `invitedBy` | |
| descuento máximo | `maxDiscount` | |
| transferencia / factura | transfer / invoice | |
| compras / ventas / facturación / inventario / contabilidad / tienda / reportes / configuración | purchasing / sales / invoicing / inventory / accounting / store / reports / settings | module names, permission prefixes, routes, folders |
| inicio | home | |

## Database

- Tables: **plural snake_case** (`companies`, `branches`, `warehouses`, `users`, `memberships`, `membership_branches`,
  `roles`, `permissions`, `role_permissions`, `refresh_tokens`, `password_resets`, `siat_settings`,
  `siat_points_of_sale`, `audit_logs`, `outbox_events`). Plural avoids the reserved word `user`.
- Columns: snake_case via `@map`; Prisma fields camelCase. Models singular PascalCase.
- Every business table has `company_id`. Money `Decimal(14,2)`; costs and exchange rates `Decimal(14,4)`.

## Permission keys

`<module>.<resource>.<action>` in English, kebab-case inside segments:
`settings.company.view`, `inventory.products.edit`, `sales.cancellations.approve`, `invoicing.nit-exception.approve`,
`purchasing.orders.approve`, `crm.customers.view`, `accounting.entries.create`, `store.orders.manage`, `reports.view`, `audit.view`.

## Routes

- ERP paths are English: `/login`, `/forgot-password`, `/reset-password`, `/auth/callback`, `/sales`, `/invoicing`,
  `/inventory`, `/purchasing`, `/crm`, `/accounting`, `/store`, `/reports`, `/settings`.
- Public website paths (`apps/web`) stay Spanish because they are content and SEO (`/rodamientos`, `/tienda`, …);
  their file/class names are English.
- API paths are English and versioned: `/api/v1/auth/login`, `/api/v1/context`, `/api/v1/companies/current`.

## Error codes (API `code`)

`UPPER_SNAKE_CASE`, English: `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED`, `INVALID_SESSION`, `INVALID_LINK`,
`INVALID_CODE`, `COMPANY_REQUIRED`, `COMPANY_NOT_FOUND`, `COMPANY_MISMATCH`, `NO_ACCESS`, `NO_PERMISSION`,
`CONCURRENT_REFRESH`, `GOOGLE_NOT_CONFIGURED`, `GOOGLE_CANCELLED`, `GOOGLE_STATE`, `GOOGLE_ERROR`,
`INVALID_TRANSITION`, `NOT_FOUND`.

## State machines (`libs/domain`)

- `TransferStatus`: `DRAFT, PENDING_APPROVAL, APPROVED, IN_TRANSIT, PARTIALLY_RECEIVED, RECEIVED, REJECTED, CANCELLED`
  events `send, requestApproval, approve, reject, dispatch, receivePartial, receiveAll, cancel`; `transferMachine`.
- `InvoiceStatus`: `PENDING, SENDING, VALID, REJECTED, CONTINGENCY, OBSERVED, CANCELLATION_PENDING, CANCELLED`
  events `send, accept, reject, offline, packageValidated, packageObserved, fix, requestCancellation, approveCancellation, rejectCancellation`; `invoiceMachine`.

## Exported names that changed in `@rodasoft/domain`

`EMPRESA_HEADER→COMPANY_HEADER`, `EmpresaContexto→CompanyContext`, `SucursalContexto→BranchContext`,
`isValidEmpresaSlug→isValidCompanySlug`, `empresaSlugFromHost→companySlugFromHost`,
`UsuarioActual→CurrentUser`, `SesionResponse→SessionResponse`, `ContextoResponse→ContextResponse`
(`usuario→user, empresa→company, sucursales→branches, rol→role, permisos→permissions`),
`DEFAULT_ROLES[key] = { name, permissions }`, `transferenciaMachine→transferMachine`, `facturaMachine→invoiceMachine`,
`EstadoTransferencia→TransferStatus`, `EventoTransferencia→TransferEvent`, `EstadoFactura→InvoiceStatus`, `EventoFactura→InvoiceEvent`.
`SessionResponse = { accessToken, expiresIn, user }`; `CurrentUser = { id, email, name, avatarUrl }`;
`CompanyContext = { id, slug, legalName, tradeName, nit, brand }`; `BranchContext = { id, code, name, warehouses: {id, code, name}[] }`;
`BrandMode = 'rodalaser' | 'company2'`.

## UI (Angular)

- Selector prefix `rs-`; component class names English (`LoginPage`, `ForgotPasswordPage`, `HomePage`).
- Inputs/outputs of `libs/ui` components are English and mirror the Figma component properties (see `docs/ui-library.md`).
- Visible text (labels, buttons, placeholders, messages) is Spanish, exactly as in the Figma design.
