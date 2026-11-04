import contextlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import worker
import cv2
import numpy as np
from app.ml_model.ml_utils import FeatureImportance

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.q = dict(name='Person', age='65', height='1.7', weight='65', sex='Male',
            smoking='No', activity='Mostly sit', diabetes='No', injury='No', surgery='No',
            clicking='No', walkingAid='No', pain='2')
        image = root / 'image.png'
        cv2.imwrite(str(image), np.zeros((64,64,3), np.uint8))
        video = root / 'video.mp4'
        out = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*'mp4v'), 10, (64,64))
        for _ in range(10): out.write(np.zeros((64,64,3), np.uint8))
        out.release()
        self.req = dict(questionnaire=self.q, images={k:str(image) for k in ['F','LL','RL']},
                        videos=[str(video)], locale='en', seed='same-assessment')
    def tearDown(self):
        self.temp.cleanup()
    def test_questionnaire_identifies_field(self):
        for key, value in [('age','150'),('height','NaN'),('walkingAid','unknown')]:
            with self.subTest(key=key), self.assertRaises(worker.AnalysisFailure) as failure:
                worker.validate_questionnaire({**self.q,key:value})
            self.assertEqual(failure.exception.field, key)
    def test_missing_video_routes_to_recording(self):
        with self.assertRaises(worker.AnalysisFailure) as failure:
            worker.analyze({**self.req,'videos':[]})
        self.assertEqual((failure.exception.code,failure.exception.step), ('video',5))
    def test_unreadable_video_routes_to_review(self):
        with self.assertRaises(worker.AnalysisFailure) as failure:
            worker.analyze({**self.req,'videos':['missing.mp4']})
        self.assertEqual((failure.exception.code,failure.exception.step), ('video',6))
    def test_missing_image_identifies_view(self):
        with self.assertRaises(worker.AnalysisFailure) as failure:
            worker.analyze({**self.req,'images':{'F':'missing.png'}})
        self.assertEqual((failure.exception.code,failure.exception.field), ('image','F'))
    def test_real_model_with_controlled_geometry_and_fixed_video_features(self):
        def geometry(image, view, **kwargs):
            angles = {'frontal': {'knee_align_ang_L':1.,'knee_align_ang_R':2.},
                      'left': {'knee_flexcon_hyperextension_L':3.},
                      'right': {'knee_flexcon_hyperextension_R':4.}}[view]
            return angles, {}, image
        # The geometry seam isolates inference/feature mapping; this does not validate pose estimation.
        with patch('app.motion_analysis.static_pose_analysis.static_pose_wrapper',side_effect=geometry), \
             patch('app.ml_model.ml_utils.feature_importance',return_value=FeatureImportance({},[],[])), \
             contextlib.redirect_stderr(io.StringIO()):
            first = worker.analyze(self.req)
            second = worker.analyze({**self.req,'locale':'zh-Hant'})
        self.assertTrue(0 <= first['risk'] <= 100)
        self.assertEqual(first['mobility'], second['mobility'])
        self.assertEqual(first['risk'], second['risk'])
        self.assertNotEqual(first['riskText'], second['riskText'])
        self.assertEqual(first['videoMeasurements']['STS5_pace'],20)
        self.assertEqual(first['extensionRight'],4)
        self.assertTrue(first['advice'])

if __name__ == '__main__': unittest.main()
