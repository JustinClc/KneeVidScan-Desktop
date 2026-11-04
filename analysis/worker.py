"""One offline analysis request per process; JSON stdin/stdout, diagnostics on stderr."""
import contextlib
import json
import math
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).parent))
REFERENCE = ROOT / 'reference'
sys.path.insert(0, str(REFERENCE))
os.environ.setdefault('MPLCONFIGDIR', str(Path(tempfile.gettempdir()) / 'kneevid-matplotlib'))
os.environ.setdefault('NUMBA_CACHE_DIR', str(Path(tempfile.gettempdir()) / 'kneevid-numba'))
VERSION = 'local-analysis-1'
FIXED_STS = {
    'STS5_pace': 20,
    'SingleSTS_1: Stands without using arms': True,
    'SingleSTS_2: Stands using arms': False,
    'SingleSTS_3: Attempted, unable to stand': False,
    'SingleSTS_4: Not attempted, unable': False,
    'max_trunk_ang': 10, 'max_knee_ang_vel': 10, 'max_trunk_ang_vel': 10,
}

class AnalysisFailure(Exception):
    def __init__(self, code, step, field=None):
        self.code, self.step, self.field = code, step, field


def validate_questionnaire(q):
    choices = {
        'sex': ['Male', 'Female'],
        'activity': ['Mostly sit', 'Sit and stand/walk', 'Mostly stand/walk',
                     'Deal with loads of < 50 lbs', 'Deal with loads of > 50 lbs'],
        **{k: ['Yes', 'No'] for k in ['smoking', 'diabetes', 'injury', 'surgery', 'clicking', 'walkingAid']},
        'pain': [str(n) for n in range(11)],
    }
    if not isinstance(q, dict):
        raise AnalysisFailure('questionnaire', 1)
    for key, options in choices.items():
        if q.get(key) not in options:
            raise AnalysisFailure('questionnaire', 1, key)
    for key, low, high in [('age', 18, 120), ('height', .8, 2.3), ('weight', 20, 200)]:
        try:
            n = float(q[key])
            if not math.isfinite(n) or not low <= n <= high:
                raise ValueError('Out of range')
            if key == 'age':
                if not str(q[key]).isdigit():
                    raise ValueError('Age must be an integer')
        except (KeyError, ValueError, TypeError, AssertionError):
            raise AnalysisFailure('questionnaire', 1, key)


def analyze(req):
    q = req.get('questionnaire')
    validate_questionnaire(q)
    import cv2
    from app.motion_analysis.static_pose_analysis import static_pose_wrapper
    from app.ml_model.ml_utils import (load_model, make_feature_frame, risk_model_prediction,
                                      sts_function_model_prediction, feature_importance)
    from app.ml_model.create_advice_text import create_advice_text
    # Use the API's stable internal aliases to avoid translated UI field names.
    from app.ml_model.ml_utils import QUESTIONNAIRE_KEY_ALIASES
    source = dict(zip(['Age','Sex','Height','Weight','Smoking_habit','Activity_level',
                      'Diabetes_history','Knee_injury','Knee_surgery','VAS','Crepitus','Walking_aid'],
                     [int(q['age']),q['sex'],float(q['height']),float(q['weight']),q['smoking'],
                      q['activity'],q['diabetes'],q['injury'],q['surgery'],int(q['pain']),q['clicking'],q['walkingAid']]))
    questionnaire = {QUESTIONNAIRE_KEY_ALIASES[k][0]: v for k,v in source.items()}
    videos = req.get('videos') or []
    if not videos:
        raise AnalysisFailure('video', 5)
    for video in videos:
        cap = cv2.VideoCapture(video)
        try:
            ok, frame = cap.read()
            if not ok or frame is None:
                raise AnalysisFailure('video', 6)
        finally:
            cap.release()
    angles = {}
    # Preserve API behavior: mirror frontal only, keep lateral captures unchanged.
    for code, view in [('F', 'frontal'), ('LL', 'left'), ('RL', 'right')]:
        image = cv2.imread(req.get('images', {}).get(code, ''))
        if image is None:
            raise AnalysisFailure('image', 4, code)
        try:
            a, _, _ = static_pose_wrapper(cv2.flip(image, 1) if code == 'F' else image, view, model_complexity=2)
            if not a or not all(math.isfinite(float(v)) for v in a.values()):
                raise ValueError('No usable pose')
            angles.update(a)
        except (IndexError, ValueError):
            raise AnalysisFailure('pose', 4, code)
    # Reference paths are relative to its app root, never the user's data folder.
    os.chdir(REFERENCE)
    model, primary, secondary = load_model('app_kl3_sts_dt_easyensemble')
    X, X_function = make_feature_frame(questionnaire, angles, FIXED_STS, model)
    walking_aid = int(X_function['Use_of_walking_aid'].iloc[0])
    label, risk = risk_model_prediction(X, model, primary, secondary, walking_aid=walking_aid)
    import random
    random.seed(req.get('seed'))
    mobility_label, mobility = sts_function_model_prediction(X_function, model, label, walking_aid)
    language = {'en': 'en', 'zh-Hant': 'zh-TW', 'zh-Hans': 'zh-CN'}[req.get('locale', 'en')]
    importance = feature_importance(X, model, 'app_kl3_sts_dt_easyensemble', language)
    risk_text, advice = create_advice_text(label, language,
        feature_names=importance.raw_names, shap_values=importance.raw_shap,
        feature_values=X.iloc[0].to_dict(), sts_label=mobility_label)
    return {'version': VERSION, 'risk': float(risk['Risk Score']),
            'mobility': int(mobility['Function Score']),
            'alignmentLeft': float(angles['knee_align_ang_L']),
            'alignmentRight': float(angles['knee_align_ang_R']),
            'extensionLeft': float(angles['knee_flexcon_hyperextension_L']),
            'extensionRight': float(angles['knee_flexcon_hyperextension_R']),
            'riskText': risk_text, 'advice': advice, 'videoMeasurements': FIXED_STS,
            'featureImportance': dict(importance)}


