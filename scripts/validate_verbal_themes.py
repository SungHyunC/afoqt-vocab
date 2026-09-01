#!/usr/bin/env python3
"""Validate the priority and theme metadata embedded in words.json.

This script uses only the Python standard library so it can run in CI or during
a release without installing the one-off classification tooling.
"""

from __future__ import annotations

import hashlib
import json
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
WORDS_PATH = ROOT / "words.json"
ANALOGIES_PATH = ROOT / "analogies.json"

EXPECTED_TOTAL = 4_608
EXPECTED_PRIORITY_COUNTS = {1: 1_053, 2: 445, 3: 1_017, None: 2_093}
EXPECTED_ANALOGY_CORE = 348

# Hash of every pre-existing field and value in list/key order.  The two verbal
# fields are removed before hashing.  This catches accidental edits, omissions,
# reordering, or ID changes while allowing the appended metadata to evolve.
EXPECTED_BASE_SHA256 = "1624e0c9a0575b4ced9e6a6bd8796bc22d4ba341de24bceec55b62f871da475b"

SEMANTIC_THEMES = (
    "character_attitude",
    "emotion_psychology",
    "change_quantity",
    "conflict_criticism",
    "agreement_support",
    "clarity_ambiguity",
    "knowledge_judgment",
    "communication",
    "law_power_control",
    "economy_value",
    "state_degree",
    "movement_time",
    "success_risk",
)
ANALOGY_THEME = "analogy_core"
ALLOWED_THEMES = set(SEMANTIC_THEMES) | {ANALOGY_THEME}


class Validation:
    def __init__(self) -> None:
        self.errors: list[str] = []

    def check(self, condition: bool, message: str) -> None:
        if not condition:
            self.errors.append(message)

    def fail(self, message: str) -> None:
        self.errors.append(message)


def load_json(path: Path, validation: Validation) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        validation.fail(f"cannot read {path.name}: {exc}")
        return None


def normalize_token(value: object) -> str:
    """Normalize one analogy pair element without splitting it into words."""

    return "".join(
        char
        for char in unicodedata.normalize("NFKD", str(value)).casefold()
        if char.isalnum()
    )


def calculated_priority(word: dict[str, Any]) -> int | None:
    if bool(word.get("mock")) or word.get("afoqtCommon") is True:
        return 1
    if word.get("tier") == "high":
        return 2
    if word.get("tier") == "mid":
        return 3
    return None


def analogy_vocabulary(analogies: list[dict[str, Any]], validation: Validation) -> set[str]:
    tokens: set[str] = set()
    for index, question in enumerate(analogies):
        if not isinstance(question, dict):
            validation.fail(f"analogies.json[{index}] must be an object")
            continue

        stem = question.get("stem")
        if not isinstance(stem, list) or len(stem) != 2:
            validation.fail(f"analogy {question.get('id', index)!r}: stem must contain two elements")
        else:
            tokens.update(normalize_token(value) for value in stem)

        options = question.get("options")
        if not isinstance(options, list):
            validation.fail(f"analogy {question.get('id', index)!r}: options must be a list")
            continue
        correct = [option for option in options if isinstance(option, dict) and option.get("correct") is True]
        if len(correct) != 1:
            validation.fail(
                f"analogy {question.get('id', index)!r}: expected exactly one correct option, got {len(correct)}"
            )
            continue
        pair = correct[0].get("pair")
        if not isinstance(pair, list) or len(pair) != 2:
            validation.fail(f"analogy {question.get('id', index)!r}: correct pair must contain two elements")
        else:
            tokens.update(normalize_token(value) for value in pair)

    tokens.discard("")
    return tokens


