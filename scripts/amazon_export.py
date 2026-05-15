#!/usr/bin/env python3
"""
amazon_export.py — bridge between ynab-blaster (Node) and amazon-orders (Python).

Reads Amazon credentials from env (AMAZON_USERNAME / AMAZON_PASSWORD,
optionally AMAZON_OTP_SECRET_KEY), pulls Transactions + Orders via the
amazonorders Python API, and emits a single JSON object on stdout.

Stdout: JSON
Stderr: progress / errors (human-readable)
Exit code: 0 on success, non-zero on auth or scrape failure
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any


def _amount_to_milliunits(amount: float, is_refund: bool) -> int:
    """
    Convert a transaction grand_total to YNAB-style signed milliunits.

    YNAB convention: outflows are negative, inflows (refunds) are positive.
    The amazon-orders library sometimes returns charges as negative grand_total
    and refunds as positive (with is_refund=True), but to be defensive we
    derive the sign from the is_refund flag rather than trusting the input sign.
    """
    abs_milliunits = round(abs(float(amount)) * 1000)
    return abs_milliunits if is_refund else -abs_milliunits


def _serialize_transaction(t: Any) -> dict[str, Any]:
    return {
        "order_number": t.order_number,
        "completed_date": t.completed_date.isoformat() if t.completed_date else None,
        "grand_total": float(t.grand_total) if t.grand_total is not None else 0.0,
        "is_refund": bool(t.is_refund),
        "milliunits": _amount_to_milliunits(t.grand_total, t.is_refund) if t.grand_total is not None else 0,
        "payment_method": t.payment_method,
        "seller": t.seller,
    }


def _serialize_order(o: Any) -> dict[str, Any]:
    items = []
    for item in (o.items or []):
        items.append({
            "title": item.title or "",
            "price": float(item.price) if item.price is not None else None,
            "quantity": int(item.quantity) if item.quantity is not None else 1,
        })
    return {
        "order_number": o.order_number,
        "order_placed_date": o.order_placed_date.isoformat() if o.order_placed_date else None,
        "grand_total": float(o.grand_total) if o.grand_total is not None else None,
        "items": items,
    }


def _resolve_time_filter(days: int) -> str:
    """
    Map a days-window to the closest amazon-orders time_filter.
    The library only exposes preset filters: last30 / months-3 / year=N.
    For days > 90 we fall back to months-3 (callers will see a warning).
    """
    if days <= 30:
        return "last30"
    if days <= 90:
        return "months-3"
    return "months-3"


def main() -> int:
    parser = argparse.ArgumentParser(description="Export Amazon transactions + orders as JSON")
    parser.add_argument("--days", type=int, default=30, help="Window of days for transactions (default 30)")
    parser.add_argument("--skip-orders", action="store_true", help="Skip the orders/items pass (transactions only)")
    args = parser.parse_args()

    # Map AMAZON_OTP_SECRET → AMAZON_OTP_SECRET_KEY (the env var amazon-orders looks for).
    if os.environ.get("AMAZON_OTP_SECRET") and not os.environ.get("AMAZON_OTP_SECRET_KEY"):
        os.environ["AMAZON_OTP_SECRET_KEY"] = os.environ["AMAZON_OTP_SECRET"]

    try:
        from amazonorders.exception import AmazonOrdersAuthError, AmazonOrdersAuthRedirectError, AmazonOrdersError
        from amazonorders.session import AmazonSession
        from amazonorders.orders import AmazonOrders
        from amazonorders.transactions import AmazonTransactions
    except ImportError as e:
        print(f"error: amazon-orders not installed in this Python env: {e}", file=sys.stderr)
        print("Install with: pipx install amazon-orders --python /opt/homebrew/bin/python3.12", file=sys.stderr)
        return 2
    username = os.environ.get("AMAZON_USERNAME") or os.environ.get("AMAZON_EMAIL")
    password = os.environ.get("AMAZON_PASSWORD")

    try:
        session = AmazonSession(username, password)
        if session.auth_cookies_stored():
            print("Using persisted Amazon session...", file=sys.stderr)
            session.is_authenticated = True
        else:
            if not username or not password:
                print(
                    "error: no persisted Amazon session found. Either set AMAZON_USERNAME (or AMAZON_EMAIL) and AMAZON_PASSWORD, "
                    "or run `ynab-blaster amazon-login` to create a browser-backed session.",
                    file=sys.stderr,
                )
                return 1

            print("Logging in to Amazon...", file=sys.stderr)
            session.login()

        print(f"Fetching transactions (last {args.days} days)...", file=sys.stderr)
        txns = AmazonTransactions(session)
        transactions_out: list[dict[str, Any]] = []
        for t in txns.get_transactions(days=args.days):
            transactions_out.append(_serialize_transaction(t))

        orders_out: list[dict[str, Any]] = []
        if not args.skip_orders:
            time_filter = _resolve_time_filter(args.days)
            print(f"Fetching orders (time_filter={time_filter})...", file=sys.stderr)
            orders_api = AmazonOrders(session)
            for o in orders_api.get_order_history(time_filter=time_filter, full_details=False):
                orders_out.append(_serialize_order(o))

        print(json.dumps({
            "transactions": transactions_out,
            "orders": orders_out,
        }))
        return 0
    except AmazonOrdersAuthRedirectError:
        print(
            "error: persisted Amazon session expired or was rejected by Amazon. "
            "Run `ynab-blaster amazon-login` to refresh it, then retry.",
            file=sys.stderr,
        )
        return 1
    except AmazonOrdersAuthError as e:
        message = str(e)
        if "JavaScript-based authentication challenge page" in message:
            print(
                "error: Amazon blocked the direct login flow with a JavaScript challenge. "
                "Run `ynab-blaster amazon-login` to sign in through a real browser and persist a session, then retry `ynab-blaster amazon-sync`.",
                file=sys.stderr,
            )
        else:
            print(f"error: {message}", file=sys.stderr)
        return 1
    except AmazonOrdersError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
