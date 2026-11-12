import { roleCan } from '@local-chatter/shared';
import { describe, expect, it } from 'vitest';

describe('roleCan', () => {
  it('lets only an admin update Chatter', () => {
    expect(roleCan('admin', 'manage-updates')).toBe(true);
    expect(roleCan('operator', 'manage-updates')).toBe(false);
    expect(roleCan('viewer', 'manage-updates')).toBe(false);
  });
});
