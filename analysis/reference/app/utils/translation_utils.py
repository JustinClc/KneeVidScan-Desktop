import json
from pathlib import Path
from typing import Any, Dict, Optional


DEFAULT_LANGUAGE = "zh-TW"
SUPPORTED_LANGUAGES = ("en", "zh-TW", "zh-CN")
TRANSLATION_PATH = Path(__file__).with_name("translation.json")


def load_translations() -> Dict[str, Any]:
    with TRANSLATION_PATH.open(encoding="utf-8") as translation_file:
        return json.load(translation_file)


def _normalize_single_language_tag(language_tag: str) -> Optional[str]:
    language = language_tag.split(";")[0].strip()
    if not language:
        return None

    lowered = language.lower().replace("_", "-")
    if lowered == "en" or lowered.startswith("en-"):
        return "en"
    if lowered == "zh" or lowered in {"zh-tw", "zh-hant"} or lowered.startswith(("zh-tw-", "zh-hant")):
        return "zh-TW"
    if lowered in {"zh-cn", "zh-hans"} or lowered.startswith(("zh-cn-", "zh-hans")):
        return "zh-CN"
    for supported in SUPPORTED_LANGUAGES:
        if lowered == supported.lower():
            return supported
    return language


def normalize_language(support_language: Optional[str]) -> Optional[str]:
    if support_language is None:
        return None

    first_tag = support_language.split(",")[0].strip()
    if not first_tag:
        return None
    return _normalize_single_language_tag(first_tag)


def translate(support_language: Optional[str], key: str) -> str:
    translations = load_translations()
    language = normalize_language(support_language) or DEFAULT_LANGUAGE
    if language not in translations:
        language = DEFAULT_LANGUAGE

    value: Any = translations[language]
    for key_part in key.split("."):
        if not isinstance(value, dict) or key_part not in value:
            return key
        value = value[key_part]

    return value if isinstance(value, str) else key
