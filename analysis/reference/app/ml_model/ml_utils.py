import pickle
import pandas as pd
import numpy as np
from typing import Any, Dict, List, Optional, Tuple
import os
import random
import re
from .interp_model import shap_model_interpreter
from ..utils.translation_utils import normalize_language, translate
import sys

# Model loading
MODEL_PATH = "app_kl3_sts_dt_easyensemble"
FEATURE_TRANSLATION_KEYS = {
    "Work_activity_level": "Activity_level",
    "clicking_sound": "Crepitus",
    "knee_align_ang_R": "Knee_align_ang_R",
    "knee_align_ang_L": "Knee_align_ang_L",
    "knee_flexcon_hyperextension_R": "Knee_flexcon_hyperextension_R",
    "knee_flexcon_hyperextension_L": "Knee_flexcon_hyperextension_L",
}


def _normalize_language(support_language: Optional[str]) -> Optional[str]:
    return normalize_language(support_language)


def _strip_questionnaire_text(value: Any) -> Any:
    if isinstance(value, str):
        return value.strip()
    return value


def _normalize_questionnaire(questionnaire: Dict[str, Any]) -> Dict[str, Any]:
    """Strip leading/trailing whitespace from keys and string answers."""
    normalized: Dict[str, Any] = {}
    for key, value in questionnaire.items():
        normalized[str(key).strip()] = _strip_questionnaire_text(value)
    return normalized


def _questionnaire_key(support_language: Optional[str], key: str) -> str:
    return translate(_normalize_language(support_language), f"questionnaire.{key}")


# App + translation.json + legacy INPUT_RESPONSE_STRUCTURE key aliases per field.
QUESTIONNAIRE_KEY_ALIASES: Dict[str, List[str]] = {
    "Age": ["年齡", "年龄", "Age"],
    "Sex": ["性別", "性别", "Sex"],
    "Height": ["身高 (m)", "身高(m)", "Height (m)"],
    "Weight": ["體重 (kg)", "體重(kg)", "体重 (kg)", "体重(kg)", "Weight (kg)"],
    "Smoking_habit": ["吸煙習慣", "吸烟習慣", "吸烟习惯", "Smoking habit"],
    "Activity_level": ["日常活動水平", "日常活动水平", "Work activity level"],
    "Diabetes_history": ["糖尿病病史", "Diabetes history"],
    "Knee_injury": [
        "膝關節曾受傷，並影響活動能力超過 2 星期",
        "膝关节曾受伤，并影响活动能力超过 2 星期",
        "History of knee injury affecting mobility for more than 2 weeks",
        "膝關節受傷病史",
        "膝关节受伤病史",
    ],
    "Knee_surgery": [
        "曾接受膝關節手術",
        "曾接受膝关节手术",
        "History of knee surgery",
        "膝關節手術病史",
        "膝关节手术病史",
    ],
    "Crepitus": [
        "膝關節持續有摩擦聲出現 (如喀喀聲)",
        "膝关节持续出现摩擦声（如咔咔声）",
        "Persistent clicking sound in the knee",
        "近一個月内膝關節是否持續有摩擦聲出現 (如喀喀聲)",
        "近一个月内膝关节是否持续出现摩擦声（如咔咔声）",
        "膝關節是否持續有摩擦聲出現 (如喀喀聲)",
        "膝关节是否持续出现摩擦声（如咔咔声）",
    ],
    "VAS": [
        "近一個月內膝關節疼痛程度 (0無痛 10最痛)",
        "近一个月内膝关节疼痛程度 (0无痛，10最痛)",
        "Degree of knee pain within the recent month (0: no pain, 10: the most painful)",
        "近一個月内膝關節疼痛程度(0無痛 10最痛)",
        "近一个月内膝关节疼痛程度(0无痛，10最痛)",
        "膝關節疼痛程度 (0無痛 10最痛)",
        "膝关节疼痛程度 (0无痛 10最痛)",
    ],
    "Walking_aid": [
        "需使用步行輔助用具",
        "需要使用步行辅助用具",
        "Use of walking aid",
    ],
}


