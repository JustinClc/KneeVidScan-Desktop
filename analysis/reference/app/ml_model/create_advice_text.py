from typing import Any, List, Mapping, Optional, Sequence, Tuple

from app.utils.translation_utils import translate

RISK_BAND_TRANSLATION_KEYS = {
    "Low Risk": "risk_level.risk_level_low",
    "Medium Risk": "risk_level.risk_level_medium",
    "High Risk": "risk_level.risk_level_high",
}

# Lower rank wins when two slot candidates have the same SHAP value.
_SLOT_RANK = {
    "knee_flexcon_hyperextension_R": 0,
    "knee_flexcon_hyperextension_L": 1,
    "knee_align_ang_R": 2,
    "knee_align_ang_L": 3,
    "Diabetes_history": 4,
    "Smoking_habit": 5,
    "Knee_injury": 6,
    "Knee_surgery": 7,
    "VAS": 8,
    "clicking_sound": 9,
}

_DIRECT_ADVICE_KEYS = {
    "Diabetes_history": "diabetes_history",
    "Smoking_habit": "smoking_habit",
    "Knee_injury": "knee_injury",
    "Knee_surgery": "knee_surgery",
    "VAS": "knee_pain",
    "clicking_sound": "crepitus",
}

_ANGLE_SIDE = {
    "knee_flexcon_hyperextension_R": "right",
    "knee_flexcon_hyperextension_L": "left",
    "knee_align_ang_R": "right",
    "knee_align_ang_L": "left",
}

_FLEXION_CUTOFF = 6.5
_ALIGNMENT_CUTOFF = 5.0
_SLOT_LIMIT = 3


def create_advice_text(
    label: str,
    support_language: Optional[str] = None,
    feature_names: Optional[Sequence[str]] = None,
    shap_values: Optional[Sequence[float]] = None,
    feature_values: Optional[Mapping[str, Any]] = None,
    sts_label: Optional[str] = None,
) -> Tuple[str, List[str]]:
    intro = translate(support_language, "risk_level.risk_level_intro_text")
    level_key = RISK_BAND_TRANSLATION_KEYS.get(label)
    level_text = translate(support_language, level_key) if level_key else label
    risk_text = f"{intro}{level_text}"

    names = [str(name) for name in (feature_names or ())]
    contributions = [float(value) for value in (shap_values or ())]
    values = feature_values or {}
    selected = {
        name: contribution
        for name, contribution in zip(names, contributions)
    }

    advice_text: List[str] = []
    if sts_label == "Poor Performance":
        advice_text.append(translate(support_language, "motion_function.sts_function"))

    bmi_key = _bmi_advice_key(selected, values)
    if bmi_key:
        advice_text.append(translate(support_language, bmi_key))

    advice_text.extend(_slot_advice(support_language, selected, values))

    if not advice_text:
        advice_text.append(translate(support_language, "advice.fallback"))

    return risk_text, advice_text


def _bmi_advice_key(selected: Mapping[str, float], values: Mapping[str, Any]) -> Optional[str]:
    if "BMI" not in values:
        return None
    bmi = float(values["BMI"])
    bmi_selected = "BMI" in selected
    if (bmi_selected and bmi > 25) or (not bmi_selected and bmi > 27):
        return "BMI.BMI_high"
    if bmi_selected and bmi < 18:
        return "BMI.BMI_low"
    return None


def _slot_advice(
    support_language: Optional[str],
    selected: Mapping[str, float],
    values: Mapping[str, Any],
) -> List[str]:
    ranked = []
    for name, contribution in selected.items():
        if name not in _SLOT_RANK:
            continue
        text = _slot_line(support_language, name, values)
        if text is None:
            continue
        ranked.append((-contribution, _SLOT_RANK[name], text))
    ranked.sort()
    return [text for _, _, text in ranked[:_SLOT_LIMIT]]


def _slot_line(
    support_language: Optional[str],
    name: str,
    values: Mapping[str, Any],
) -> Optional[str]:
    direct_key = _DIRECT_ADVICE_KEYS.get(name)
    if direct_key:
        return translate(support_language, direct_key)

    if name not in values:
        return None
    angle_key = _angle_advice_key(name, float(values[name]))
    if angle_key is None:
        return None
    side = translate(support_language, f"knee_angle.side.{_ANGLE_SIDE[name]}")
    return translate(support_language, angle_key).format(side=side)


def _angle_advice_key(name: str, value: float) -> Optional[str]:
    if name.startswith("knee_flexcon_hyperextension_"):
        if value > _FLEXION_CUTOFF:
            return "knee_angle.flexion_contracture"
        if value < -_FLEXION_CUTOFF:
            return "knee_angle.hyperextension"
        return None
    if value > _ALIGNMENT_CUTOFF:
        return "knee_angle.varus"
    if value < -_ALIGNMENT_CUTOFF:
        return "knee_angle.valgus"
    return None
