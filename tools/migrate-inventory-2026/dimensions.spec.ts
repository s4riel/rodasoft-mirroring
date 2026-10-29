// Run with: npx tsx --tsconfig tsconfig.base.json --test tools/migrate-inventory-2026/dimensions.spec.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveDimensions } from './dimensions';

const dims = (subcategory: string, code: string) => {
  const r = deriveDimensions(subcategory, code);
  return r && `${r.d}x${r.D}x${r.B}`;
};

describe('deriveDimensions', () => {
  it('deep groove bearings, with seals and clearance suffixes', () => {
    assert.equal(dims('Rígidos de bolas', '6205-2RS/C3'), '25x52x15');
    assert.equal(dims('Rígidos de bolas', '6304-2NSE C3'), '20x52x15');
    assert.equal(dims('Rígidos de bolas', '6002-2Z-C3'), '15x32x9');
    assert.equal(dims('Rígidos de bolas', '6311 ZZ C3'), '55x120x29');
    assert.equal(dims('Rígidos de bolas', '16005C3'), '25x47x8');
    assert.equal(dims('Rígidos de bolas', '61806-2Z'), '30x42x7');
    assert.equal(dims('Rígidos de bolas', '62207-2RSR'), '35x72x23');
    assert.equal(dims('Rígidos de bolas', '62/28-2RS/C3'), '28x58x16');
    assert.equal(dims('Rígidos de bolas', '60/22DDUC3'), '22x44x12');
    assert.equal(dims('Rígidos de bolas', '608-2RS-C3'), '8x22x7');
    assert.equal(dims('Rígidos de bolas', '626-2Z-C3'), '6x19x6');
  });

  it('tapered roller bearings give T as B', () => {
    assert.equal(dims('Rodillos cónicos', '30208'), '40x80x19.75');
    assert.equal(dims('Rodillos cónicos', '30305DJ'), '25x62x18.25');
    assert.equal(dims('Rodillos cónicos', '32009XJ-A'), '45x75x20');
    assert.equal(dims('Rodillos cónicos', '32214'), '70x125x33.25');
    assert.equal(dims('Rodillos cónicos', '32309J'), '45x100x38.25');
  });

  it('cylindrical, spherical, self-aligning, angular contact and thrust', () => {
    assert.equal(dims('Rodillos cilíndricos', 'NU208'), '40x80x18');
    assert.equal(dims('Rodillos cilíndricos', 'NJ2310 ECP C3'), '50x110x40');
    assert.equal(dims('Rodillos cilíndricos', 'NUP2206-E-TVP3'), '30x62x20');
    assert.equal(dims('Rodillos cilíndricos', 'NU306 C3'), '30x72x19');
    assert.equal(dims('Esféricos de rodillos', '22212 MB W33'), '60x110x28');
    assert.equal(dims('Esféricos de rodillos', '22312EAE4C3'), '60x130x46');
    assert.equal(dims('Esféricos de rodillos', '21310EAKE4C3'), '50x110x27');
    assert.equal(dims('Oscilantes de bolas', '1208 K'), '40x80x18');
    assert.equal(dims('Oscilantes de bolas', '2207-2RS-TV'), '35x72x23');
    assert.equal(dims('Contacto angular', '7207-BECB-TVP'), '35x72x17');
    assert.equal(dims('Contacto angular', '7308BMU C3'), '40x90x23');
    assert.equal(dims('Axiales de bolas', '51208'), '40x68x19');
  });

  it('needle bearings written with their measures', () => {
    assert.equal(dims('Agujas', 'K20X24X17'), '20x24x17');
    assert.equal(dims('Agujas', 'K12X18X12-TVP'), '12x18x12');
    assert.equal(dims('Agujas', 'HK2012'), '20x26x12');
    assert.equal(dims('Agujas', 'HK1012'), '10x14x12');
  });

  it('refuses what it cannot derive safely', () => {
    assert.equal(dims('Rodillos cónicos', '02474/20'), null); // inch series
    assert.equal(dims('Rodillos cónicos', 'HM803145/10'), null);
    assert.equal(dims('Rígidos de bolas', 'IR-8050'), null);
    assert.equal(dims('Rígidos de bolas', '6999'), null); // not in the tables
    assert.equal(dims('Agujas', 'NK18/16'), null);
    assert.equal(dims('Ruedas y cubos', 'WH30013BB'), null);
    assert.equal(deriveDimensions(null, '6205'), null);
  });

  it('only applies a family inside its own subcategory', () => {
    assert.equal(dims('Rodillos cónicos', '6205'), null);
    assert.equal(dims('Rígidos de bolas', '30208'), null);
  });
});
