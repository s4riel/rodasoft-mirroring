import { Injectable, signal } from '@angular/core';

export type ToastType = 'info' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  type?: ToastType;
  /** Optional bold title (Figma Toast Title). */
  heading?: string;
  message: string;
  /** Auto-dismiss in ms. 0 keeps it until dismissed. Default 5000. */
  duration?: number;
}

export interface ToastItem {
  readonly id: number;
  readonly type: ToastType;
  readonly heading?: string;
  readonly message: string;
  readonly duration: number;
}

export const DEFAULT_TOAST_DURATION = 5000;

/** Signal-based toast queue. Render it once with `<rs-toast-outlet />` (e.g. in the app shell). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly queue = signal<readonly ToastItem[]>([]);
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextId = 1;

  readonly toasts = this.queue.asReadonly();

  show(options: ToastOptions): number {
    const item: ToastItem = {
      id: this.nextId++,
      type: options.type ?? 'info',
      heading: options.heading,
      message: options.message,
      duration: options.duration ?? DEFAULT_TOAST_DURATION,
    };
    this.queue.update((list) => [...list, item]);
    if (item.duration > 0) {
      this.timers.set(
        item.id,
        setTimeout(() => this.dismiss(item.id), item.duration),
      );
    }
    return item.id;
  }

  info(message: string, options: Omit<ToastOptions, 'message' | 'type'> = {}): number {
    return this.show({ ...options, message, type: 'info' });
  }
  success(message: string, options: Omit<ToastOptions, 'message' | 'type'> = {}): number {
    return this.show({ ...options, message, type: 'success' });
  }
  warning(message: string, options: Omit<ToastOptions, 'message' | 'type'> = {}): number {
    return this.show({ ...options, message, type: 'warning' });
  }
  danger(message: string, options: Omit<ToastOptions, 'message' | 'type'> = {}): number {
    return this.show({ ...options, message, type: 'danger' });
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.queue.update((list) => list.filter((t) => t.id !== id));
  }

  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.queue.set([]);
  }
}
