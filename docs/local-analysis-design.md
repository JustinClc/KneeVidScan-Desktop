# Local assessment analysis

## Confirmed requirements

- Implement analysis inside KneeVidScan-Desktop, using KneeVidScan_pro_api as the reference. Do not build a new hosted analysis API.
- Populate the existing report and PDF export with analysis results.
- Bundle runtime dependencies and models so analysis runs locally without a separate Python installation or internet access.
- On input-related failure, identify the affected questionnaire field, standing photo, or video; guide the operator back to correct or retake it and resubmit for analysis.
- Preserve the API's temporary random function scores until a runnable replacement ML model is supplied.
- Preserve the API's fixed video measurements for the initial implementation; genuine video biomechanical measurement is deferred to a later update. Input recovery can detect unreadable or missing video, but fixed outputs cannot establish successful biomechanical measurement.
- Bring calculation differences between Desktop and API to the user before changing them.
- Use OA risk boundaries 23/60 consistently for classification, report gauges, and interpretation, matching the API rather than Desktop's existing 23/55 examples.
- Target bundled local analysis on Windows, macOS, and Linux. Distinguish platform-specific validation from packaging support; a Linux check does not validate Windows or macOS.
- Initial intended use is internal demonstrations and testing (Q11 accepted). Keep the normal numeric report presentation without provisional/simulated labels as requested; retain the placeholder implementation details in developer documentation. Actual clinical readiness is outside this initial implementation.

## Confirmed implementation design

- Use an embedded local Python worker to preserve the API's existing pickle model and scientific dependencies, invoked by Electron without a hosted prediction service.
- Read the assessment's local questionnaire, clean standing images, and saved video files; keep the existing capture, report layout, language options, and PDF export.
- Calculate standing angles and OA risk using the API reference. Retain the existing fixed video features and random mobility scoring behind replaceable components.
- Cache one analysis result for the report and PDF so exporting does not generate a different random score. Invalidate results when their assessment inputs change.
- Validate required questionnaire values, image readability and genuine pose detections, and video availability/readability. Return actionable failures linked to questionnaire, standing capture, or video capture/review. Do not claim fixed video outputs can detect biomechanical quality failures.
- Keep runtime/model-loading failures distinct from input failures; offer retry rather than telling users to retake valid media to fix a missing dependency.
- Bundle the runtime and assets for offline analysis; validate the available host and report untested platform builds explicitly.

## Findings awaiting decisions

- The bundled EasyEnsembleClassifier has no primary_threshold or secondary_threshold attributes; use the agreed API defaults 23/60.
- Desktop records repeated sit-to-stand for 20 seconds. The OA model expects five-rise timing and single-rise ability flags; retain the API's constants for these features in the agreed initial version.

The user confirmed this scope and implementation design after the grill-with-docs interview.


## Validation in the current cloud task

- TypeScript type check and correctness lint passed.
- Desktop suite: 310 passed, 1 failed. The failing camera-pairing/standing-settings test also fails when the full unchanged baseline App test file is run (36 passed, 1 failed); its isolated case passes. This baseline issue is outside the analysis change.
- Python worker: 5 tests passed, including real OA inference with controlled geometry, fixed video feature mapping, reproducible mobility scoring across locales, and input-failure routing.
- A separate controlled-geometry run executed the real SHAP explanation and localized advice successfully (risk 33.75, mobility 44, three advice items).
- Native worker build attempted and blocked by HTTP proxy 403 downloading the official heavy pose weights from storage.googleapis.com. No native bundle or successful full image-to-report run is claimed.
- Windows/macOS builds and the new native-worker CI jobs have not run in this Linux task.

Next: apply the saved storage.googleapis.com network addition, build the native worker, run its packaged pose/model/SHAP/video self-test, and validate a full assessment before publishing or distributing a build.
