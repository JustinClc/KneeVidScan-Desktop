# KneeVidScan-Desktop

Chinese name: **膝關照-桌面版** (shown when a Chinese interface language is selected).

Desktop motion-capture operator app (Electron): connect 1–3 USB/computer cameras or wireless phone cameras in any combination, optional IMUs (UI this phase), record synced trials, per-camera 2D/3D pose via MediaPipe on the desktop.

**Windows `.exe` first; macOS lower priority.**

## Docs

- [docs/CONTEXT.md](docs/CONTEXT.md) — product glossary and rules
- [docs/DEVELOPMENT-PLAN.md](docs/DEVELOPMENT-PLAN.md) — phased plan (**approved** 2026-10-19)
- [docs/PROGRESS.md](docs/PROGRESS.md) — phase checklist
- [docs/UI-CHECKLIST.md](docs/UI-CHECKLIST.md) — screen handoff checklist

## Prerequisites

- Node.js 20+ (22 recommended)
- [pnpm](https://pnpm.io/) 10+

## Install

```bash
pnpm install
```

## Start (dev)

```bash
pnpm start
```

Opens the Electron shell and starts a **local HTTPS backend** for phone pairing. Optional: `MOTUSCAP_DEVTOOLS=1 pnpm start` to open DevTools.

For HTTP-only (not usable for real phone cameras): `MOTUSCAP_HTTP=1 pnpm start`.

## Pair cameras + phone HTTPS (Phase 1)

1. Open **Pair cameras** from Home or any assessment page. For USB/computer cameras, click **Refresh cameras**, select an input, then **Connect camera**. Allow camera access in the operating system when prompted. Built-in cameras are available in the same list.
2. For a wireless phone, click **Pair a device**. The desktop shows one QR (one camera).
3. On the phone, scan the QR (or open the URL shown in the backend log). The PWA is served over **HTTPS** on your LAN so `getUserMedia` works.
4. Tap **Complete pairing** on the phone. Desktop slots update (Cam1 Frontal / Cam2 Lateral right / Cam3 Additional). Single camera = no `_F/_L/_O` filename suffix.
5. To use another camera on the same phone (e.g. front instead of back), pick it in the phone's **Camera** list. It stays paired in the same slot. The list is locked from the start of a trial's countdown until its video has uploaded, and while a photo is being sent.
6. Use **Pair with next device** for up to **3** cameras.
7. Without camera hardware: use **Simulate phone (no camera)** to exercise pairing.
8. Click **Done** to return to the page that opened camera settings. On Home, **Start Assessment** opens the required **Health questionnaire**, followed by standing photos.

### Assessment flow

Home → Health questionnaire → Standing photos → Recording → Recording review → Pose estimation.

Submitting the questionnaire asks for a parent folder and immediately creates `YYYY-MM-DD_Name-or-ID` (local date; whitespace in Name/SID becomes hyphens). Existing names receive `_2`, `_3`, etc. All questionnaire answers are saved in `questionnaire.json`. **Standing Posture Capture** uses those subject details without repeating the fields. Its review image blurs detected facial landmarks and overlays hip–knee–ankle centers and connections on both sides for frontal photos, or only the corresponding anatomical side for lateral photos. If facial landmarks are unavailable, the whole review image is blurred, with detected joints still annotated. **Save & Continue** writes the accepted blurred and annotated preview (`*_standing_F/LL/RL_annotated.png`) and the clean full-resolution original (`*_standing_F/LL/RL_full.png`) for each view into the questionnaire folder without another folder prompt.

The report page and its **End Assessment** action will be implemented later. There are no **+ New Subject** controls or completion button on Pose. Camera pairing is outside the assessment steps. **Pair cameras** is available on Home and every assessment page, with a **! No camera paired** warning when there are no paired devices. Questionnaire entry is allowed without a camera; photo capture and recording require a camera. **Done** returns to the originating page, preserving questionnaire answers, accepted photos, review position, and pose progress. Opening camera settings during recording requires confirmation and stops the recording; standing auto-capture is suspended while camera settings are open. The assessment-reset action clears subject answers, photos, and trials and returns Home while retaining camera connections; it is reserved for the future report page.

USB cameras use the same JPEG preview/still and full-resolution recording pipeline as phones. They start against the same desktop countdown timestamp, upload MP4 or WebM locally (WebM is converted by ffmpeg), and remain connected across page navigation. This is software synchronization; USB and phone hardware still need a real-device timing check. A disconnected USB camera is flagged and must be removed and reconnected on Pair cameras. Camera connections last for the app session; after a renderer reload, USB inputs must be connected again.

### Trusting the local certificate

The backend uses a **self-signed** cert that includes localhost + LAN IPs.

- iOS/Android will warn on first open — continue/trust for this host (lab use).
- Prefer keeping phone and laptop on the same Wi‑Fi; the QR encodes `https://<lan-ip>:<port>/pwa/?api=…&device_pairing_id=…&device_pairing_code=…`.
- Optional hardening later: [mkcert](https://github.com/FiloSottile/mkcert) trusted local CA (not required for Phase 1).

### Capture / sync

On **Capture**, **Start** shows a **3, 2, 1** countdown on the desktop and every phone, then all phones begin at the shared `startAtMs` (≤5 frames skew OK). Each phone corrects for its clock offset using the desktop time in its trial poll. **Stop** during the countdown cancels the trial. Trial max **3 minutes**; phones also stop themselves at the limit.

Phones record MP4 when the browser supports it (always on iPhone), otherwise WebM. On Capture, operators pick trial recording quality (**Auto**, **1080p**, **720p**, **480p**); standing stills stay max-res. After Stop each phone uploads full-res (3 retries, then a **Retry** button). Uploads go to `<temp>/motuscap-lite/<launch>/<trial>/` on the desktop; WebM is re-encoded to H.264 MP4 with the bundled ffmpeg. A trial's temp videos are deleted after a Save that wrote every video, and the whole launch folder on quit. The desktop shows **low-res JPEG previews** while recording (preview can be turned off without affecting the recorded file).

## Test

```bash
pnpm test
```

## Package (Windows `.exe`)

Primary packaging path uses Electron Forge **maker-squirrel** (Windows installer `.exe`):

```bash
# Produce installers for the host platform (on Windows → Squirrel .exe)
pnpm make

# Explicit Windows target (cross-build may require Wine on Linux/macOS)
pnpm make:win
```

`start`, `package` and `make*` first copy MediaPipe and ffmpeg into `assets/` (`pnpm mediapipe:assets`, `pnpm ffmpeg:assets`). `make:win` downloads the Windows ffmpeg, so it also works from a Mac.

Output lands under `out/make/`. The Windows setup executable is named `KneeVidScan-Desktop-Setup.exe`.

### macOS (lower priority)

```bash
pnpm make:mac
```

Produces an unsigned zip via maker-zip.

## Package layout

Single package at repo root (`kneevidscan-desktop`):

| Path               | Role                                        |
| ------------------ | ------------------------------------------- |
| `src/main.ts`      | Electron main process (starts Lite backend) |
| `src/preload.ts`   | Preload / IPC bridge                        |
| `src/backend/`     | Local HTTPS API + phone PWA                 |
| `src/lib/`         | Roles, pairing, sync, naming helpers        |
| `src/screens/`     | Six-step UI screens                         |
| `src/renderer.tsx` | React entry                                 |

## Phase status

- **Phases 0–4 (merged):** Electron shell, pairing/sync, Subject & standing, Capture/Review/Save, Pose full-res re-run
- **Phase 5 (this work):** IMU operator UI only — any subset of Femur L/R · Tibia L/R; empty panels until backend; `_IMU.csv` naming helpers (no write)
- Later: IMU backend (BLE, clock sync, resample, CSV write, playback)

### Capture / Review / Save

1. After Subject, **Capture** — trial name, **Auto / 1080 / 720 / 480** recording quality, Start/Stop (max **3 minutes**), optional real-time 2D pose on **low-res preview** (can disable preview; MediaPipe soft stub when WASM unavailable).
2. On Stop, phones upload full-res; **Review** shows each camera's video status (uploading, converting, ready, failed) with the shared scrubber + **trial picker** (all trials kept). **Record another** or **Proceed to pose reconstruction**.
3. **Save Subject & continue**, after all three stills, opens a choice: select an existing subject folder, or create a new one under a parent directory. The six PNGs and a subject-info CSV are written into the existing folder, or into `<parent>/<subject id>_<name>/` when creating a new one. **Save** on Pose writes that trial’s **original** `.mp4`s (no overlay) into `<subject folder>/<trial>/` and does not write the photos again. A camera whose video failed is named in the result instead of getting a placeholder file. Single-cam: no view suffix. IMU CSV skipped until backend.
4. **Export** per camera: 2D CSV (normalized x/y), 3D CSV (MediaPipe metres), OpenSim TRC, or raw JSON. No overlay on videos.

### Final report

**Proceed** on Pose Estimation saves each trial’s original videos into the subject folder before opening the report. Failed saves keep the assessment open for retry; temporary copies remain available for review until the assessment ends. The desktop report follows the supplied report sections, using the saved annotated posture images and clearly marked example analysis values. **Export report (PDF)** creates an A4 report in the selected app language, saves it in the subject folder, opens it in the default PDF viewer, and shows the saved path. **End assessment** clears the assessment and returns Home while preserving saved files and paired cameras.
