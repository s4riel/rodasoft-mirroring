/**
 * Boundary dimensions (d inner diameter, D outer diameter, B width) of standard bearings, derived from their designation.
 * Only metric ISO series are covered (ISO 15 and ISO 355) and only when the designation fits a family AND the product
 * sits in the matching subcategory; anything else (inch tapered, hubs, specials, brand-only codes) returns null and stays
 * in the "pendientes" list instead of being guessed. Tapered bearings give T (total width) as B.
 */

export interface Dimensions {
  d: string;
  D: string;
  B: string;
  /** The table the numbers come from, for the review file. */
  source: string;
}

type Triple = readonly [d: string, D: string, B: string];

/** `"04:20x47x14 05:25x52x15"` -> `{ "04": ["20","47","14"], ... }` (key = bore code or the last digits of the designation). */
function series(entries: string): Record<string, Triple> {
  const out: Record<string, Triple> = {};
  for (const entry of entries.trim().split(/\s+/)) {
    const [key, dims] = entry.split(':');
    const [d, D, B] = dims.split('x');
    out[key] = [d, D, B];
  }
  return out;
}

/** Series 60 (ISO 15, diameter series 0): 6000 … 6030. Also 70xx angular contact. */
const S60 = series(`00:10x26x8 01:12x28x8 02:15x32x9 03:17x35x10 04:20x42x12 05:25x47x12 06:30x55x13 07:35x62x14 08:40x68x15 09:45x75x16
  10:50x80x16 11:55x90x18 12:60x95x18 13:65x100x18 14:70x110x20 15:75x115x20 16:80x125x22 17:85x130x22 18:90x140x24 19:95x145x24
  20:100x150x24 21:105x160x26 22:110x170x28 24:120x180x28 26:130x200x33 28:140x210x33 30:150x225x35`);

/** Series 62 / 12 / 72 / NU2 (diameter series 2): the same boundary dimensions in every family. */
const S02 = series(`00:10x30x9 01:12x32x10 02:15x35x11 03:17x40x12 04:20x47x14 05:25x52x15 06:30x62x16 07:35x72x17 08:40x80x18 09:45x85x19
  10:50x90x20 11:55x100x21 12:60x110x22 13:65x120x23 14:70x125x24 15:75x130x25 16:80x140x26 17:85x150x28 18:90x160x30 19:95x170x32
  20:100x180x34 21:105x190x36 22:110x200x38 24:120x215x40 26:130x230x40 28:140x250x42 30:150x270x45`);

/** Series 63 / 13 / 73 / NU3 (diameter series 3). */
const S03 = series(`00:10x35x11 01:12x37x12 02:15x42x13 03:17x47x14 04:20x52x15 05:25x62x17 06:30x72x19 07:35x80x21 08:40x90x23 09:45x100x25
  10:50x110x27 11:55x120x29 12:60x130x31 13:65x140x33 14:70x150x35 15:75x160x37 16:80x170x39 17:85x180x41 18:90x190x43 19:95x200x45
  20:100x215x47 22:110x240x50 24:120x260x55 26:130x280x58 28:140x300x62 30:150x320x65`);

/** Series 64. */
const S64 = series(`03:17x62x17 04:20x72x19 05:25x80x21 06:30x90x23 07:35x100x25 08:40x110x27 09:45x120x29 10:50x130x31 11:55x140x33 12:60x150x35 13:65x160x37 14:70x180x42`);

/** Series 22 (wide, diameter series 2): 2200 self-aligning, 222xx spherical roller, NU22 cylindrical. */
const S22 = series(`00:10x30x14 01:12x32x14 02:15x35x14 03:17x40x16 04:20x47x18 05:25x52x18 06:30x62x20 07:35x72x23 08:40x80x23 09:45x85x23
  10:50x90x23 11:55x100x25 12:60x110x28 13:65x120x31 14:70x125x31 15:75x130x31 16:80x140x33 17:85x150x36 18:90x160x40 19:95x170x43
  20:100x180x46 22:110x200x53 24:120x215x58`);

