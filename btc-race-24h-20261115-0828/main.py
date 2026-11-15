"""Momentum breakout bot for the BTC 24h race (agent-fun/bars-replay/v1).

Strategy (long only, full size, one position at a time):
  - Entry: the 30-minute return is at least +0.6% AND the latest close is
    above the 120-minute EMA (trend filter). Buy with all cash.
  - Exit: trailing stop 0.8% below the highest position value since entry,
    hard stop-loss 0.5% below the entry cost, or a 60-minute time stop.
  - Slippage bound 200 bps (2%) — a bound only, never a fee; it only stops
    a fill from being rejected on a >1% one-minute gap.

Why this shape: on the 1,440-bar dev window (a -4.00% downtrend) every
baseline loses (buy-and-hold -44.01, ema-cross -134.95, momentum -40.92,
rsi-bollinger -57.37, adx-momentum -86.60). One-minute returns have ~zero
autocorrelation, but 15/30-minute momentum WITH the EMA120 trend filter is
predictive (30m forward mean +0.35%, P(beating the ~0.26% round-trip cost)
0.54). Dip-buying is anti-predictive here (bounces are dead cats in a
downtrend), a V-bottom entry loses live, and tighter exits / reversal exits /
a fresh-cross rule all lose money in the live replay. The trend filter is
what keeps the bot out of the down-legs: without it the same entry loses
-66.05.

Dev result (local replay driver, calibrated byte-exact against the kit's
grade-local on buy-and-hold and ema-cross): net PnL +12.00 USDC on $1,000,
9 trades, max drawdown 1.8%, positive in both halves of the window
(+0.10 / +11.90). That passes the dev gate (net PnL > $0).

Standard library only. Deterministic: no network, no clock, no files, no
randomness — the same bars always produce the same orders.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))

import makefun_bars

SYMBOL = "CBBTC"

# --- strategy parameters (swept on the dev window; see README) ---
RET_WIN = 30            # minutes of the breakout return
RET_THRESH = 0.006      # enter when the 30-min return is >= +0.6%
TREND_LEN = 120         # minutes of the trend EMA; enter only above it
TRAIL_PCT = 0.008       # trailing stop: 0.8% below the peak value since entry
SL_PCT = 0.005          # hard stop-loss: 0.5% below the entry cost
MAX_HOLD = 60           # time stop in minutes
MAX_SLIPPAGE_BPS = 200  # fill-rejection bound only (2%); the modelled
                        # slippage itself is ~2 bps + ~7 bps impact per leg

MIN_NOTIONAL = 1_000_000  # $1 in quote units (fees.min_notional_quote_units)


class Ema:
    """Simple exponential moving average over integer closes."""

    def __init__(self, span):
        self.span = span
        self._warm = []
        self.value = None

    def step(self, close):
        if self.value is not None:
            self.value += (2.0 / (self.span + 1)) * (close - self.value)
            return
        self._warm.append(close)
        if len(self._warm) == self.span:
            self.value = sum(self._warm) / self.span


_closes = []               # latest closes, price_scale units
_trend = Ema(TREND_LEN)
_hold_since = None         # seq of the bar the position was entered on
_peak_value = None         # highest position value (quote units) since entry


def on_batch(state, batch):
    global _hold_since, _peak_value
    # Only decide on this batch's own CBBTC bar; a batch without one leaves
    # the history untouched so the bot never trades on a stale close.
    bar = next((b for b in batch["bars"] if b["symbol"] == SYMBOL), None)
    if bar is None:
        return []
    close = int(bar["c"])
    _closes.append(close)
    _trend.step(close)

    if state.warming_up:
        return []

    held = state.positions.get(SYMBOL)
    last = _closes[-1]

    # --- exit: one open position, first matching rule wins ---
    if held is not None:
        value = state.value(SYMBOL, held.qty)
        cost = held.cost
        if _peak_value is None or value > _peak_value:
            _peak_value = value
        trail_hit = value <= _peak_value * (1.0 - TRAIL_PCT)
        stop_hit = value <= cost * (1.0 - SL_PCT)
        timed_out = _hold_since is not None and (state.seq - _hold_since) >= MAX_HOLD
        if trail_hit or stop_hit or timed_out:
            _hold_since = None
            _peak_value = None
            return [{
                "side": "sell",
                "symbol": SYMBOL,
                "qty": held.qty,
                "max_slippage_bps": MAX_SLIPPAGE_BPS,
            }]
        return []

    # --- entry: momentum breakout above the trend ---
    if len(_closes) <= RET_WIN or _trend.value is None:
        return []
    ret = (last - _closes[-1 - RET_WIN]) / _closes[-1 - RET_WIN]
    above_trend = last >= _trend.value
    if ret < RET_THRESH or not above_trend:
        return []
    if state.cash < MIN_NOTIONAL:
        return []
    _hold_since = state.seq
    _peak_value = None
    return [{
        "side": "buy",
        "symbol": SYMBOL,
        "notional_quote_units": state.cash,
        "max_slippage_bps": MAX_SLIPPAGE_BPS,
    }]


makefun_bars.run(on_batch)
