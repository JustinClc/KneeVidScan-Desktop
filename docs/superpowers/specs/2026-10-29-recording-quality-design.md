# Recording quality, FPS estimates, and Capture preview load

## Problem

On weaker Wi‑Fi, operators see:

1. **Laggy live Capture previews** while a trial is recording (JPEG preview POSTs compete with encode + radio).
2. **Slow post-Stop uploads** (large 1080p / 6 Mbps WebM/MP4 blobs).
3. Risk of **saved trial FPS below ~30**, which hurts later MediaPipe analysis.

Today trial recording is fixed: ideal **1920×1080**, **`videoBitsPerSecond: 6000000`**, camera-default frame rate. Preview profiles already adapt by LAN/public and step down long side when slow, but there is no operator control for recording quality or an emergency preview-off switch.

## Goals

- Prefer **≥30 fps** on the saved trial video; keep **1080p when the link/phones allow it**.
- On **Capture**, offer **Auto + 1080p / 720p / 480p**, each with a **rough FPS estimate**, plus a **recommended** rung.
- **Session-wide** preset (weakest paired phone drives Auto).
- **Light probe** (track settings + small upload bandwidth sample), not a full multi-resolution encode calibrate.
- During recording: **milder** Capture previews (smaller JPEGs, modestly lower FPS — not a hard cut to 2–5 fps).
- **Preview off** toggle usable **during recording**; default on; not persisted across sessions.
- Standing posture stills and standing preview profiles stay **unchanged**.

## Non-goals

- Per-camera quality
- Separate bitrate slider
- Full per-rung camera encode probe
- Default pause of preview
- Chunked/resumable upload redesign
- WebRTC live video
- Changing Standing max-res stills

## Design

### 1. Presets (resolution + bitrate paired)

| Id      | Ideal long×short | `videoBitsPerSecond` |
| ------- | ---------------- | -------------------- |
| `1080p` | 1920×1080        | 6_000_000            |
| `720p`  | 1280×720         | 3_500_000            |
| `480p`  | 854×480          | 1_750_000            |

Operator mode: `auto` | `1080p` | `720p` | `480p`.  
**Resolved** preset is always one of `1080p` | `720p` | `480p`. When mode is `auto`, resolved = recommendation from the weakest phone’s probe.

### 2. Light probe + estimates

Each paired phone, when Capture asks:

1. Reads `MediaStreamTrack.getSettings()` → `width`, `height`, `frameRate`.
2. Uploads a small fixed-size probe body (~64 KiB) to a new authenticated endpoint; measures bytes/sec.
3. POSTs `{ width, height, frameRate, uploadBytesPerSec }` to the store.

Desktop helper (`recordingQuality.ts`):

- `estimateFps(preset, probe) → number` (heuristic; documented as rough).
- `recommendPreset(probes) → '1080p' | '720p' | '480p'`: highest rung whose estimated FPS is ≥30 for **every** phone; if none, highest rung that matches the best achievable estimate (do not force 480p when the camera itself is under 30 fps).
- Weakest phone = the one that forces the lowest recommendation.

Probe runs: on Capture enter, when the paired device set changes, and when the operator taps **Refresh**. Not every Start; not continuous.

### 3. Applying the preset on the phone

- Desktop stores mode + resolved preset; phones learn them via **`GET …/still-request`** (same poll as `livePose` / `standing`).
- Phone applies `applyConstraints` for the resolved ideal size when **not** in a recording session and **not** in standing mode (same guard as today’s standing switch).
- `MediaRecorder` uses the preset bitrate instead of the hard-coded 6 Mbps.
- Standing still path still uses max-res constraints; presets do not apply there.

### 4. Lock window

Operator may change Auto/1080/720/480 only while Capture is **idle**. Locked from Capture **Start** (including the 3 s arm countdown) until **Stop** returns to idle (select + Refresh). Phones still refuse mid-trial constraint changes and skip link probes while recording/uploading; a full “until uploads finish” desktop lock needs per-device upload progress and is deferred.

### 5. Milder preview while recording + preview off

- Add a **capture-recording** preview profile (LAN and public): smaller long side and slightly higher `intervalMs` than today’s Capture profile (target ~10 fps LAN vs ~15, not a collapse to 2–5 fps).
- Phone uses that profile when a trial session is active (`session` set) and mode would otherwise be `capture`.
- `previewEnabled` (default `true`) in session store; phones skip preview encode/POSTs when false **only** in Capture preview modes (`capture` / `captureRecording`). Standing and idle (Pair) always send previews. Desktop Capture shows a clear “Preview off” state on tiles and resets preview on when leaving Capture.
- Toggle may flip **during** recording. Not persisted after leaving Capture / ending the app session.

### 6. Override warning

If the operator’s explicit pick has estimated FPS &lt;30, or is **above** the Auto recommendation, show a one-line caution (no blocking dialog).

### 7. UI placement

**Capture sidebar** only (not Pair): quality select (Auto + three rungs), FPS estimates, recommended badge, Refresh, warning line, preview-off toggle near the existing pose switch.

## Challenges (accepted)

- Estimates are **approximate**; MediaRecorder FPS is mostly device-bound; Wi‑Fi mainly hits preview + upload.
- Weakest-phone Auto can lower strong cameras.
- Milder preview may not be enough on terrible links — preview-off is the escape hatch.
