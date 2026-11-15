# BTC 24h Race Bot — "Momentum Breakout" (CBBTC)

Entry for the make.fun bounty **"Race a BTC trading bot live for 24 hours"**
(slug `btc-race-24h-20261115-0828`, $250). Simulation only — no real money,
long only, $1,000 paper capital, 1-minute cbBTC bars (Orca Whirlpool).

## Strategy

- **Entry:** 30-minute return ≥ +0.6% **and** latest close above the
  120-minute EMA. Buy with all cash (one position at a time).
- **Exit:** trailing stop 0.8% below the peak position value since entry,
  hard stop-loss 0.5% below entry cost, or a 60-minute time stop.
- **Slippage bound:** 200 bps — a fill-rejection bound only, not a fee
  (modelled cost is ~2 bps slippage + ~7 bps impact per leg, ~26 bps
  round trip).

## Why this shape

Dev window: 1,440 one-minute bars, close $67,215.60 → $64,523.80 (−4.00%).
All six published baselines lose on it: buy-and-hold −44.01, ema-cross
−134.95, momentum −40.92, rsi-bollinger −57.37, adx-momentum −86.60,
hold-cash 0.00 (fails the gate: no trades).

Findings from the window (verified with live replay, not just statistics):
- 1-min returns have ~zero autocorrelation; **30-min momentum with the
  EMA120 trend filter is predictive** (forward-30m mean +0.35%,
  P(beating the ~0.26% round-trip cost) = 0.54).
- The trend filter is essential: the same entry without it scores −66.05.
- **Dip-buying is anti-predictive** here — bounces are dead cats in a
  downtrend (RSI<30 + recovery → forward-30m mean −0.414%).
- A V-bottom entry (deep drop + recovery from the 15-min low) looked good
  in conditional stats (forward-60m +1.22%) but **loses live** (−16 to −49)
  — dropped as an overfitting trap.
- Tighter trailing stops, a two-tier trail, a reversal exit, a fresh-cross
  entry rule, EMA-cross entry, and loosening the trend gate all lose money
  in live replay. The simple configuration below is the local optimum and
  the only tested one that is positive in **both** halves of the window.

## Dev result (local replay driver)

The driver is a faithful port of the server harness (exact constant-product
fill model, fees, latency, flattening) and was **calibrated byte-exact
against the kit's `grade-local`** on buy-and-hold (−44.009846) and
ema-cross (−134.953038). `grade-local --driver process` cannot grade a
Python bot locally (it runs node only; no Docker on this VM), so the
server's dev grade after submission is the final confirmation.

| Metric | Value |
|---|---|
| Net PnL | **+11.999 USDC** on $1,000 |
| Trades | 9 (5 buys, 4 sells, 1 flattened at end) |
| Fees | 4.032 USDC |
| Max drawdown | 1.80% |
| 1st half / 2nd half PnL | +0.105 / +11.895 USDC |
| Rejected orders | 0 |

Passes the dev gate (net PnL > $0). Caveat, stated honestly: the profit
is concentrated in the second half (the big +3.74% rally) and a
block-bootstrap of the returns makes the strategy lose — it exploits the
window's temporal momentum structure, which a reshuffle destroys. The
race window is unseen real price action; the strategy is the best of ~40
configurations tested, not a guarantee.

## Files

- `main.py` — the bot (stdlib only, deterministic: no network, clock,
  files, or randomness).
- `vendor/makefun_bars.py` — byte-identical copy of the kit's Python shim
  (`sdk/makefun_bars.py`).
- `LICENSE` — MIT.
- `.makefun/` — freshness anchor (drand round 33978526).

## Run locally

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot main.py --driver process  # node bots only
```

Python bots are verified with the local replay driver instead (see above).
