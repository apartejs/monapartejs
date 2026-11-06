# ADR-016 — Read the next turn ahead when a turn changes the conversation's files

- **Date**: 2026-11-06
- **Status**: proposed.
- **Context**: after ADR-015 the chat resumes its prompt after a tool turn, but the plain message that follows a
  document still re-read everything: 45 s with the M5's GPU, 136 s without. The render tool registers the file it
  produced, and from the next user turn on the system message lists it in "Files available" — the contract wants it
  there: the F16 edit rows train on it (`aparte-repetitions/lab/2026-11-f16-round/gen_f16_chat.py`), and the render
  result carries no file id. LFM3's template puts the tools after the system text in the same block: the files block
  sits at token ~142, the 1,590 tokens of tools and the whole history come after it, and a change there invalidates
  all of them. No engine setting avoids it: LFM3's cache is restored only from checkpoints, and a checkpoint before the
  files block would save 142 tokens.
- **Decision**: after a final answer (no tool call) whose files list differs from the one the turn was sent with, the
  provider reads the next turn's prompt in the background: the new system message, the history the turn was sent
  with, and the generation prompt — which opens the answer's own turn, so the follow-up finds all of it in the cache
  and reads only the answer and the new message. It runs silently (no status) while the user reads the document. Any
  operation the provider queues stops it (an abort between two batches); llama.cpp keeps the batches already read,
  and a read-ahead not yet started is never sent. The app gives the provider the list the next request will carry
  (`setNextTurnFiles`, the request interceptor's own source).
- **Consequences**: the follow-up waits for what the user's reading time did not cover, never more than before — at
  worst one batch of a read-ahead it did not need (a new attachment changes the list again; another conversation).
  A batch is 512 prompt tokens (`n_batch`, one ubatch): llama.cpp's default of 2,048 read the first ~1,300 tokens of
  a read-ahead in one call, and wllama sees an abort only between two (found in review; ~12 s with the M5's GPU,
  ~37 s without, instead of ~30 s / ~90 s). The device keeps working for up to 45 s / 136 s after each document even
  when the user leaves. A new file attached by the user is not helped: its list changes at send time.
- **Rejected / left to the lab**: keeping the system message fixed for the whole conversation (the produced id in
  the render result, as the 0.3 data had it) removes the re-read at its root, and so would fewer tool tokens (1,590 of
  the 1,775 of a cold prompt, 1,115 of them descriptions) — both are contract changes and a retraining, the lab's call
  (rule 2), written up in `aparte-repetitions/lab/2026-10-lfm3-bench/m5-prompt-cache-2026-11-05.md`.
- **Evidence**: the app on the M5 (headless Chromium, c0.9 + v0.9, `~/bench-lfm/out/after5-*` and `after2-*` on the
  M5), a pause after each document as a user reads it; "without" is this branch before the read-ahead:

  | plain follow-up after the first document, first word | without | with the read-ahead |
  |---|---|---|
  | GPU, sent at once | 45.1 s | 34.2 s |
  | GPU, 30 s of reading | 44.8 s | 4.5 s |
  | GPU, 60 s of reading | – | 1.4 s |
  | CPU, 60 s of reading | 136 s (sent at once) | 73.2 s |

  Sent at once, the read-ahead still helps: the follow-up waits for its current batch, then finds those tokens in
  the cache. The answer itself is unchanged — c0.9 refuses that request after a document either way
  (`FRICTIONS-MODELE.local.md`, F17).
