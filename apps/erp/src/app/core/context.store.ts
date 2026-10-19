import { HttpClient } from '@angular/common/http';
import { skipAuthRetry } from './auth/http-context';
import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import type { ContextoResponse } from '@rodasoft/domain';
import { TODAS_LAS_SUCURSALES } from '@rodasoft/ui';
import { firstValueFrom } from 'rxjs';
import { TenantService } from './tenant.service';

interface ContextState {
  contexto: ContextoResponse | null;
  sucursalId: string;
}

const storageKey = (slug: string) => `rs:${slug}:sucursal`;

const readSucursal = (slug: string): string | null => {
  try {
    return localStorage.getItem(storageKey(slug));
  } catch {
    return null;
  }
};

/**
 * Contexto de trabajo: empresa (fija), sucursal elegida, rol y permisos.
 * La sucursal elegida se recuerda por empresa en este navegador (solo comodidad).
 */
export const ContextStore = signalStore(
  { providedIn: 'root' },
  withState<ContextState>({ contexto: null, sucursalId: TODAS_LAS_SUCURSALES }),
  withComputed(({ contexto, sucursalId }) => ({
    empresa: computed(() => contexto()?.empresa ?? null),
    sucursales: computed(() => contexto()?.sucursales ?? []),
    permisos: computed<ReadonlySet<string>>(() => new Set(contexto()?.permisos ?? [])),
    /** ContextBar Branch=All solo si el rol puede ver varias sucursales */
    puedeVerTodas: computed(() => (contexto()?.sucursales.length ?? 0) > 1),
    sucursalActual: computed(() => contexto()?.sucursales.find((s) => s.id === sucursalId()) ?? null),
  })),
  withMethods((store, http = inject(HttpClient), tenant = inject(TenantService)) => ({
    async load() {
      const contexto = await firstValueFrom(http.get<ContextoResponse>('/api/v1/contexto', { context: skipAuthRetry() }));
      const saved = readSucursal(tenant.slug);
      const valid = saved === TODAS_LAS_SUCURSALES || contexto.sucursales.some((s) => s.id === saved);
      const sucursalId =
        valid && saved ? saved : contexto.sucursales.length === 1 ? contexto.sucursales[0].id : TODAS_LAS_SUCURSALES;
      patchState(store, { contexto, sucursalId });
      tenant.setBrand(contexto.empresa.brand);
    },
    setSucursal(id: string) {
      patchState(store, { sucursalId: id });
      try {
        localStorage.setItem(storageKey(tenant.slug), id);
      } catch {
        /* almacenamiento no disponible */
      }
    },
    can(permission: string) {
      return store.permisos().has(permission);
    },
    reset() {
      patchState(store, { contexto: null, sucursalId: TODAS_LAS_SUCURSALES });
    },
  })),
);
