import { HttpClient } from '@angular/common/http';
import { skipAuthRetry } from './auth/http-context';
import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import type { ContextResponse } from '@rodasoft/domain';
import { ALL_BRANCHES } from '@rodasoft/ui';
import { firstValueFrom } from 'rxjs';
import { TenantService } from './tenant.service';

interface ContextState {
  context: ContextResponse | null;
  branchId: string;
}

const storageKey = (slug: string) => `rs:${slug}:branch`;

const readBranch = (slug: string): string | null => {
  try {
    return localStorage.getItem(storageKey(slug));
  } catch {
    return null;
  }
};

/**
 * Working context: company (fixed), selected branch, role and permissions.
 * The selected branch is remembered per company in this browser (convenience only).
 */
export const ContextStore = signalStore(
  { providedIn: 'root' },
  withState<ContextState>({ context: null, branchId: ALL_BRANCHES }),
  withComputed(({ context, branchId }) => ({
    company: computed(() => context()?.company ?? null),
    branches: computed(() => context()?.branches ?? []),
    permissions: computed<ReadonlySet<string>>(() => new Set(context()?.permissions ?? [])),
    /** ContextBar Branch=All only if the role can see several branches */
    canViewAll: computed(() => (context()?.branches.length ?? 0) > 1),
    currentBranch: computed(() => context()?.branches.find((b) => b.id === branchId()) ?? null),
  })),
  withMethods((store, http = inject(HttpClient), tenant = inject(TenantService)) => ({
    async load() {
      const context = await firstValueFrom(http.get<ContextResponse>('/api/v1/context', { context: skipAuthRetry() }));
      const saved = readBranch(tenant.slug);
      const valid = saved === ALL_BRANCHES || context.branches.some((b) => b.id === saved);
      const branchId =
        valid && saved ? saved : context.branches.length === 1 ? context.branches[0].id : ALL_BRANCHES;
      patchState(store, { context, branchId });
      tenant.setBrand(context.company.brand);
    },
    setBranch(id: string) {
      patchState(store, { branchId: id });
      try {
        localStorage.setItem(storageKey(tenant.slug), id);
      } catch {
        /* storage unavailable */
      }
    },
    can(permission: string) {
      return store.permissions().has(permission);
    },
    reset() {
      patchState(store, { context: null, branchId: ALL_BRANCHES });
    },
  })),
);
