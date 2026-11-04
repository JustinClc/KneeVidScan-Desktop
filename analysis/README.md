# Offline analysis worker

The Electron main process invokes a native worker through stdin/stdout JSON.
There is no hosted analysis API and no patient-media upload. Users do not install
Python: each release includes a PyInstaller directory in `assets/analysis-worker`.

## Build on each supported target

Use Python **3.9**, matching the API's pinned model dependencies. On Linux install
`libgl1`, `libglib2.0-0`, `libgomp1`, and `libportaudio2` first. Windows x64, macOS
(Apple Silicon or Intel), and Linux must each use a native runtime of the same
architecture as the Electron package; PyInstaller is not a cross compiler.

From the repository root, create and activate an isolated Python 3.9 environment.
If you have Conda (including Anaconda/Miniconda), use:

```sh
conda create --prefix ./.venv-analysis python=3.9 pip -y &&
conda activate ./.venv-analysis
```

Otherwise, install Python 3.9 first, then use:

```sh
python3.9 -m venv .venv-analysis &&
source .venv-analysis/bin/activate
```

On Windows, use `py -3.9 -m venv .venv-analysis` and activate with
`.venv-analysis\Scripts\Activate.ps1` in PowerShell.

Confirm `python --version` reports **3.9.x** before continuing. If environment
creation or activation fails, stop there: running pip in your existing environment
(especially a newer Python) cannot install these pinned dependencies. Keep the
pins to preserve compatibility with the reference model.

Then install and build (the `&&` operators stop after a failed step):

```sh
python -m pip install -r analysis/requirements-build.txt &&
python -m unittest discover -s analysis/tests -v &&
python analysis/build_worker.py &&
node scripts/ensure-analysis.mjs &&
pnpm install --frozen-lockfile &&
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
