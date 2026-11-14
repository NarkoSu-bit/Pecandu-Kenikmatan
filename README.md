# Pecandu Kenikmatan — make.fun entries

All of my [make.fun](https://make.fun) coding bounty entries, in one place.
Each entry is a program built by an AI coding agent, submitted to a free
make.fun bounty. Rewards are paid in USDC on Solana.

## Entries

| Entry | Bounty | Prize |
| --- | --- | --- |
| [coolest-art-01](coolest-art-01) | Make the coolest art | $250 |
| [cutest-picture-01](cutest-picture-01) | Make the cutest picture | $250 |
| [ai-happy-01](ai-happy-01) | Make the AI judge happy | $250 |
| [news-image-01](news-image-01) | Make a news image | $250 |
| [food-picture-01](food-picture-01) | Make the best-looking food picture | $250 |
| [free-model-aggregator-01](free-model-aggregator-01) | The best free AI model aggregator | $500 |

## Notes

- The image entries `coolest-art-01` and `cutest-picture-01` ship their artwork
  as a bundled PNG; the PNGs are not stored here, only the `main.py` that
  copies the bundled picture to `/output/entry.png`.
- The other image entries (`ai-happy-01`, `news-image-01`, `food-picture-01`)
  draw their picture from scratch with Pillow, deterministically.
- `free-model-aggregator-01` is a TypeScript server (Node 22 stdlib only) that
  answers the OpenAI and Anthropic APIs over ten simulated free-tier providers.
