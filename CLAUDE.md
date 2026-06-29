# afoqt-vocab — 작업 규칙

## 배포 (중요)
- **항상 `main`에 머지한다.** 작업 브랜치(`claude/vocab-app-remake-cnNAr`)에서 작업·푸시한 뒤, 매번 묻지 말고 PR 생성 → `main`에 머지까지 완료한다. `main`이 폰 라이브 앱(GitHub Pages)이므로 머지해야 사용자가 변경을 볼 수 있다.
- 버전 변경 시 `app.js`의 `VERSION` 과 `sw.js`의 `CACHE` 를 함께 올린다(캐시 무효화).
- 새 데이터 파일을 추가하면 `sw.js`의 `ASSETS` 목록에도 넣는다.

## 구조 메모
- 순수 정적 PWA: `index.html` + `app.js`(단일 파일) + `app.css` + `sw.js`. 빌드 없음.
- 콘텐츠는 JSON 풀: `words.json`, `analogies.json`, `reading.json`, `arithmetic.json`,
  `mathknowledge.json`, `physicalscience.json`, `aviation.json`, `situational.json`,
  `roots.json`, `root_lessons.json`(어근 코치).
- 시험 실행기(`renderExamQ`)는 `coach*` 가 아닌 `rc*` 접두사 ID를 쓰는 독해(RC)와 별개다.
  어근 코치 ID는 `coach*` 접두사로 통일(충돌 회피).
