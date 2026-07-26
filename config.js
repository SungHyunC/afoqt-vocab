/* ============================================================
   Supabase 연동 설정
   ------------------------------------------------------------
   실시간 동기화를 켜려면 아래 두 값을 채우세요.
   (supabase.com → 프로젝트 → Settings → API 에서 확인)

   - SUPABASE_URL : Project URL          (예: https://xxxx.supabase.co)
   - SUPABASE_ANON_KEY : anon public key (브라우저에 공개되어도 되는 키)

   ※ anon key 는 공개되어도 안전하도록 설계된 키입니다.
     실제 데이터 접근은 "동기화 코드(Sync Code)"로 구분되며,
     동기화 코드는 이 파일이 아니라 각 기기에 따로 저장됩니다.

   값을 비워두면 앱은 오프라인(이 기기에만 저장) 모드로 동작합니다.
   ============================================================ */
window.AFOQT_CONFIG = {
  SUPABASE_URL: "https://tlmihslbopfavidylikp.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable__MviWEJZbvRXVnEe32pD4w_QuwwXWpA",

  // 학습 일정 (기본값)
  START_DATE: "2026-06-01",  // 단어 외우기 시작
  EXAM_DATE:  "2026-09-07",  // 시험 응시 목표일 (성적 제출 마감 9/25, 처리 여유 18일)
};
