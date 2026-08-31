/* ============================================================
   AFOQT Master — app.js
   Verbal 전체: Word Knowledge(WK) + Verbal Analogies(VA) + Reading(RC)
   로컬 우선 + Supabase 실시간 동기화, SM-2 SRS, 빈출 tier 페이싱
   ============================================================ */
(() => {
"use strict";

const VERSION = "4.116.0";
const CFG = window.AFOQT_CONFIG || {};
const LS = { state:"afoqt_state_v2", code:"afoqt_sync_code", url:"afoqt_sb_url", key:"afoqt_sb_key" };

/* ---------- helpers ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const nowISO = () => new Date().toISOString();
const todayStr = (d=new Date()) => { const z=new Date(d.getTime()-d.getTimezoneOffset()*60000); return z.toISOString().slice(0,10); };
const parseDate = s => { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
const dayDiff = (a,b) => Math.round((parseDate(b)-parseDate(a))/86400000);
const shuffle = a => { a=[...a]; for(let i=a.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]];} return a; };
const sample = (arr,n) => shuffle(arr).slice(0,n);
const esc = s => String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
// Lightweight inline math renderer (no external lib — offline PWA). Turns ^exponents
// and _subscripts into real super/subscripts and normalizes a few operators, so
// "c^2 = a^2 + b^2" shows as c² = a² + b². Safe on prose (^ _ * <= rarely occur there).
function fmtMath(s){
  return esc(String(s==null?"":s))
    .replace(/\bsqrt\s*\(/gi,'√(')
    .replace(/\^\{([^}]+)\}/g,(m,g)=>`<sup>${g}</sup>`)
    .replace(/\^\(([^)]+)\)/g,(m,g)=>`<sup>(${g})</sup>`)
    .replace(/\^(-?\d+(?:\.\d+)?|[A-Za-z])/g,(m,g)=>`<sup>${g}</sup>`)
    .replace(/_\{([^}]+)\}/g,(m,g)=>`<sub>${g}</sub>`)
    .replace(/_(\d+|[A-Za-z])/g,(m,g)=>`<sub>${g}</sub>`)
    .replace(/\bpi\b/g,'π')
    .replace(/\s*\*\s*/g,' × ')
    .replace(/&lt;=/g,'≤').replace(/&gt;=/g,'≥').replace(/!=/g,'≠');
}
// Shrink the font for long single words/phrases (CIRCUMNAVIGATE, INTROSPECTIVE...) so they
// stay on one line on narrow phones instead of wrapping mid-word or overflowing the card.
/* ===== 어근 교차 참조 — 같은 어근을 쓰는 단어 묶어 보기 ===== */
let ROOTIDX=null;               // { form: {m, ids:[wordId...]} }
function buildRootIndex(){
  ROOTIDX={};
  for(const w of WORDS) for(const r of (w.roots||[])){
    const k=String(r.f||"").trim(); if(!k) continue;
    const e=ROOTIDX[k]||(ROOTIDX[k]={m:r.m||"",ids:[]});
    if(!e.m&&r.m) e.m=r.m;
    e.ids.push(w.id);
  }
}
function rootSiblings(form){ if(!ROOTIDX) buildRootIndex(); return ROOTIDX[form]||{m:"",ids:[]}; }
// 어근 하나를 눌렀을 때: 같은 어근 단어 목록 시트
function showRootWords(form){
  const e=rootSiblings(form);
  const list=e.ids.map(id=>WMAP.get(id)).filter(Boolean)
    .sort((a,b)=>(tierOf(a)==="high"?0:1)-(tierOf(b)==="high"?0:1)||a.word.localeCompare(b.word));
  openSheet(`<div class="row" style="justify-content:space-between;align-items:center">
      <div><h3 style="margin:0;font-size:24px;color:var(--brand2)">${esc(form)}</h3>
        <div class="muted" style="font-size:13px;margin-top:4px">${esc(e.m||"")}</div></div>
      <span class="pill">${list.length}개 단어</span></div>
    ${list.length?`<div class="wlist" style="margin-top:14px">${list.map(w=>`
      <div class="witem" data-rid="${w.id}"><div style="min-width:0">
        <div class="w">${esc(w.word)}</div><div class="k">${esc(w.kor||w.def||"")}</div></div>
        ${tierOf(w)==="high"?`<span class="tag mastered">빈출</span>`:""}</div>`).join("")}</div>`
      :`<div class="card center muted" style="margin-top:14px;padding:14px">이 어근을 쓰는 다른 단어가 아직 없어요.</div>`}
    <button class="btn ghost" id="rwClose" style="margin-top:18px">닫기</button>`);
  $$("#genericSheetBody .witem[data-rid]").forEach(el=>el.onclick=()=>showWord(+el.dataset.rid));
  $("#rwClose").onclick=closeSheet;
}
// 단어의 어근 분해 표시 (roots/hook 이 있을 때만)
function rootsHTML(w){
  if(!w||!Array.isArray(w.roots)||!w.roots.length) return "";
  if(!ROOTIDX) buildRootIndex();
  const parts=w.roots.map(r=>{ const n=(rootSiblings(String(r.f||"").trim()).ids.length)||1;
    return n>1 ? `<button class="rt rtlink" data-root="${esc(r.f)}"><b>${esc(r.f)}</b> ${esc(r.m)}<span class="rn">${n}</span></button>`
               : `<span class="rt"><b>${esc(r.f)}</b> ${esc(r.m)}</span>`; }).join('<span class="rp">+</span>');
  return `<div class="wroots">${parts}${w.hook?`<div class="rhook">→ ${esc(w.hook)}</div>`:""}</div>`;
}
// 어근 칩 클릭 위임 (플래시카드·단어상세·시트 어디서든 동작)
document.addEventListener("click",e=>{ const b=e.target.closest&&e.target.closest(".rtlink");
  if(b){ e.preventDefault(); e.stopPropagation(); showRootWords(b.dataset.root); } },true);
function wordFont(text,base){ const n=String(text||"").length;
  const px = n<=9?base : n<=12?Math.round(base*0.8) : n<=15?Math.round(base*0.63) : n<=19?Math.round(base*0.5) : Math.round(base*0.42);
  return `font-size:${px}px`; }
function toast(msg, ms=1800){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"), ms); }
// Text-to-speech (browser built-in). Speaks English words/sentences for pronunciation.
let _voices=[];
function loadVoices(){ try{ _voices=window.speechSynthesis? window.speechSynthesis.getVoices():[]; }catch{} }
// 여러 문장을 끊김 없이 이어 읽기 (speak는 매 호출마다 cancel하므로 별도 함수)
function speakSeq(items){
  try{
    const synth=window.speechSynthesis; if(!synth) return;
    synth.cancel();
    if(!_voices.length) loadVoices();
    for(const it of items){
      if(!it||!it.t) continue;
      const ko=/^ko/i.test(it.lang||"");
      const u=new SpeechSynthesisUtterance(String(it.t));
      u.lang=it.lang||"en-US"; u.rate=ko?0.95:0.92;
      const v= ko ? (_voices.find(x=>/ko[-_]KR/i.test(x.lang))||_voices.find(x=>/^ko/i.test(x.lang)))
                  : (_voices.find(x=>/en[-_]US/i.test(x.lang))||_voices.find(x=>/^en/i.test(x.lang)));
      if(v) u.voice=v;
      synth.speak(u);
    }
  }catch(e){}
}
function speak(text, ev, lang){
  if(ev){ ev.stopPropagation&&ev.stopPropagation(); }
  try{
    const synth=window.speechSynthesis; if(!synth){ toast("이 브라우저는 음성을 지원하지 않아요"); return; }
    synth.cancel();
    const u=new SpeechSynthesisUtterance(String(text)); u.lang=lang||"en-US"; u.rate=0.92;
    if(!_voices.length) loadVoices();
    const ko = lang && /^ko/i.test(lang);
    const v = ko ? (_voices.find(x=>/ko[-_]KR/i.test(x.lang))||_voices.find(x=>/^ko/i.test(x.lang)))
                 : (_voices.find(x=>/en[-_]US/i.test(x.lang))||_voices.find(x=>/^en/i.test(x.lang)));
    if(v) u.voice=v; if(ko) u.rate=0.95;
    synth.speak(u);
  }catch(e){}
}
const spkBtn=(text)=>`<button class="spk" data-spk="${esc(text)}" aria-label="발음 듣기" title="발음 듣기">🔊</button>`;
function wireSpeakers(root=document){ $$(".spk[data-spk]",root).forEach(b=>{ if(b._w) return; b._w=1; b.onclick=e=>speak(b.dataset.spk,e); }); }

/* ============================================================
   STATE
   ============================================================ */
let WORDS=[], WMAP=new Map(), ANALOGIES=[], READING=[], ROOTS=[], ROOTLESSONS=[], GUIDES={}, AVIATION=[], AVTERMS=[], AVBOOK=[];
let ARITH=[], MATHK=[], PHYSCI=[], SITJUD=[];
let state=null, sb=null, realtimeChan=null;

const DEFAULT_STATE = () => ({
  cards:{},   // WK: id -> {status,reps,lapses,ease,interval,due,starred,updated_at}
  va:{},      // VA: id -> {seen,correct,wrong,streak,status,updated_at}
  rc:{},      // RC: id -> {done,score,total,updated_at}
  daily:{},   // 'YYYY-MM-DD' -> {studied,correct,new_learned,seconds,target,goal_met,updated_at}
  exams:{},   // 'wk'|'va'|'rc'|'full' -> {best,bestTotal,last,lastTotal,date}
  wrong:{wk:{},va:{},rc:{},ar:{},mk:{},ps:{},av:{}},  // 오답 노트: 과목별 id -> 1
  weak:{vaRel:{},rcType:{},wkTier:{},topic:{}},  // 약점 분석: category -> {c,w}
  secAcc:{},  // 예상점수용 과목별 정답 누적: 'WK'|'VA'|... -> {c,w}
  wkSeen:{}, avp:{},  // readiness coverage: wordId / aviationId seen in exams
  qSeen:{ar:{},mk:{},ps:{}},  // 과목별 문항 풀이 시각 — 시험에서 중복 출제 방지
  curr:{},    // 커리큘럼: track -> {unlocked:int, passed:{si:1}, best:{si:score}}
  checklist:{},  // 주차별 체크리스트: 'weekKey:phase' -> {taskIdx:1}
  apExposure:{}, // 자동 넘김 노출 기록: 'YYYY-MM-DD' -> 들은 단어 수(스트릭 인정용, SRS엔 영향 X)
  badges:{},     // 달성 배지: badgeId -> 1
  dayStats:{},   // 날짜별 과목 풀이 수: 'YYYY-MM-DD' -> {WK:n,VA:n,...} (플랜 자동체크)
  v16:null,      // Verbal 16일 체크리스트: {done:{"dayIdx:taskIdx":1}}
  plan30:null,   // 30일 완성 플랜: {start:'YYYY-MM-DD', done:{day:{taskKey:1}}}
  rootStep:0,    // 어근 추론 코치 진행 위치
  speed:{},      // 풀이 속도 누적: 'WK'|'VA'|... -> {n,ms,slow} (답한 문항 기준)
  sweepAt:{},    // 최종 스윕: wordId -> 마지막 스윕 통과 시각(ms)
  examHist:[], // 점수 추이: {key,date,got,total,acc,pctile,ts}
  settings:{ daily_goal:0, high_first:true, high_only:false,
             start_date:CFG.START_DATE||"2026-06-01", exam_date:CFG.EXAM_DATE||"2026-08-03" },
});

function loadLocal(){
  try{ state=JSON.parse(localStorage.getItem(LS.state))||DEFAULT_STATE(); }catch{ state=DEFAULT_STATE(); }
  const d=DEFAULT_STATE();
  state.cards=state.cards||{}; state.va=state.va||{}; state.rc=state.rc||{}; state.daily=state.daily||{}; state.exams=state.exams||{};
  state.wrong=Object.assign({wk:{},va:{},rc:{},ar:{},mk:{},ps:{},av:{}},state.wrong||{});
  state.weak=Object.assign({vaRel:{},rcType:{},wkTier:{},topic:{}},state.weak||{});
  state.wkSeen=state.wkSeen||{}; state.avp=state.avp||{}; state.qSeen=Object.assign({ar:{},mk:{},ps:{}},state.qSeen||{}); state.secAcc=state.secAcc||{}; state.curr=state.curr||{}; state.checklist=state.checklist||{}; state.apExposure=state.apExposure||{}; state.badges=state.badges||{}; state.dayStats=state.dayStats||{};
  state.examHist=state.examHist||[];
  // 1회 마이그레이션: 과거 모의고사 기록에서 통째로 건너뛴 과목(전부 미응답)을 통계에서 소급 제외
  if(!state.migSkipFix){
    for(const h of state.examHist){
      if(!h||!Array.isArray(h.items)||!h.items.length) continue;
      const bySec={}; h.items.forEach(it=>{ (bySec[it.s]=bySec[it.s]||[]).push(it); });
      const skipped=Object.keys(bySec).filter(k=>bySec[k].every(it=>it.u==null));
      if(!skipped.length) continue;
      const kept=h.items.filter(it=>!skipped.includes(it.s));
      if(!kept.length) continue;                                 // 전부 스킵이면 손대지 않음
      h.items=kept; h.total=kept.length;
      h.got=kept.filter(it=>it.u===it.a).length;
      h.acc=h.got/h.total; h.pctile=estPercentile(h.acc);
      h.bySec={}; kept.forEach(it=>{ const o=h.bySec[it.s]=h.bySec[it.s]||{got:0,total:0}; o.total++; if(it.u===it.a) o.got++; });
      h.skipped=(h.skipped||[]).concat(skipped.filter(k=>!(h.skipped||[]).includes(k)));
    }
    state.migSkipFix=1; saveNow();   // 정정 결과 즉시 저장
  }
  state.speed=state.speed||{}; state.sweepAt=state.sweepAt||{};
  state.settings=Object.assign(d.settings, state.settings||{});
}
let saveTimer=null;
function saveLocal(){ clearTimeout(saveTimer); saveTimer=setTimeout(saveNow,150); if(sb) queuePush("app_state"); }
// Write immediately. Mobile browsers freeze timers when the app is backgrounded,
// so a debounced save can be lost — always flush on hide/pagehide (see wire()).
function saveNow(){ clearTimeout(saveTimer); try{ localStorage.setItem(LS.state, JSON.stringify(state)); }catch(e){} }
function flag(k){ return !!state.settings[k]; }
// 표읽기·블록·계기(Pilot 시각과목)를 외부 앱에서 연습 중 → 만점 처리 (기본 ON, 설정에서 해제)
const PILOT_VISUAL=["TR","BC","IC"], PILOT_FULL={TR:40,BC:30,IC:25};
function pilotPerfect(){ return state.settings.pilot_perfect!==false; }

/* ---------- WK card ---------- */
function getCard(id){ return state.cards[id] || {status:"new",reps:0,lapses:0,ease:2.5,interval:0,due:null,starred:false}; }
function setCard(id,c){ c.updated_at=nowISO(); state.cards[id]=c; saveLocal(); queuePush("vocab_state",{id,...c}); }
function toggleStar(id){ const c={...getCard(id)}; c.starred=!c.starred; setCard(id,c); }

/* ---------- VA / RC ---------- */
function getVA(id){ return state.va[id]||{seen:0,correct:0,wrong:0,streak:0,status:"new"}; }
function setVA(id,v){ v.updated_at=nowISO(); state.va[id]=v; saveLocal(); queuePush("verbal_progress",{kind:"va",item_id:String(id),data:v}); }
function getRC(id){ return state.rc[id]||{done:false,score:0,total:0}; }
function setRC(id,v){ v.updated_at=nowISO(); state.rc[id]=v; saveLocal(); queuePush("verbal_progress",{kind:"rc",item_id:String(id),data:v}); }

/* ---------- daily ---------- */
function getDay(day=todayStr()){ if(!state.daily[day]) state.daily[day]={studied:0,correct:0,new_learned:0,seconds:0,target:0,goal_met:false}; return state.daily[day]; }
function bumpDay(f){ const day=todayStr(), d=getDay(day); for(const k in f) d[k]=(d[k]||0)+f[k];
  if(!d.target) d.target=plannedToday(); d.goal_met=d.studied>=d.target; d.updated_at=nowISO();
  saveLocal(); queuePush("daily_log",{day,...d}); }

/* ============================================================
   SCHEDULE / PACING (tier 우선)
   ============================================================ */
const TIERRANK={high:0,mid:1,std:2};
function isNew(w){ const c=state.cards[w.id]; return !c||c.status==="new"; }
function tierOf(w){ return w.tier||"std"; }
function newPool(){ let p=WORDS.filter(isNew); if(flag("high_only")) p=p.filter(w=>tierOf(w)!=="std"); return p; }
function daysLeft(){ return Math.max(1, dayDiff(todayStr(), state.settings.exam_date)+1); }
function newWordsRemaining(){ return newPool().length; }
function autoPace(){ return clamp(Math.ceil(newWordsRemaining()/daysLeft()),5,300); }
function newPerDay(){ return state.settings.daily_goal>0 ? state.settings.daily_goal : autoPace(); }
// Cards awaiting the 7-day "확인 시험" recheck are held out of the normal flashcard
// rotation entirely (verify:"pending") — they only resurface via the confirm quiz.
function dueCards(){ const t=Date.now(),out=[]; for(const w of WORDS){ const c=state.cards[w.id]; if(c&&c.status!=="new"&&c.verify!=="pending"&&c.verify!=="verified"&&c.due&&new Date(c.due).getTime()<=t) out.push(w.id);} return out; }  // verified는 최종 스윕에서만 재확인 (확인 허브 안내와 일치)
function newCardIds(limit){
  let cand=newPool();
  if(flag("high_first")) cand=[...cand].sort((a,b)=>(TIERRANK[tierOf(a)]-TIERRANK[tierOf(b)])||a.id-b.id);
  return cand.slice(0,limit).map(w=>w.id);
}
function plannedToday(){ return dueCards().length + Math.min(newPerDay(), newWordsRemaining()); }  // 신규가 바닥나면 목표도 같이 줄어야 링/스트릭 달성 가능
function countByStatus(){
  let learned=0,mastered=0,totalRev=0,highLearned=0,verified=0;
  for(const w of WORDS){ const c=state.cards[w.id]; if(!c||c.status==="new") continue;
    learned++; totalRev+=c.reps; if(c.status==="mastered") mastered++; if(tierOf(w)!=="std") highLearned++;
    if(c.verify==="verified") verified++; }
  return {learned,mastered,totalRev,highLearned,verified,remaining:WORDS.length-learned};
}
// 자동 넘김으로 하루 20단어 이상 들으면 그날도 '활동한 날'로 인정(스트릭 유지). 숙련도엔 영향 없음.
const AP_STREAK_MIN=20;
function dayActive(key){ const r=state.daily[key]; return (r&&r.goal_met) || (state.apExposure[key]||0)>=AP_STREAK_MIN; }
// 스트릭 보호막: 뒤로 훑을 때 7일 구간마다 하루 빠짐은 1번 봐줌(끊지 않음).
// 한 번 실수로 두 달치 스트릭이 0이 되는 '포기 스파이럴'을 막는 장치.
function computeStreak(){ let s=0, weekSkips=0; const cur=parseDate(todayStr());
  for(let i=0;;i++){ if(i>0 && i%7===0) weekSkips=0;
    const d=new Date(cur); d.setDate(d.getDate()-i); const key=todayStr(d);
    if(dayActive(key)){ s++; continue; }
    if(i===0) continue;                 // 오늘은 아직 안 함 — 안 끊고 안 셈
    if(weekSkips<1){ weekSkips++; continue; }  // 이번 주 보호막으로 하루 빠짐 봐줌
    break;
  }
  return s;
}
// 자동 넘김 노출만 카운트 — studied/target/goal_met/SRS는 절대 안 건드림.
function bumpExposure(){ const day=todayStr(); state.apExposure[day]=(state.apExposure[day]||0)+1; saveLocal(); }
// 마일스톤 배지 — 스트릭·학습·마스터·모의고사 지점에서 축하. 진도(SRS)엔 영향 X.
const BADGE_CATS={streak:"🔥 꾸준함",word:"📇 단어",verify:"✅ 검증",subject:"📚 과목",mock:"🎯 실전",effort:"💪 몰입",special:"🏅 특별"};
const BADGES=[
  // 🔥 꾸준함
  {id:"streak3",  cat:"streak", icon:"🌱", name:"3일 연속",   d:"3일 연속 학습",   t:m=>m.streak>=3},
  {id:"streak7",  cat:"streak", icon:"🔥", name:"7일 연속",   d:"7일 연속 학습",   t:m=>m.streak>=7},
  {id:"streak14", cat:"streak", icon:"🔥", name:"2주 연속",   d:"14일 연속 학습",  t:m=>m.streak>=14},
  {id:"streak30", cat:"streak", icon:"🏆", name:"한 달 연속", d:"30일 연속 학습",  t:m=>m.streak>=30},
  {id:"streak50", cat:"streak", icon:"👑", name:"50일 연속",  d:"50일 연속 학습",  t:m=>m.streak>=50},
  {id:"days30",   cat:"streak", icon:"📅", name:"30일 출석",  d:"학습한 날 30일",  t:m=>m.activeDays>=30},
  // 📇 단어
  {id:"learn100", cat:"word", icon:"📇", name:"단어 100",   d:"단어 100개 학습",   t:m=>m.learned>=100},
  {id:"learn300", cat:"word", icon:"📇", name:"단어 300",   d:"단어 300개 학습",   t:m=>m.learned>=300},
  {id:"learn500", cat:"word", icon:"📚", name:"단어 500",   d:"단어 500개 학습",   t:m=>m.learned>=500},
  {id:"learn1000",cat:"word", icon:"📚", name:"단어 1000",  d:"단어 1,000개 학습", t:m=>m.learned>=1000},
  {id:"learn2000",cat:"word", icon:"🎓", name:"단어 2000",  d:"단어 2,000개 학습", t:m=>m.learned>=2000},
  {id:"high500",  cat:"word", icon:"⭐", name:"빈출 500",   d:"빈출 단어 500개",   t:m=>m.highLearned>=500},
  {id:"high1245", cat:"word", icon:"🌟", name:"빈출 정복",  d:"빈출(high) 1,245개 전부", t:m=>m.highLearned>=1245},
  {id:"master50", cat:"word", icon:"⭐", name:"마스터 50",  d:"마스터 50개",       t:m=>m.mastered>=50},
  {id:"master100",cat:"word", icon:"🌟", name:"마스터 100", d:"마스터 100개",      t:m=>m.mastered>=100},
  {id:"master250",cat:"word", icon:"💎", name:"마스터 250", d:"마스터 250개",      t:m=>m.mastered>=250},
  {id:"master500",cat:"word", icon:"💠", name:"마스터 500", d:"마스터 500개",      t:m=>m.mastered>=500},
  {id:"rev1000",  cat:"word", icon:"🔁", name:"복습 1000",  d:"누적 복습 1,000회", t:m=>m.totalRev>=1000},
  // ✅ 검증 (확인 시험 통과)
  {id:"verify10", cat:"verify", icon:"✅", name:"진짜 10",   d:"확인 시험 통과 10개",  t:m=>m.verified>=10},
  {id:"verify50", cat:"verify", icon:"✅", name:"진짜 50",   d:"확인 시험 통과 50개",  t:m=>m.verified>=50},
  {id:"verify200",cat:"verify", icon:"🛡️", name:"진짜 200",  d:"확인 시험 통과 200개", t:m=>m.verified>=200},
  {id:"clean",    cat:"verify", icon:"🧹", name:"오답 청소", d:"오답 노트 전부 비우기(20개+ 풀고)", t:m=>m.wrongEver>=20&&m.wrongLeft===0},
  // 📚 과목
  {id:"va300",  cat:"subject", icon:"🔗", name:"유추 300",  d:"유추 300문항",   t:m=>m.va>=300},
  {id:"va1000", cat:"subject", icon:"🔗", name:"유추 1000", d:"유추 1,000문항", t:m=>m.va>=1000},
  {id:"rc100",  cat:"subject", icon:"📖", name:"독해 100",  d:"독해 100문항",   t:m=>m.rc>=100},
  {id:"rc400",  cat:"subject", icon:"📖", name:"독해 400",  d:"독해 400문항",   t:m=>m.rc>=400},
  {id:"math200",cat:"subject", icon:"🔢", name:"수학 200",  d:"산수+수학 200문항", t:m=>(m.ar+m.mk)>=200},
  {id:"math600",cat:"subject", icon:"📐", name:"수학 600",  d:"산수+수학 600문항", t:m=>(m.ar+m.mk)>=600},
  {id:"av200",  cat:"subject", icon:"✈️", name:"항공 200",  d:"항공 200문항",   t:m=>m.av>=200},
  {id:"pilot300",cat:"subject",icon:"🛩️", name:"파일럿 드릴", d:"표읽기+블록+계기 300문항", t:m=>(m.tr+m.bc+m.ic)>=300},
  {id:"allsec", cat:"subject", icon:"🌐", name:"전 과목 경험", d:"모든 과목 1문항 이상", t:m=>["WK","VA","RC","AR","MK","AV","TR","BC","IC"].every(k=>m.secN(k)>0)},
  // 🎯 실전
  {id:"mock1",  cat:"mock", icon:"🎯", name:"첫 모의고사", d:"모의고사 1회",   t:m=>m.mocks>=1},
  {id:"mock5",  cat:"mock", icon:"🎯", name:"모의고사 5회", d:"모의고사 5회",  t:m=>m.mocks>=5},
  {id:"mock10", cat:"mock", icon:"🏹", name:"모의고사 10회",d:"모의고사 10회", t:m=>m.mocks>=10},
  {id:"mock25", cat:"mock", icon:"🏹", name:"모의고사 25회",d:"모의고사 25회", t:m=>m.mocks>=25},
  {id:"acc70",  cat:"mock", icon:"📈", name:"정답률 70%",  d:"모의고사 70% 이상", t:m=>m.bestAcc>=0.70},
  {id:"acc80",  cat:"mock", icon:"📈", name:"정답률 80%",  d:"모의고사 80% 이상", t:m=>m.bestAcc>=0.80},
  {id:"acc90",  cat:"mock", icon:"🥇", name:"정답률 90%",  d:"모의고사 90% 이상", t:m=>m.bestAcc>=0.90},
  {id:"full1",  cat:"mock", icon:"🏁", name:"전과목 완주", d:"AFOQT 전체 모의고사 완료", t:m=>m.fullMock>=1},
  // 💪 몰입
  {id:"day100", cat:"effort", icon:"💪", name:"하루 100",  d:"하루 100문항",    t:m=>m.dayMax>=100},
  {id:"day200", cat:"effort", icon:"🔋", name:"하루 200",  d:"하루 200문항",    t:m=>m.dayMax>=200},
  {id:"hour2",  cat:"effort", icon:"⏱️", name:"2시간 몰입", d:"하루 2시간 학습", t:m=>m.secMax>=7200},
  {id:"listen500", cat:"effort", icon:"🎧", name:"청취 500", d:"자동 넘김 500단어",   t:m=>m.listen>=500},
  {id:"listen2000",cat:"effort", icon:"🎧", name:"청취 2000",d:"자동 넘김 2,000단어", t:m=>m.listen>=2000},
  // 🏅 특별
  {id:"plan7",  cat:"special", icon:"🗓️", name:"플랜 7일",  d:"플랜 시작 7일차 도달",  t:m=>m.planDay>=7},
  {id:"plan21", cat:"special", icon:"🗓️", name:"플랜 21일", d:"플랜 시작 21일차 도달", t:m=>m.planDay>=21},
  {id:"early",  cat:"special", icon:"🌅", name:"얼리버드",  d:"오전 9시 전에 학습",    t:m=>m.early},
  {id:"night",  cat:"special", icon:"🌙", name:"야간 학습",  d:"밤 11시 이후 학습",     t:m=>m.night},
];
function badgeMetrics(){
  const c=countByStatus(), hist=state.examHist||[], D=state.daily||{};
  const secN=k=>{ const o=state.secAcc[k]; return o?(o.c||0)+(o.w||0):0; };
  const wrongLeft=Object.values(state.wrong||{}).reduce((a,o)=>a+Object.keys(o||{}).length,0);
  const h=new Date().getHours();
  const todayStudied=(D[todayStr()]||{}).studied||0;
  return {
    streak:computeStreak(), learned:c.learned, mastered:c.mastered, highLearned:c.highLearned,
    verified:c.verified, totalRev:c.totalRev,
    activeDays:Object.keys(D).filter(k=>(D[k].studied||0)>0).length,
    mocks:hist.length, fullMock:hist.filter(x=>x&&String(x.key||"").startsWith("afoqt")).length,
    bestAcc:hist.length?Math.max(...hist.map(x=>x.acc||0)):0,
    dayMax:Object.values(D).reduce((m,d)=>Math.max(m,d.studied||0),0),
    secMax:Object.values(D).reduce((m,d)=>Math.max(m,d.seconds||0),0),
    listen:Object.values(state.apExposure||{}).reduce((a,b)=>a+(b||0),0),
    planDay:state.plan30&&state.plan30.start?clamp(dayDiff(state.plan30.start,todayStr())+1,0,999):0,
    wrongLeft, wrongEver:(state.wkSeen?Object.keys(state.wkSeen).length:0)+secN("AR")+secN("MK"),
    va:secN("VA"), rc:secN("RC"), ar:secN("AR"), mk:secN("MK"), av:secN("AV"),
    tr:secN("TR"), bc:secN("BC"), ic:secN("IC"), secN,
    early:todayStudied>0&&h<9, night:todayStudied>0&&h>=23,
  };
}
// 새로 달성한 배지가 있으면 저장 + (silent 아니면) 축하 토스트.
function checkBadges(silent){
  const m=badgeMetrics(); const newly=[];
  for(const b of BADGES){ if(b.t(m) && !state.badges[b.id]){ state.badges[b.id]=1; newly.push(b); } }
  if(newly.length){ saveLocal(); if(!silent){ const b=newly[newly.length-1];
    toast(newly.length>1?`${b.icon} 배지 ${newly.length}개 획득! (${b.name} 외) 🎉`:`${b.icon} 배지 획득! ${b.name} 🎉`, 3800); } }
  return m;
}

/* ============================================================
   SRS (SM-2 변형)
   ============================================================ */
function predict(id,q){ const c={...getCard(id)};
  if(q==="hard") return c.reps===0?1:Math.max(1,c.interval*1.2);
  if(q==="good") return c.reps===0?1:c.reps===1?3:c.interval*c.ease;
  if(q==="easy") return c.reps===0?2:c.interval*(c.ease+0.15)*1.3; return 0; }  // gradeCard와 동일하게 ease 증가분 반영
function gradeCard(id,q){ const c={...getCard(id)};
  if(q==="again"){ c.lapses++; c.ease=Math.max(1.3,c.ease-0.2); c.interval=0; c.reps=0; c.status="learning"; c.due=nowISO(); }  // reps=0: 재학습 — 안 하면 interval이 0*ease=0에 영구 고정
  else { if(q==="hard"){ c.ease=Math.max(1.3,c.ease-0.15); c.interval=c.reps===0?1:Math.max(1,c.interval*1.2);}
    else if(q==="good"){ c.interval=c.reps===0?1:c.reps===1?3:c.interval*c.ease; }
    else { c.ease+=0.15; c.interval=c.reps===0?2:c.interval*c.ease*1.3; }
    c.reps++; c.status=c.interval>=21?"mastered":(c.reps>=2?"review":"learning");  // 1회 학습=learning (확인시험 풀에 너무 일찍 들어가지 않게)
    const due=new Date(); due.setMinutes(due.getMinutes()+Math.round(c.interval*1440)); c.due=due.toISOString(); }
  setCard(id,c); }
function fmtIv(d){ if(d<1) return "<1일"; if(d>=21) return "마스터"; return Math.round(d)+"일"; }
// 틀린 단어를 플래시카드 복습 큐에 즉시 투입(학습중·지금 due). verify 보류도 해제해
// 곧바로 복습에 뜨게 함. (동의어 퀴즈 등에서 오답 시 호출)
function markForReview(id){ const c={...getCard(id)};
  c.lapses=(c.lapses||0)+1; c.ease=Math.max(1.3,(c.ease||2.5)-0.2); c.interval=0;
  c.reps=0; c.status="learning"; c.due=nowISO(); c.verify=null; c.verifyDue=null;
  delete state.sweepAt[id];   // 강등된 단어는 최종 스윕 대상에 다시 포함
  setCard(id,c); }

/* ============================================================
   확인 시험 (진짜 암기 검증)
   ------------------------------------------------------------
   플래시카드 자가채점("good")은 재인(recognition)이라 착각하기 쉬움.
   review/mastered 단계 단어를 blind 4지선다로 통과해야 verify:"pending"
   (7일 뒤 재확인 예약, 그동안 일반 플래시카드 로테이션에서 제외).
   7일 뒤 재확인까지 통과하면 verify:"verified"(완전 마스터). 둘 중
   한 번이라도 틀리면 즉시 학습중으로 강등해 복습 로테이션에 복귀.
   ============================================================ */
function confirmPoolFirst(){ return WORDS.filter(w=>{ const c=getCard(w.id);
  return (c.status==="review"||c.status==="mastered") && !c.verify; }).map(w=>w.id); }
function confirmPoolRecheck(){ const t=Date.now(); return WORDS.filter(w=>{ const c=getCard(w.id);
  return c.verify==="pending" && c.verifyDue && new Date(c.verifyDue).getTime()<=t; }).map(w=>w.id); }
function gradeConfirm(id,ok,isRecheck){
  if(!ok){ gradeCard(id,"again"); const c={...getCard(id)}; c.verify=null; c.verifyDue=null; setCard(id,c); return; }
  const c={...getCard(id)};
  if(isRecheck){ c.verify="verified"; c.verifyDue=null; c.status="mastered"; }
  else { c.verify="pending"; const d=new Date(); d.setDate(d.getDate()+7); c.verifyDue=d.toISOString(); }
  setCard(id,c);
}
let confirmQuiz=null;
/* ---- 최종 스윕 (시험 직전): verified 단어 전체를 빠르게 재확인.
   통과해도 SRS는 안 건드리고 sweepAt 만 기록(7일 유효), 틀리면 즉시 복습 복귀. ---- */
function verifiedIds(){ return WORDS.filter(w=>getCard(w.id).verify==="verified").map(w=>w.id); }
function sweepPool(){ const t=Date.now()-7*86400000;
  return verifiedIds().filter(id=>!(state.sweepAt[id]&&state.sweepAt[id]>t)); }
function gradeSweep(id,ok){
  if(ok){ state.sweepAt[id]=Date.now(); saveLocal(); }
  else { delete state.sweepAt[id]; markForReview(id); }
}
function startSweep(){
  const items=sample(sweepPool(),30);
  if(!items.length){ toast("스윕할 verified 단어가 없어요."); return; }
  confirmQuiz={items,idx:0,score:0,recheckSet:new Set(),sweep:true};
  $("#confirmStart").classList.add("hidden"); $("#confirmDone").classList.add("hidden"); renderConfirm();
}
function renderConfirmHub(){
  const cf=confirmPoolFirst().length, cr=confirmPoolRecheck().length;
  $("#confirmPoolInfo").innerHTML = cr>0
    ? `🔁 <b>재확인 ${cr}개</b> 대기 (지난 확인 성공 후 7일 경과) · 첫 확인 대기 ${cf}개`
    : cf>0 ? `첫 확인 대기 <b>${cf}개</b> — 복습/마스터 단계 단어 중 아직 검증 안 한 것들`
    : "아직 확인할 단어가 없어요. 플래시카드로 복습 단계까지 학습하면 여기 나타나요.";
  $("#confirmGo").disabled = (cf+cr)===0;
  // 최종 스윕 안내: verified 단어 현황 + 시험 임박 시 강조
  const sb=$("#sweepBlock"), sg=$("#sweepGo");
  if(sb&&sg){ const vTot=verifiedIds().length, sw=sweepPool().length;
    const dExam=dayDiff(todayStr(),state.settings.exam_date);
    if(!vTot){ sb.classList.add("hidden"); sg.classList.add("hidden"); }
    else { sb.classList.remove("hidden"); sg.classList.remove("hidden"); sg.disabled=sw===0;
      sb.innerHTML = sw===0
        ? `🧹 <b>최종 스윕 완료!</b> verified ${vTot}개 모두 최근 7일 내 재확인됐어요.`
        : `${dExam>=0&&dExam<=7?"🔥 <b>시험 임박!</b> ":""}🧹 <b>최종 스윕</b> — 확인시험을 2번 통과한(verified) 단어 <b>${vTot}개</b>는 평소 복습에서 빠져 있어요.
           시험 전 마지막으로 한 바퀴 돌면서 망각을 걸러내요. <b>남은 ${sw}개</b> (30개씩 진행 · 틀리면 즉시 복습 복귀)`;
      sg.textContent=sw>0?`🧹 최종 스윕 시작 (남은 ${sw}개)`:"🧹 최종 스윕 완료"; }
  }
}
function startConfirm(){
  const recheck=confirmPoolRecheck().slice(0,20);
  const first=sample(confirmPoolFirst(), Math.max(0,20-recheck.length));
  const items=[...recheck,...first];
  if(!items.length){ toast("지금 확인할 단어가 없어요."); return; }
  confirmQuiz={items,idx:0,score:0,recheckSet:new Set(recheck)};
  $("#confirmStart").classList.add("hidden"); $("#confirmDone").classList.add("hidden"); renderConfirm();
}
function renderConfirm(){
  const q=confirmQuiz; if(q.idx>=q.items.length) return finishConfirm();
  const id=q.items[q.idx], w=WMAP.get(id), isRecheck=q.recheckSet.has(id);
  $("#confirmCount").textContent=`${q.idx+1} / ${q.items.length}`; $("#confirmTag").textContent=q.sweep?"🧹 최종 스윕":isRecheck?"🔁 재확인":"✅ 첫 확인";
  $("#confirmBar").style.width=(q.idx/q.items.length*100)+"%";
  const correct=w.kor, choices=korChoices(w,4);   // 뜻 겹침·의미 이웃 차단, 실전처럼 5지선다
  const opts=shuffle([correct,...choices]);
  $("#confirmArea").innerHTML=`<div class="card"><div class="q-prompt">이 단어, 진짜 뜻을 알아요? (뒤집기 없이 바로 선택)</div><div class="q-word" style="${wordFont(w.word,26)}">${esc(w.word)}</div>
    <div class="choices" id="confirmChoices">${opts.map(o=>`<button class="choice">${esc(o)}</button>`).join("")}</div></div>`;
  q.answered=false;
  $$("#confirmChoices .choice").forEach(btn=>btn.onclick=()=>{ if(q.answered) return; q.answered=true; const ok=btn.textContent===correct;
    $$("#confirmChoices .choice").forEach(b=>{ b.disabled=true; if(b.textContent===correct) b.classList.add("correct"); else if(b===btn) b.classList.add("wrong"); });
    if(q.sweep) gradeSweep(id,ok); else gradeConfirm(id,ok,isRecheck);
    if(ok) q.score++;
    bumpDay({studied:1,correct:ok?1:0}); recordSecAcc("WK",ok);
    setTimeout(()=>{ q.idx++; renderConfirm(); }, ok?550:1300);
  });
}
let confirmMode="confirm"; // 마지막으로 실행한 모드 — '다시' 버튼용
function finishConfirm(){
  const q=confirmQuiz, total=q.items.length; confirmMode=q.sweep?"sweep":"confirm";
  $("#confirmArea").innerHTML=""; $("#confirmBar").style.width="100%";
  if(q.sweep){
    const left=sweepPool().length;
    $("#confirmResult").textContent=`${q.score} / ${total} 유지 확인`;
    $("#confirmResultSub").textContent = (total-q.score>0?`틀린 ${total-q.score}개는 복습으로 돌아갔어요. `:"전부 기억하고 있네요! ")
      + (left>0?`스윕 남은 단어 ${left}개 — '다시'로 이어서 진행해요.`:"🧹 최종 스윕 완료!");
  } else {
    $("#confirmResult").textContent=`${q.score} / ${total} 진짜 암기 확인`;
    $("#confirmResultSub").textContent = q.score===total ? "완벽해요! 통과한 단어는 며칠 뒤 몰래 한 번 더 확인할게요."
      : "틀린 단어는 복습 목록으로 돌아갔어요 — 찍은 거였을 수도 있으니 다시 익혀봐요.";
  }
  $("#confirmDone").classList.remove("hidden"); confirmQuiz=null; renderVocab();
}

/* ============================================================
   SUPABASE SYNC
   ============================================================ */
function syncCode(){ let c=localStorage.getItem(LS.code); if(!c){ c=genCode(); localStorage.setItem(LS.code,c);} return c; }
function genCode(){ const r=(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)).replace(/-/g,""); return "afq-"+r.slice(0,16); }
function sbUrl(){ return localStorage.getItem(LS.url)||CFG.SUPABASE_URL||""; }
function sbKey(){ return localStorage.getItem(LS.key)||CFG.SUPABASE_ANON_KEY||""; }
function setSyncDot(s){ const d=$("#syncDot"); d.className="sync-dot "+s;
  const txt={on:`✅ 연결됨 · 코드 ${syncCode()}`,off:"오프라인 모드 (이 기기에만 저장)",err:"⚠️ 동기화 오류 — 키 확인 필요"}[s];
  $("#syncStatusText").textContent=txt; }

// Load the Supabase library on demand (never blocks app startup).
let sbLibPromise=null;
function loadSupabase(){
  if(window.supabase) return Promise.resolve(window.supabase);
  if(sbLibPromise) return sbLibPromise;
  sbLibPromise=new Promise((resolve,reject)=>{
    const s=document.createElement("script");
    s.src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.async=true;
    s.onload=()=>resolve(window.supabase);
    s.onerror=()=>reject(new Error("supabase cdn failed"));
    document.head.appendChild(s);
    setTimeout(()=>reject(new Error("supabase cdn timeout")), 12000);
  });
  return sbLibPromise;
}

async function initSync(){
  if(!sbUrl()||!sbKey()){ setSyncDot("off"); return; }
  let lib;
  try{ lib=await loadSupabase(); }
  catch(e){ console.warn("sync offline:",e.message); setSyncDot("off"); return; }
  if(!lib){ setSyncDot("off"); return; }
  try{ sb=lib.createClient(sbUrl(),sbKey(),{realtime:{params:{eventsPerSecond:5}}});
    setSyncDot("on"); await pullAll(); pushAllLocal(); subscribeRealtime();
  }catch(e){ console.error(e); sb=null; setSyncDot("err"); }
}
async function pullAll(){
  if(!sb) return; const code=syncCode();
  try{
    const [vs,vp,dl,st,as]=await Promise.all([
      sb.from("vocab_state").select("*").eq("user_key",code),
      sb.from("verbal_progress").select("*").eq("user_key",code),
      sb.from("daily_log").select("*").eq("user_key",code),
      sb.from("settings").select("*").eq("user_key",code).maybeSingle(),
      sb.from("app_state").select("*").eq("user_key",code).maybeSingle(),
    ]);
    // supabase v2는 reject하지 않고 {error}를 돌려준다 — 에러를 무시하면 조용히 머지가 빠진다
    if([vs,vp,dl,st,as].some(r=>r&&r.error)){ console.error("pull partial fail",vs.error||vp.error||dl.error||st.error||as.error); setSyncDot("err"); }
    if(vs.data) vs.data.forEach(mergeCard);
    if(vp.data) vp.data.forEach(mergeVerbal);
    if(dl.data) dl.data.forEach(mergeDaily);
    if(st.data) mergeSettings(st.data);
    if(as.data&&as.data.data) mergeMisc(as.data.data);
    saveLocal(); renderAll();
  }catch(e){ console.error("pull fail",e); setSyncDot("err"); }
}
function mergeCard(r){ const cur=state.cards[r.word_id];
  if(!cur||new Date(r.updated_at)>new Date(cur.updated_at||0)) state.cards[r.word_id]={status:r.status,reps:r.reps,lapses:r.lapses,ease:r.ease,interval:r.interval,due:r.due,starred:r.starred,verify:r.verify||null,verifyDue:r.verify_due||null,updated_at:r.updated_at}; }
function mergeVerbal(r){ const tgt=r.kind==="va"?state.va:r.kind==="rc"?state.rc:null; if(!tgt) return;
  const cur=tgt[r.item_id]; const d=Object.assign({},r.data,{updated_at:r.updated_at});
  if(!cur||new Date(r.updated_at)>new Date(cur.updated_at||0)) tgt[r.item_id]=d; }
function mergeDaily(r){ const cur=state.daily[r.day];
  if(!cur||new Date(r.updated_at)>new Date(cur.updated_at||0)) state.daily[r.day]={studied:r.studied,correct:r.correct,new_learned:r.new_learned,seconds:r.seconds,target:cur?.target||0,goal_met:r.goal_met,updated_at:r.updated_at}; }
function mergeSettings(r){ if(r.daily_goal!=null) state.settings.daily_goal=r.daily_goal;
  if(r.start_date) state.settings.start_date=r.start_date; if(r.exam_date) state.settings.exam_date=r.exam_date;
  if(r.data){ if(r.data.high_first!=null) state.settings.high_first=r.data.high_first; if(r.data.high_only!=null) state.settings.high_only=r.data.high_only;
    if(r.data.plan_ps_sj!=null) state.settings.plan_ps_sj=r.data.plan_ps_sj;
    if(r.data.hide_ko!=null) state.settings.hide_ko=r.data.hide_ko;
    if(r.data.pilot_perfect!=null) state.settings.pilot_perfect=r.data.pilot_perfect; } }
// The "misc" state (exams, wrong-notes, weakness, predicted-score tallies,
// coverage, exam history, curriculum) synced as one JSON blob, field-merged so
// neither device clobbers the other.
function miscBlob(){ return {exams:state.exams,wrong:state.wrong,weak:state.weak,secAcc:state.secAcc,
  wkSeen:state.wkSeen,avp:state.avp,qSeen:state.qSeen,examHist:state.examHist,curr:state.curr,checklist:state.checklist,apExposure:state.apExposure,badges:state.badges,dayStats:state.dayStats,plan30:state.plan30,speed:state.speed,sweepAt:state.sweepAt}; }
function mergeMisc(d){
  if(!d) return;
  // exams: keep the higher best per key
  for(const k in (d.exams||{})){ const r=d.exams[k],c=state.exams[k];
    if(!c||(r.best||0)>(c.best||0)) state.exams[k]={...c,...r}; }
  // curr: max unlocked, union passed, max best per stage
  for(const t in (d.curr||{})){ const r=d.curr[t]; const c=state.curr[t]||(state.curr[t]={unlocked:0,passed:{},best:{}});
    c.unlocked=Math.max(c.unlocked||0,r.unlocked||0);
    Object.assign(c.passed,r.passed||{});
    for(const s in (r.best||{})) c.best[s]=Math.max(c.best[s]||0,r.best[s]||0); }
  // counters: keep the side with more samples (avoids double-count on re-sync)
  const richer=(a,b)=>((b?.c||0)+(b?.w||0))>((a?.c||0)+(a?.w||0));
  for(const k in (d.secAcc||{})){ if(richer(state.secAcc[k],d.secAcc[k])) state.secAcc[k]=d.secAcc[k]; }
  ["vaRel","rcType","wkTier","topic"].forEach(g=>{ const rg=(d.weak||{})[g]||{}; const cg=state.weak[g]||(state.weak[g]={});
    for(const k in rg){ if(richer(cg[k],rg[k])) cg[k]=rg[k]; } });
  // sets: union
  ["wkSeen","avp"].forEach(key=>{ Object.assign(state[key], d[key]||{}); });
  ["ar","mk","ps"].forEach(k=>{ Object.assign(state.qSeen[k]||(state.qSeen[k]={}), (d.qSeen||{})[k]||{}); });
  ["wk","va","rc","ar","mk","ps","av"].forEach(g=>{ Object.assign(state.wrong[g]||(state.wrong[g]={}), (d.wrong||{})[g]||{}); });
  // exam history: union by ts, keep last 200
  const seen=new Set(state.examHist.map(x=>x.ts));
  (d.examHist||[]).forEach(x=>{ if(!seen.has(x.ts)){ state.examHist.push(x); seen.add(x.ts); } });
  state.examHist.sort((a,b)=>a.ts-b.ts); if(state.examHist.length>200) state.examHist=state.examHist.slice(-200);
  for(const k in (d.checklist||{})){ state.checklist[k]=Object.assign(state.checklist[k]||{}, d.checklist[k]); }
  // apExposure: keep the higher count per day (union, max)
  for(const day in (d.apExposure||{})){ state.apExposure[day]=Math.max(state.apExposure[day]||0, d.apExposure[day]||0); }
  // 풀이 속도: 표본 많은 쪽 유지 / 최종 스윕: 최근 통과 시각 union(max)
  for(const k in (d.speed||{})){ const r=d.speed[k],c=(state.speed=state.speed||{})[k]; if(!c||(r.n||0)>(c.n||0)) state.speed[k]=r; }
  for(const k in (d.sweepAt||{})){ (state.sweepAt=state.sweepAt||{})[k]=Math.max(state.sweepAt[k]||0, d.sweepAt[k]||0); }
  for(const k in (d.badges||{})){ state.badges[k]=1; } // 배지: 획득분 union
  // dayStats: 날짜별 과목 카운트는 큰 값 우선(재동기화 중복 방지)
  for(const day in (d.dayStats||{})){ const r=d.dayStats[day], c=state.dayStats[day]||(state.dayStats[day]={});
    for(const k in r) c[k]=Math.max(c[k]||0, r[k]||0); }
  if(d.plan30&&d.plan30.start){ // 플랜: 먼저 시작한 날짜 유지 + 완료 체크 union
    if(!state.plan30) state.plan30={start:d.plan30.start,done:{}};
    if(dayDiff(d.plan30.start, state.plan30.start)>0) state.plan30.start=d.plan30.start;
    state.plan30.done=state.plan30.done||{};
    for(const day in (d.plan30.done||{})) state.plan30.done[day]=Object.assign(state.plan30.done[day]||{}, d.plan30.done[day]); }
}

function subscribeRealtime(){
  if(!sb) return; if(realtimeChan) sb.removeChannel(realtimeChan); const code=syncCode();
  realtimeChan=sb.channel("afoqt-"+code)
    .on("postgres_changes",{event:"*",schema:"public",table:"vocab_state",filter:`user_key=eq.${code}`},p=>{ if(p.new){mergeCard(p.new);saveLocal();softRender();}})
    .on("postgres_changes",{event:"*",schema:"public",table:"verbal_progress",filter:`user_key=eq.${code}`},p=>{ if(p.new){mergeVerbal(p.new);saveLocal();softRender();}})
    .on("postgres_changes",{event:"*",schema:"public",table:"daily_log",filter:`user_key=eq.${code}`},p=>{ if(p.new){mergeDaily(p.new);saveLocal();softRender();}})
    .on("postgres_changes",{event:"*",schema:"public",table:"settings",filter:`user_key=eq.${code}`},p=>{ if(p.new){mergeSettings(p.new);saveLocal();softRender();}})
    .on("postgres_changes",{event:"*",schema:"public",table:"app_state",filter:`user_key=eq.${code}`},p=>{ if(p.new&&p.new.data){mergeMisc(p.new.data);saveLocal();softRender();}})
    .subscribe();
}
const pushQ={vocab_state:new Map(),verbal_progress:new Map(),daily_log:new Map(),settings:null,app_state:null};
let pushTimer=null;
function queuePush(table,row){ if(!sb) return; const code=syncCode();
  if(table==="app_state"){ pushQ.app_state={user_key:code,data:miscBlob(),updated_at:nowISO()}; clearTimeout(pushTimer); pushTimer=setTimeout(flushPush,1200); return; }
  if(table==="vocab_state") pushQ.vocab_state.set(row.id,{user_key:code,word_id:row.id,status:row.status,reps:row.reps,lapses:row.lapses,ease:row.ease,interval:row.interval,due:row.due,starred:!!row.starred,verify:row.verify||null,verify_due:row.verifyDue||null,updated_at:row.updated_at});
  else if(table==="verbal_progress") pushQ.verbal_progress.set(row.kind+":"+row.item_id,{user_key:code,kind:row.kind,item_id:row.item_id,data:row.data,updated_at:row.data.updated_at||nowISO()});
  else if(table==="daily_log") pushQ.daily_log.set(row.day,{user_key:code,day:row.day,studied:row.studied,correct:row.correct,new_learned:row.new_learned,seconds:row.seconds,goal_met:row.goal_met,updated_at:row.updated_at});
  else if(table==="settings") pushQ.settings={user_key:code,daily_goal:state.settings.daily_goal,start_date:state.settings.start_date,exam_date:state.settings.exam_date,data:{high_first:state.settings.high_first,high_only:state.settings.high_only,plan_ps_sj:!!state.settings.plan_ps_sj,hide_ko:!!state.settings.hide_ko,pilot_perfect:state.settings.pilot_perfect!==false},updated_at:nowISO()};
  clearTimeout(pushTimer); pushTimer=setTimeout(flushPush,700); }
// Each table pushes independently and only clears its queue on confirmed success —
// so a stale schema (e.g. a column added client-side before the SQL migration runs)
// fails just that one table and self-heals on the next push once the DB catches up,
// instead of silently dropping every table's pending writes.
async function flushPush(){ if(!sb) return;
  if(pushQ.vocab_state.size){ const r=[...pushQ.vocab_state.values()];
    try{ await sb.from("vocab_state").upsert(r,{onConflict:"user_key,word_id"}).throwOnError(); pushQ.vocab_state.clear(); }
    catch(e){ console.error("push vocab_state fail",e); setSyncDot("err"); } }
  if(pushQ.verbal_progress.size){ const r=[...pushQ.verbal_progress.values()];
    try{ await sb.from("verbal_progress").upsert(r,{onConflict:"user_key,kind,item_id"}).throwOnError(); pushQ.verbal_progress.clear(); }
    catch(e){ console.error("push verbal_progress fail",e); setSyncDot("err"); } }
  if(pushQ.daily_log.size){ const r=[...pushQ.daily_log.values()];
    try{ await sb.from("daily_log").upsert(r,{onConflict:"user_key,day"}).throwOnError(); pushQ.daily_log.clear(); }
    catch(e){ console.error("push daily_log fail",e); setSyncDot("err"); } }
  if(pushQ.settings){ const r=pushQ.settings;
    try{ await sb.from("settings").upsert(r,{onConflict:"user_key"}).throwOnError(); pushQ.settings=null; }
    catch(e){ console.error("push settings fail",e); setSyncDot("err"); } }
  if(pushQ.app_state){ const r=pushQ.app_state;
    try{ await sb.from("app_state").upsert(r,{onConflict:"user_key"}).throwOnError(); pushQ.app_state=null; }
    catch(e){ console.error("push app_state fail",e); setSyncDot("err"); } }
}
// Upload EVERY local row. Call AFTER pullAll (so local already holds the newest of
// both sides) — heals progress whose push was lost when the app closed before the
// 700ms debounce fired (the common mobile "study a card then background" case).
function pushAllLocal(){
  if(!sb) return Promise.resolve();
  for(const id in state.cards){ const c=state.cards[id]; if(c&&c.status&&c.status!=="new") queuePush("vocab_state",{id:+id,...c}); }
  for(const id in state.va){ queuePush("verbal_progress",{kind:"va",item_id:String(id),data:state.va[id]}); }
  for(const id in state.rc){ queuePush("verbal_progress",{kind:"rc",item_id:String(id),data:state.rc[id]}); }
  for(const day in state.daily){ queuePush("daily_log",{day,...state.daily[day]}); }
  queuePush("settings",{}); queuePush("app_state");
  return flushPush();
}
// Manual "sync now": pull newest, then push all local, then report the synced totals
// so two devices can be compared apples-to-apples.
async function forceSync(){
  if(!sb){ toast("오프라인 모드예요. 먼저 동기화 코드를 연결하세요."); return; }
  toast("동기화 중…");
  try{ await pullAll(); await pushAllLocal();
    const c=countByStatus();
    toast(`✅ 동기화 완료 · 학습 ${c.learned}개 · 마스터 ${c.mastered}개`, 3500);
  }catch(e){ toast("동기화 실패 — 연결 상태를 확인하세요"); }
}

/* ============================================================
   NAVIGATION
   ============================================================ */
const NAVPARENT={study:"vocab",quiz:"vocab",words:"vocab",roots:"vocab",rootcoach:"vocab",guide:"vocab",autoplay:"vocab",synq:"vocab",vabrowse:"analogy",passage:"reading",exam:"home",avterms:"aviation",avstudy:"aviation",avbook:"aviation",avflash:"aviation",tablereading:"aviation",blockcounting:"aviation",instrument:"aviation",subtest:"home",curriculum:"home",currplay:"home",report:"stats",examlog:"stats",math:"math",confirm:"vocab",cheatsheet:"home",mathtypes:"math"};
let guideCur="wk";
function openGuide(key){ guideCur=key; go("guide"); }
function renderGuide(){
  const g=GUIDES[guideCur];
  const back={wk:"vocab",va:"analogy",rc:"reading",av:"aviation",tr:"aviation",bc:"aviation",ic:"aviation",ar:"math",mk:"math",ps:"subtest",sj:"subtest",sdi:"home"}[guideCur]||"home";
  $("#guideBack").onclick=()=>go(back);
  $("#guideNav").textContent="📘 공부 가이드";
  if(!g){ $("#guideBody").innerHTML=`<div class="card center muted" style="padding:20px">가이드 준비 중이에요.</div>`; return; }
  $("#guideBody").innerHTML=
    `<div class="guide-hero"><h2>${esc(g.title||"공부 가이드")}</h2><div class="fmt">📋 ${fmtMath(g.format||"")}</div></div>`+
    (g.sections||[]).map(s=>`<div class="guide-sec"><h3>${esc(s.h||s.title||s.heading||"")}</h3><p>${fmtMath(s.body)}</p></div>`).join("")+
    ((g.tips&&g.tips.length)?`<div class="guide-tips"><h3>⚡ 빠른 팁</h3><ul>${g.tips.map(t=>`<li>${fmtMath(t)}</li>`).join("")}</ul></div>`:"")+
    ((g.sources&&g.sources.length)?`<div class="guide-src"><b>참고:</b> ${g.sources.map(esc).join(" · ")}</div>`:"");
}
function go(view){
  if(ap && view!=="autoplay") apStop();  // leaving hands-free mode: stop audio/timers/wake-lock
  // 진행 중 시험이 있으면 '일시정지'로 스냅샷을 남기고 완전히 멈춘다 — 네비로 이탈해도
  // 백그라운드에서 섹션이 넘어가거나 자동 제출되지 않게 (모의고사 화면에서 이어하기).
  if(exam && !exam.submitted){
    exam.times=exam.times||new Array(exam.total).fill(0);
    if(exam._openIdx!=null&&exam._openAt){ exam.times[exam._openIdx]+=Date.now()-exam._openAt; exam._openIdx=null; exam._openAt=null; }
    saveExamSnap(); stopExamTimer(); examReleaseWake(); exam=null;
    toast("⏸ 시험 일시정지 — 모의고사 화면에서 이어서 풀 수 있어요");
  }
  trTimerStop(); bcTimerStop(); icTimerStop();   // 시각과목 연습도 이탈 시 시계 정지(orphan 인터벌 방지)
  $$(".view").forEach(v=>v.classList.remove("active"));
  $("#view-"+view).classList.add("active");
  const navsel=NAVPARENT[view]||view;
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go===navsel));
  window.scrollTo(0,0);
  ({home:renderHome,plan:renderPlan,vocab:renderVocab,words:renderWords,synq:renderSynQuiz,analogy:renderAnalogyHub,vabrowse:renderVaBrowse,reading:renderReading,stats:renderStats,exam:renderExamSetup,roots:renderRoots,rootcoach:renderRootCoach,guide:renderGuide,aviation:renderAviation,avterms:renderAvTerms,avstudy:renderAvStudy,avbook:renderAvBook,avflash:startAvFlash,subtest:renderSubtest,curriculum:renderCurriculum,report:renderReport,examlog:renderExamLog,confirm:renderConfirmHub,math:renderMath,autoplay:renderAutoPlaySetup,cheatsheet:renderCheatsheet,mathtypes:renderMathTypes}[view]||(()=>{}))();
}

/* ============================================================
   HOME
   ============================================================ */
function renderHome(){
  const dl=dayDiff(todayStr(),state.settings.exam_date);
  $("#daysLeft").textContent=dl<0?"0":dl;
  const [,em,ed]=state.settings.exam_date.split("-"); $("#examLine").textContent=`목표일 ${+em}/${+ed}`;
  const cnt=countByStatus(), today=getDay(), target=today.target||plannedToday();
  const pct=target?clamp(Math.round(today.studied/target*100),0,100):0;
  $("#goalRing").style.setProperty("--p",pct); $("#ringPct").textContent=pct+"%";
  const overall=Math.round(cnt.learned/Math.max(1,WORDS.length)*100);
  const streak=computeStreak(), dueNow=dueCards().length, todayActive=dayActive(todayStr());
  $("#stStreak").textContent=streak; $("#stToday").textContent=today.studied; $("#stDue").textContent=dueNow;
  deckBtnPaint("#btnStartNew","#btnStartRev");
  checkBadges(); // 마일스톤 달성 시 축하 토스트
  // ---- 동기부여 배너: 손실 프레이밍 + 밀린 복습 자연 경고 (스트릭 보호막 안내 포함) ----
  const mb=$("#motivBanner");
  if(mb){
    if(todayActive){
      mb.className="card motiv done";
      mb.innerHTML=`<b>🔥 오늘 완료! ${streak}일째 이어가는 중</b> 🎉 <span class="muted">— 이 리듬 유지하면 시험까지 준비 충분해요.</span>`;
    } else {
      const streakTxt = streak>0
        ? `🔥 <b>${streak}일 연속</b> 중 — 오늘 하면 이어가고, 건너뛰면 끊겨요.`
        : `오늘부터 스트릭을 시작해봐요! 작게라도 하면 카운트가 올라가요.`;
      const dueTxt = dueNow>0 ? `<div class="muted" style="margin-top:5px">📌 복습 <b>${dueNow}개</b> 대기 · 오늘 건너뛰면 내일 더 쌓여요.</div>` : "";
      mb.className="card motiv todo";
      mb.innerHTML=`${streakTxt}<div class="muted" style="margin-top:4px;font-size:11px">🛡️ 보호막: 실수로 하루 빠져도 주 1회는 자동으로 봐줘요(끊기지 않음).</div>${dueTxt}`;
    }
  }
  // ---- daily pacing (recomputed every render, so it auto-updates as days pass) ----
  const rawDays=dayDiff(todayStr(),state.settings.exam_date);
  const remain=newWordsRemaining(), dleft=daysLeft(), pace=newPerDay(), autop=autoPace();
  const note=$("#behindNote");
  if(rawDays<0){
    // Exam date is in the past — almost always a stale saved date. Make it obvious.
    $("#recPace").textContent="신규 –";
    $("#recBasis").textContent="⚠️ 시험 목표일이 지났어요";
    note.classList.remove("hidden");
    note.innerHTML=`⚙️ <b>설정 → 시험 목표일</b>을 실제 응시일(예: 2026-08-05)로 바꿔주세요. 그러면 권장량이 다시 계산됩니다.`;
  } else {
    // Today's real load = due reviews + new. The home headline used to show only
    // "new", which made the study session (reviews+new) look mysteriously doubled.
    const dueN=dueCards().length, newN=Math.min(pace,remain), todayN=dueN+newN;
    $("#recPace").textContent=`오늘 ${todayN}개`;
    $("#recBasis").textContent=`복습 ${dueN} + 신규 ${newN} · 신규 페이스 ${autop}/일 (남은 ${remain}÷${dleft}일)`;
    if(remain===0){ note.classList.add("hidden"); }
    else if(state.settings.daily_goal>0 && state.settings.daily_goal<autop){
      note.classList.remove("hidden");
      note.innerHTML=`⚠️ 직접 설정한 목표(<b>${state.settings.daily_goal}</b>/일)로는 시험까지 다 못 외워요. 일정대로면 <b>하루 ${autop}개</b> 필요해요. (설정에서 목표를 비우면 자동 계산)`;
    } else if(state.settings.daily_goal>0){
      note.classList.remove("hidden");
      note.innerHTML=`ℹ️ 지금은 <b>직접 설정한 목표 ${state.settings.daily_goal}/일</b>로 고정돼 있어요(자동 계산값: 하루 ${autop}개). 설정에서 목표를 비우면 날짜에 맞춰 자동으로 바뀝니다.`;
    } else if(autop>=120){
      note.classList.remove("hidden");
      note.innerHTML=`🔥 밀린 분량이 있어요 — 일정 내 1회독하려면 <b>하루 ${autop}개</b> 페이스예요. 매일 하면 금방 줄어듭니다.`;
    } else { note.classList.add("hidden"); }
  }
  // ---- per-section readiness ----
  const afCount=WORDS.filter(w=>w.afoqtCommon).length||1;
  const afLearned=WORDS.filter(w=>w.afoqtCommon&&((state.cards[w.id]&&state.cards[w.id].status!=="new")||state.wkSeen[w.id])).length;
  const wkR=afLearned/afCount;
  const vaSeen=Object.values(state.va).filter(v=>v.seen>0).length;
  const vaR=ANALOGIES.length?vaSeen/ANALOGIES.length:0;
  const rcPr=rcPracticePool(), rcIds=new Set(rcPr.map(p=>p.id));
  const rcDone=Object.entries(state.rc).filter(([id,v])=>rcIds.has(+id)&&(v.done||v.seen)).length;
  const rcR=rcPr.length?rcDone/rcPr.length:0;
  const avEx=state.exams.av; const avCov=Object.keys(state.avp).length;
  const avR=AVIATION.length?avCov/AVIATION.length:0;
  $("#wkBar").style.width=Math.round(wkR*100)+"%";
  $("#wkSub").textContent=`빈출 ${afLearned}/${afCount} · 전체 ${cnt.learned}/${WORDS.length}`;
  $("#vaBar").style.width=Math.round(vaR*100)+"%";
  $("#vaSub").textContent=ANALOGIES.length?`유추 ${vaSeen}/${ANALOGIES.length}`:"준비 중";
  $("#rcBar").style.width=Math.round(rcR*100)+"%";
  $("#rcSub").textContent=rcPr.length?`독해 ${rcDone}/${rcPr.length}`:"준비 중";
  if($("#avBarH")){ $("#avBarH").style.width=Math.round(avR*100)+"%";
    $("#avSub").textContent=AVIATION.length?(avEx?`항공 최고 ${avEx.best}/${avEx.bestTotal} · 푼 ${avCov}/${AVIATION.length}`:`항공 ${avCov}/${AVIATION.length} 풀이`):"준비 중"; }
  // ---- composite AFOQT readiness ----
  const ready=Math.round((wkR+vaR+rcR+avR)/4*100);
  $("#overallBar").style.width=ready+"%";
  $("#overallLine").textContent=`AFOQT 준비도 ${ready}% · 단어 ${Math.round(wkR*100)} / 유추 ${Math.round(vaR*100)} / 독해 ${Math.round(rcR*100)} / 항공 ${Math.round(avR*100)}`;
  // ---- predicted Verbal composite (shown once there's enough data) ----
  const vEst=compositeEst(["WK","VA","RC"]), el=$("#verbalEstLine");
  if(el){ if(vEst.pct!=null){ el.classList.remove("hidden"); el.textContent=`🗣 Verbal 예상 백분위 ${vEst.pct}th (정답률 ${Math.round(vEst.acc*100)}%) · 통계 탭에서 상세`; }
    else el.classList.add("hidden"); }
  renderScoreProj();
  renderWeekPlan();
}
/* ============================================================
   예상 점수 프로젝션 + 진단 모의고사 유도 (홈 카드)
   ------------------------------------------------------------
   - 풀 모의고사(afoqt)를 아직 안 봤으면: 진단부터 하라고 유도.
   - 기록이 쌓이면: 최근 정답률 추세를 선형 근사해 "이 페이스면
     시험일에 대략 몇 th" 를 보여준다 (비공식, 상승분은 보수적으로 캡).
   ============================================================ */
function bigExams(){ return (state.examHist||[]).filter(x=>x&&(x.total||0)>=15&&!x.practice); }
function scoreTrendLine(){
  const h=bigExams().slice(-10); if(h.length<2) return null;
  const t0=h[0].ts, xs=h.map(x=>(x.ts-t0)/86400000), ys=h.map(x=>x.acc);
  const n=xs.length, mx=xs.reduce((a,b)=>a+b,0)/n, my=ys.reduce((a,b)=>a+b,0)/n;
  let num=0,den=0; for(let i=0;i<n;i++){ num+=(xs[i]-mx)*(ys[i]-my); den+=(xs[i]-mx)*(xs[i]-mx); }
  return {slope:den?num/den:0, n};
}
function renderScoreProj(){
  const box=$("#scoreProj"); if(!box) return;
  const hasFull=(state.examHist||[]).some(x=>x&&String(x.key||"").startsWith("afoqt"));
  const h=bigExams();
  if(!hasFull && h.length<2){
    box.innerHTML=`<div class="card" style="border:1px solid var(--brand)">
      <b>🩺 먼저 현재 실력부터 측정해요</b>
      <div class="muted" style="font-size:12.5px;margin-top:5px;line-height:1.6">전 과목 진단 모의고사 1회(약 30분)로 시작점을 찍으면,
        이후 <b>시험일 예상 점수</b>와 과목별 갭이 여기에 표시돼요.</div>
      <button class="btn primary" id="diagGo" style="margin-top:12px">🩺 진단 모의고사 시작 (전 과목)</button></div>`;
    $("#diagGo").onclick=()=>startExam("afoqt");
    return;
  }
  const rec=h.slice(-5), prev=h.slice(-10,-5);
  const avg=a=>a.length?a.reduce((s,x)=>s+x.acc,0)/a.length:null;
  const accNow=avg(rec), accPrev=avg(prev);
  if(accNow==null){   // 풀모의고사는 있는데 유효 표본(15문항+)이 없으면 진단 카드 유지 ("1th" 쓰레기 값 방지)
    box.innerHTML=`<div class="card" style="border:1px solid var(--brand)">
      <b>🩺 유효한 모의고사 기록이 아직 부족해요</b>
      <div class="muted" style="font-size:12.5px;margin-top:5px;line-height:1.6">15문항 이상 응시한 기록이 쌓이면 예상 점수가 표시돼요.</div>
      <button class="btn primary" id="diagGo" style="margin-top:12px">🩺 진단 모의고사 시작 (전 과목)</button></div>`;
    $("#diagGo").onclick=()=>startExam("afoqt");
    return;
  }
  const delta=accPrev!=null?Math.round((accNow-accPrev)*100):null;
  const dleft=Math.max(0,dayDiff(todayStr(),state.settings.exam_date));
  const tl=scoreTrendLine();
  let projAcc=accNow;
  if(tl){ const perDay=clamp(tl.slope,0,0.01); projAcc=clamp(accNow+perDay*dleft, accNow, Math.min(0.98, accNow+0.15)); }
  const pNow=estPercentile(accNow), pProj=estPercentile(projAcc);
  const v=compositeEst(["WK","VA","RC"]);
  const goalAcc=0.91; // estPercentile 기준 약 90th 에 해당하는 정답률
  const vLine = v.acc==null ? "" :
    (v.acc>=goalAcc
      ? `<div style="font-size:12.5px;margin-top:7px">🗣 Verbal <b style="color:var(--ok)">${Math.round(v.acc*100)}%</b> — 90th 달성권이에요. 유지 복습!</div>`
      : `<div style="font-size:12.5px;margin-top:7px">🗣 Verbal 목표 90th → 정답률 ~91% 필요 · 현재 <b>${Math.round(v.acc*100)}%</b> <span style="color:var(--warn)">(+${Math.max(1,Math.round((goalAcc-v.acc)*100))}%p)</span></div>`);
  box.innerHTML=`<div class="card">
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <b>📈 예상 점수</b>
      <span style="font-size:24px;font-weight:800;color:var(--brand2)">${pProj}<small style="font-size:13px">th</small>
        <small class="muted" style="font-size:11px;font-weight:600">시험일 예상</small></span></div>
    <div class="muted" style="font-size:12px;margin-top:4px">
      지금 ${pNow}th · 최근 ${rec.length}회 평균 정답률 <b>${Math.round(accNow*100)}%</b>${delta!=null?` (이전 5회 대비 ${delta>=0?"+":""}${delta}%p)`:""} · 시험까지 ${dleft}일</div>
    ${vLine}
    ${hasFull?"":`<button class="btn ghost sm" id="diagGo" style="margin-top:10px">🩺 전과목 진단 1회로 정확도 올리기</button>`}
    <div class="guide-src" style="margin-top:8px">※ 최근 추세 기반 비공식 추정 — 모의고사를 볼수록 정확해져요.</div></div>`;
  const dg=$("#diagGo"); if(dg) dg.onclick=()=>startExam("afoqt");
}
function weekKey(){ const d=new Date(); const off=(d.getDay()+6)%7; d.setDate(d.getDate()-off); return todayStr(d); }
// 12주 Academic Aptitude(전 과목 균형) 플랜을 이번 주 체크리스트로.
// daysLeft 구간에 따라 단계가 자동 전환된다(과제는 매주 리셋되는 '이번 주 목표').
function examPhase(){ const d=daysLeft();
  if(d>49) return {key:"base",name:"1단계 · 기초·볼륨",emoji:"🌱",tasks:[
    "📇 단어: 매일 권장량 완료 (+🎧 자동 넘김으로 이동 중 복습)",
    "🔢 수학: 공부 가이드로 공식 정리 → 연습 모드",
    "🔗 유추: 훑어보기로 관계 유형 익히기",
    "📖 독해: 하루 지문 2~3개 (정확도 우선)",
    "🧠 어근 코치 1회독"]};
  if(d>21) return {key:"build",name:"2단계 · 드릴·속도",emoji:"💪",tasks:[
    "✅ 확인 시험으로 외운 단어 검증 (찍은 것 솎아내기)",
    "🔢 수학 실전 시험 격일 (AR·MK 번갈아)",
    "📖 독해 24분 타이머로 실전 페이스",
    "🔗 유추 시험 15+ 달성",
    "🎯 주 1회 전과목 모의고사 → 📊 약점 확인"]};
  if(d>10) return {key:"mock",name:"3단계 · 실전 시뮬",emoji:"🎯",tasks:[
    "🎯 주 2회 풀 모의고사 (실제 시간·연속)",
    "🧩 📊 약점 리포트의 낮은 과목만 집중 보강",
    "📕 오답 노트 재시험",
    "📇 단어·공식 유지 복습 (확인 시험 재확인)",
    "📊 예상 점수 90%대 확인"]};
  const ed=String(state.settings.exam_date||"").slice(5).replace("-","/").replace(/^0/,"");
  return {key:"final",name:"마무리 (D-10)",emoji:"🔥",tasks:[
    "📕 오답·빈출 단어만 빠르게",
    "🎯 가벼운 모의고사 1회",
    "📊 예상 점수 최종 확인",
    "😴 컨디션·수면 관리",
    `✅ ${ed||"시험일"} 응시 준비물·일정 확인`]};
}
function renderWeekPlan(){
  const box=$("#weekPlan"); if(!box) return;
  const dl=Math.max(0,dayDiff(todayStr(),state.settings.exam_date));
  const ph=examPhase(), key=weekKey()+":"+ph.key;
  const ck=state.checklist[key]||(state.checklist[key]={});
  const done=ph.tasks.filter((_,i)=>ck[i]).length, pct=Math.round(done/ph.tasks.length*100);
  box.innerHTML=`<div class="wp-head"><div class="wp-phase">${ph.emoji} 이번 주 · ${esc(ph.name)}</div><div class="wp-dday">D-${dl}</div></div>
    <div class="muted" style="font-size:11px">${done}/${ph.tasks.length} 완료 · 시험까지 ${dl}일</div>
    <div class="wp-bar"><i style="width:${pct}%"></i></div>
    ${ph.tasks.map((t,i)=>`<div class="wp-task ${ck[i]?"on":""}" data-i="${i}"><div class="wp-box">${ck[i]?"✓":""}</div><div class="tx">${esc(t)}</div></div>`).join("")}`;
  $$("#weekPlan .wp-task").forEach(el=>el.onclick=()=>{ const i=+el.dataset.i; if(ck[i]) delete ck[i]; else ck[i]=1; saveLocal(); renderWeekPlan(); });
}

/* ============================================================
   30일 완성 플랜 — 매일 '오늘 할 일'을 정해주고, 실제 진행에서 자동 체크.
   ============================================================ */
const PLAN_DAYS=30;                    // 기본값(시험일 정보가 없을 때)
// 플랜 길이 = 시험까지 남은 일수 - 12일(마지막 실전·마무리 기간). 시작 시 1회 정해 고정.
function planLenCalc(){ const left=dayDiff(todayStr(), state.settings.exam_date);
  return clamp(left-12, 14, 45); }
function planState(){ if(!state.plan30) state.plan30={start:todayStr(),done:{},days:planLenCalc()};
  if(!state.plan30.done) state.plan30.done={};
  if(!state.plan30.days) state.plan30.days=planLenCalc();
  return state.plan30; }
function planLen(){ return planState().days||PLAN_DAYS; }
function planIdx(){ return clamp(dayDiff(planState().start, todayStr())+1, 1, planLen()); }
function planLeft(){ return Math.max(1, planLen()-planIdx()+1); }
// 빈출(high+mid) 중 아직 학습 안 한 단어 수 — 플랜의 하루 신규량 기준
function coreRemain(){ return WORDS.filter(w=>tierOf(w)!=="std"&&(!state.cards[w.id]||state.cards[w.id].status==="new")).length; }
function coreTotal(){ return WORDS.filter(w=>tierOf(w)!=="std").length; }
function dayStat(sec){ const d=state.dayStats[todayStr()]; return (d&&d[sec])||0; }
// 아직 한 번도 안 푼 유추/독해 분량 — 플랜 잔여일로 나눠 '완주 보장' 하루 목표를 만든다
function vaRemain(){ return ANALOGIES.filter(a=>{ const v=state.va[a.id]; return !(v&&v.seen>0); }).length; }
function rcRemainQ(){ return rcPracticePool().filter(p=>{ const r=state.rc[p.id]; return !(r&&(r.done||r.seen)); })
  .reduce((s,p)=>s+((p.questions||[]).length),0); }
// 매일 전 과목 1회씩. min = 예상 소요(분)
const PLAN_DAILY=[
  {k:"ar",icon:"➗",sec:"AR",n:15,min:25,tag:"🔢 Quant", label:"산수 추론 1세트",           go:()=>startExam("ar",{practice:true})},
  {k:"mk",icon:"📐",sec:"MK",n:15,min:25,tag:"🔢 Quant", label:"수학 지식 1세트",           go:()=>startExam("mk",{practice:true})},
  {k:"av",icon:"✈️",sec:"AV",n:20,min:15,tag:"✈️ Pilot", label:"항공 지식 1세트",           go:()=>startExam("av",{practice:true})},
  {k:"tr",icon:"📊",sec:"TR",n:20,min:4, tag:"✈️ Pilot", label:"표 읽기 드릴 · 3.5분",      go:()=>startTableReading()},
  {k:"bc",icon:"🧱",sec:"BC",n:10,min:3, tag:"✈️ Pilot", label:"블록 세기 드릴 · 3분",      go:()=>startBlockCounting()},
  {k:"ic",icon:"🎚️",sec:"IC",n:12,min:3, tag:"✈️ Pilot", label:"계기 해석 드릴 · 3분",      go:()=>startInstrument()},
];
function planTasks(){
  const i=planIdx(), d=getDay(), t=[];
  // 진단: 풀 모의고사(afoqt/afoqtCore)를 한 번도 안 봤으면 무엇보다 먼저 시작점을 찍게 한다.
  const isFull=x=>x&&String(x.key||"").startsWith("afoqt");
  const hasFull=(state.examHist||[]).some(isFull);
  const fullToday=(state.examHist||[]).some(x=>isFull(x)&&x.ts&&todayStr(new Date(x.ts))===todayStr());
  if(!hasFull||fullToday)
    t.push({k:"diag",icon:"🩺",label:"진단 풀 모의고사 (전 과목 — 시작점 측정)",sub:"🏁 진단",min:35,
      done:hasFull, go:()=>startExam("afoqt")});
  // 하루 신규 단어: 설정에 목표가 있으면 그 값, 없으면 남은 빈출 ÷ 플랜 잔여일
  const nw = state.settings.daily_goal>0 ? state.settings.daily_goal
           : clamp(Math.ceil(coreRemain()/planLeft()),20,100);
  const due=dueCards().length;
  t.push({k:"wk",icon:"📇",label:`단어 플래시카드 — 신규 ${nw} + 복습 ${due}`,sub:"📇 단어",
    min:Math.round((nw*25+due*7)/60),
    done:(d.new_learned||0)>=nw || (coreRemain()===0&&(d.studied||0)>0), go:()=>startStudyNew()});
  t.push({k:"syn",icon:"⚡",label:"동의어 퀴즈 20문항",sub:"📇 단어",min:10,
    done:dayStat("WK")>=20, go:()=>go("synq")});
  // 유추·독해는 남은 분량 ÷ 플랜 잔여일 → 플랜 종료일에 1회독이 끝나도록 자동 산출
  const vaN=clamp(Math.ceil(vaRemain()/planLeft()),10,60);
  const rcN=clamp(Math.ceil(rcRemainQ()/planLeft()),5,32);
  t.push({k:"va",icon:"🔗",label:`유추 ${vaN}문항`,sub:"🗣 Verbal",min:Math.round(vaN*0.8),
    done:dayStat("VA")>=vaN, go:()=>{ go("analogy"); startAnalogy(false); }});
  t.push({k:"rc",icon:"📖",label:`독해 ${rcN}문항 (24분 타이머)`,sub:"🗣 Verbal",min:Math.round(rcN*2.2),
    done:dayStat("RC")>=rcN, go:()=>go("reading")});
  for(const x of PLAN_DAILY){
    // 표읽기·블록·계기: 외부 앱에서 연습 중이면 여기선 '했다' 체크만 (앱 내 드릴은 선택)
    if(pilotPerfect()&&PILOT_VISUAL.includes(x.sec))
      t.push({k:x.k,icon:x.icon,label:`${x.label.replace(/\s*드릴.*$/,"")} — 외부 앱 연습 (체크만)`,sub:"✈️ Pilot·외부",
        min:x.min,done:dayStat(x.sec)>=x.n,go:x.go});
    else t.push({k:x.k,icon:x.icon,label:x.label,sub:x.tag,min:x.min,done:dayStat(x.sec)>=x.n,go:x.go});
  }
  // 선택: 과학·상황판단 (합성점수 비중 낮음 — 기본 제외, 토글로 격일 포함)
  if(flag("plan_ps_sj")){
    if(i%2===0) t.push({k:"ps",icon:"🔬",label:"과학 10문항",sub:"기타",min:8,
      done:dayStat("PS")>=10, go:()=>startExam("ps",{practice:true})});
    if(i%3===0) t.push({k:"sj",icon:"🧭",label:"상황판단 8문항",sub:"기타",min:15,
      done:dayStat("SJ")>=8, go:()=>{ subCur="sj"; go("subtest"); }});
  }
  // 시험 임박(D-7): verified 단어 최종 스윕 — 막판 망각 방지
  const dExam=dayDiff(todayStr(),state.settings.exam_date);
  if(dExam>=0&&dExam<=7){ const sw=sweepPool().length;
    if(sw>0) t.push({k:"sweep",icon:"🧹",label:`최종 스윕 — verified 단어 ${sw}개 재확인`,sub:"📇 단어",
      min:clamp(Math.round(sw*0.12),3,40), done:false, go:()=>{ go("confirm"); startSweep(); }});
  }
  if(i%7===0){ const today=todayStr();
    t.push({k:"mock",icon:"🎯",label:"모의고사 1회 (시간측정)",sub:"🏁 주간 점검",min:180,
      done:(state.examHist||[]).some(x=>x&&x.ts&&todayStr(new Date(x.ts))===today), go:()=>go("exam")}); }
  return t;
}
function planEndLabel(){ const p=planState(); const d=parseDate(p.start); d.setDate(d.getDate()+planLen()-1);
  return `${d.getMonth()+1}/${d.getDate()}`; }
function planDone(){ const p=planState(); return p.done[todayStr()]||(p.done[todayStr()]={}); }
/* ============================================================
   Verbal 역전 16일 — 시험일 기준 날짜별 체크리스트.
   날짜는 exam_date에서 역산하므로 시험일을 바꿔도 자동으로 따라간다.
   (i=0 → D-16 … i=15 → D-1)
   ============================================================ */
const V16_PHASE={0:["1구간 · 어휘 엔진 걸기","코어 절반 노출 + 유추 관계 체득. 독해는 시간 재지 말고 정확도만."],
                 6:["2구간 · 실전 속도 붙이기","코어 완주 + 세 과목 모두 실제 시험 시간으로. 타이머를 끄지 않는다."],
                 12:["3구간 · 굳히기","신규 어휘 중단. 새로 넣으면 외운 단어가 밀린다."]};
const V16=[
 {tasks:[{i:"📕",l:"모의고사 출제 단어 148개 — 플래시카드",go:()=>startStudySet(mockWordIds(),"모의고사 단어")},
         {i:"🔗",l:"유추 훑어보기 — 관계 유형 구경",go:()=>go("vabrowse")},
         {i:"📖",l:"독해 2지문 (타이머 없이 정확도만)",go:()=>go("reading")}]},
 {tasks:[{i:"📇",l:"어휘 신규 88개",go:()=>startStudyNew()},
         {i:"🔗",l:"반의어 집중 30문항 — 유추 최다 관계(10.8%)",go:()=>{go("analogy");startAnalogy(false);}},
         {i:"📖",l:"독해 2지문",go:()=>go("reading")}]},
 {tasks:[{i:"📇",l:"어휘 신규 88개",go:()=>startStudyNew()},
         {i:"🔗",l:"유추 25문항",go:()=>{go("analogy");startAnalogy(false);}},
         {i:"📖",l:"독해 2지문",go:()=>go("reading")},
         {i:"📐",l:"수학 25문항 — Pilot 유지",go:()=>startExam("mk",{practice:true})}]},
 {tasks:[{i:"📇",l:"어휘 신규 120개 — 주말 증량",go:()=>startStudyNew()},
         {i:"📖",l:"독해 4지문",go:()=>go("reading")},
         {i:"🔗",l:"유추 25문항",go:()=>{go("analogy");startAnalogy(false);}}]},
 {tasks:[{i:"📇",l:"어휘 신규 120개",go:()=>startStudyNew()},
         {i:"🎯",l:"Verbal 섹터 모의고사 1회 — 오늘 점수를 남겨야 비교가 된다",go:()=>startExam("secVerbal")},
         {i:"📊",l:"약점 리포트 확인",go:()=>go("report")}]},
 {tasks:[{i:"📇",l:"어휘 신규 88개",go:()=>startStudyNew()},
         {i:"📕",l:"어제 모의고사 오답 전부 복기",go:()=>go("report")},
         {i:"✈️",l:"항공 20문항 — Pilot 유지",go:()=>startExam("av",{practice:true})}]},
 {tasks:[{i:"📇",l:"어휘 신규 88개",go:()=>startStudyNew()},
         {i:"⏱️",l:"단어 시험 25문항 5분 — 모르면 즉시 찍고 넘기기",go:()=>startExam("wk")},
         {i:"📖",l:"독해 2지문 · 지문당 4분 48초",go:()=>go("reading")}]},
 {tasks:[{i:"📇",l:"어휘 신규 88개",go:()=>startStudyNew()},
         {i:"⏱️",l:"유추 25문항 8분 실전",go:()=>startExam("va")},
         {i:"📐",l:"수학 25문항",go:()=>startExam("mk",{practice:true})}]},
 {tasks:[{i:"📇",l:"어휘 신규 88개",go:()=>startStudyNew()},
         {i:"⏱️",l:"독해 25문항 24분 풀세트 — 지문 하나에 4분 48초 넘기면 넘어가기",go:()=>startExam("rc")},
         {i:"🔗",l:"유추 25문항",go:()=>{go("analogy");startAnalogy(false);}}]},
 {tasks:[{i:"📇",l:"어휘 신규 88개",go:()=>startStudyNew()},
         {i:"✅",l:"확인 시험 — 1구간에 외운 단어 검증",go:()=>go("confirm")},
         {i:"✈️",l:"항공 20문항",go:()=>startExam("av",{practice:true})}]},
 {tasks:[{i:"📇",l:"어휘 신규 120개",go:()=>startStudyNew()},
         {i:"🎯",l:"T01 Verbal 3과목 연속 — 유추 8분 → 단어 5분 → 독해 24분",go:()=>go("exam")},
         {i:"📕",l:"오답 정리",go:()=>go("report")}]},
 {tasks:[{i:"📇",l:"어휘 신규 120개 — 코어 1,052개 완주",go:()=>startStudyNew()},
         {i:"📕",l:"어제 오답 재시험",go:()=>go("report")},
         {i:"📐",l:"수학 25문항",go:()=>startExam("mk",{practice:true})}]},
 {tasks:[{i:"🚫",l:"신규 중단 — 학습중·복습 단어만 반복",go:()=>go("synq")},
         {i:"🎯",l:"T02 Verbal 3과목",go:()=>go("exam")},
         {i:"📕",l:"오답 정리",go:()=>go("report")}]},
 {tasks:[{i:"📕",l:"오답 노트 재시험",go:()=>go("report")},
         {i:"🎯",l:"BARRON1 Verbal",go:()=>go("exam")},
         {i:"✈️",l:"항공 20문항",go:()=>startExam("av",{practice:true})}]},
 {tasks:[{i:"🎯",l:"TRIVIUM1 Verbal",go:()=>go("exam")},
         {i:"📜",l:"시험 전 요약 시트 1회독",go:()=>openCheatsheet("plan")},
         {i:"📇",l:"흔들리는 단어만 훑기",go:()=>go("synq")}]},
 {tasks:[{i:"📕",l:"모의고사 출제 단어 148개 훑기",go:()=>openWordsMock()},
         {i:"📜",l:"요약 시트 한 번 더",go:()=>openCheatsheet("plan")},
         {i:"😴",l:"새 문제 금지 · 일찍 자기 — 전날 잠이 실력이다",go:null}]},
];
function v16Date(i){ const ex=parseDate(state.settings.exam_date||"2026-09-11");
  const d=new Date(ex); d.setDate(d.getDate()-(16-i)); return todayStr(d); }
function v16State(){ if(!state.v16) state.v16={done:{}}; if(!state.v16.done) state.v16.done={}; return state.v16; }
function openWordsMock(){ go("words"); wordFilter="mock"; wordSearch="";
  const sb=$("#searchBox"); if(sb) sb.value="";
  $$("#wordFilters .chip").forEach(c=>c.classList.toggle("on",c.dataset.f==="mock"));
  renderWords(); }
let v16Open=null;
function renderV16(){
  const box=$("#v16"); if(!box) return;
  const st=v16State(), today=todayStr();
  let dn=0, tot=0;
  V16.forEach((d,i)=>{ tot+=d.tasks.length; d.tasks.forEach((_,j)=>{ if(st.done[i+":"+j]) dn++; }); });
  const pct=tot?Math.round(dn/tot*100):0;
  const todayIdx=V16.findIndex((_,i)=>v16Date(i)===today);
  if(v16Open===null) v16Open = todayIdx>=0 ? todayIdx : 0;
  const rows=V16.map((d,i)=>{
    const ds=v16Date(i), wd="일월화수목금토"[parseDate(ds).getDay()];
    const c=d.tasks.filter((_,j)=>st.done[i+":"+j]).length, all=c===d.tasks.length;
    const isToday=ds===today, past=ds<today && !isToday, open=v16Open===i;
    const ph=V16_PHASE[i];
    const head=ph?`<div class="v16-ph"><b>${esc(ph[0])}</b><span>${esc(ph[1])}</span></div>`:"";
    const body=open?`<div class="v16-tasks">${d.tasks.map((t,j)=>{
        const on=!!st.done[i+":"+j];
        return `<div class="v16-t ${on?"on":""}">
          <button class="v16-box" data-ck="${i}:${j}" aria-label="완료 표시">${on?"✓":""}</button>
          <div class="v16-l">${t.i} ${esc(t.l)}</div>
          ${t.go&&!on?`<button class="btn sm primary v16-go" data-go3="${i}:${j}">시작 →</button>`:""}
        </div>`; }).join("")}</div>`:"";
    return `${head}<div class="v16-d ${isToday?"today":""} ${past?"past":""} ${all?"all":""}" data-d="${i}">
        <div class="v16-hd" data-tg="${i}">
          <div class="v16-dn">D-${16-i}</div>
          <div class="v16-dt">${ds.slice(5).replace("-","/")} <span>(${wd})</span></div>
          <div class="v16-pr">${all?"✓ 완료":c+"/"+d.tasks.length}</div>
          <div class="v16-ar">${open?"▾":"▸"}</div>
        </div>${body}</div>`;
  }).join("");
  box.innerHTML=`<div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><div class="muted" style="font-size:13px">🗣 Verbal 역전 16일</div>
        <div class="plan-day">${dn}<small> / ${tot} 완료</small></div>
        <div class="muted" style="font-size:12px;margin-top:4px">어휘가 유추·단어·독해 셋 전부에 들어간다</div></div>
      <div class="ring" style="--p:${pct}"><div class="v"><b>${pct}%</b><span>16일</span></div></div>
    </div>
    <div class="progressbar" style="margin-top:12px"><i style="width:${pct}%"></i></div>
    <div class="v16-list">${rows}</div>`;
  $$("#v16 .v16-hd").forEach(el=>el.onclick=()=>{ const i=+el.dataset.tg; v16Open=(v16Open===i?-1:i); renderV16(); });
  $$("#v16 .v16-box").forEach(b=>b.onclick=e=>{ e.stopPropagation(); const k=b.dataset.ck;
    if(st.done[k]) delete st.done[k]; else st.done[k]=1; saveLocal(); renderV16(); });
  $$("#v16 .v16-go").forEach(b=>b.onclick=e=>{ e.stopPropagation();
    const [i,j]=b.dataset.go3.split(":").map(Number); const t=V16[i].tasks[j]; if(t&&t.go) t.go(); });
}

function renderPlan(){
  const p=planState(), i=planIdx(), tasks=planTasks(), man=planDone();
  const isDone=t=>t.done||!!man[t.k];
  const doneN=tasks.filter(isDone).length, pct=Math.round(doneN/tasks.length*100);
  const core=coreTotal(), left=coreRemain(), learned=core-left;
  const examLeft=Math.max(0,dayDiff(todayStr(),state.settings.exam_date));
  const leftMin=tasks.filter(t=>!isDone(t)).reduce((a,b)=>a+(b.min||0),0);
  const hhmm=m=>m<=0?"완료":(m>=60?`${Math.floor(m/60)}시간 ${m%60?m%60+"분":""}`.trim():`${m}분`);
  $("#planHead").innerHTML=`
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><div class="muted" style="font-size:13px">${planLen()}일 완성 플랜</div>
        <div class="plan-day">DAY <b>${i}</b><small> / ${planLen()}</small></div>
        <div class="muted" style="font-size:12px;margin-top:4px">시험까지 ${examLeft}일 · 빈출 단어 ${learned}/${core}</div>
        <div style="font-size:12px;margin-top:6px;color:var(--brand2);font-weight:700">⏱️ 남은 예상 ${hhmm(leftMin)}</div>
        <div class="muted" style="font-size:11px;margin-top:3px">🏁 ${planEndLabel()} 전 과목 1회독 완료 예정</div></div>
      <div class="ring" style="--p:${pct}"><div class="v"><b>${pct}%</b><span>오늘</span></div></div>
    </div>
    <div class="progressbar" style="margin-top:12px"><i style="width:${Math.round(i/planLen()*100)}%"></i></div>
    <div class="muted" style="font-size:11px;margin-top:6px">플랜 진행 ${Math.round(i/planLen()*100)}% · 빈출 단어 ${core?Math.round(learned/core*100):0}% 완료</div>`;
  $("#planTasks").innerHTML=tasks.map(t=>{ const dn=isDone(t);
    return `<div class="ptask ${dn?"on":""}" data-k="${esc(t.k)}">
      <button class="pchk" data-chk="${esc(t.k)}" aria-label="완료 표시">${dn?"✓":""}</button>
      <div class="pmeta"><div class="pl">${t.icon} ${esc(t.label)}</div><div class="ps">${esc(t.sub)}${t.min?" · ~"+t.min+"분":""}${t.done?" · 자동 완료":""}</div></div>
      ${dn?"":`<button class="btn sm primary pgo" data-go2="${esc(t.k)}">시작 →</button>`}
    </div>`; }).join("");
  $$("#planTasks .pchk").forEach(b=>b.onclick=()=>{ const k=b.dataset.chk;
    if(man[k]) delete man[k]; else man[k]=1; saveLocal(); renderPlan(); });
  $$("#planTasks .pgo").forEach(b=>b.onclick=()=>{ const t=tasks.find(x=>x.k===b.dataset.go2); if(t&&t.go) t.go(); });
  renderV16();
  $("#planAllDone").classList.toggle("hidden", doneN<tasks.length);
  const ps=$("#optPlanPsSj");
  if(ps){ ps.checked=flag("plan_ps_sj");
    ps.onchange=e=>{ state.settings.plan_ps_sj=e.target.checked; saveLocal(); queuePush("settings",{}); renderPlan(); }; }
}

/* ============================================================
   VOCAB HUB
   ============================================================ */
function renderVocab(){
  const cnt=countByStatus();
  deckBtnPaint("#vkNew","#vkReview");
  $("#vkLearned").textContent=cnt.learned; $("#vkMastered").textContent=cnt.mastered;
  // 모의고사 묶음을 하다 말았으면 버튼에 이어서 할 위치를 표시한다.
  { const b=$("#vkMock"), sv=state.session, n=mockWordIds().length;
    if(b) b.textContent = (sv&&sv.scope==="모의고사 단어"&&sv.idx<sv.plan)
      ? `📕 모의고사 단어 플래시카드 — ${sv.idx+1}/${sv.plan} 이어서`
      : `📕 모의고사 단어 플래시카드 — 실제 출제 확인된 ${n}개`; }
  // 오답 단어 덱 — 개수/이어하기 표시, 0개면 비활성
  { const b=$("#vkWrong"), sv=state.session, n=wrongWordIds().length;
    if(b){
      b.textContent = (sv&&sv.scope==="오답 단어"&&sv.idx<sv.plan)
        ? `📛 오답 단어 플래시카드 — ${sv.idx+1}/${sv.plan} 이어서`
        : n>0 ? `📛 오답 단어 플래시카드 — 틀린 단어 ${n}개`
              : `📛 오답 단어 플래시카드 — 아직 틀린 단어 없음`;
      b.disabled = n===0 && !(sv&&sv.scope==="오답 단어"&&sv.idx<sv.plan);
    } }
  $("#vkHigh").textContent=cnt.highLearned; $("#vkRemain").textContent=cnt.remaining;
  const cf=confirmPoolFirst().length, cr=confirmPoolRecheck().length;
  $("#vkConfirmSub").textContent = cr>0?`🔁 재확인 ${cr}개 대기 · 첫 확인 ${cf}개`:cf>0?`확인 대기 ${cf}개`:"확인할 단어 없음";
  $("#optHighFirst").checked=flag("high_first"); $("#optHighOnly").checked=flag("high_only");
}

/* ============================================================
   자동 넘김 (핸즈프리 / 운동용) — 화면 안 만져도 단어→뜻→다음 자동 진행 + 음성
   ============================================================ */
let ap=null, apWake=null;
const AP_SPEED={slow:{show:4200,mean:4600},normal:{show:2800,mean:3200},fast:{show:1700,mean:2100}};
async function apAcquireWake(){ try{ if("wakeLock" in navigator && !apWake){ apWake=await navigator.wakeLock.request("screen");
  apWake.addEventListener&&apWake.addEventListener("release",()=>{ apWake=null; }); } }catch(e){} }
function apReleaseWake(){ try{ apWake&&apWake.release&&apWake.release(); }catch(e){} apWake=null; }
function apClearTimer(){ if(ap&&ap.t){ clearTimeout(ap.t); ap.t=null; } }
function apStop(){ apClearTimer(); try{ window.speechSynthesis&&window.speechSynthesis.cancel(); }catch(e){} apReleaseWake(); ap=null; }
// 이어보기 체크포인트는 로컬에만 저장(동기화 X — 플래시카드 세션과 동일 방침).
function apSaveSession(){ if(!ap) return; state.autoplay={queue:ap.queue, idx:ap.idx, scope:ap.scope, speed:ap.speed, ko:ap.ko, loop:ap.loop, extra:ap.extra}; saveLocal(); }
function renderAutoPlaySetup(){
  apStop(); $("#apSetup").classList.remove("hidden"); $("#apPlayer").classList.add("hidden"); $("#apCount").textContent="";
  const sv=state.autoplay, box=$("#apResume"); if(!box) return;
  if(sv&&sv.queue&&sv.queue.length&&(sv.idx||0)<sv.queue.length-1){
    box.classList.remove("hidden");
    box.innerHTML=`<button class="btn primary" id="apResumeBtn" style="background:linear-gradient(90deg,var(--brand),var(--brand2));border:0">⏵ 이어서 재생 (${(sv.idx||0)+1} / ${sv.queue.length})</button>
      <button class="btn ghost sm" id="apResumeClear" style="margin-top:8px">↩︎ 이어보기 지우기</button>`;
    $("#apResumeBtn").onclick=resumeAutoPlay;
    $("#apResumeClear").onclick=()=>{ state.autoplay=null; saveLocal(); renderAutoPlaySetup(); toast("이어보기 지웠어요"); };
  } else { box.classList.add("hidden"); box.innerHTML=""; }
}
function resumeAutoPlay(){
  const sv=state.autoplay; if(!sv||!sv.queue||!sv.queue.length){ toast("이어볼 기록이 없어요"); return; }
  ap={queue:sv.queue.slice(), idx:Math.min(sv.idx||0, sv.queue.length-1), revealed:false, playing:true,
      speed:sv.speed||"normal", ko:sv.ko!==false, loop:sv.loop!==false, extra:sv.extra!==false, scope:sv.scope, t:null};
  $("#apSetup").classList.add("hidden"); $("#apPlayer").classList.remove("hidden");
  apAcquireWake(); apShowPhase();
}
function startAutoPlay(){
  const scope=$("#apScope").value;
  let ids=poolFor(scope);
  if(!ids.length){ toast("이 범위에 단어가 없어요. 학습을 하거나 범위를 바꿔보세요."); return; }
  ids=shuffle(ids);
  ap={queue:ids, idx:0, revealed:false, playing:true, speed:$("#apSpeed").value, ko:$("#apKo").checked,
      loop:$("#apLoop").checked, extra:!$("#apExtra")||$("#apExtra").checked, scope, t:null};
  $("#apSetup").classList.add("hidden"); $("#apPlayer").classList.remove("hidden");
  apAcquireWake(); apSaveSession(); apShowPhase();
}
function apRender(){
  const s=ap; if(!s) return; const w=WMAP.get(s.queue[s.idx]); if(!w){ return apAdvance(); }
  $("#apCount").textContent=`${s.idx+1} / ${s.queue.length}`;
  $("#apBar").style.width=(s.idx/s.queue.length*100)+"%";
  $("#apCard").innerHTML=`
    <div class="ap-word" style="${wordFont(w.word,42)}">${esc(w.word)}</div>
    <div class="ap-pos">${esc(w.pos||"")}${tierOf(w)==="high"?" · ⭐빈출":""}</div>
    <div class="ap-mean ${s.revealed?"":"hidden"}">
      <div class="ap-kor">${esc(w.kor||"")}</div>
      ${w.def?`<div class="ap-def">${esc(w.def)}</div>`:""}
      ${s.extra&&(w.synonyms||[]).length?`<div class="ap-syn">${w.synonyms.slice(0,3).map(x=>`<span>${esc(x)}</span>`).join("")}</div>`:""}
      ${s.extra&&(w.roots||[]).length?`<div class="ap-roots">🧩 ${w.roots.map(r=>`<b>${esc(r.f)}</b> ${esc(r.m)}`).join(" + ")}${w.hook?`<div class="h">→ ${esc(w.hook)}</div>`:""}</div>`:""}
    </div>`;
  $("#apPlay").textContent=s.playing?"⏸":"▶︎";
  const ex=state.apExposure[todayStr()]||0, el=$("#apExposed");
  if(el) el.textContent = ex?`🎧 오늘 들은 단어 ${ex}개${ex>=AP_STREAK_MIN?" · 스트릭 인정 ✓":` · ${AP_STREAK_MIN}개+면 스트릭 인정`} · `:"";
}
function apShowPhase(){ // show word, speak it, then schedule the reveal
  const s=ap; if(!s) return; s.revealed=false; apRender(); apSaveSession(); // checkpoint each card
  const w=WMAP.get(s.queue[s.idx]);
  if(s.playing && w) speak(w.word);
  apClearTimer(); if(s.playing) s.t=setTimeout(apRevealPhase, AP_SPEED[s.speed].show);
}
function apRevealPhase(){ // reveal meaning, speak it, then schedule advance
  const s=ap; if(!s) return; s.revealed=true;
  if(s._lastExp!==s.idx){ s._lastExp=s.idx; bumpExposure(); } // 카드당 1회 노출 인정(스트릭용)
  apRender();
  const w=WMAP.get(s.queue[s.idx]);
  let extraSpoken=false;
  if(s.playing && w){
    const seq=[];
    if(s.ko && w.kor) seq.push({t:w.kor, lang:"ko-KR"}); else if(w.def) seq.push({t:w.def, lang:"en-US"});
    // 오늘 정렬한 '가장 시험에 잘 나오는' 동의어를 이어서 읽어 WK식 연결을 강화
    if(s.extra && (w.synonyms||[]).length){ seq.push({t:w.synonyms[0], lang:"en-US"}); extraSpoken=true; }
    if(seq.length===1) speak(seq[0].t, null, seq[0].lang); else if(seq.length) speakSeq(seq);
  }
  apClearTimer(); if(s.playing) s.t=setTimeout(apAdvance, AP_SPEED[s.speed].mean + (extraSpoken?800:0));
}
function apAdvance(){
  const s=ap; if(!s) return;
  if(s.idx>=s.queue.length-1){ if(s.loop){ s.idx=0; s.queue=shuffle(s.queue); } else { return apFinish(); } }
  else s.idx++;
  apShowPhase();
}
function apFinish(){ apClearTimer(); if(ap) ap.playing=false; apReleaseWake();
  state.autoplay=null; saveLocal(); // 끝까지 봤으면 체크포인트 정리(다음엔 새로 시작)
  toast("한 바퀴 끝! 🔁 반복을 켜면 계속 돌아요."); apRender(); }
function apTogglePlay(){ const s=ap; if(!s) return; s.playing=!s.playing;
  if(s.playing){ apAcquireWake(); apShowPhase(); }
  else { apClearTimer(); try{ window.speechSynthesis.cancel(); }catch(e){} apReleaseWake(); apRender(); } }
function apManual(dir){ const s=ap; if(!s) return; apClearTimer();
  s.idx=(s.idx+dir+s.queue.length)%s.queue.length; if(!s.playing) s.playing=true; apShowPhase(); }

/* ============================================================
   STUDY (flashcards)
   ============================================================ */
let session=null;
function snapSession(){ if(!session) return; const s=session;
  state.session={queue:s.queue.slice(),idx:s.idx,plan:s.plan,studied:s.studied,correct:s.correct,
    done:[...(s.doneSet||[])],miss:[...(s.missSet||[])],neww:[...(s.newSet||[])],day:todayStr(),scope:s.scope||null}; }
// 특정 묶음만 플래시카드로 학습 (모의고사 단어, 단어장 필터 결과 등).
// SRS 채점은 그대로 적용하되, 하루 목표(target)는 건드리지 않는다 — 별도 학습이므로.
function mockWordIds(){ return WORDS.filter(w=>w.mock&&w.mock.length).map(w=>w.id); }
// 묶음 학습일 때만 '처음부터' 버튼을 띄운다 — 이어서 하기가 기본이므로 되돌릴 길이 필요하다.
function updateStudyRestart(){
  const b=$("#studyRestart"); if(!b) return;
  const on=!!(session&&session.scope);
  b.classList.toggle("hidden",!on);
  if(on) b.onclick=()=>{
    if(!confirm(`${session.scope} 학습을 처음부터 다시 시작할까요?\n지금까지의 진행 위치만 초기화되고, 외운 기록은 그대로 남습니다.`)) return;
    const ids=session.queue.slice(), tag=session.scope;
    session=null; state.session=null; saveLocal();
    startStudySet(ids,tag);
  };
}
// 저장된 세션 큐에서 사라진 단어 id 제거(words.json 재생성 대비) — idx도 함께 보정
function validQueue(sv){
  let idx=sv.idx||0; const q=[];
  (sv.queue||[]).forEach((id,i)=>{ if(WMAP.has(id)) q.push(id); else if(i<(sv.idx||0)) idx--; });
  return {q, idx:Math.max(0,Math.min(idx,q.length))};
}
// 다른 미완 세션을 덮어쓰기 전 확인 — 슬롯이 하나뿐이라 무언 덮어쓰기는 진행 위치를 날린다
function confirmDropSession(sv,tag){
  if(!(sv&&sv.queue&&sv.queue.length&&sv.idx<sv.queue.length)) return true;   // 미완 세션 없음
  const cur=sv.scope||"오늘 학습";
  if(cur===tag) return true;                                                  // 같은 덱이면 이어하기가 처리
  return confirm(`⏸ "${cur}" 학습이 ${sv.idx}/${sv.plan}에서 멈춰 있어요.\n새로 시작하면 그 진행 위치가 사라져요. 계속할까요?\n(외운 기록은 어느 쪽이든 안전해요)`);
}
function startStudySet(ids,label){
  ids=[...new Set((ids||[]).filter(id=>WMAP.has(id)))];
  if(!ids.length){ toast("학습할 단어가 없어요."); return; }
  const tag=label||"set", sv=state.session;
  if(!confirmDropSession(sv,tag)) return;
  // 하던 묶음이 남아 있으면 이어서 — 매번 처음부터 다시 시작하면 순서가 바뀌어
  // 같은 단어를 반복하고 끝을 못 본다. 날짜가 바뀌어도 이어간다(148개는 며칠에 걸쳐 돈다).
  if(sv&&sv.scope===tag&&sv.queue&&sv.queue.length&&sv.idx<sv.queue.length){
    const vq=validQueue(sv);
    if(vq.idx<vq.q.length){
      session={queue:vq.q,idx:vq.idx,plan:vq.q.length,studied:sv.studied||0,correct:sv.correct||0,
        doneSet:new Set(sv.done||[]),missSet:new Set(sv.miss||[]),newSet:new Set(sv.neww||[]),
        revealed:false,startTs:Date.now(),scope:tag};
      go("study"); $("#studyDone").classList.add("hidden"); renderCard(); updateStudyRestart();
      toast(`이어서 학습합니다 ▶ ${vq.idx+1} / ${vq.q.length}`,2600);
      return;
    }
  }
  // 아직 안 외운 것 → 복습 기한이 지난 것 → 나머지 순
  const rank=id=>{ const c=getCard(id); if(c.status==="new") return 0;
    return (c.due&&new Date(c.due).getTime()<=Date.now())?1:2; };
  const queue=ids.slice().sort((a,b)=>rank(a)-rank(b));
  const newSet=new Set(queue.filter(id=>getCard(id).status==="new"));
  session={queue,idx:0,plan:queue.length,studied:0,correct:0,
    doneSet:new Set(),missSet:new Set(),newSet,revealed:false,startTs:Date.now(),scope:tag};
  snapSession(); saveLocal();
  go("study"); $("#studyDone").classList.add("hidden"); renderCard(); updateStudyRestart();
  toast(`${tag} ${queue.length}개 — 신규 ${newSet.size} · 복습 ${queue.length-newSet.size}`,2800);
}
function startStudy(){
  // Resume an unfinished session (don't restart from scratch when you re-enter).
  const sv=state.session;
  if(sv&&!sv.scope&&sv.day===todayStr()&&sv.queue&&sv.queue.length&&sv.idx<sv.queue.length){
    const vq=validQueue(sv);
    if(vq.idx<vq.q.length){
      session={queue:vq.q,idx:vq.idx,plan:vq.q.length,studied:sv.studied||0,correct:sv.correct||0,
        doneSet:new Set(sv.done||[]),missSet:new Set(sv.miss||[]),newSet:new Set(sv.neww||[]),
        revealed:false,startTs:Date.now()};
      go("study"); $("#studyDone").classList.add("hidden"); renderCard(); updateStudyRestart(); toast("이어서 학습합니다 ▶");
      return;
    }
  }
  if(!confirmDropSession(sv,"오늘 학습")) return;   // 미완 묶음 덱 무언 덮어쓰기 방지
  const due=dueCards(), news=newCardIds(newPerDay());
  let queue=[...due,...news];
  if(!queue.length) queue=newCardIds(newPerDay());
  if(!queue.length){ toast("오늘 학습할 카드가 없어요! 🎉"); go("home"); return; }
  // Cards that are still "new" at session start are the new-learning portion.
  const newSet=new Set(queue.filter(id=>getCard(id).status==="new"));
  session={queue,idx:0,plan:queue.length,studied:0,correct:0,
    doneSet:new Set(),missSet:new Set(),newSet,revealed:false,startTs:Date.now()};
  // Today's goal == today's flashcard quota, so the home ring and the card
  // counter always agree. Set once per day.
  const d=getDay(); if(!d.target){ d.target=queue.length; }
  snapSession(); saveLocal();
  go("study"); $("#studyDone").classList.add("hidden"); renderCard(); updateStudyRestart();
  // Make the session size self-explanatory (reviews + new, not a doubled bug).
  const revCount=queue.length-newSet.size;
  toast(`오늘 ${queue.length}개 — 복습 ${revCount} · 신규 ${newSet.size}`, 2600);
}
// ---- 신규 / 복습 분리 덱 ----
// 복습이 1,000개+ 쌓이면 통합 큐에서 신규가 맨 뒤에 묻힌다 — 덱을 분리해 각자 시작.
// startStudySet 재사용: scope 이어하기·처음부터·세션 충돌 confirm·id 검증이 그대로 적용된다.
function newDeckCount(){ return Math.min(newPerDay(), newWordsRemaining()); }
function deckBtnPaint(newSel,revSel){
  const sv=state.session;
  const cont=scope=> (sv&&sv.scope===scope&&sv.queue&&sv.idx<sv.plan) ? `${sv.idx+1}/${sv.plan} 이어서` : null;
  const newN=newDeckCount(), dueN=dueCards().length;
  const nb=$(newSel);
  if(nb){ const c=cont("신규 단어"), remain=newWordsRemaining(), nBundles=newN>0?Math.ceil(remain/newN):0;
    nb.textContent = c ? `🆕 신규 단어 — ${c}${nBundles>1?` · 남은 ${nBundles}묶음`:""}`
      : remain>newN&&newN>0 ? `🆕 신규 단어 ${newN}개씩 ${nBundles}묶음 (총 ${remain}개)`
      : newN>0 ? `🆕 신규 단어 ${newN}개 (마지막 묶음)` : "🆕 오늘 신규 없음";
    nb.disabled = !c && newN===0; }
  const rb=$(revSel);
  if(rb){ const c=cont("오늘 복습"), bundles=Math.ceil(dueN/REVIEW_CHUNK);
    rb.textContent = c ? `🔁 복습 — ${c}${bundles>1?` · 남은 ${bundles}묶음`:""}`
      : dueN>REVIEW_CHUNK ? `🔁 복습 ${REVIEW_CHUNK}개씩 ${bundles}묶음 (총 ${dueN}개)`
      : dueN>0 ? `🔁 복습 ${dueN}개 (마지막 묶음)` : "🔁 복습 없음";
    rb.disabled = !c && dueN===0; }
}
function startStudyNew(){
  const ids=newCardIds(newPerDay());
  if(!ids.length){ toast("오늘 신규 단어가 없어요! 🎉"); return; }
  startStudySet(ids,"신규 단어");
}
const REVIEW_CHUNK=150;   // 한 세션 최대 — 끝나면 다음 묶음이 자동으로 이어진다
function startStudyReview(){
  const due=dueCards().sort((a,b)=>new Date(getCard(a).due||0)-new Date(getCard(b).due||0)); // 오래 밀린 것부터
  if(!due.length){ toast("복습할 카드가 없어요! 🎉"); return; }
  startStudySet(due.slice(0,REVIEW_CHUNK),"오늘 복습");
}
function renderCard(){
  const s=session; if(s.idx>=s.queue.length) return finishStudy();
  const id=s.queue[s.idx], w=WMAP.get(id), c=getCard(id), isN=c.status==="new";
  if(!w){ s.idx++; return renderCard(); }   // 데이터 갱신으로 사라진 id — 건너뛰기 (TypeError 방지)
  $("#studyMode").textContent=isN?"🆕 신규":"🔁 복습";
  $("#studyCount").textContent=`${Math.min(s.studied+1,s.plan)} / ${s.plan}`;
  $("#studyBar").style.width=clamp(s.studied/s.plan*100,0,100)+"%"; s.revealed=false;
  const syn=(w.synonyms||[]).map(x=>`<span>${esc(x)}</span>`).join("");
  const ana=(w.analogyRelations||[]).map(esc).join("<br>");
  const srcTag=w.source==="gre-magoosh"?`<span class="witem"><span class="src">GRE</span></span>`:"";
  $("#studyArea").innerHTML=`
    <div class="flash" id="flashCard">
      <button class="star-btn ${c.starred?'on':''}" id="starBtn">${c.starred?'★':'☆'}</button>
      <div class="word-row"><div class="word" style="${wordFont(w.word,38)}">${esc(w.word)}</div>${spkBtn(w.word)}</div>
      <div class="pos">${esc(w.pos||"")}${w.source==="gre-magoosh"?" · GRE":""}${tierOf(w)==="high"?" · ⭐빈출":""}</div>
      <div class="reveal hidden" id="revealBox">
        <div class="kor">${esc(w.kor||"")}</div>
        <div class="def">${esc(w.def||"")}</div>
        ${rootsHTML(w)}
        ${w.example?`<div class="ex">"${esc(w.example)}" ${spkBtn(w.example)}</div>`:""}
        ${syn?`<div class="syn">${syn}</div>`:""}
        ${ana?`<div class="ana">${ana}</div>`:""}
      </div>
      <div class="tap-hint" id="tapHint">👆 탭하면 뜻 보기</div>
    </div>
    <div class="grade hidden" id="gradeRow">
      <button class="g-again" data-q="again">다시<small>&lt;1분</small></button>
      <button class="g-hard"  data-q="hard">어려움<small>${fmtIv(predict(id,'hard'))}</small></button>
      <button class="g-good"  data-q="good">알맞음<small>${fmtIv(predict(id,'good'))}</small></button>
      <button class="g-easy"  data-q="easy">쉬움<small>${fmtIv(predict(id,'easy'))}</small></button>
    </div>`;
  $("#flashCard").onclick=e=>{ if(e.target.closest("#starBtn")||e.target.closest(".spk"))return; flipCard(); };
  $("#starBtn").onclick=e=>{ e.stopPropagation(); toggleStar(id); const on=getCard(id).starred; $("#starBtn").classList.toggle("on",on); $("#starBtn").textContent=on?"★":"☆"; };
  $$("#gradeRow button").forEach(b=>b.onclick=()=>answer(id,b.dataset.q));
  wireSpeakers($("#studyArea"));
}
// Tap toggles the card front↔back so you can keep flipping. Advancing happens
// only via the grade buttons. Once seen, the grade row stays available.
function flipCard(){
  const s=session; if(!s) return; s.revealed=!s.revealed;
  $("#revealBox").classList.toggle("hidden", !s.revealed);
  const th=$("#tapHint");
  if(s.revealed){ s.seen=true; $("#gradeRow").classList.remove("hidden"); if(th){ th.classList.add("hidden"); } }
  else if(th){ th.classList.remove("hidden"); th.textContent="👆 탭하면 다시 뜻 보기"; }
}
function reveal(){ if(session&&!session.revealed) flipCard(); }
function answer(id,q){ const s=session, wasNew=getCard(id).status==="new"; gradeCard(id,q);
  if(wasNew) s.newSet.add(id);
  const secs=Math.round((Date.now()-(s.cardTs||s.startTs))/1000); s.cardTs=Date.now();
  if(q==="again"){
    // Card isn't finished — requeue it and remember it was missed. Do NOT count
    // it as progress, so studied/goal reflect UNIQUE cards completed, not taps.
    s.missSet.add(id); bumpDay({seconds:secs});
    const w=s.queue.splice(s.idx,1)[0]; s.queue.splice(Math.min(s.idx+3,s.queue.length),0,w);
  } else {
    if(!s.doneSet.has(id)){           // count each card exactly once
      s.doneSet.add(id); s.studied++;
      const missed=s.missSet.has(id); if(!missed) s.correct++;
      bumpDay({studied:1,correct:missed?0:1,new_learned:s.newSet.has(id)?1:0,seconds:secs});
    } else bumpDay({seconds:secs});
    s.idx++;
  }
  snapSession(); saveLocal(); renderHome(); renderCard(); }
function finishStudy(){ const s=session, secs=Math.round((Date.now()-s.startTs)/1000);
  $("#studyArea").innerHTML=""; $("#studyBar").style.width="100%"; $("#studyCount").textContent=`${s.plan} / ${s.plan}`;
  const acc=s.studied?Math.round(s.correct/s.studied*100):0;
  $("#doneSub").textContent=`${s.studied}개 학습 · 정답 ${acc}% · ${Math.round(secs/60)}분`;
  $("#studyDone").classList.remove("hidden");
  { const dueLeft=dueCards().length, newLeft=newDeckCount(), more=$("#doneMore");
    more.classList.toggle("hidden", dueLeft===0 && newLeft===0);   // 남은 쪽 덱으로 원탭 전환
    const bundles=Math.ceil(dueLeft/REVIEW_CHUNK), nB=newLeft>0?Math.ceil(newWordsRemaining()/newLeft):0;
    more.textContent = dueLeft>0 ? `🔁 이어서 복습 ${Math.min(dueLeft,REVIEW_CHUNK)}개${bundles>1?` (남은 ${bundles}묶음)`:""}`
      : `🆕 이어서 신규 ${newLeft}개${nB>1?` (남은 ${nB}묶음)`:""}`; }
  if(getDay().goal_met) toast("🔥 오늘 목표 달성! 스트릭 +1"); session=null; state.session=null; saveLocal(); updateStudyRestart(); }

// PC 키보드 조작 — 마우스 없이 빠르게 넘긴다.
// Space: 뜻 보기 → (뜻이 보이는 상태에서) 알맞음으로 넘김. 1~4로 바로 채점.
// e.code를 쓰므로 한글 입력 상태에서도 동작한다.
function wireStudyKeys(){
  document.addEventListener("keydown",e=>{
    const sv=$("#view-study");
    if(!sv||getComputedStyle(sv).display==="none") return;
    if(!session) return;
    const t=e.target;
    if(t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable)) return;
    if(e.metaKey||e.ctrlKey||e.altKey) return;
    const done=$("#studyDone");
    if(done&&!done.classList.contains("hidden")) return;   // 완료 화면에선 비활성
    const id=session.queue[session.idx];
    const canGrade=()=>{ const g=$("#gradeRow"); return g&&!g.classList.contains("hidden"); };
    const grade=q=>{ if(canGrade()) answer(id,q); else flipCard(); };
    const c=e.code;
    if(c==="Space"||c==="Enter"||c==="NumpadEnter"){ e.preventDefault();
      if(!session.revealed) flipCard(); else answer(id,"good"); return; }
    if(c==="ArrowDown"||c==="ArrowUp"){ e.preventDefault(); flipCard(); return; }
    const dig=/^(Digit|Numpad)([1-4])$/.exec(c);
    if(dig){ e.preventDefault(); grade(["again","hard","good","easy"][+dig[2]-1]); return; }
    if(c==="KeyS"){ e.preventDefault(); const b=$("#starBtn"); if(b) b.click(); return; }
    if(c==="KeyP"){ e.preventDefault(); const b=$("#studyArea .spk"); if(b) b.click(); return; }
    if(c==="Escape"||e.key==="Escape"){ e.preventDefault(); const b=$("#studyBack"); if(b) b.click(); return; }
  });
}

/* ============================================================
   QUIZ (WK)
   ============================================================ */
let quiz=null;
function poolFor(scope){
  if(scope==="all") return WORDS.map(w=>w.id);
  if(scope==="high") return WORDS.filter(w=>tierOf(w)!=="std").map(w=>w.id);
  if(scope==="starred") return WORDS.filter(w=>getCard(w.id).starred).map(w=>w.id);
  if(scope==="due") return dueCards();
  if(scope==="today") return WORDS.filter(w=>{const c=state.cards[w.id];return c&&c.status!=="new"&&c.updated_at&&todayStr(new Date(c.updated_at))===todayStr();}).map(w=>w.id);
  return WORDS.filter(w=>{const c=state.cards[w.id];return c&&c.status!=="new";}).map(w=>w.id);
}
function startQuizScope(scope){ go("quiz"); $("#quizScope").value=scope; $("#quizStart").classList.remove("hidden"); $("#quizDone").classList.add("hidden"); $("#quizArea").innerHTML=""; startQuiz(); }
function startQuiz(){ const scope=$("#quizScope").value,type=$("#quizType").value; let pool=poolFor(scope);
  if(pool.length<4){ toast("문제 낼 단어가 부족해요. 학습하거나 범위를 넓혀보세요."); return; }
  quiz={items:sample(pool,Math.min(10,pool.length)),idx:0,score:0,type,answered:false};
  $("#quizStart").classList.add("hidden"); $("#quizDone").classList.add("hidden"); renderQuiz(); }
function renderQuiz(){ const q=quiz; if(q.idx>=q.items.length) return finishQuiz();
  const id=q.items[q.idx],w=WMAP.get(id);
  let type=q.type==="mix"?["e2k","k2e","syn"][Math.floor(Math.random()*3)]:q.type;
  if(type==="syn"&&!(w.synonyms&&w.synonyms.length)) type="e2k";
  $("#quizCount").textContent=`${q.idx+1} / ${q.items.length}`; $("#quizScore").textContent=`${q.score}점`; $("#quizBar").style.width=(q.idx/q.items.length*100)+"%";
  let prompt,qword,correct,choices;
  if(type==="e2k"){ prompt="이 단어의 뜻은?"; qword=w.word; correct=w.kor; choices=korChoices(w,3); }
  else if(type==="k2e"){ prompt="다음 뜻의 단어는?"; qword=w.kor; correct=w.word;
    const wS=new Set((w.synonyms||[]).map(x=>String(x).toLowerCase()));
    choices=shuffle(WORDS).filter(x=>x.id!==id&&!wkNeighbor(w,x,wS)).slice(0,3).map(x=>x.word); }
  else { prompt=`"${w.word}" 와(과) 비슷한 말은?`; qword=w.word; correct=wkPickCorrect(w);
    const d=wkDistractors(w,correct,3); choices=d?d.map(x=>x.t):sample(WORDS.filter(x=>x.id!==id&&x.synonyms&&x.synonyms.length),3).map(x=>x.synonyms[0]); }
  const opts=shuffle([correct,...choices]);
  $("#quizArea").innerHTML=`<div class="card"><div class="q-prompt">${esc(prompt)}</div><div class="q-word" style="${wordFont(qword,26)}">${esc(qword)}</div>
    <div class="choices" id="choices">${opts.map(o=>`<button class="choice">${esc(o)}</button>`).join("")}</div></div>`;
  q.answered=false;
  $$("#choices .choice").forEach(btn=>btn.onclick=()=>{ if(q.answered)return; q.answered=true; const ok=btn.textContent===correct;
    $$("#choices .choice").forEach(b=>{ b.disabled=true; if(b.textContent===correct) b.classList.add("correct"); else if(b===btn) b.classList.add("wrong"); });
    if(ok) q.score+=10; bumpDay({studied:1,correct:ok?1:0}); recordSecAcc("WK",ok);
      // 오답 노트에도 반영 — 시험(recordResult)과 동일하게 맞히면 지운다
      if(ok) delete state.wrong.wk[id]; else state.wrong.wk[id]=(state.wrong.wk[id]||0)+1;
      { const o=state.weak.wkTier[tierOf(w)]||(state.weak.wkTier[tierOf(w)]={c:0,w:0}); if(ok)o.c++; else o.w++; }
      renderHome();
    setTimeout(()=>{ q.idx++; renderQuiz(); }, ok?550:1100); });
}
function finishQuiz(){ const q=quiz,total=q.items.length,got=q.score/10,pct=Math.round(got/total*100);
  $("#quizArea").innerHTML=""; $("#quizBar").style.width="100%";
  $("#quizEmoji").textContent=pct>=90?"🏆":pct>=70?"🎯":pct>=50?"💪":"📚";
  $("#quizResult").textContent=`${got} / ${total} 정답 (${pct}%)`;
  $("#quizResultSub").textContent=pct>=90?"완벽해요!":pct>=70?"좋아요, 계속!":"복습하면 금방 올라요.";
  $("#quizDone").classList.remove("hidden"); quiz=null; }

/* ============================================================
   동의어 퀴즈 (WK 실전형 · 연속 반복) — 단어 하나에 '가장 비슷한 뜻' 고르기.
   진도(SRS)는 안 건드리고, 기존 퀴즈처럼 일일활동·예상점수(WK)·오답노트에만 반영.
   ============================================================ */
let synq=null;
function synPool(scope){ return poolFor(scope).filter(id=>{ const w=WMAP.get(id); return w&&w.synonyms&&w.synonyms.length; }); }
function renderSynQuiz(){ synq=null; $("#synqSetup").classList.remove("hidden"); $("#synqPlay").classList.add("hidden"); }
function startSynQuiz(){
  const pool=synPool($("#synqScope").value);
  if(pool.length<4){ toast("이 범위에 동의어 단어가 부족해요. 범위를 넓혀보세요."); return; }
  synq={pool, count:0, correct:0, added:0, learn:$("#synqLearn").checked, auto:$("#synqAuto").checked, history:[], pos:-1};
  $("#synqSetup").classList.add("hidden"); $("#synqPlay").classList.remove("hidden"); newSynQ();
}
function synBuildQ(){
  const s=synq; const id=s.pool[Math.random()*s.pool.length|0], w=WMAP.get(id); if(!w) return null;
  const correct=wkPickCorrect(w); if(!correct) return null;
  const dist=wkDistractors(w,correct,4); if(!dist) return null;   // 의미 이웃 차단·품사 일치 (보기 5개)
  return {id, opts:shuffle([{t:correct,ok:1,gloss:w.kor||""},...dist.map(d=>({t:d.t,ok:0,gloss:d.kor}))]), chosen:null, added:false};
}
function newSynQ(){ const s=synq; if(!s) return; let q=null,tries=0; while(!q&&tries++<15) q=synBuildQ(); if(!q) return;
  s.history.push(q); if(s.history.length>60) s.history.shift(); s.pos=s.history.length-1; renderSynAt(); }
function answerSynQ(i){
  const s=synq, q=s.history[s.pos]; if(!q||q.chosen!=null) return; q.chosen=i;
  const w=WMAP.get(q.id), ok=q.opts[i].ok;
  s.count++; if(ok) s.correct++;
  bumpDay({studied:1,correct:ok?1:0}); recordSecAcc("WK",ok);
  if(!ok){ state.wrong.wk[q.id]=(state.wrong.wk[q.id]||0)+1; markForReview(q.id); s.added++; q.added=true; } // 틀리면 오답노트 누적 + 복습 자동 추가
  else delete state.wrong.wk[q.id];   // 맞히면 오답노트에서 제거 (recordResult와 동일 규약)
  { const o=state.weak.wkTier[tierOf(w)]||(state.weak.wkTier[tierOf(w)]={c:0,w:0}); if(ok)o.c++; else o.w++; }
  saveLocal(); renderSynAt();
  // 자동 넘김 옵션(기본 OFF): 최신 문제일 때만 자동으로 새 문제
  if(s.auto){ setTimeout(()=>{ if(synq && synq.pos===synq.history.length-1) newSynQ(); }, ok?900:1800); }
}
// 히스토리 위치(pos)의 문제를 렌더 — 답 전엔 인터랙티브, 답 후엔 정답 공개+이전/다음 네비.
function renderSynAt(){
  const s=synq; if(!s||!s.history.length) return;
  const q=s.history[s.pos], w=WMAP.get(q.id); if(!w) return;
  const answered=q.chosen!=null, isPast=s.pos<s.history.length-1;
  const st=getCard(q.id).status, unknown=(st==="new"||st==="learning");
  const hint=(s.learn&&unknown&&w.kor&&!answered)?`<div class="synq-hint">💡 뜻: ${esc(w.kor)} <span class="muted">— 뜻에 맞는 동의어를 고르세요</span></div>`:"";
  const posLabel=s.history.length>1?`<span class="muted" style="font-size:11px"> · ${s.pos+1}/${s.history.length}${isPast?" · 지난 문제 다시보기":""}</span>`:"";
  $("#synqScore").textContent=`${s.correct} / ${s.count}${s.count?` · ${Math.round(s.correct/s.count*100)}%`:""}${s.added?` · 📇${s.added}`:""}`;
  const choicesHTML=q.opts.map((o,i)=>{ let cls=""; if(answered){ if(o.ok) cls="correct"; else if(i===q.chosen) cls="wrong"; }
    // 답한 뒤엔 보기 4개의 뜻을 함께 표시 → 다른 단어들도 무슨 뜻인지 학습.
    const gl = answered && o.gloss ? `<span class="opt-gloss">${esc(o.gloss)}</span>` : "";
    return `<button class="choice ${cls}" data-i="${i}" ${answered?"disabled":""}>${esc(o.t)}${gl}</button>`; }).join("");
  const ok=answered?q.opts[q.chosen].ok:null;
  const explain=answered?`<div class="ana-explain"><b>${ok?"✅ 정답":"❌ 오답"}</b> · <b>${esc(w.word)}</b> = ${esc(w.kor||"")}${(w.synonyms&&w.synonyms.length)?`<br><span class="muted">동의어: ${esc(w.synonyms.slice(0,5).join(", "))}</span>`:""}${q.added?`<br><span style="color:var(--brand2)">📇 플래시카드 복습에 추가됨</span>`:""}</div>`:"";
  const prevBtn=s.pos>0?`<button class="btn ghost" id="synqPrev" style="flex:1">← 이전</button>`:`<span style="flex:1"></span>`;
  const nextBtn=answered?`<button class="btn primary" id="synqNext" style="flex:1">${isPast?"다음 →":"새 문제 →"}</button>`:(isPast?`<button class="btn primary" id="synqNext" style="flex:1">다음 →</button>`:`<span style="flex:1"></span>`);
  const nav=`<div class="row" style="gap:8px;margin-top:12px">${prevBtn}${nextBtn}</div>`;
  $("#synqArea").innerHTML=`<div class="card">
    <div class="q-prompt">가장 비슷한 뜻은?${posLabel}</div>
    <div class="word-row"><div class="q-word" style="${wordFont(w.word,26)}">${esc(w.word)}</div>${spkBtn(w.word)}</div>
    ${hint}
    <div class="choices" id="synqChoices">${choicesHTML}</div>
    ${explain}${nav}</div>`;
  wireSpeakers($("#synqArea"));
  if(!answered){ $$("#synqChoices .choice").forEach(btn=>btn.onclick=()=>answerSynQ(+btn.dataset.i)); }
  if($("#synqPrev")) $("#synqPrev").onclick=()=>{ if(s.pos>0){ s.pos--; renderSynAt(); } };
  if($("#synqNext")) $("#synqNext").onclick=()=>{ if(s.pos<s.history.length-1){ s.pos++; renderSynAt(); } else { newSynQ(); } };
}

// 보기 선택형 화면(동의어 퀴즈·시험)의 키보드 조작.
// 1~9 로 보기 선택, ←/→ 로 이동, Enter/Space 로 '다음'.
// e.code 기준이라 한글 입력 상태에서도 그대로 동작한다.
function wireChoiceKeys(){
  document.addEventListener("keydown",e=>{
    const t=e.target;
    if(t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.tagName==="SELECT"||t.isContentEditable)) return;
    if(e.metaKey||e.ctrlKey||e.altKey) return;
    const vis=id=>{ const v=$(id); return v&&getComputedStyle(v).display!=="none"; };
    let box=null,next=null,prev=null;
    if(vis("#view-synq")&&typeof synq!=="undefined"&&synq&&$("#synqChoices")){
      box=$("#synqChoices"); next=$("#synqNext"); prev=$("#synqPrev");
    } else if(vis("#view-exam")&&exam&&!exam.submitted&&$("#examChoices")){
      box=$("#examChoices"); next=$("#drillNext")||$("#examNext"); prev=$("#examPrev");
    } else return;
    const c=e.code;
    const dig=/^(Digit|Numpad)([1-9])$/.exec(c);
    if(dig){ const b=[...box.querySelectorAll(".choice")][+dig[2]-1];
      if(b&&!b.disabled){ e.preventDefault(); b.click(); } return; }
    if(c==="Enter"||c==="NumpadEnter"||c==="Space"||c==="ArrowRight"){
      if(next&&!next.disabled){ e.preventDefault(); next.click(); } return; }
    if(c==="ArrowLeft"){ if(prev&&!prev.disabled){ e.preventDefault(); prev.click(); } return; }
  });
}

/* ============================================================
   WORD LIST
   ============================================================ */
let wordFilter="all", wordSearch="", wordRows=[], wordShown=0, wordPumping=false;
const WORD_PAGE=120;   // 무한 스크롤: 한 번에 이어 붙이는 개수
function wordMatches(w){
  const c=getCard(w.id);
  if(wordFilter==="starred"&&!c.starred) return false;
  if(wordFilter==="afoqt"&&!w.afoqtCommon) return false;
  if(wordFilter==="mock"&&!(w.mock&&w.mock.length)) return false;
  if(wordFilter==="wrong"&&!state.wrong.wk[w.id]) return false;
  if(wordFilter==="high"&&tierOf(w)==="std") return false;
  if(wordFilter==="gre"&&w.source!=="gre-magoosh") return false;
  if(["new","learning","review","mastered"].includes(wordFilter)&&c.status!==wordFilter) return false;
  if(wordSearch){ const q=wordSearch.toLowerCase();
    if(!(w.word.toLowerCase().includes(q)||(w.kor||"").includes(wordSearch)||(w.def||"").toLowerCase().includes(q))) return false; }
  return true;
}
// 모의고사 단어 배지 — w.mock 은 그 단어가 출제된 폼 id 목록
function mockBadge(w){ return (w.mock&&w.mock.length)?` <span title="모의고사 출제: ${esc(w.mock.join(", "))}">📕</span>`:""; }
function wordRowHTML(w){ const c=getCard(w.id);
  const lbl={new:"미학습",learning:"학습중",review:"복습",mastered:"마스터"}[c.status];
  return `<div class="witem" data-id="${w.id}"><div style="min-width:0">
      <div class="w">${esc(w.word)}${c.starred?' <span style="color:var(--gold)">★</span>':''}${mockBadge(w)}${w.source==="gre-magoosh"?'<span class="src">GRE</span>':''}${tierOf(w)==="high"?' ⭐':''}</div>
      <div class="k">${esc(w.kor||w.def||"")}</div></div><span class="tag ${c.status}">${lbl}</span></div>`; }
function appendWords(n){
  const box=$("#wordList"); if(!box) return;
  const slice=wordRows.slice(wordShown,wordShown+n);
  if(slice.length){ box.insertAdjacentHTML("beforeend",slice.map(wordRowHTML).join("")); wordShown+=slice.length; }
  const s=$("#wordMore"); if(!s) return;
  const left=wordRows.length-wordShown;
  s.style.display=left>0?"":"none";
  s.textContent=left>0?`⌄ 더 보기 (${left}개 남음)`:"";
}
// 센티널이 화면 아래 400px 안에 들어오면 다음 묶음을 붙인다(스크롤/리사이즈에서 호출).
function pumpWords(){
  const v=$("#view-words"); if(!v||!v.classList.contains("active")) return;   // 다른 화면 스크롤에 숨은 목록이 자라는 것 방지
  const s=$("#wordMore"); if(!s||wordShown>=wordRows.length) return;
  if(s.getBoundingClientRect().top < window.innerHeight+400){
    appendWords(WORD_PAGE);
    if(!wordPumping){ wordPumping=true; requestAnimationFrame(()=>{ wordPumping=false; pumpWords(); }); }
  }
}
function renderWords(keep){
  const prev=keep?wordShown:0;
  wordRows=WORDS.filter(wordMatches);
  const cnt=$("#wordCount");
  if(cnt) cnt.textContent=wordFilter==="mock"
    ? `${wordRows.length}개 · 모의고사 6회분에 실제 출제된 단어`
    : `${wordRows.length}개`;
  const box=$("#wordList"); if(!box) return;
  box.innerHTML=""; wordShown=0;
  box.onclick=e=>{ const el=e.target.closest(".witem"); if(el) showWord(+el.dataset.id); };
  appendWords(Math.max(WORD_PAGE,prev));
  pumpWords();
  const sbtn=$("#wordStudy");
  if(sbtn){ sbtn.classList.toggle("hidden", wordRows.length===0);
    sbtn.textContent=`▶︎ 이 ${wordRows.length}개로 플래시카드`;
    sbtn.onclick=()=>startStudySet(wordRows.map(w=>w.id), wordFilter==="mock"?"모의고사 단어":"단어장 선택"); }
}
function showWord(id){ const w=WMAP.get(id),c=getCard(id);
  const syn=(w.synonyms||[]).map(x=>`<span>${esc(x)}</span>`).join("");
  const ana=(w.analogyRelations||[]).map(esc).join("<br>");
  openSheet(`<div class="row" style="justify-content:space-between;align-items:flex-start">
      <div class="word-row" style="justify-content:flex-start"><h3 style="font-size:26px">${esc(w.word)}</h3>${spkBtn(w.word)}</div><button class="btn sm ghost" id="wstar">${c.starred?'★':'☆'}</button></div>
    <div style="color:var(--brand2);font-size:12px;text-transform:uppercase">${esc(w.pos||"")}${w.source==="gre-magoosh"?" · GRE Magoosh":""}${tierOf(w)==="high"?" · ⭐빈출":""}</div>
    ${(w.mock&&w.mock.length)?`<div class="hintbox" style="margin-top:8px;font-size:11px">📕 모의고사 출제 단어 — ${esc(w.mock.join(", "))} 단어시험에 실제로 나온 단어입니다.</div>`:""}
    ${w.afoqtCommon?`<div class="hintbox" style="margin-top:8px;font-size:11px">⭐ AFOQT 빈출 단어 — Quizlet·Barron's·커뮤니티 AFOQT 단어 목록에 등재된 단어입니다.</div>`:""}
    <div style="font-size:20px;font-weight:700;margin-top:10px">${esc(w.kor||"")}</div>
    <div class="muted" style="margin-top:6px;line-height:1.5">${esc(w.def||"")}</div>
    ${rootsHTML(w)}
    ${w.example?`<div style="font-style:italic;border-left:3px solid var(--brand);padding-left:10px;margin-top:12px;color:#cbd5e1">"${esc(w.example)}" ${spkBtn(w.example)}</div>`:""}
    ${syn?`<h2 class="section">동의어</h2><div class="syn" style="display:flex;flex-wrap:wrap;gap:6px">${syn}</div>`:""}
    ${ana?`<h2 class="section">유추 관계</h2><div style="font-family:ui-monospace,monospace;font-size:12px;color:var(--muted);line-height:1.7">${ana}</div>`:""}
    <button class="btn ghost" id="wclose" style="margin-top:20px">닫기</button>`);
  $("#wstar").onclick=()=>{ toggleStar(id); showWord(id); renderWords(true); }; $("#wclose").onclick=closeSheet;
  wireSpeakers($("#genericSheetBody"));
}

/* ============================================================
   ROOTS (어원 학습)
   ============================================================ */
let rootFilter="all", rootSearch="";
function renderRoots(){
  const tn={prefix:"접두사",root:"어근",suffix:"접미사"};
  if(rootFilter==="words"){   // 단어에서 추출한 어근 색인 (교차 참조)
    if(!ROOTIDX) buildRootIndex();
    let ent=Object.entries(ROOTIDX).filter(([,v])=>v.ids.length>=2);
    if(rootSearch){ const q=rootSearch.toLowerCase();
      ent=ent.filter(([k,v])=>k.toLowerCase().includes(q)||String(v.m).toLowerCase().includes(q)||String(v.m).includes(rootSearch)); }
    ent.sort((a,b)=>b[1].ids.length-a[1].ids.length||a[0].localeCompare(b[0]));
    $("#rootsCount").textContent=`${ent.length}개 · 탭하면 그 어근 단어 전부`;
    $("#rootsList").innerHTML=ent.map(([k,v])=>{
      const ex=v.ids.slice(0,5).map(id=>WMAP.get(id)).filter(Boolean).map(w=>`<span>${esc(w.word)}</span>`).join("");
      return `<button class="root-card rtlink" data-root="${esc(k)}" style="width:100%;text-align:left">
        <div><span class="rf">${esc(k)}</span><span class="rt">${v.ids.length}개</span></div>
        <div class="rm">${esc(v.m||"")}</div><div class="rex">${ex}</div></button>`; }).join("")
      ||`<div class="card center muted" style="padding:14px">검색 결과가 없어요.</div>`;
    return;
  }
  let list=ROOTS.filter(r=>{
    if(rootFilter!=="all"&&r.type!==rootFilter) return false;
    if(rootSearch){ const q=rootSearch.toLowerCase();
      if(!(r.form.toLowerCase().includes(q)||r.meaning.includes(rootSearch)||r.meaning.toLowerCase().includes(q)||r.examples.some(e=>e.toLowerCase().includes(q)))) return false; }
    return true; });
  $("#rootsCount").textContent=`${list.length}개`;
  $("#rootsList").innerHTML=list.map(r=>`<div class="root-card">
    <div><span class="rf">${esc(r.form)}</span><span class="rt">${tn[r.type]||r.type}</span></div>
    <div class="rm">${esc(r.meaning)}</div>
    <div class="rex">${r.examples.map(e=>`<span>${esc(e)}</span>`).join("")}</div></div>`).join("")
    ||`<div class="card center muted" style="padding:14px">검색 결과가 없어요.</div>`;
}

/* ============================================================
   ROOT COACH (어근 추론 코치 — 단계별 가이드 학습)
   ============================================================ */
let coachStep=0;
// 'body'/'reason'/'explain' contain trusted inline HTML (<b>) authored in the
// lesson file, so they are inserted as-is; all word/option fields are escaped.
function renderRootCoach(){
  const L=ROOTLESSONS;
  if(!L.length){ $("#coachArea").innerHTML=`<div class="card center muted" style="padding:18px">콘텐츠를 불러오는 중…</div>`; return; }
  coachStep=clamp(state.rootStep||0,0,L.length-1);
  const s=L[coachStep], total=L.length;
  $("#coachCount").textContent=`${coachStep+1} / ${total}`;
  $("#coachBar").style.width=Math.round((coachStep+1)/total*100)+"%";
  let html="";
  if(s.kind==="teach"||s.kind==="theme"||s.kind==="caution"){
    html=`<div class="rc-card rc-${s.kind}"><div class="rc-ic">${s.icon||"📘"}</div>
      <h2 class="rc-title">${esc(s.title)}</h2><div class="rc-prose">${s.body||""}</div></div>`;
  } else if(s.kind==="root"){
    html=`<div class="rc-card rc-root">
      <div class="rc-tag">🔑 핵심 어근</div>
      <div class="rc-form">${esc(s.form)}</div>
      <div class="rc-mean">${esc(s.meaning)}</div>
      <div class="rc-hook">💡 ${esc(s.hook||"")}</div>
      <div class="rc-words">${(s.words||[]).map(w=>`<span>${esc(w)}</span>`).join("")}</div></div>`;
  } else if(s.kind==="worked"){
    // Guided but interactive: show the root breakdown as scaffolding, let the user
    // pick first, then reveal the answer + full reasoning (not pre-solved).
    html=`<div class="rc-card rc-worked">
      <div class="rc-tag">✍️ 같이 풀어보기</div>
      <div class="rc-word" style="${wordFont(s.word,24)}">${esc(s.word)}</div>
      <div class="rc-q">아래 어근 단서로 뜻을 추론해 골라봐</div>
      <div class="rc-break">${(s.breakdown||[]).map(b=>`<div class="rc-piece">🧩 ${esc(b)}</div>`).join("")}</div>
      <div class="rc-opts" id="coachOpts">${s.options.map((o,i)=>`<button class="rc-pick" data-i="${i}">${esc(o)}</button>`).join("")}</div>
      <div class="rc-explain hidden" id="coachExplain"></div></div>`;
  } else if(s.kind==="practice"){
    html=`<div class="rc-card rc-practice">
      <div class="rc-tag">🥷 직접 풀기</div>
      <div class="rc-word" style="${wordFont(s.word,24)}">${esc(s.word)}</div>
      <div class="rc-q">이 단어와 뜻이 가장 가까운 것은?</div>
      <div class="rc-opts" id="coachOpts">${s.options.map((o,i)=>`<button class="rc-pick" data-i="${i}">${esc(o)}</button>`).join("")}</div>
      <button class="btn ghost sm" id="coachHint" style="margin-top:12px">💡 어근 힌트</button>
      <div class="rc-hintbox hidden" id="coachHintBox">${esc(s.hint||"")}</div>
      <div class="rc-explain hidden" id="coachExplain"></div></div>`;
  }
  $("#coachArea").innerHTML=html;
  if(s.kind==="practice"||s.kind==="worked"){
    if($("#coachHint")) $("#coachHint").onclick=()=>$("#coachHintBox").classList.toggle("hidden");
    $$("#coachOpts .rc-pick").forEach(b=>b.onclick=()=>{
      const i=+b.dataset.i, ok=i===s.answer;
      $$("#coachOpts .rc-pick").forEach((x,xi)=>{ x.disabled=true;
        if(xi===s.answer) x.classList.add("ok"); else if(xi===i) x.classList.add("no"); });
      if($("#coachHintBox")) $("#coachHintBox").classList.remove("hidden");
      const ex=$("#coachExplain"); ex.classList.remove("hidden");
      // worked steps reveal gloss + full reasoning; practice steps reveal the short explain
      const body = s.kind==="worked" ? `${s.gloss?`<b>${esc(s.gloss)}</b> · `:""}${s.reason||""}` : esc(s.explain||"");
      ex.innerHTML=`<b>${ok?"⭕ 정답!":"❌ 아쉬워"}</b> ${body}`;
    });
  }
  $("#coachPrev").disabled=coachStep===0;
  $("#coachNext").textContent=coachStep>=total-1?"완료 🎉":"다음 ▶";
  window.scrollTo(0,0);
}
function coachGo(d){
  const total=ROOTLESSONS.length; if(!total) return;
  if(d>0 && coachStep>=total-1){ state.rootStep=0; saveLocal(); toast("어근 코스 완료! 🎉 매일 단어 복습에 어근 5개씩 얹어봐"); go("vocab"); return; }
  state.rootStep=clamp(coachStep+d,0,total-1); saveLocal(); renderRootCoach();
}

/* ============================================================
   AVIATION (Pilot — Aviation Information)
   ============================================================ */
const AVCAT={aerodynamics:"공기역학",control_surfaces:"조종면",instruments:"계기",structure:"구조",airport:"공항",helicopter:"헬기",general:"일반",stability:"안정성",propulsion:"추진",forces:"힘·법칙",terminology:"용어",maneuvers:"기동",navigation:"항법",airspace:"공역",airport_ops:"공항",weather:"기상",engines:"엔진",bernoulli:"베르누이",traffic_pattern:"장주",airspeed:"속도",faa_basics:"FAA 기초",airport_markings:"공항 표지",fixed_wing_parts:"고정익 구조",weight_balance:"무게·균형",four_forces:"4가지 힘",angle_of_attack:"받음각",drag:"항력",propeller:"프로펠러"};
// aviation question topic -> Korean label (falls back to AVCAT, then raw)
function avTopicKo(t){ return AVCAT[t]||t; }
function renderAviation(){
  $("#avTerms").textContent=AVTERMS.length;
  $("#avQs").textContent=AVIATION.length;
  $("#avExam").disabled=!AVIATION.length;
  $("#avFlash").disabled=!AVTERMS.length;
}
let avtFilter="all", avtSearch="";
function renderAvTerms(){
  let list=AVTERMS.filter(t=>{
    if(avtFilter!=="all"&&t.category!==avtFilter) return false;
    if(avtSearch){ const q=avtSearch.toLowerCase();
      if(!((t.term||"").toLowerCase().includes(q)||(t.ko||"").includes(avtSearch)||(t.def_ko||"").includes(avtSearch)||(t.def||"").toLowerCase().includes(q))) return false; }
    return true; });
  $("#avtCount").textContent=`${list.length}개`;
  $("#avtList").innerHTML=list.map(t=>`<div class="avterm">
    <div class="t">${esc(t.term)}</div><div class="ko">${esc(t.ko||"")}</div>
    <div class="d">${esc(t.def_ko||"")}</div><div class="de">${esc(t.def||"")}</div>
    <span class="cat">${AVCAT[t.category]||t.category}</span></div>`).join("")
    ||`<div class="card center muted" style="padding:14px">검색 결과가 없어요.</div>`;
}
// 항공 문제 훑어보기 — 시험(시간측정) 대신, 문제+정답+해설을 펼쳐놓고 편하게 스크롤.
let avsFilter="all", avsSearch="";
function renderAvStudy(){
  const list=AVIATION.filter(x=>{
    if(avsFilter!=="all"&&x.topic!==avsFilter) return false;
    if(avsSearch){ const q=avsSearch.toLowerCase();
      if(!((x.q||"").toLowerCase().includes(q)||(x.q_ko||"").includes(avsSearch)||(x.explain||"").includes(avsSearch))) return false; }
    return true; });
  $("#avsCount").textContent=`${list.length}개`;
  $("#avsList").innerHTML=list.map(x=>{
    const opts=(x.options||[]).map((o,i)=>`<div class="ro ${i===x.answer?"ok":""}">${i===x.answer?"✓ ":""}${fmtMath(o)}</div>`).join("");
    return `<div class="review-q">
      <div class="rh">${esc(avTopicKo(x.topic))}</div>
      <div style="font-weight:600;margin-bottom:4px">${fmtMath(x.q)}</div>
      ${(x.q_ko&&!flag("hide_ko"))?`<div class="muted" style="font-size:13px;margin-bottom:6px">${fmtMath(x.q_ko)}</div>`:""}
      ${opts}
      ${x.explain?`<div class="rx">${fmtMath(x.explain)}</div>`:""}</div>`;
  }).join("")||`<div class="card center muted" style="padding:14px">검색 결과가 없어요.</div>`;
}
// 항공 교재 읽기 — PDF에서 정리한 지식을 챕터별 책 형태로 읽기.
let avBookCh=null;
function renderAvBook(){
  if(avBookCh==null||!AVBOOK.length){  // table of contents
    $("#avbTitle").textContent="📚 항공 교재";
    $("#avbBack").textContent="← 항공"; $("#avbBack").onclick=()=>go("aviation");
    if(!AVBOOK.length){ $("#avbBody").innerHTML=`<div class="card center muted" style="padding:20px">교재 준비 중이에요.</div>`; return; }
    $("#avbBody").innerHTML=`<p class="muted" style="margin:0 0 12px;font-size:13px">업로드한 PDF 교재에서 정리한 항공 지식을 책처럼 읽어보세요. 챕터를 고르면 됩니다.</p>`+
      AVBOOK.map(c=>`<button class="book-toc" data-ch="${c.id}"><span class="tt">${esc(c.title)}</span><span class="muted">${c.sections.length}절 ›</span></button>`).join("");
    $$(".book-toc").forEach(b=>b.onclick=()=>{ avBookCh=+b.dataset.ch; window.scrollTo(0,0); renderAvBook(); });
    return;
  }
  const idx=AVBOOK.findIndex(x=>x.id===avBookCh), c=AVBOOK[idx]||AVBOOK[0];
  $("#avbTitle").textContent=`${idx+1}/${AVBOOK.length}`;
  $("#avbBack").textContent="← 목차"; $("#avbBack").onclick=()=>{ avBookCh=null; window.scrollTo(0,0); renderAvBook(); };
  const prev=idx>0?AVBOOK[idx-1]:null, next=idx<AVBOOK.length-1?AVBOOK[idx+1]:null;
  $("#avbBody").innerHTML=
    `<h2 class="book-title">${esc(c.title)}</h2>`+
    (c.intro?`<div class="book-intro">${fmtMath(c.intro)}</div>`:"")+
    c.sections.map(s=>`<div class="book-sec"><h3>${esc(s.h)}</h3>${String(s.body||"").split(/\n+/).filter(Boolean).map(p=>`<p>${fmtMath(p)}</p>`).join("")}</div>`).join("")+
    `<div class="book-nav">
      ${prev?`<button class="btn ghost sm" id="bkPrev">← ${esc(prev.title.replace(/^\d+\.\s*/,""))}</button>`:"<span></span>"}
      ${next?`<button class="btn primary sm" id="bkNext">${esc(next.title.replace(/^\d+\.\s*/,""))} →</button>`:"<span></span>"}
    </div>
    <button class="btn ghost" id="bkToc" style="margin-top:10px">📚 목차로</button>`;
  if(prev) $("#bkPrev").onclick=()=>{ avBookCh=prev.id; window.scrollTo(0,0); renderAvBook(); };
  if(next) $("#bkNext").onclick=()=>{ avBookCh=next.id; window.scrollTo(0,0); renderAvBook(); };
  $("#bkToc").onclick=()=>{ avBookCh=null; window.scrollTo(0,0); renderAvBook(); };
}
let avf=null;
function startAvFlash(){
  if(!AVTERMS.length) return;
  avf={items:shuffle(AVTERMS),idx:0,flipped:false};
  renderAvFlash();
}
function renderAvFlash(){
  const s=avf; if(!s) return; const t=s.items[s.idx];
  $("#avfCount").textContent=`${s.idx+1} / ${s.items.length}`;
  $("#avfBar").style.width=(s.idx/s.items.length*100)+"%";
  $("#avfArea").innerHTML=`<div class="avflash" id="avfCard">
      ${s.flipped
        ? `<div class="fko">${esc(t.ko||"")}</div><div class="fd">${esc(t.def_ko||"")}</div><div class="fde">${esc(t.def||"")}</div><div class="fc">👆 탭 → 다음</div>`
        : `<div class="ft">${esc(t.term)}</div><div class="fc">👆 탭하면 뜻 보기</div>`}
    </div>
    <div class="exam-nav"><button class="btn ghost" id="avfPrev">← 이전</button><button class="btn primary" id="avfNext">다음 →</button></div>`;
  $("#avfCard").onclick=()=>{ if(!s.flipped){ s.flipped=true; renderAvFlash(); } else { avfNext(); } };
  $("#avfNext").onclick=avfNext;
  $("#avfPrev").onclick=()=>{ if(s.idx>0){ s.idx--; s.flipped=false; renderAvFlash(); } };
}
function avfNext(){ const s=avf; if(s.idx<s.items.length-1){ s.idx++; s.flipped=false; renderAvFlash(); } else { toast("용어 카드 끝! 🎉"); go("aviation"); } }

/* ============================================================
   TABLE READING (Pilot subtest — procedural)
   ============================================================ */
let trState=null;
function startTableReading(){
  const xs=[]; for(let x=-5;x<=5;x++) xs.push(x);
  const ys=[]; for(let y=5;y>=-5;y--) ys.push(y);
  const grid=ys.map(()=>xs.map(()=>10+(Math.random()*90|0)));
  const N=20, secs=210, qs=[];
  for(let i=0;i<N;i++){
    const xi=Math.random()*xs.length|0, yi=Math.random()*ys.length|0, correct=grid[yi][xi];
    const opts=new Set([correct]); let g=0;
    while(opts.size<5&&g++<60){ let v;
      if(Math.random()<0.6){ const ny=clamp(yi+(Math.random()<.5?-1:1),0,ys.length-1), nx=clamp(xi+(Math.random()<.5?-1:1),0,xs.length-1); v=grid[ny][nx]; }
      else v=10+(Math.random()*90|0); opts.add(v); }
    while(opts.size<5) opts.add(10+(Math.random()*90|0));
    qs.push({x:xs[xi],y:ys[yi],correct,options:shuffle([...opts])});
  }
  trTimerStop();   // 이전 세션 타이머를 state 교체 전에 정지(orphan 방지)
  trState={xs,ys,grid,N,secs,secsLeft:secs,idx:0,score:0,timer:null,answered:false,qs};
  $$(".view").forEach(v=>v.classList.remove("active")); $("#view-tablereading").classList.add("active");
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go==="aviation")); window.scrollTo(0,0);
  $("#trResult").classList.add("hidden"); $("#trTable").innerHTML=trTableHTML();
  trTimerStart(); renderTRQ();
}
function trTableHTML(){ const s=trState;
  let h='<div class="tr-wrap"><table class="tr-tbl"><thead><tr><th class="tr-corner">Y\\X</th>';
  s.xs.forEach(x=>h+=`<th>${x}</th>`); h+='</tr></thead><tbody>';
  s.ys.forEach((y,yi)=>{ h+=`<tr><th>${y}</th>`; s.grid[yi].forEach(v=>h+=`<td>${v}</td>`); h+='</tr>'; });
  return h+'</tbody></table></div>';
}
function trTimerStart(){ trTimerStop(); $("#trTimer").textContent=fmtTime(trState.secsLeft);
  trState.timer=setInterval(()=>{ if(!trState) return trTimerStop(); trState.secsLeft--; const t=$("#trTimer");
    if(t){ t.textContent=fmtTime(trState.secsLeft); t.classList.toggle("warn",trState.secsLeft<=15); }
    if(trState.secsLeft<=0) finishTR(); },1000); }
function trTimerStop(){ if(trState&&trState.timer){ clearInterval(trState.timer); trState.timer=null; } }
function renderTRQ(){ const s=trState; if(!s) return; if(s.idx>=s.N) return finishTR();
  const q=s.qs[s.idx]; s.answered=false;
  $("#trCount").textContent=`${s.idx+1} / ${s.N}`; $("#trBar").style.width=(s.idx/s.N*100)+"%";
  $("#trQ").innerHTML=`<div class="tr-q"><div class="tr-coord">X = <b>${q.x}</b> , Y = <b>${q.y}</b> 의 값은?</div>
    <div class="tr-opts">${q.options.map(o=>`<button data-v="${o}">${o}</button>`).join("")}</div></div>`;
  $$("#trQ .tr-opts button").forEach(btn=>btn.onclick=()=>{ if(s.answered) return; s.answered=true;
    const v=+btn.dataset.v, ok=v===q.correct;
    $$("#trQ .tr-opts button").forEach(b=>{ b.disabled=true; if(+b.dataset.v===q.correct) b.classList.add("correct"); else if(b===btn) b.classList.add("wrong"); });
    if(ok) s.score++; bumpDay({studied:1,correct:ok?1:0}); recordSecAcc("TR",ok);
    setTimeout(()=>{ if(trState){ s.idx++; renderTRQ(); } }, ok?320:750); });
}
function finishTR(){ const s=trState; if(!s) return; trTimerStop();
  $("#trQ").innerHTML=""; $("#trBar").style.width="100%";
  const pct=Math.round(s.score/s.N*100);
  $("#trEmoji").textContent=pct>=85?"🏆":pct>=60?"📊":"📈";
  $("#trScore").textContent=`${s.score} / ${s.N} 정답 (${pct}%)`;
  $("#trSub").textContent=`소요 ${fmtTime(s.secs-Math.max(0,s.secsLeft))} · 실제 시험: 40문항 7분`;
  $("#trResult").classList.remove("hidden");
}

/* ============================================================
   BLOCK COUNTING (Pilot subtest — procedural, isometric SVG)
   ============================================================ */
let bcState=null;
// 등축 투영에서 타깃 블록의 윗면이 뒤에 그려지는 블록들에 가려지지 않는지 기하학적으로 판정.
// (그리기 순서: x+y 오름차순, 같으면 z 오름차순 → 뒤에 그려질수록 위에 덮인다)
function bcTopVisible(blocks,t){
  const tw=38,th=19,vh=26;
  const proj=(x,y,z)=>[(x-y)*(tw/2),(x+y)*(th/2)-z*vh];
  const [tx,ty,tz]=t, [sx,sy]=proj(tx,ty,tz);
  // 타깃 윗면(마름모) 내부 샘플점: 중심 + 주변
  const pts=[];
  for(const [u,v] of [[0,0],[.5,0],[-.5,0],[0,.5],[0,-.5],[.35,.35],[-.35,.35],[.35,-.35],[-.35,-.35]])
    pts.push([sx+u*(tw/2), sy+th/2+v*(th/2)]);
  const inPoly=(px,py,poly)=>{ let c=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const [xi,yi]=poly[i],[xj,yj]=poly[j];
      if(((yi>py)!==(yj>py)) && (px < (xj-xi)*(py-yi)/(yj-yi)+xi)) c=!c; } return c; };
  for(const [x,y,z] of blocks){
    if(x===tx&&y===ty&&z===tz) continue;
    const after=((x+y)>(tx+ty)) || ((x+y)===(tx+ty)&&z>tz);   // 타깃보다 나중에(위에) 그려지는 것만
    if(!after) continue;
    const [ax,ay]=proj(x,y,z);
    const top=[[ax,ay],[ax+tw/2,ay+th/2],[ax,ay+th],[ax-tw/2,ay+th/2]];
    const left=[[ax-tw/2,ay+th/2],[ax,ay+th],[ax,ay+th+vh],[ax-tw/2,ay+th/2+vh]];
    const right=[[ax,ay+th],[ax+tw/2,ay+th/2],[ax+tw/2,ay+th/2+vh],[ax,ay+th+vh]];
    for(const [px,py] of pts)
      if(inPoly(px,py,top)||inPoly(px,py,left)||inPoly(px,py,right)) return false;
  }
  return true;
}
function genBlockFigure(){
  // ── 발자국(footprint) 패턴 ──────────────────────────────
  const W=2+(Math.random()*4|0), D=2+(Math.random()*3|0);   // 2~5 × 2~4
  const shape=["rect","rect","L","T","plus","diag"][Math.random()*6|0];
  const cx=(W-1)/2, cy=(D-1)/2, foot=[];
  for(let x=0;x<W;x++)for(let y=0;y<D;y++){
    let keep=true;
    if(shape==="L")    keep=(x<Math.ceil(W/2))||(y<Math.ceil(D/2));
    else if(shape==="T")keep=(y===0)||(Math.abs(x-cx)<=0.5);
    else if(shape==="plus")keep=(Math.abs(x-cx)<=0.5)||(Math.abs(y-cy)<=0.5);
    else if(shape==="diag")keep=(x+y)%3!==2;
    if(keep) foot.push([x,y]);
  }
  if(foot.length<3) return genBlockFigure();
  // ── 높이 패턴 ──────────────────────────────────────────
  const hp=["random","stair","pyramid","flat","tower"][Math.random()*5|0];
  const maxH=2+(Math.random()*3|0);   // 2~4
  const heights={};
  for(const [x,y] of foot){
    let h;
    if(hp==="stair")        h=1+Math.min(maxH-1, x);
    else if(hp==="pyramid") h=Math.max(1, maxH-Math.round(Math.abs(x-cx)+Math.abs(y-cy)));
    else if(hp==="flat")    h=1+(Math.random()<0.25?1:0);
    else if(hp==="tower")   h=(Math.abs(x-cx)<=0.5&&Math.abs(y-cy)<=0.5)?maxH:1;
    else                    h=1+(Math.random()*maxH|0);
    heights[x+","+y]=Math.max(0,Math.min(4,h));
  }
  const set=new Set(), blocks=[];
  for(const k in heights){ const [x,y]=k.split(",").map(Number);
    for(let z=0;z<heights[k];z++){ set.add(x+","+y+","+z); blocks.push([x,y,z]); } }
  if(blocks.length<4) return genBlockFigure();
  // ── 타깃 선택: 윗면이 화면에서 실제로 안 가려지는 블록만 ──
  const cand=[];
  for(const k in heights){ const h=heights[k]; if(!h) continue;
    const [x,y]=k.split(",").map(Number), z=h-1;
    if(bcTopVisible(blocks,[x,y,z])) cand.push([x,y,z]); }
  if(!cand.length) return genBlockFigure();
  const target=cand[Math.random()*cand.length|0];
  const [tx,ty,tz]=target;
  let touch=0; [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].forEach(([dx,dy,dz])=>{ if(set.has((tx+dx)+","+(ty+dy)+","+(tz+dz))) touch++; });
  return {blocks,target,touch};
}
function bcOptions(correct){ let lo=correct<=2?0:(correct>=4?2:correct-2); const o=[]; for(let k=0;k<5;k++)o.push(lo+k); return o; }
function bcSVG(fig){
  const tw=38,th=19,vh=26;
  const order=[...fig.blocks].sort((a,b)=>((a[0]+a[1])-(b[0]+b[1]))||(a[2]-b[2]));
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9; const cubes=[];
  order.forEach(([x,y,z])=>{ const sx=(x-y)*(tw/2), sy=(x+y)*(th/2)-z*vh;
    const top=[[sx,sy],[sx+tw/2,sy+th/2],[sx,sy+th],[sx-tw/2,sy+th/2]];
    const left=[[sx-tw/2,sy+th/2],[sx,sy+th],[sx,sy+th+vh],[sx-tw/2,sy+th/2+vh]];
    const right=[[sx,sy+th],[sx+tw/2,sy+th/2],[sx+tw/2,sy+th/2+vh],[sx,sy+th+vh]];
    [...top,...left,...right].forEach(([px,py])=>{ minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py); });
    cubes.push({top,left,right,sx,sy,isT:x===fig.target[0]&&y===fig.target[1]&&z===fig.target[2]}); });
  const pad=10,ox=-minX+pad,oy=-minY+pad,W=(maxX-minX+pad*2),H=(maxY-minY+pad*2);
  const P=(pts,fill)=>`<polygon points="${pts.map(([x,y])=>`${(x+ox).toFixed(1)},${(y+oy).toFixed(1)}`).join(" ")}" fill="${fill}" stroke="#0f172a" stroke-width="1.2" stroke-linejoin="round"/>`;
  let svg=`<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg">`;
  let label="";
  cubes.forEach(c=>{ svg+=P(c.right,"#3f4c63")+P(c.left,"#566481")+P(c.top,c.isT?"#22d3ee":"#93a4bd");
    if(c.isT) label=`<text x="${(c.sx+ox).toFixed(1)}" y="${(c.sy+th/2+oy).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="800" fill="#0f172a">?</text>`; });
  return svg+label+'</svg>';   // 라벨은 항상 맨 위에
}
function startBlockCounting(){
  const N=10, secs=180, qs=[];
  for(let i=0;i<N;i++){ const f=genBlockFigure(); qs.push({fig:f,correct:f.touch,options:bcOptions(f.touch)}); }
  bcTimerStop();
  bcState={N,secs,secsLeft:secs,idx:0,score:0,timer:null,answered:false,qs};
  $$(".view").forEach(v=>v.classList.remove("active")); $("#view-blockcounting").classList.add("active");
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go==="aviation")); window.scrollTo(0,0);
  $("#bcResult").classList.add("hidden"); bcTimerStart(); renderBCQ();
}
function bcTimerStart(){ bcTimerStop(); $("#bcTimer").textContent=fmtTime(bcState.secsLeft);
  bcState.timer=setInterval(()=>{ if(!bcState) return bcTimerStop(); bcState.secsLeft--; const t=$("#bcTimer");
    if(t){ t.textContent=fmtTime(bcState.secsLeft); t.classList.toggle("warn",bcState.secsLeft<=15); }
    if(bcState.secsLeft<=0) finishBC(); },1000); }
function bcTimerStop(){ if(bcState&&bcState.timer){ clearInterval(bcState.timer); bcState.timer=null; } }
function renderBCQ(){ const s=bcState; if(!s) return; if(s.idx>=s.N) return finishBC();
  const q=s.qs[s.idx]; s.answered=false;
  $("#bcCount").textContent=`${s.idx+1} / ${s.N}`; $("#bcBar").style.width=(s.idx/s.N*100)+"%";
  $("#bcArea").innerHTML=`<div class="bc-fig">${bcSVG(q.fig)}</div>
    <div class="bc-q"><b>?</b> 블록(청록색)이 <b>닿는</b> 블록은 몇 개?</div>
    <div class="bc-opts">${q.options.map(o=>`<button data-v="${o}">${o}</button>`).join("")}</div>`;
  $$("#bcArea .bc-opts button").forEach(btn=>btn.onclick=()=>{ if(s.answered) return; s.answered=true;
    const v=+btn.dataset.v, ok=v===q.correct;
    $$("#bcArea .bc-opts button").forEach(b=>{ b.disabled=true; if(+b.dataset.v===q.correct) b.classList.add("correct"); else if(b===btn) b.classList.add("wrong"); });
    if(ok) s.score++; bumpDay({studied:1,correct:ok?1:0}); recordSecAcc("BC",ok);
    setTimeout(()=>{ if(bcState){ s.idx++; renderBCQ(); } }, ok?600:1100); });
}
function finishBC(){ const s=bcState; if(!s) return; bcTimerStop();
  $("#bcArea").innerHTML=""; $("#bcBar").style.width="100%";
  const pct=Math.round(s.score/s.N*100);
  $("#bcEmoji").textContent=pct>=80?"🏆":pct>=50?"🧱":"📈";
  $("#bcScore").textContent=`${s.score} / ${s.N} 정답 (${pct}%)`;
  $("#bcSub").textContent=`소요 ${fmtTime(s.secs-Math.max(0,s.secsLeft))} · 실제 시험: 30문항 4.5분 · 대각선은 닿는 게 아니에요`;
  $("#bcResult").classList.remove("hidden");
}

/* ============================================================
   CURRICULUM (커리큘럼 학습 — 기초 스킬부터 단계별, 통과해야 다음 단계)
   ============================================================ */
// Map an analogy relation label to a Korean relation category (for the
// classification drill). Order matters: specific combos before generic words.
function vaRelKo(rel){
  const r=String(rel||"").toLowerCase();
  if(r.includes("synonym")) return "동의어 (비슷한 말)";
  if(r.includes("antonym")) return "반의어 (반대말)";
  if(r.includes("young")||r.includes("adult")) return "새끼 : 성체";
  if(r.includes("degree")||r.includes("intensity")) return "정도 차이 (약함↔강함)";
  if(r.includes("part")&&r.includes("whole")) return "부분 : 전체";
  if(r.includes("container")) return "용기 : 내용물";
  if(r.includes("cause")||r.includes("effect")) return "원인 : 결과";
  if(r.includes("measure")) return "도구 : 측정";
  if(r.includes("workplace")||(r.includes("worker")&&r.includes("place"))) return "직업 : 일터";
  if(r.includes("worker")&&r.includes("product")) return "직업 : 결과물";
  if((r.includes("worker")&&r.includes("tool"))||(r.includes("tool")&&r.includes("worker"))) return "직업 : 도구";
  if(r.includes("function")) return "사물 : 기능";
  if(r.includes("source")||r.includes("material")) return "재료 : 제품";
  if(r.includes("example")||r.includes("category")) return "예시 : 범주";
  if(r.includes("sound")) return "동물 : 소리";
  if(r.includes("home")||r.includes("habitat")) return "동물 : 서식지";
  if(r.includes("group")||r.includes("member")) return "집단 : 구성원";
  if(r.includes("trait")||r.includes("person")) return "사람 : 특성";
  if(r.includes("place")&&r.includes("activity")) return "장소 : 활동";
  if(r.includes("symbol")||r.includes("meaning")) return "상징 : 의미";
  if(r.includes("begin")||r.includes("end")) return "시작 : 끝";
  if(r.includes("action")&&r.includes("object")) return "행동 : 대상";
  if(r.includes("characteristic")||r.includes("potential")) return "성질 : 가능성";
  return null;
}
const VA_EASY_CATS=new Set(["동의어 (비슷한 말)","반의어 (반대말)","새끼 : 성체","부분 : 전체","직업 : 도구","사물 : 기능","동물 : 소리","용기 : 내용물","원인 : 결과"]);
function vaCatPool(){ const set=new Set(); ANALOGIES.forEach(a=>{ const c=vaRelKo(a.relation); if(c) set.add(c); }); return [...set]; }

/* ----- stage item builders (all return {prompt,stem?,hint?,passage?,options,answer,explain,anaId?,wordId?,sec?}) ----- */
function buildVAClassify(n){
  const cats=vaCatPool();
  const cand=shuffle(ANALOGIES.filter(a=>vaRelKo(a.relation)));
  const out=[];
  for(const a of cand){ if(out.length>=n) break;
    const cat=vaRelKo(a.relation);
    const opts=shuffle([cat,...sample(cats.filter(c=>c!==cat),3)]);
    out.push({prompt:"두 단어는 어떤 관계일까요?",stem:a.question,options:opts,answer:opts.indexOf(cat),
      explain:`${a.question} = ${cat} (${a.relation}). ${a.explain||""}`});
  }
  return out;
}
function buildVACurrStage(withHint,n){
  let pool=ANALOGIES.filter(a=>vaRelKo(a.relation));
  if(withHint) pool=pool.filter(a=>VA_EASY_CATS.has(vaRelKo(a.relation)));
  const out=shuffle(pool).slice(0,n).map(a=>{
    const opts=shuffle(a.options.map(o=>({t:`${o.pair[0]} : ${o.pair[1]}`,c:!!o.correct})));
    return {prompt:"같은 관계의 짝을 고르세요",stem:a.question,
      hint:withHint?`힌트: ${vaRelKo(a.relation)}`:null, anaId:a.id, sec:"VA",
      options:opts.map(o=>o.t),answer:opts.findIndex(o=>o.c),
      explain:`관계: ${a.relation} — ${a.explain||""}`};
  });
  return out;
}
// Meaning key = the English gloss in parens (e.g. "이전의 (before)" -> "before"),
// so prefixes that share a meaning (ante-/pre-, anti-/contra-/ob-, ...) never
// appear as two different-looking options for the same question.
function rootKey(m){ const g=/\(([^)]+)\)/.exec(m||""); return (g?g[1]:(m||"")).trim().toLowerCase(); }
function buildWKRootsQ(n){
  if(ROOTS.length<8) return [];
  const out=[];
  for(const r of shuffle(ROOTS)){
    if(out.length>=n) break;
    const ck=rootKey(r.meaning), used=new Set([ck]), dist=[];
    for(const x of shuffle(ROOTS)){ if(dist.length>=3) break; if(x.form===r.form) continue;
      const k=rootKey(x.meaning); if(used.has(k)) continue; used.add(k); dist.push(x.meaning); }
    if(dist.length<3) continue;
    const opts=shuffle([r.meaning,...dist]);
    out.push({prompt:"이 어원(접두사·어근)의 뜻은?",stem:r.form,options:opts,answer:opts.indexOf(r.meaning),
      explain:`${r.form} = ${r.meaning} · 예: ${(r.examples||[]).slice(0,3).join(", ")}`});
  }
  return out;
}
function buildWKSynCurr(n){
  const pool=WORDS.filter(w=>w.afoqtCommon&&w.synonyms&&w.synonyms.length);
  const out=[];
  for(const w of shuffle(pool)){ if(out.length>=n) break;
    const it=buildWKfor(w); if(!it) continue;
    out.push({prompt:"의미가 가장 가까운 단어는?",stem:it.stem,options:it.options,answer:it.answer,
      wordId:w.id, sec:"WK", explain:it.explain});
  }
  return out;
}
function buildRCType(types,n){
  const out=[];
  for(const p of shuffle(rcPracticePool())){ if(out.length>=n) break;
    const qi=p.questions.findIndex(q=>types.includes(q.type));
    if(qi<0) continue; const q=p.questions[qi];
    out.push({prompt:q.q,passage:p.passage,passageTitle:p.title,sec:"RC",
      options:q.options.slice(),answer:q.answer,explain:q.explain||""});
  }
  return out;
}

const CURR_TRACKS={
  va:{name:"유추",icon:"🔗",stages:[
    {name:"1단계 · 관계 분류",desc:"DOG : BARK → '동물 : 소리'처럼, 두 단어의 관계 유형부터 맞히는 기초 훈련",n:10,need:8,build:n=>buildVAClassify(n)},
    {name:"2단계 · 힌트 유추",desc:"관계 힌트를 보면서 같은 관계의 짝 고르기 (쉬운 관계 위주)",n:10,need:8,build:n=>buildVACurrStage(true,n)},
    {name:"3단계 · 일반 유추",desc:"힌트 없이 실전 형식 그대로",n:10,need:8,build:n=>buildVACurrStage(false,n)},
    {name:"🎓 졸업 · 실전 시험",desc:"25문항 · 8분 실전 — 15개 이상 맞히면 졸업!",exam:"va",need:15}]},
  wk:{name:"단어",icon:"📇",stages:[
    {name:"1단계 · 어원 기초",desc:"접두사·어근의 뜻 맞히기 — 모르는 단어 추론의 무기",n:10,need:8,build:n=>buildWKRootsQ(n)},
    {name:"2단계 · 빈출 동의어",desc:"AFOQT 빈출 단어로 동의어 고르기 (시간 부담 없이)",n:10,need:8,build:n=>buildWKSynCurr(n)},
    {name:"🎓 졸업 · 실전 시험",desc:"25문항 · 5분 실전 — 15개 이상이면 졸업!",exam:"wk",need:15}]},
  rc:{name:"독해",icon:"📖",stages:[
    {name:"1단계 · 주제 찾기",desc:"지문의 중심 내용(main idea)만 집중 훈련",n:6,need:5,build:n=>buildRCType(["main_idea"],n)},
    {name:"2단계 · 세부·추론",desc:"세부사항과 추론 문제 풀기",n:8,need:6,build:n=>buildRCType(["detail","inference"],n)},
    {name:"🎓 졸업 · 실전 시험",desc:"25문항 · 24분 실전 — 15개 이상이면 졸업!",exam:"rc",need:15}]},
};
let curTrack="va", curSes=null;
function getCurr(t){ return state.curr[t]||(state.curr[t]={unlocked:0,passed:{},best:{}}); }
function stagePassed(t,si){ const tr=CURR_TRACKS[t], st=tr.stages[si], c=getCurr(t);
  if(st.exam) return (state.exams[st.exam]?.best||0)>=st.need;
  return !!c.passed[si]; }
function stageUnlocked(t,si){ if(si===0) return true; return stagePassed(t,si-1); }
function openCurriculum(track){ if(track) curTrack=track; go("curriculum"); }
function renderCurriculum(){
  $$("#currTabs .chip").forEach(c=>c.classList.toggle("on",c.dataset.ct===curTrack));
  const tr=CURR_TRACKS[curTrack], c=getCurr(curTrack);
  $("#currStages").innerHTML=tr.stages.map((st,si)=>{
    const passed=stagePassed(curTrack,si), un=stageUnlocked(curTrack,si);
    const icon=passed?"✅":un?"▶️":"🔒";
    let stLine;
    if(st.exam){ const b=state.exams[st.exam]?.best;
      stLine=passed?`통과! 최고 ${b}/${state.exams[st.exam].bestTotal}`:(b!=null?`최고 ${b}/25 · 목표 ${st.need}+`:`목표 ${st.need}/25 이상`); }
    else { const b=c.best[si];
      stLine=passed?`통과! 최고 ${b}/${st.n}`:(b!=null?`최고 ${b}/${st.n} · 통과 기준 ${st.need}/${st.n}`:`${st.n}문제 중 ${st.need}개 이상`); }
    return `<button class="stage-card ${passed?"passed":un?"cur":"locked"}" data-si="${si}">
      <div class="sic">${icon}</div>
      <div class="meta"><b>${esc(st.name)}</b><div class="muted">${esc(st.desc)}</div>
        <div class="st" style="color:${passed?"var(--ok)":un?"var(--brand2)":"var(--muted)"}">${esc(stLine)}</div></div>
      <div class="go">›</div></button>`;
  }).join("");
  $$("#currStages .stage-card").forEach(b=>b.onclick=()=>{
    const si=+b.dataset.si, st=CURR_TRACKS[curTrack].stages[si];
    if(!stageUnlocked(curTrack,si)){ toast("이전 단계를 먼저 통과하세요 🔒"); return; }
    if(st.exam){ startExam(st.exam); return; }
    startCurrStage(curTrack,si);
  });
}
function startCurrStage(t,si){
  const st=CURR_TRACKS[t].stages[si];
  const items=st.build(st.n);
  if(items.length<st.n){ toast("문제를 만들 데이터가 부족해요."); return; }
  curSes={t,si,items,idx:0,score:0,answered:false};
  $$(".view").forEach(v=>v.classList.remove("active")); $("#view-currplay").classList.add("active");
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go==="home"));
  window.scrollTo(0,0);
  $("#cpDone").classList.add("hidden"); renderCPQ();
}
function renderCPQ(){
  const s=curSes; if(!s) return; if(s.idx>=s.items.length) return finishCurr();
  const it=s.items[s.idx]; s.answered=false;
  window.__cpAnswer=it.answer; // test/debug hook
  $("#cpCount").textContent=`${s.idx+1} / ${s.items.length}`;
  $("#cpScore").textContent=`${s.score}개`;
  $("#cpBar").style.width=(s.idx/s.items.length*100)+"%";
  const passage=it.passage?`<details class="exam-passage" open><summary>📖 ${esc(it.passageTitle||"지문")}</summary><div class="passage">${esc(it.passage)}</div></details>`:"";
  $("#cpArea").innerHTML=`${passage}<div class="card">
      ${it.hint?`<span class="cp-hint">💡 ${esc(it.hint)}</span>`:""}
      <div class="exam-prompt">${fmtMath(it.prompt)}</div>
      ${it.stem?`<div class="cp-stem">${fmtMath(it.stem)}</div>`:""}
      <div class="choices" id="cpChoices">${it.options.map((o,i)=>`<button class="choice" data-i="${i}">${fmtMath(o)}</button>`).join("")}</div>
      <div class="ana-explain hidden" id="cpExplain"></div>
      <button class="btn primary hidden" id="cpNext" style="margin-top:14px">${s.idx>=s.items.length-1?"결과 보기 →":"다음 →"}</button></div>`;
  $("#cpNext").onclick=()=>{ s.idx++; renderCPQ(); };
  $$("#cpChoices .choice").forEach(btn=>btn.onclick=()=>{
    if(s.answered) return; s.answered=true;
    const i=+btn.dataset.i, ok=i===it.answer;
    $$("#cpChoices .choice").forEach((b,bi)=>{ b.disabled=true; if(bi===it.answer) b.classList.add("correct"); else if(b===btn) b.classList.add("wrong"); });
    if(ok) s.score++; $("#cpScore").textContent=`${s.score}개`;
    bumpDay({studied:1,correct:ok?1:0});
    if(it.sec) recordSecAcc(it.sec,ok);
    if(it.anaId!=null){ const v={...getVA(it.anaId)}; v.seen=(v.seen||0)+1; if(ok){v.correct=(v.correct||0)+1; delete state.wrong.va[it.anaId];} else {v.wrong=(v.wrong||0)+1; state.wrong.va[it.anaId]=(state.wrong.va[it.anaId]||0)+1;} setVA(it.anaId,v); }
    if(it.wordId!=null){ if(ok) delete state.wrong.wk[it.wordId]; else state.wrong.wk[it.wordId]=(state.wrong.wk[it.wordId]||0)+1; }
    $("#cpExplain").innerHTML=`<b>${ok?"✅ 정답":"❌ 오답"}</b><br>${fmtMath(it.explain||"")}`;
    $("#cpExplain").classList.remove("hidden");
    $("#cpNext").classList.remove("hidden");
  });
}
function finishCurr(){
  const s=curSes; if(!s) return;
  const st=CURR_TRACKS[s.t].stages[s.si], c=getCurr(s.t);
  const pass=s.score>=st.need;
  c.best[s.si]=Math.max(c.best[s.si]||0,s.score);
  if(pass){ c.passed[s.si]=1; c.unlocked=Math.max(c.unlocked||0,s.si+1); }
  saveNow();
  $("#cpArea").innerHTML=""; $("#cpBar").style.width="100%";
  $("#cpEmoji").textContent=pass?"🎉":"💪";
  $("#cpResult").textContent=`${s.score} / ${s.items.length} (기준 ${st.need})`;
  $("#cpSub").textContent=pass
    ?(s.si+1<CURR_TRACKS[s.t].stages.length?"통과! 다음 단계가 열렸어요.":"트랙 완료!")
    :"아쉬워요 — 한 번 더 도전하면 금방 통과해요.";
  $("#cpDone").classList.remove("hidden");
  curSes={...s,done:true};
}

/* ============================================================
   GENERIC SUBTEST HUB (Arithmetic / Math / Physical Science / Situational)
   ============================================================ */
let subCur=null;
const SUBPOOL={ar:()=>ARITH,mk:()=>MATHK,ps:()=>PHYSCI,sj:()=>SITJUD};
function openSubtest(key){ subCur=key; go("subtest"); }
/* ============================================================
   수학 유형별 공략 — AR·MK 전 유형: 개념·공식 → 푸는 순서 → 함정 →
   실제 풀에서 뽑은 예제 → "이 유형만 20문제" 드릴
   ============================================================ */
const MATH_TYPES=[
 // ── ➗ 산수 추론 (AR) ──
 {k:"ar_ratio",sec:"AR",name:"비율·비례",keys:["ratios","proportions"],
  pts:["비 a:b 에서 전체 = a+b 단위. 예: 3:5면 전체는 8단위","비례식 a:b = c:d ⇔ ad = bc (교차 곱셈)"],
  steps:"① 주어진 값으로 '1단위 크기'부터 구한다 (값 ÷ 해당 비) → ② 구하려는 쪽 비에 곱한다",
  trap:"'전체 인원'을 물으면 8단위(합)로 계산해야지, 3이나 5로 나누면 오답."},
 {k:"ar_pct",sec:"AR",name:"백분율·증감률",keys:["percentages"],
  pts:["x% = x/100 · 부분 = 전체 * 비율","증감률(%) = 변화량/원래값 * 100 — 기준은 항상 '변하기 전' 값","연속 할인은 곱셈: 20% 후 30% 할인 = 0.8 * 0.7 = 44% 할인 (50% 아님)"],
  steps:"① '무엇의 %'인지(기준) 확정 → ② 식 세우기 → ③ 원래값을 물으면 나눗셈으로 역산",
  trap:"10% 올랐다가 10% 내리면 제자리가 아니라 원래의 0.99배."},
 {k:"ar_mix",sec:"AR",name:"혼합(농도)",keys:["mixtures"],
  pts:["농도(%) = 용질/전체 * 100","혼합: C_1V_1 + C_2V_2 = C(V_1+V_2)","물 추가 = 농도 0% 용액 추가 · 증발 = 용질 그대로, 전체만 감소"],
  steps:"① 각 용액의 '용질 양'부터 구한다 → ② 용질 합 ÷ 전체 합 = 새 농도",
  trap:"농도를 그냥 평균 내면 안 됨 — 반드시 양(부피)으로 가중해야 한다."},
 {k:"ar_rate",sec:"AR",name:"속력·거리·시간",keys:["rates","distance_rate_time"],
  pts:["거리 = 속력 * 시간 (d = rt)","평균속력 = 총거리 ÷ 총시간","마주 보고 접근 → 속력의 합 · 같은 방향 추격 → 속력의 차"],
  steps:"① 거리|속력|시간 표를 그린다 → ② 같은 것(거리 또는 시간)을 찾아 등식을 세운다",
  trap:"왕복 평균속력은 두 속력의 평균이 아니라 2ab/(a+b)."},
 {k:"ar_work",sec:"AR",name:"일률(작업 속도)",keys:["work_rate"],
  pts:["혼자 T시간 걸리면 1시간 일량 = 1/T","함께 일하면: 1/A + 1/B = 1/T"],
  steps:"① 각자의 시간당 일량(분수)으로 바꾼다 → ② 더한다 → ③ 역수가 함께 걸리는 시간",
  trap:"A 3시간·B 6시간이면 함께 2시간 — 절대 평균(4.5시간)이 아니다."},
 {k:"ar_avg",sec:"AR",name:"평균",keys:["averages"],
  pts:["평균 = 합 ÷ 개수 → 합 = 평균 * 개수","가중평균 = (n_1x_1 + n_2x_2) ÷ (n_1+n_2)","연속 정수의 합 = 가운데 값 * 개수"],
  steps:"평균 문제는 무조건 '총합'으로 바꿔서 계산 — 사람이 추가/제외되면 합의 변화를 따라간다",
  trap:"두 그룹 평균을 합칠 때 인원수가 다르면 단순 평균 금지."},
 {k:"ar_frac",sec:"AR",name:"분수·정수 연산",keys:["fractions","integers","number_properties"],
  pts:["분수 나눗셈 = 역수를 곱한다","덧셈·뺄셈은 통분 먼저","짝±짝=짝 · 홀±홀=짝 · 홀*홀=홀"],
  steps:"복잡한 분수식은 ① 괄호 안 → ② 곱셈·나눗셈 → ③ 덧셈·뺄셈 순서로",
  trap:"전체의 1/3을 쓰고 '남은 것'의 1/2를 쓰면 남는 건 1/3 — 기준이 계속 바뀐다."},
 {k:"ar_money",sec:"AR",name:"돈·이익·이자",keys:["money","simple_interest","compound_interest"],
  pts:["이익 = 판매가 - 원가 · 이익률은 보통 원가 기준","단리: 이자 = P*r*t","복리: A = P(1+r)^n"],
  steps:"① 기준(원가/정가)을 확정 → ② 할인·이익을 곱셈으로 연결 → ③ 역산은 나눗셈",
  trap:"'정가의 20% 할인 판매로 원가의 20% 이익' — 두 20%의 기준이 다르다."},
 {k:"ar_geo",sec:"AR",name:"기하 응용(둘레·넓이)",keys:["geometry","area_perimeter","area_word_problem","perimeter_word_problem"],
  pts:["직사각형: 둘레 2(a+b) · 넓이 ab","삼각형 넓이 = 밑변*높이/2 · 원: 둘레 2*pi*r, 넓이 pi*r^2","복합 도형은 쪼개서 더하거나, 큰 것에서 빼기"],
  steps:"① 그림을 그리고 아는 값 표시 → ② 공식 적용 → ③ 단위 확인",
  trap:"단위 환산 주의 — 길이가 100배면 넓이는 10,000배(제곱)."},
 {k:"ar_prob",sec:"AR",name:"확률·경우의 수",keys:["probability","basic_probability"],
  pts:["확률 = 원하는 경우 ÷ 전체 경우","독립 사건은 곱하고, 배반 사건은 더한다","'적어도 하나' = 1 - (하나도 없을 확률)"],
  steps:"① 전체 경우 수 → ② 조건 만족 경우 수 → ③ 비복원이면 분모가 줄어드는 것 반영",
  trap:"카드를 '다시 넣지 않으면' 두 번째 확률의 분모는 1 작아진다."},
 {k:"ar_age",sec:"AR",name:"나이 문제",keys:["age_problems"],
  pts:["x년 후에는 '모든 사람'이 +x살","현재 나이를 미지수로 두고 관계식을 세운다"],
  steps:"① 현재 나이 x 설정 → ② '~년 전/후' 조건을 식으로 → ③ 방정식 풀기",
  trap:"몇 년이 지나도 두 사람의 나이 '차'는 변하지 않는다 — 이걸 쓰면 빠르다."},
 {k:"ar_unit",sec:"AR",name:"단위 환산",keys:["unit_conversion"],
  pts:["길이: 1 ft = 12 in · 1 yd = 3 ft · 1 mi = 5,280 ft",
   "부피: 1 gal = 4 qt = 8 pt = 128 fl oz · 1 cup = 8 fl oz",
   "무게: 1 lb = 16 oz · 1 ton = 2,000 lb",
   "넓이·부피: 1 sq yd = 9 sq ft · 1 cu yd = 27 cu ft · 1 cu ft = 1,728 cu in",
   "시간·속도: 1시간 = 3,600초 · 60 mph = 88 ft/s"],
  steps:"단위를 분수로 곱해 소거: 60 mi/hr * (5280 ft/mi) ÷ (3600 s/hr) = 88 ft/s",
  trap:"곱할지 나눌지 헷갈리면 '단위가 소거되는 방향'으로 판단."},
 // ── 📐 수학 지식 (MK) ──
 {k:"mk_lin",sec:"MK",name:"일차방정식·연립",keys:["equations","linear_equations","systems_of_equations","systems"],
  pts:["이항 → 동류항 정리 → 계수로 나누기","연립: 대입법(한 문자를 다른 문자로 표현) 또는 가감법(더하거나 빼서 소거)"],
  steps:"분수 계수는 양변에 분모의 최소공배수를 곱해 정수로 만든 뒤 시작",
  trap:"이항할 때 부호 반전 — 답을 원식에 대입해 3초 검산하는 습관."},
 {k:"mk_alg",sec:"MK",name:"대수식 계산·대입",keys:["algebra"],
  pts:["곱셈공식: (a+b)^2 = a^2+2ab+b^2 · (a-b)^2 = a^2-2ab+b^2 · (a+b)(a-b) = a^2-b^2","문자에 수를 대입할 때 음수는 반드시 괄호로: x=-2면 x^2 = (-2)^2 = 4"],
  steps:"① 전개/정리로 식을 단순화 → ② 대입 → ③ 계산",
  trap:"-x^2 과 (-x)^2 은 다르다 — x=3이면 각각 -9와 9."},
 {k:"mk_exp",sec:"MK",name:"지수·과학적 표기법",keys:["exponents","scientific_notation"],
  pts:["a^m * a^n = a^{m+n} · a^m ÷ a^n = a^{m-n}","(a^m)^n = a^{mn} · (ab)^n = a^n b^n","a^{-n} = 1/a^n · a^0 = 1 (a≠0)","과학적 표기법: (1 이상 10 미만) * 10^n — 곱은 지수 더하기, 나눗셈은 빼기"],
  steps:"밑을 같게 통일하는 게 1순위: 8^x = 2^{3x}, 9 = 3^2",
  trap:"(2^3)^2 = 2^6 이지만 2^{3^2} = 2^9 — 괄호 위치로 완전히 달라진다."},
 {k:"mk_rad",sec:"MK",name:"근호(루트)",keys:["radicals"],
  pts:["sqrt(ab) = sqrt(a) * sqrt(b) · sqrt(a/b) = sqrt(a)/sqrt(b)","분모 유리화: 1/sqrt(2) = sqrt(2)/2","sqrt(x^2) = |x| (음수 조심)"],
  steps:"근호 안을 소인수분해해 제곱 인수를 밖으로: sqrt(48) = sqrt(16*3) = 4sqrt(3)",
  trap:"sqrt(a) + sqrt(b) ≠ sqrt(a+b) — 덧셈은 분배되지 않는다."},
 {k:"mk_quad",sec:"MK",name:"이차식·인수분해",keys:["quadratics","factoring","polynomials","quadratic_vertex"],
  pts:["x^2 + (p+q)x + pq = (x+p)(x+q)","근의 공식: x = (-b ± sqrt(b^2-4ac)) / 2a · 판별식 b^2-4ac 부호로 근 개수","근과 계수: 두 근의 합 = -b/a · 곱 = c/a","꼭짓점: x = -b/2a"],
  steps:"① 우변을 0으로 → ② 인수분해 시도 → ③ 안 되면 근의 공식",
  trap:"x^2 = 4x 에서 양변을 x로 나누면 x=0 근을 잃는다 — 이항해서 인수분해."},
 {k:"mk_ineq",sec:"MK",name:"부등식·절댓값",keys:["inequalities","absolute_value"],
  pts:["음수를 곱하거나 나누면 부등호 방향 반전","|x| < a ⇔ -a < x < a","|x| > a ⇔ x < -a 또는 x > a"],
  steps:"① 일차부등식처럼 풀되 → ② 음수 곱/나눗셈 순간 부호 뒤집기 → ③ 답은 수직선으로 확인",
  trap:"-2x < 6 → x > -3 (부호 반전을 깜빡하면 정반대 답)."},
 {k:"mk_fn",sec:"MK",name:"함수",keys:["functions"],
  pts:["f(x)는 '대입 기계': f(3)은 x 자리에 3을 넣은 값","합성 f(g(x))는 안쪽 g부터 계산","일차함수 y = mx + b: m 기울기, b 절편"],
  steps:"① 정의식 확인 → ② 안쪽부터 대입 → ③ 정리",
  trap:"f(2x)와 2f(x)는 다르다 — 어디에 곱해지는지 확인."},
 {k:"mk_geo",sec:"MK",name:"기하(각·도형·부피)",keys:["geometry","triangles","circles","geometry_area"],
  pts:["삼각형 내각 합 180° · n각형 내각 합 (n-2)*180°","피타고라스 a^2+b^2=c^2 · 특수삼각형 3-4-5, 5-12-13, 45°(1:1:sqrt(2)), 30-60°(1:sqrt(3):2)","원: 둘레 2*pi*r · 넓이 pi*r^2 · 원기둥 V = pi*r^2h · 구 V = 4/3 pi*r^3","닮음비 k → 넓이는 k^2배, 부피는 k^3배"],
  steps:"① 그림에 아는 각·길이 표시 → ② 숨은 직각삼각형/닮음 찾기 → ③ 공식 적용",
  trap:"맞꼭지각·평행선 동위각/엇각부터 채우면 미지의 각이 줄줄이 풀린다."},
 {k:"mk_coord",sec:"MK",name:"좌표기하",keys:["coordinate_geometry"],
  pts:["기울기 = (y_2-y_1)/(x_2-x_1)","두 점 거리 = sqrt((x_2-x_1)^2 + (y_2-y_1)^2)","중점 = 두 좌표의 평균","평행 ⇔ 기울기 같음 · 수직 ⇔ 기울기 곱 = -1"],
  steps:"① 좌표를 공식에 순서대로 대입 → ② 부호 조심해서 계산",
  trap:"수직 조건(기울기 곱 -1)은 단골 출제 — 기울기 2의 수직선은 -1/2."},
 {k:"mk_num",sec:"MK",name:"수 성질·약수·배수",keys:["number_properties","arithmetic"],
  pts:["소수는 1과 자기 자신만 약수 (2는 유일한 짝수 소수)","최대공약수(GCD)*최소공배수(LCM) = 두 수의 곱","연속 정수 n개의 합 = 가운데 값 * n"],
  steps:"약수 개수: 소인수분해 후 (지수+1)들의 곱 — 12 = 2^2*3 → (2+1)(1+1) = 6개",
  trap:"1은 소수가 아니다. 0은 짝수다."},
 {k:"mk_stat",sec:"MK",name:"통계 (중앙값·최빈값·범위)",keys:["statistics"],
  pts:["중앙값(median): 크기순 정렬 후 가운데 값 — 짝수 개면 가운데 두 값의 평균","최빈값(mode): 가장 자주 나오는 값 · 범위(range): 최댓값 - 최솟값","평균 문제는 합 = 평균 * 개수 로 변환 — '평균을 85로 올리려면?' = 필요한 총합부터"],
  steps:"① 반드시 크기순으로 정렬부터 → ② 개수가 짝수인지 홀수인지 확인 → ③ 해당 통계량 계산",
  trap:"이상값(극단값)은 평균을 크게 흔들지만 중앙값은 거의 안 움직인다 — {1,2,3,4,100}의 중앙값은 여전히 3."},
 {k:"mk_seq",sec:"MK",name:"수열·로그",keys:["sequences_series","sequences","series","geometric_series","logarithms"],
  pts:["등차수열: a_n = a_1 + (n-1)d · 합 = (첫항+끝항)*n/2","등비수열: a_n = a_1 * r^{n-1}","log_b(x) = y ⇔ b^y = x · log(ab) = log a + log b"],
  steps:"수열은 ① 규칙(차이/비율) 파악 → ② 공식에 대입. 로그는 지수 정의로 되돌리면 쉽다",
  trap:"등차 합에서 n(항의 개수) 세기 실수 — 끝-first ÷ d + 1."},
];
function typeAcc(sec,keys){ let c=0,w=0;
  keys.forEach(k=>{ const o=(state.weak.topic||{})[sec+":"+k]; if(o){ c+=o.c||0; w+=o.w||0; } });
  const n=c+w; return n?{p:Math.round(c/n*100),n}:null; }
function drillTopicsMulti(sec,keys){
  const set=new Set(keys);
  if(sec==="AV") return shuffle(AVIATION.filter(q=>set.has(q.topic))).slice(0,20).map(q=>({
    section:"AV",prompt:q.q,promptKo:q.q_ko||"",stem:null,sub:AVCAT[q.topic]||q.topic||"",
    avId:q.id,avTopic:q.topic,options:q.options.slice(),answer:q.answer,explain:q.explain||""}));
  const pool={AR:ARITH,MK:MATHK,PS:PHYSCI}[sec]||[];
  const cand=pool.filter(q=>set.has(q.topic||""));
  // 유형은 사용자가 골랐으니 주제 가중은 빼고, 교재 문체(긴 서술형)만 우선 출제한다.
  return ((sec==="AR"||sec==="MK")?shuffleW(cand,mqStyleWeight):shuffle(cand)).slice(0,20).map(q=>({
    section:sec,prompt:q.q,promptKo:q.q_ko||"",stem:null,sub:q.topic||"",qid:q.id,
    options:q.options.slice(),answer:q.answer,explain:q.explain||""}));
}
function renderMathTypes(){
  const box=$("#mtBody"); if(!box) return;
  const pools={AR:ARITH,MK:MATHK};
  const secName={AR:"➗ 산수 추론 (Arithmetic Reasoning)",MK:"📐 수학 지식 (Math Knowledge)"};
  box.innerHTML=["AR","MK"].map(sec=>`<h2 class="section">${secName[sec]}</h2>`+
    MATH_TYPES.filter(g=>g.sec===sec).map(g=>{
      const n=pools[sec].filter(q=>g.keys.includes(q.topic)).length;
      const acc=typeAcc(sec,g.keys);
      const accChip=acc?`<span class="pill" style="font-size:10.5px;color:${acc.p<60?"var(--bad)":acc.p<80?"var(--warn)":"var(--ok)"}">내 정답률 ${acc.p}%</span>`
                       :`<span class="pill" style="font-size:10.5px;color:var(--muted)">미풀이</span>`;
      const ex=pools[sec].find(q=>g.keys.includes(q.topic));
      const exHTML=ex?`<div class="cs-sub">예제 (실제 문제)</div>
        <div class="review-q" style="margin-top:2px">
          <div style="font-weight:600">${fmtMath(ex.q)}</div>
          ${(ex.q_ko&&!flag("hide_ko"))?`<div class="muted" style="font-size:12.5px;margin-top:3px">${fmtMath(ex.q_ko)}</div>`:""}
          ${ex.options.map((o,oi)=>`<div class="ro ${oi===ex.answer?"ok":""}">${oi===ex.answer?"✓ ":""}${fmtMath(o)}</div>`).join("")}
          <div class="rx">${fmtMath(ex.explain||"")}</div></div>`:"";
      return `<details class="cs-sec"><summary>${esc(g.name)} <span class="muted" style="font-weight:600;font-size:11px">${n}문제</span> ${accChip}</summary>
        <div class="cs-sub">핵심 개념·공식</div>${g.pts.map(p=>`<div class="cs-f">${fmtMath(p)}</div>`).join("")}
        ${g.steps?`<div class="cs-sub">푸는 순서</div><div class="cs-f">${fmtMath(g.steps)}</div>`:""}
        ${g.trap?`<div class="cs-sub">⚠️ 함정</div><div class="cs-f" style="border-left-color:var(--warn)">${fmtMath(g.trap)}</div>`:""}
        ${exHTML}
        <button class="btn primary sm" data-mt="${esc(g.k)}" style="margin:10px 0 4px">🎯 이 유형만 20문제 풀기 ▶</button>
      </details>`;
    }).join("")).join("");
  $$("#mtBody [data-mt]").forEach(b=>b.onclick=()=>{ const g=MATH_TYPES.find(x=>x.k===b.dataset.mt); if(!g) return;
    startDrill(drillTopicsMulti(g.sec,g.keys), `유형 드릴 · ${g.name}`); });
}
// Dedicated 수학 hub (bottom-nav tab) — Math Knowledge + Arithmetic practice/exam.
function renderMath(){
  $("#mkCount").textContent=MATHK.length; $("#arCount").textContent=ARITH.length;
  const line=(el,key)=>{ const r=state.exams[key];
    $(el).textContent = r?`최고 ${r.best}/${r.bestTotal} · 최근 ${r.last}/${r.lastTotal}`:"아직 기록 없음"; };
  line("#mkLast","mk"); line("#arLast","ar");
}
function renderSubtest(){
  const key=subCur, p=EXAM_PRESETS[key], g=GUIDES[key];
  const pool=(SUBPOOL[key]?SUBPOOL[key]():[])||[]; const ready=pool.length>0;
  $("#subNav").textContent="과목";
  $("#subTitle").textContent=p?p.name:key;
  $("#subFormat").innerHTML="📋 "+esc(ready?((g&&g.format)||(p&&p.label)||""):"콘텐츠 준비 중이에요. 잠시 후 다시 시도하세요.");
  $("#subExam").disabled=!ready; $("#subPractice").disabled=!ready;
  const r=state.exams[key];
  $("#subLast").textContent=ready?(r?`최고 ${r.best}/${r.bestTotal} · 최근 ${r.last}/${r.lastTotal} · 문제 ${pool.length}개`:`문제 ${pool.length}개 · 아직 기록 없음`):"";
  $("#subExam").onclick=()=>startExam(key);
  $("#subPractice").onclick=()=>startExam(key,{practice:true});
  $("#subGuide").onclick=()=>openGuide(key);
}

/* ============================================================
   INSTRUMENT COMPREHENSION (Pilot subtest — procedural SVG)
   ============================================================ */
let icState=null;
const IC_BANKS=[-45,-30,0,30,45], IC_PITCH=[-1,0,1];
// 실전 AFOQT처럼 자세계+나침반 2계기: 기수 방향(heading)까지 맞혀야 한다.
const IC_HDG=[0,90,180,270], IC_HDG_KO={0:"북",90:"동",180:"남",270:"서"};
function icLabel(o){ return `${IC_HDG_KO[o.heading||0]}향 · ${o.bank<0?"왼쪽 "+(-o.bank)+"° 뱅크":o.bank>0?"오른쪽 "+o.bank+"° 뱅크":"수평"} · ${o.pitch>0?"상승":o.pitch<0?"하강":"수평비행"}`; }
// Attitude indicator: background rotates OPPOSITE to aircraft bank; climb pushes the horizon DOWN.
function attitudeSVG(bank,pitch){
  const cx=75,cy=75,R=62, py=pitch*16; // climb(+1) -> horizon moves down (+y)
  const g=`rotate(${-bank} ${cx} ${cy}) translate(0 ${py})`;
  return `<svg viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg">
    <defs><clipPath id="aiclip"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath></defs>
    <circle cx="${cx}" cy="${cy}" r="${R+3}" fill="#0b1220" stroke="#334155" stroke-width="3"/>
    <g clip-path="url(#aiclip)">
      <g transform="${g}">
        <rect x="${cx-120}" y="${cy-160}" width="240" height="160" fill="#3b82f6"/>
        <rect x="${cx-120}" y="${cy}" width="240" height="160" fill="#7c5b34"/>
        <line x1="${cx-120}" y1="${cy}" x2="${cx+120}" y2="${cy}" stroke="#fff" stroke-width="2"/>
        ${[-40,-20,20,40].map(p=>`<line x1="${cx-12}" y1="${cy+p}" x2="${cx+12}" y2="${cy+p}" stroke="#fff" stroke-width="1.5"/>`).join("")}
      </g>
    </g>
    <!-- fixed miniature aircraft -->
    <line x1="${cx-26}" y1="${cy}" x2="${cx-8}" y2="${cy}" stroke="#fbbf24" stroke-width="4"/>
    <line x1="${cx+8}" y1="${cy}" x2="${cx+26}" y2="${cy}" stroke="#fbbf24" stroke-width="4"/>
    <circle cx="${cx}" cy="${cy}" r="3" fill="#fbbf24"/>
    <polygon points="${cx-6},14 ${cx+6},14 ${cx},22" fill="#fbbf24"/>
  </svg>`;
}
function compassSVG(heading){
  const cx=75,cy=75,R=62; const dirs=[["N",0],["E",90],["S",180],["W",270]];
  let ticks=""; for(let a=0;a<360;a+=30){ const r1=R-4,r2=R-(a%90===0?14:9); const rad=(a-90)*Math.PI/180;
    ticks+=`<line x1="${cx+r1*Math.cos(rad)}" y1="${cy+r1*Math.sin(rad)}" x2="${cx+r2*Math.cos(rad)}" y2="${cy+r2*Math.sin(rad)}" stroke="#94a3b8" stroke-width="1.5"/>`; }
  const lbl=dirs.map(([d,a])=>{ const rad=(a-90-heading)*Math.PI/180, rr=R-24;
    return `<text x="${cx+rr*Math.cos(rad)}" y="${cy+rr*Math.sin(rad)+4}" text-anchor="middle" font-size="13" font-weight="800" fill="${d==='N'?'#ef4444':'#e2e8f0'}">${d}</text>`; }).join("");
  return `<svg viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${R+3}" fill="#0b1220" stroke="#334155" stroke-width="3"/>
    <g transform="rotate(${-heading} ${cx} ${cy})">${ticks}${lbl}</g>
    <polygon points="${cx-7},20 ${cx+7},20 ${cx},30" fill="#fbbf24"/>
    <text x="${cx}" y="${cy+5}" text-anchor="middle" font-size="13" font-weight="800" fill="#22d3ee">${String(Math.round(heading)).padStart(3,"0")}°</text>
  </svg>`;
}
// Jet silhouette by viewing direction. 북=꼬리 쪽(뱅크 그대로 보임), 남=정면(뱅크가
// 거울처럼 반대로 보임 — 실전 단골 함정), 동·서=옆모습(피치가 기수 각도로 보임, 뱅크는 0만 출제).
// pitch 는 모든 뷰에서 ↑/↓ 마커로도 병기해 훈련 난이도를 완만하게 유지한다.
function planeSVG(bank,pitch,heading=0){
  const cx=60,cy=48;
  const arrow= pitch>0?`<text x="${cx}" y="20" text-anchor="middle" font-size="15" font-weight="800" fill="#22d3ee">▲ 상승</text>`
             : pitch<0?`<text x="${cx}" y="20" text-anchor="middle" font-size="15" font-weight="800" fill="#f59e0b">▼ 하강</text>`
             : `<text x="${cx}" y="20" text-anchor="middle" font-size="13" font-weight="700" fill="#94a3b8">— 수평</text>`;
  if(heading===90||heading===270){
    const prof=`
      <ellipse cx="${cx}" cy="${cy}" rx="33" ry="7" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/>
      <path d="M ${cx+24} ${cy-2.5} L ${cx+38} ${cy} L ${cx+24} ${cy+2.5} Z" fill="#94a3b8"/>
      <path d="M ${cx-20} ${cy-2} L ${cx-32} ${cy-16} L ${cx-25} ${cy-16} L ${cx-13} ${cy-3} Z" fill="#cbd5e1" stroke="#64748b" stroke-width="1"/>
      <path d="M ${cx+2} ${cy+1} L ${cx-13} ${cy+11} L ${cx-2} ${cy+4} Z" fill="#94a3b8"/>
      <circle cx="${cx+13}" cy="${cy-4}" r="3" fill="#7c8aa3"/>`;
    const mirror=heading===270?`translate(${2*cx} 0) scale(-1 1)`:"";
    return `<svg viewBox="0 0 120 96" xmlns="http://www.w3.org/2000/svg">${arrow}
      <g transform="${mirror}"><g transform="rotate(${-pitch*14} ${cx} ${cy})">${prof}</g></g></svg>`;
  }
  const jet=`
    <path d="M ${cx} ${cy-22} L ${cx+5} ${cy+6} L ${cx+42} ${cy+18} L ${cx+42} ${cy+12} L ${cx+5} ${cy-2}
             L ${cx+4} ${cy+18} L ${cx+11} ${cy+24} L ${cx} ${cy+20} L ${cx-11} ${cy+24} L ${cx-4} ${cy+18}
             L ${cx-5} ${cy-2} L ${cx-42} ${cy+12} L ${cx-42} ${cy+18} L ${cx-5} ${cy+6} Z"
          fill="#cbd5e1" stroke="#64748b" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${cx}" cy="${cy-16}" r="3.5" fill="#7c8aa3"/>`;
  const nose=heading===180?`<circle cx="${cx}" cy="${cy-22}" r="4.5" fill="#ef4444"/><circle cx="${cx}" cy="${cy-9}" r="3" fill="#22d3ee"/>`:"";
  const rot=heading===180?-bank:bank; // 정면(남향)은 뱅크가 반대로 보인다
  return `<svg viewBox="0 0 120 96" xmlns="http://www.w3.org/2000/svg">${arrow}<g transform="rotate(${rot} ${cx} ${cy})">${jet}${nose}</g></svg>`;
}
function genIC(){
  const heading=IC_HDG[Math.random()*IC_HDG.length|0];
  const side=heading===90||heading===270;
  const bank=side?0:IC_BANKS[Math.random()*IC_BANKS.length|0];
  const pitch=IC_PITCH[Math.random()*IC_PITCH.length|0];
  const correct={bank,pitch,heading};
  const opts=[correct]; let guard=0;
  // 같은 방향에서 자세만 다른 오답 2개 — 나침반만 보고는 못 풀게
  while(opts.length<3&&guard++<60){
    const b=side?0:IC_BANKS[Math.random()*IC_BANKS.length|0], p=IC_PITCH[Math.random()*IC_PITCH.length|0];
    if(!opts.some(o=>o.bank===b&&o.pitch===p&&o.heading===heading)) opts.push({bank:b,pitch:p,heading});
  }
  // 방향이 다른 오답 1개 — 나침반 확인을 강제
  while(opts.length<4&&guard++<90){
    const h=IC_HDG[Math.random()*IC_HDG.length|0]; if(h===heading) continue;
    const s2=h===90||h===270;
    const b=s2?0:IC_BANKS[Math.random()*IC_BANKS.length|0], p=IC_PITCH[Math.random()*IC_PITCH.length|0];
    if(!opts.some(o=>o.bank===b&&o.pitch===p&&o.heading===h)) opts.push({bank:b,pitch:p,heading:h});
  }
  return {bank,pitch,heading,options:shuffle(opts)};
}
function startInstrument(){
  const N=12, secs=180, qs=[]; for(let i=0;i<N;i++) qs.push(genIC());
  icTimerStop();
  icState={N,secs,secsLeft:secs,idx:0,score:0,timer:null,answered:false,qs};
  $$(".view").forEach(v=>v.classList.remove("active")); $("#view-instrument").classList.add("active");
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go==="aviation")); window.scrollTo(0,0);
  $("#icResult").classList.add("hidden"); icTimerStart(); renderICQ();
}
function icTimerStart(){ icTimerStop(); $("#icTimer").textContent=fmtTime(icState.secsLeft);
  icState.timer=setInterval(()=>{ if(!icState) return icTimerStop(); icState.secsLeft--; const t=$("#icTimer");
    if(t){ t.textContent=fmtTime(icState.secsLeft); t.classList.toggle("warn",icState.secsLeft<=15); }
    if(icState.secsLeft<=0) finishIC(); },1000); }
function icTimerStop(){ if(icState&&icState.timer){ clearInterval(icState.timer); icState.timer=null; } }
function renderICQ(){ const s=icState; if(!s) return; if(s.idx>=s.N) return finishIC();
  const q=s.qs[s.idx]; s.answered=false; const correctKey=q.options.findIndex(o=>o.bank===q.bank&&o.pitch===q.pitch&&o.heading===q.heading);
  $("#icCount").textContent=`${s.idx+1} / ${s.N}`; $("#icBar").style.width=(s.idx/s.N*100)+"%";
  $("#icArea").innerHTML=`<div class="ic-instruments">
      <div class="ic-dial">${attitudeSVG(q.bank,q.pitch)}<div class="lbl">자세계 (Attitude)</div></div>
      <div class="ic-dial">${compassSVG(q.heading)}<div class="lbl">나침반 (Compass)</div></div></div>
    <div class="ic-prompt">두 계기를 보고 <b>같은 자세·방향</b>의 비행기를 고르세요
      <br><span class="muted" style="font-size:12px">뱅크(기울기)·피치(상승/하강)에 나침반의 기수 방향까지! 남향(정면)은 뱅크가 거울처럼 반대로 보여요</span></div>
    <div class="ic-opts">${q.options.map((o,i)=>`<button data-i="${i}">${planeSVG(o.bank,o.pitch,o.heading)}<div class="ol">${icLabel(o)}</div></button>`).join("")}</div>`;
  $$("#icArea .ic-opts button").forEach(btn=>btn.onclick=()=>{ if(s.answered) return; s.answered=true;
    const i=+btn.dataset.i, ok=i===correctKey;
    $$("#icArea .ic-opts button").forEach((b,bi)=>{ b.disabled=true; if(bi===correctKey) b.classList.add("correct"); else if(b===btn) b.classList.add("wrong"); });
    if(ok) s.score++; bumpDay({studied:1,correct:ok?1:0}); recordSecAcc("IC",ok);
    setTimeout(()=>{ if(icState){ s.idx++; renderICQ(); } }, ok?550:1100); });
}
function finishIC(){ const s=icState; if(!s) return; icTimerStop();
  $("#icArea").innerHTML=""; $("#icBar").style.width="100%";
  const pct=Math.round(s.score/s.N*100);
  $("#icEmoji").textContent=pct>=80?"🏆":pct>=50?"🎚️":"📈";
  $("#icScore").textContent=`${s.score} / ${s.N} 정답 (${pct}%)`;
  $("#icSub").textContent=`소요 ${fmtTime(s.secs-Math.max(0,s.secsLeft))} · 실제 시험: 25문항 5분`;
  $("#icResult").classList.remove("hidden");
}

/* ============================================================
   VERBAL ANALOGIES
   ============================================================ */
function vaStats(){ const v=Object.values(state.va); const seen=v.filter(x=>x.seen>0).length;
  const mastered=v.filter(x=>x.status==="mastered").length; let c=0,w=0; v.forEach(x=>{c+=x.correct;w+=x.wrong;});
  return {seen,mastered,acc:(c+w)?Math.round(c/(c+w)*100):null}; }
// 유추 문제 훑어보기 — 시험(시간측정) 대신, 문제·정답·해설을 펼쳐놓고 편하게 스크롤.
let vaBrowseFilter="all", vaBrowseSearch="";
function renderVaBrowse(){
  const q=vaBrowseSearch.toLowerCase();
  const full=ANALOGIES.filter(a=>{
    if(vaBrowseFilter!=="all"&&a.relation!==vaBrowseFilter) return false;
    if(vaBrowseSearch){
      const hay=((a.stem||[]).join(" ")+" "+(a.options||[]).map(o=>(o.pair||[]).join(" ")).join(" ")+" "+(a.relation||"")+" "+(a.explain||"")).toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true; });
  const CAP=500, list=full.slice(0,CAP);
  $("#vabCount").textContent=`${full.length}개${full.length>CAP?` (앞 ${CAP}개 표시 — 검색/필터로 좁혀보세요)`:""}`;
  $("#vabList").innerHTML=list.map(a=>{
    const opts=(a.options||[]).map(o=>`<div class="ro ${o.correct?"ok":""}">${o.correct?"✓ ":""}${esc((o.pair||[])[0]||"")} : ${esc((o.pair||[])[1]||"")}</div>`).join("");
    return `<div class="review-q">
      <div class="rh">${esc(a.relation||"관계")}</div>
      <div style="font-weight:800;font-size:16px;letter-spacing:.5px;margin-bottom:6px">${esc((a.stem||[])[0]||"")} : ${esc((a.stem||[])[1]||"")}</div>
      ${opts}
      <div class="rx">${vaExplainHTML(a)}</div></div>`;
  }).join("")||`<div class="card center muted" style="padding:14px">검색 결과가 없어요.</div>`;
}
function renderAnalogyHub(){ $("#vaPlay").classList.add("hidden"); $("#vaDone").classList.add("hidden"); $("#vaHub").classList.remove("hidden");
  const s=vaStats(); $("#vaSeen").textContent=s.seen; $("#vaMastered").textContent=s.mastered; $("#vaAcc").textContent=s.acc==null?"–":s.acc+"%";
  $("#vaStart").disabled=!ANALOGIES.length; if(!ANALOGIES.length) $("#vaStart").textContent="준비 중 (데이터 없음)"; }
let vaSession=null;
function startAnalogy(reviewOnly=false){
  let pool=ANALOGIES.slice();
  if(reviewOnly){ pool=pool.filter(a=>{const v=getVA(a.id);return v.seen>0&&v.status!=="mastered";});
    if(!pool.length){ toast("복습할 틀린 문제가 없어요 👍"); return; } }
  else { pool.sort((a,b)=>{ const va=getVA(a.id),vb=getVA(b.id);
    const ra=va.status==="mastered"?2:va.seen===0?0:1, rb=vb.status==="mastered"?2:vb.seen===0?0:1; return ra-rb; }); }
  const items=(reviewOnly?pool:pool).slice(0,10);
  vaSession={items,idx:0,score:0,answered:false};
  $("#vaHub").classList.add("hidden"); $("#vaDone").classList.add("hidden"); $("#vaPlay").classList.remove("hidden"); renderVA();
}
function renderVA(){ const s=vaSession; if(s.idx>=s.items.length) return finishVA();
  const a=s.items[s.idx];
  $("#vaCount").textContent=`${s.idx+1} / ${s.items.length}`; $("#vaScore").textContent=`${s.score}점`; $("#vaSessBar").style.width=(s.idx/s.items.length*100)+"%";
  const opts=shuffle(a.options.map((o,i)=>({...o,i})));
  const last=s.idx>=s.items.length-1;
  $("#vaArea").innerHTML=`<div class="card">
      <div class="ana-q">다음과 같은 관계는?</div>
      <div class="ana-stem">${esc(a.stem[0])} : ${esc(a.stem[1])}</div>
      <div class="choices" id="vaChoices">${opts.map(o=>`<button class="choice" data-c="${o.correct?1:0}">${esc(o.pair[0])} : ${esc(o.pair[1])}</button>`).join("")}</div>
      <div class="ana-explain hidden" id="vaExplain"></div>
      <button class="btn primary hidden" id="vaNext" style="margin-top:14px">${last?"결과 보기 →":"다음 문제 →"}</button>
    </div>`;
  s.answered=false;
  $("#vaNext").onclick=()=>{ s.idx++; renderVA(); };
  $$("#vaChoices .choice").forEach(btn=>btn.onclick=()=>{ if(s.answered)return; s.answered=true; const ok=btn.dataset.c==="1";
    $$("#vaChoices .choice").forEach(b=>{ b.disabled=true; if(b.dataset.c==="1") b.classList.add("correct"); else if(b===btn) b.classList.add("wrong"); });
    const v={...getVA(a.id)}; v.seen++; if(ok){v.correct++;v.streak++;} else {v.wrong++;v.streak=0;}
    v.status=v.streak>=2?"mastered":"learning"; setVA(a.id,v);
    if(ok) s.score+=10; bumpDay({studied:1,correct:ok?1:0}); recordSecAcc("VA",ok);
    $("#vaScore").textContent=`${s.score}점`;
    $("#vaExplain").innerHTML=`<div class="va-head ${ok?"ok":"no"}">${ok?"✅ 맞혔어요":"❌ 틀렸어요"}</div>`+vaExplainHTML(a);
    $("#vaExplain").classList.remove("hidden");
    $("#vaNext").classList.remove("hidden");
  });
}
function finishVA(){ const s=vaSession,total=s.items.length,got=s.score/10,pct=Math.round(got/total*100);
  $("#vaPlay").classList.add("hidden"); $("#vaEmoji").textContent=pct>=90?"🏆":pct>=70?"🎯":pct>=50?"💪":"📚";
  $("#vaResult").textContent=`${got} / ${total} 정답 (${pct}%)`; $("#vaResultSub").textContent="유추는 관계 패턴을 익히는 게 핵심!";
  $("#vaDone").classList.remove("hidden"); vaSession=null; }

/* ============================================================
   READING COMPREHENSION
   ============================================================ */
/* 독해 풀 완전 분리 — id가 4의 배수(60지문)는 모의고사 전용, 나머지(180지문)는 연습 전용.
   연습에서 미리 읽은 지문이 시험에 다시 나와 점수가 부풀지 않도록 서로 절대 섞이지 않는다. */
function rcExamPool(){ return READING.filter(p=>p.id%4===0); }
function rcPracticePool(){ return READING.filter(p=>p.id%4!==0); }
function rcStats(){ const ids=new Set(rcPracticePool().map(p=>p.id));
  let done=0,examSeen=0,sc=0,to=0;
  for(const [id,x] of Object.entries(state.rc)){ if(!ids.has(+id)) continue;
    if(x.done){ done++; sc+=x.score||0; to+=x.total||0; } else if(x.seen) examSeen++; }
  return {done,examSeen,covered:done+examSeen,acc:to?Math.round(sc/to*100):null}; }
function renderReading(){ const s=rcStats(), plist=rcPracticePool();
  $("#rcDone").textContent=s.covered;
  const dl=$("#rcDone").parentElement&&$("#rcDone").parentElement.querySelector(".lbl");
  if(dl) dl.textContent=s.examSeen?`완료 지문 (연습 ${s.done}+과거시험 ${s.examSeen})`:"완료 지문";
  $("#rcAccTop").textContent=s.acc==null?"–":s.acc+"%";
  if(!plist.length){ $("#rcList").innerHTML=`<div class="card center muted">독해 지문 준비 중 (데이터 없음)</div>`; return; }
  const note=`<div class="guide-src" style="margin:2px 4px 10px">🔒 모의고사 전용 지문 ${rcExamPool().length}개는 이 목록에 없어요 — 연습으로 답을 미리 알게 되지 않게 완전히 분리돼 있어요. (여기 ${plist.length}개는 연습 전용)</div>`;
  $("#rcList").innerHTML=note+plist.map(p=>{ const r=getRC(p.id);
    // ✓ = 연습 채점 완료 · 🎯 = (분리 전) 과거 모의고사에서 봤던 지문
    const mark=r.done?'<span class="done-check">✓</span>'
      :(r.seen?'<span class="done-check" style="opacity:.6" title="과거 모의고사에서 풀었음">🎯</span>':'<span class="go" style="color:var(--muted)">›</span>');
    const sub=r.done?` · ${r.score}/${r.total}`:(r.seen?" · 과거 모의고사에서 풂":"");
    return `<div class="witem" data-id="${p.id}"><div style="min-width:0">
      <div class="w">${esc(p.title||("Passage "+p.id))}</div>
      <div class="k">${esc(p.topic||"")} · ${p.questions.length}문제${sub}</div></div>
      ${mark}</div>`; }).join("");
  $$("#rcList .witem").forEach(el=>el.onclick=()=>openPassage(+el.dataset.id));
}
let rcCur=null;
function openPassage(id){ const p=READING.find(x=>x.id===id); if(!p) return; rcCur={p,answers:{}};
  $("#rcTitle").textContent=p.title||("Passage "+id);
  $("#passageBox").innerHTML=`<span class="rc-topic">${esc(p.topic||"")}</span><div class="passage"><h3>${esc(p.title||"")}</h3>${esc(p.passage)}</div>`;
  $("#rcResult").classList.add("hidden");
  const QT={main_idea:"주제",detail:"세부사항",inference:"추론",vocab_in_context:"문맥 어휘",tone_purpose:"어조/목적"};
  $("#rcQArea").innerHTML=p.questions.map((q,qi)=>`<div class="rc-q"><div class="qt">${QT[q.type]||"문제"} ${qi+1}</div>
      <div class="qq">${esc(q.q)}</div><div class="choices">${q.options.map((o,oi)=>`<button class="choice" data-q="${qi}" data-o="${oi}">${esc(o)}</button>`).join("")}</div></div>`).join("")
    +`<button class="btn primary" id="rcSubmit" style="margin-top:6px">채점하기</button>`;
  $$("#rcQArea .choice").forEach(btn=>btn.onclick=()=>{ const qi=btn.dataset.q;
    $$(`#rcQArea .choice[data-q="${qi}"]`).forEach(b=>b.classList.remove("sel")); btn.classList.add("sel"); rcCur.answers[qi]=+btn.dataset.o; });
  $("#rcSubmit").onclick=submitPassage; go("passage");
}
function submitPassage(){ const {p,answers}=rcCur; let got=0;
  p.questions.forEach((q,qi)=>{ const pick=answers[qi];
    $$(`#rcQArea .choice[data-q="${qi}"]`).forEach(b=>{ b.disabled=true; const oi=+b.dataset.o; b.classList.remove("sel","correct","wrong");
      if(oi===q.answer) b.classList.add("correct"); else if(oi===pick) b.classList.add("wrong"); });
    if(pick===q.answer) got++; recordSecAcc("RC",pick===q.answer);
    const ex=document.createElement("div"); ex.className="ana-explain"; ex.innerHTML=`${pick===q.answer?"✅":"❌"} ${esc(q.explain||"")}`;
    $$(`#rcQArea .rc-q`)[qi].appendChild(ex);
  });
  const total=p.questions.length; setRC(p.id,{done:true,score:got,total});
  bumpDay({studied:total,correct:got}); renderHome();
  $("#rcSubmit").remove();
  $("#rcEmoji").textContent=got===total?"🏆":got>=total*0.6?"📘":"📖";
  $("#rcResultText").textContent=`${got} / ${total} 정답`; $("#rcResult").classList.remove("hidden");
  $("#rcResult").scrollIntoView({behavior:"smooth"});
}
function nextPassage(){ const i=READING.findIndex(x=>x.id===rcCur.p.id); const nxt=READING[i+1]; if(nxt) openPassage(nxt.id); else { toast("마지막 지문입니다!"); go("reading"); } }

/* ============================================================
   EXAM — 실전 모의고사 (timed, AFOQT format)
   ============================================================ */
let exam=null;
// One builder per AFOQT subtest code — lets presets be composed from (code,count) specs.
const SECBUILD={ WK:n=>buildWK(n), VA:n=>buildVA(n), RC:n=>buildRC(n),
  AR:n=>buildMCQ(ARITH,"AR",n), MK:n=>buildMCQ(MATHK,"MK",n), PS:n=>buildMCQ(PHYSCI,"PS",n),
  AV:n=>buildAV(n), SJ:n=>buildSJ(n), TR:n=>buildTR(n), IC:n=>buildIC(n), BC:n=>buildBC(n) };
// Realistic seconds-per-question per subtest (from official AFOQT time ÷ count),
// so every preset's timer/label stays consistent with its section mix.
// 출처: Pearson VUE AFOQT 시험 구조표(2026-08-06 갱신). 2015년 공군 팸플릿은 낡았음(독해 38분·상황판단 50문항으로 표기).
// RC 25문항/24분=58초, SJ 16문항/35분=131초, BC 30문항/5분=10초, TR 40문항/7분=10.5초.
const SECRATE={ WK:12, VA:19, RC:58, AR:70, MK:53, AV:24, TR:10.5, IC:12, BC:10, PS:30, SJ:131 };
// Build a preset from a list of [sectionCode, count] specs; derives timer + label.
function composeMock(name,specs,tag){
  const secs=specs.reduce((s,[c,n])=>s+SECRATE[c]*n,0);
  const qn=specs.reduce((s,[,n])=>s+n,0);
  return {name,secs,specs,build:()=>specs.flatMap(([c,n])=>SECBUILD[c](n)),
    label:`${qn}문항 · ${fmtTime(secs)}${tag?" · "+tag:""}`};
}
const EXAM_PRESETS={
  // ── 전과목 통합 (full AFOQT simulation — excludes Physical Science & Situational Judgment) ──
  // 실제 시험과 동일한 문항 수·섹션 순서. 각 섹션은 자기 시계로 진행된다.
  afoqt: composeMock("AFOQT 전체 모의고사",
    [["VA",25],["AR",25],["WK",25],["MK",25],["RC",25],["AV",20],["TR",40],["IC",25],["BC",30]], "전 과목 · 실전 문항수"),
  // pilotPerfect(): 표읽기·블록·계기는 외부 앱에서 연습 → 전체 모의고사에서 제외한 코어 버전
  afoqtCore: composeMock("AFOQT 모의고사 (표읽기·블록·계기 제외)",
    [["VA",25],["AR",25],["WK",25],["MK",25],["RC",25],["AV",20]], "Pilot 시각과목 만점 처리"),
  // ── 섹터별 (composite-focused mocks) ──
  // 합성점수 구성 과목 그대로 · 실전 문항수 (Pilot = MK·IC·TR·AV)
  secVerbal: composeMock("Verbal 섹터",       [["VA",25],["WK",25],["RC",25]],           "Verbal · 실전 문항수"),
  secQuant:  composeMock("Quantitative 섹터", [["AR",25],["MK",25]],                     "Quant · 실전 문항수"),
  secPilot:  composeMock("Pilot 섹터",        [["MK",25],["TR",40],["IC",25],["AV",20]], "Pilot · 실전 문항수"),
  // ── 세션별 (individual subtests, real counts) ──
  wk: composeMock("Word Knowledge",          [["WK",25]]),
  va: composeMock("Verbal Analogies",        [["VA",25]]),
  rc: composeMock("Reading Comprehension",   [["RC",25]]),
  ar: composeMock("Arithmetic Reasoning",    [["AR",25]]),
  mk: composeMock("Math Knowledge",          [["MK",25]]),
  av: composeMock("Aviation Information",     [["AV",20]]),
  tr: composeMock("Table Reading",           [["TR",40]]),
  ic: composeMock("Instrument Comprehension",[["IC",25]]),
  bc: composeMock("Block Counting",          [["BC",30]]),
  // ── kept for the Subtest hub (not shown in the exam-screen groups) ──
  ps: composeMock("Physical Science",        [["PS",20]]),
  sj: composeMock("Situational Judgment",    [["SJ",16]]),
  // ── legacy Verbal-only full mock (kept for old history keys / quick links) ──
  full: composeMock("Verbal 전체 모의고사",   [["WK",25],["VA",25],["RC",25]], "Verbal 실전"),
  // ── balanced daily mixed practice (generous timer = low pressure) ──
  daily:{name:"오늘의 통합 학습", secs:1500, build:()=>[...buildWK(8),...buildVA(6),...buildRC(4),...buildAV(4)], label:"전 영역 22문항"},
};
function buildAV(n){
  return pickFresh(AVIATION, n, q=>state.avp[q.id]||0).map(q=>({
    section:"AV", prompt:q.q, promptKo:q.q_ko||"", stem:null, sub:AVCAT[q.topic]||q.topic||"",
    avId:q.id, avTopic:q.topic,
    options:q.options.slice(), answer:q.answer, explain:q.explain||""}));
}
/* 실제 교재(AFOQTGuide·Barron·Trivium)의 산수·수학은 인물과 상황이 있는 긴 문장형이 주류다
   — AR 평균 29단어에 19%가 사람 이름으로 시작하는 시나리오. 앱 문항은 이보다 간결해서
   그대로 뽑으면 실전보다 쉽게 읽힌다. 그래서 실전 문체에 가까운 문항을 더 자주 출제한다.
   (물리과학은 앱 쪽이 이미 실제보다 길어 가중치를 적용하지 않는다.) */
const MQ_CTX=/\b(store|school|team|company|worker|employee|car|truck|train|plane|flight|recipe|garden|room|farm|shop|restaurant|student|teacher|driver|pilot|customer|crew|squadron|machine|factory|hotel|library|bank|family|gym|museum|theater|bakery|pharmacy|charity|hospital)\w*/i;
const MQ_COMMON=new Set([
  "What","How","The","Which","Solve","Using","Simplify","Two","After","One","Working","Evaluate","Factor",
  "Find","She","You","For","When","Given","Six","During","Approximately","Convert","Three","Expand","Express",
  "Write","Assuming","Calculate","Four","Five","Seven","Eight","Nine","Ten","They","Last","This","That","There",
  "Both","Each","Every","Multiply","Divide","Add","Subtract","Estimate","Round","Assume","Determine","Compute",
  "Consider","Suppose","Rewrite","Reduce","Identify","Choose","Select","According","Between","Because","Before",
  "Since","While","With","Without","About","Above","Below","From","Into","Over","Under","Water","Coffee","Class",
  "Tickets","Running","Sound","Milk","Fuel","Ground","Rectangular","Together","Assume"]);
function mqNamed(t){                       // 등장인물(고유명사) 포함 여부 — 흔한 문두 단어는 제외
  const m=String(t).match(/\b[A-Z][a-z]{2,}\b/g)||[];
  return m.some(x=>!MQ_COMMON.has(x));
}
function mqStyleWeight(q){                 // 문체(길이·인물) 가중
  const t=q.q||"", w=t.trim().split(/\s+/).length;
  let s = w<18 ? 0.20 : (w<=25 ? 0.9 : (w<=34 ? 2.8 : 3.4));
  if(mqNamed(t)) s*=3.0; else if(MQ_CTX.test(t)) s*=1.3;
  return s;
}
/* 주제 가중 — 교재 278문항의 유형 분포에 맞춘다. 앱 은행은 혼합(농도)·속력·비율·통계·함수·수열이
   교재보다 많고 백분율·돈·단위환산이 적다. 값은 문체 가중과의 상호작용까지 포함해 시뮬레이션으로 보정한 것. */
const MQ_TOPIC_W={
  // 산수 추론
  "AR:age_problems":1.1, "AR:area_perimeter":0.72, "AR:area_word_problem":0.72,
  "AR:averages":1.11, "AR:basic_probability":3.01, "AR:compound_interest":1.53,
  "AR:distance_rate_time":0.38, "AR:fractions":0.51, "AR:geometry":0.72,
  "AR:integers":0.51, "AR:mixtures":0.1, "AR:money":1.53,
  "AR:number_properties":0.51, "AR:percentages":1.92, "AR:perimeter_word_problem":0.72,
  "AR:probability":3.01, "AR:proportions":0.53, "AR:rates":0.38,
  "AR:ratios":0.53, "AR:simple_interest":1.53, "AR:unit_conversion":3.83,
  "AR:work_rate":0.21,
  // 수학 지식
  "MK:absolute_value":2.54, "MK:algebra":0.72, "MK:arithmetic":0.78,
  "MK:circles":0.71, "MK:coordinate_geometry":1.94, "MK:equations":2.8,
  "MK:exponents":2.11, "MK:factoring":1.04, "MK:functions":0.35,
  "MK:geometric_series":0.59, "MK:geometry":0.71, "MK:geometry_area":0.71,
  "MK:inequalities":2.54, "MK:linear_equations":2.8, "MK:logarithms":0.59,
  "MK:number_properties":0.78, "MK:polynomials":1.04, "MK:quadratic_vertex":1.04,
  "MK:quadratics":1.04, "MK:radicals":2.49, "MK:scientific_notation":2.11,
  "MK:sequences":0.59, "MK:sequences_series":0.59, "MK:series":0.59,
  "MK:statistics":0.16, "MK:systems":2.8, "MK:systems_of_equations":2.8,
  "MK:triangles":0.71,
};
function mqWeight(q, sec){                 // 모의고사용 = 문체 x 주제
  return mqStyleWeight(q) * (MQ_TOPIC_W[sec+":"+(q.topic||"")] ?? 1);
}
// 가중 무작위 정렬(A-Res) — 유형 드릴처럼 '이미 유형을 고른' 경우엔 문체 가중만 쓴다.
function shuffleW(arr, wf){
  return arr.map(x=>[Math.pow(Math.random(), 1/Math.max(wf(x)||1,0.01)), x])
            .sort((a,b)=>b[0]-a[0]).map(e=>e[1]);
}
// Generic bilingual MCQ builder (Arithmetic Reasoning / Math Knowledge / Physical Science).
function buildMCQ(pool,section,n){
  const sec=section.toLowerCase(), rec=state.qSeen[sec]||{};
  const seenAt=q=>rec[q.id]||0;
  const picked = (section==="AR"||section==="MK")
    ? pickFreshW(pool, n, seenAt, q=>mqWeight(q, section))
    : pickFresh(pool, n, seenAt);
  return picked.map(q=>({
    section, prompt:q.q, promptKo:q.q_ko||"", stem:null, sub:q.topic||"", qid:q.id,
    options:q.options.slice(), answer:q.answer, explain:q.explain||""}));
}
// Situational Judgment: scenario shown as a passage block, single best-answer.
function buildSJ(n){
  return shuffle(SITJUD).slice(0,n).map(q=>({
    section:"SJ", prompt:q.q||"가장 효과적인 행동은?", promptKo:"", stem:null, sub:"리더십·판단",
    passageId:"sj"+q.id, passageTitle:"상황 (Situation)",
    passageText:(q.scenario||"")+((q.scenario_ko&&!flag("hide_ko"))?("\n\n"+q.scenario_ko):""),
    options:q.options.slice(), answer:q.answer, explain:q.explain||""}));
}
// ── Visual subtests as exam items (figure + MCQ), so they slot into the linear runner ──
// Table Reading: one shared grid; each item is an (X,Y) lookup with the table as its figure.
function buildTR(n){
  const xs=[]; for(let x=-5;x<=5;x++) xs.push(x);
  const ys=[]; for(let y=5;y>=-5;y--) ys.push(y);
  const grid=ys.map(()=>xs.map(()=>10+(Math.random()*90|0)));
  let h='<div class="tr-wrap"><table class="tr-tbl"><thead><tr><th class="tr-corner">Y\\X</th>';
  xs.forEach(x=>h+=`<th>${x}</th>`); h+='</tr></thead><tbody>';
  ys.forEach((y,yi)=>{ h+=`<tr><th>${y}</th>`; grid[yi].forEach(v=>h+=`<td>${v}</td>`); h+='</tr>'; });
  const tableHTML=h+'</tbody></table></div>';
  const items=[];
  for(let i=0;i<n;i++){
    const xi=Math.random()*xs.length|0, yi=Math.random()*ys.length|0, correct=grid[yi][xi];
    const opts=new Set([correct]); let g=0;
    while(opts.size<5&&g++<60){ let v;
      if(Math.random()<0.6){ const ny=clamp(yi+(Math.random()<.5?-1:1),0,ys.length-1), nx=clamp(xi+(Math.random()<.5?-1:1),0,xs.length-1); v=grid[ny][nx]; }
      else v=10+(Math.random()*90|0); opts.add(v); }
    while(opts.size<5) opts.add(10+(Math.random()*90|0));
    const options=shuffle([...opts]).map(String);
    items.push({section:"TR", prompt:`X = ${xs[xi]} , Y = ${ys[yi]} 의 값은?`, sub:"표 읽기", figureHTML:tableHTML,
      options, answer:options.indexOf(String(correct)),
      explain:`X=${xs[xi]} 열, Y=${ys[yi]} 행이 만나는 칸의 값은 ${correct}.`});
  }
  return items;
}
// Block Counting: procedural isometric figure as the item's figure; options are counts.
function buildBC(n){
  const items=[];
  for(let i=0;i<n;i++){ const f=genBlockFigure(); const correct=f.touch;
    const options=bcOptions(correct).map(String);
    items.push({section:"BC", prompt:"청록색 ? 블록에 닿는 블록은 몇 개인가요?", sub:"블록 세기",
      figureHTML:`<div class="bc-fig">${bcSVG(f)}</div>`,
      options, answer:options.indexOf(String(correct)),
      explain:`상·하·좌·우·앞·뒤로 맞닿은 면만 셉니다(대각선 제외) → ${correct}개.`});
  }
  return items;
}
// Instrument Comprehension: attitude dial as figure; plane silhouettes as picture options.
function buildIC(n){
  const items=[];
  for(let i=0;i<n;i++){ const q=genIC();
    const correctKey=q.options.findIndex(o=>o.bank===q.bank&&o.pitch===q.pitch&&o.heading===q.heading);
    const optionsHTML=q.options.map(o=>`${planeSVG(o.bank,o.pitch,o.heading)}<div class="ol">${icLabel(o)}</div>`);
    items.push({section:"IC", prompt:"자세계와 나침반을 보고 같은 자세·방향의 비행기를 고르세요", sub:"계기 해석",
      figureHTML:`<div class="ic-instruments"><div class="ic-dial">${attitudeSVG(q.bank,q.pitch)}<div class="lbl">자세계 (Attitude)</div></div>
        <div class="ic-dial">${compassSVG(q.heading)}<div class="lbl">나침반 (Compass)</div></div></div>`,
      options:q.options.map(icLabel), optionsHTML, answer:correctKey,
      explain:`정답: ${icLabel(q.options[correctKey])}. 뱅크=기울기, 피치=수평선 위치, 나침반=기수 방향. 남향(정면)은 뱅크가 거울로 반대로 보이는 것에 주의.`});
  }
  return items;
}
// Predicted composite percentile from accumulated per-subtest accuracy.
// pilotPerfect(): TR/BC/IC 는 외부 앱에서 거의 만점 → 실제 문항 수만큼 만점 표본으로 넣는다.
function compositeEst(codes){
  let c=0,w=0,realN=0; codes.forEach(s=>{
    const o=state.secAcc[s]; const oc=o?(o.c||0):0, ow=o?(o.w||0):0;
    if(pilotPerfect()&&PILOT_VISUAL.includes(s)){ c+=PILOT_FULL[s]||25; return; }
    c+=oc; w+=ow; realN+=oc+ow; });
  const n=c+w;
  // 만점 처리 합성 표본은 데이터 충분성 판정에서 제외 — 실데이터 없이 99th가 뜨면 안 된다
  if(realN<5) return {pct:null,acc:null,n:realN};
  const acc=c/n; return {pct:estPercentile(acc),acc,n};
}
// Rough, clearly-unofficial mapping from accuracy to an AFOQT-style percentile.
function estPercentile(acc){
  const pts=[[0,1],[0.4,8],[0.5,18],[0.55,25],[0.6,33],[0.65,42],[0.7,52],[0.75,62],[0.8,72],[0.85,81],[0.9,89],[0.95,95],[1,99]];
  for(let i=0;i<pts.length-1;i++){ const [x0,y0]=pts[i],[x1,y1]=pts[i+1];
    if(acc<=x1){ const t=(acc-x0)/((x1-x0)||1); return Math.round(y0+t*(y1-y0)); } }
  return 99;
}
// Word Knowledge: choose the word most similar in meaning (real AFOQT WK format)
/* ---- WK 보기 품질 헬퍼 ----
   · 의미 이웃 차단: 오답 후보의 단어/동의어가 표제어의 동의어 무리와 겹치면 제외 (답 2개 방지)
   · 품사 일치 우선: 실전처럼 보기 품사를 표제어와 맞춘다 (품사만으로 소거 불가)
   · 한 단어 보기 우선: 구(phrase)가 섞여 길이로 티 나는 것 방지 */
function wkPos(x){ return String((x&&x.pos)||"").toLowerCase().split(/[^a-z]/)[0]; }
function wkNeighbor(w,o,wSyn){
  if(wSyn.has(String(o.word).toLowerCase())) return true;
  for(const s of (o.synonyms||[])){ const sl=String(s).toLowerCase();
    if(sl===String(w.word).toLowerCase()||wSyn.has(sl)) return true; }
  return false;
}
function wkPickCorrect(w){
  const singles=(w.synonyms||[]).filter(s=>!/\s/.test(String(s).trim()));
  const from=singles.length?singles:(w.synonyms||[]);
  return from[(Math.random()*from.length)|0];
}
// k개의 오답을 {t:보기, kor:출처 단어 뜻}으로. 품사 일치 후보 우선, 모자라면 전체에서 보충.
function wkDistractors(w,correct,k){
  const wSyn=new Set((w.synonyms||[]).map(s=>String(s).toLowerCase())); wSyn.add(String(w.word).toLowerCase());
  const p0=wkPos(w), dist=[];
  const fill=(cands)=>{ for(const o of cands){ if(dist.length>=k) return;
    if(o.id===w.id||!(o.synonyms&&o.synonyms.length)) continue;
    if(wkNeighbor(w,o,wSyn)) continue;
    const singles=o.synonyms.filter(s=>!/\s/.test(String(s).trim()));
    const from=singles.length?singles:o.synonyms;
    const c=from[(Math.random()*from.length)|0]; if(!c) continue;
    const cl=String(c).toLowerCase();
    if(wSyn.has(cl)||cl===String(correct).toLowerCase()||dist.some(d=>String(d.t).toLowerCase()===cl)) continue;
    dist.push({t:c,kor:o.kor||""}); } };
  const sh=shuffle(WORDS);
  if(p0) fill(sh.filter(o=>wkPos(o)===p0));
  if(dist.length<k) fill(sh);
  return dist.length>=k?dist:null;
}
// 뜻(kor) 4지 보기: 한글 뜻 토큰이 겹치거나 동의어 무리가 겹치는 후보는 제외
function korChoices(w,k){
  const tok=x=>String(x||"").split(/[,\u00b7;\/()\s~\u2026]+/).filter(t=>t.length>=2);
  const kt=new Set(tok(w.kor));
  const wSyn=new Set((w.synonyms||[]).map(x=>String(x).toLowerCase())); wSyn.add(String(w.word).toLowerCase());
  const out=[];
  for(const o of shuffle(WORDS)){ if(out.length>=k) break;
    if(o.id===w.id||!o.kor||o.kor===w.kor) continue;
    if(tok(o.kor).some(t=>kt.has(t))) continue;
    if(wkNeighbor(w,o,wSyn)) continue;
    if(out.includes(o.kor)) continue;
    out.push(o.kor); }
  // 안전판: 후보 부족 시(사실상 불가) 조건 완화해 채움
  if(out.length<k) for(const o of shuffle(WORDS)){ if(out.length>=k) break;
    if(o.id!==w.id&&o.kor&&o.kor!==w.kor&&!out.includes(o.kor)) out.push(o.kor); }
  return out;
}
function buildWK(n){
  const pool=WORDS.filter(w=>w.synonyms&&w.synonyms.length);
  // 티어 가중(high>mid>std)은 유지하되, 티어별로 '안 푼 것' 우선 선발.
  // 예전처럼 상위 n*12개만 잘라 쓰면 그 고정 구간이 소진된 뒤 계속 같은 단어만 돌게 된다.
  const seenAt=w=>state.wkSeen[w.id]||0;
  const byTier=t=>pool.filter(w=>tierOf(w)===t);
  const top=shuffle([
    ...pickFresh(byTier("high"), Math.ceil(n*1.6), seenAt),
    ...pickFresh(byTier("mid"),  Math.ceil(n*0.9), seenAt),
    ...pickFresh(byTier("std"),  Math.ceil(n*0.5), seenAt),
  ]);
  const items=[];
  for(const w of top){
    if(items.length>=n) break;
    // 실전 형식: 보기 5개(A~E). 실제 시험(Form T)의 단어 문항은 전부 '의미가 가장 가까운 단어' 고르기다.
    const correct=wkPickCorrect(w);
    if(!correct) continue;
    const dist=wkDistractors(w,correct,4);
    if(!dist) continue;
    const options=shuffle([correct,...dist.map(d=>d.t)]);
    items.push({section:"WK",
      prompt:"다음 단어와 의미가 가장 가까운 것은?",
      stem:w.word, sub:(w.pos||"")+(tierOf(w)==="high"?" · ⭐빈출":""),
      options, answer:options.indexOf(correct), wordId:w.id, tier:tierOf(w),
      explain:`${w.word} = ${w.kor||""}  ·  동의어: ${w.synonyms.slice(0,4).join(", ")}`});
  }
  return items;
}
// 유추 해설 — 정답 근거(why) + 오답 이유(wrong)까지 보여준다. 데이터 없으면 기존 explain으로 폴백.
function vaExplainHTML(a, opts){
  if(!a) return "";
  const correct=(a.options||[]).find(o=>o.correct);
  const cp=correct?`${correct.pair[0]} : ${correct.pair[1]}`:"";
  const rel=a.relKo?`${esc(a.relKo)} <span class="muted">(${esc(a.relation||"")})</span>`:esc(a.relation||"");
  let h=`<div class="va-ans">✅ 정답 <b>${esc(cp)}</b></div>`;
  if(rel) h+=`<div class="va-rel">🔗 관계: ${rel}</div>`;
  h+=`<div class="va-why">${esc(a.why||a.explain||"")}</div>`;
  if(a.why&&a.explain&&a.explain!==a.why) h+=`<div class="va-why2">${esc(a.explain)}</div>`;
  if(Array.isArray(a.wrong)&&a.wrong.length&&!(opts&&opts.brief)){
    h+=`<div class="va-wrongs"><div class="t">✗ 나머지 보기</div>`+
       a.wrong.map(w=>`<div class="wr"><b>${esc(w.pair)}</b> — ${esc(w.why)}</div>`).join("")+`</div>`;
  }
  return h;
}
// 실제 AFOQT 유추는 '문장완성형(A is to B as C is to ___)'이 주류(65~76%)이고,
// '짝맞추기(A:B :: C:D)'가 나머지다. id 기준으로 7:3 비율을 고정 배분한다(같은 문항은 항상 같은 형식).
const UPVA = s => String(s).toUpperCase();
// 짝맞추기형은 실제 시험에서 첫 글자만 대문자로 표기된다 (예: "Borough is to City as").
const TCVA = s => String(s).trim().split(/\s+/)
  .map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():w).join(" ");
function vaItem(a){
  const relLine=`관계: ${a.relKo?a.relKo+" ("+(a.relation||"")+")":(a.relation||"")}`;
  const cp=(a.options.find(o=>o.correct)||{}).pair;
  if(cp && (a.id%20)<13){          // 문장완성 65% : 짝맞추기 35% — 현행 Form T 교재 비율
    // 오답 보기는 '오답 짝의 뒷단어'에서 뽑되, 문제에 이미 등장한 단어는 제외한다.
    const ans=cp[1];
    const seen=new Set([String(ans).toLowerCase(),
      String(a.stem[0]).toLowerCase(), String(a.stem[1]).toLowerCase(), String(cp[0]).toLowerCase()]);
    const dw=[];
    for(const o of a.options){ if(o.correct) continue;
      const w=o.pair[1], k=String(w).toLowerCase();
      if(seen.has(k)) continue; seen.add(k); dw.push(w); }
    if(dw.length<4){ for(const o of a.options){ if(o.correct) continue;   // 부족하면 앞단어에서 보충
      const w=o.pair[0], k=String(w).toLowerCase();
      if(seen.has(k)) continue; seen.add(k); dw.push(w); if(dw.length>=4) break; } }
    if(dw.length>=4){
      const opts=shuffle([ans,...dw.slice(0,4)]).map(UPVA);
      return {section:"VA",
        prompt:`${UPVA(a.stem[0])} is to ${UPVA(a.stem[1])} as ${UPVA(cp[0])} is to`,
        stem:null, sub:"ANALOGY", anaId:a.id, relation:a.relation||"기타",
        options:opts, answer:opts.indexOf(UPVA(ans)),
        explain:[relLine, a.why||a.explain||"",
                 `${a.stem[0]} : ${a.stem[1]} 의 관계를 ${cp[0]} 에 적용하면 → ${ans}`].filter(Boolean).join("\n")};
    }
  }
  // 짝맞추기형: 실제 시험처럼 "X is to Y as" + 보기 "A is to B" (콜론 표기 아님)
  const opts=shuffle(a.options.map(o=>({t:`${TCVA(o.pair[0])} is to ${TCVA(o.pair[1])}`,c:!!o.correct})));
  return {section:"VA",prompt:`${TCVA(a.stem[0])} is to ${TCVA(a.stem[1])} as`,
    stem:null, sub:"ANALOGY", anaId:a.id, relation:a.relation||"기타",
    options:opts.map(o=>o.t), answer:opts.findIndex(o=>o.c),
    explain:[relLine,
             a.why||a.explain||"",
             ...(Array.isArray(a.wrong)?a.wrong.map(w=>`✗ ${w.pair} — ${w.why}`):[])].filter(Boolean).join("\n")};
}
// 실제 교재(AFOQTGuide·Barron·Trivium 150문항)의 관계 유형 분포에 맞춰 출제 비중을 보정한다.
// 앱 데이터는 '직업/도구'가 과다(17% vs 5%)하고 '동의어'가 부족(10% vs 19%)해,
// 그대로 뽑으면 실전과 체감이 달라진다.
function vaClass(a){
  const r=((a.relation||"")+" "+(a.relKo||"")).toLowerCase();
  if(/degree|intensity|정도/.test(r)) return "int";
  if(/synonym|동의/.test(r))          return "syn";
  if(/antonym|반의/.test(r))          return "ant";
  if(/part|whole|부분|전체/.test(r))   return "part";
  if(/cause|effect|원인|결과/.test(r)) return "cause";
  if(/unit|measure|단위/.test(r))      return "unit";
  if(/group|member|집단|무리/.test(r)) return "grp";
  if(/tool|worker|직업|도구/.test(r))  return "work";
  return "etc";
}
const VA_W={syn:1.85, ant:0.75, int:1.10, work:0.30, part:0.40, cause:0.65, unit:0.90, grp:1.50, etc:1.30};
// pickFresh 의 가중 버전 — '안 푼 것 우선' 규칙은 유지하고 그 안에서 가중 무작위로 뽑는다.
function pickFreshW(pool, n, seenAt, weightOf){
  const fresh=[], seen=[];
  for(const x of pool){ const t=seenAt(x); if(t) seen.push([t,x]); else fresh.push(x); }
  const key=x=>Math.pow(Math.random(), 1/Math.max(weightOf(x)||1, 0.01));
  const out=fresh.map(x=>[key(x),x]).sort((a,b)=>b[0]-a[0]).slice(0,n).map(e=>e[1]);
  if(out.length<n){ seen.sort((a,b)=>a[0]-b[0]);
    out.push(...seen.slice(0,n-out.length).map(e=>e[1])); }
  return out;
}
function buildVA(n){ return pickFreshW(ANALOGIES, n,
  a=>{ const v=state.va[a.id]; return (v&&v.seen>0)?seenTs(v):0; },
  a=>VA_W[vaClass(a)]||1).map(vaItem); }
function rcItem(p,qi){
  const q=p.questions[qi];
  return {section:"RC",prompt:q.q, stem:null, sub:p.topic||"",
    passageId:p.id, qIdx:qi, qType:q.type||"detail", passageTitle:p.title, passageText:p.passage,
    options:q.options.slice(), answer:q.answer, explain:q.explain||""};
}
// 이미 푼 문제가 시험에 다시 나와 정답을 외운 채 푸는 일을 막는다.
// 안 푼 것을 먼저 쓰고, 모자라면 "가장 오래 전에 푼 것"부터 채워 자연스럽게 순환시킨다.
function pickFresh(pool, n, seenAt){
  const fresh=[], seen=[];
  for(const x of pool){ const t=seenAt(x); if(t) seen.push([t,x]); else fresh.push(x); }
  const out=shuffle(fresh).slice(0,n);                     // 안 푼 것(무작위) 먼저
  if(out.length<n){ seen.sort((a,b)=>a[0]-b[0]);            // 모자라면 오래 전에 푼 것부터
    out.push(...seen.slice(0,n-out.length).map(e=>e[1])); }
  return out;   // 최종 셔플하면 '안 푼 것 우선' 순서가 무너지므로 하지 않음
}
const seenTs=v=>{ if(!v) return 0; const t=(typeof v==="number")?v:new Date(v.updated_at||0).getTime(); return t||1; };
function rcSeenAt(p){ const r=state.rc[p.id]; return (r&&(r.done||r.seen))?seenTs(r):0; }
function buildRC(n){
  const items=[];
  // 모의고사 전용 풀에서만 출제 — 지문 단위로 안 푼 것 우선 (한 지문에 문항 3~5개)
  const pool=rcExamPool();
  const order=pickFresh(pool, pool.length, rcSeenAt);
  for(const p of order){
    for(let qi=0;qi<p.questions.length;qi++){
      if(items.length>=n) break;
      items.push(rcItem(p,qi));
    }
    if(items.length>=n) break;
  }
  return items;
}
/* ----- 오답 노트(retest) builders ----- */
// 반복 오답 우선: 많이 틀린 것부터(동률은 무작위) + 2회 이상이면 ❗표시
function wrongSorted(bucket){ return shuffle(Object.keys(bucket)).sort((a,b)=>(bucket[b]||1)-(bucket[a]||1)); }
function wrongTag(it,n){ if(n>=2) it.sub=(it.sub?it.sub+" · ":"")+`❗${n}회 틀림`; return it; }
// 오답 단어 플래시카드 덱 — 시험·드릴·퀴즈에서 틀린 단어 id 목록 (많이 틀린 순, synonyms 없는 단어도 포함)
function wrongWordIds(){
  const b=state.wrong.wk;
  return Object.keys(b).map(Number).filter(id=>WMAP.has(id))
    .sort((x,y)=>(b[y]||1)-(b[x]||1));
}
function buildWrongWK(){
  const b=state.wrong.wk, out=[];
  for(const k of wrongSorted(b)){ const w=WMAP.get(+k); if(!w||!(w.synonyms&&w.synonyms.length)) continue;
    const one=buildWKfor(w); if(one) out.push(wrongTag(one,b[k]||1)); }
  return out;
}
// 실전 형식: 보기 5개(A~E). 단어 문항은 항상 '의미가 가장 가까운 단어' 고르기 — 뜻(정의문) 고르기는 쓰지 않는다.
function buildWKfor(w){
  const correct=wkPickCorrect(w);
  if(!correct) return null;
  const dist=wkDistractors(w,correct,4);
  if(!dist) return null;
  const options=shuffle([correct,...dist.map(d=>d.t)]);
  return {section:"WK",
    prompt:"다음 단어와 의미가 가장 가까운 것은?",
    stem:w.word,
    sub:(w.pos||"")+(tierOf(w)==="high"?" · ⭐빈출":""),options,answer:options.indexOf(correct),
    wordId:w.id,tier:tierOf(w),explain:`${w.word} = ${w.kor||""}  ·  동의어: ${w.synonyms.slice(0,4).join(", ")}`};
}
function buildWrongVA(){
  const b=state.wrong.va;
  return wrongSorted(b).map(k=>ANALOGIES.find(a=>a.id===+k)).filter(Boolean)
    .map(a=>wrongTag(vaItem(a),b[a.id]||1));
}
function buildWrongRC(){
  const b=state.wrong.rc, out=[];
  for(const key of wrongSorted(b)){
    const [pid,qi]=key.split(":").map(Number); const p=READING.find(x=>x.id===pid);
    if(p&&p.questions[qi]) out.push(wrongTag(rcItem(p,qi),b[key]||1));
  }
  return out;
}
// Retest the exact wrong MCQ questions (산수/수학/과학), rebuilt from their pool by id.
function buildWrongMCQ(pool,section,bucket){
  const b=state.wrong[bucket]||{}; const map=new Map(pool.map(q=>[q.id,q]));
  return wrongSorted(b).map(k=>map.get(+k)).filter(Boolean).map(q=>wrongTag({
    section, prompt:q.q, promptKo:q.q_ko||"", stem:null, sub:q.topic||"", qid:q.id,
    options:q.options.slice(), answer:q.answer, explain:q.explain||""}, b[q.id]||1));
}
function buildWrongAV(){
  const b=state.wrong.av||{}; const map=new Map(AVIATION.map(q=>[q.id,q]));
  return wrongSorted(b).map(k=>map.get(+k)).filter(Boolean).map(q=>wrongTag({
    section:"AV", prompt:q.q, promptKo:q.q_ko||"", stem:null, sub:AVCAT[q.topic]||q.topic||"",
    avId:q.id, avTopic:q.topic, options:q.options.slice(), answer:q.answer, explain:q.explain||""}, b[q.id]||1));
}
const WRONG_BUILD={ wk:buildWrongWK, va:buildWrongVA, rc:buildWrongRC,
  ar:()=>buildWrongMCQ(ARITH,"AR","ar"), mk:()=>buildWrongMCQ(MATHK,"MK","mk"),
  ps:()=>buildWrongMCQ(PHYSCI,"PS","ps"), av:buildWrongAV };
const WRONG_META={ wk:["📇","단어"],va:["🔗","유추"],rc:["📖","독해"],
  ar:["➗","산수"],mk:["📐","수학"],ps:["🔬","과학"],av:["🛩️","항공"] };
const WRONG_ORDER=["wk","va","rc","ar","mk","ps","av"];
function renderExamSetup(){
  stopExamTimer(); examReleaseWake(); exam=null;   // 순서 중요: exam=null 먼저 하면 인터벌이 영영 안 죽는다
  $("#examSetup").classList.remove("hidden"); $("#examRun").classList.add("hidden"); $("#examResult").classList.add("hidden");
  $$("#examSetup .exam-preset").forEach(btn=>{
    let k=btn.dataset.exam;
    if(k==="afoqt"&&pilotPerfect()) k="afoqtCore"; // 시각과목 제외 버전으로 응시·표시
    const r=state.exams[k], el=btn.querySelector(".last"); if(!el) return;
    el.textContent=r?`최고 ${r.best}/${r.bestTotal} · 최근 ${r.last}/${r.lastTotal}`
      :(EXAM_PRESETS[k]?EXAM_PRESETS[k].label:""); });
  // wrong-note (오답 노트)
  const wc=wrongCounts();
  const rows=WRONG_ORDER.filter(k=>wc[k]>0).map(k=>{
    const rep=Object.values(state.wrong[k]||{}).filter(v=>v>=2).length;
    return `<button class="exam-preset" data-retest="${k}" style="padding:13px"><div class="ic" style="font-size:20px">${WRONG_META[k][0]}</div>
      <div class="meta"><b>${WRONG_META[k][1]} 오답</b><div class="muted">${wc[k]}문제 다시 풀기${rep?` · <span style="color:var(--warn)">❗2회+ ${rep}개</span>`:""}</div></div><div class="go">›</div></button>`; }).join("");
  $("#retestList").innerHTML=rows||`<div class="card center muted" style="padding:14px">아직 틀린 문제가 없어요. 모의고사를 보면 여기 쌓입니다.</div>`;
  $$("#retestList [data-retest]").forEach(b=>b.onclick=()=>startRetest(b.dataset.retest));
  const tot=WRONG_ORDER.reduce((s,k)=>s+wc[k],0); $("#retestAll").classList.toggle("hidden",tot===0);
  $("#retestAll").textContent=`🔁 전체 오답 재시험 (${tot}문제)`;
  renderRetestPicker(wc);
  injectMockUI();   // 🔒 실전 기출 모의고사 그룹 주입(잠금/해제 상태에 따라)
  renderSecPicker();
  // 하다 만 시험이 있으면 이어하기 배너
  { const box=$("#examResumeBox"), snap=loadExamSnap();
    if(box){ if(snap){
      const done=snap.answers.filter(a=>a!=null).length;
      const min=Math.round((Date.now()-(snap.savedAt||Date.now()))/60000);
      const ago=min<1?"방금":min<60?`${min}분 전`:`${Math.round(min/60)}시간 전`;
      box.classList.remove("hidden");
      box.innerHTML=`<div class="card" style="border-color:var(--gold);padding:14px;margin-bottom:14px">
        <b>⏸ 하다 만 시험이 있어요</b>
        <div class="muted" style="font-size:12.5px;margin:4px 0 10px">${esc(snap.name||"모의고사")} · ${done}/${snap.total}문항 답함 · ${ago} 저장</div>
        <div style="display:flex;gap:8px">
          <button class="btn primary sm" id="examResumeGo">▶︎ 이어서 풀기</button>
          <button class="btn ghost sm" id="examResumeDrop">버리기</button>
        </div></div>`;
      $("#examResumeGo").onclick=resumeExamSnap;
      $("#examResumeDrop").onclick=()=>{ if(confirm("저장된 시험을 버릴까요? 되돌릴 수 없어요.")){ clearExamSnap(); renderExamSetup(); } };
    } else { box.classList.add("hidden"); box.innerHTML=""; } } }
}
/* ---- 오답 노트: 과목 골라서 묶어 재시험 ---- */
let retestSel=new Set();
function renderRetestPicker(wc){
  const box=$("#retestPick"), wrap=$("#retestPickBox"); if(!box||!wrap) return;
  const avail=WRONG_ORDER.filter(k=>wc[k]>0);
  // 고를 게 2과목 이상일 때만 노출 (1과목이면 위 목록 버튼으로 충분)
  wrap.classList.toggle("hidden", avail.length<2);
  if(avail.length<2){ retestSel.clear(); return; }
  for(const k of [...retestSel]) if(!avail.includes(k)) retestSel.delete(k);  // 사라진 과목 정리
  box.innerHTML=avail.map(k=>{
    const rep=Object.values(state.wrong[k]||{}).filter(v=>v>=2).length;
    return `<button class="pick-chip ${retestSel.has(k)?"on":""}" data-rpick="${k}">
      <span class="pi">${WRONG_META[k][0]}</span><b>${WRONG_META[k][1]}</b>
      <span class="pm">${wc[k]}문제${rep?` · ❗${rep}`:""}</span></button>`; }).join("");
  $$("#retestPick [data-rpick]").forEach(b=>b.onclick=()=>{
    const k=b.dataset.rpick; if(retestSel.has(k)) retestSel.delete(k); else retestSel.add(k);
    renderRetestPicker(wc); });
  const chosen=WRONG_ORDER.filter(k=>retestSel.has(k));
  const n=chosen.reduce((s,k)=>s+wc[k],0);
  $("#retestPickSum").innerHTML = chosen.length
    ? `선택 <b>${chosen.length}과목</b> · 오답 <b>${n}문제</b>${n>60?' <span style="color:var(--warn)">(최대 60문제까지 출제)</span>':""}<br>
       <span style="font-size:11.5px">순서: ${chosen.map(k=>WRONG_META[k][1]).join(" → ")}</span>`
    : "과목을 선택하세요";
  $("#retestPickStart").disabled=chosen.length===0;
  $("#retestPickStart").textContent=chosen.length
    ? `선택한 ${chosen.length}과목 오답 재시험 (${Math.min(n,60)}문제)` : "선택한 과목 오답 재시험";
}
/* ============================================================
   과목 직접 고르기 — 원하는 과목만 골라 실전 형식(실전 문항수·과목별 제한시간)으로 응시
   ============================================================ */
// 실제 시험 순서 · 공식 문항 수
const PICK_ORDER=[["VA",25],["AR",25],["WK",25],["MK",25],["RC",25],["SJ",16],["PS",20],["AV",20],["TR",40],["IC",25],["BC",30]];
const PICK_ICON={VA:"🔗",AR:"➗",WK:"📇",MK:"📐",RC:"📖",SJ:"🧭",PS:"🔬",AV:"🛩️",TR:"📊",IC:"🎚️",BC:"🧱"};
let pickSel=new Set();
function renderSecPicker(){
  const box=$("#pickSecs"); if(!box) return;
  box.innerHTML=PICK_ORDER.map(([c,n])=>{
    const min=Math.round(SECRATE[c]*n/60);
    return `<button class="pick-chip ${pickSel.has(c)?"on":""}" data-pick="${c}">
      <span class="pi">${PICK_ICON[c]}</span><b>${SEC_KO[c]||c}</b>
      <span class="pm">${n}문항 · ${min}분</span></button>`; }).join("");
  $$("#pickSecs [data-pick]").forEach(b=>b.onclick=()=>{
    const c=b.dataset.pick; if(pickSel.has(c)) pickSel.delete(c); else pickSel.add(c);
    renderSecPicker(); });
  const chosen=PICK_ORDER.filter(([c])=>pickSel.has(c));
  const q=chosen.reduce((s,[,n])=>s+n,0), t=chosen.reduce((s,[c,n])=>s+SECRATE[c]*n,0);
  $("#pickSum").innerHTML = chosen.length
    ? `선택 <b>${chosen.length}과목</b> · <b>${q}문항</b> · <b>${fmtTime(t)}</b><br>
       <span style="font-size:11.5px">순서: ${chosen.map(([c])=>SEC_KO[c]||c).join(" → ")}</span>`
    : "과목을 선택하세요";
  $("#pickStart").disabled=chosen.length===0;
  $("#pickStart").textContent=chosen.length?`선택한 ${chosen.length}과목 시작 (${q}문항 · ${fmtTime(t)})`:"선택한 과목으로 시작";
}
function startPickedExam(){
  const specs=PICK_ORDER.filter(([c])=>pickSel.has(c));
  if(!specs.length) return;
  if(!confirmDropExamSnap()) return;
  const name=specs.length===1 ? `${SEC_KO[specs[0][0]]} 모의고사`
    : `선택 모의고사 (${specs.map(([c])=>SEC_KO[c]||c).join("·")})`;
  const p=composeMock(name, specs, "직접 선택");
  const items=p.build();
  if(items.length<3){ toast("문제를 만들 데이터가 부족해요."); return; }
  exam={key:null,name:p.name,items,idx:0,answers:new Array(items.length).fill(null),
        secsLeft:p.secs,startSecs:p.secs,total:items.length,submitted:false,timerId:null};
  if(specs.length>1) buildExamSections(exam);   // 과목별 타이머
  $$(".view").forEach(v=>v.classList.remove("active")); $("#view-exam").classList.add("active");
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go==="home"));
  window.scrollTo(0,0);
  $("#examSetup").classList.add("hidden"); $("#examResult").classList.add("hidden"); $("#examRun").classList.remove("hidden");
  startExamTimer(); renderExamQ();
}
function startExam(key,opts){
  if(!confirmDropExamSnap()) return;
  if(key==="afoqt"&&pilotPerfect()) key="afoqtCore"; // 시각과목은 외부 앱에서 — 코어만 응시
  const p=EXAM_PRESETS[key]; if(!p) return;
  const items=p.build();
  if(items.length<3){ toast("문제를 만들 데이터가 부족해요."); return; }
  const practice=!!(opts&&opts.practice);
  const secs=practice ? Math.round(p.secs*2.2) : p.secs;
  exam={key,name:p.name,items,idx:0,answers:new Array(items.length).fill(null),
        secsLeft:secs,startSecs:secs,total:items.length,submitted:false,timerId:null,
        practice:practice||undefined};
  // 실전 AFOQT처럼 서브테스트마다 자기 시계를 준다(전체 통합 타이머 대신).
  // 시간이 끝난 섹션은 닫히고 다음 섹션으로 — 이전 섹션으로 되돌아갈 수 없다.
  // (기출 mock처럼 specs가 없어도 문항이 다과목이면 섹션 타이머를 붙인다)
  if(!practice && new Set(items.map(it=>it.section)).size>1) buildExamSections(exam);
  // Activate the exam view directly — do NOT call go("exam") here, since that
  // re-runs renderExamSetup() and would wipe the exam we just built.
  $$(".view").forEach(v=>v.classList.remove("active")); $("#view-exam").classList.add("active");
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go==="home"));
  window.scrollTo(0,0);
  $("#examSetup").classList.add("hidden"); $("#examResult").classList.add("hidden"); $("#examRun").classList.remove("hidden");
  startExamTimer(); renderExamQ();
}
function fmtTime(s){ s=Math.max(0,s|0); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }
/* ---- 섹션별 타이머 (실전 AFOQT 방식) ----
   문항을 과목 블록으로 묶고 각 블록에 공식 배분 시간을 준다. 한 섹션이 끝나면
   다음 섹션으로 넘어가고, 이전 섹션으로는 되돌아갈 수 없다. */
function buildExamSections(e){
  const secs=[]; let cur=null;
  e.items.forEach((it,i)=>{
    if(!cur||cur.code!==it.section){ cur={code:it.section,from:i,to:i,secs:0}; secs.push(cur); }
    cur.to=i; cur.secs+=SECRATE[it.section]||30;
  });
  if(secs.length<2) return false;               // 단일 과목이면 기존 통합 타이머 유지
  secs.forEach(s=>{ s.secs=Math.round(s.secs); s.left=s.secs; });
  e.sections=secs; e.secIdx=0; e.idx=secs[0].from;
  return true;
}
function curExamSec(){ return (exam&&exam.sections)?exam.sections[exam.secIdx]:null; }
// 섹션 종료 → 다음 섹션으로 (마지막이면 최종 채점)
function advanceExamSection(auto){
  const e=exam; if(!e||!e.sections||e.submitted) return;
  const s=e.sections[e.secIdx];
  if(!auto){ const un=e.answers.slice(s.from,s.to+1).filter(a=>a==null).length;
    if(un && !confirm(`이 섹션에서 ${un}문제를 안 풀었어요.\n다음 섹션으로 넘어가면 되돌아올 수 없어요. 계속할까요?`)) return; }
  s.leftAtDone=Math.max(0,s.left); s.autoOut=!!auto;   // 결과 화면용: 실제 남긴 시간·시간초과 여부 보존
  s.left=0; s.done=true;
  e.times=e.times||new Array(e.total).fill(0);
  if(e._openIdx!=null&&e._openAt){ e.times[e._openIdx]+=Date.now()-e._openAt; e._openIdx=null; }
  if(e.secIdx>=e.sections.length-1){ submitExam(true); return; }
  e.secIdx++; e.idx=e.sections[e.secIdx].from;
  saveExamSnap();
  updateTimerUI();                                  // 새 섹션 시간을 즉시 반영
  const nx=e.sections[e.secIdx];
  toast(`${auto?"⏰ 시간 종료":"✅ 완료"} · 다음 섹션 → ${SEC_KO[nx.code]||nx.code} ${nx.to-nx.from+1}문항 ${Math.round(nx.secs/60)}분`, 3000);
  window.scrollTo(0,0); renderExamQ();
}
function startExamTimer(){ stopExamTimer(); updateTimerUI();
  examAcquireWake(); saveExamStatic(); saveExamSnap();   // 중단 복구용 스냅샷(정적 1회+동적) + 화면 꺼짐 방지
  exam.timerId=setInterval(()=>{ if(!exam) return stopExamTimer();
    const s=curExamSec();
    if(s){ s.left--; updateTimerUI(); if(s.left<=0) advanceExamSection(true); }
    else { exam.secsLeft--; updateTimerUI(); if(exam.secsLeft<=0) submitExam(true); }
    if(exam&&!exam.submitted&&((exam._tick=(exam._tick||0)+1)%5===0)) saveExamSnap();  // 5초마다 남은 시간 갱신
  },1000); }
function stopExamTimer(){ if(exam&&exam.timerId){ clearInterval(exam.timerId); exam.timerId=null; } }
/* ---- 시험 중단 복구 + 화면 꺼짐 방지 ----
   진행 중 시험을 로컬에만 스냅샷(동기화 X — 문항 전체 포함이라 크다). 앱이 죽거나
   화면이 꺼져도 모의고사 화면의 "이어서 풀기"로 그 자리부터 재개된다. */
const EXAM_SAVE_KEY="afoqt_exam_save_v1";        // 정적부: 문항 전체 (시험 시작 시 1회만 기록 — 크다)
const EXAM_SAVE_DYN=EXAM_SAVE_KEY+"_d";           // 동적부: 답·위치·남은시간 (답할 때마다 — 작다)
let examWake=null;
async function examAcquireWake(){ try{ if("wakeLock" in navigator && !examWake){ const wl=await navigator.wakeLock.request("screen");
  // 요청이 오래 걸려 그 사이 시험이 끝났으면 즉시 반납 (release 이후 도착하는 lock 누수 방지)
  if(!exam||exam.submitted){ try{ wl.release&&wl.release(); }catch(e2){} return; }
  examWake=wl; examWake.addEventListener&&examWake.addEventListener("release",()=>{ examWake=null; }); } }catch(e){} }
function examReleaseWake(){ try{ examWake&&examWake.release&&examWake.release(); }catch(e){} examWake=null; }
function saveExamStatic(){
  const e=exam; if(!e||e.submitted) return;
  try{
    const snap={key:e.key,name:e.name,items:e.items,total:e.total,learn:!!e.learn,
      practice:!!e.practice,startSecs:e.startSecs,savedAt:Date.now()};
    if(e.sections) snap.sections=e.sections.map(s=>({code:s.code,from:s.from,to:s.to,secs:s.secs}));
    localStorage.setItem(EXAM_SAVE_KEY,JSON.stringify(snap));
  }catch(err){ clearExamSnap(); }   // quota 초과 등 — 옛 스냅샷이 남아 엉뚱한 시험이 복원되는 것 방지
}
function saveExamSnap(){
  const e=exam; if(!e||e.submitted) return;
  try{
    const dyn={answers:e.answers,idx:e.idx,secsLeft:e.secsLeft,times:e.times||null,savedAt:Date.now()};
    if(e.sections){ dyn.secIdx=e.secIdx;
      dyn.secDyn=e.sections.map(s=>({left:s.left,done:!!s.done,leftAtDone:s.leftAtDone,autoOut:!!s.autoOut})); }
    localStorage.setItem(EXAM_SAVE_DYN,JSON.stringify(dyn));
  }catch(err){ clearExamSnap(); }
}
function clearExamSnap(){ try{ localStorage.removeItem(EXAM_SAVE_KEY); localStorage.removeItem(EXAM_SAVE_DYN); }catch(e){} }
function loadExamSnap(){
  try{
    const st=JSON.parse(localStorage.getItem(EXAM_SAVE_KEY)||"null");
    const dyn=JSON.parse(localStorage.getItem(EXAM_SAVE_DYN)||"null");
    if(!(st&&st.items&&st.items.length&&dyn&&dyn.answers)) return null;
    if(Date.now()-(dyn.savedAt||0)>48*3600*1000) return null;   // 이틀 지난 시험은 만료
    return {...st,...dyn};
  }catch(e){ return null; }
}
// 새 시험 시작이 하다 만 시험(답 1개 이상)을 지우게 될 때는 물어본다
function confirmDropExamSnap(){
  const s=loadExamSnap(); if(!s) return true;
  const done=(s.answers||[]).filter(a=>a!=null).length;
  if(!done) return true;
  return confirm(`⏸ 하다 만 시험이 있어요 — "${s.name||"모의고사"}" ${done}/${s.total}문항.\n새 시험을 시작하면 사라져요. 계속할까요?`);
}
function resumeExamSnap(){
  const s=loadExamSnap(); if(!s){ toast("이어할 시험이 없어요."); renderExamSetup(); return; }
  exam={key:s.key,name:s.name,items:s.items,idx:s.idx||0,answers:s.answers,
    secsLeft:s.secsLeft,startSecs:s.startSecs,total:s.total,submitted:false,timerId:null,
    times:s.times||undefined};
  if(s.learn) exam.learn=true;
  if(s.practice) exam.practice=true;
  if(s.sections){
    exam.sections=s.sections.map((b,i)=>{ const d=(s.secDyn||[])[i]||{};
      return {...b,left:d.left!=null?d.left:b.secs,done:!!d.done,leftAtDone:d.leftAtDone,autoOut:!!d.autoOut}; });
    exam.secIdx=s.secIdx||0;
  }
  $$(".view").forEach(v=>v.classList.remove("active")); $("#view-exam").classList.add("active");
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go==="home"));
  window.scrollTo(0,0);
  $("#examSetup").classList.add("hidden"); $("#examResult").classList.add("hidden"); $("#examRun").classList.remove("hidden");
  startExamTimer(); renderExamQ();
  toast("⏸ 저장된 지점부터 이어서 시작해요.");
}
function updateTimerUI(){ const t=$("#examTimer"); if(!t||!exam) return;
  if(exam.learn){ t.textContent="📚 연습"; t.classList.remove("warn"); }  // 학습 모드: 카운트다운 숨김
  else { const s=curExamSec(), left=s?s.left:exam.secsLeft;   // 섹션 타이머가 있으면 그 섹션 시간
    t.textContent=fmtTime(left); t.classList.toggle("warn",left<=30); }
  // 문항별 스톱워치 칩: 목표(실전 배분) 초과 시 색 경고
  const chip=$("#qTimeChip"), e=exam;
  if(chip&&!e.submitted&&e._openAt&&e.times){
    const sec=Math.round(((e.times[e.idx]||0)+(Date.now()-e._openAt))/1000);
    const tgt=SECRATE[(e.items[e.idx]||{}).section]||30;
    chip.textContent=`⏱ ${sec}초 / ${tgt}초`; chip.classList.toggle("over",sec>tgt); } }
function renderExamQ(){
  const e=exam; if(!e) return;
  const sec=curExamSec();
  e.idx = sec ? clamp(e.idx, sec.from, sec.to) : clamp(e.idx,0,e.total-1);
  const it=e.items[e.idx];
  // 문항별 소요시간 추적: 화면에 떠 있던 문항의 구간을 닫고 새 문항 구간을 연다.
  const nowT=Date.now(); e.times=e.times||new Array(e.total).fill(0);
  if(e._openIdx!=null&&e._openIdx!==e.idx&&!e.submitted) e.times[e._openIdx]+=nowT-e._openAt;
  if(e._openIdx!==e.idx){ e._openIdx=e.idx; e._openAt=nowT; }
  if(sec){ const n=sec.to-sec.from+1, pos=e.idx-sec.from+1;
    $("#examCount").textContent=`${pos} / ${n}`;
    $("#examBar").style.width=((pos-1)/n*100)+"%"; }
  else { $("#examCount").textContent=`${e.idx+1} / ${e.total}`;
    $("#examBar").style.width=(e.idx/e.total*100)+"%"; }
  // Section label + (for multi-section mocks) progress within the current section.
  const secKo=SEC_KO[it.section]||it.section;
  const multiSec=e._multiSec!=null?e._multiSec:(e._multiSec=new Set(e.items.map(x=>x.section)).size>1);
  let secChip=secKo;
  if(multiSec){ const secTotal=e.items.filter(x=>x.section===it.section).length;
    const secPos=e.items.slice(0,e.idx+1).filter(x=>x.section===it.section).length;
    secChip=`${secKo} ${secPos}/${secTotal}`; }
  const samePrev=e.idx>0&&e.items[e.idx-1]?.passageId===it.passageId;
  const passage=it.passageText?`<details class="exam-passage" ${samePrev?"":"open"}>
      <summary>📖 ${esc(it.passageTitle||"지문")} (탭하여 펼치기)</summary>
      <div class="passage">${esc(it.passageText)}</div></details>`:"";
  const stem=it.stem?(it.section==="WK"
      ? `<div class="word-row"><div class="exam-stem">${esc(it.stem)}</div>${spkBtn(it.stem)}</div>`
      : `<div class="exam-stem">${esc(it.stem)}</div>`):"";
  const sub=it.sub?`<div class="exam-sub">${esc(it.sub)}</div>`:"";
  const ko=(it.promptKo&&!flag("hide_ko"))?`<div class="exam-ko">${esc(it.promptKo)}</div>`:"";
  // Visual subtests (Table Reading / Instrument / Block Counting) carry a pre-built
  // figure (table or SVG) and, for Instrument, picture options rendered via optionsHTML.
  const figure=it.figureHTML?`<div class="exam-figure">${it.figureHTML}</div>`:"";
  // 학습 모드(유형 드릴): 답하면 즉시 정답 색·해설을 보여주고 수동으로 넘어간다.
  const revealed = e.learn && e.answers[e.idx]!=null;
  const choicesHTML=it.options.map((o,i)=>{
    const inner=it.optionsHTML?it.optionsHTML[i]:fmtMath(o);
    let cls=e.answers[e.idx]===i?"sel":"";
    if(revealed){ if(i===it.answer) cls="correct"; else if(i===e.answers[e.idx]) cls="wrong"; }
    return `<button class="choice ${it.optionsHTML?"choice-fig":""} ${cls}" data-i="${i}" ${revealed?"disabled":""}>${inner}</button>`;
  }).join("");
  const tgtSec=SECRATE[it.section]||30;
  const okAns = revealed && e.answers[e.idx]===it.answer;
  const explainHTML = revealed
    ? `<div class="exam-explain ${okAns?"ok":"no"}">
         <div class="ee-head">${okAns?"✅ 정답":"❌ 오답 · 정답: "+fmtMath(it.options[it.answer])}</div>
         ${it.explain?`<div class="ee-body">${fmtMath(it.explain)}</div>`:""}
         <button class="btn primary" id="drillNext" style="margin-top:12px">${e.idx>=e.total-1?"채점·결과 보기 →":"다음 문제 →"}</button>
       </div>`
    : "";
  // 섹션 배너: 지금 몇 번째 과목인지 + 그 과목의 공식 문항수·배분 시간
  const secBanner = sec ? `<div class="sec-banner">
      <div><b>섹션 ${e.secIdx+1}/${e.sections.length} · ${SEC_KO[sec.code]||sec.code}</b>
        <span class="muted"> ${sec.to-sec.from+1}문항 · ${Math.round(sec.secs/60)}분</span></div>
      <div class="muted">전체 ${e.idx+1}/${e.total}</div></div>` : "";
  $("#examArea").innerHTML=`${secBanner}${passage}<div class="card">
    <span class="exam-sec">${secChip}</span><span class="qtime" id="qTimeChip">⏱ 0초 / ${tgtSec}초</span>
    <div class="exam-prompt">${fmtMath(it.prompt)}</div>${ko}${stem}${sub}${figure}
    <div class="choices ${it.optionsHTML?"choices-fig":""}" id="examChoices">${choicesHTML}</div>${explainHTML}</div>`;
  wireSpeakers($("#examArea"));
  $$("#examChoices .choice").forEach(btn=>btn.onclick=()=>{
    if(e.learn && e.answers[e.idx]!=null) return;           // 이미 답함 — 잠금
    e.answers[e.idx]=+btn.dataset.i;
    if(e.learn){ refreshExamGrid(); saveExamSnap(); renderExamQ(); return; } // 즉시 해설 노출
    $$("#examChoices .choice").forEach(b=>b.classList.toggle("sel",b===btn));
    refreshExamGrid(); saveExamSnap();
    const lastIdx = sec ? sec.to : e.total-1;                 // 섹션 안에서만 자동 진행
    if(e.idx<lastIdx){ setTimeout(()=>{ const s2=curExamSec(), lim=s2?s2.to:exam.total-1;
      if(exam&&!exam.submitted&&exam.idx<lim){ exam.idx++; renderExamQ(); } },160); }
  });
  const dn=$("#drillNext"); if(dn) dn.onclick=()=>{
    if(e.idx>=e.total-1) submitExam(false);
    else { e.idx++; renderExamQ(); } };
  $("#examPrev").disabled = sec ? e.idx<=sec.from : e.idx===0;
  $("#examNext").disabled = sec ? e.idx>=sec.to   : e.idx>=e.total-1;
  const sb=$("#examSubmit");
  if(sb) sb.textContent = sec ? (e.secIdx<e.sections.length-1 ? "섹션 제출 →" : "최종 제출") : "제출";
  renderExamGrid();
}
function renderExamGrid(){
  const e=exam, s=curExamSec();
  const from=s?s.from:0, to=s?s.to:e.total-1;                 // 현재 섹션 문항만 표시
  let html="";
  for(let i=from;i<=to;i++) html+=`<button data-i="${i}" class="${e.answers[i]!=null?"answered":""} ${i===e.idx?"cur":""}">${i-from+1}</button>`;
  $("#examGrid").innerHTML=html;
  $$("#examGrid button").forEach(b=>b.onclick=()=>{ e.idx=+b.dataset.i; renderExamQ(); });
}
function refreshExamGrid(){ const e=exam; const b=$(`#examGrid button[data-i="${e.idx}"]`); if(b) b.classList.add("answered"); }
// Record a graded item into the wrong-note and weakness stats.
// Per-subtest accuracy tally for predicted composite scores.
function recordSecAcc(sec,ok){ if(!sec) return; const o=state.secAcc[sec]||(state.secAcc[sec]={c:0,w:0}); if(ok)o.c++; else o.w++;
  // 날짜별·과목별 풀이 수 — 30일 플랜의 '오늘 할 일' 자동 체크에 사용
  const day=todayStr(), ds=state.dayStats[day]||(state.dayStats[day]={}); ds[sec]=(ds[sec]||0)+1; }
function recordResult(it,ok){
  const W=state.wrong, K=state.weak;
  recordSecAcc(it.section, ok);
  const bump=(obj,cat)=>{ const o=obj[cat]||(obj[cat]={c:0,w:0}); if(ok)o.c++; else o.w++; };
  // per-topic weakness for the topic-based MCQ subtests
  const topic=(it.section==="AV"?it.avTopic:it.sub)||"";
  if(["AR","MK","PS","AV"].includes(it.section)&&topic) bump(K.topic||(K.topic={}), it.section+":"+topic);
  // 오답 노트는 틀린 '횟수'를 누적한다(1→2→…) — 반복해서 틀리는 문제를 강조·우선 재출제.
  if(it.section==="WK"&&it.wordId!=null){
    if(ok) delete W.wk[it.wordId]; else W.wk[it.wordId]=(W.wk[it.wordId]||0)+1;
    bump(K.wkTier, it.tier||"std");
    state.wkSeen[it.wordId]=Date.now();        // coverage + 중복 회피용 시각
  } else if(it.section==="VA"&&it.anaId!=null){
    if(ok) delete W.va[it.anaId]; else W.va[it.anaId]=(W.va[it.anaId]||0)+1;
    bump(K.vaRel, it.relation||"기타");
    const v={...getVA(it.anaId)}; v.seen=(v.seen||0)+1; if(ok)v.correct=(v.correct||0)+1; else v.wrong=(v.wrong||0)+1; setVA(it.anaId,v);
  } else if(it.section==="RC"&&it.passageId!=null&&READING.some(p=>p.id===Number(it.passageId))){
    // 기출(mock) 지문은 READING 풀에 없어 오답노트에 넣어도 재출제 불가 — 앱 풀 지문만 기록
    const key=it.passageId+":"+(it.qIdx||0);
    if(ok) delete W.rc[key]; else W.rc[key]=(W.rc[key]||0)+1;
    bump(K.rcType, it.qType||"detail");
    const r={...getRC(it.passageId)}; r.seen=true; setRC(it.passageId,r);  // coverage
  } else if(it.section==="AV"&&it.avId!=null){
    state.avp[it.avId]=Date.now();             // coverage + 중복 회피용 시각
    if(ok) delete W.av[it.avId]; else W.av[it.avId]=(W.av[it.avId]||0)+1;
  } else if(["AR","MK","PS"].includes(it.section)&&it.qid!=null){
    const sec=it.section.toLowerCase();
    const b=W[sec]; if(b){ if(ok) delete b[it.qid]; else b[it.qid]=(b[it.qid]||0)+1; }
    (state.qSeen[sec]||(state.qSeen[sec]={}))[it.qid]=Date.now();   // 중복 출제 방지
  }
}
function wrongCounts(){ const c={}; for(const k of WRONG_ORDER) c[k]=Object.keys(state.wrong[k]||{}).length; return c; }
// kind: 과목 코드 하나("wk") | 코드 배열(["wk","rc"]) | 그 외("all") = 전체
function startRetest(kind){
  const list = Array.isArray(kind) ? kind.filter(k=>WRONG_BUILD[k])
             : (WRONG_BUILD[kind] ? [kind] : WRONG_ORDER);
  // 여러 과목이면 실전 순서(WRONG_ORDER)대로 묶어 과목별 타이머가 붙게 한다
  const ordered = WRONG_ORDER.filter(k=>list.includes(k));
  let items = ordered.flatMap(k=>WRONG_BUILD[k]());
  if(items.length<1){ toast("오답이 없어요 👍"); return; }
  if(!confirmDropExamSnap()) return;
  items=items.slice(0,60);
  const name = ordered.length===1 ? `${WRONG_META[ordered[0]][1]} 오답 재시험`
    : ordered.length<WRONG_ORDER.length ? `오답 재시험 (${ordered.map(k=>WRONG_META[k][1]).join("·")})`
    : "오답 재시험";
  const secs=Math.max(120, items.length*25);
  exam={key:null,name,items,idx:0,answers:new Array(items.length).fill(null),
        secsLeft:secs,startSecs:secs,total:items.length,submitted:false,timerId:null};
  if(ordered.length>1) buildExamSections(exam);   // 주석대로: 다과목이면 과목별 타이머
  $$(".view").forEach(v=>v.classList.remove("active")); $("#view-exam").classList.add("active");
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go==="home"));
  window.scrollTo(0,0);
  $("#examSetup").classList.add("hidden"); $("#examResult").classList.add("hidden"); $("#examRun").classList.remove("hidden");
  startExamTimer(); renderExamQ();
}
/* ============================================================
   시험 전 요약 시트 — 공식·관계유형·항공핵심·어근을 한 페이지로
   (유추 관계·어근은 실제 데이터에서 빈도순 자동 집계)
   ============================================================ */
let csFrom="exam";
function openCheatsheet(from){ if(from) csFrom=from; go("cheatsheet"); }
const CS_MATH=[
 ["백분율·비율",[
   "x% = x/100 · 부분 = 전체 * 비율",
   "증감률(%) = 변화량/원래값 * 100",
   "비례식 a:b = c:d ⇔ ad = bc",
 ]],
 ["평균·통계",[
   "평균 = 합 ÷ 개수 → 합 = 평균 * 개수",
   "가중평균 = (n_1x_1 + n_2x_2) ÷ (n_1 + n_2)",
   "중앙값 = 정렬 후 가운데 (짝수 개면 두 값 평균) · 최빈값 = 가장 잦은 값 · 범위 = 최대 - 최소",
   "이상값은 평균만 크게 흔든다 (중앙값은 튼튼)",
 ]],
 ["속력·거리·시간",[
   "거리 = 속력 * 시간 (d = rt)",
   "평균속력 = 총거리 ÷ 총시간 (속력 두 개의 평균이 아님!)",
   "마주 보고 접근 → 속력의 합 · 같은 방향 추격 → 속력의 차",
 ]],
 ["일률·혼합",[
   "함께 일하면 1/T = 1/A + 1/B",
   "농도(%) = 용질/전체 * 100 · 혼합: C_1V_1 + C_2V_2 = C(V_1+V_2)",
 ]],
 ["이자",[
   "단리: 이자 = P*r*t",
   "복리: A = P(1+r)^n",
 ]],
 ["지수·제곱근",[
   "a^m * a^n = a^{m+n} · (a^m)^n = a^{mn} · a^{-n} = 1/a^n · a^0 = 1",
   "sqrt(ab) = sqrt(a) * sqrt(b) · sqrt(a/b) = sqrt(a)/sqrt(b)",
 ]],
 ["대수",[
   "a^2 - b^2 = (a+b)(a-b) · (a+b)^2 = a^2 + 2ab + b^2",
   "근의 공식: x = (-b ± sqrt(b^2 - 4ac)) / 2a",
   "부등식: 음수를 곱하거나 나누면 부호가 뒤집힌다",
 ]],
 ["기하",[
   "삼각형 내각 합 180° · 피타고라스 a^2 + b^2 = c^2",
   "특수 직각삼각형: 3-4-5 · 5-12-13 · 45°(1:1:sqrt(2)) · 30-60°(1:sqrt(3):2)",
   "원: 둘레 2*pi*r · 넓이 pi*r^2 · 부채꼴은 중심각/360° 비례",
   "사다리꼴 = (윗변+아랫변)*높이 ÷ 2 · 원기둥 V = pi*r^2h · 구 V = 4/3 pi*r^3",
   "직육면체 대각선 = sqrt(a^2 + b^2 + c^2)",
 ]],
 ["확률·경우의 수",[
   "순열 nPr = n!/(n-r)! · 조합 nCr = n!/(r!(n-r)!)",
   "독립 사건은 확률을 곱하고, 배반 사건은 더한다",
 ]],
];
/* 단위 환산 — AFOQT 산수·수학은 미국 관습단위로 나오므로 이 표를 모르면 못 푼다.
   실제 시험에는 환산표가 주어지지 않는다. */
const CS_UNITS=[
 ["길이",[
   "1 ft = 12 in · 1 yd = 3 ft = 36 in",
   "1 mile = 5,280 ft = 1,760 yd",
   "1 in = 2.54 cm · 1 m ≈ 3.28 ft · 1 km ≈ 0.62 mile",
 ]],
 ["넓이",[
   "1 sq ft = 144 sq in · 1 sq yd = 9 sq ft",
   "1 acre = 4,840 sq yd = 43,560 sq ft",
   "길이가 n배면 넓이는 n^2배 (단위 환산도 제곱!)",
 ]],
 ["부피·액량",[
   "1 cup = 8 fl oz · 1 pint = 2 cups = 16 fl oz",
   "1 quart = 2 pints = 4 cups = 32 fl oz",
   "1 gallon = 4 quarts = 8 pints = 128 fl oz",
   "1 cu ft = 1,728 cu in · 1 cu yd = 27 cu ft",
   "1 gallon ≈ 231 cu in · 1 cu ft ≈ 7.5 gallons",
   "1 tbsp = 3 tsp · 1 L ≈ 1.06 quart",
 ]],
 ["무게",[
   "1 lb = 16 oz · 1 ton = 2,000 lb",
   "1 kg ≈ 2.2 lb · 물 1 gallon ≈ 8.34 lb",
 ]],
 ["시간",[
   "1 hr = 60 min = 3,600 sec · 1 day = 24 hr = 1,440 min",
   "1 week = 7 days · 1 year = 12 months = 52 weeks",
   "분→시간은 ÷60 (예: 45분 = 0.75시간) — 소수로 바꿔야 곱셈이 편하다",
 ]],
 ["속도",[
   "60 mph = 88 ft/sec  ← 외워두면 즉시 변환된다",
   "mph → ft/sec 는 * 22/15 · ft/sec → mph 는 * 15/22",
   "mph = miles ÷ hours (분이면 * 60/분)",
 ]],
 ["온도",[
   "°F = (9/5)°C + 32 · °C = (5/9)(°F - 32)",
   "-40°는 화씨·섭씨가 같은 유일한 온도",
 ]],
 ["환산하는 법",[
   "단위를 분수로 곱해 소거한다: 60 mi/hr * (5,280 ft/mi) ÷ (3,600 s/hr) = 88 ft/s",
   "곱할지 나눌지 헷갈리면 '없애려는 단위가 약분되는 방향'으로 세운다",
   "큰 단위 → 작은 단위는 곱하기, 작은 단위 → 큰 단위는 나누기",
 ]],
];
const CS_AV=[
 "4가지 힘: 양력↔중력 · 추력↔항력 — 등속 수평비행이면 네 힘이 평형",
 "3축 조종: 롤(세로축)=에일러론 · 피치(가로축)=엘리베이터 · 요(수직축)=러더",
 "플랩 = 양력·항력 동시 증가(저속 이착륙용) · 트림 = 조종간 힘 경감",
 "실속 = 받음각(AOA)이 임계각 초과 — 속도가 아니라 '각도' 문제 · 회복은 기수를 낮춰 AOA 감소",
 "계기 6팩: 피토·정압계 → 속도계·고도계·승강계 / 자이로계 → 자세계·기수방위계·선회경사계",
 "피토관 막힘 → 속도계 이상 · 정압구 막힘 → 고도계·승강계·속도계까지 영향",
 "V속도: V_{S0} 착륙형상 실속 · V_{S1} 클린 실속 · V_X 최대상승각 · V_Y 최대상승률 · V_{NE} 초과 금지",
 "좌선회 경향(P-팩터·토크·나선 후류·자이로 세차) → 고출력·저속(이륙)에서 오른쪽 러더",
 "밀도고도 상승(고온·고고도·다습) = 공기 희박 → 양력·엔진·프로펠러 성능 모두 감소",
 "카뷰레터 결빙: 습하고 서늘한 날 출력 감소 → 카브 히트 (외기 20°C여도 발생 가능)",
 "고도계: 고기압→저기압으로 비행하면 실제보다 높게 지시 — 'High to Low, look out below'",
 "장주 패턴: 다운윈드 → 베이스 → 파이널 · 무관제 비행장에서는 CTAF 방송",
 "라이트 건(무선 두절 시): 녹색 점등 = 착륙 허가 · 적색 점등 = 양보하고 계속 선회 · 적색 점멸 = 착륙 금지",
 "산소 규정: 12,500ft 초과 30분 이상 → 승무원 산소 사용 · 14,000ft 초과 → 상시 사용",
];
// 시험 전날 체크리스트 — 하루 단위로 리셋되는 로컬 체크 (전날 밤 루틴용)
const EVE_CHK=[
  ["retest","전 과목 오답 재시험 한 바퀴","🔁","retest"],
  ["wrongdeck","오답 단어 플래시카드 끝내기","📛","wrongdeck"],
  ["sheet","이 요약 시트 전체 훑기 (공식·단위·관계유형·항공)","📜",null],
  ["pilot","표읽기·블록·계기 — 외부 앱에서 마무리 연습","🎛️",null],
  ["pack","준비물 챙기기 — 신분증·시험 안내문·물","🎒",null],
  ["sleep","일찍 자기 — 오늘 밤부터 새 문제 금지, 훑기만","😴",null],
];
function renderCheatsheet(){
  const box=$("#csBody"); if(!box) return;
  const evOpenPrev=(box.querySelector("#csEve")||{}).open;   // 재렌더 시 접힘 상태 유지
  const ec=state.evechk||(state.evechk={date:todayStr(),done:{}});
  if(ec.date!==todayStr()){ ec.date=todayStr(); ec.done={}; }
  const ed=(state.settings||{}).exam_date;
  const dd=ed?Math.ceil((new Date(ed)-new Date(todayStr()))/86400000):null;
  const eveDone=EVE_CHK.filter(([k])=>ec.done[k]).length;
  const eveRows=EVE_CHK.map(([k,t,ic,act])=>`<button class="eve-row ${ec.done[k]?"on":""}" data-eve="${k}">
    <span class="ck">${ec.done[k]?"✅":"⬜"}</span><span>${ic}</span><span class="tx">${esc(t)}</span>
    ${act?`<span class="golink" data-evego="${act}">가기 ›</span>`:""}</button>`).join("");
  const eveOpen = evOpenPrev!==undefined ? evOpenPrev : (dd!=null&&dd<=1);
  const eveBlock=`<details class="cs-sec" id="csEve" ${eveOpen?"open":""}>
    <summary>🌙 시험 전날 체크리스트 ${eveDone}/${EVE_CHK.length}${dd!=null?` · <b>D-${Math.max(0,dd)}</b>`:""}</summary>
    ${eveRows}<div class="guide-src">체크는 날짜가 바뀌면 자동으로 초기화돼요 — 시험 전날 밤 이 목록만 순서대로.</div></details>`;
  const rel={};
  for(const a of ANALOGIES){ const k=a.relKo||a.relation||"기타"; (rel[k]=rel[k]||{n:0,ex:null}).n++; if(!rel[k].ex&&a.stem) rel[k].ex=a; }
  const relRows=Object.entries(rel).sort((x,y)=>y[1].n-x[1].n).slice(0,14)
    .map(([k,v])=>`<tr><td><b>${esc(k)}</b></td><td class="muted">${v.ex?esc(v.ex.stem[0]+" : "+v.ex.stem[1]):""}</td><td class="muted" style="text-align:right">${v.n}</td></tr>`).join("");
  if(!ROOTIDX) buildRootIndex();
  const roots=Object.entries(ROOTIDX||{}).map(([f,e])=>({f,m:e.m,n:e.ids.length,ex:e.ids.slice(0,2).map(id=>(WMAP.get(id)||{}).word).filter(Boolean)}))
    .sort((a,b)=>b.n-a.n).slice(0,24);
  const rootRows=roots.map(r=>`<tr><td><b>${esc(r.f)}</b></td><td>${esc(r.m)}</td><td class="muted">${esc(r.ex.join(", "))}</td></tr>`).join("");
  const paceRows=[["WK","단어",25,5],["VA","유추",25,8],["RC","독해",25,24],["AR","산수",25,29],["MK","수학",25,22],
    ["SJ","상황판단",16,35],["PS","물리과학",20,10],
    ["AV","항공",20,8],["TR","표읽기",40,7],["IC","계기",25,5],["BC","블록",30,5]]
    .map(([c,ko,n,min])=>`<tr><td>${ko}</td><td class="muted">${n}문항 · ${min}분</td><td style="text-align:right"><b>${SECRATE[c]}초</b>/문항</td></tr>`).join("");
  const unitBlocks=CS_UNITS.map(([t,rows])=>`<div class="cs-sub">${esc(t)}</div>${rows.map(r=>`<div class="cs-f">${fmtMath(r)}</div>`).join("")}`).join("");
  const mathBlocks=CS_MATH.map(([t,rows])=>`<div class="cs-sub">${esc(t)}</div>${rows.map(r=>`<div class="cs-f">${fmtMath(r)}</div>`).join("")}`).join("");
  box.innerHTML=`
    <div class="hintbox" style="margin-bottom:14px">시험 전날 밤·시험장 가는 길에 한 번 훑는 용도예요. 제목을 누르면 접혔다 펴져요.</div>
    ${eveBlock}
    <details class="cs-sec" open><summary>⏱️ 과목별 시간 배분</summary><table class="cs-table">${paceRows}</table>
      <div class="guide-src">AFOQT는 오답 감점이 없어요 — 시간이 모자라면 남은 문항은 반드시 다 찍기!</div></details>
    <details class="cs-sec"><summary>🔢 수학 공식 (산수·수학지식)</summary>${mathBlocks}</details>
    <details class="cs-sec"><summary>📏 단위 환산 — 시험지에 표가 안 나온다</summary>${unitBlocks}
      <div class="guide-src">산수·수학 문항의 약 1/4이 미국 관습단위(갤런·피트·온스)로 나와요. 이 표는 통째로 외워야 합니다.</div></details>
    <details class="cs-sec"><summary>🔗 유추 관계 유형 — 빈도순 TOP ${Math.min(14,Object.keys(rel).length)}</summary><table class="cs-table">${relRows}</table>
      <div class="guide-src">짝의 '관계'뿐 아니라 '방향'(부분→전체 vs 전체→부분)까지 같아야 정답!</div></details>
    <details class="cs-sec"><summary>✈️ 항공 핵심 암기 ${CS_AV.length}줄</summary>${CS_AV.map(x=>`<div class="cs-f">${fmtMath(x)}</div>`).join("")}</details>
    <details class="cs-sec"><summary>📇 최빈출 어근 TOP ${roots.length}</summary><table class="cs-table">${rootRows}</table>
      <div class="guide-src">모르는 단어가 나오면 어근으로 뜻을 추론 — 어근 코치에서 훈련한 그대로!</div></details>`;
  // 체크리스트 토글 + 바로가기 — 전체 재렌더 대신 in-place 갱신 (다른 펼친 섹션이 접히지 않게)
  $$("#csBody [data-eve]").forEach(b=>b.onclick=ev=>{
    const g=ev.target.closest("[data-evego]");
    if(g){ ev.stopPropagation();
      if(g.dataset.evego==="retest") go("exam");
      else startStudySet(wrongWordIds(),"오답 단어");
      return; }
    const k=b.dataset.eve; ec.done[k]=!ec.done[k]; saveLocal();
    b.classList.toggle("on",!!ec.done[k]);
    const ck=b.querySelector(".ck"); if(ck) ck.textContent=ec.done[k]?"✅":"⬜";
    const sum=$("#csEve summary"); if(sum){ const n=EVE_CHK.filter(([kk])=>ec.done[kk]).length;
      sum.innerHTML=`🌙 시험 전날 체크리스트 ${n}/${EVE_CHK.length}${dd!=null?` · <b>D-${Math.max(0,dd)}</b>`:""}`; } });
}

/* ============================================================
   약점 원탭 드릴 — 약점 리포트의 '유형' 한 줄에서 그 유형만 20문제 즉시 연습
   ============================================================ */
// learn=true → 유형 연습(문제마다 즉시 해설). false → 시간 재는 실전 드릴.
function startDrill(items,name,learn=true){
  items=(items||[]).slice(0,20);
  if(items.length<3){ toast("이 유형은 문제가 부족해요."); return; }
  if(!confirmDropExamSnap()) return;
  // 학습 모드는 넉넉하게(문항당 5분) — 해설 읽는 동안 자동 제출 안 되게.
  const per=learn?300:1.5, secs=Math.max(120, Math.round(items.reduce((s,it)=>s+(SECRATE[it.section]||30)*per,0)));
  exam={key:null,name,items,idx:0,answers:new Array(items.length).fill(null),learn,
        secsLeft:secs,startSecs:secs,total:items.length,submitted:false,timerId:null};
  $$(".view").forEach(v=>v.classList.remove("active")); $("#view-exam").classList.add("active");
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go==="home"));
  window.scrollTo(0,0);
  $("#examSetup").classList.add("hidden"); $("#examResult").classList.add("hidden"); $("#examRun").classList.remove("hidden");
  startExamTimer(); renderExamQ();
}
function drillRCType(type){
  const pool=[]; rcPracticePool().forEach(p=>(p.questions||[]).forEach((q,qi)=>{ if(q.type===type) pool.push([p,qi]); }));
  return shuffle(pool).slice(0,20).map(([p,qi])=>rcItem(p,qi));
}
function drillVARel(rel){
  return shuffle(ANALOGIES.filter(a=>(a.relation||"기타")===rel)).slice(0,20).map(vaItem);
}
function drillTopic(sec,topic){
  if(sec==="AV") return shuffle(AVIATION.filter(q=>(q.topic||"")===topic)).slice(0,20).map(q=>({
    section:"AV",prompt:q.q,promptKo:q.q_ko||"",stem:null,sub:AVCAT[q.topic]||q.topic||"",
    avId:q.id,avTopic:q.topic,options:q.options.slice(),answer:q.answer,explain:q.explain||""}));
  const pool={AR:ARITH,MK:MATHK,PS:PHYSCI}[sec]||[];
  const cand=pool.filter(q=>(q.topic||"")===topic);
  return ((sec==="AR"||sec==="MK")?shuffleW(cand,mqStyleWeight):shuffle(cand)).slice(0,20).map(q=>({
    section:sec,prompt:q.q,promptKo:q.q_ko||"",stem:null,sub:q.topic||"",qid:q.id,
    options:q.options.slice(),answer:q.answer,explain:q.explain||""}));
}
function drillWKTier(tier){
  const pool=WORDS.filter(w=>tierOf(w)===tier&&w.synonyms&&w.synonyms.length);
  const out=[]; for(const w of shuffle(pool)){ if(out.length>=20) break; const it=buildWKfor(w); if(it) out.push(it); }
  return out;
}
// data-drill="kind|arg1|arg2" (인자는 encodeURIComponent) → 해당 유형 20문제 시작
function runDrill(spec){
  const [kind,a,b]=spec.split("|").map(decodeURIComponent);
  if(kind==="rc") startDrill(drillRCType(a),`약점 드릴 · 독해 ${RC_TYPE_KO[a]||a}`);
  else if(kind==="va") startDrill(drillVARel(a),`약점 드릴 · 유추 ${a}`);
  else if(kind==="wk") startDrill(drillWKTier(a),`약점 드릴 · 단어 ${WK_TIER_KO[a]||a}`);
  else if(kind==="topic") startDrill(drillTopic(a,b),`약점 드릴 · ${SEC_KO[a]||a} — ${b}`);
}
function submitExam(auto){
  const e=exam; if(!e||e.submitted) return;
  // 통째로 건너뛴 과목(응답 0개) = 의도적 스킵 → 채점·통계·오답노트에서 제외
  const ansBySec={};
  e.items.forEach((it,i)=>{ if(e.answers[i]!=null) ansBySec[it.section]=(ansBySec[it.section]||0)+1; });
  const skipped=[...new Set(e.items.map(it=>it.section))].filter(sc=>!(ansBySec[sc]>0));
  const counted=e.items.map((it,i)=>i).filter(i=>!skipped.includes(e.items[i].section));
  if(!auto){ const un=counted.filter(i=>e.answers[i]==null).length;
    const skipTxt=skipped.length?`\n(${skipped.map(k=>SEC_KO[k]||k).join("·")}은(는) 한 문제도 안 풀어 통계에서 제외돼요)`:"";
    if(un && !confirm(`아직 ${un}문제를 안 풀었어요. 그래도 제출할까요?${skipTxt}`)) return; }
  e.submitted=true; stopExamTimer(); clearExamSnap(); examReleaseWake();
  // 열려 있던 문항의 시간 구간을 닫는다 (속도 분석용)
  e.times=e.times||new Array(e.total).fill(0);
  if(e._openIdx!=null&&e._openAt){ e.times[e._openIdx]+=Date.now()-e._openAt; e._openIdx=null; }
  // 아무 문항도 안 풀었으면 기록 없이 종료
  if(!counted.length){
    toast("푼 문항이 없어 채점·기록 없이 종료했어요.");
    $("#examRun").classList.add("hidden"); $("#examSetup").classList.remove("hidden");
    exam=null; return;
  }
  e._skipped=skipped;
  let got=0; const bySec={};
  counted.forEach(i=>{ const it=e.items[i]; const ok=e.answers[i]===it.answer; if(ok)got++;
    (bySec[it.section]=bySec[it.section]||{got:0,total:0}).total++; if(ok)bySec[it.section].got++;
    recordResult(it,ok); });
  // 풀이 속도 집계: 답한 문항만, 목표(실전 배분)의 1.3배 초과면 '느림'
  const speedBySec={};
  e.items.forEach((it,i)=>{ if(e.answers[i]==null) return; const ms=e.times[i]||0; if(!ms) return;
    const tgt=(SECRATE[it.section]||30)*1000;
    const o=speedBySec[it.section]||(speedBySec[it.section]={n:0,ms:0,slow:0});
    o.n++; o.ms+=ms; if(ms>tgt*1.3) o.slow++;
    const g=state.speed[it.section]||(state.speed[it.section]={n:0,ms:0,slow:0});
    g.n++; g.ms+=ms; if(ms>tgt*1.3) g.slow++; });
  const total=counted.length, pct=Math.round(got/total*100);
  const used = e.sections
    ? e.sections.reduce((a,s)=>a+(s.secs-Math.max(0,s.leftAtDone!=null?s.leftAtDone:s.left)),0)   // 섹션별 실제 소요 합 (수동 제출은 남긴 시간 반영)
    : (e.startSecs||(EXAM_PRESETS[e.key]?EXAM_PRESETS[e.key].secs:0))-Math.max(0,e.secsLeft);
  bumpDay({studied:total,correct:got});
  if(e.key&&!e.practice){ const prev=state.exams[e.key]||{};
    const newBest=got>(prev.best||0);   // bestTotal은 그 최고점을 낸 회차의 분모를 유지 ("최고 100/25" 방지)
    state.exams[e.key]={best:newBest?got:(prev.best||0),bestTotal:newBest?total:(prev.bestTotal||total),
      last:got,lastTotal:total,date:todayStr()}; }
  // 문항별 상세 — 나중에 해설까지 복기할 수 있도록. 지문 본문은 passageId로 복원(용량 절약).
  const detail=counted.map(i=>{ const it=e.items[i]; return {s:it.section,q:it.prompt||"",t:it.stem||"",o:(it.options||[]).slice(),
    u:e.answers[i],a:it.answer,x:it.explain||"",p:it.passageId!=null?it.passageId:null,pt:it.passageTitle||"",
    ms:Math.round(e.times[i]||0)}; });
  state.examHist.push({key:e.key||"retest",name:(EXAM_PRESETS[e.key]&&EXAM_PRESETS[e.key].name)||e.name||"모의고사",
    date:todayStr(),got,total,acc:got/total,pctile:estPercentile(got/total),ts:Date.now(),
    secs:used,bySec:JSON.parse(JSON.stringify(bySec)),items:detail,
    practice:e.practice?1:undefined,
    skipped:skipped.length?skipped.slice():undefined});
  if(state.examHist.length>200) state.examHist=state.examHist.slice(-200);
  pruneExamDetail();
  saveNow();
  // render result
  $("#examRun").classList.add("hidden"); $("#examResult").classList.remove("hidden");
  $("#examEmoji").textContent=pct>=85?"🏆":pct>=70?"🎯":pct>=50?"💪":"📚";
  $("#examScore").textContent=`${got} / ${total} 정답 (${pct}%)`+(skipped.length?` · ${skipped.map(k=>SEC_KO[k]||k).join("·")} 건너뜀`:"");
  const secName={WK:"단어",VA:"유추",RC:"독해",AV:"항공",AR:"산수",MK:"수학",PS:"과학",SJ:"상황",TR:"표읽기",IC:"계기",BC:"블록"};
  $("#examBreakDown").innerHTML=Object.keys(bySec).map(k=>
    `<div class="s"><b>${bySec[k].got}/${bySec[k].total}</b><span>${secName[k]||k}</span></div>`).join("");
  // estimated AFOQT-style percentile (unofficial)
  const acc=got/total, pctile=estPercentile(acc), multi=Object.keys(bySec).length>1;
  const secLines=Object.keys(bySec).map(k=>`${secName[k]||k} ${Math.round(bySec[k].got/bySec[k].total*100)}%`).join(" · ");
  const proj=$("#examProjection"); proj.classList.remove("hidden");
  if(e.key==="afoqt"||e.key==="afoqtCore"){
    const compLines=COMPOSITES.map(c=>{ const ce=compositeEst(c.codes); return `<div class="row" style="justify-content:space-between"><span>${c.name}</span><b>${ce.pct==null?"–":ce.pct+"th"}</b></div>`; }).join("");
    proj.innerHTML=`<div class="lbl">예상 AFOQT 합성점수 백분위</div>
      <div class="seclist" style="text-align:left;margin-top:6px">${compLines}</div>
      <div class="note">정답률 ${Math.round(acc*100)}% · ${secLines}<br>※ 비공식 추정. 통계 탭에서 누적 합성점수를 확인하세요.</div>`;
  } else {
    // Sector mocks (Verbal/Quant/Pilot) also show that composite's accumulated estimate.
    const sc=SECTOR_COMPOSITE[e.key]; let compLine="";
    if(sc){ const ce=compositeEst(sc.codes);
      compLine=`<div class="row" style="justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px solid var(--line)"><span>${sc.name} 누적 합성</span><b>${ce.pct==null?"–":ce.pct+"th"}</b></div>`; }
    proj.innerHTML=`<div class="lbl">${e.key==="full"?"예상 AFOQT Verbal 백분위":"예상 백분위"}</div>
      <div class="big">${pctile}<span style="font-size:16px">th</span></div>
      <div class="seclist">정답률 ${Math.round(acc*100)}%${multi?` · ${secLines}`:""}</div>
      ${compLine}
      <div class="note">※ 비공식 추정치예요. 실제 AFOQT 환산과 다르며, ${e.key==="full"?"전체 모의고사를 여러 번 볼수록":"풀 모의고사로 볼수록"} 정확해집니다.</div>`;
  }
  if(e.sections){
    // 섹션별로 얼마나 썼는지 + 시간 안에 못 끝낸 섹션 표시
    const lines=e.sections.map(s=>{ const left=s.leftAtDone!=null?s.leftAtDone:Math.max(0,s.left);
      const u=s.secs-left, out=s.autoOut||left<=0;   // ⏰는 진짜 시간초과일 때만
      return `${SEC_KO[s.code]||s.code} ${fmtTime(u)}/${fmtTime(s.secs)}${out?"⏰":""}`; }).join(" · ");
    $("#examTimeUsed").innerHTML=`소요 시간 ${fmtTime(used)}<br><span style="font-size:11.5px">${esc(lines)}</span>`;
  } else $("#examTimeUsed").textContent=`소요 시간 ${fmtTime(used)}${e.secsLeft<=0?" · ⏰ 시간 종료":""}`;
  // ---- 속도 분석: 과목별 평균 vs 실전 목표 + '맞았지만 느림' ----
  const spBox=$("#examSpeed");
  if(spBox){ const keys=Object.keys(speedBySec);
    if(!keys.length) spBox.classList.add("hidden");
    else { spBox.classList.remove("hidden");
      const lines=keys.map(k=>{ const o=speedBySec[k], avg=Math.round(o.ms/o.n/1000), tgt=SECRATE[k]||30;
        const ok=avg<=tgt; return `<span class="pill" style="${ok?"":"color:var(--warn)"}">${secName[k]||k} ${avg}초${ok?"":"🐢"}<small>/${tgt}초</small></span>`; }).join(" ");
      const slowOK=e.items.filter((it,i)=>e.answers[i]===it.answer&&(e.times[i]||0)>((SECRATE[it.section]||30)*1300)).length;
      spBox.innerHTML=`<div style="font-weight:700;font-size:12.5px;margin-bottom:6px">⚡ 풀이 속도 (실전 배분 시간 대비)</div>
        <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:center">${lines}</div>
        ${slowOK>0?`<div class="muted" style="font-size:11.5px;margin-top:6px">🐢 맞았지만 느렸던 문항 <b>${slowOK}개</b> — 실전에선 시간 부족이 될 수 있어요. 해설에서 🐢 표시를 확인!</div>`:`<div class="muted" style="font-size:11.5px;margin-top:6px">✅ 페이스 좋아요 — 이 속도면 실전 시간 안에 들어와요.</div>`}`; } }
  $("#examReview").innerHTML=""; $("#examReviewBtn").classList.remove("hidden");
  window.scrollTo(0,0);
}
function renderExamReview(){
  const e=exam; if(!e) return;
  const secName={WK:"단어",VA:"유추",RC:"독해",AV:"항공",AR:"산수",MK:"수학",PS:"과학",SJ:"상황",TR:"표읽기",IC:"계기",BC:"블록"};
  const skip=e._skipped||[];
  $("#examReview").innerHTML=e.items.map((it,i)=>{
    if(skip.includes(it.section)) return "";               // 통째로 건너뛴 과목은 복기에서 제외
    const pick=e.answers[i], ok=pick===it.answer;
    // Visual subtests: show the table/dial/block figure so the review makes sense.
    const figure=it.figureHTML?`<div class="exam-figure exam-figure-rev">${it.figureHTML}</div>`:"";
    const opts=it.options.map((o,oi)=>{
      let cls=""; if(oi===it.answer) cls="ok"; else if(oi===pick) cls="no";
      const mark=oi===it.answer?"✓ ":(oi===pick?"✗ ":"");
      return `<div class="ro ${cls}">${mark}${fmtMath(o)}</div>`;
    }).join("");
    const ms=(e.times&&e.times[i])||0, tgt=(SECRATE[it.section]||30);
    const tchip=ms?` · ${Math.round(ms/1000)}초${ms>tgt*1300?" 🐢":""}`:"";
    return `<div class="review-q">
      <div class="rh">${i+1}. ${secName[it.section]||it.section} ${ok?"✅":pick==null?"⬜ 미응답":"❌"}<span class="muted" style="font-weight:400">${tchip}</span></div>
      <div style="font-weight:600;margin-bottom:6px">${fmtMath(it.stem||it.prompt)}</div>
      ${figure}
      ${opts}
      ${it.explain?`<div class="rx">${fmtMath(it.explain)}</div>`:""}</div>`;
  }).join("");
}

/* ============================================================
   STATS
   ============================================================ */
function renderStats(){
  const cnt=countByStatus(); $("#sLearned").textContent=cnt.learned; $("#sMastered").textContent=cnt.mastered; $("#sTotalRev").textContent=cnt.totalRev;
  $("#sVA").textContent=vaStats().seen; $("#sRC").textContent=rcStats().done;
  let cor=0,stu=0; for(const k in state.daily){ cor+=state.daily[k].correct; stu+=state.daily[k].studied; }
  $("#sAcc").textContent=stu?Math.round(cor/stu*100)+"%":"–";
  const start=parseDate(state.settings.start_date), exam=parseDate(state.settings.exam_date);
  const ct=$("#calTitle"); if(ct){ const [,sm,sd]=state.settings.start_date.split("-"), [,em,ed]=state.settings.exam_date.split("-"); ct.textContent=`학습 달력 (${+sm}/${+sd} – ${+em}/${+ed})`; }
  $("#calHead").innerHTML=["일","월","화","수","목","금","토"].map(d=>`<div class="dow">${d}</div>`).join("");
  let cells=""; for(let i=0;i<start.getDay();i++) cells+=`<div class="d" style="background:none"></div>`;
  for(let d=new Date(start); d<=exam; d.setDate(d.getDate()+1)){ const key=todayStr(d),rec=state.daily[key]; let cls="d";
    if(rec&&rec.goal_met) cls+=" met"; else if(rec&&rec.studied>0) cls+=" partial"; if(key===todayStr()) cls+=" today";
    cells+=`<div class="${cls}">${d.getDate()}</div>`; }
  $("#calGrid").innerHTML=cells;
  let met=0; for(const k in state.daily) if(state.daily[k].goal_met) met++;
  $("#calStreak").textContent=computeStreak(); $("#calMet").textContent=met;
  // 달성 배지
  const bb=$("#badgeRow");
  if(bb){ checkBadges(true);
    const earned=BADGES.filter(b=>state.badges[b.id]).length;
    $("#badgeCount").textContent=`${earned} / ${BADGES.length}`;
    bb.innerHTML=Object.keys(BADGE_CATS).map(cat=>{
      const list=BADGES.filter(b=>b.cat===cat); if(!list.length) return "";
      const got=list.filter(b=>state.badges[b.id]).length;
      return `<div class="bgroup"><div class="bghead">${BADGE_CATS[cat]} <span>${got}/${list.length}</span></div>
        <div class="bgrid">${list.map(b=>{ const on=!!state.badges[b.id];
          return `<div class="badge ${on?"on":"off"}" title="${esc(b.d||b.name)}"><div class="bi">${b.icon}</div><div class="bn">${esc(b.name)}</div></div>`;
        }).join("")}</div></div>`;
    }).join(""); }
  const left=daysLeft(),rem=cnt.remaining,pace=newPerDay(),fin=pace?Math.ceil(rem/pace):0,ok=fin<=left;
  const todayDueN=dueCards().length, todayNewN=Math.min(pace,rem), todayN=todayDueN+todayNewN;
  $("#projection").innerHTML=rem===0?`<div class="center"><div class="big-emoji">🏁</div><b>모든 단어 학습 완료!</b><div class="muted">이제 복습으로 마스터하세요.</div></div>`
    :`📅 <b>오늘은 ${todayN}개</b> (복습 ${todayDueN} + 신규 ${todayNewN})<br>
      남은 단어 <b>${rem}</b>개 · 시험까지 <b>${left}</b>일<br>이 페이스(신규 ${pace}/일)면 <b>약 ${fin}일</b>에 1회독.<br>
      <span style="color:${ok?'var(--ok)':'var(--warn)'}">${ok?'✅ 일정 내 완주 가능!':'⚠️ 하루 신규 단어를 늘리면 더 안전해요.'}</span>
      <div class="muted" style="font-size:12px;margin-top:6px">⏳ 쉬는 날엔 남은 단어는 그대로, 남은 일수만 줄어서 다음날 개수가 자동으로 늘어나요.</div>`;
  renderComposite(); renderExamTrend(); renderSpeedStats(); renderWeakness();
}
// 과목별 평균 풀이 속도 vs 실전 배분 시간 (누적)
function renderSpeedStats(){
  const box=$("#speedStats"); if(!box) return;
  const rows=Object.keys(state.speed||{}).map(k=>({k,o:state.speed[k]})).filter(x=>(x.o.n||0)>=5);
  if(!rows.length){ box.innerHTML=`<div class="center muted" style="padding:8px;font-size:12.5px">모의고사·드릴을 풀면 문항당 평균 속도가 여기 쌓여요.<br>목표는 실제 AFOQT 배분 시간(예: 단어 12초, 산수 70초)입니다.</div>`; return; }
  rows.sort((a,b)=>{ const ra=(a.o.ms/a.o.n)/((SECRATE[a.k]||30)*1000), rb=(b.o.ms/b.o.n)/((SECRATE[b.k]||30)*1000); return rb-ra; });
  box.innerHTML=rows.map(({k,o})=>{
    const avg=o.ms/o.n/1000, tgt=SECRATE[k]||30, r=avg/tgt;
    const col=r>1.15?"var(--bad)":r>0.95?"var(--warn)":"var(--ok)";
    const w=clamp(Math.round(r*70),4,100); // 목표=70% 지점 눈금
    return `<div class="rep-row"><div class="lab"><span>${SEC_KO[k]||k} ${r>1.15?"🐢":r<=0.85?"⚡":""}</span>
        <span class="muted">평균 ${avg.toFixed(1)}초 / 목표 ${tgt}초 · ${o.n}문항${o.slow?` · 느림 ${o.slow}`:""}</span></div>
      <div class="progressbar mini"><i style="width:${w}%;background:${col}"></i></div></div>`;
  }).join("")+`<div class="guide-src" style="margin-top:6px">※ 막대 70% 지점이 실전 배분 시간. 넘으면 실전에서 시간 부족 위험이 있어요.</div>`;
}
const SEC_KO={WK:"단어",VA:"유추",RC:"독해",AR:"산수",MK:"수학",PS:"과학",AV:"항공",TR:"표읽기",BC:"블록",IC:"계기",SJ:"상황"};
// Approximate AFOQT composite -> subtest membership (unofficial).
/* 공식 AFOQT Form T 정보 팸플릿(2015-08-01 갱신) Table 1 기준.
   Pilot 은 수학지식·표읽기·계기·항공 4과목이며 산수(AR)·유추(VA)·블록(BC)은 포함되지 않는다.
   물리과학(PS)과 자기기술(SDI)은 어떤 합성점수에도 들어가지 않는다. */
const COMPOSITES=[
  {name:"🎓 Academic Aptitude",codes:["VA","AR","WK","MK","RC"]},
  {name:"🗣 Verbal",codes:["VA","WK","RC"]},
  {name:"🔢 Quantitative",codes:["AR","MK"]},
  {name:"✈️ Pilot",codes:["MK","TR","IC","AV"]},
  {name:"🛰 CSO",codes:["WK","MK","TR","BC"]},
  {name:"🎯 ABM",codes:["VA","MK","TR","IC","BC","AV"]},
];
// Sector mocks → which composite to show on their result screen.
const SECTOR_COMPOSITE={
  secVerbal:{name:"🗣 Verbal",codes:["WK","VA","RC"]},
  secQuant:{name:"🔢 Quantitative",codes:["AR","MK"]},
  secPilot:{name:"✈️ Pilot",codes:["MK","TR","IC","AV"]},
};
/* ============================================================
   WEAKNESS REPORT (약점 리포트 — 푼 문제 기반 분석 + 바로 연습)
   ============================================================ */
const SUBTESTS=[
  {code:"WK",name:"단어 (Word Knowledge)",go:()=>startExam("wk")},
  {code:"VA",name:"유추 (Verbal Analogies)",go:()=>startExam("va")},
  {code:"RC",name:"독해 (Reading)",go:()=>startExam("rc")},
  {code:"AR",name:"산수 (Arithmetic)",go:()=>openSubtest("ar")},
  {code:"MK",name:"수학 (Math Knowledge)",go:()=>openSubtest("mk")},
  {code:"PS",name:"과학 (Physical Science)",go:()=>openSubtest("ps")},
  {code:"AV",name:"항공 (Aviation)",go:()=>startExam("av")},
  {code:"TR",name:"표 읽기 (Table Reading)",go:()=>startTableReading()},
  {code:"BC",name:"블록 세기 (Block Counting)",go:()=>startBlockCounting()},
  {code:"IC",name:"계기 (Instrument Comp.)",go:()=>startInstrument()},
];
const RC_TYPE_KO={main_idea:"주제",detail:"세부사항",inference:"추론",vocab_in_context:"문맥 어휘",tone_purpose:"어조/목적"};
const WK_TIER_KO={high:"빈출(high)",mid:"중요(mid)",std:"일반(std)"};
function accPct(o){ const n=(o?.c||0)+(o?.w||0); return n?Math.round((o.c/n)*100):null; }
// drill: "kind|arg" 스펙이 오면 그 유형만 바로 20문제 푸는 원탭 버튼을 단다.
function repBar(label,o,drill){ const p=accPct(o); const n=(o?.c||0)+(o?.w||0); const col=p<50?"var(--bad)":p<75?"var(--warn)":"var(--ok)";
  const btn=drill?`<button class="drillbtn" data-drill="${esc(drill)}">20문제 ›</button>`:"";
  return `<div class="rep-row ${drill?"has-drill":""}"><div class="lab"><span>${esc(label)}</span><span class="muted">${p}% · ${o.w||0}틀림/${n}</span></div>
    <div class="row" style="gap:8px;align-items:center"><div class="progressbar mini" style="flex:1"><i style="width:${p}%;background:${col}"></i></div>${btn}</div></div>`; }
function openReport(){ go("report"); }
function renderReport(){
  const box=$("#repBody"); if(!box) return;
  const subs=SUBTESTS.filter(s=>!(pilotPerfect()&&PILOT_VISUAL.includes(s.code)))
    .map(s=>({...s,o:state.secAcc[s.code]})).filter(s=>((s.o?.c||0)+(s.o?.w||0))>=3)
    .map(s=>({...s,acc:accPct(s.o),n:(s.o.c||0)+(s.o.w||0)})).sort((a,b)=>a.acc-b.acc);
  if(!subs.length){ box.innerHTML=`<div class="card rep-empty">아직 분석할 데이터가 부족해요.<br>퀴즈·시험·커리큘럼을 조금 풀면 약점을 분석해 드릴게요.<br><button class="btn primary" id="repGoDaily" style="max-width:240px;margin:14px auto 0">📅 오늘의 통합 학습 시작</button></div>`;
    $("#repGoDaily")&&($("#repGoDaily").onclick=()=>startExam("daily")); return; }
  const worst=subs[0];
  const enc=encodeURIComponent;
  const wkBlock=()=>{ const arr=Object.entries(state.weak.wkTier).map(([k,o])=>({k,o,n:o.c+o.w})).filter(x=>x.n>=2);
    return arr.length?`<div class="rep-sub">📇 단어 — 등급별</div>${arr.map(x=>repBar(WK_TIER_KO[x.k]||x.k,x.o,`wk|${enc(x.k)}`)).join("")}`:""; };
  const vaBlock=()=>{ const arr=Object.entries(state.weak.vaRel).map(([k,o])=>({k,o,a:accPct(o),n:o.c+o.w})).filter(x=>x.n>=2).sort((a,b)=>a.a-b.a).slice(0,5);
    return arr.length?`<div class="rep-sub">🔗 유추 — 약한 관계 유형</div>${arr.map(x=>repBar(x.k,x.o,`va|${enc(x.k)}`)).join("")}`:""; };
  const rcBlock=()=>{ const arr=Object.entries(state.weak.rcType).map(([k,o])=>({k,o,a:accPct(o),n:o.c+o.w})).filter(x=>x.n>=2).sort((a,b)=>a.a-b.a);
    return arr.length?`<div class="rep-sub">📖 독해 — 약한 문제 유형</div>${arr.map(x=>repBar(RC_TYPE_KO[x.k]||x.k,x.o,`rc|${enc(x.k)}`)).join("")}`:""; };
  const topicBySec={}; for(const [k,o] of Object.entries(state.weak.topic||{})){ const i=k.indexOf(":"); const sec=k.slice(0,i),t=k.slice(i+1); (topicBySec[sec]=topicBySec[sec]||[]).push({t,o,a:accPct(o),n:o.c+o.w}); }
  const secKoName={AR:"산수",MK:"수학",PS:"과학",AV:"항공"};
  const topicBlocks=Object.keys(topicBySec).map(sec=>{ const arr=topicBySec[sec].filter(x=>x.n>=2).sort((a,b)=>a.a-b.a).slice(0,4);
    return arr.length?`<div class="rep-sub">${secKoName[sec]||sec} — 약한 주제</div>${arr.map(x=>repBar(x.t,x.o,`topic|${enc(sec)}|${enc(x.t)}`)).join("")}`:""; }).join("");
  // 가장 약한 '유형' 하나 — 히어로에서 원탭으로 바로 20문제
  const typeCands=[];
  for(const [k,o] of Object.entries(state.weak.wkTier||{})){ const n=(o.c||0)+(o.w||0); if(n>=3) typeCands.push({a:o.c/n,n,drill:`wk|${enc(k)}`,label:`단어 ${WK_TIER_KO[k]||k}`}); }
  for(const [k,o] of Object.entries(state.weak.vaRel||{})){ const n=(o.c||0)+(o.w||0); if(n>=3) typeCands.push({a:o.c/n,n,drill:`va|${enc(k)}`,label:`유추 「${k}」`}); }
  for(const [k,o] of Object.entries(state.weak.rcType||{})){ const n=(o.c||0)+(o.w||0); if(n>=3) typeCands.push({a:o.c/n,n,drill:`rc|${enc(k)}`,label:`독해 ${RC_TYPE_KO[k]||k}`}); }
  for(const [k,o] of Object.entries(state.weak.topic||{})){ const n=(o.c||0)+(o.w||0); if(n>=3){ const i=k.indexOf(":"); typeCands.push({a:o.c/n,n,drill:`topic|${enc(k.slice(0,i))}|${enc(k.slice(i+1))}`,label:`${secKoName[k.slice(0,i)]||k.slice(0,i)} 「${k.slice(i+1)}」`}); } }
  typeCands.sort((x,y)=>x.a-y.a);
  const wt=typeCands.length&&typeCands[0].a<0.85?typeCands[0]:null;
  const wc=wrongCounts(), wtot=WRONG_ORDER.reduce((s,k)=>s+wc[k],0);
  const recs=subs.slice(0,3).map(s=>`<div class="rep-rec"><div class="meta"><b>${esc(s.name)}</b><div class="muted">정답률 ${s.acc}% · ${s.n}문항</div></div><button class="btn primary" data-rec="${s.code}">연습</button></div>`).join("")
    +(wtot?`<div class="rep-rec"><div class="meta"><b>📕 오답 노트</b><div class="muted">틀린 ${wtot}문제 다시 풀기</div></div><button class="btn primary" id="repRetest">재시험</button></div>`:"");
  box.innerHTML=`<div class="rep-hero"><div style="font-size:12px;color:var(--brand2);font-weight:700">가장 약한 영역</div>
      <div class="big">${esc(worst.name)} · ${worst.acc}%</div>
      <div class="muted" style="font-size:12px;margin-top:4px">${worst.n}문항 기준 · 아래 "연습"으로 바로 보강하세요</div>
      ${wt?`<button class="btn primary" data-drill="${esc(wt.drill)}" style="margin-top:11px">🎯 가장 약한 유형 바로 풀기 — ${esc(wt.label)} (정답률 ${Math.round(wt.a*100)}%)</button>`:""}</div>
    <div class="rep-sub">📊 과목별 정답률 (약한 순)</div>
    ${subs.map(s=>repBar(s.name,s.o)).join("")}
    ${wkBlock()}${vaBlock()}${rcBlock()}${topicBlocks}
    <h2 class="section">💡 추천 — 바로 연습</h2>
    ${recs}
    <div class="guide-src" style="margin-top:6px">※ 푼 문제(퀴즈·시험·커리큘럼)를 종합한 분석이에요. 많이 풀수록 정확해집니다.</div>`;
  $$('#repBody [data-rec]').forEach(b=>b.onclick=()=>{ const s=SUBTESTS.find(x=>x.code===b.dataset.rec); if(s) s.go(); });
  $$('#repBody [data-drill]').forEach(b=>b.onclick=()=>runDrill(b.dataset.drill));
  $("#repRetest")&&($("#repRetest").onclick=()=>startRetest("all"));
}
function renderComposite(){
  const box=$("#compositeEst"); if(!box) return;
  // 만점 처리 중인 시각과목(TR/BC/IC)은 표기도 100%로 — 계산과 표시가 어긋나지 않게
  const accOf=s=>{ if(pilotPerfect()&&PILOT_VISUAL.includes(s)) return 100;
    const o=state.secAcc[s]; const n=o?(o.c+o.w):0; return n?Math.round(o.c/n*100):null; };
  const secLine=codes=>codes.filter(s=>accOf(s)!=null).map(s=>`${SEC_KO[s]} ${accOf(s)}%${(pilotPerfect()&&PILOT_VISUAL.includes(s))?"✓":""}`).join(" · ")||"–";
  const block=(title,e,codes)=>`<div style="margin-bottom:13px">
      <div class="row" style="justify-content:space-between;align-items:baseline">
        <b style="font-size:15px">${title}</b>
        <span style="font-size:26px;font-weight:800;color:var(--brand2)">${e.pct==null?"–":e.pct+"<small style='font-size:13px'>th</small>"}</span></div>
      <div class="muted" style="font-size:11.5px;line-height:1.55;margin-top:2px">${e.acc==null
        ?"데이터 부족 — 관련 과목을 더 풀면 예측돼요."
        :`정답률 ${Math.round(e.acc*100)}% · ${secLine(codes)} · 표본 ${e.n}`}</div></div>`;
  box.innerHTML=COMPOSITES.map(c=>block(c.name,compositeEst(c.codes),c.codes)).join("")
    +(pilotPerfect()?`<div class="guide-src" style="margin-top:2px">✈️ 표읽기·블록·계기는 <b>만점 처리</b> 중 (외부 앱 연습 — 설정 → 학습 옵션에서 변경)</div>`:"")
    +`<div class="guide-src" style="margin-top:2px">※ 비공식 추정치입니다. 합성점수 구성·환산은 실제 AFOQT와 다를 수 있어요.</div>`;
}
// 용량 관리: 최근 10회만 문항 상세 보관, 그 이전은 요약만
function pruneExamDetail(){ const h=state.examHist||[];
  for(let i=0;i<h.length-10;i++) if(h[i]&&h[i].items) delete h[i].items; }

/* ============================================================
   지난 시험 기록 — 목록 → 상세(문항별 해설 복기)
   ============================================================ */
const EXAM_SECKO={WK:"단어",VA:"유추",RC:"독해",AV:"항공",AR:"산수",MK:"수학",PS:"과학",SJ:"상황",TR:"표읽기",IC:"계기",BC:"블록"};
let examLogIdx=null;
function renderExamLog(){
  const h=(state.examHist||[]).slice().reverse();
  if(examLogIdx==null){
    $("#elTitle").textContent="📋 지난 시험 기록";
    $("#elBack").textContent="← 통계"; $("#elBack").onclick=()=>go("stats");
    if(!h.length){ $("#elBody").innerHTML=`<div class="card center muted" style="padding:20px">아직 본 시험이 없어요.<br>모의고사를 보면 여기에 기록이 남아요.</div>`; return; }
    $("#elBody").innerHTML=`<div class="muted" style="font-size:12px;margin-bottom:10px">총 ${h.length}회 · 문항별 해설은 최근 10회까지 볼 수 있어요.</div>`+
      h.map((x,i)=>{ const pct=Math.round(x.acc*100);
        const col=pct>=85?"var(--ok)":pct>=70?"var(--brand2)":pct>=50?"var(--warn)":"var(--bad)";
        return `<button class="elrow" data-i="${i}">
          <div class="elm"><div class="eln">${esc(x.name||x.key||"모의고사")}</div>
            <div class="eld">${esc(x.date||"")}${x.secs?" · "+fmtTime(x.secs):""}${x.skipped&&x.skipped.length?" · "+x.skipped.map(k=>SEC_KO[k]||k).join("·")+" 건너뜀":""}${x.items?"":" · 요약만"}</div></div>
          <div class="elsc" style="color:${col}"><b>${x.got}/${x.total}</b><span>${pct}%${x.pctile?" · "+x.pctile+"th":""}</span></div>
          <div class="elgo">›</div></button>`; }).join("");
    $$("#elBody .elrow").forEach(b=>b.onclick=()=>{ examLogIdx=+b.dataset.i; window.scrollTo(0,0); renderExamLog(); });
    return;
  }
  const x=h[examLogIdx]; if(!x){ examLogIdx=null; return renderExamLog(); }
  $("#elTitle").textContent=`${x.date} · ${Math.round(x.acc*100)}%`;
  $("#elBack").textContent="← 목록"; $("#elBack").onclick=()=>{ examLogIdx=null; window.scrollTo(0,0); renderExamLog(); };
  const secs=Object.keys(x.bySec||{}).map(k=>`<div class="s"><b>${x.bySec[k].got}/${x.bySec[k].total}</b><span>${EXAM_SECKO[k]||k}</span></div>`).join("");
  let head=`<div class="card center">
      <div style="font-size:13px;color:var(--muted)">${esc(x.name||x.key||"모의고사")}</div>
      <h2 style="margin:6px 0">${x.got} / ${x.total} 정답 (${Math.round(x.acc*100)}%)</h2>
      <div class="muted" style="font-size:12px">${esc(x.date||"")}${x.secs?" · 소요 "+fmtTime(x.secs):""}${x.pctile?" · 예상 "+x.pctile+"th":""}${x.skipped&&x.skipped.length?" · "+x.skipped.map(k=>SEC_KO[k]||k).join("·")+" 건너뜀(통계 제외)":""}</div>
      ${secs?`<div class="breakdown" style="margin-top:12px">${secs}</div>`:""}</div>`;
  if(!x.items){ $("#elBody").innerHTML=head+`<div class="hintbox" style="margin-top:14px">이 회차는 오래돼서 요약만 남아 있어요(문항 상세는 최근 10회까지 보관).</div>`; return; }
  const body=x.items.map((it,i)=>{
    const ok=it.u===it.a, un=it.u==null;
    const opts=(it.o||[]).map((o,oi)=>{ let cls=""; if(oi===it.a) cls="ok"; else if(oi===it.u) cls="no";
      const mark=oi===it.a?"✓ ":(oi===it.u?"✗ ":"");
      return `<div class="ro ${cls}">${mark}${fmtMath(o)}</div>`; }).join("");
    const psg=(it.p!=null)?(()=>{ const p=READING.find(z=>z.id===it.p); return p?`<details class="exam-passage"><summary>📖 ${esc(it.pt||p.title||"지문")} (탭하여 보기)</summary><div class="passage">${esc(p.passage||"")}</div></details>`:""; })():"";
    const tchip=it.ms?` · ${Math.round(it.ms/1000)}초${it.ms>((SECRATE[it.s]||30)*1300)?" 🐢":""}`:"";
    return `<div class="review-q">
      <div class="rh">${i+1}. ${EXAM_SECKO[it.s]||it.s} ${ok?"✅":un?"⬜ 미응답":"❌"}<span class="muted" style="font-weight:400">${tchip}</span></div>
      ${psg}
      <div style="font-weight:600;margin-bottom:6px">${fmtMath(it.t||it.q)}</div>
      ${opts}
      ${it.x?`<div class="rx">${fmtMath(it.x)}</div>`:""}</div>`;
  }).join("");
  const wrongN=x.items.filter(t=>t.u!==t.a).length;
  $("#elBody").innerHTML=head+
    `<div class="row" style="gap:8px;margin-top:12px">
       <button class="btn ghost sm" id="elAll" style="flex:1">전체 ${x.items.length}문항</button>
       <button class="btn primary sm" id="elWrong" style="flex:1">틀린 것만 ${wrongN}개</button>
     </div><div id="elList" style="margin-top:12px">${body}</div>`;
  const apply=(wrongOnly)=>{ $$("#elList .review-q").forEach((el,i)=>{
      const t=x.items[i]; el.classList.toggle("hidden", wrongOnly && t.u===t.a); }); };
  $("#elAll").onclick=()=>{ apply(false); $("#elAll").className="btn primary sm"; $("#elWrong").className="btn ghost sm"; };
  $("#elWrong").onclick=()=>{ apply(true); $("#elWrong").className="btn primary sm"; $("#elAll").className="btn ghost sm"; };
}
function renderExamTrend(){
  // 3문항짜리 드릴·연습(practice) 회차는 추이·최고 기록에서 제외 — bigExams와 같은 기준
  const h=(state.examHist||[]).filter(x=>x&&(x.total||0)>=10&&!x.practice); const box=$("#examTrend");
  if(h.length<1){ box.innerHTML=`<div class="center muted" style="padding:8px">아직 기록이 없어요. 모의고사를 보면 정답률 추이가 그려집니다.</div>`; return; }
  const data=h.slice(-15), W=300,H=120,pad=22;
  const xs=(i)=>pad+(data.length<=1?W-2*pad:(i/(data.length-1))*(W-2*pad));
  const ys=(a)=>H-pad-(a*(H-2*pad));
  const pts=data.map((d,i)=>[xs(i),ys(d.acc)]);
  const line=pts.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" ");
  const dots=pts.map((p,i)=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="var(--brand2)"/>`).join("");
  const grid=[0,0.25,0.5,0.75,1].map(g=>`<line x1="${pad}" y1="${ys(g)}" x2="${W-pad}" y2="${ys(g)}" stroke="#ffffff14"/><text x="2" y="${ys(g)+3}" fill="var(--muted)" font-size="8">${Math.round(g*100)}</text>`).join("");
  const last=data[data.length-1], best=Math.max(...h.map(d=>d.acc));
  box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">
      ${grid}<path d="${line}" fill="none" stroke="var(--brand)" stroke-width="2.5"/>${dots}</svg>
    <div class="row" style="justify-content:space-around;margin-top:8px;flex-wrap:wrap;gap:8px">
      <span class="pill">최근 정답률 <b>${Math.round(last.acc*100)}%</b></span>
      <span class="pill">예상 백분위 <b>${last.pctile}th</b></span>
      <span class="pill">최고 <b>${Math.round(best*100)}%</b></span>
      <span class="pill">응시 <b>${h.length}</b>회</span></div>`;
}
function renderWeakness(){
  const box=$("#weakAnalysis");
  const relName=r=>r, typeName={main_idea:"주제",detail:"세부사항",inference:"추론",vocab_in_context:"문맥 어휘",tone_purpose:"어조/목적"},
        tierName={high:"빈출(high)",mid:"중요(mid)",std:"일반(std)"};
  const collect=(obj,namer)=>Object.keys(obj).map(k=>{const o=obj[k],t=o.c+o.w;return{k,name:namer(k),acc:t?o.c/t:0,t,w:o.w};}).filter(x=>x.t>=2);
  const va=collect(state.weak.vaRel,relName).sort((a,b)=>a.acc-b.acc).slice(0,4);
  const rc=collect(state.weak.rcType,k=>typeName[k]||k).sort((a,b)=>a.acc-b.acc).slice(0,4);
  const wk=collect(state.weak.wkTier,k=>tierName[k]||k).sort((a,b)=>a.acc-b.acc);
  if(!va.length&&!rc.length&&!wk.length){ box.innerHTML=`<div class="center muted" style="padding:8px">모의고사를 풀면 유형별 정답률을 분석해 약점을 알려드려요.</div>`; return; }
  const bar=x=>{const p=Math.round(x.acc*100),col=p<50?"var(--bad)":p<75?"var(--warn)":"var(--ok)";
    return `<div style="margin:6px 0"><div class="row" style="justify-content:space-between;font-size:12px"><span>${esc(x.name)}</span><span class="muted">${p}% · ${x.w}틀림</span></div>
      <div class="progressbar mini"><i style="width:${p}%;background:${col}"></i></div></div>`;}
  let html="";
  if(wk.length){ html+=`<div style="font-size:12px;font-weight:700;color:var(--brand2);margin:2px 0 4px">단어 등급별</div>`+wk.map(bar).join(""); }
  if(va.length){ html+=`<div style="font-size:12px;font-weight:700;color:var(--brand2);margin:10px 0 4px">유추 — 약한 관계 유형</div>`+va.map(bar).join(""); }
  if(rc.length){ html+=`<div style="font-size:12px;font-weight:700;color:var(--brand2);margin:10px 0 4px">독해 — 약한 문제 유형</div>`+rc.map(bar).join(""); }
  const worst=[...va,...rc,...wk].sort((a,b)=>a.acc-b.acc)[0];
  if(worst) html+=`<div class="hintbox" style="margin-top:12px">💡 가장 약한 부분: <b>${esc(worst.name)}</b> (${Math.round(worst.acc*100)}%). 집중 연습을 추천해요.</div>`;
  box.innerHTML=html;
}

/* ============================================================
   SHEETS / SETTINGS
   ============================================================ */
function openSheet(html){ const bg=$("#genericSheet")||createGeneric(); $("#genericSheetBody").innerHTML=html; bg.classList.add("open"); }
function createGeneric(){ const bg=document.createElement("div"); bg.className="sheet-bg"; bg.id="genericSheet";
  bg.innerHTML=`<div class="sheet" id="genericSheetBody"></div>`; bg.onclick=e=>{ if(e.target===bg) closeSheet(); }; document.body.appendChild(bg); return bg; }
function closeSheet(){ $("#genericSheet")?.classList.remove("open"); }
function openSettings(){ $("#setGoal").value=state.settings.daily_goal||""; $("#setStart").value=state.settings.start_date; $("#setExam").value=state.settings.exam_date;
  $("#optShowKo")&&($("#optShowKo").checked=!flag("hide_ko"));
  $("#optPilotPerfect")&&($("#optPilotPerfect").checked=pilotPerfect());
  $("#setUrl").value=localStorage.getItem(LS.url)||""; $("#setKey").value=localStorage.getItem(LS.key)||"";
  $("#syncCodeView").textContent=syncCode(); $("#verLine").textContent=`v${VERSION} · 단어 ${WORDS.length} · 유추 ${ANALOGIES.length} · 독해 ${READING.length} · 항공 ${AVIATION.length}`;
  setSyncDot(sb?"on":(sbUrl()&&sbKey()?"err":"off")); $("#settingsSheet").classList.add("open"); }
function saveSettings(){ const g=parseInt($("#setGoal").value,10); state.settings.daily_goal=isNaN(g)?0:Math.max(0,g);
  if($("#setStart").value) state.settings.start_date=$("#setStart").value; if($("#setExam").value) state.settings.exam_date=$("#setExam").value;
  const url=$("#setUrl").value.trim(),key=$("#setKey").value.trim(); let re=false;
  if(url!==(localStorage.getItem(LS.url)||"")){ localStorage.setItem(LS.url,url); re=true; }
  if(key!==(localStorage.getItem(LS.key)||"")){ localStorage.setItem(LS.key,key); re=true; }
  saveLocal(); queuePush("settings",{}); flushPush(); $("#settingsSheet").classList.remove("open"); toast("저장됨"); renderHome();
  if(re){ if(realtimeChan&&sb) sb.removeChannel(realtimeChan); sb=null; initSync(); } }

/* ============================================================
   RENDER orchestration
   ============================================================ */
function renderAll(){ renderHome(); }
function softRender(){
  // Never re-render a hub view while a session is in progress — a background
  // sync echo must not reset the analogy/reading view and kick the user out.
  if(sessionActive()) return;
  const a=$(".view.active")?.id;
  ({"view-home":renderHome,"view-vocab":renderVocab,"view-analogy":renderAnalogyHub,"view-reading":renderReading,"view-stats":renderStats}[a]||(()=>{}))(); }
window.__softRender=softRender; // test/debug hook

/* ============================================================
   WIRING
   ============================================================ */
function wire(){
  $$("#nav button[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
  // 사이드바 접기/펴기(넓은 화면). 상태 기억.
  const applyNavCollapsed=()=>{ const c=localStorage.getItem("afoqt_nav_collapsed")==="1";
    document.body.classList.toggle("nav-collapsed",c); const t=$("#navToggle"); if(t){ t.textContent=c?"▶":"◀"; t.setAttribute("aria-label",c?"메뉴 펴기":"메뉴 접기"); } };
  $("#navToggle").onclick=()=>{ const c=!document.body.classList.contains("nav-collapsed");
    localStorage.setItem("afoqt_nav_collapsed", c?"1":"0"); applyNavCollapsed(); };
  applyNavCollapsed();
  // home
  $("#btnStartNew")&&($("#btnStartNew").onclick=startStudyNew);
  $("#btnStartRev")&&($("#btnStartRev").onclick=startStudyReview);
  $("#btnExam").onclick=()=>go("exam");
  $("#btnDaily").onclick=()=>startExam("daily");
  $("#btnCurr").onclick=()=>openCurriculum();
  $("#vkCurr").onclick=()=>openCurriculum("wk"); $("#vaCurr").onclick=()=>openCurriculum("va"); $("#rcCurr").onclick=()=>openCurriculum("rc");
  $("#currBack").onclick=()=>go("home");
  $("#repBack").onclick=()=>go("stats"); $("#btnReport")&&($("#btnReport").onclick=openReport); $("#repOpen")&&($("#repOpen").onclick=openReport);
  $("#btnExamLog")&&($("#btnExamLog").onclick=()=>{ examLogIdx=null; go("examlog"); });
  // 수학 유형별 공략
  $("#btnMathTypes")&&($("#btnMathTypes").onclick=()=>go("mathtypes"));
  $("#mtBack")&&($("#mtBack").onclick=()=>go("math"));
  // 요약 시트
  $("#btnCheatsheet")&&($("#btnCheatsheet").onclick=()=>openCheatsheet("exam"));
  $("#btnCheatsheet2")&&($("#btnCheatsheet2").onclick=()=>openCheatsheet("stats"));
  $("#csBack")&&($("#csBack").onclick=()=>go(csFrom||"exam"));
  $("#csPrint")&&($("#csPrint").onclick=()=>{ $$("#csBody details").forEach(d=>d.open=true); window.print(); });
  $$("#currTabs .chip").forEach(c=>c.onclick=()=>{ curTrack=c.dataset.ct; renderCurriculum(); });
  $("#cpBack").onclick=()=>{ curSes=null; go("curriculum"); };
  $("#cpRetry").onclick=()=>{ const t=curSes?.t??curTrack, si=curSes?.si??0; curSes=null; startCurrStage(t,si); };
  $("#cpToCurr").onclick=()=>{ curSes=null; go("curriculum"); };
  $("#secWK").onclick=()=>go("vocab"); $("#secVA").onclick=()=>go("analogy"); $("#secRC").onclick=()=>go("reading");
  $("#secAV").onclick=()=>go("aviation");
  $("#mkPractice").onclick=()=>startExam("mk",{practice:true}); $("#mkExam").onclick=()=>startExam("mk"); $("#mkGuide").onclick=()=>openGuide("mk");
  $("#arPractice").onclick=()=>startExam("ar",{practice:true}); $("#arExam").onclick=()=>startExam("ar"); $("#arGuide").onclick=()=>openGuide("ar");
  $("#secAR").onclick=()=>openSubtest("ar"); $("#secMK").onclick=()=>openSubtest("mk");
  $("#secPS").onclick=()=>openSubtest("ps"); $("#secSJ").onclick=()=>openSubtest("sj");
  $("#secTR").onclick=startTableReading; $("#secIC").onclick=startInstrument; $("#secBC").onclick=startBlockCounting;
  $("#secSDI").onclick=()=>openGuide("sdi");
  // generic subtest hub
  $("#subBack").onclick=()=>go("home");
  // instrument comprehension
  $("#icStart").onclick=startInstrument; $("#icGuide").onclick=()=>openGuide("ic");
  $("#icBack").onclick=()=>{ icTimerStop(); icState=null; go("aviation"); }; $("#icRetry").onclick=startInstrument; $("#icHome").onclick=()=>{ icState=null; go("aviation"); };
  // vocab hub
  $("#vkNew")&&($("#vkNew").onclick=startStudyNew);
  $("#vkReview")&&($("#vkReview").onclick=startStudyReview);
  $("#vkQuiz").onclick=()=>go("quiz"); $("#vkWords").onclick=()=>go("words");
  $("#vkSynq").onclick=()=>go("synq"); $("#synqGo").onclick=startSynQuiz;
  $("#synqBack").onclick=()=>{ synq=null; go("vocab"); }; $("#synqStop").onclick=()=>{ synq=null; renderSynQuiz(); };
  $("#vkAuto").onclick=()=>go("autoplay"); $("#apBack").onclick=()=>go("vocab"); $("#apGo").onclick=startAutoPlay;
  $("#apPlay").onclick=apTogglePlay; $("#apPrev").onclick=()=>apManual(-1); $("#apNext").onclick=()=>apManual(1);
  $("#vkExam").onclick=()=>startExam("wk"); $("#vkRoots").onclick=()=>go("roots");
  $("#vkGuide").onclick=()=>openGuide("wk"); $("#vaGuide").onclick=()=>openGuide("va"); $("#rcGuide").onclick=()=>openGuide("rc");
  // aviation
  $("#avFlash").onclick=()=>go("avflash"); $("#avGlossary").onclick=()=>go("avterms");
  $("#avStudy").onclick=()=>go("avstudy"); $("#avsBack").onclick=()=>go("aviation");
  $("#avBook").onclick=()=>{ avBookCh=null; go("avbook"); };
  $("#avsSearch").oninput=e=>{ avsSearch=e.target.value.trim(); renderAvStudy(); };
  $$("#avsFilters .chip").forEach(c=>c.onclick=()=>{ $$("#avsFilters .chip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); avsFilter=c.dataset.as; renderAvStudy(); });
  $("#avExam").onclick=()=>startExam("av"); $("#avGuide").onclick=()=>openGuide("av");
  $("#avtBack").onclick=()=>go("aviation"); $("#avfBack").onclick=()=>go("aviation");
  $("#trStart").onclick=startTableReading; $("#trGuide").onclick=()=>openGuide("tr");
  $("#trBack").onclick=()=>{ trTimerStop(); trState=null; go("aviation"); }; $("#trRetry").onclick=startTableReading; $("#trHome").onclick=()=>{ trState=null; go("aviation"); };
  $("#bcStart").onclick=startBlockCounting; $("#bcGuide").onclick=()=>openGuide("bc");
  $("#bcBack").onclick=()=>{ bcTimerStop(); bcState=null; go("aviation"); }; $("#bcRetry").onclick=startBlockCounting; $("#bcHome").onclick=()=>{ bcState=null; go("aviation"); };
  $("#exportProg").onclick=exportProgress;
  $("#importProg").onclick=()=>$("#importFile").click();
  $("#importFile").onchange=e=>{ if(e.target.files&&e.target.files[0]) importProgress(e.target.files[0]); e.target.value=""; };
  $("#avtSearch").oninput=e=>{ avtSearch=e.target.value.trim(); renderAvTerms(); };
  $$("#avtFilters .chip").forEach(c=>c.onclick=()=>{ $$("#avtFilters .chip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); avtFilter=c.dataset.af; renderAvTerms(); });
  $("#rootsBack").onclick=()=>go("vocab");
  $("#rootsSearch").oninput=e=>{ rootSearch=e.target.value.trim(); renderRoots(); };
  $$("#rootsFilters .chip").forEach(c=>c.onclick=()=>{ $$("#rootsFilters .chip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); rootFilter=c.dataset.rf; renderRoots(); });
  // root coach
  $("#vkCoach").onclick=()=>go("rootcoach");
  $("#coachExit").onclick=()=>go("vocab");
  $("#coachRestart").onclick=()=>{ if(confirm("처음부터 다시 볼까요?")){ state.rootStep=0; saveLocal(); renderRootCoach(); } };
  $("#coachPrev").onclick=()=>coachGo(-1);
  $("#coachNext").onclick=()=>coachGo(1);
  // exam
  $$("#examSetup .exam-preset").forEach(b=>b.onclick=()=>startExam(b.dataset.exam));
  $("#examExit").onclick=()=>go("home");
  $("#examQuit").onclick=()=>{ if(!exam||exam.submitted||confirm("시험을 그만두고 나갈까요? 기록은 저장되지 않아요.")){ stopExamTimer(); clearExamSnap(); examReleaseWake(); exam=null; go("home"); } };
  $("#examPrev").onclick=()=>{ if(!exam) return; const s=curExamSec(), lo=s?s.from:0;
    if(exam.idx>lo){ exam.idx--; renderExamQ(); } };
  $("#examNext").onclick=()=>{ if(!exam) return; const s=curExamSec(), hi=s?s.to:exam.total-1;
    if(exam.idx<hi){ exam.idx++; renderExamQ(); } };
  // 섹션 모드: 마지막 섹션이 아니면 '섹션 제출 → 다음 섹션'
  $("#pickStart")&&($("#pickStart").onclick=startPickedExam);
  $("#retestPickStart")&&($("#retestPickStart").onclick=()=>startRetest(WRONG_ORDER.filter(k=>retestSel.has(k))));
  $("#examSubmit").onclick=()=>{ if(exam&&exam.sections&&exam.secIdx<exam.sections.length-1) advanceExamSection(false);
    else submitExam(false); };
  $("#examReviewBtn").onclick=()=>{ renderExamReview(); $("#examReviewBtn").classList.add("hidden"); $("#examReview").scrollIntoView({behavior:"smooth"}); };
  $("#examRetry").onclick=()=>{ if(exam&&exam.key){
      if(String(exam.key).startsWith("mock_")&&!EXAM_PRESETS[exam.key]){ toast("🔒 기출 모의고사는 잠금 해제 후 다시 응시할 수 있어요."); go("exam"); return; }
      startExam(exam.key);
    } else go("exam"); };
  $("#retestAll").onclick=()=>startRetest("all");
  $("#examDoneHome").onclick=()=>go("home");
  $("#optHighFirst").onchange=e=>{ state.settings.high_first=e.target.checked; saveLocal(); queuePush("settings",{}); renderHome(); };
  $("#optHighOnly").onchange=e=>{ state.settings.high_only=e.target.checked; saveLocal(); queuePush("settings",{}); renderHome(); };
  $("#optShowKo")&&($("#optShowKo").onchange=e=>{ state.settings.hide_ko=!e.target.checked; saveLocal(); queuePush("settings",{});
    toast(e.target.checked?"한글 번역을 표시해요":"실전 모드 — 영어 원문만 보여요 💪"); });
  $("#optPilotPerfect")&&($("#optPilotPerfect").onchange=e=>{ state.settings.pilot_perfect=e.target.checked; saveLocal(); queuePush("settings",{});
    toast(e.target.checked?"표읽기·블록·계기를 만점으로 계산해요 ✈️":"세 과목을 다시 앱 성적으로 계산해요"); renderHome(); });
  // study
  $("#studyBack").onclick=()=>{ session=null; go("vocab"); }; $("#doneHome").onclick=()=>go("home"); $("#doneMore").onclick=()=>{ if(dueCards().length) startStudyReview(); else startStudyNew(); };
  $("#doneQuiz").onclick=()=>{ if(poolFor("today").length<4){ toast("오늘 학습한 단어가 4개 이상이면 퀴즈를 볼 수 있어요"); return; } session=null; startQuizScope("today"); };
  // quiz
  $("#quizBack").onclick=()=>{ quiz=null;   // 안 지우면 sessionActive()가 영구 true — 홈 갱신·SW 업데이트가 멈춘다
    $("#quizStart").classList.remove("hidden"); $("#quizDone").classList.add("hidden"); $("#quizArea").innerHTML="";
    go("vocab"); };
  $("#quizGo").onclick=startQuiz;
  $("#quizRetry").onclick=()=>{ $("#quizDone").classList.add("hidden"); $("#quizStart").classList.remove("hidden"); $("#quizArea").innerHTML=""; };
  $("#quizHomeBtn").onclick=()=>go("home");
  $("#vkConfirm").onclick=()=>go("confirm");
  $("#confirmBack").onclick=()=>{ confirmQuiz=null;
    $("#confirmStart").classList.remove("hidden"); $("#confirmDone").classList.add("hidden"); $("#confirmArea").innerHTML="";
    go("vocab"); };
  $("#confirmGo").onclick=startConfirm;
  $("#sweepGo")&&($("#sweepGo").onclick=startSweep);
  $("#confirmRetryBtn").onclick=()=>{
    if(confirmMode==="sweep"&&sweepPool().length){ startSweep(); return; } // 스윕 이어서
    $("#confirmDone").classList.add("hidden"); $("#confirmStart").classList.remove("hidden"); $("#confirmArea").innerHTML=""; renderConfirmHub(); };
  $("#confirmHomeBtn").onclick=()=>go("home");
  // words
  $("#wordsBack").onclick=()=>go("vocab"); $("#searchBox").oninput=e=>{ wordSearch=e.target.value.trim(); renderWords(); };
  $("#vkMock")&&($("#vkMock").onclick=()=>startStudySet(mockWordIds(),"모의고사 단어"));
  $("#vkWrong")&&($("#vkWrong").onclick=()=>startStudySet(wrongWordIds(),"오답 단어"));
  // 무한 스크롤: 중첩 스크롤러도 잡도록 capture 단계에서 듣는다.
  window.addEventListener("scroll",pumpWords,true); window.addEventListener("resize",pumpWords);
  wireStudyKeys(); wireChoiceKeys();
  { const m=$("#wordMore"); if(m) m.onclick=()=>appendWords(WORD_PAGE); }
  $$("#wordFilters .chip").forEach(c=>c.onclick=()=>{ $$("#wordFilters .chip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); wordFilter=c.dataset.f; renderWords(); });
  // analogy
  $("#vaStart").onclick=()=>startAnalogy(false); $("#vaReview").onclick=()=>startAnalogy(true);
  $("#vaExam").onclick=()=>startExam("va");
  $("#vaBrowse").onclick=()=>go("vabrowse"); $("#vabBack").onclick=()=>go("analogy");
  $("#vabSearch").oninput=e=>{ vaBrowseSearch=e.target.value.trim(); renderVaBrowse(); };
  $$("#vabFilters .chip").forEach(c=>c.onclick=()=>{ $$("#vabFilters .chip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); vaBrowseFilter=c.dataset.vr; renderVaBrowse(); });
  $("#vaBack").onclick=()=>{ vaSession=null; renderAnalogyHub(); }; $("#vaRetry").onclick=()=>startAnalogy(false); $("#vaHomeBtn").onclick=()=>go("home");
  // reading
  $("#rcBack").onclick=()=>go("reading"); $("#rcToList").onclick=()=>go("reading"); $("#rcNext").onclick=nextPassage;
  $("#rcExam").onclick=()=>startExam("rc");
  // settings
  $("#btnSettings").onclick=openSettings; $("#closeSettings").onclick=()=>$("#settingsSheet").classList.remove("open");
  $("#settingsSheet").onclick=e=>{ if(e.target.id==="settingsSheet") $("#settingsSheet").classList.remove("open"); };
  $("#saveSettings").onclick=saveSettings;
  $("#copyCode").onclick=()=>{ navigator.clipboard?.writeText(syncCode()); toast("동기화 코드 복사됨"); };
  $("#newCode").onclick=()=>{ if(confirm("새 동기화 코드를 만들면 이 기기는 새 데이터로 시작합니다. 계속할까요?")){ localStorage.setItem(LS.code,genCode()); location.reload(); } };
  $("#enterCode").onclick=()=>{ const c=prompt("다른 기기와 동기화할 코드를 입력하세요:",syncCode()); if(c&&c.trim()){ localStorage.setItem(LS.code,c.trim()); toast("코드 적용 — 동기화 중…"); location.reload(); } };
  $("#forceSync").onclick=forceSync;
  $("#resetAll").onclick=()=>{ if(confirm("이 기기의 학습 기록을 모두 지웁니다. 계속할까요?")){ state=DEFAULT_STATE(); saveLocal(); toast("초기화됨"); $("#settingsSheet").classList.remove("open"); go("home"); } };
  $("#forceUpdate").onclick=forceUpdate;
  // Flush pending saves before the app is backgrounded/closed (mobile-safe).
  // On returning to the app, refresh the active hub so today's count and the
  // recommended new-words amount reflect the current day (handles the day
  // rolling over while the app/PWA was left open in the background).
  document.addEventListener("visibilitychange",()=>{
    // Backgrounding/lock fires this while the page is still alive — flush the
    // pending server push here so mobile "study then close" doesn't lose progress.
    if(document.visibilityState==="hidden"){
      if(exam&&!exam.submitted){
        // 열린 문항의 시간 구간을 닫는다 — 자리 비운 10분이 그 문항 속도 기록으로 들어가지 않게
        exam.times=exam.times||new Array(exam.total).fill(0);
        if(exam._openIdx!=null&&exam._openAt){ exam.times[exam._openIdx]+=Date.now()-exam._openAt; exam._openAt=null; }
        saveExamSnap();
      }
      saveNow(); flushPush(); return; }
    // Wake Lock is dropped when the tab is hidden — re-acquire it on return if auto-play is running.
    if(ap && ap.playing) apAcquireWake();
    if(exam && !exam.submitted){ examAcquireWake();   // 시험 복귀: 화면 꺼짐 방지 재획득 + 스톱워치 재개
      if(exam._openIdx!=null&&!exam._openAt) exam._openAt=Date.now(); }
    if(!sessionActive()){ lastDay=todayStr(); softRender(); }
  });
  window.addEventListener("focus",()=>{ if(!sessionActive()) softRender(); });
  // Day-rollover watcher: if the calendar day changes while the app is left
  // open, re-render so the recommended daily amount recalculates automatically.
  setInterval(()=>{
    if(todayStr()!==lastDay){ lastDay=todayStr(); if(!sessionActive()){ const a=$(".view.active")?.id;
      if(a==="view-home") renderHome(); else softRender(); } }
  }, 60000);
  window.addEventListener("pagehide", ()=>{ saveNow(); flushPush(); });
  window.addEventListener("beforeunload", ()=>{ saveNow(); flushPush(); });
  // Preload TTS voices (they populate asynchronously in most browsers).
  if(window.speechSynthesis){ loadVoices(); window.speechSynthesis.onvoiceschanged=loadVoices; }
}
let lastDay=todayStr();

/* ============================================================
   BOOT
   ============================================================ */
// Register the service worker and auto-apply updates so users never get stuck
// on a stale cached version (no need for ?v= cache-busting URLs).
function sessionActive(){ return !!(exam&&!exam.submitted)||!!session||!!vaSession||!!quiz||!!trState||!!bcState||!!icState||!!(curSes&&!curSes.done); }
// Nuke all caches + service workers and hard-reload — guarantees the latest
// version, fixing any "I still see the old app" situation. Learning data lives
// in localStorage, which is NOT touched here.
// Backup: download the full local state as a JSON file (offline safety net).
function exportProgress(){
  saveNow();
  const data=JSON.stringify({app:"afoqt-vocab",v:VERSION,code:syncCode(),ts:Date.now(),state},null,2);
  const url=URL.createObjectURL(new Blob([data],{type:"application/json"}));
  const a=document.createElement("a"); a.href=url; a.download=`afoqt-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast("백업 파일을 저장했어요 💾");
}
// Restore: load a backup file, replace local state, reload (loadLocal re-normalizes).
function importProgress(file){
  const r=new FileReader();
  r.onload=()=>{ try{
    const d=JSON.parse(r.result); const st=d.state||d;
    if(!st||typeof st!=="object"||(!st.cards&&!st.settings&&!st.daily)){ toast("올바른 백업 파일이 아니에요"); return; }
    if(!confirm("이 백업으로 현재 기기의 진도를 덮어씁니다. 계속할까요?")) return;
    localStorage.setItem(LS.state, JSON.stringify(st));
    if(d.code) localStorage.setItem(LS.code, d.code);
    toast("복원 완료 — 새로고침합니다"); setTimeout(()=>location.reload(),700);
  }catch(e){ console.error(e); toast("복원 실패: 파일을 읽을 수 없어요"); } };
  r.readAsText(file);
}
async function forceUpdate(){
  toast("최신 버전을 받는 중…");
  try{
    if("serviceWorker" in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if(window.caches){ const ks=await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); }
  }catch(e){ console.warn(e); }
  // cache-bust the document so the server copy is fetched fresh
  const u=new URL(location.href); u.searchParams.set("v",Date.now().toString()); location.replace(u.toString());
}
// 새 버전이 준비되면 하단에 배너를 띄워 사용자가 바로 적용할 수 있게 한다.
// (풀이 중엔 자동 새로고침이 미뤄지므로, 배너가 '지금 적용' 탈출구가 된다)
function showUpdBanner(){
  if($("#updBanner")) return;
  const b=document.createElement("button"); b.id="updBanner";
  b.innerHTML=`🔄 새 버전 준비 완료 — <b>탭해서 적용</b>`;
  b.onclick=()=>{ b.disabled=true; b.textContent="적용 중…"; location.reload(); };
  document.body.appendChild(b);
}
function registerSW(){
  if(!("serviceWorker" in navigator)) return;
  let reloaded=false;
  // When a new SW takes control, reload to pick up fresh assets — but never
  // mid-session (that would feel like getting kicked out). Defer until the
  // user is back on a hub screen.
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(reloaded) return;
    showUpdBanner();
    const tryReload=()=>{ if(sessionActive()){ setTimeout(tryReload,4000); return; } reloaded=true; location.reload(); };
    tryReload();
  });
  navigator.serviceWorker.register("./sw.js").then(reg=>{
    reg.update();                       // check for a newer SW now
    setInterval(()=>reg.update(), 60*60*1000); // and hourly while open
    reg.addEventListener("updatefound",()=>{
      const nw=reg.installing;
      if(!nw) return;
      nw.addEventListener("statechange",()=>{
        // A new version installed while an old SW still controls the page:
        // tell it to activate immediately (sw.js calls skipWaiting too).
        if(nw.state==="installed" && navigator.serviceWorker.controller){
          nw.postMessage&&nw.postMessage("skip-waiting");
        }
      });
    });
  }).catch(()=>{});
}
/* ============================================================
   첫 진입 온보딩 — 시험일 → 진단 → 플랜 3단계 (기존 사용자는 자동 통과)
   ============================================================ */
function maybeOnboard(){
  if(state.settings.onboard_done) return;
  // 기존 사용자 판정: 실제 학습 흔적이 있는지 (renderHome 이 오늘 daily 빈 엔트리를
  // 만들어 두므로 키 존재가 아니라 studied>0 로 본다)
  const used=Object.keys(state.cards).length>0||(state.examHist||[]).length>0
    ||Object.values(state.daily||{}).some(d=>(d&&d.studied||0)>0);
  if(used){ state.settings.onboard_done=1; saveNow(); return; }
  const ov=document.createElement("div"); ov.id="onboard"; ov.className="onboard-overlay";
  ov.innerHTML=`<div class="onboard-card">
    <div class="big-emoji">🎯</div>
    <h2 style="margin:4px 0 2px">AFOQT 준비, 3단계로 시작!</h2>
    <div class="muted" style="font-size:12px;margin-bottom:12px">1분이면 세팅 끝나요.</div>
    <div class="ob-step"><b>1️⃣ 시험 날짜</b>
      <input type="date" id="obDate" value="${esc(state.settings.exam_date)}"></div>
    <div class="ob-step"><b>2️⃣ 진단 모의고사</b><div class="muted" style="font-size:12px">전 과목 1회로 현재 실력 측정 (약 30분) — 홈에 예상 점수가 떠요</div></div>
    <div class="ob-step"><b>3️⃣ 완성 플랜</b><div class="muted" style="font-size:12px">시험일까지 매일 '오늘 할 일'이 자동으로 생겨요 (🗓️ 플랜 탭)</div></div>
    <button class="btn primary" id="obGo" style="margin-top:14px">🩺 날짜 저장하고 진단 시작</button>
    <button class="btn ghost" id="obSkip" style="margin-top:8px">나중에 — 먼저 둘러보기</button></div>`;
  document.body.appendChild(ov);
  const close=()=>{ const d=$("#obDate").value; if(d) state.settings.exam_date=d;
    state.settings.onboard_done=1; saveLocal(); queuePush("settings",{}); ov.remove(); renderHome(); };
  $("#obGo").onclick=()=>{ close(); startExam("afoqt"); };
  $("#obSkip").onclick=close;
}
async function loadJSON(path){
  try{
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(), 20000);
    const r=await fetch(path,{cache:"force-cache",signal:ctrl.signal});
    clearTimeout(t);
    if(!r.ok) return null;
    return await r.json();
  }catch{ return null; }
}
async function boot(){
  try{
    loadLocal(); wire();
    WORDS=await loadJSON("./words.json")||[];
    if(!WORDS.length){
      $("#boot").innerHTML="<p class='center'>단어 데이터를 불러오지 못했어요.<br>네트워크를 확인하고 새로고침 해주세요.</p>"+
        "<button class='btn primary' style='max-width:200px;margin:16px auto' onclick='location.reload()'>새로고침</button>";
      return;
    }
    WMAP=new Map(WORDS.map(w=>[w.id,w]));
    buildRootIndex();
    ANALOGIES=await loadJSON("./analogies.json")||[];
    READING=await loadJSON("./reading.json")||[];
    ROOTS=await loadJSON("./roots.json")||[];
    ROOTLESSONS=await loadJSON("./root_lessons.json")||[];
    GUIDES=await loadJSON("./guides.json")||{};
    AVIATION=await loadJSON("./aviation.json")||[];
    AVTERMS=await loadJSON("./aviation_terms.json")||[];
    AVBOOK=await loadJSON("./aviation_book.json")||[];
    ARITH=await loadJSON("./arithmetic.json")||[];
    MATHK=await loadJSON("./mathknowledge.json")||[];
    PHYSCI=await loadJSON("./physicalscience.json")||[];
    SITJUD=await loadJSON("./situational.json")||[];
    $("#boot").classList.remove("active"); go("home");
    maybeOnboard();
    initSync();   // non-blocking: app already usable
    registerSW();
  }catch(e){
    console.error("boot failed:",e);
    $("#boot").innerHTML="<p class='center'>앱 로딩 중 오류가 발생했어요.<br>새로고침 해주세요.</p>"+
      "<button class='btn primary' style='max-width:200px;margin:16px auto' onclick='location.reload()'>새로고침</button>";
  }
}
/* ═══════════════════════════════════════════════════════════════════════
   실전 기출 모의고사 (암호화·비공개)
   - mockexams.enc.json 은 AES-GCM 으로 암호화되어 있어 공개 저장소에 올라가도
     비밀번호 없이는 문제를 볼 수 없습니다(저작권 보호).
   - 비밀번호 입력 → 브라우저에서 복호화 → 기존 시험 러너/채점/리뷰 재사용.
   ═══════════════════════════════════════════════════════════════════════ */
let MOCK=null;                                   // 복호화된 데이터(세션 메모리에만 유지)
const MOCK_MIN={VA:8,AR:29,WK:5,MK:22,RC:24,PS:10,AV:8};   // 과목별 제한시간(분) — RC는 24분 기준
function _mb64(b){ const s=atob(b), u=new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u; }
async function _mockKey(pw,salt,iter,hash){
  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:iter,hash},base,{name:"AES-GCM",length:256},false,["decrypt"]);
}
async function mockDecrypt(pw){
  const r=await fetch("./mockexams.enc.json",{cache:"force-cache"});
  if(!r.ok) throw new Error("enc-fetch");
  const j=await r.json();
  const key=await _mockKey(pw,_mb64(j.salt),j.iter||200000,j.hash||"SHA-256");
  const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:_mb64(j.iv)},key,_mb64(j.ct));  // 틀리면 예외
  return JSON.parse(new TextDecoder().decode(pt));
}
// 저장된 문항 → 러너 아이템으로 변환(원본 순서 유지, 셔플 없음)
function mockToItems(sub){
  return sub.questions.map(q=>{
    const it={section:q.section,prompt:q.fig?"":(q.prompt||""),options:q.options.slice(),
              answer:q.answer,explain:q.explain||"",sub:""};
    if(q.passageText){ it.passageId=q.passageId; it.passageTitle=q.passageTitle; it.passageText=q.passageText; }
    if(q.fig){ it.figureHTML=`<img class="mock-fig" alt="문항" src="data:image/png;base64,${q.fig}">`; }
    return it;
  });
}
function buildMockPresets(){
  if(!MOCK||!MOCK.forms) return;
  MOCK.forms.forEach(f=>{
    const allSecs=f.subtests.reduce((s,st)=>s+(MOCK_MIN[st.code]||10)*60,0);
    const allN=f.subtests.reduce((s,st)=>s+st.count,0);
    EXAM_PRESETS["mock_"+f.id]={name:`${f.name} · 전체`,secs:allSecs,
      build:()=>f.subtests.flatMap(mockToItems),
      label:`${allN}문항 · ${fmtTime(allSecs)} · 실전`};
    f.subtests.forEach(st=>{
      const secs=(MOCK_MIN[st.code]||10)*60;
      EXAM_PRESETS[`mock_${f.id}_${st.code}`]={name:`${f.id} · ${st.name}`,secs,
        build:()=>mockToItems(st), label:`${st.count}문항 · ${fmtTime(secs)}`};
    });
  });
}
function mockUnlocked(){ return !!MOCK; }
async function unlockMock(pw){
  try{ const d=await mockDecrypt(pw); if(!d||!d.forms) return false; MOCK=d; buildMockPresets(); return true; }
  catch(e){ return false; }
}
function mockModal(){
  if($("#mockModal")) return;
  const ov=document.createElement("div"); ov.id="mockModal"; ov.className="mock-modal";
  ov.innerHTML=`<div class="mm-card">
    <div class="mm-title">🔒 실전 기출 모의고사</div>
    <div class="mm-desc">저작권 보호를 위해 비공개로 잠겨 있습니다.<br>비밀번호를 입력하세요.</div>
    <input id="mockPw" type="password" autocomplete="off" placeholder="비밀번호">
    <div id="mockErr" class="mm-err hidden">비밀번호가 올바르지 않습니다.</div>
    <div class="mm-btns"><button class="btn ghost" id="mockCancel">취소</button>
      <button class="btn primary" id="mockGo">🔓 잠금 해제</button></div></div>`;
  document.body.appendChild(ov);
  const close=()=>ov.remove();
  const go=async()=>{
    const pw=$("#mockPw").value; if(!pw) return;
    const gb=$("#mockGo"); gb.disabled=true; gb.textContent="확인 중…"; $("#mockErr").classList.add("hidden");
    const ok=await unlockMock(pw);
    if(ok){ close(); toast("🔓 모의고사 잠금 해제됨"); injectMockUI(); }
    else{ $("#mockErr").classList.remove("hidden"); gb.disabled=false; gb.textContent="🔓 잠금 해제"; $("#mockPw").select(); }
  };
  $("#mockCancel").onclick=close; $("#mockGo").onclick=go;
  $("#mockPw").onkeydown=e=>{ if(e.key==="Enter") go(); };
  ov.onclick=e=>{ if(e.target===ov) close(); };
  setTimeout(()=>{ const i=$("#mockPw"); if(i) i.focus(); },60);
}
function injectMockUI(){
  const host=$("#examSetup"); if(!host) return;
  let box=$("#mockGroup");
  if(!box){ box=document.createElement("div"); box.id="mockGroup";
    const anchor=host.querySelector("h3.exam-group"); host.insertBefore(box,anchor||null); }
  if(!mockUnlocked()){
    box.innerHTML=`<h3 class="exam-group">🔒 실전 기출 모의고사 <span class="mock-lock">비공개</span></h3>
      <button class="exam-preset mock-locked" id="mockUnlockBtn" style="border-color:var(--gold)">
        <div class="ic">🔒</div><div class="meta"><b>실제 기출 3회분 · 잠금</b>
        <div class="muted">비밀번호를 입력하면 T01·T02·T03 실전 모의고사가 열려요</div></div>
        <div class="go">›</div></button>`;
    const b=$("#mockUnlockBtn"); if(b) b.onclick=mockModal; return;
  }
  const forms=MOCK.forms.map(f=>{
    const subBtns=f.subtests.map(st=>
      `<button class="mock-sub" data-exam="mock_${f.id}_${st.code}">${SEC_KO[st.code]||st.code}<small>${st.count}</small></button>`).join("");
    const pk=EXAM_PRESETS["mock_"+f.id];
    const icon=f.icon||(f.barron?"📕":"📄");
    const note=f.note?`<div class="mock-note ${f.answerAI?"ai":""}">${esc(f.note)}</div>`:"";
    return `<button class="exam-preset" data-exam="mock_${f.id}" style="border-color:var(--gold)">
        <div class="ic">${icon}</div><div class="meta"><b>${esc(f.name)} · 전체</b>
        <div class="muted">${pk?pk.label:""}</div></div><div class="go">›</div></button>
      ${note}<div class="mock-subs">${subBtns}</div>`;
  }).join("");
  box.innerHTML=`<h3 class="exam-group">📄 실전 기출 모의고사 <span class="mock-open">🔓 열림</span></h3>
    <p class="muted" style="margin:-4px 0 10px;font-size:13px">실전 3회분 · 7과목. 전체 또는 과목별로 응시하세요.</p>${forms}`;
  box.querySelectorAll("[data-exam]").forEach(b=>b.onclick=()=>startExam(b.dataset.exam));
}


document.addEventListener("DOMContentLoaded", boot);
})();