/** Series 23 (wide, diameter series 3): 2300 self-aligning, 223xx spherical roller, NU23 cylindrical. */
const S23 = series(`00:10x35x17 01:12x37x17 02:15x42x17 03:17x47x19 04:20x52x21 05:25x62x24 06:30x72x27 07:35x80x31 08:40x90x33 09:45x100x36
  10:50x110x40 11:55x120x43 12:60x130x46 13:65x140x48 14:70x150x51 15:75x160x55 16:80x170x58 17:85x180x60 18:90x190x64 19:95x200x67
  20:100x215x73 22:110x240x80 24:120x260x86`);

const S618 = series(`00:10x19x5 01:12x21x5 02:15x24x5 03:17x26x5 04:20x32x7 05:25x37x7 06:30x42x7 07:35x47x7 08:40x52x7 09:45x58x7 10:50x65x7
  11:55x72x9 12:60x78x10 13:65x85x10 14:70x90x10 15:75x95x10 16:80x100x10 17:85x110x13 18:90x115x13 19:95x120x13 20:100x125x13`);
const S619 = series(`00:10x22x6 01:12x24x6 02:15x28x7 03:17x30x7 04:20x37x9 05:25x42x9 06:30x47x9 07:35x55x10 08:40x62x12 09:45x68x12 10:50x72x12
  11:55x80x13 12:60x85x13 13:65x90x13 14:70x100x16 15:75x105x16 16:80x110x16`);
const S160 = series(`02:15x32x8 03:17x35x8 04:20x42x8 05:25x47x8 06:30x55x9 07:35x62x9 08:40x68x9 09:45x75x10 10:50x80x10 11:55x90x11 12:60x95x11
  13:65x100x11 14:70x110x13 15:75x115x13 16:80x125x14 17:85x130x14 18:90x140x16 20:100x150x16`);
const S622 = series(`00:10x30x14 01:12x32x14 02:15x35x14 03:17x40x16 04:20x47x18 05:25x52x18 06:30x62x20 07:35x72x23 08:40x80x23 09:45x85x23 10:50x90x23`);
const S623 = series(`00:10x35x17 01:12x37x17 02:15x42x17 03:17x47x19 04:20x52x21 05:25x62x24 06:30x72x27 07:35x80x31 08:40x90x33`);

/** Miniature and intermediate deep groove bearings, by full designation. */
const DEEP_GROOVE_SMALL = series(`604:4x12x4 605:5x14x5 606:6x17x6 607:7x19x6 608:8x22x7 609:9x24x7
  623:3x10x4 624:4x13x5 625:5x16x5 626:6x19x6 627:7x22x7 628:8x24x8 629:9x26x8
  634:4x16x5 635:5x19x6 636:6x22x7 637:7x26x9 638:8x28x9 639:9x30x10
  60/22:22x44x12 60/28:28x52x12 60/32:32x58x13 62/22:22x50x14 62/28:28x58x16 62/32:32x65x17 63/22:22x56x16 63/28:28x68x18 63/32:32x75x20`);

/** Tapered roller bearings, metric ISO 355 (the width is T). */
const T302 = series(`03:17x40x13.25 04:20x47x15.25 05:25x52x16.25 06:30x62x17.25 07:35x72x18.25 08:40x80x19.75 09:45x85x20.75 10:50x90x21.75
  11:55x100x22.75 12:60x110x23.75 13:65x120x24.75 14:70x125x26.25 15:75x130x27.25 16:80x140x28.25 17:85x150x30.5 18:90x160x32.5
  19:95x170x34.5 20:100x180x37 22:110x200x41 24:120x215x43.5`);
const T303 = series(`02:15x42x14.25 03:17x47x15.25 04:20x52x16.25 05:25x62x18.25 06:30x72x20.75 07:35x80x22.75 08:40x90x25.25 09:45x100x27.25
  10:50x110x29.25 11:55x120x31.5 12:60x130x33.5 13:65x140x36 14:70x150x38 15:75x160x40 16:80x170x42.5 17:85x180x44.5 18:90x190x46.5
  19:95x200x49.5 20:100x215x51.5`);
const T320 = series(`04:20x42x15 05:25x47x15 06:30x55x17 07:35x62x18 08:40x68x19 09:45x75x20 10:50x80x20 11:55x90x23 12:60x95x23 13:65x100x23
  14:70x110x25 15:75x115x25 16:80x125x29`);
