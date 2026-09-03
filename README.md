# AFOQT Master ✈️

AFOQT(미 공군 장교 자격시험) **전 과목 대비** 모바일 학습 PWA.
간격반복(SRS) 단어 암기 + 과목별 연습 + 실전 모의고사 + **Supabase 실시간 동기화**로 폰·노트북 어디서나 같은 진도로 공부합니다.

> 앱이 남은 분량 / 남은 날짜로 "하루 권장 학습량"을 자동 계산하고, 과목별 정답률로 **예상 점수(백분위)**까지 보여줍니다.

---

## ✨ 무엇이 들어있나 (12개 서브테스트)

**🗣 언어 (Verbal)**
- 📇 **Word Knowledge** — 간격반복(SM-2 SRS) 플래시카드 + 단어 시험 + 퀴즈 + 단어장. 발음 듣기(TTS), 어원(접두사·어근) 학습.
- ∞ **동의어 무한 피드** — P1/P2/P3/전체 범위를 골라 5지선다를 반복하고, 정답과 뜻을 확인한 뒤 직접 다음 문제로 이동합니다. 한글 뜻을 즉시 켜고 끌 수 있고, 오답은 5문제 뒤 재출제되며 플래시카드 복습에도 공유됩니다.
- 🔗 **Verbal Analogies** — `A : B = C : ?` 4지선다. 관계별 해설 + 틀린 문제 복습.
- 📖 **Reading Comprehension** — 지문 읽고 주제·세부·추론·문맥어휘 풀이.

**🔢 수리 (Quantitative)** — ➗ Arithmetic Reasoning · 📐 Math Knowledge (영어 문제 + 한글 번역·해설)

**✈️ Pilot · 공간** — 🛩️ Aviation Information · 📊 Table Reading · 🎚️ Instrument Comprehension · 🧱 Block Counting
(Table Reading·Block Counting·Instrument Comprehension은 **절차적 생성**으로 무한 연습)

**🔬 기타** — Physical Science · Situational Judgment · Self-Description Inventory(안내)

### 핵심 기능
- 🎓 **커리큘럼 학습** — 기초 스킬(예: 유추 관계 분류)부터 단계별, 각 단계 통과해야 다음 잠금 해제, 졸업은 실전 시험 15/25+.
- 🎯 **실전 모의고사** — ① 전과목 통합(과학·상황 제외, 표읽기·계기·블록 포함) ② 섹터별(Verbal·Quantitative·Pilot) ③ 과목별 9종. 실제 AFOQT 문항수·시간 반영 + 채점 + 문항별 해설 리뷰 + **예상 백분위**.
- 📕 **오답 노트** — 틀린 문제만 모아 재시험. **🧩 약점 분석** — 유형별 정답률로 약점 진단.
- 📈 **점수 추이 그래프** · 📅 **오늘의 통합 학습**(전 영역 믹스) · 🔁 **자동 페이싱**(하루 권장량).
- 🔄 **실시간 동기화**(Supabase) · 📱 **PWA/오프라인** · 💾 **진도 백업/복원**.
- ⭐ **AFOQT 핵심 단어** 우선 학습 — 모의고사·공개 대비 목록·편집 등급을 구분한 P1~P3 누적 범위.
- 🗂️ **Verbal 테마별 플래시카드** — 성격·감정·변화·유추 관계 등 14개 덱에서 신규/복습/전체 학습. 단어별 SRS 진도는 모든 덱에서 공유.

### 콘텐츠 분량
| 영역 | 분량 |
|------|------|
| 단어 | **4,608** (`afoqtCommon` 1,019 · P1~P3 테마 대상 2,515) |
| 유추 | **901** |
| 독해 | **105지문 / 404문제** |
| 항공 | 문제 **120** · 용어 **93** |
| 수학(산수+대수) | **160** |
| 과학 / 상황판단 | **70 / 45** |
| 어원 / 공부 가이드 | **72 / 12** |

> 데이터 파일: `words.json` `analogies.json` `reading.json` `aviation.json` `aviation_terms.json` `arithmetic.json` `mathknowledge.json` `physicalscience.json` `situational.json` `roots.json` `guides.json`

### Verbal 단어 우선순위와 테마 덱

단어 우선순위는 공식 AFOQT 출제 횟수가 아니라 앱 데이터에 남아 있는 근거를 조합한 **학습용 편집 기준**입니다. 범위는 아래처럼 누적됩니다.

| 우선순위 | 판정 기준 | 해당 / 누적 |
|---------|----------|-------------|
| P1 🔥 최우선 | `mock || afoqtCommon` | 1,053 / 1,053 |
| P2 ⭐ 고빈출까지 | P1이 아니면서 `tier: high` | 445 / 1,498 |
| P3 📌 중요까지 | P1·P2가 아니면서 `tier: mid` | 1,017 / 2,515 |
| 테마 덱 제외 | 위 조건에 해당하지 않는 `tier: std` | 2,093 |

근거에는 다음 한계가 있습니다.

