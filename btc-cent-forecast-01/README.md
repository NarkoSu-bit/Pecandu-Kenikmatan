# btc-cent-forecast-01 — Fade the 24h and 4h returns

Forecasts Bitcoin's price 4 hours ahead by fading (going against) the trailing
24-hour and 4-hour log-returns:

```
forecast = last_close * exp(-0.18 * r24h - 0.12 * r4h)
```

## Why

At a 4-hour horizon BTC mean-reverts rather than trends: a rise over the last
day predicts a small pullback over the next 4 hours, and a fall predicts a
small bounce. The house baseline (persistence — guess the price does not move)
ignores that. Backtested on the kit's practice data (Nov 7–11, 2026):

| backtest | model MAE | persistence MAE | improvement |
|---|---|---|---|
| 256 checkpoints, every 15 min, Nov 8–10 | 37,594 ¢ | 41,248 ¢ | **−8.86%** |
| 961 checkpoints, every minute, Nov 10 | 48,157 ¢ | 52,551 ¢ | **−8.36%** |

The edge holds on each of the three days separately (Nov 8 −11.6%, Nov 9 −9.5%,
Nov 10 −7.1%). Positive momentum, reverting to a 48h/72h moving average, and
scaling the fade by move size or volatility were all tested and rejected —
each made the forecast worse than persistence.

## Running it

Python 3.13, standard library only, no network, deterministic:

```
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out python3 main.py
```

Reads every `*.in` in the input directory and writes one `<id>.out` per case:
`{"forecasts":[{"case":"<id>","price":<number>}]}`.

## Files

- `main.py` — the forecaster (the whole entry).
- `LICENSE` — MIT.