def base_data_sha256(words: list[dict[str, Any]]) -> str:
    base_words = [
        {key: value for key, value in word.items() if key not in {"verbalPriority", "verbalThemes"}}
        for word in words
    ]
    canonical = json.dumps(base_words, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate() -> tuple[Validation, Counter[int | None], Counter[str], Counter[str]]:
    result = Validation()
    words = load_json(WORDS_PATH, result)
    analogies = load_json(ANALOGIES_PATH, result)
    if not isinstance(words, list):
        result.fail("words.json must contain a top-level array")
        return result, Counter(), Counter(), Counter()
    if not isinstance(analogies, list):
        result.fail("analogies.json must contain a top-level array")
        return result, Counter(), Counter(), Counter()

    result.check(len(words) == EXPECTED_TOTAL, f"word count: expected {EXPECTED_TOTAL}, got {len(words)}")
    if all(isinstance(word, dict) for word in words):
        digest = base_data_sha256(words)
        result.check(
            digest == EXPECTED_BASE_SHA256,
            f"pre-existing word data/order changed: expected SHA-256 {EXPECTED_BASE_SHA256}, got {digest}",
        )

    ids = [word.get("id") for word in words if isinstance(word, dict)]
    result.check(ids == list(range(1, EXPECTED_TOTAL + 1)), "word IDs must remain ordered 1..4608")
    result.check(len(ids) == len(set(ids)), "word IDs must be unique")

    analogy_tokens = analogy_vocabulary(analogies, result)
    priority_counts: Counter[int | None] = Counter()
    primary_counts: Counter[str] = Counter()
    membership_counts: Counter[str] = Counter()
    expected_analogy_ids: set[int] = set()
    actual_analogy_ids: set[int] = set()

    for index, word in enumerate(words):
        if not isinstance(word, dict):
            result.fail(f"words.json[{index}] must be an object")
            continue
        word_id = word.get("id", f"index {index}")
        label = f"word {word_id} ({word.get('word', '?')})"

        keys = list(word)
        result.check(
            len(keys) >= 2 and keys[-2:] == ["verbalPriority", "verbalThemes"],
            f"{label}: verbalPriority and verbalThemes must be the final two fields in that order",
        )

        expected_priority = calculated_priority(word)
        actual_priority = word.get("verbalPriority", "<missing>")
        result.check(
            actual_priority == expected_priority,
            f"{label}: verbalPriority expected {expected_priority!r}, got {actual_priority!r}",
        )
        if actual_priority in {1, 2, 3, None}:
            priority_counts[actual_priority] += 1

        themes = word.get("verbalThemes")
        if not isinstance(themes, list):
            result.fail(f"{label}: verbalThemes must be an array")
            continue
        result.check(len(themes) == len(set(themes)), f"{label}: verbalThemes contains a duplicate")
        result.check(len(themes) <= 3, f"{label}: verbalThemes has more than three tags")
        unknown = [theme for theme in themes if theme not in ALLOWED_THEMES]
        result.check(not unknown, f"{label}: unknown theme code(s): {unknown}")

        if expected_priority is None:
            result.check(themes == [], f"{label}: non-priority word must have an empty verbalThemes array")
            continue

        semantic = [theme for theme in themes if theme != ANALOGY_THEME]
        result.check(
            1 <= len(semantic) <= 2,
            f"{label}: priority word must have one primary and at most one secondary semantic theme",
        )
        if semantic:
            result.check(themes[0] in SEMANTIC_THEMES, f"{label}: first tag must be the primary semantic theme")
            primary_counts[semantic[0]] += 1
        membership_counts.update(semantic)

        has_analogy = bool(word.get("analogyRelations")) or normalize_token(word.get("word", "")) in analogy_tokens
        if has_analogy:
            expected_analogy_ids.add(word_id)
            result.check(themes[-1:] == [ANALOGY_THEME], f"{label}: analogy_core must be the final tag")
        else:
            result.check(ANALOGY_THEME not in themes, f"{label}: unexpected analogy_core tag")
        if ANALOGY_THEME in themes:
            actual_analogy_ids.add(word_id)

    result.check(
        dict(priority_counts) == EXPECTED_PRIORITY_COUNTS,
        f"priority counts: expected {EXPECTED_PRIORITY_COUNTS}, got {dict(priority_counts)}",
    )
    result.check(
        sum(primary_counts.values()) == sum(EXPECTED_PRIORITY_COUNTS[level] for level in (1, 2, 3)),
        f"primary semantic coverage: expected 2515, got {sum(primary_counts.values())}",
    )
    result.check(
        set(primary_counts) == set(SEMANTIC_THEMES),
        f"every semantic theme must have primary members; missing {sorted(set(SEMANTIC_THEMES) - set(primary_counts))}",
    )
    result.check(
        len(expected_analogy_ids) == EXPECTED_ANALOGY_CORE,
        f"derived analogy_core count: expected {EXPECTED_ANALOGY_CORE}, got {len(expected_analogy_ids)}",
    )
    missing_analogy = sorted(expected_analogy_ids - actual_analogy_ids)
    extra_analogy = sorted(actual_analogy_ids - expected_analogy_ids)
    result.check(
        not missing_analogy and not extra_analogy,
        f"analogy_core set mismatch; missing IDs {missing_analogy[:20]}, extra IDs {extra_analogy[:20]}",
    )

    return result, priority_counts, primary_counts, membership_counts


def main() -> int:
    result, priority_counts, primary_counts, membership_counts = validate()
    if result.errors:
        print(f"FAIL: {len(result.errors)} verbal-theme validation error(s)", file=sys.stderr)
        for error in result.errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("OK: verbal theme metadata is valid")
    print(
        "Priority counts: "
        + ", ".join(
            f"P{level}={priority_counts[level]}" if level is not None else f"excluded={priority_counts[level]}"
            for level in (1, 2, 3, None)
        )
    )
    print(f"Analogy core: {EXPECTED_ANALOGY_CORE}")
    print("Theme distribution (primary / all semantic memberships):")
    for theme in SEMANTIC_THEMES:
        print(f"- {theme}: {primary_counts[theme]} / {membership_counts[theme]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
