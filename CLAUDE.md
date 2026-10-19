# Guía para agentes (Claude Code / Cowork)

Proyecto Rodasoft: ERP + SIAT + tienda + web de Rodalaser S.R.L. Leer `README.md` primero.

## Convenciones
- Idioma: UI, mensajes de error, comentarios y nombres de dominio en **español (Bolivia)**; nombres técnicos (clases, archivos) en inglés o español según el módulo, sin mezclar dentro de un mismo archivo.
- Angular: componentes standalone, `ChangeDetectionStrategy.OnPush`, `input()`/`model()`/`signal()`, control flow `@if/@for`, selector con prefijo `rs-`. Nada de `NgModule`.
- Componentes visuales nuevos van en `libs/ui` y deben corresponder 1:1 a un componente de la librería de Figma "Design System". Solo tokens (`var(--…)`), sin colores ni espaciados sueltos.
- NestJS: un módulo por dominio en `apps/api/src/modules/<modulo>`; consultas de negocio con `prisma.tenant`; permisos con `@RequirePermissions`; efectos secundarios con `OutboxService.publish(…, { tx })`.
- Dinero con `Decimal` de `@rodasoft/domain`, nunca `number`. Fechas en BD con `timestamptz`; zona de negocio `America/La_Paz`.
- Cambios de estado de documentos solo mediante las máquinas de `libs/domain/src/lib/state-machine.ts`, auditados con `AuditService`.
- Cada historia del backlog (HU-xxx) que se implementa se menciona en el commit.

## Antes de terminar una tarea
`pnpm nx affected -t lint typecheck test` sin errores.