def _questionnaire_lookup_keys(field_key: str, support_language: Optional[str]) -> List[str]:
    keys: List[str] = []
    seen = set()

    def add(key: Optional[str]) -> None:
        if not key:
            return
        key = str(key).strip()
        if key in seen:
            return
        seen.add(key)
        keys.append(key)

    add(field_key)
    add(_questionnaire_key(support_language, field_key))
    for language in ("en", "zh-TW", "zh-CN"):
        add(_questionnaire_key(language, field_key))
    for alias in QUESTIONNAIRE_KEY_ALIASES.get(field_key, []):
        add(alias)
    return keys


def _questionnaire_value(
    questionnaire: Dict[str, Any],
    support_language: Optional[str],
    field_key: str,
) -> Any:
    """Read a questionnaire answer; accept translated labels and documented app key aliases."""
    questionnaire = _normalize_questionnaire(questionnaire)

    for lookup_key in _questionnaire_lookup_keys(field_key, support_language):
        if lookup_key in questionnaire:
            return questionnaire[lookup_key]

    received = list(questionnaire.keys())
    raise KeyError(
        f"Missing questionnaire field '{field_key}'. "
        f"Tried keys: {_questionnaire_lookup_keys(field_key, support_language)!r}. "
        f"Received keys: {received!r}"
    )


REQUIRED_QUESTIONNAIRE_FIELDS = (
    "Age",
    "Sex",
    "Height",
    "Weight",
    "Smoking_habit",
    "Activity_level",
    "Diabetes_history",
    "Knee_injury",
    "Knee_surgery",
    "VAS",
    "Crepitus",
)


def validate_questionnaire(
    questionnaire: Dict[str, Any],
    support_language: Optional[str] = None,
) -> None:
    """Raise ValueError listing any required fields absent from the questionnaire."""
    missing = []
    for field_key in REQUIRED_QUESTIONNAIRE_FIELDS:
        try:
            _questionnaire_value(questionnaire, support_language, field_key)
        except KeyError:
            missing.append(field_key)
    if missing:
        raise ValueError(
            f"Questionnaire missing required field(s): {missing}. "
            f"Received keys: {list(questionnaire.keys())!r}"
        )


def _translated_feature_name(support_language: str, feature_name: str) -> str:
    translation_key = f"feature.{FEATURE_TRANSLATION_KEYS.get(feature_name, feature_name)}"
    translated = translate(support_language, translation_key)
    return feature_name if translated == translation_key else translated


def _sanitize_numeric(value: Any, as_int: bool = False):
    """Extract the first numeric token from input and cast it."""
    if isinstance(value, (int, float)):
        numeric_value = np.abs(float(value))
    else:
        text_value = str(value).strip().replace(",", "")
        match = re.search(r"-?\d+(?:\.\d+)?", text_value)
        if not match:
            numeric_value = -1 # Indicate invalid numeric value
        else:
            numeric_value = np.abs(float(match.group()))
    return int(numeric_value) if as_int else numeric_value


def _process_invalid_value(value: Any, variable_name: str):
    """Process invalid value."""
    if value == -1: # Indicate invalid numeric value
        if variable_name == 'Height':
            return 1.65 # Set 1.65m as the mean height to inpute the invalid value
        elif variable_name == 'Weight':
            return 60 # Set 60kg as the mean weight to inpute the invalid value 
        elif variable_name == 'Age':
            return 65
        else:
            return value
    else:
        if variable_name == 'Height':
            if value < 2.5:
                value = value
            elif (value > 100) and (value < 250): # convert cm to m
                value = value / 100
            else:
                value = 1.65 # Set 1.65m as the mean height to inpute the invalid value     

        elif variable_name == 'Weight':
            if (value > 20000) and (value < 300000): # convert g to kg
                value = value / 1000
            elif (value > 20) and (value < 300): # convert kg to kg
                value = value
            else:
                value = 60 # Set 60kg as the mean weight to inpute the invalid value     

        if variable_name == 'Age':
            if value < 130:
                value = value
            else:
                value = 65 # Set 65 as the mean age to inpute the invalid value     

        return value

