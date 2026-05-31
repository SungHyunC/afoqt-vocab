# AFOQT Vocab Master 📇

AFOQT **Verbal** 단어 암기용 모바일 학습 PWA.
간격반복(SRS)으로 단어를 외우고, **Supabase 실시간 동기화**로 폰·노트북 어디서나 같은 진도로 공부합니다.

> 목표: **6/1 시작 → 7/10 시험**. 앱이 남은 단어 / 남은 날짜로 "하루 신규 단어 권장량"을 자동 계산해 줍니다.

---

## ✨ 기능

**AFOQT Verbal 섹션 전체**를 한 앱에서:

- 📇 **Word Knowledge (어휘)** — 간격반복(SM-2 SRS) 플래시카드 + 퀴즈(영→뜻/뜻→영/동의어) + 단어장.
- 🔗 **Verbal Analogies (유추)** — `A : B = C : ?` 4지선다 120문제, 관계별 해설 + 틀린 문제 복습.
- 📖 **Reading Comprehension (독해)** — 지문 16개 × 문제 48개(주제·세부·추론·문맥어휘), 즉시 채점.

여기에:

- ⭐ **빈출(tier) 우선 학습** — 핵심(high) → 중요(mid) → 일반(std) 순 페이싱, "빈출만 학습" 토글.
- **일정 페이싱** — 7/10까지 1회독 끝내도록 하루 신규 단어 수 자동 계산.
- **스트릭 + 달력** — 매일 목표 달성 시 🔥 스트릭(세 섹션 합산), 6/1~7/10 달력.
- **실시간 동기화** — Supabase Postgres + Realtime. 한 기기에서 풀면 다른 기기에 즉시 반영.
- **PWA / 오프라인** — 홈 화면 설치, 오프라인 학습(온라인 복귀 시 동기화).

데이터:
- `words.json` — **4,032 단어** (한글뜻·영영정의·예문·동의어·유추관계 + `tier`/`source`). 기존 AFOQT 세트 + **GRE Magoosh 약 928단어** 추가.
- `analogies.json` — 유추 120문제 · `reading.json` — 독해 지문 16개.

> ⚠️ **업그레이드 시**: Supabase SQL Editor 에서 `supabase/schema.sql` 을 **다시 한 번 실행**하세요 (유추·독해 동기화용 `verbal_progress` 테이블이 추가됨, 재실행 안전).

---

## 🚀 설치 (3단계)

### 1. Supabase 프로젝트 만들기 (무료, ~5분)
1. <https://supabase.com> 가입 → **New Project** 생성.
2. 좌측 **SQL Editor** → New query → 이 저장소의 [`supabase/schema.sql`](supabase/schema.sql) 전체를 붙여넣고 **RUN**.
3. 좌측 **Project Settings → API** 에서 아래 두 값 복사:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon public key** (`eyJ...`)

### 2. 앱에 연결
[`config.js`](config.js) 를 열어 두 값을 채우고 커밋:
```js
window.AFOQT_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ....",
  START_DATE: "2026-06-01",
  EXAM_DATE:  "2026-07-10",
};
```
> 파일 편집이 번거로우면, 앱 실행 후 **⚙️ 설정 → 고급: Supabase 직접 입력** 에 붙여넣어도 됩니다(이 기기에만 저장).

### 3. GitHub Pages 켜기
저장소 **Settings → Pages → Branch: `main` (또는 배포 브랜치) / root** 선택 → 저장.
잠시 후 `https://<사용자명>.github.io/afoqt-vocab/` 로 접속됩니다.

---

## 📱 모바일에서 쓰기 (홈 화면에 설치)

- **iPhone (Safari)**: 공유 버튼 → **홈 화면에 추가**.
- **Android (Chrome)**: 메뉴(⋮) → **앱 설치 / 홈 화면에 추가**.

설치하면 일반 앱처럼 전체화면으로 열리고 오프라인에서도 동작합니다.

---

## 🔄 기기 간 실시간 동기화 방법

1. 첫 기기에서 앱을 열면 **동기화 코드(Sync Code)** 가 자동 생성됩니다 (⚙️ 설정에서 확인).
2. **📋 복사** 로 코드를 복사.
3. 두 번째 기기(폰)에서 앱을 열고 ⚙️ 설정 → **↘︎ 다른 코드 입력** 에 같은 코드를 붙여넣기.
4. 이제 두 기기가 같은 데이터를 공유하며, 한쪽에서 단어를 풀면 다른 쪽에 실시간 반영됩니다.

> 동기화 코드는 비밀번호 역할을 합니다(로그인이 없으므로). 무작위로 길게 생성되며, 노출되지 않게 보관하세요.

---

## 🗂 파일 구조

| 파일 | 설명 |
|------|------|
| `index.html` | 앱 화면(셸) |
| `app.css` | 스타일 (모바일 우선, 다크) |
| `app.js` | 학습 엔진 · SRS · 동기화 · 화면 로직 |
| `config.js` | Supabase URL/key, 일정 설정 |
| `words.json` | 단어 데이터 (4,032개, GRE 포함) |
| `analogies.json` | 유추 문제 (120) |
| `reading.json` | 독해 지문 (16) |
| `sw.js` | 서비스워커 (오프라인 캐시) |
| `manifest.webmanifest` · `icon.svg` | PWA 설치 메타/아이콘 |
| `supabase/schema.sql` | Supabase 테이블·실시간·보안 스키마 |

---

## 🔒 보안 메모

개인용이라 로그인 대신 **동기화 코드**로 데이터를 구분합니다. anon key는 공개되어도 되는 키이며,
실제 접근 분리는 추측 불가능한 동기화 코드로 이루어집니다. 여러 명이 쓰거나 민감 데이터가 생기면
Supabase Auth(이메일 로그인) + 사용자별 RLS로 업그레이드하세요.
