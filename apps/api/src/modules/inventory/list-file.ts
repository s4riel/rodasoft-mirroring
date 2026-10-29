import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { TRANSFER_FILE_MAX_BYTES } from '@rodasoft/domain';
import ExcelJS from 'exceljs';

/** A file uploaded with a product list (multer's memory storage). */
export interface ListUploadFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** A sheet with more rows than this is not a product list; it also keeps a far-away cell from making the reader walk empty rows. */
const SHEET_ROW_CEILING = 20_000;

/**
 * The text of an uploaded list: an .xlsx gives its first sheet's first `columns` columns, one tab-separated line per row;
 * anything else is read as CSV text, which the paste parsers split the same way as a paste.
 */
export async function readListFile(file: ListUploadFile, columns: number): Promise<string> {
  if (file.size > TRANSFER_FILE_MAX_BYTES || file.buffer.length > TRANSFER_FILE_MAX_BYTES) {
    throw new PayloadTooLargeException({ code: 'FILE_TOO_LARGE', message: 'The file is larger than the limit' });
  }
  if (file.buffer.length >= ZIP_MAGIC.length && file.buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException({ code: 'FILE_INVALID', message: 'The file cannot be read as an Excel workbook' });
    }
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount > SHEET_ROW_CEILING) {
      throw new BadRequestException({ code: 'FILE_INVALID', message: 'The sheet is empty or too long' });
    }
    const lines: string[] = [];
    for (let n = 1; n <= sheet.rowCount; n++) {
      const row = sheet.getRow(n);
      const cells = Array.from({ length: columns }, (_, i) => cellText(row.getCell(i + 1).value));
      // trailing empty cells are dropped so an optional column left blank does not leave a dangling separator
      while (cells.length > 2 && cells[cells.length - 1] === '') cells.pop();
      if (cells.some((c) => c !== '')) lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  }
  if (file.buffer.includes(0)) {
    throw new BadRequestException({ code: 'FILE_INVALID', message: 'Only .xlsx and .csv files are accepted' });
  }
  const text = file.buffer.toString('utf8');
  // a BOM is how Excel marks a UTF-8 CSV; it is not part of the first code
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** A cell as the text the user sees: numbers lose Excel's float noise, formulas give their result, rich text is joined. */
function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ('richText' in value) return value.richText.map((part) => part.text).join('').trim();
  if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
  if ('text' in value) return String(value.text).trim();
  return '';
}
