# MotusCap Lite — Development plan

**Status:** **Approved** by Justin on 19 Oct 2026 (Asia/Hong_Kong). Docs may land on `main`; Phase 0 may start after docs commit.  
**Repo:** https://github.com/JustinClc/MotusCap-Lite

**Deliverable:** Electron desktop app. **Windows `.exe` installer first.** macOS **lower priority** (follow-on, not blocking Windows v1).

**UI:** Open Design six-step demo.

---

## Locked decisions (Justin, 2026-10-19)

1. **Electron** (not Tauri)
2. Windows packaging: **`.exe` installer**
3. macOS: **lower priority** than Windows
4. Pose re-runs MediaPipe on **full-res** uploads
5. Trial max **3 minutes**
6. 3D export: **MediaPipe units**
7. **Trial picker**; keep all trials in a session
8. Filenames: spaces → **hyphens**
9. Single camera: **no** view suffix
10. Posture PNGs: `standing_F / LL / RL`
11. One IMU CSV with **all connected** sensors' channels
12. Save whatever IMUs are connected (1–4 OK)
13. After standing: prompt to **face frontal again**
14. **Save asks for a destination folder**
15. Non-ASCII names **keep as typed** (spaces → hyphens only)
16. IMU UI: **empty panels** until backend (no fake traces)

---

## Phase 0 — Scaffold + docs + Electron shell

- Land `docs/` after approve: CONTEXT, DEVELOPMENT-PLAN, PROGRESS, UI-CHECKLIST
- Electron + local backend (MotusCap shape)
- Port six screens
- Packaging: Windows `.exe` primary CI; macOS builds later / lower priority
- MediaPipe wheels: plan Windows first; add macOS when that track starts

**Exit:** Windows app opens; six screens with stub data.

---

## Phase 1 — Camera pairing & sync

- [x] Adapt MotusCap pairing as reference only (Lite modules; no MotusCap source copy)
- [x] 1–3 cams; one QR each; F / L(right) / O; single cam front, no file suffix
- [x] Shared start ≤5 frames; preview to desktop; full-res upload after trial
- [x] Local HTTPS for phone `getUserMedia` + documented Pair / phone flow

**Exit:** pair, record ≤3 min, previews + full-res available. Merged on `main` via PR #2.

---

## Phase 2 — Subject & standing posture

- [x] Required Subject ID; load existing retakes postures
- [x] F → LL → RL on frontal only; near-side MediaPipe landmark rules (stub gate when WASM unavailable)
- [x] Clean PNGs; then prompt face frontal again
- [x] Prefer phone full-res still at capture; else best preview still (no overlay)

**Exit:** three PNGs saved; Continue → Capture. (Draft PR; merge held for Justin.)

---

## Phase 3 — Capture, Review, Save / Export

- [x] Capture sidebar + live 2D pose on preview (MediaPipe soft stub OK)
- [x] Review: synced scrubber, **trial picker**, Record another
- [x] Save: ask once for a subject folder; original mp4s go in `<folder>/<trial>/` (posture PNGs are not written again; IMU CSV when backend exists — skipped for now)
- [x] Export: pose CSV/JSON; no overlay videos

