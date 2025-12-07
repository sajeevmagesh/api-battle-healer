import { describe, expect, it } from 'vitest';
import { applySchemaAdaptation, executeAction } from './toolkit';
import type { HealingState, ToolkitContext } from './types';

const BASE_CONTEXT: ToolkitContext = {
  backendBaseUrl: 'http://localhost:8000',
  requestId: 'req-test',
  correlationId: 'req-test',
};

function createState(overrides: Partial<HealingState> = {}): HealingState {
  return {
    requestId: 'req-test',
    url: '/external-api',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transactionId: 'demo', amount: 10 }),
    },
    regions: ['http://localhost:8000'],
    regionIndex: 0,
    regionHistory: [],
    regionHealth: {},
    attempts: [],
    interventions: [],
    maxCycles: 3,
    cyclesUsed: 0,
    correlationId: 'req-test',
    repairAttempts: 0,
    ...overrides,
  };
}

describe('applySchemaAdaptation', () => {
  it('maps renamed fields and fills defaults', () => {
    const hints = {
      fieldMap: { transactionId: 'txn_id', amount: 'amt_value' },
      defaults: { currency: 'USD' },
    };
    const payload = { txn_id: 'abc', amt_value: 42, message: 'ok' };
    expect(applySchemaAdaptation(hints, payload)).toEqual({
      txn_id: 'abc',
      amt_value: 42,
      message: 'ok',
      transactionId: 'abc',
      amount: 42,
      currency: 'USD',
    });
  });
});

describe('executeAction rewrite_request', () => {
  it('caps the number of rewrite attempts', async () => {
    const initialState = createState();
    const first = await executeAction(
      'rewrite_request',
      initialState,
      BASE_CONTEXT,
      { body: { transactionId: 'rewritten', amount: 5 } },
    );
    expect(first.updatedState.repairAttempts).toBe(1);

    const second = await executeAction(
      'rewrite_request',
      first.updatedState,
      BASE_CONTEXT,
      { body: { transactionId: 'rewritten-2', amount: 6 } },
    );
    expect(second.updatedState.repairAttempts).toBe(2);

    const third = await executeAction(
      'rewrite_request',
      second.updatedState,
      BASE_CONTEXT,
      { body: { transactionId: 'overflow', amount: 7 } },
    );
    expect(third.updatedState.cyclesUsed).toBe(third.updatedState.maxCycles);
  });
});

