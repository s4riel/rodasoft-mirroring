import { COMPANY_SETTING_DEFAULTS, settingOrDefault } from './company-settings';

describe('settingOrDefault', () => {
  it('falls back to the default when there is no stored value', () => {
    expect(settingOrDefault('inventory.skuPrefix', undefined)).toBe('RL-');
    expect(settingOrDefault('inventory.allowNegativeStock', null)).toBe(false);
    expect(settingOrDefault('transfers.maxLines', null)).toBe(500);
  });

  it('uses the stored value when it has the expected type', () => {
    expect(settingOrDefault('inventory.skuPrefix', 'AB-')).toBe('AB-');
    expect(settingOrDefault('inventory.allowNegativeStock', true)).toBe(true);
    expect(settingOrDefault('transfers.maxLines', 200)).toBe(200);
  });

  it('keeps money thresholds as strings, never numbers', () => {
    expect(settingOrDefault('adjustments.approvalThresholdValue', '10000.00')).toBe('10000.00');
    expect(settingOrDefault('adjustments.approvalThresholdValue', 10000)).toBeNull();
  });

  it('has the decision defaults for the sales settings', () => {
    expect(settingOrDefault('sales.roundingMode', undefined)).toBe('NONE');
    expect(settingOrDefault('sales.allowMixedPayment', undefined)).toBe(true);
    expect(settingOrDefault('sales.quoteValidityDays', undefined)).toBe(7);
    expect(settingOrDefault('sales.allowPartialDispatch', undefined)).toBe(true);
    expect(settingOrDefault('sales.cancellationWindowDays', undefined)).toBeNull();
    expect(settingOrDefault('sales.cashExpenseApprovalLimit', undefined)).toBeNull();
    expect(settingOrDefault('sales.cashDifferenceTolerance', undefined)).toBe('0.00');
    expect(settingOrDefault('sales.returnApprovalLimit', undefined)).toBeNull();
    expect(settingOrDefault('sales.returnWindowDays', undefined)).toBeNull();
    expect(settingOrDefault('sales.nitVerification', undefined)).toBe('FORMAT');
    expect(settingOrDefault('sales.receiptFormat', undefined)).toBe('TICKET_80MM');
    expect(settingOrDefault('sales.qrConfirmTimeoutSeconds', undefined)).toBe(300);
  });

  it('does not ask for approval of a bulk price update unless the company turns it on (decision #19)', () => {
    expect(COMPANY_SETTING_DEFAULTS['sales.bulkPriceRequiresApproval']).toBe(false);
    expect(settingOrDefault('sales.bulkPriceRequiresApproval', undefined)).toBe(false);
    expect(settingOrDefault('sales.bulkPriceRequiresApproval', true)).toBe(true);
    expect(settingOrDefault('sales.bulkPriceRequiresApproval', 'yes')).toBe(false);
  });

  it('accepts only the known receipt formats', () => {
    expect(settingOrDefault('sales.receiptFormat', 'LETTER')).toBe('LETTER');
    expect(settingOrDefault('sales.receiptFormat', 'A4')).toBe('TICKET_80MM');
    expect(settingOrDefault('sales.receiptFormat', 3)).toBe('TICKET_80MM');
  });

  it('accepts only the known NIT verification modes', () => {
    expect(settingOrDefault('sales.nitVerification', 'SIAT')).toBe('SIAT');
    expect(settingOrDefault('sales.nitVerification', 'ONLINE')).toBe('FORMAT');
    expect(settingOrDefault('sales.nitVerification', true)).toBe('FORMAT');
  });

  it('accepts only the known rounding modes', () => {
    expect(settingOrDefault('sales.roundingMode', 'HALF_BOLIVIANO')).toBe('HALF_BOLIVIANO');
    expect(settingOrDefault('sales.roundingMode', 'INTEGER')).toBe('INTEGER');
    expect(settingOrDefault('sales.roundingMode', 'UP')).toBe('NONE');
    expect(settingOrDefault('sales.roundingMode', 1)).toBe('NONE');
  });

  it('reads the cancellation window as a positive whole number, or null for no limit', () => {
    expect(settingOrDefault('sales.cancellationWindowDays', 30)).toBe(30);
    expect(settingOrDefault('sales.cancellationWindowDays', null)).toBeNull();
    expect(settingOrDefault('sales.cancellationWindowDays', 0)).toBeNull();
    expect(settingOrDefault('sales.cancellationWindowDays', 2.5)).toBeNull();
    expect(settingOrDefault('sales.cancellationWindowDays', '30')).toBeNull();
  });

  it('keeps the cash expense limit as a money string', () => {
    expect(settingOrDefault('sales.cashExpenseApprovalLimit', '500.00')).toBe('500.00');
    expect(settingOrDefault('sales.cashExpenseApprovalLimit', 500)).toBeNull();
    expect(settingOrDefault('sales.cashDifferenceTolerance', '2.50')).toBe('2.50');
    expect(settingOrDefault('sales.cashDifferenceTolerance', 2)).toBe('0.00');
    expect(settingOrDefault('sales.returnApprovalLimit', '100.00')).toBe('100.00');
    expect(settingOrDefault('sales.returnApprovalLimit', 100)).toBeNull();
    expect(settingOrDefault('sales.returnWindowDays', 15)).toBe(15);
    expect(settingOrDefault('sales.returnWindowDays', 0)).toBeNull();
  });

  it('ignores a stored value of the wrong type', () => {
    expect(settingOrDefault('inventory.allowNegativeStock', 'yes')).toBe(COMPANY_SETTING_DEFAULTS['inventory.allowNegativeStock']);
    expect(settingOrDefault('inventory.skuPrefix', 7)).toBe('RL-');
  });
});

