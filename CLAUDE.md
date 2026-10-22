# Guía para agentes (Claude Code / Cowork)

Proyecto Rodasoft: ERP + SIAT + tienda + web de Rodalaser S.R.L. Leer `README.md` primero.

## Convenciones
- **Código en inglés, UI en español (Bolivia).** Identificadores, archivos, tablas/columnas, campos de DTO y respuestas, códigos de error, claves de permisos, rutas del ERP, logs, tests y **comentarios** van en inglés. Solo el contenido visible para el usuario (etiquetas, botones, mensajes, correos) va en español, tal como en el diseño de Figma. Detalle y glosario: `docs/naming-conventions.md`. Excepción: términos oficiales del SIAT/SIN (`SIAT`, `NIT`, `CUF`, `CUFD`, `CUIS`) y los nombres de campos del contrato SOAP del SIN.
- Angular: componentes standalone, `ChangeDetectionStrategy.OnPush`, `input()`/`model()`/`signal()`, control flow `@if/@for`, selector con prefijo `rs-`. Nada de `NgModule`.
- UI: todo componente visual vive en `libs/ui` y corresponde 1:1 a un componente del Figma "Design System" (file key `O7gJBRq4bMcWBGP1DMUKkw`). Solo tokens (`var(--…)`, espejo de las variables de Figma), sin hex ni espaciados sueltos. Estados (hover/pressed/focus) son CSS, no inputs. Ver `docs/ui-library.md`.
- Componentes de `libs/ui`: **lógica, HTML y estilos van en archivos separados** — `<name>.component.ts` (solo lógica), `<name>.component.html` (`templateUrl`) y `<name>.component.scss` (`styleUrl`), más `<name>.component.spec.ts`. Nada de `template:` ni `styles:` inline en el decorador (los specs pueden usar `template` inline para sus hosts de prueba). Si un archivo define varios componentes, cada uno lleva sus archivos con el nombre de su selector (`radio-group.component.html`). Todos esos archivos, sus nombres, clases y comentarios van en inglés; solo el texto visible de la plantilla va en español.
- NestJS: un módulo por dominio en `apps/api/src/modules/<module>`; consultas de negocio con `prisma.tenant`; permisos con `@RequirePermissions`; efectos secundarios con `OutboxService.publish(…, { tx })`.
- Base de datos: tablas en plural snake_case, columnas snake_case (`@map`), modelos en singular PascalCase.
- Dinero con `Decimal` de `@rodasoft/domain`, nunca `number`. Fechas en BD con `timestamptz`; zona de negocio `America/La_Paz`.
- Cambios de estado de documentos solo mediante las máquinas de `libs/domain/src/lib/state-machine.ts`, auditados con `AuditService`.
- Cada historia del backlog (HU-xxx) que se implementa se menciona en el commit.

## Antes de terminar una tarea
`pnpm nx affected -t lint typecheck test` sin errores.
