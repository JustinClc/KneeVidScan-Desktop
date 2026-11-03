# Recording: Stop, temporary storage, MP4, countdown sync, upload status

## Problem

- Pressing **Stop** never reached the phones. `/v1/trials/active` only listed
  armed / recording / stopping trials, so after Stop it answered `{trial:null}`
  and phones kept recording and never uploaded.
- iPhones cannot record WebM, so they never started.
- Uploads were WebM saved under `.mp4` names, held only in memory, with no
  retry and no status.
- The shared start had a 400 ms lead, 400 ms polling and no clock correction.

## Design

### 1. Stop reaches the phones

- `/v1/trials/active` returns the newest trial that is armed, recording or
  stopping, or that ended (`done` / `cancelled`) less than 30 s ago.
- The phone stops and uploads when it sees `done` for its trial, and discards
  when it sees `cancelled`.
- A phone still recording when a different trial appears stops and uploads
  the old one first.
- The phone stops itself at `maxDurationMs` if the desktop is unreachable.
- Recorder chunks belong to one recording, not to the page.

### 2. Countdown and clock sync

- `START_LEAD_MS` is 3000. Desktop and phone show **3, 2, 1**; the desktop
  timer starts at `startAtMs`.
- Stop during the countdown cancels the trial (`POST /v1/trials/:id/cancel`):
  it is not kept in Review and the screen stays on Capture.
- Every `/v1/trials/active` reply carries `server_now`. The phone computes
  `offset = server_now − (t0 + t1) / 2`, keeps the sample with the smallest
  round trip among the last 10, and starts at `startAtMs − offset` on its own
  clock.

### 3. Format

- The phone records the first supported of `video/mp4;codecs=avc1`,
  `video/mp4`, `video/webm;codecs=vp9`, `video/webm`. Recorder errors are
  shown on the phone.
- The backend sniffs the file: WebM (`1A 45 DF A3`) or MP4 (`ftyp` at byte 4).
- WebM is re-encoded in the background with the bundled ffmpeg
  (`-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -movflags +faststart -an`)
  and the WebM is deleted. MP4 is kept as-is.

### 4. Temporary storage

- Uploads stream to `<temp>/motuscap-lite/<launch-id>/<trialId>/<deviceId>.mp4`
  through a `.part` file that is renamed when complete.
- After a successful Save the desktop calls
  `DELETE /v1/trials/:id/recordings`; the files go and the cameras read
  `cleared`.
- `close()` removes the launch folder (Electron `before-quit`). On start the
  server removes other launch folders, but only when main passes the
  recordings root explicitly; tests use their own temp folders.
- ffmpeg ships as `assets/ffmpeg/` via forge `extraResource`, copied by
  `scripts/fetch-ffmpeg.mjs` (`--platform=win32` downloads the Windows
  binary for `make:win` on a Mac).

### 5. Upload status

- Cameras paired at Start are the trial's participants. Each has a status:
  `recording → uploading → converting → ready`, or `failed` (with an error),
  or `cleared` after Save.
- A camera with no upload activity for 60 s after Stop is `failed`.
- The phone retries 3 times (2, 4, 8 s), then reports
  `POST /v1/devices/:id/trials/:tid/upload-error` and shows **Retry**.
- Review shows each camera's status.
- Save waits while any camera is recording / uploading / converting, shows
  progress, writes only ready videos, and names failed cameras instead of
  writing placeholder files.

## Tests

- Backend: Stop visible to phones, `server_now`, cancel, upload on disk,
  WebM→MP4 conversion (skipped without ffmpeg), 60 s failure, upload-error,
  cleanup after Save, startup sweep, `close()` cleanup.
- Phone helpers: format pick and clock offset, run in a VM.
- App: countdown, cancel during countdown, Review statuses, Save waiting and
  naming a failed camera.
