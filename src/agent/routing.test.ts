import { describe, expect, it } from 'vitest';
import { resolveNextRegion } from './routing';

describe('resolveNextRegion', () => {
  it('prefers declared fallbacks for the current region', () => {
    const next = resolveNextRegion('aws-us-east-1', {});
    expect(next?.id).toBe('aws-eu-west-1');
  });

  it('skips unhealthy/deprecated regions', () => {
    const next = resolveNextRegion('aws-us-east-1', {
      'aws-eu-west-1': 'deprecated',
    });
    expect(next?.id).toBe('openai-us');
  });

  it('can force include a region even if unhealthy', () => {
    const next = resolveNextRegion(
      'aws-us-east-1',
      { 'aws-eu-west-1': 'deprecated' },
      { forceInclude: ['aws-eu-west-1'] },
    );
    expect(next?.id).toBe('aws-eu-west-1');
  });
});

