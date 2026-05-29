/**
 * Branch coverage for src/core/types/config.ts
 * Targets: isValidSonarProjectKey (lines 152-153)
 */
import { isValidSonarProjectKey } from '@core/types/config';
import { describe, it, expect } from 'vitest';


describe('isValidSonarProjectKey()', () => {
  it('returns true for a valid project key', () => {
    expect(isValidSonarProjectKey('my-project_key:v1')).toBe(true);
  });

  it('returns false for a key with invalid characters', () => {
    expect(isValidSonarProjectKey('invalid key!')).toBe(false);
  });
});