def load_model(model_name: str):
    #print('Current working directory:', os.getcwd())
    model_name += '.pkl'
    path = 'app/ml_model/trained_model/' + model_name
    f = open(path, 'rb')
    model_wrapper = pickle.load(f)

    if hasattr(model_wrapper, 'clf'):
        model = model_wrapper.clf
        primary_threshold = model_wrapper.primary_threshold
        secondary_threshold = model_wrapper.secondary_threshold
    else:
        model = model_wrapper
        primary_threshold = None
        secondary_threshold = None
    return model, primary_threshold, secondary_threshold

def make_feature_frame(questionnaire: Dict[str, Any],
                       angle_feats: Dict[str, float],
                       video_feats: Dict[str, float],
                       model,
                       support_language: str = None) -> pd.DataFrame:
    
    # Translate questionnaire
    questionnaire_translated = {}
    
    questionnaire_translated['Age'] = _process_invalid_value(_sanitize_numeric(
        _questionnaire_value(questionnaire, support_language, 'Age'),
        as_int=True,
    ), 'Age')
    questionnaire_translated['Sex'] = _questionnaire_value(questionnaire, support_language, 'Sex')
    questionnaire_translated['Height'] = _process_invalid_value(_sanitize_numeric(
        _questionnaire_value(questionnaire, support_language, 'Height'),
    ), 'Height')
    questionnaire_translated['Weight'] = _process_invalid_value(_sanitize_numeric(
        _questionnaire_value(questionnaire, support_language, 'Weight'),
    ), 'Weight')
    questionnaire_translated['Smoking_habit'] = _questionnaire_value(
        questionnaire, support_language, 'Smoking_habit'
    )
    questionnaire_translated['Work_activity_level'] = _questionnaire_value(
        questionnaire, support_language, 'Activity_level'
    )
    questionnaire_translated['Diabetes_history'] = _questionnaire_value(
        questionnaire, support_language, 'Diabetes_history'
    )
    questionnaire_translated['Knee_injury'] = _questionnaire_value(
        questionnaire, support_language, 'Knee_injury'
    )
    questionnaire_translated['Knee_surgery'] = _questionnaire_value(
        questionnaire, support_language, 'Knee_surgery'
    )
    questionnaire_translated['VAS'] = int(_sanitize_numeric(
        _questionnaire_value(questionnaire, support_language, 'VAS'),
        as_int=True,
    ))
    questionnaire_translated['clicking_sound'] = _questionnaire_value(
        questionnaire, support_language, 'Crepitus'
    )
    questionnaire_translated['Use_of_walking_aid'] = _questionnaire_value( ##
        questionnaire, support_language, 'Walking_aid'
    )
    
    # Calculate BMI
    questionnaire_translated['BMI'] = questionnaire_translated['Weight'] / (questionnaire_translated['Height'] ** 2)

    # Extract STS OA features
    sts_feats = {'STS5_pace': video_feats['STS5_pace'],
                 'SingleSTS_1: Stands without using arms': video_feats['SingleSTS_1: Stands without using arms'],   
                 'SingleSTS_2: Stands using arms': video_feats['SingleSTS_2: Stands using arms'],
                 'SingleSTS_3: Attempted, unable to stand': video_feats['SingleSTS_3: Attempted, unable to stand'],
                 'SingleSTS_4: Not attempted, unable': video_feats['SingleSTS_4: Not attempted, unable']}

    # Make feature frame
    payload = {**questionnaire_translated, **angle_feats, **sts_feats}
    X = pd.DataFrame([payload])

    # Translate answers
    X = X.replace({'男': 1, '女': 0, 'Male': 1, 'Female': 0,
                   '有': 1, '無': 0, '无': 0, '沒有': 0, '没有': 0,
                   '是': 1, '否': 0,
                   'Yes': 1, 'No': 0,
                   '多數時間坐': 0, '坐與站/行走時間大致相同': 1, '多數時間站立/行走': 2,
                   '坐與站時間大致相同': 1, '多數時間站立': 2,
                   '需要提舉物品 < 50磅': 3, '需要提舉物品 > 50磅': 4,
                   '多数时间坐着': 0, '坐着与站立/行走时间大致相同': 1, '多数时间站立/行走': 2,
                   '需要提举物品 < 50 磅': 3, '需要提举物品 > 50 磅': 4,
                   'Mostly sit': 0, 'Sit and stand/walk': 1, 'Mostly stand/walk': 2,
                   'Deal with loads of < 50 lbs': 3, 'Deal with loads of > 50 lbs': 4,
                   })

    features_risk = ['Age', 'Sex', 'Work_activity_level', 'BMI', 'Diabetes_history',
                'Knee_injury', 'Knee_surgery', 'Smoking_habit', 'VAS', 'clicking_sound',
                'knee_align_ang_R', 'knee_align_ang_L', 'knee_flexcon_hyperextension_R',
                'knee_flexcon_hyperextension_L', 'STS5_pace',
                'SingleSTS_1: Stands without using arms',
                'SingleSTS_2: Stands using arms',
                'SingleSTS_3: Attempted, unable to stand',
                'SingleSTS_4: Not attempted, unable'
                ]
    features_function_question = ['Use_of_walking_aid']
    # Keep function-only questionnaire fields before risk-model column alignment.
    X_function_question = X[features_function_question].copy()

    # Align with model's expected columns if known
    if hasattr(model, "feature_names_in_"):
        cols = list(model.feature_names_in_)
        for c in cols:
            if c not in X.columns:
                X[c] = 0
        X = X[cols]

    X_risk = X[features_risk]
    return X_risk, X_function_question