- `mock`은 앱에 수록한 연습 모의고사(T01~T03, Barron's, Trivium 등)의 표제어이며, 공식 AFOQT 기출 표시가 아닙니다.
- `afoqtCommon`은 Quizlet·Barron's·커뮤니티 등 공개 AFOQT 대비 목록을 합친 태그입니다. 1,019개 전체에 대해 단어별 원본 URL이나 출처가 완전하게 보존되어 있지는 않습니다.
- `tier`의 `high`·`mid`는 공개 목록, GRE 난도, 수동 검토를 반영한 편집 등급이며 실제 시험의 출현 빈도를 측정한 값이 아닙니다. 기존 `high+mid` 학습 범위는 앱에서 **핵심**으로 표시합니다.

판정 이력은 [초기 tier 도입](https://github.com/SungHyunC/afoqt-vocab/commit/52dbe211), [AFOQT 공개 목록 반영](https://github.com/SungHyunC/afoqt-vocab/pull/14), [연습 모의고사 태깅](https://github.com/SungHyunC/afoqt-vocab/commit/51921e85), [후속 tier 재조정](https://github.com/SungHyunC/afoqt-vocab/pull/107)에서 확인할 수 있습니다. 14개 테마의 포함·제외 기준과 분포는 [`VERBAL_THEMES.md`](VERBAL_THEMES.md)에 기록했습니다.

`words.json`의 모든 단어는 다음 필드를 가집니다.

```json
{
  "verbalPriority": 1,
  "verbalThemes": ["change_quantity", "state_degree"]
}
```

- `verbalPriority`는 P1·P2·P3에 각각 `1`·`2`·`3`, 테마 덱 제외 단어에는 `null`입니다.
- `verbalThemes`는 주된 뜻을 기준으로 분류한 배열입니다. P1~P3 단어는 13개 의미 테마 중 하나를 주 테마로 가지며, 뜻이 명확히 겹칠 때 보조 테마를 가질 수 있습니다.
- `analogy_core`는 Verbal Analogies의 제시어·정답쌍 또는 `analogyRelations`에 근거한 별도 관계 태그입니다.
- 의미 테마 코드는 `character_attitude`, `emotion_psychology`, `change_quantity`, `conflict_criticism`, `agreement_support`, `clarity_ambiguity`, `knowledge_judgment`, `communication`, `law_power_control`, `economy_value`, `state_degree`, `movement_time`, `success_risk`입니다.

앱의 **🗂️ 고빈출 테마별 플래시카드**에서 누적 우선순위(P1 / P1+P2 / P1+P2+P3)와 학습 방식(신규 / 복습 대기 / 전체 섞기)을 고를 수 있습니다. 테마가 달라도 학습 상태는 같은 단어 ID에 저장되므로 SRS 진도가 중복되지 않습니다.

---

## 🚀 설치 (3단계)

### 1. Supabase 프로젝트 만들기 (무료, ~5분)
1. <https://supabase.com> 가입 → **New Project**.
2. 좌측 **SQL Editor** → New query → [`supabase/schema.sql`](supabase/schema.sql) 전체 붙여넣고 **RUN**.
3. **Project Settings → API** 에서 **Project URL** 과 **anon public key** 복사.

> ⚠️ **업그레이드 시**: `supabase/schema.sql` 을 **다시 실행**하세요 (`app_state` 등 새 테이블 추가, 재실행 안전).

### 2. 앱에 연결
[`config.js`](config.js) 에 값 입력:
```js
window.AFOQT_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ....",
  START_DATE: "2026-06-01",
  EXAM_DATE:  "2026-08-05",   // 시험 응시 목표일
};
```
> 앱 실행 후 **⚙️ 설정 → 고급: Supabase 직접 입력** 에 붙여넣어도 됩니다.

### 3. GitHub Pages 켜기
**Settings → Pages → Branch: `main` / root** → 저장. 잠시 후 `https://<사용자명>.github.io/afoqt-vocab/` 접속.

---

## 📱 모바일에서 쓰기
- **iPhone(Safari)**: 공유 → **홈 화면에 추가**
- **Android(Chrome)**: 메뉴(⋮) → **앱 설치**

설치하면 전체화면 앱으로 열리고 오프라인에서도 동작합니다.
업데이트가 안 보이면 **⚙️ 설정 → 🔄 강제 업데이트**.

## 🔄 기기 간 동기화
1. 첫 기기에서 **동기화 코드**(⚙️ 설정) 확인 → 📋 복사.
2. 다른 기기 ⚙️ 설정 → **↘︎ 다른 코드** 에 붙여넣기.
3. 한쪽에서 풀면 다른 쪽에 실시간 반영 (단어·유추·독해·모의고사·오답노트·커리큘럼·예상점수까지).

동의어 무한 피드의 **누적 통계와 이어 풀기 위치**도 같은 코드의 기기에서 복원되며, 여러 기기에서 푼 통계는 기기별 기록을 안전하게 합산합니다.

> 동기화 코드는 비밀번호 역할입니다. 무작위로 길게 생성되며 노출되지 않게 보관하세요.

---

## 🗂 파일 구조
| 파일 | 설명 |
|------|------|
| `index.html` / `app.css` / `app.js` | 앱 셸 / 스타일 / 학습 엔진·동기화 |
| `config.js` | Supabase URL/key, 일정 |
| `*.json` | 과목별 문제·단어·용어·가이드 데이터 |
| `sw.js` | 서비스워커(오프라인 캐시) |
| `manifest.webmanifest` · `icon.svg` | PWA 설치 메타/아이콘 |
| `supabase/schema.sql` | Supabase 테이블·실시간·RLS 스키마 |

## 🔒 보안 메모
개인용이라 로그인 대신 **동기화 코드**로 데이터를 구분합니다. anon key는 공개돼도 되는 키이며, 접근 분리는 추측 불가능한 동기화 코드로 이루어집니다. 여러 명이 쓰거나 민감 데이터가 생기면 Supabase Auth + 사용자별 RLS로 업그레이드하세요.

> ⚠️ 문제·해설은 학습용으로 제작/생성된 콘텐츠이며 비공식 추정 점수를 제공합니다. 실제 AFOQT 점수 환산과 다를 수 있습니다.
