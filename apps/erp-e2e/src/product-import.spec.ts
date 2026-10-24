import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { login } from './support/auth';

/**
 * HU-INV-10 · Excel import (IN-21a, IN-21b). Needs the demo data from `pnpm db:seed`: the SKF brand and the
 * "Lubricantes y grasas" category, whose technical fields are material and main measure (both required).
 * The workbook is built here, so no binary fixture is kept in the repository. Codes carry a timestamp so the flow can run again.
 */

const stamp = () => `E2E${Date.now()}`;

async function workbook(rows: (string | number | null)[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Productos');
  sheet.addRow(['Código', 'Marca', 'Categoría', 'Precio', 'material', 'mainMeasure']);
  rows.forEach((r) => sheet.addRow(r));
  return Buffer.from(await book.xlsx.writeBuffer());
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('imports a file: the errors show before anything is written, then only the valid rows are created', async ({ page }) => {
  const code = stamp();
  const file = await workbook([
    [`${code}-A`, 'SKF', 'Lubricantes y grasas', 80, 'Aluminio', '1 L'],
    [`${code}-B`, 'SKF', 'Lubricantes y grasas', 95.5, 'Acero', '2 L'],
    [`${code}-C`, 'MarcaInexistente', 'Lubricantes y grasas', 10, 'Aluminio', '1 L'],
    [`${code}-D`, 'SKF', 'Lubricantes y grasas', null, 'Aluminio', '1 L'],
  ]);

  await page.goto('/inventory/products');
  // the button sits right before Exportar
  const actions = page.locator('.header-actions > button');
  await expect(actions.nth(0)).toHaveText(/Importar/);
  await expect(actions.nth(1)).toHaveText(/Exportar/);
  await actions.nth(0).click();

  // IN-21a · upload: nothing can be reviewed without a file
  const dialog = page.getByRole('dialog', { name: 'Importar productos' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Revisar' })).toBeDisabled();
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'productos.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: file,
  });
  await expect(dialog.getByText('productos.xlsx')).toBeVisible();
  await dialog.getByRole('button', { name: 'Revisar' }).click();

  // IN-21b · preview: the rows, the errors and the counters; the catalog is still untouched
  const preview = page.getByRole('dialog', { name: 'Revisa la importación' });
  await expect(preview).toBeVisible();
  await expect(preview.getByText('Marca no existe')).toBeVisible();
  await expect(preview.getByText('Falta el precio de venta')).toBeVisible();
  await expect(preview.getByText('Solo se importarán las filas válidas.')).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Descargar errores' })).toBeVisible();
  await page.goto(`/inventory/products?search=${code}`);
  await expect(page.getByText(`${code}-A`)).toHaveCount(0);

  // the same flow again, this time confirming
  await page.locator('.header-actions > button').first().click();
  const again = page.getByRole('dialog', { name: 'Importar productos' });
  await again.locator('input[type=file]').setInputFiles({
    name: 'productos.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: file,
  });
  await again.getByRole('button', { name: 'Revisar' }).click();
  await page.getByRole('button', { name: 'Importar 2 productos' }).click();

  await expect(page.getByText('2 productos importados (2 omitidos)')).toBeVisible();
  await expect(page.getByText(`${code}-A`)).toBeVisible();
  await expect(page.getByText(`${code}-B`)).toBeVisible();
  await expect(page.getByText(`${code}-C`)).toHaveCount(0);
  await expect(page.getByText(`${code}-D`)).toHaveCount(0);
});