const T322 = series(`03:17x40x17.25 04:20x47x19.25 05:25x52x19.25 06:30x62x21.25 07:35x72x24.25 08:40x80x24.75 09:45x85x24.75 10:50x90x24.75
  11:55x100x26.75 12:60x110x29.75 13:65x120x32.75 14:70x125x33.25 15:75x130x33.25 16:80x140x35.25 17:85x150x38.5 18:90x160x42.5
  19:95x170x45.5 20:100x180x49 22:110x200x56 24:120x215x61.5`);
const T323 = series(`03:17x47x20.25 04:20x52x22.25 05:25x62x25.25 06:30x72x28.75 07:35x80x32.75 08:40x90x35.25 09:45x100x38.25 10:50x110x42.25
  11:55x120x45.5 12:60x130x48.5 13:65x140x51 14:70x150x54 15:75x160x58 16:80x170x61.5 17:85x180x63.5 18:90x190x67.5 19:95x200x71.5
  20:100x215x77.5`);

/** Thrust ball bearings 511xx … 514xx (d is the shaft washer bore, B the height). */
const P511 = series(`00:10x24x9 01:12x26x9 02:15x28x9 03:17x30x9 04:20x35x10 05:25x42x11 06:30x47x11 07:35x52x12 08:40x60x13 09:45x65x14 10:50x70x14
  11:55x78x16 12:60x85x17 13:65x90x18 14:70x95x18 15:75x100x19 16:80x105x19 17:85x110x19 18:90x120x22 20:100x135x25 22:110x145x25 24:120x155x25`);
const P512 = series(`00:10x26x11 01:12x28x11 02:15x32x12 03:17x35x12 04:20x40x14 05:25x47x15 06:30x52x16 07:35x62x18 08:40x68x19 09:45x73x20 10:50x78x22
  11:55x90x25 12:60x95x26 13:65x100x27 14:70x105x27 15:75x110x27 16:80x115x28 17:85x125x31 18:90x135x35 20:100x150x38`);
const P513 = series(`05:25x52x18 06:30x60x21 07:35x68x24 08:40x78x26 09:45x85x28 10:50x95x31 11:55x105x35 12:60x110x35 13:65x115x36 14:70x125x40
  15:75x135x44 16:80x140x44 17:85x150x49 18:90x155x50 20:100x170x55`);
const P514 = series(`06:30x70x28 07:35x80x32 08:40x90x36 09:45x100x39 10:50x110x43 11:55x120x48 12:60x130x51 13:65x140x56 14:70x150x60 15:75x160x65 16:80x170x68`);

/** HK / BK needle roller sleeves: outer diameter by shaft diameter (SKF catalog). */
const NEEDLE_SLEEVE_D: Record<number, number> = {
  8: 12, 10: 14, 12: 16, 14: 20, 15: 21, 16: 22, 18: 24, 20: 26, 22: 28, 25: 32, 28: 35, 30: 37, 32: 40, 35: 42, 40: 47, 45: 52, 50: 58, 55: 63, 60: 68,
};

const pick = (table: Record<string, Triple>, key: string, source: string): Dimensions | null => {
  const hit = table[key];
  return hit ? { d: hit[0], D: hit[1], B: hit[2], source } : null;
};

/** Designation of the bearing without suffixes: upper case, spaces removed, up to the first character that is not part of the base. */
const clean = (code: string) => code.toUpperCase().replace(/\s+/g, '');

function deepGroove(code: string): Dimensions | null {
  const c = clean(code);
  // full designations of the small and intermediate sizes first: 6x/yy and the miniature ones
  const slash = /^(6[023]\/\d{2})(?!\d)/.exec(c);
  if (slash) return pick(DEEP_GROOVE_SMALL, slash[1], 'ISO 15');
  const five = /^(160|618|619|622|623)(\d{2})(?!\d)/.exec(c);
  if (five) {
    const table = { '160': S160, '618': S618, '619': S619, '622': S622, '623': S623 }[five[1] as '160'];
    return pick(table, five[2], `ISO 15 ${five[1]}xx`);
  }
  const four = /^(60|62|63|64)(\d{2})(?!\d)/.exec(c);
  if (four) {
    const table = { '60': S60, '62': S02, '63': S03, '64': S64 }[four[1] as '60'];
    return pick(table, four[2], `ISO 15 ${four[1]}xx`);
  }
  const mini = /^(60[4-9]|62[3-9]|63[4-9])(?!\d)/.exec(c);
  return mini ? pick(DEEP_GROOVE_SMALL, mini[1], 'ISO 15 miniature') : null;
}

