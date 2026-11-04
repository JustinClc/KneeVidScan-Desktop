# API reference

Files in `reference/app` were copied from JustinClc/KneeVidScan_pro_api,
commit 082fc6b79fa345ea2b8693c2d808e925ac2777f7. They retain the model,
feature preparation, numeric standing-angle formulas, risk prediction,
random mobility scoring, SHAP explanation, and localized advice.

The initial internal demonstration intentionally retains fixed STS features
and random mobility scores. They are not biomechanical measurements or a
validated mobility model. Replace the adapters in worker.py when the new
models are supplied. Do not change report consumers to install a new model.

No hosted API, Firestore, media upload, or cloud analysis is used.
