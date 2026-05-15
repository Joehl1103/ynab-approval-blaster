import type { AmazonChargeRow, AmazonItemRow } from '../db/amazon.js';

export interface AmazonMatch {
  charge: AmazonChargeRow;
  items: AmazonItemRow[];
  ambiguous: boolean;
}

export interface AmazonSyncResult {
  chargesAdded: number;
  itemsAdded: number;
  daysWindow: number;
}

// Shape of the JSON emitted by scripts/amazon_export.py
export interface ExportPayload {
  transactions: Array<{
    order_number: string;
    completed_date: string | null;
    grand_total: number;
    is_refund: boolean;
    milliunits: number;
    payment_method: string | null;
    seller: string | null;
  }>;
  orders: Array<{
    order_number: string;
    order_placed_date: string | null;
    grand_total: number | null;
    items: Array<{
      title: string;
      price: number | null;
      quantity: number;
    }>;
  }>;
}
