import { describe, it, expect } from 'vitest';
import { reducer, initialState } from '../src/tui/reducer.js';
import type { TransactionRow } from '../src/db/transactions.js';

const makeTx = (id: string): TransactionRow => ({
  id,
  date: '2026-01-01',
  amount: -50000,
  payee_id: 'p1',
  payee_name: 'TARGET',
  category_id: 'c1',
  category_name: 'Groceries',
  memo: null,
  approved: 0,
  cleared: 'uncleared',
  account_name: 'Checking',
  flag_color: null,
  deleted: 0,
});

describe('reducer', () => {
  it('LOAD_QUEUE sets queue and resets index', () => {
    const txs = [makeTx('t1'), makeTx('t2')];
    const state = reducer(initialState, { type: 'LOAD_QUEUE', queue: txs });
    expect(state.queue).toHaveLength(2);
    expect(state.index).toBe(0);
  });

  it('NEXT advances index', () => {
    const state = reducer(
      { ...initialState, queue: [makeTx('t1'), makeTx('t2')], index: 0 },
      { type: 'NEXT' }
    );
    expect(state.index).toBe(1);
  });

  it('NEXT does not advance past end of queue', () => {
    const state = reducer(
      { ...initialState, queue: [makeTx('t1')], index: 0 },
      { type: 'NEXT' }
    );
    expect(state.index).toBe(0);
  });

  it('SET_MODE changes mode', () => {
    const state = reducer(initialState, { type: 'SET_MODE', mode: 'picker' });
    expect(state.mode).toBe('picker');
  });

  it('ADD_ERROR appends to errors array', () => {
    const state = reducer(initialState, { type: 'ADD_ERROR', error: 'oops' });
    expect(state.errors).toContain('oops');
  });

  it('DISMISS_ERROR removes first error', () => {
    const withError = { ...initialState, errors: ['err1', 'err2'] };
    const state = reducer(withError, { type: 'DISMISS_ERROR' });
    expect(state.errors).toEqual(['err2']);
  });

  it('SET_WRITE_STATUS updates writeStatus', () => {
    const state = reducer(initialState, { type: 'SET_WRITE_STATUS', status: 'saving' });
    expect(state.writeStatus).toBe('saving');
  });

  it('PUSH_HISTORY adds to history', () => {
    const tx = makeTx('t1');
    const state = reducer(initialState, { type: 'PUSH_HISTORY', snapshot: tx });
    expect(state.history).toHaveLength(1);
  });

  it('POP_HISTORY removes last history entry and decrements index', () => {
    const tx = makeTx('t1');
    const withHistory = {
      ...initialState,
      queue: [makeTx('t1'), makeTx('t2')],
      index: 1,
      history: [tx],
    };
    const state = reducer(withHistory, { type: 'POP_HISTORY' });
    expect(state.history).toHaveLength(0);
    expect(state.index).toBe(0);
  });
});
