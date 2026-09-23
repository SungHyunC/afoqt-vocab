-- ============================================================
-- AFOQT Master — Supabase 스키마 (v3.x, 전 과목)
-- ------------------------------------------------------------
-- 사용법: supabase.com → 프로젝트 → SQL Editor 에 아래 전체를
--        붙여넣고 RUN 하세요. 여러 번 다시 실행해도 안전합니다.
-- ============================================================

-- 단어별 학습 상태 (Word Knowledge SRS)
create table if not exists public.vocab_state (
  user_key    text        not null,
  word_id     integer     not null,
  status      text        not null default 'new',
  reps        integer     not null default 0,
  lapses      integer     not null default 0,
  ease        real        not null default 2.5,
  interval    real        not null default 0,
  due         timestamptz,
  starred     boolean     not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_key, word_id)
);

-- v4.16: 확인 시험(진짜 암기 검증) — 자가채점(플래시카드)과 별개로
-- blind 4지선다 퀴즈로 통과했는지, 7일 뒤 재확인까지 통과했는지 기록.
-- verify: null(미확인) | 'pending'(1차 통과, 재확인 대기) | 'verified'(2차까지 통과)
alter table public.vocab_state add column if not exists verify     text;
alter table public.vocab_state add column if not exists verify_due timestamptz;

-- Verbal Analogies / Reading Comprehension 진도 + 무한 동의어 피드 replica
-- (kind = 'va' | 'rc' | 'synfeed'; synfeed item_id는 기기별 replica ID)
create table if not exists public.verbal_progress (
  user_key    text        not null,
  kind        text        not null,
  item_id     text        not null,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_key, kind, item_id)
);

-- 날짜별 학습 기록 (스트릭 / 통계 — 모든 섹션 합산)
create table if not exists public.daily_log (
  user_key    text        not null,
  day         date        not null,
  studied     integer     not null default 0,
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
  daily_goal  integer     not null default 0,
  start_date  date,
  exam_date   date,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 그 외 진도(모의고사 점수·오답노트·약점분석·예상점수·점수추이·커리큘럼·
-- 항공/수학 등)를 하나의 JSON 으로 동기화
create table if not exists public.app_state (
  user_key    text        primary key,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 실시간(Realtime) 활성화 — 이미 추가돼 있으면 건너뜀
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['vocab_state','verbal_progress','daily_log','settings','app_state'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- RLS — 개인용(로그인 없음). 데이터 구분은 동기화 코드(user_key).
-- ------------------------------------------------------------
alter table public.vocab_state     enable row level security;
alter table public.verbal_progress enable row level security;
alter table public.daily_log       enable row level security;
alter table public.settings        enable row level security;
alter table public.app_state       enable row level security;

drop policy if exists "anon all vocab_state"     on public.vocab_state;
drop policy if exists "anon all verbal_progress" on public.verbal_progress;
drop policy if exists "anon all daily_log"       on public.daily_log;
drop policy if exists "anon all settings"        on public.settings;
drop policy if exists "anon all app_state"       on public.app_state;

create policy "anon all vocab_state"     on public.vocab_state     for all to anon using (true) with check (true);
create policy "anon all verbal_progress" on public.verbal_progress for all to anon using (true) with check (true);
create policy "anon all daily_log"       on public.daily_log       for all to anon using (true) with check (true);
create policy "anon all settings"        on public.settings        for all to anon using (true) with check (true);
create policy "anon all app_state"       on public.app_state       for all to anon using (true) with check (true);

-- ------------------------------------------------------------
-- v4.150: 학습 증거 로그 (append-only). 각 기기가 자기 이벤트를 INSERT만 한다.
-- anon 키에는 update/delete 정책이 없어 기록을 고칠 수 없고, received_at은
-- 트리거가 서버 시각으로 강제한다(클라이언트가 지정해도 덮어씀).
-- 이 테이블이 없어도 앱은 로컬·verbal_progress(evlog) 경로로 정상 동작한다.
-- ------------------------------------------------------------
create table if not exists public.study_log (
  user_key    text        not null,
  device_id   text        not null,
  event_id    text        not null,
  seq         integer     not null,
  client_ts   timestamptz not null,
  data        jsonb       not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  primary key (user_key, event_id)
);
create index if not exists study_log_user_dev_seq on public.study_log (user_key, device_id, seq);

create or replace function public.study_log_stamp() returns trigger language plpgsql as $$
begin new.received_at := now(); return new; end $$;
drop trigger if exists study_log_stamp on public.study_log;
create trigger study_log_stamp before insert on public.study_log for each row execute function public.study_log_stamp();

alter table public.study_log enable row level security;
drop policy if exists "anon insert study_log" on public.study_log;
drop policy if exists "anon select study_log" on public.study_log;
create policy "anon insert study_log" on public.study_log for insert to anon with check (true);
create policy "anon select study_log" on public.study_log for select to anon using (true);
-- update/delete 정책 없음 → anon 키로는 수정·삭제 불가 (append-only)