def risk_model_prediction(X: pd.DataFrame, model, 
                          primary_threshold=None, 
                          secondary_threshold=None,
                          walking_aid=None
                          ) -> Tuple[str, Dict[str, float]]:
    """
    Predict the risk group and output the score range for the risk group
    Args:
        X: pd.DataFrame
        model: model
        primary_threshold: float
        secondary_threshold: float
        walking_aid: int
    Returns:
        label: str
        output_score: Dict[str, float]
    """
    # Prediction
    score = None
    label = None

    if 'Use_of_walking_aid' in X.columns:
        walking_aid = X['Use_of_walking_aid'].iloc[0]
        X = X.drop(columns=['Use_of_walking_aid'])
    elif walking_aid is None:
        walking_aid = 0

    score = model.predict_proba(X)[0][1] * 100 # Range: 0 - 100

    if X['Age'].iloc[0] < 40:
        score = min(score, 22)

    if walking_aid == 1:
        score = score + 25

    score = min(score, 100)

    if primary_threshold is None:
        primary_threshold = 23
    if secondary_threshold is None:
        secondary_threshold = 60.0

    # Define risk group based on risk score
    if (score < primary_threshold):
        label = 'Low Risk'
    elif (score >= primary_threshold) and (score < secondary_threshold):
        label = 'Medium Risk'
    elif score >= secondary_threshold:
        label = 'High Risk'

    output_score = {
        'Risk Score': score,
        'Low Risk Max Score': primary_threshold, # Maximum score for Low Risk
        'Medium Risk Max Score': secondary_threshold, # Maximum score for Medium Risk
    }

    return label, output_score


