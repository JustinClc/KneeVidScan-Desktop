from pathlib import Path
import cv2
import numpy as np
import mediapipe as mp
import math


def static_pose_wrapper(
                img, 
                view,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
                model_complexity=2
                ):
    
    if view == 'frontal':
        land_marks = [(23, 25, 27), (24, 26, 28)]
        ang_f, annotated_image = StaticPoseAngle(img, view, land_marks, min_detection_confidence, min_tracking_confidence, model_complexity)
        hka_corr_left, hka_corr_right, alignment_left, alignment_right = CorrectedHKAAlignment(ang_f, prim_thr=4.0, sec_thr=8.5)
        image_angles = {'knee_align_ang_R': hka_corr_right,
                        'knee_align_ang_L': hka_corr_left,
                        }
    
    elif view == 'right':
        land_marks = [[24, 26, 28]]
        ang_f, annotated_image = StaticPoseAngle(img, view, land_marks, min_detection_confidence, min_tracking_confidence, model_complexity)
        knee_flex_ext_angle, knee_flex_ext = KneeFlexExtAngle(ang_f, side='right')
        image_angles = {'knee_flexcon_hyperextension_R': knee_flex_ext_angle,
                        }

    elif view == 'left':
        land_marks = [[23, 25, 27]]
        ang_f, annotated_image = StaticPoseAngle(img, view, land_marks, min_detection_confidence, min_tracking_confidence, model_complexity)
        knee_flex_ext_angle, knee_flex_ext = KneeFlexExtAngle(ang_f, side='left')
        image_angles = {'knee_flexcon_hyperextension_L': knee_flex_ext_angle,
                        }
    
    angle_thresholds = {# Fontal view image angle thresholds
                        'HKA_angle_normal_min': -4,
                        'HKA_angle_normal_max': 4,
                        'HKA_angle_varus_max': 8.5,
                        'HKA_angle_severe_varus_max': 30,
                        'HKA_angle_valgus_min': -8.5,
                        'HKA_angle_severe_valgus_min': -30,
                        
                        # Lateral view image angle thresholds
                        'knee_flexion_angle_normal_min': -6.5,
                        'knee_flexion_angle_normal_max': 6.5,
                        'Knee_flexion_contracture_max': 15,
                        'Knee_flexion_contracture_severe_max': 40,
                        'Knee_hyper_extension_min': -15,
                        'Knee_hyper_extension_severe_min': -40}

    return image_angles, angle_thresholds, annotated_image