def self_test():
    import cv2
    import mediapipe as mp
    import numpy as np
    import pandas as pd
    from app.ml_model.ml_utils import load_model, risk_model_prediction, feature_importance
    weights = Path(mp.__file__).parent / 'modules' / 'pose_landmark' / 'pose_landmark_heavy.tflite'
    if not weights.is_file():
        raise RuntimeError('Offline pose weights missing')
    with mp.solutions.pose.Pose(static_image_mode=True, model_complexity=2) as pose:
        assert pose.process(np.zeros((256,256,3), dtype=np.uint8)).pose_landmarks is None
    os.chdir(REFERENCE)
    model, primary, secondary = load_model('app_kl3_sts_dt_easyensemble')
    X = pd.read_csv('app/ml_model/trained_model/app_kl3_sts_dt_easyensemble_traindata.csv').iloc[:1]
    _, score = risk_model_prediction(X, model, primary, secondary)
    explanation = feature_importance(X, model, 'app_kl3_sts_dt_easyensemble', 'en')
    assert math.isfinite(float(score['Risk Score']))
    assert isinstance(explanation, dict)
    # Exercise local MP4 decoding in the packaged runtime, not just cv2 import.
    with tempfile.TemporaryDirectory() as folder:
        video = str(Path(folder) / 'self-test.mp4')
        writer = cv2.VideoWriter(video, cv2.VideoWriter_fourcc(*'mp4v'), 10, (64,64))
        writer.write(np.zeros((64,64,3), dtype=np.uint8))
        writer.release()
        cap = cv2.VideoCapture(video)
        try:
            if not cap.read()[0]:
                raise RuntimeError('Offline MP4 decoding unavailable')
        finally:
            cap.release()
    return {'ok': True, 'selfTest': True}


def main():
    try:
        if '--self-test' in sys.argv:
            with contextlib.redirect_stdout(sys.stderr):
                response = self_test()
            print(json.dumps(response))
            return
        req = json.load(sys.stdin)
        # Libraries must not contaminate the JSON protocol.
        with contextlib.redirect_stdout(sys.stderr):
            result = analyze(req)
        response = {'ok': True, 'result': result}
    except AnalysisFailure as exc:
        response = {'ok': False, 'code': exc.code, 'step': exc.step, 'field': exc.field}
    except Exception:
        import traceback
        traceback.print_exc(file=sys.stderr)
        response = {'ok': False, 'code': 'runtime', 'step': 7}
    print(json.dumps(response, allow_nan=False))

if __name__ == '__main__':
    main()