function angularContact(code: string): Dimensions | null {
  const m = /^(70|72|73)(\d{2})(?!\d)/.exec(clean(code));
  if (!m) return null;
  return pick({ '70': S60, '72': S02, '73': S03 }[m[1] as '70'], m[2], `ISO 15 ${m[1]}xx`);
}

function tapered(code: string): Dimensions | null {
  const m = /^(302|303|320|322|323)(\d{2})(?!\d)/.exec(clean(code));
  if (!m) return null;
  return pick({ '302': T302, '303': T303, '320': T320, '322': T322, '323': T323 }[m[1] as '302'], m[2], `ISO 355 ${m[1]}xx`);
}

function cylindrical(code: string): Dimensions | null {
  const m = /^(?:NUP|NU|NJ|N)(2|3|22|23)(\d{2})(?!\d)/.exec(clean(code));
  if (!m) return null;
  return pick({ '2': S02, '3': S03, '22': S22, '23': S23 }[m[1] as '2'], m[2], `ISO 15 NU${m[1]}xx`);
}

function sphericalRoller(code: string): Dimensions | null {
  const m = /^(213|222|223)(\d{2})(?!\d)/.exec(clean(code));
  if (!m) return null;
  return pick({ '213': S03, '222': S22, '223': S23 }[m[1] as '213'], m[2], `ISO 15 ${m[1]}xx`);
}

function selfAligningBall(code: string): Dimensions | null {
  const m = /^(12|13|22|23)(\d{2})(?!\d)/.exec(clean(code));
  if (!m) return null;
  return pick({ '12': S02, '13': S03, '22': S22, '23': S23 }[m[1] as '12'], m[2], `ISO 15 ${m[1]}xx`);
}

function thrustBall(code: string): Dimensions | null {
  const m = /^(511|512|513|514)(\d{2})(?!\d)/.exec(clean(code));
  if (!m) return null;
  return pick({ '511': P511, '512': P512, '513': P513, '514': P514 }[m[1] as '511'], m[2], `ISO 104 ${m[1]}xx`);
}

function needle(code: string): Dimensions | null {
  const c = clean(code);
  // K 20 x 24 x 17: the three measures are written in the designation
  const cage = /^K(\d{1,3})X(\d{1,3})X(\d{1,3})(?!\d)/.exec(c);
  if (cage) return { d: cage[1], D: cage[2], B: cage[3], source: 'designation K dxDxB' };
  const sleeve = /^(HK|BK)(\d{2})(\d{2})(?!\d)/.exec(c);
  if (sleeve) {
    const d = Number(sleeve[2]);
    const D = NEEDLE_SLEEVE_D[d];
    return D ? { d: String(d), D: String(D), B: String(Number(sleeve[3])), source: `SKF ${sleeve[1]}` } : null;
  }
  return null;
}

/** Subcategory (as created by the migration) -> the derivation that applies to it. */
const BY_SUBCATEGORY: Record<string, (code: string) => Dimensions | null> = {
  'Rígidos de bolas': deepGroove,
  'Contacto angular': angularContact,
  'Rodillos cónicos': tapered,
  'Rodillos cilíndricos': cylindrical,
  'Esféricos de rodillos': sphericalRoller,
  'Oscilantes de bolas': selfAligningBall,
  'Axiales de bolas': thrustBall,
  Agujas: needle,
};

/** d, D and B of a bearing, or null when the designation does not allow deriving them safely. */
export function deriveDimensions(subcategory: string | null, code: string): Dimensions | null {
  const derive = subcategory ? BY_SUBCATEGORY[subcategory] : undefined;
  const result = derive ? derive(code) : null;
  // a bore larger than the outside can only be a wrong match: refuse it
  if (result && Number(result.d) >= Number(result.D)) return null;
  return result;
}
