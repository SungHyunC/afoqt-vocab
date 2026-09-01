# AFOQT Verbal 테마 분류 기준과 검증 보고서

## 1. 우선순위의 근거와 한계

`tier: high`는 공식 AFOQT 기출 빈도나 출현 횟수가 아니다. 공개 AFOQT 대비 목록,
GRE 난도, 앱 편집 과정의 승격·강등을 합친 학습용 등급이다. `mock`도 앱에 수록된
연습 모의고사의 표제어이며 공식 기출을 뜻하지 않는다. 따라서 화면에서는 이 데이터를
“공식 고빈출”이라고 표현하지 않고 다음의 누적 학습 우선순위로 사용한다.

| 우선순위 | 계산식 | 단어 수 | 의미 |
|---|---|---:|---|
| P1 최우선 | 비어 있지 않은 `mock` 또는 `afoqtCommon: true` | 1,053 | 연습 모의고사 또는 수집된 AFOQT 대비 목록에 등장 |
| P2 고빈출 | P1이 아니면서 `tier: high` | 445 | 편집상 high 등급 |
| P3 중요 | P1·P2가 아니면서 `tier: mid` | 1,017 | 편집상 mid 등급 |
| 제외 | 위 조건에 해당하지 않음 | 2,093 | 테마 덱에는 포함하지 않음 |

우선순위는 위 순서대로 계산한다. 예를 들어 `tier: std`여도 `mock`에 있으면 P1이고,
`tier: high`여도 `afoqtCommon`이면 P2가 아니라 P1이다. 기존 `tier`, `mock`,
`afoqtCommon`, `source` 값은 수정하지 않았다.

