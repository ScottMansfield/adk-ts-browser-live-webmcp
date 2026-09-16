import { describe, it, expect } from 'vitest';
import { findFlight } from './flight_data.ts';

describe('findFlight', () => {
  it('matches the exact id', () => {
    expect(findFlight('SB-101')?.id).toBe('SB-101');
  });

  it('matches the flight number the model is likely to say', () => {
    expect(findFlight('SB 101')?.id).toBe('SB-101');
  });

  it('tolerates case and punctuation drift', () => {
    expect(findFlight('sb101')?.id).toBe('SB-101');
    expect(findFlight('  sb-101 ')?.id).toBe('SB-101');
  });

  it('returns undefined for empty or unknown references', () => {
    expect(findFlight('')).toBeUndefined();
    expect(findFlight('   ')).toBeUndefined();
    expect(findFlight('XX-999')).toBeUndefined();
  });
});
