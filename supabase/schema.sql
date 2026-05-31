-- ============================================================
-- AFOQT Vocab Master — Supabase 스키마
-- ------------------------------------------------------------
-- 사용법: supabase.com → 프로젝트 → SQL Editor 에 아래 전체를
--        붙여넣고 RUN 하세요. (한 번만 실행하면 됩니다)
-- ============================================================

-- 단어별 학습 상태 (간격반복 SRS)
create table if not exists public.vocab_state (
  user_key    text        not null,          -- 동기화 코드 (기기 구분용 비밀값)
  word_id     integer     not null,
  status      text        not null default 'new',   -- new | learning | review | mastered
  reps        integer     not null default 0,
  lapses      integer     not null default 0,
  ease        real        not null default 2.5,
  interval    real        not null default 0,        -- 일(day)
  due         timestamptz,                            -- 다음 복습 예정
  starred     boolean     not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_key, word_id)
);

-- 날짜별 학습 기록 (스트릭 / 통계용)
create table if not exists public.daily_log (
  user_key    text        not null,
  day         date        not null,
  studied     integer     not null default 0,   -- 그날 학습한 카드 수
  correct     integer     not null default 0,
  new_learned integer     not null default 0,
  seconds     integer     not null default 0,
  goal_met    boolean     not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_key, day)
);

-- 사용자 설정
create table if not exists public.settings (
  user_key    text        primary key,
  daily_goal  integer     not null default 60,
  start_date  date,
  exam_date   date,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 실시간(Realtime) 활성화
-- ------------------------------------------------------------
alter publication supabase_realtime add table public.vocab_state;
alter publication supabase_realtime add table public.daily_log;
alter publication supabase_realtime add table public.settings;

-- ------------------------------------------------------------
-- RLS (Row Level Security)
-- ------------------------------------------------------------
-- 개인용 앱이라 로그인을 쓰지 않으므로, anon 키로 읽고 쓸 수 있게 합니다.
-- 데이터 보호는 "동기화 코드(user_key)"를 충분히 길고 무작위로 두는 것으로 합니다.
-- (앱이 자동으로 강력한 코드를 생성해 줍니다.)
alter table public.vocab_state enable row level security;
alter table public.daily_log   enable row level security;
alter table public.settings    enable row level security;

drop policy if exists "anon all vocab_state" on public.vocab_state;
drop policy if exists "anon all daily_log"   on public.daily_log;
drop policy if exists "anon all settings"    on public.settings;

create policy "anon all vocab_state" on public.vocab_state
  for all to anon using (true) with check (true);
create policy "anon all daily_log" on public.daily_log
  for all to anon using (true) with check (true);
create policy "anon all settings" on public.settings
  for all to anon using (true) with check (true);
