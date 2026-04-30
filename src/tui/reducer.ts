import type { TransactionRow } from '../db/transactions.js';
import type { ParsedReceipt, ReceiptSuggestion } from '../receipt/types.js';

export type Mode = 'default' | 'picker' | 'memo' | 'receipt';
export type WriteStatus = 'idle' | 'saving' | 'saved' | 'failed';

export type ReceiptStage =
  | 'capturing'
  | 'ocr'
  | 'analyzing'
  | 'review'
  | 'error';

export interface ReceiptState {
  stage: ReceiptStage;
  parsed: ParsedReceipt | null;
  suggestion: ReceiptSuggestion | null;
  error: string | null;
}

export interface AppState {
  queue: TransactionRow[];
  index: number;
  mode: Mode;
  errors: string[];
  writeStatus: WriteStatus;
  history: TransactionRow[];
  receipt: ReceiptState | null;
}

export const initialState: AppState = {
  queue: [],
  index: 0,
  mode: 'default',
  errors: [],
  writeStatus: 'idle',
  history: [],
  receipt: null,
};

export type Action =
  | { type: 'LOAD_QUEUE'; queue: TransactionRow[] }
  | { type: 'NEXT' }
  | { type: 'SET_MODE'; mode: Mode }
  | { type: 'ADD_ERROR'; error: string }
  | { type: 'DISMISS_ERROR' }
  | { type: 'SET_WRITE_STATUS'; status: WriteStatus }
  | { type: 'PUSH_HISTORY'; snapshot: TransactionRow }
  | { type: 'POP_HISTORY' }
  | { type: 'RECEIPT_START' }
  | { type: 'RECEIPT_PROGRESS'; stage: ReceiptStage }
  | { type: 'RECEIPT_RESULT'; parsed: ParsedReceipt; suggestion: ReceiptSuggestion }
  | { type: 'RECEIPT_FAIL'; error: string }
  | { type: 'RECEIPT_CLOSE' };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD_QUEUE':
      return { ...state, queue: action.queue, index: 0 };

    case 'NEXT':
      return {
        ...state,
        index: state.index < state.queue.length - 1 ? state.index + 1 : state.index,
      };

    case 'SET_MODE':
      return { ...state, mode: action.mode };

    case 'ADD_ERROR':
      return { ...state, errors: [...state.errors, action.error] };

    case 'DISMISS_ERROR':
      return { ...state, errors: state.errors.slice(1) };

    case 'SET_WRITE_STATUS':
      return { ...state, writeStatus: action.status };

    case 'PUSH_HISTORY':
      return { ...state, history: [...state.history, action.snapshot] };

    case 'POP_HISTORY':
      if (state.history.length === 0) return state;
      return {
        ...state,
        history: state.history.slice(0, -1),
        index: Math.max(0, state.index - 1),
      };

    case 'RECEIPT_START':
      return {
        ...state,
        mode: 'receipt',
        receipt: { stage: 'capturing', parsed: null, suggestion: null, error: null },
      };

    case 'RECEIPT_PROGRESS':
      if (!state.receipt) return state;
      return { ...state, receipt: { ...state.receipt, stage: action.stage } };

    case 'RECEIPT_RESULT':
      return {
        ...state,
        mode: 'receipt',
        receipt: {
          stage: 'review',
          parsed: action.parsed,
          suggestion: action.suggestion,
          error: null,
        },
      };

    case 'RECEIPT_FAIL':
      return {
        ...state,
        mode: 'receipt',
        receipt: {
          stage: 'error',
          parsed: state.receipt?.parsed ?? null,
          suggestion: state.receipt?.suggestion ?? null,
          error: action.error,
        },
      };

    case 'RECEIPT_CLOSE':
      return { ...state, mode: 'default', receipt: null };

    default:
      return state;
  }
}
