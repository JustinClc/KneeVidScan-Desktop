# Plan: recording stop, temp storage, MP4, sync, upload status

Spec: `docs/superpowers/specs/2026-10-24-recording-stop-upload-sync-design.md`

1. **Deps.** Add `ffmpeg-static` with `pnpm.onlyBuiltDependencies`;
   `scripts/fetch-ffmpeg.mjs` copies the binary to `assets/ffmpeg/`
   (git-ignored, forge `extraResource`), wired into start / package / make.
2. **Backend recordings module** (`src/backend/recordings.ts`): launch folder,
   sweep, streamed `.part` write, format sniff, ffmpeg convert, per-trial
   delete, close cleanup. Unit tests first.
3. **Store + routes.** Trial participants and per-camera status with the 60 s
   rule; `cancelTrial`; `/v1/trials/active` 30 s window + `server_now`; upload
   streaming; `upload-error`; `DELETE /v1/trials/:id/recordings`; GET upload
   served from disk. Server tests first.
4. **Phone script.** Testable helpers (format pick, clock offset); per-recording
   session; countdown; stop/cancel/new-trial handling; auto-stop; upload
   retries with Retry button; recorder errors.
5. **Desktop.** `START_LEAD_MS = 3000`; Capture countdown and cancel; Review
   per-camera status; Save waits, names failures, deletes recordings after
   success; backendClient additions. App tests first.
6. **Main.** Pass recordings root and ffmpeg path to `startLiteServer`.
7. Verify with `pnpm test`, `pnpm typecheck`, oxlint/oxfmt on changed files.