def StaticPoseAngle(cap, 
                    view,
                    pt_list:list,
                    min_detection_confidence=0.5,
                    min_tracking_confidence=0.5,
                    model_complexity=1):
    """
    Args:
        cap: np.array, input image
        view: str, view of the image
        pt_list: list of 3-point tuple to define angles, e.g. [(23, 25, 27), (24, 26, 28)] 
        min_detection_confidence: float, minimum detection confidence
        min_tracking_confidence: float, minimum tracking confidence
        model_complexity: int, model complexity
    Returns:
        angles: list, list of angles
        img: np.array, annotated image
    """
    if model_complexity == 2 and not (Path(mp.__file__).parent / 'modules' / 'pose_landmark' / 'pose_landmark_heavy.tflite').is_file():
        raise RuntimeError('Offline pose weights missing; rebuild the analysis worker')
    mpPose = mp.solutions.pose
    pose = mpPose.Pose(static_image_mode=True,
                       min_detection_confidence=min_detection_confidence,
                       enable_segmentation=False,
                       min_tracking_confidence=min_tracking_confidence,
                       model_complexity=model_complexity)
    
    frame_width = cap.shape[1]
    frame_height = cap.shape[0]
    
    factor = int(np.round(frame_width / 500, decimals=0))
    if factor > 1:
        cap = cv2.resize(cap, (int(frame_width/factor), int(frame_height/factor)))
    
    img = cv2.cvtColor(cap, cv2.COLOR_BGR2RGB)
    img_shape = img.shape
    img_h = img_shape[0]
    img_w = img_shape[1]
    results = pose.process(img)
    
    pose.close()
    required = {point for triplet in pt_list for point in triplet}
    if not results.pose_landmarks or any(
        results.pose_landmarks.landmark[i].visibility < 0.5
        or not 0 <= results.pose_landmarks.landmark[i].x <= 1
        or not 0 <= results.pose_landmarks.landmark[i].y <= 1
        for i in required
    ):
        raise ValueError("Required leg landmarks are not visible")
    lmlist = []
    if results.pose_landmarks:
        # Only collect landmark positions
        for id, lm in enumerate(results.pose_landmarks.landmark):
            h, w, c = img.shape
            cx, cy = int(lm.x*w), int(lm.y*h)
            lmlist.append([id, cx, cy])
    
    angles = []
    # Define landmarks for left and right sides
    landmarks_to_draw = {
        'left': [23, 25, 27],  # Left hip, knee, ankle
        'right': [24, 26, 28]  # Right hip, knee, ankle
    }

    if view == 'llat':
        landmarks_to_draw = {"left": [23, 25, 27]}
    elif view == 'rlat':
        landmarks_to_draw = {'right': [24, 26, 28]}
    
    # Draw only the specified landmarks and connections
    if lmlist:
        for side, points in landmarks_to_draw.items():
            # Draw lines connecting the points
            for i in range(len(points)-1):
                pt1 = lmlist[points[i]][1:]
                pt2 = lmlist[points[i+1]][1:]
                cv2.line(img, (pt1[0], pt1[1]), (pt2[0], pt2[1]), (255, 255, 255), 2)
            
            # Draw circles for landmarks
            for point in points:
                x, y = lmlist[point][1:]
                cv2.circle(img, (x, y), 4, (0, 255, 0), cv2.FILLED)
    
        # Calculate angles
        for set in pt_list:
            p1, p2, p3 = set
            x1, y1 = lmlist[p1][1:]
            x2, y2 = lmlist[p2][1:]
            x3, y3 = lmlist[p3][1:]

            # Calculate the angle
            angle = math.degrees(math.atan2(y3-y2, x3-x2) - math.atan2(y1-y2, x1-x2))
            angles.append(angle)

    img = cv2.resize(img, (int(700*(img_w/img_h)), 700))
    img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    return angles, img


def CorrectedHKAAlignment(angles:list, corr_value=1, prim_thr=4.0, sec_thr=8.5):
    angle_left = angles[0]
    angle_corr_left = angle_left - 180 - corr_value 
    if angle_corr_left >= prim_thr: alignment_left = "Varus"
    elif angle_corr_left >= sec_thr: alignment_left = "Severe Varus"
    elif angle_corr_left <= -prim_thr: alignment_left = "Valgus"
    elif angle_corr_left <= -sec_thr: alignment_left = "Severe Valgus"
    else: alignment_left = 'Neutral'

    angle_right = angles[1]
    angle_corr_right = -(angle_right - 180 - corr_value)
    if angle_corr_right >= prim_thr: alignment_right = "Varus"
    if angle_corr_right >= sec_thr: alignment_right = "Severe Varus"
    elif angle_corr_right <= -prim_thr: alignment_right = "Valgus"
    elif angle_corr_right <= -sec_thr: alignment_right = "Severe Valgus"
    else: alignment_right = 'Neutral'
    return angle_corr_left, angle_corr_right, alignment_left, alignment_right


def KneeFlexExtAngle(angle, thr=5.0, corr_value=0, side='right'):
    if side == 'left':
        knee_flex_ext_angle = angle[0] - 180.0 - corr_value
    else:
        knee_flex_ext_angle = -(angle[0] - 180.0 - corr_value)
    if knee_flex_ext_angle > 0:
        knee_flex_ext_angle = knee_flex_ext_angle - 1.5
    if knee_flex_ext_angle > thr: 
        knee_flex_ext = "Knee Flexion Contracture"
    elif knee_flex_ext_angle < -thr: 
        knee_flex_ext = "Knee Hyper Extension"
    else: 
        knee_flex_ext = "Normal"
    return knee_flex_ext_angle, knee_flex_ext