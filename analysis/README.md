# Offline analysis worker

The Electron main process invokes a native worker through stdin/stdout JSON.
There is no hosted analysis API and no patient-media upload. Users do not install
Python: each release includes a PyInstaller directory in `assets/analysis-worker`.
This generated, platform-specific directory is not committed to Git.

Development `pnpm start` opens the app without the worker. Analysis will show a
retryable runtime error until the native worker is built. Release packaging still
requires a current bundle for its target platform.

## Build on each supported target

Use Python **3.9**, matching the API's pinned model dependencies. On Linux install
`libgl1`, `libglib2.0-0`, `libgomp1`, and `libportaudio2` first. Windows x64, macOS
(Apple Silicon or Intel), and Linux must each use a native runtime of the same
architecture as the Electron package; PyInstaller is not a cross compiler.

From the repository root, create and activate a Python 3.9 virtual environment
(on macOS/Linux; on Windows activate `.venv-analysis\Scripts\activate`):

```sh
python3.9 -m venv .venv-analysis
source .venv-analysis/bin/activate
python -m pip install -r analysis/requirements-build.txt
python -m unittest discover -s analysis/tests -v
python analysis/build_worker.py
node scripts/ensure-analysis.mjs
pnpm install --frozen-lockfile
pnpm start
```

The build downloads the official MediaPipe heavy pose weights over verified
HTTPS from `storage.googleapis.com`, then collects them into the worker. It
fails if these weights are unavailable. Offline end-user analysis must never
rely on a first-run model download. Existing `mediapipe:assets` and `ffmpeg:assets`
steps also require network access at build time. Build on the oldest supported
Linux distribution, because native binaries depend on its libc ABI.

The native-worker CI workflow builds and smoke-tests each platform independently.
Its existence does not mean those jobs have run; see `docs/local-analysis-design.md`
for current validation. Native worker folders contain executables and shared
libraries; retain executable permissions when moving CI artifacts.

## Data and recovery

- Inputs: current questionnaire, clean standing `_full.png` files and the selected
  saved trial's original per-camera MP4 files. Report images remain the existing
  annotated, face-blurred images.
- Results: subject-local `.analysis/<hash>.json`, keyed by input contents and the
  worker build fingerprint. One persisted random mobility score is used by the
  displayed report and PDF. Locale changes retain the same random seed.
- Missing/invalid questionnaire values return to the questionnaire while retaining
  the existing folder and captures. Missing images or failed pose detections identify
  F/LL/RL and return to standing capture. Missing/unreadable recordings return to
  recording or review. Runtime/model failures offer retry, not a retake.
- Replaced input bytes invalidate the cache automatically. Cached files contain
  assessment results and follow the same privacy/storage policy as the subject folder.

## Future model replacement

`worker.py` is the adapter seam. Replace `FIXED_STS` and the reference
`sts_function_model_prediction` with the new measurement/scoring modules while
retaining the JSON result contract in `src/lib/analysis.ts`. Rebuild the worker
so its fingerprint invalidates old caches. See `REFERENCE.md` for provenance and
which initial values intentionally remain placeholders for this internal build.

Tests with controlled geometry validate feature mapping, real OA inference, and
recovery behavior. They do not validate pose accuracy or biomechanical measurement.
