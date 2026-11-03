# MotusCap Lite — Progress

Last updated: 2026-10-25 (HKT)  
Overall: **In progress** — Phases 0–4 merged on `main`; Phase 5 IMU UI in [draft PR #6](https://github.com/JustinClc/MotusCap-Lite/pull/6).

| Phase | Item                       | Status        | Notes                                                                                                                                                                                                                                                              |
| ----- | -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| —     | Alignment Q&A              | Done          | Electron, Win `.exe`, macOS lower priority, full-res Pose, etc.                                                                                                                                                                                                    |
| —     | Plan approval              | Done          | Justin: Approve — 19 Oct 2026 (Asia/Hong_Kong)                                                                                                                                                                                                                     |
| —     | Repo                       | Done          | https://github.com/JustinClc/MotusCap-Lite                                                                                                                                                                                                                         |
| —     | Docs on `main`             | Done          | README + docs/CONTEXT, DEVELOPMENT-PLAN, PROGRESS, UI-CHECKLIST                                                                                                                                                                                                    |
| 0     | Electron shell + UI port   | Done (merged) | [PR #1](https://github.com/JustinClc/MotusCap-Lite/pull/1) merged to `main` — Forge + Vite + React; six screens; empty IMU panels                                                                                                                                  |
| 0     | Windows `.exe` packaging   | Done (merged) | `pnpm make` / `pnpm make:win` via maker-squirrel → `MotusCap-Lite-Setup.exe`                                                                                                                                                                                       |
| 0     | macOS packaging            | Done (merged) | maker-zip present; unsigned; lower priority                                                                                                                                                                                                                        |
| 1     | Camera pairing & sync      | Done (merged) | [PR #2](https://github.com/JustinClc/MotusCap-Lite/pull/2) merged to `main` — local HTTPS backend, one QR/device, max 3, F/L/O roles, shared start, low-res preview, phone PWA                                                                                     |
| 2     | Subject & standing posture | Done (merged) | [PR #3](https://github.com/JustinClc/MotusCap-Lite/pull/3) merged to `main` — Subject ID required; load-existing retake; F→LL→RL on frontal; guide red→green + 3s; clean `standing_F/LL/RL` PNGs; face-frontal prompt; MediaPipe landmark rules + soft stub gate   |
| 3     | Capture / Review / Save    | Done (merged) | [PR #4](https://github.com/JustinClc/MotusCap-Lite/pull/4) merged to `main` — Capture ≤3 min + live 2D pose on preview; Review scrubber + trial picker. Posture photos are saved once from the Subject page into the subject folder. Pose Save writes that trial’s videos into `<folder>/<trial>/` and does not write the photos again. IMU CSV skipped until backend |
| 4     | Pose (full-res re-run)     | Done (merged) | [PR #5](https://github.com/JustinClc/MotusCap-Lite/pull/5) plus real per-camera worldLandmarks (VIDEO mode, Heavy bundled), smoothing applied, and `_pose2d.csv` / `_pose3d.csv` / `_pose3d.trc` export. Soft stub when WASM or the upload is missing              |
| 5     | IMU UI shells              | In progress   | Draft PR — Pair any subset of Femur L/R · Tibia L/R (UI mock); Capture/Review empty panels only when connected; `_IMU.csv` naming helpers only; **no** BLE / clock / resample / CSV write / playback                                                               |
| Later | IMU backend                | Not started   | Deferred — BLE pairing, clock sync, resample, `_IMU.csv` write, scrubbed playback                                                                                                                                                                                  |

## Defaults (until Justin overrides)

- Non-ASCII subject names: keep as typed; spaces → hyphens
- IMU UI: empty panels (no fake traces) until backend module
- Pose export: raw MediaPipe units (hip-centred); scale-to-height is view-only

## How to update

Sucrose updates this table after each merge. Do not track progress only in chat.
