/**
 * Set de íconos de línea 24×24, trazo 1.8, extremos redondeados (design-system.md §3.10).
 * Dibujos propios y simples; cuando la librería de Figma publique los IconGlyph definitivos,
 * reemplazar los trazos aquí sin tocar los componentes.
 */
export interface IconDef {
  d: string[];
  circles?: [number, number, number][];
}

export const ICONS = {
  home: { d: ['M3 11.5 12 4l9 7.5', 'M5.5 10v9.5h13V10'] },
  sales: {
    d: ['M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.3h8.2a1.5 1.5 0 0 0 1.5-1.2L20 8H6.2'],
    circles: [
      [9.5, 20, 1.2],
      [17, 20, 1.2],
    ],
  },
  invoicing: { d: ['M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M10 13h6', 'M10 17h6'] },
  inventory: { d: ['M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z', 'M3.5 7.5 12 12l8.5-4.5', 'M12 12v9'] },
  purchases: {
    d: ['M2.5 6.5h11v9.5h-11z', 'M13.5 10h4l3 3v3h-7'],
    circles: [
      [6.5, 18.5, 1.6],
      [17, 18.5, 1.6],
    ],
  },
  crm: {
    d: ['M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5', 'M16 4.3a3.5 3.5 0 0 1 0 6.4', 'M18 14.8c1.9.7 3.2 2.5 3.5 5.2'],
    circles: [[9, 7.5, 3.5]],
  },
  accounting: {
    d: ['M6 3h12v18H6z', 'M9 7h6', 'M9 11h.01', 'M12 11h.01', 'M15 11h.01', 'M9 15h.01', 'M12 15h.01', 'M15 15h.01', 'M9 18h6'],
  },
  reports: { d: ['M4 20h16', 'M7 16v-5', 'M12 16V6', 'M17 16v-8'] },
  store: { d: ['M5 8h14l-1 12H6z', 'M9 8V6.5a3 3 0 0 1 6 0V8'] },
  settings: {
    d: ['M4 6h10', 'M18 6h2', 'M4 12h4', 'M12 12h8', 'M4 18h12', 'M20 18h0'],
    circles: [
      [16, 6, 2],
      [10, 12, 2],
      [18, 18, 2],
    ],
  },
  search: { d: ['M16 16l4.5 4.5'], circles: [[11, 11, 6.5]] },
  bell: { d: ['M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'] },
  branch: { d: ['M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z'], circles: [[12, 9.5, 2.5]] },
  'chevron-down': { d: ['M6 9l6 6 6-6'] },
  'chevron-right': { d: ['M9 6l6 6-6 6'] },
  'arrow-right': { d: ['M5 12h14', 'M13 6l6 6-6 6'] },
  'arrow-up-right': { d: ['M7 17 17 7', 'M8 7h9v9'] },
  logout: { d: ['M10 4H5v16h5', 'M15 8l4 4-4 4', 'M19 12H9'] },
  user: { d: ['M4.5 20c.8-3.6 3.8-6 7.5-6s6.7 2.4 7.5 6'], circles: [[12, 8, 4]] },
  alert: { d: ['M12 3 2.5 20h19z', 'M12 10v4', 'M12 17h.01'] },
  check: { d: ['M5 12.5l4.5 4.5L19 7.5'] },
  plus: { d: ['M12 5v14', 'M5 12h14'] },
  close: { d: ['M6 6l12 12', 'M18 6 6 18'] },
  menu: { d: ['M4 7h16', 'M4 12h16', 'M4 17h16'] },
  eye: { d: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'], circles: [[12, 12, 3]] },
  cart: {
    d: ['M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.3h8.2a1.5 1.5 0 0 0 1.5-1.2L20 8H6.2'],
    circles: [
      [9.5, 20, 1.2],
      [17, 20, 1.2],
    ],
  },
  phone: { d: ['M5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 7.5 7.5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A17 17 0 0 1 3 5.5a2 2 0 0 1 2-2z'] },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;
