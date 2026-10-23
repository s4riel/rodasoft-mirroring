import { COMPANY_SETTING_DEFAULTS, settingOrDefault } from './company-settings';

describe('settingOrDefault', () => {
  it('falls back to the default when there is no stored value', () => {
    expect(settingOrDefault('inventory.skuPrefix', undefined)).toBe('RL-');
    expect(settingOrDefault('inventory.allowNegativeStock', null)).toBe(false);
    expect(settingOrDefault('transfers.approvalThresholdPieces', null)).toBeNull();
  });

  it('uses the stored value when it has the expected type', () => {
    expect(settingOrDefault('inventory.skuPrefix', 'AB-')).toBe('AB-');
    expect(settingOrDefault('inventory.allowNegativeStock', true)).toBe(true);
    expect(settingOrDefault('transfers.approvalThresholdPieces', 500)).toBe(500);
  });

  it('keeps money thresholds as strings, never numbers', () => {
    expect(settingOrDefault('transfers.approvalThresholdValue', '10000.00')).toBe('10000.00');
    expect(settingOrDefault('transfers.approvalThresholdValue', 10000)).toBeNull();
  });

  it('ignores a stored value of the wrong type', () => {
    expect(settingOrDefault('inventory.allowNegativeStock', 'yes')).toBe(COMPANY_SETTING_DEFAULTS['inventory.allowNegativeStock']);
    expect(settingOrDefault('inventory.skuPrefix', 7)).toBe('RL-');
  });
});
