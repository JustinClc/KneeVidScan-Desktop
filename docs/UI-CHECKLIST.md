# MotusCap Lite — UI checklist

Source: Open Design demo `~/Documents/MotusCap-Lite-OpenDesign/`.  
Use this for design ↔ eng handoff. Check items when the desktop app matches the demo.

## Global

- [ ] Branding: MotusCap Lite, Lite colour tone (blue lighter than MotusCap)
- [ ] Electron desktop shell; Windows primary
- [ ] Six-step stepper: New Session → Pair → Subject → Capture → Review → Pose
- [ ] No Space / calibration step; no T-pose

## 01 New Session

- [ ] Create / open session fields
- [ ] Recent sessions list (sample OK in demo)

## 02 Pair

- [x] 1–3 camera slots; one QR per device; Pair with next device
- [x] Cam1 Frontal, Cam2 Lateral (right), Cam3 Additional
- [x] Single camera: place in front; no view suffix in filenames later
- [x] Optional IMU UI: Femur L/R, Tibia L/R (1–4 any subset); Continue without IMUs; summary **IMUs optional**
- [x] Empty **No IMUs paired** + **Scan & connect IMUs** → chips (UI mock; no BLE)
- [x] IMU slots UI only; panels stay empty until backend (no fake traces)

## 03 Subject & standing posture

- [x] Subject ID required
- [x] Frontal live feed only; vertical guide frame red → green + 3s countdown
- [x] Sequence F → LL → RL; near-side landmark rules on sides
- [x] After RL: prompt to face frontal camera again
- [x] Save clean PNGs `standing_F / LL / RL` (no overlay)
- [x] **Save Subject & continue** after all three. A choice window offers an existing subject folder or a new folder under a parent directory, then writes the cropped + `_full` PNGs and `…_subject.csv`. A missing cropped still blocks continue. A retake asks again.

## 04 Capture

- [x] Trial name, Start/Stop, ≤3 min
- [x] Real-time 2D pose toggle (desktop MediaPipe on preview)
- [x] Camera tiles labelled by view; fill height
- [x] IMU panel chrome only when IMUs paired/selected; header **IMU signals · live**; empty dashed charts until backend (no fake traces)
- [x] Hide IMU panel entirely if none connected
- [x] No Recalibrate

## 05 Synced review

- [x] Shared scrubber across views; view labels
- [x] Trial picker (keep all trials)
- [x] **Recorded IMU traces** under videos when connected; **No recording yet** per slot; empty until backend (no fake traces / no parked playhead)
- [x] Record another → Capture; Proceed to pose reconstruction → Pose
- [x] Play / speed controls if in demo

## 06 Pose

- [x] Left: Lite/Full/Heavy, Skeleton (scale-to-height view-only + lock hips), smoothing, detection/presence/tracking, Re-run
- [x] Right: camera tabs; 3D orbit/pan/zoom + Reset; video + 2D overlay (view only; Show skeleton)
- [x] Shared timeline (Frame n / N); trial picker
- [x] Re-run on full-res uploads; MediaPipe units (hip-centred; scale-to-height does not change exports)
- [x] Footer: Back to review, Record another, Save status, Save videos (green; videos only, into the subject folder’s trial subfolder), Export ▾ (2D CSV, 3D CSV, OpenSim TRC — this view or all views — plus JSON and original videos)
- [x] No overlay on exported videos; no root-motion claim; no multi-cam fusion

## Save / Export naming

- [x] Hyphens in subject names; F/L/O suffixes; single-cam no suffix
- [x] Non-ASCII names (e.g. Chinese): keep as typed; only spaces → hyphens
- [x] Save Subject & continue asks once per subject until the photos are written. An existing folder is used as-is; a new folder is `<parent>/<subject id>_<name>/`. Later saves reuse that folder
- [x] Posture photos at the folder root; each trial’s videos and landmark files in `<trial>/`