**Exit:** correct naming; Save to user-chosen folder. (Merged [PR #4](https://github.com/JustinClc/MotusCap-Lite/pull/4).)

---

## Phase 4 — Pose estimation page

- [x] Left: Lite/Full/Heavy, Skeleton (scale-to-height view-only + lock hips), smoothing, detection/presence/tracking, Re-run on **full-res**
- [x] Right: cam tabs F/L/O; 3D orbit/pan/zoom + Reset; Video·2D overlay (view only); shared Frame n/N scrubber; trial picker
- [x] Export CSV/JSON in **raw MediaPipe units** (hip-centred; not height-scaled); original videos no overlay
- [x] Soft MediaPipe stub when WASM unavailable (reuse `attachLandmarker` pattern)
- [x] No fusion / triangulation / IMU→pose
- [x] Real per-camera `worldLandmarks` (VIDEO mode, one landmarker per camera). Lite / Full / Heavy bundled. Smoothing and confidence settings applied. Empty frames stay aligned across views
- [x] Export per view or all views: `_pose2d.csv` (normalized x/y plus `_p`), `_pose3d.csv` (raw metres), `_pose3d.trc` (OpenSim metres, Y up, Pose2Sim MediaPipe marker names)

**Exit:** re-run updates selected trial’s views; exports OK. (Merged [PR #5](https://github.com/JustinClc/MotusCap-Lite/pull/5). Real 3D and the landmark files landed after that.)

---

## Phase 5 — IMU UI only

- [x] Pair: empty **No IMUs paired** + **Scan & connect IMUs** → chips Femur L/R · Tibia L/R (any subset); Continue with cameras alone (**IMUs optional**)
- [x] Session `connectedImus` persists Pair → Capture → Review → Pose (UI state only)
- [x] Capture: **IMU signals · live** panel only when slots connected; empty dashed charts; no Recalibrate; no fake traces
- [x] Review: **Recorded IMU traces** only when connected; **No recording yet** per slot; no parked playhead on empty panels
- [x] Naming helpers for future `_IMU.csv` (`timestamp` + `FemurL_ax` …); Save still skips write
- **Deferred (out of this PR):** BLE / device discovery, clock sync, resample, streaming samples, `_IMU.csv` write, scrubbed playback, IMU→pose fusion

**Exit:** any subset of 1–4 slots works in UI; empty panels everywhere until backend. ([Draft PR #6](https://github.com/JustinClc/MotusCap-Lite/pull/6); merge held for Justin.)

---

## Phase 6 — Real standing posture capture

Replaces the timed stub gate on Subject & standing posture. Decisions locked with Justin on 19 Oct 2026.

**Live view (frontal cam only)**

- Desktop MediaPipe Pose (**Full** model), bundled offline (WASM + `.task` in app resources); runs on preview frames
- While on Standing: phone switches to its **largest video stream** (up to 4K) and boosts preview to ~960 px long side, JPEG 0.65, up to ~15 fps (one upload in flight, so it slows itself on a weak link; desktop long-polls each new frame); reverts to low-res when leaving Standing
- Feed is **contain**-fit (letterboxed); portrait and landscape both supported
- Guide rectangle: fixed aspect **1 : 2.2**, **90 %** of image height, centred, positioned in image coordinates
- Skeleton overlay on live view for the operator only; never saved

**Approval gate** — all required landmarks visible **and inside the rectangle** (≈2 % margin), held ~0.5 s

| Posture       | Required MediaPipe landmarks                                                 |
| ------------- | ---------------------------------------------------------------------------- |
| Frontal (F)   | eyes 2/5, shoulders 11/12, hips 23/24, knees 25/26, ankles 27/28, toes 31/32 |
| Left lateral  | left ear 7, shoulder 11, hip 23, knee 25, ankle 27, heel 29                  |
| Right lateral | right ear 8, shoulder 12, hip 24, knee 26, ankle 28, heel 30                 |

Green → 3 s countdown; losing a landmark mid-countdown aborts back to red.

**Capture + review**

- After countdown, phone grabs one frame from the full-res stream (no `takePhoto`, so the frame matches the preview exactly on Android and iOS)
- Desktop crops to the rectangle, re-runs MediaPipe on the crop, and shows the still in place of the live view; missing parts show a **warning** (e.g. "Left heel not detected") but do not block
- **Proceed** saves `…_standing_X.png` (cropped) + `…_standing_X_full.png` (original) and advances; **Retake** discards and returns to live gating for the same posture
- Phone sends the still as JPEG 0.95 (~2–4 MB at 4K vs 10–25 MB PNG) and pauses preview uploads meanwhile; desktop saves both files as PNG
- Phone not picking up the request within **5 s**, a phone-reported error, or no still within **30 s** → "Photo not received from phone" (with the reason) + Retake; never save a preview frame or placeholder
- Strictly linear F → LL → RL; retake returns to live gating for that posture; face-frontal prompt after the third Proceed

**Fallbacks**

- MediaPipe fails to load → "Pose detection unavailable" + manual **Capture now** (same countdown + review)
- Stub checker is test-injectable only, never a silent production fallback

**Exit:** real gate passes/fails on live subject; three cropped + three full PNGs saved only on Proceed; Retake works; Capture recording unaffected.

---

## Approval

- [x] Justin replies **approve** — 19 Oct 2026 (Asia/Hong_Kong)
- [x] Docs on `main` under `docs/`
- [x] Phase 0 may start