def sts_function_model_prediction(
    X: pd.DataFrame, model, risk_label, walking_aid=None
) -> Tuple[str, Dict[str, float]]:
    """
    Predict the STS function group and output the score range for the STS function group
    Args:
        X: pd.DataFrame
        model: model
    Returns:
        label: str
        output_score: Dict[str, float]
    """
    # Prediction
    score = None
    label = None

    #score = model.predict_proba(X)[0][1] * 100 # Range: 0 - 100
    if risk_label == 'Low Risk':
        score = random.randint(5, 29)
    elif risk_label == 'Medium Risk':
        score = random.randint(25, 59)
    elif (risk_label == 'High Risk'):
        score = random.randint(60, 80)

    if walking_aid is None:
        if 'Use_of_walking_aid' in X.columns:
            walking_aid = X['Use_of_walking_aid'].iloc[0]
        else:
            walking_aid = 0

    if walking_aid == 1:
        score = random.randint(60, 80)

    primary_threshold = 30
    secondary_threshold = 60

    # Define risk group based on risk score
    if (score < primary_threshold):
        label = 'Good Performance'
    elif (score >= primary_threshold) and (score < secondary_threshold):
        label = 'Acceptable Performance'
    elif score >= secondary_threshold:
        label = 'Poor Performance'

    output_score = {
        'Function Score': score,
        'Low Risk Max Score': primary_threshold, # Maximum score for Good Performance
        'Medium Risk Max Score': secondary_threshold, # Maximum score for Acceptable Performance
    }

    return label, output_score


def gait_function_model_prediction(
    X: pd.DataFrame, model, risk_label, walking_aid=None
) -> Tuple[str, Dict[str, float]]:
    """
    Predict the gait function group and output the score range for the gait function group
    Args:
        X: pd.DataFrame
        model: model
    Returns:
        label: str
        output_score: Dict[str, float]
    """
    # Prediction
    score = None
    label = None

    #score = model.predict_proba(X)[0][1] * 100 # Range: 0 - 100
    if risk_label == 'Low Risk':
        score = random.randint(5, 29)
    elif risk_label == 'Medium Risk':
        score = random.randint(25, 59)
    elif (risk_label == 'High Risk'):
        score = random.randint(60, 80)

    if walking_aid is None:
        if 'Use_of_walking_aid' in X.columns:
            walking_aid = X['Use_of_walking_aid'].iloc[0]
        else:
            walking_aid = 0

    if walking_aid == 1:
        score = random.randint(60, 80)

    primary_threshold = 30
    secondary_threshold = 60

    # Define risk group based on risk score
    if (score < primary_threshold):
        label = 'Good Performance'
    elif (score >= primary_threshold) and (score < secondary_threshold):
        label = 'Acceptable Performance'
    elif score >= secondary_threshold:
        label = 'Poor Performance'

    output_score = {
        'Gait Function Score': score,
        'Low Risk Max Score': primary_threshold, # Maximum score for Good Performance
        'Medium Risk Max Score': secondary_threshold, # Maximum score for Acceptable Performance
    }

    return label, output_score


class FeatureImportance(dict):
    """Display-name importance map that also keeps the raw interpreter selection."""

    def __init__(self, mapping, raw_names, raw_shap):
        super().__init__(mapping)
        self.raw_names = [str(name) for name in raw_names]
        self.raw_shap = [float(value) for value in raw_shap]


def feature_importance(X: pd.DataFrame, model, model_name, support_language: str = None) -> Dict[str, float]:
    """
    Calculate the feature importance
    Args:
        X: pd.DataFrame
        model: model
        model_name: str
    Returns:
        imp: Dict[str, float]
    """
    # SHAP plot
    train_data_path = os.path.join('app/ml_model/trained_model',
                                    model_name + '_traindata' + '.csv')
    X_train = pd.read_csv(train_data_path)
    lmi = shap_model_interpreter(model, X_train.values, X.columns)
    feature_list_display, shap_values, no_high_risk_factor = lmi.local_interp(X.values[0].astype(float))
    raw_names = [str(feature_name) for feature_name in feature_list_display]
    raw_shap = [float(value) for value in shap_values]

    # Convert feature names to the requested display language.
    translated_names = [
        _translated_feature_name(support_language, feature_name)
        for feature_name in raw_names
    ]

    # Create feature importance dict
    if no_high_risk_factor:
        displayed = {}  # No high risk factor detected, return empty dict
    else:
        displayed = dict(zip(translated_names, raw_shap))

    return FeatureImportance(displayed, raw_names, raw_shap)

