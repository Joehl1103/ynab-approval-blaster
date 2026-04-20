import type { TransactionRow } from '../db/transactions.js';

export type Mode = 'default' | 'picker' | 'memo' | 'lookup';
export type WriteStatus = 'idle' | 'saving' | 'saved' | 'failed';

export interface AppState {
  queue: TransactionRow[];
  index: number;
  mode: Mode;
  errors: string[];
  writeStatus: WriteStatus;
  history: TransactionRow[];
}

export const initialState: AppState = {
  queue: [],
  index: 0,
  mode: 'default',
  errors: [],
  writeStatus: 'idle',
  history: [],
};

export type Action =
  | { type: 'LOAD_QUEUE'; queue: TransactionRow[] }
  | { type: 'NEXT' }
  | { type: 'SET_MODE'; mode: Mode }
  | { type: 'ADD_ERROR'; error: string }
  | { type: 'DISMISS_ERROR' }
  | { type: 'SET_WRITE_STATUS'; status: WriteStatus }
  | { type: 'PUSH_HISTORY'; snapshot: TransactionRow }
  | { type: 'POP_HISTORY' };

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

    default:
      return state;
  }
}
