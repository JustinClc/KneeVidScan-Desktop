# Live 2D pose on Capture

## Goal

When **Real-time 2D pose** is on, every camera tile on Capture shows the real
MediaPipe skeleton for that phone, before and during recording. Today the
overlay is a fixed placeholder skeleton fed by ~2 fps previews.

The overlay stays desktop-only: it is never burned into recordings, Save, or
Export.

## Phone: live-pose preview rate

- New desktop heartbeat `POST /v1/devices/:id/live-pose-mode` with
  `{ "active": boolean }`, stored with the same 6 s expiry as standing mode.
- The phone's existing `GET /v1/devices/:id/still-request` poll (every 400 ms)
  also returns `livePose: boolean`.
- Preview interval on the phone: standing 66 ms (unchanged) → live pose
  100 ms (~10 fps) → idle 400 ms. Live pose keeps the 320 px long side and
  JPEG quality 0.55. The camera stream and recorder are not touched.
- Capture sends the heartbeat for every paired device every 2 s while the
  toggle is on, and `active: false` when the toggle goes off or Capture
  unmounts.

## Desktop: model

- `loadLiveLandmarker(backendBase)` in `src/lib/mediapipePose.ts` loads
  `pose_landmarker_lite.task` once (GPU, falling back to CPU), IMAGE mode, one
  pose. It is shared by all tiles and separate from Subject's Full model.
- `scripts/fetch-mediapipe.mjs` downloads both the Full and Lite models.

## Desktop: tiles

- With the toggle on, each tile long-polls `nextPreview` for its device
  instead of polling every 500 ms. Each frame is detected when its image
  loads; the backend always hands out the newest frame, so stale frames are
  skipped and the overlay never trails the video.
- Tag text per tile:
  - **2D pose · loading** — model still loading
  - **2D pose · live** — a person is detected
  - **2D pose · no person** — model ready, no person in this camera
  - **2D pose · unavailable** — model failed to load; no skeleton
- The placeholder skeleton is removed from the live overlay
  (`createLivePoseSession` / `bootstrapLivePoseLandmarker`).
- With the toggle off, tiles keep the 500 ms preview polling and draw no
  overlay. Review is unchanged.

## Testing

- Server: live-pose heartbeat sets and clears `livePose` on the phone poll.
- Phone script: still parses; `livePose` selects the 100 ms interval.
- App: with an injected Lite model, toggling on and loading a frame shows the
  **live** tag and keeps the overlay canvas; toggling off removes both. With no
  model, tiles show **unavailable**. The toggle heartbeat is sent on and off.
