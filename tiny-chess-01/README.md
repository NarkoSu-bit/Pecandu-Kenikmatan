# tiny-chess-01

A chess engine in at most 4,096 bytes of Python (this entry: 4,068 bytes).

A compact 0x88-board engine: negamax with alpha-beta pruning, quiescence
search (captures and check evasions), a Zobrist transposition table,
killer-move ordering, MVV-LVA capture ordering, iterative deepening to a
fixed node budget, and a tapered material + piece-square evaluation.

## Run it

```sh
python3 main.py
```

The program speaks the make.fun tiny-chess-01 environment protocol
(`MAKEFUN_ENV_URL`): it plays games against the house gauntlet through
`POST /game` and `POST /move`.
