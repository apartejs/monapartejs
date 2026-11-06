# ADR-017 — The vision encoder joins the souffleur set's load at the turn that may read an image

- **Date**: 2026-11-06
- **Status**: proposed. Supersedes ADR-015's "Vision stays a load of its own (base + mmproj)".
- **Context**: an image turn swapped the model twice — the base and the mmproj alone for the description, then the
  set again — and the chat's prompt cache went with it: the closing sentence after a description waited 57 s with
  the M5's GPU (first visible text of the turn 51 s, the turn 145 s). On a native llama-server built from the same
  llama.cpp source, the set and the mmproj in one load (two adapters loaded without being applied, two slots not
  unified, `swa_full`): the chat turn read 1,783 tokens, the description 778 in the other slot, and the closing turn
  230 — 1,828 found in the cache.
- **Decision**: a chat turn whose files hold an image, on WebGPU, carries the mmproj once it is in the cache (a
  download belongs to the description, with its progress, and a failed one to `read_file`): if the load lacks it, the engine
  reloads the set with it — at a turn that re-reads its prompt anyway, the files list having changed — and the
  description then runs in that load. A load that has the encoder keeps it for the turns that follow (the key is the
  base and the device; the encoder is a superset). A description on a load without it loads it with the set's cached
  adapters, so the turn after it reloads nothing. The description names one adapter at scale 0 (`lora: [{ id: 0,
  scale: 0 }]`): a request naming none runs every adapter at its load scale — llama.cpp's default, 1 in wllama's load
  — and an empty list falls back to that default; measured natively, the description then differed from the base's,
  and with every adapter at 0 it is the base's, word for word. The encoder never costs a souffleur's turn: if it
  cannot be read from the cache or the load fails with it (memory), the turn loads the set without it and the
  following turns stop asking for it; only the description then tries again, and its failure is `read_file`'s.
- **Consequences**: one reload per image turn instead of two, none for the next ones in the session; the closing
  sentence resumes the chat's cache. The encoder (270 MB) stays in memory once an image was read, until the page is
  reloaded. CPU devices are untouched (no image reading without WebGPU). A turn's status is "generating" from the
  engine's `ready`, not "loading" until its end after an expert or a description ran.
- **Evidence**: `aparte-repetitions/lab/2026-10-lfm3-bench/vision_same_load.sh` (the native check, written up in
  `m5-prompt-cache-2026-11-05.md`); the app on the M5:

  | an image turn after a document, the app on the M5 (GPU, c0.9 + v0.9) | before, 30 s of reading | encoder in the set, 30 s | 60 s |
  |---|---|---|---|
  | first word | 50.5 s | 65.3 s | 56.7 s |
  | its closing sentence, time to first token | 57.2 s | 6.2 s | 6.2 s |
  | the turn, total | 144 s | 98.9 s | 90.2 s |
  | the message after it, first word | 1.4 s | 1.4 s | 1.6 s |

  The first word comes later: the reload with the encoder is at the turn itself (~6 s), and with 30 s of reading the
  read-ahead of the document before it is stopped within its batch (ADR-016). The turn's answer is the same, word
  for word.