이 판정의 데이터 이력은 [초기 tier 도입](https://github.com/SungHyunC/afoqt-vocab/commit/52dbe211),
[AFOQT 공개 목록 반영](https://github.com/SungHyunC/afoqt-vocab/pull/14),
[연습 모의고사 태깅](https://github.com/SungHyunC/afoqt-vocab/commit/51921e85),
[후속 tier 재조정](https://github.com/SungHyunC/afoqt-vocab/pull/107)에서 확인할 수 있다.

## 2. 의미 테마 판정 규칙

P1~P3의 2,515개 단어는 아래 13개 의미 테마 중 정확히 하나를 주 테마로 갖는다.
뜻이 두 영역에 직접 걸치는 경우에만 보조 테마 하나를 추가했다. 배열은 항상
`주 의미 → 보조 의미 → analogy_core` 순서이고, 태그는 최대 3개다. 제외 단어는
`verbalPriority: null`, `verbalThemes: []`이다.

| 코드 | 표시명 | 포함 기준 | 제외·경계 기준 |
|---|---|---|---|
| `character_attitude` | 🧑 성격·태도 | 지속적인 성향, 도덕성, 행동 습관, 대인 태도 | 일시적인 감정은 `emotion_psychology` |
| `emotion_psychology` | 💭 감정·심리 | 감정, 기분, 욕구, 심리 반응, 정신 상태 | 지속적인 인격 특성은 `character_attitude` |
| `change_quantity` | 📈 증가·감소·변화 | 증감, 변형, 개선·악화, 추가·제거, 강도 변화 | 단순히 크거나 강한 상태는 `state_degree` |
| `conflict_criticism` | ⚔️ 갈등·비판·적대 | 반대, 공격, 비난, 모욕, 분쟁, 적대 | 법적 강제·처벌 자체는 `law_power_control` |
| `agreement_support` | 🤝 동의·협력·지지 | 동의, 승인, 협조, 원조, 지지, 칭찬, 확증 | 단순 발화·설득 방식은 `communication` |
| `clarity_ambiguity` | 🔎 정확·명확·모호 | 명료·정확·진실, 모호·불확실, 은폐·기만 | 사고·추론 능력은 `knowledge_judgment` |
| `knowledge_judgment` | 🧠 지식·사고·판단 | 학습, 추론, 증거, 판단, 지성, 인식, 분석 | 말과 글의 형식은 `communication` |
| `communication` | 💬 말·글·의사소통 | 발언, 글쓰기, 언어, 설득, 침묵, 문체, 전달 | 발언의 적대성은 필요할 때 갈등 보조 태그 |
| `law_power_control` | ⚖️ 법·권력·통제 | 법, 권한, 명령, 금지, 강제, 복종, 처벌, 통치 | 일반적인 방해·위험은 `success_risk` |
| `economy_value` | 💰 경제·가치·자원 | 돈, 부·빈곤, 비용, 거래, 가치, 절약·낭비, 희소성 | 일반적인 수량 변화는 `change_quantity` |
| `state_degree` | 🎚️ 상태·성질·정도 | 크기, 강도, 지속성, 보편성, 물리·추상 속성 | 다른 12개 테마가 주된 뜻을 설명하면 후순위 |
| `movement_time` | 🚶 이동·위치·시간 | 이동, 방향, 위치, 순서, 시점, 기간, 과거·미래 | 성공으로의 진행·방해는 `success_risk` |
| `success_risk` | 🎯 성공·실패·위험 | 성취, 실패, 노력, 장애, 회복, 기회, 위험, 안전 | 권력에 의한 금지·억압은 `law_power_control` |

판정에는 표제어의 `kor`와 `def`에 적힌 주된 뜻을 우선 사용했다. `pos`와
`synonyms`는 그 뜻을 교차 확인하는 자료로 사용했다. 예문에 우연히 등장한 개념이나
어근 설명만으로 테마를 붙이지 않았다. 자동 의미 점수로 초안을 만든 뒤 P1~P3
2,515개를 ID 1~2,304와 2,305~4,608 구간으로 나누어 표제어별로 전수 검토했고,
파생형과 유의어군의 주 테마도 교차 확인했다. 마지막 전수 감사에서 의미 배열 526개를
추가 보정했다. 현재 348개 단어가 명확한 두 번째 의미 테마를 가진다.

대표 판정은 다음과 같다.

- `BENEVOLENT`, `OBSTINATE`, `PRUDENT` → 성격·태도
- `APPREHENSIVE`, `ELATED`, `INDIFFERENT` → 감정·심리
- `ABATE`, `AUGMENT` → 증가·감소·변화
- `ADMONISH`, `ANTAGONIZE`, `REBUKE` → 갈등·비판·적대
- `ACQUIESCE`, `CORROBORATE` → 동의·협력·지지
- `EXPLICIT`, `LUCID`, `AMBIGUOUS` → 정확·명확·모호
- `DISCERN`, `ERUDITE`, `COGENT` → 지식·사고·판단 (`COGENT`는 명확성 보조 태그)
- `ELOQUENT`, `TACITURN`, `VERBOSE` → 말·글·의사소통
- `ARBITRARY`, `COERCIVE` → 법·권력·통제 (`ARBITRARY`는 판단 보조 태그)
- `FRUGAL`, `LAVISH` → 경제·가치·자원
- `NEGLIGIBLE`, `PERVASIVE` → 상태·성질·정도
- `TRANSIENT` → 이동·위치·시간
- `IMPEDE`, `PRECARIOUS` → 성공·실패·위험

초기 제안의 예시 중 `DWINDLE`, `SCARCE`, `RECEDE`는 현재 `words.json`에 없다.
`ENDORSE`, `MANDATE`, `DURABLE`, `PRECEDE`, `ATTAIN`은 `tier: std`이면서 `mock`과
`afoqtCommon` 근거가 없어 엄격한 계산식상 제외된다. 예시를 맞추기 위해 우선순위나
기존 근거 데이터를 임의로 바꾸지 않았다.

## 3. 유추 핵심 관계어

`analogy_core`는 P1~P3 단어 중 다음 조건을 하나라도 만족할 때만 마지막 태그로 붙는다.

1. `analogyRelations`가 비어 있지 않다.
2. 표제어가 `analogies.json`의 `stem` 또는 정답(`correct: true`) 선택지의 pair 요소와
   정규화 후 정확히 일치한다.

정규화는 Unicode NFKD, 대소문자 통합, 영숫자 이외 문자 제거를 적용한다. pair의 한
요소 전체를 비교하며 부분 문자열이나 유사 철자는 허용하지 않는다. 오답 선택지는
사용하지 않는다. 이 규칙으로 정확히 348개가 `analogy_core`에 포함된다. P0 단어는
유추 데이터에 등장하더라도 테마 덱 범위 밖이므로 태그가 비어 있다.

## 4. 분류 결과

아래의 P1/P2/P3은 주 테마 기준이다. “전체 소속”은 보조 의미 소속을 포함하지만
`analogy_core`는 제외한 값이다.

| 테마 | P1 | P2 | P3 | 주 테마 합계 | 전체 소속 |
|---|---:|---:|---:|---:|---:|
| 성격·태도 | 148 | 42 | 169 | 359 | 396 |
| 감정·심리 | 99 | 21 | 88 | 208 | 240 |
| 증가·감소·변화 | 63 | 50 | 87 | 200 | 214 |
| 갈등·비판·적대 | 84 | 37 | 107 | 228 | 245 |
| 동의·협력·지지 | 52 | 16 | 37 | 105 | 122 |
| 정확·명확·모호 | 75 | 25 | 55 | 155 | 198 |
| 지식·사고·판단 | 65 | 50 | 87 | 202 | 236 |
| 말·글·의사소통 | 84 | 38 | 62 | 184 | 224 |
| 법·권력·통제 | 44 | 28 | 72 | 144 | 157 |
| 경제·가치·자원 | 42 | 10 | 28 | 80 | 101 |
| 상태·성질·정도 | 175 | 73 | 112 | 360 | 395 |
| 이동·위치·시간 | 65 | 27 | 54 | 146 | 170 |
| 성공·실패·위험 | 57 | 28 | 59 | 144 | 165 |
| **합계** | **1,053** | **445** | **1,017** | **2,515** | **2,863** |

하나의 테마가 150개를 넘는 경우는 UI에서 최대 150개짜리 하위 덱으로 균등 분할한다.
데이터 단계에서는 학습 세션 크기를 맞추기 위해 의미상 자연스러운 소속을 제거하지 않는다.

## 5. 자동 검증

다음 명령은 표준 라이브러리만 사용한다.

```shell
python scripts/validate_verbal_themes.py
```

검증기는 다음을 실패 조건으로 검사한다.

- 4,608개와 ID 1~4,608의 순서·고유성 및 기존 필드/값/키 순서의 SHA-256 보존
- P1 1,053 / P2 445 / P3 1,017 / 제외 2,093의 정확한 계산
- 모든 P1~P3 단어의 주 의미 테마, 최대 한 개의 보조 의미 테마, P0의 빈 배열
- 허용 코드, 중복 금지, 최대 3개, 의미 태그 우선 및 `analogy_core` 마지막 순서
- `analogyRelations`와 stem/정답쌍에서 다시 계산한 348개 유추 단어 ID의 정확한 일치
