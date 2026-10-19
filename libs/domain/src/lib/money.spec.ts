import { allocate, COST_SCALE, Decimal, sum } from './money';

describe('Decimal', () => {
  it('parsea y formatea montos', () => {
    expect(Decimal.of('1280').toString()).toBe('1280.00');
    expect(Decimal.of('1280,5').toString()).toBe('1280.50');
    expect(Decimal.of(0.1).add(Decimal.of(0.2)).toString()).toBe('0.30');
    expect(Decimal.of('-20').format()).toBe('−Bs 20,00');
    expect(Decimal.of('1280').format()).toBe('Bs 1.280,00');
    expect(Decimal.of('6200').format('USD')).toBe('USD 6.200,00');
  });

  it('redondea medio hacia arriba', () => {
    expect(Decimal.of('1.005', 3).round(2).toString()).toBe('1.01');
    expect(Decimal.of('1.004', 3).round(2).toString()).toBe('1.00');
    expect(Decimal.of('-1.005', 3).round(2).toString()).toBe('-1.01');
  });

  it('calcula el IVA (13 %) e IT (3 %) de la venta DEMO 000124', () => {
    const total = Decimal.of('1280.00');
    expect(total.percent(13).toString()).toBe('166.40');
    expect(total.percent(3).toString()).toBe('38.40');
    expect(total.sub(total.percent(13)).toString()).toBe('1113.60');
  });

  it('convierte con tipo de cambio de escala 4', () => {
    const usd = Decimal.of('6200');
    const tc = Decimal.of('6.96', COST_SCALE);
    expect(usd.mul(tc).toString()).toBe('43152.00');
    expect(Decimal.of('43152').div(tc).toString()).toBe('6200.00');
  });

  it('divide con redondeo', () => {
    expect(Decimal.of('10').div(3).toString()).toBe('3.33');
    expect(Decimal.of('20').div(3).toString()).toBe('6.67');
    expect(Decimal.of('10').div(3, 4).toString()).toBe('3.3333');
    expect(() => Decimal.of('1').div(0)).toThrow('División entre cero');
  });

  it('rechaza textos inválidos', () => {
    expect(() => Decimal.of('12a')).toThrow();
    expect(() => Decimal.of('')).toThrow();
  });

  it('suma listas', () => {
    expect(sum([Decimal.of('210'), Decimal.of('3100'), Decimal.of('1280'), Decimal.of('640')]).toString()).toBe(
      '5230.00',
    );
  });
});

describe('allocate (prorrateo sin perder centavos)', () => {
  it('reparte 100 en tres partes iguales', () => {
    const parts = allocate(Decimal.of('100'), [Decimal.of(1), Decimal.of(1), Decimal.of(1)]);
    expect(parts.map(String)).toEqual(['33.34', '33.33', '33.33']);
    expect(sum(parts).toString()).toBe('100.00');
  });

  it('reparte un flete por valor de las líneas', () => {
    const parts = allocate(Decimal.of('950'), [Decimal.of('4800'), Decimal.of('1200'), Decimal.of('380')]);
    expect(sum(parts).toString()).toBe('950.00');
    expect(parts.map(String)).toEqual(['714.74', '178.68', '56.58']);
  });
});