describe('sales.creditTermDays (decision #53)', () => {
  it('defaults to 5, 15 and 30 days', () => {
    expect(settingOrDefault('sales.creditTermDays', undefined)).toEqual([5, 15, 30]);
    expect(COMPANY_SETTING_DEFAULTS['sales.creditTermDays']).toEqual([5, 15, 30]);
  });

  it('keeps a stored list of positive whole numbers, sorted and without repeats', () => {
    expect(settingOrDefault('sales.creditTermDays', [45, 10, 10, 30])).toEqual([10, 30, 45]);
  });

  it('falls back to the default for anything else', () => {
    for (const bad of [[], [0, 5], [5, -1], [5, 1.5], ['5'], 'abc', 30, {}]) {
      expect(settingOrDefault('sales.creditTermDays', bad)).toEqual([5, 15, 30]);
    }
  });
});

describe('invoicing settings of the notes and the VAT books (HU-FAC-12, 13, 18, 20)', () => {
  it('keeps price-adjustment notes off and warns six hours before a code expires', () => {
    expect(settingOrDefault('invoicing.allowPriceAdjustmentNotes', undefined)).toBe(false);
    expect(settingOrDefault('invoicing.allowPriceAdjustmentNotes', true)).toBe(true);
    expect(settingOrDefault('invoicing.cufdWarnHours', undefined)).toBe(6);
    expect(settingOrDefault('invoicing.cufdWarnHours', 12)).toBe(12);
    expect(settingOrDefault('invoicing.cufdWarnHours', 0)).toBe(6);
  });

  it('reads the book layout from its closed list', () => {
    expect(settingOrDefault('invoicing.vatBookFormat', undefined)).toBe('SIN_LCV');
    expect(settingOrDefault('invoicing.vatBookFormat', 'OTHER')).toBe('SIN_LCV');
  });

  it('keeps a stored list of export formats without repeats and in catalogue order, or falls back', () => {
    expect(settingOrDefault('invoicing.vatBookExportFormats', undefined)).toEqual(['XLSX', 'CSV']);
    expect(settingOrDefault('invoicing.vatBookExportFormats', ['CSV'])).toEqual(['CSV']);
    expect(settingOrDefault('invoicing.vatBookExportFormats', ['CSV', 'XLSX', 'CSV'])).toEqual(['XLSX', 'CSV']);
    for (const bad of [[], ['PDF'], ['CSV', 3], 'CSV', 5, {}]) {
      expect(settingOrDefault('invoicing.vatBookExportFormats', bad)).toEqual(['XLSX', 'CSV']);
    }
  });
});
