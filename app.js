/* ============================================================
   AFOQT Master — app.js
   Verbal 전체: Word Knowledge(WK) + Verbal Analogies(VA) + Reading(RC)
   로컬 우선 + Supabase 실시간 동기화, SM-2 SRS, 빈출 tier 페이싱
   ============================================================ */
(() => {
"use strict";

const VERSION = "4.35.0";
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
function wordFont(text,base){ const n=String(text||"").length;
  const px = n<=9?base : n<=12?Math.round(base*0.8) : n<=15?Math.round(base*0.63) : n<=19?Math.round(base*0.5) : Math.round(base*0.42);
  return `font-size:${px}px`; }
function toast(msg, ms=1800){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"), ms); }
// Text-to-speech (browser built-in). Speaks English words/sentences for pronunciation.
let _voices=[];
function loadVoices(){ try{ _voices=window.speechSynthesis? window.speechSynthesis.getVoices():[]; }catch{} }
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
  curr:{},    // 커리큘럼: track -> {unlocked:int, passed:{si:1}, best:{si:score}}
  checklist:{},  // 주차별 체크리스트: 'weekKey:phase' -> {taskIdx:1}
  apExposure:{}, // 자동 넘김 노출 기록: 'YYYY-MM-DD' -> 들은 단어 수(스트릭 인정용, SRS엔 영향 X)
  badges:{},     // 달성 배지: badgeId -> 1
  rootStep:0,    // 어근 추론 코치 진행 위치
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
  state.wkSeen=state.wkSeen||{}; state.avp=state.avp||{}; state.secAcc=state.secAcc||{}; state.curr=state.curr||{}; state.checklist=state.checklist||{}; state.apExposure=state.apExposure||{}; state.badges=state.badges||{};
  state.examHist=state.examHist||[];
  state.settings=Object.assign(d.settings, state.settings||{});
}
let saveTimer=null;
function saveLocal(){ clearTimeout(saveTimer); saveTimer=setTimeout(saveNow,150); if(sb) queuePush("app_state"); }
// Write immediately. Mobile browsers freeze timers when the app is backgrounded,
// so a debounced save can be lost — always flush on hide/pagehide (see wire()).
function saveNow(){ clearTimeout(saveTimer); try{ localStorage.setItem(LS.state, JSON.stringify(state)); }catch(e){} }
function flag(k){ return !!state.settings[k]; }

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
function dueCards(){ const t=Date.now(),out=[]; for(const w of WORDS){ const c=state.cards[w.id]; if(c&&c.status!=="new"&&c.verify!=="pending"&&c.due&&new Date(c.due).getTime()<=t) out.push(w.id);} return out; }
function newCardIds(limit){
  let cand=newPool();
  if(flag("high_first")) cand=[...cand].sort((a,b)=>(TIERRANK[tierOf(a)]-TIERRANK[tierOf(b)])||a.id-b.id);
  return cand.slice(0,limit).map(w=>w.id);
}
function plannedToday(){ return dueCards().length + newPerDay(); }
function countByStatus(){
  let learned=0,mastered=0,totalRev=0,highLearned=0;
  for(const w of WORDS){ const c=state.cards[w.id]; if(!c||c.status==="new") continue;
    learned++; totalRev+=c.reps; if(c.status==="mastered") mastered++; if(tierOf(w)!=="std") highLearned++; }
  return {learned,mastered,totalRev,highLearned,remaining:WORDS.length-learned};
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
const BADGES=[
  {id:"streak7",  icon:"🔥", name:"7일 연속",   t:m=>m.streak>=7},
  {id:"streak14", icon:"🔥", name:"14일 연속",  t:m=>m.streak>=14},
  {id:"streak30", icon:"🏆", name:"30일 연속",  t:m=>m.streak>=30},
  {id:"streak50", icon:"🏆", name:"50일 연속",  t:m=>m.streak>=50},
  {id:"learn100", icon:"📇", name:"단어 100",   t:m=>m.learned>=100},
  {id:"learn300", icon:"📚", name:"단어 300",   t:m=>m.learned>=300},
  {id:"learn500", icon:"📚", name:"단어 500",   t:m=>m.learned>=500},
  {id:"learn1000",icon:"🎓", name:"단어 1000",  t:m=>m.learned>=1000},
  {id:"master50", icon:"⭐", name:"마스터 50",  t:m=>m.mastered>=50},
  {id:"master100",icon:"🌟", name:"마스터 100", t:m=>m.mastered>=100},
  {id:"master250",icon:"💎", name:"마스터 250", t:m=>m.mastered>=250},
  {id:"mock1",    icon:"🎯", name:"첫 모의고사", t:m=>m.mocks>=1},
  {id:"mock10",   icon:"🎯", name:"모의고사 10회",t:m=>m.mocks>=10},
];
function badgeMetrics(){ const c=countByStatus(); return {streak:computeStreak(), learned:c.learned, mastered:c.mastered, mocks:(state.examHist||[]).length}; }
// 새로 달성한 배지가 있으면 저장 + (silent 아니면) 축하 토스트.
function checkBadges(silent){
  const m=badgeMetrics(); const newly=[];
  for(const b of BADGES){ if(b.t(m) && !state.badges[b.id]){ state.badges[b.id]=1; newly.push(b); } }
  if(newly.length){ saveLocal(); if(!silent){ const b=newly[newly.length-1]; toast(`${b.icon} 배지 획득! ${b.name} 🎉`, 3600); } }
  return m;
}

/* ============================================================
   SRS (SM-2 변형)
   ============================================================ */
function predict(id,q){ const c={...getCard(id)};
  if(q==="hard") return c.reps===0?1:Math.max(1,c.interval*1.2);
  if(q==="good") return c.reps===0?1:c.reps===1?3:c.interval*c.ease;
  if(q==="easy") return c.reps===0?2:c.interval*c.ease*1.3; return 0; }
function gradeCard(id,q){ const c={...getCard(id)};
  if(q==="again"){ c.lapses++; c.ease=Math.max(1.3,c.ease-0.2); c.interval=0; c.status="learning"; c.due=nowISO(); }
  else { if(q==="hard"){ c.ease=Math.max(1.3,c.ease-0.15); c.interval=c.reps===0?1:Math.max(1,c.interval*1.2);}
    else if(q==="good"){ c.interval=c.reps===0?1:c.reps===1?3:c.interval*c.ease; }
    else { c.ease+=0.15; c.interval=c.reps===0?2:c.interval*c.ease*1.3; }
    c.reps++; c.status=c.interval>=21?"mastered":(c.reps>=1?"review":"learning");
    const due=new Date(); due.setMinutes(due.getMinutes()+Math.round(c.interval*1440)); c.due=due.toISOString(); }
  setCard(id,c); }
function fmtIv(d){ if(d<1) return "<1일"; if(d>=21) return "마스터"; return Math.round(d)+"일"; }

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
function renderConfirmHub(){
  const cf=confirmPoolFirst().length, cr=confirmPoolRecheck().length;
  $("#confirmPoolInfo").innerHTML = cr>0
    ? `🔁 <b>재확인 ${cr}개</b> 대기 (지난 확인 성공 후 7일 경과) · 첫 확인 대기 ${cf}개`
    : cf>0 ? `첫 확인 대기 <b>${cf}개</b> — 복습/마스터 단계 단어 중 아직 검증 안 한 것들`
    : "아직 확인할 단어가 없어요. 플래시카드로 복습 단계까지 학습하면 여기 나타나요.";
  $("#confirmGo").disabled = (cf+cr)===0;
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
  $("#confirmCount").textContent=`${q.idx+1} / ${q.items.length}`; $("#confirmTag").textContent=isRecheck?"🔁 재확인":"✅ 첫 확인";
  $("#confirmBar").style.width=(q.idx/q.items.length*100)+"%";
  const correct=w.kor, choices=sample(WORDS.filter(x=>x.id!==id&&x.kor),3).map(x=>x.kor);
  const opts=shuffle([correct,...choices]);
  $("#confirmArea").innerHTML=`<div class="card"><div class="q-prompt">이 단어, 진짜 뜻을 알아요? (뒤집기 없이 바로 선택)</div><div class="q-word" style="${wordFont(w.word,26)}">${esc(w.word)}</div>
    <div class="choices" id="confirmChoices">${opts.map(o=>`<button class="choice">${esc(o)}</button>`).join("")}</div></div>`;
  q.answered=false;
  $$("#confirmChoices .choice").forEach(btn=>btn.onclick=()=>{ if(q.answered) return; q.answered=true; const ok=btn.textContent===correct;
    $$("#confirmChoices .choice").forEach(b=>{ b.disabled=true; if(b.textContent===correct) b.classList.add("correct"); else if(b===btn) b.classList.add("wrong"); });
    gradeConfirm(id,ok,isRecheck); if(ok) q.score++;
    bumpDay({studied:1,correct:ok?1:0}); recordSecAcc("WK",ok);
    setTimeout(()=>{ q.idx++; renderConfirm(); }, ok?550:1300);
  });
}
function finishConfirm(){
  const q=confirmQuiz, total=q.items.length;
  $("#confirmArea").innerHTML=""; $("#confirmBar").style.width="100%";
  $("#confirmResult").textContent=`${q.score} / ${total} 진짜 암기 확인`;
  $("#confirmResultSub").textContent = q.score===total ? "완벽해요! 통과한 단어는 며칠 뒤 몰래 한 번 더 확인할게요."
    : "틀린 단어는 복습 목록으로 돌아갔어요 — 찍은 거였을 수도 있으니 다시 익혀봐요.";
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
  if(r.data){ if(r.data.high_first!=null) state.settings.high_first=r.data.high_first; if(r.data.high_only!=null) state.settings.high_only=r.data.high_only; } }
// The "misc" state (exams, wrong-notes, weakness, predicted-score tallies,
// coverage, exam history, curriculum) synced as one JSON blob, field-merged so
// neither device clobbers the other.
function miscBlob(){ return {exams:state.exams,wrong:state.wrong,weak:state.weak,secAcc:state.secAcc,
  wkSeen:state.wkSeen,avp:state.avp,examHist:state.examHist,curr:state.curr,checklist:state.checklist,apExposure:state.apExposure,badges:state.badges}; }
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
  ["wk","va","rc","ar","mk","ps","av"].forEach(g=>{ Object.assign(state.wrong[g]||(state.wrong[g]={}), (d.wrong||{})[g]||{}); });
  // exam history: union by ts, keep last 200
  const seen=new Set(state.examHist.map(x=>x.ts));
  (d.examHist||[]).forEach(x=>{ if(!seen.has(x.ts)){ state.examHist.push(x); seen.add(x.ts); } });
  state.examHist.sort((a,b)=>a.ts-b.ts); if(state.examHist.length>200) state.examHist=state.examHist.slice(-200);
  for(const k in (d.checklist||{})){ state.checklist[k]=Object.assign(state.checklist[k]||{}, d.checklist[k]); }
  // apExposure: keep the higher count per day (union, max)
  for(const day in (d.apExposure||{})){ state.apExposure[day]=Math.max(state.apExposure[day]||0, d.apExposure[day]||0); }
  for(const k in (d.badges||{})){ state.badges[k]=1; } // 배지: 획득분 union
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
  else if(table==="settings") pushQ.settings={user_key:code,daily_goal:state.settings.daily_goal,start_date:state.settings.start_date,exam_date:state.settings.exam_date,data:{high_first:state.settings.high_first,high_only:state.settings.high_only},updated_at:nowISO()};
  clearTimeout(pushTimer); pushTimer=setTimeout(flushPush,700); }
// Each table pushes independently and only clears its queue on confirmed success —
// so a stale schema (e.g. a column added client-side before the SQL migration runs)
// fails just that one table and self-heals on the next push once the DB catches up,
// instead of silently dropping every table's pending writes.
async function flushPush(){ if(!sb) return;
  if(pushQ.vocab_state.size){ const r=[...pushQ.vocab_state.values()];
    try{ await sb.from("vocab_state").upsert(r,{onConflict:"user_key,word_id"}); pushQ.vocab_state.clear(); }
    catch(e){ console.error("push vocab_state fail",e); setSyncDot("err"); } }
  if(pushQ.verbal_progress.size){ const r=[...pushQ.verbal_progress.values()];
    try{ await sb.from("verbal_progress").upsert(r,{onConflict:"user_key,kind,item_id"}); pushQ.verbal_progress.clear(); }
    catch(e){ console.error("push verbal_progress fail",e); setSyncDot("err"); } }
  if(pushQ.daily_log.size){ const r=[...pushQ.daily_log.values()];
    try{ await sb.from("daily_log").upsert(r,{onConflict:"user_key,day"}); pushQ.daily_log.clear(); }
    catch(e){ console.error("push daily_log fail",e); setSyncDot("err"); } }
  if(pushQ.settings){ const r=pushQ.settings;
    try{ await sb.from("settings").upsert(r,{onConflict:"user_key"}); pushQ.settings=null; }
    catch(e){ console.error("push settings fail",e); setSyncDot("err"); } }
  if(pushQ.app_state){ const r=pushQ.app_state;
    try{ await sb.from("app_state").upsert(r,{onConflict:"user_key"}); pushQ.app_state=null; }
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
const NAVPARENT={study:"vocab",quiz:"vocab",words:"vocab",roots:"vocab",rootcoach:"vocab",guide:"vocab",autoplay:"vocab",synq:"vocab",vabrowse:"analogy",passage:"reading",exam:"home",avterms:"aviation",avstudy:"aviation",avbook:"aviation",avflash:"aviation",tablereading:"aviation",blockcounting:"aviation",instrument:"aviation",subtest:"home",curriculum:"home",currplay:"home",report:"stats",math:"math",confirm:"vocab"};
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
  $$(".view").forEach(v=>v.classList.remove("active"));
  $("#view-"+view).classList.add("active");
  const navsel=NAVPARENT[view]||view;
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go===navsel));
  window.scrollTo(0,0);
  ({home:renderHome,vocab:renderVocab,words:renderWords,synq:renderSynQuiz,analogy:renderAnalogyHub,vabrowse:renderVaBrowse,reading:renderReading,stats:renderStats,exam:renderExamSetup,roots:renderRoots,rootcoach:renderRootCoach,guide:renderGuide,aviation:renderAviation,avterms:renderAvTerms,avstudy:renderAvStudy,avbook:renderAvBook,avflash:startAvFlash,subtest:renderSubtest,curriculum:renderCurriculum,report:renderReport,confirm:renderConfirmHub,math:renderMath,autoplay:renderAutoPlaySetup}[view]||(()=>{}))();
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
  checkBadges(); // 마일스톤 달성 시 축하 토스트
  // ---- 동기부여 배너: 손실 프레이밍 + 밀린 복습 자연 경고 (스트릭 보호막 안내 포함) ----
  const mb=$("#motivBanner");
  if(mb){
    if(todayActive){
      mb.className="card motiv done";
      mb.innerHTML=`<b>🔥 오늘 완료! ${streak}일째 이어가는 중</b> 🎉 <span class="muted">— 이 리듬 유지하면 9/28 준비 충분해요.</span>`;
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
  const rcDone=Object.values(state.rc).filter(v=>v.done||v.seen).length;
  const rcR=READING.length?rcDone/READING.length:0;
  const avEx=state.exams.av; const avCov=Object.keys(state.avp).length;
  const avR=AVIATION.length?avCov/AVIATION.length:0;
  $("#wkBar").style.width=Math.round(wkR*100)+"%";
  $("#wkSub").textContent=`빈출 ${afLearned}/${afCount} · 전체 ${cnt.learned}/${WORDS.length}`;
  $("#vaBar").style.width=Math.round(vaR*100)+"%";
  $("#vaSub").textContent=ANALOGIES.length?`유추 ${vaSeen}/${ANALOGIES.length}`:"준비 중";
  $("#rcBar").style.width=Math.round(rcR*100)+"%";
  $("#rcSub").textContent=READING.length?`독해 ${rcDone}/${READING.length}`:"준비 중";
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
  renderWeekPlan();
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
  return {key:"final",name:"마무리 (D-10)",emoji:"🔥",tasks:[
    "📕 오답·빈출 단어만 빠르게",
    "🎯 가벼운 모의고사 1회",
    "📊 예상 점수 최종 확인",
    "😴 컨디션·수면 관리",
    "✅ 9/28 응시 준비물·일정 확인"]};
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
   VOCAB HUB
   ============================================================ */
function renderVocab(){
  const cnt=countByStatus();
  $("#vkLearned").textContent=cnt.learned; $("#vkMastered").textContent=cnt.mastered;
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
function apSaveSession(){ if(!ap) return; state.autoplay={queue:ap.queue, idx:ap.idx, scope:ap.scope, speed:ap.speed, ko:ap.ko, loop:ap.loop}; saveLocal(); }
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
      speed:sv.speed||"normal", ko:sv.ko!==false, loop:sv.loop!==false, scope:sv.scope, t:null};
  $("#apSetup").classList.add("hidden"); $("#apPlayer").classList.remove("hidden");
  apAcquireWake(); apShowPhase();
}
function startAutoPlay(){
  const scope=$("#apScope").value;
  let ids=poolFor(scope);
  if(!ids.length){ toast("이 범위에 단어가 없어요. 학습을 하거나 범위를 바꿔보세요."); return; }
  ids=shuffle(ids);
  ap={queue:ids, idx:0, revealed:false, playing:true, speed:$("#apSpeed").value, ko:$("#apKo").checked, loop:$("#apLoop").checked, scope, t:null};
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
  if(s.playing && w){ if(s.ko && w.kor) speak(w.kor,null,"ko-KR"); else if(w.def) speak(w.def); }
  apClearTimer(); if(s.playing) s.t=setTimeout(apAdvance, AP_SPEED[s.speed].mean);
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
    done:[...(s.doneSet||[])],miss:[...(s.missSet||[])],neww:[...(s.newSet||[])],day:todayStr()}; }
function startStudy(){
  // Resume an unfinished session (don't restart from scratch when you re-enter).
  const sv=state.session;
  if(sv&&sv.day===todayStr()&&sv.queue&&sv.queue.length&&sv.idx<sv.queue.length){
    session={queue:sv.queue.slice(),idx:sv.idx,plan:sv.plan,studied:sv.studied||0,correct:sv.correct||0,
      doneSet:new Set(sv.done||[]),missSet:new Set(sv.miss||[]),newSet:new Set(sv.neww||[]),
      revealed:false,startTs:Date.now()};
    go("study"); $("#studyDone").classList.add("hidden"); renderCard(); toast("이어서 학습합니다 ▶");
    return;
  }
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
  go("study"); $("#studyDone").classList.add("hidden"); renderCard();
  // Make the session size self-explanatory (reviews + new, not a doubled bug).
  const revCount=queue.length-newSet.size;
  toast(`오늘 ${queue.length}개 — 복습 ${revCount} · 신규 ${newSet.size}`, 2600);
}
function renderCard(){
  const s=session; if(s.idx>=s.queue.length) return finishStudy();
  const id=s.queue[s.idx], w=WMAP.get(id), c=getCard(id), isN=c.status==="new";
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
  $("#doneMore").classList.toggle("hidden", dueCards().length===0 && newCardIds(1).length===0);
  if(getDay().goal_met) toast("🔥 오늘 목표 달성! 스트릭 +1"); session=null; state.session=null; saveLocal(); }

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
  if(type==="e2k"){ prompt="이 단어의 뜻은?"; qword=w.word; correct=w.kor; choices=sample(WORDS.filter(x=>x.id!==id&&x.kor),3).map(x=>x.kor); }
  else if(type==="k2e"){ prompt="다음 뜻의 단어는?"; qword=w.kor; correct=w.word; choices=sample(WORDS.filter(x=>x.id!==id),3).map(x=>x.word); }
  else { prompt=`"${w.word}" 와(과) 비슷한 말은?`; qword=w.word; correct=w.synonyms[Math.floor(Math.random()*w.synonyms.length)];
    choices=sample(WORDS.filter(x=>x.id!==id&&x.synonyms&&x.synonyms.length),3).map(x=>x.synonyms[0]); }
  const opts=shuffle([correct,...choices]);
  $("#quizArea").innerHTML=`<div class="card"><div class="q-prompt">${esc(prompt)}</div><div class="q-word" style="${wordFont(qword,26)}">${esc(qword)}</div>
    <div class="choices" id="choices">${opts.map(o=>`<button class="choice">${esc(o)}</button>`).join("")}</div></div>`;
  q.answered=false;
  $$("#choices .choice").forEach(btn=>btn.onclick=()=>{ if(q.answered)return; q.answered=true; const ok=btn.textContent===correct;
    $$("#choices .choice").forEach(b=>{ b.disabled=true; if(b.textContent===correct) b.classList.add("correct"); else if(b===btn) b.classList.add("wrong"); });
    if(ok) q.score+=10; bumpDay({studied:1,correct:ok?1:0}); recordSecAcc("WK",ok);
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
  synq={pool, count:0, correct:0, answered:false};
  $("#synqSetup").classList.add("hidden"); $("#synqPlay").classList.remove("hidden"); nextSynQ();
}
function nextSynQ(){
  const s=synq; if(!s) return;
  const id=s.pool[Math.random()*s.pool.length|0], w=WMAP.get(id);
  const correct=w.synonyms[Math.random()*w.synonyms.length|0];
  const used=new Set([w.word.toLowerCase(),(correct||"").toLowerCase()]);
  const distract=[]; let guard=0;
  while(distract.length<3 && guard++<60){
    const oid=s.pool[Math.random()*s.pool.length|0]; if(oid===id) continue;
    const ow=WMAP.get(oid); const cand=ow.synonyms[Math.random()*ow.synonyms.length|0];
    if(!cand||used.has(cand.toLowerCase())) continue; used.add(cand.toLowerCase()); distract.push(cand);
  }
  if(distract.length<3) return nextSynQ();
  const opts=shuffle([{t:correct,ok:1},...distract.map(t=>({t,ok:0}))]);
  s.answered=false;
  $("#synqScore").textContent = s.count?`${s.correct} / ${s.count} · ${Math.round(s.correct/s.count*100)}%`:"0 / 0";
  $("#synqArea").innerHTML=`<div class="card">
    <div class="q-prompt">가장 비슷한 뜻은?</div>
    <div class="word-row"><div class="q-word" style="${wordFont(w.word,26)}">${esc(w.word)}</div>${spkBtn(w.word)}</div>
    <div class="choices" id="synqChoices">${opts.map(o=>`<button class="choice" data-ok="${o.ok}">${esc(o.t)}</button>`).join("")}</div>
    <div class="ana-explain hidden" id="synqEx"></div></div>`;
  wireSpeakers($("#synqArea"));
  $$("#synqChoices .choice").forEach(btn=>btn.onclick=()=>{
    if(s.answered) return; s.answered=true;
    const ok=btn.dataset.ok==="1";
    $$("#synqChoices .choice").forEach(b=>{ b.disabled=true; if(b.dataset.ok==="1") b.classList.add("correct"); else if(b===btn) b.classList.add("wrong"); });
    s.count++; if(ok) s.correct++;
    bumpDay({studied:1,correct:ok?1:0}); recordSecAcc("WK",ok);
    if(!ok) state.wrong.wk[id]=1;  // 틀린 단어는 오답노트로
    { const o=state.weak.wkTier[tierOf(w)]||(state.weak.wkTier[tierOf(w)]={c:0,w:0}); if(ok)o.c++; else o.w++; }
    $("#synqScore").textContent=`${s.correct} / ${s.count} · ${Math.round(s.correct/s.count*100)}%`;
    $("#synqEx").innerHTML=`<b>${ok?"✅ 정답":"❌ 오답"}</b> · <b>${esc(w.word)}</b> = ${esc(w.kor||"")}${(w.synonyms&&w.synonyms.length)?`<br><span class="muted">동의어: ${esc(w.synonyms.slice(0,5).join(", "))}</span>`:""}`;
    $("#synqEx").classList.remove("hidden"); saveLocal();
    setTimeout(()=>{ if(synq) nextSynQ(); }, ok?650:1600);
  });
}

/* ============================================================
   WORD LIST
   ============================================================ */
let wordFilter="all", wordSearch="";
function renderWords(){
  let list=WORDS.filter(w=>{ const c=getCard(w.id);
    if(wordFilter==="starred"&&!c.starred) return false;
    if(wordFilter==="afoqt"&&!w.afoqtCommon) return false;
    if(wordFilter==="high"&&tierOf(w)==="std") return false;
    if(wordFilter==="gre"&&w.source!=="gre-magoosh") return false;
    if(["new","learning","review","mastered"].includes(wordFilter)&&c.status!==wordFilter) return false;
    if(wordSearch){ const q=wordSearch.toLowerCase();
      if(!(w.word.toLowerCase().includes(q)||(w.kor||"").includes(wordSearch)||(w.def||"").toLowerCase().includes(q))) return false; }
    return true; });
  $("#wordCount").textContent=`${list.length}개`;
  const cap=list.slice(0,400);
  $("#wordList").innerHTML=cap.map(w=>{ const c=getCard(w.id);
    const lbl={new:"미학습",learning:"학습중",review:"복습",mastered:"마스터"}[c.status];
    return `<div class="witem" data-id="${w.id}"><div style="min-width:0">
      <div class="w">${esc(w.word)}${c.starred?' <span style="color:var(--gold)">★</span>':''}${w.source==="gre-magoosh"?'<span class="src">GRE</span>':''}${tierOf(w)==="high"?' ⭐':''}</div>
      <div class="k">${esc(w.kor||w.def||"")}</div></div><span class="tag ${c.status}">${lbl}</span></div>`; }).join("")
    +(list.length>400?`<div class="center muted" style="padding:12px">검색으로 좁혀보세요 (${list.length-400}개 더)</div>`:"");
  $$("#wordList .witem").forEach(el=>el.onclick=()=>showWord(+el.dataset.id));
}
function showWord(id){ const w=WMAP.get(id),c=getCard(id);
  const syn=(w.synonyms||[]).map(x=>`<span>${esc(x)}</span>`).join("");
  const ana=(w.analogyRelations||[]).map(esc).join("<br>");
  openSheet(`<div class="row" style="justify-content:space-between;align-items:flex-start">
      <div class="word-row" style="justify-content:flex-start"><h3 style="font-size:26px">${esc(w.word)}</h3>${spkBtn(w.word)}</div><button class="btn sm ghost" id="wstar">${c.starred?'★':'☆'}</button></div>
    <div style="color:var(--brand2);font-size:12px;text-transform:uppercase">${esc(w.pos||"")}${w.source==="gre-magoosh"?" · GRE Magoosh":""}${tierOf(w)==="high"?" · ⭐빈출":""}</div>
    ${w.afoqtCommon?`<div class="hintbox" style="margin-top:8px;font-size:11px">⭐ AFOQT 빈출 단어 — Quizlet·Barron's·커뮤니티 AFOQT 단어 목록에 등재된 단어입니다.</div>`:""}
    <div style="font-size:20px;font-weight:700;margin-top:10px">${esc(w.kor||"")}</div>
    <div class="muted" style="margin-top:6px;line-height:1.5">${esc(w.def||"")}</div>
    ${w.example?`<div style="font-style:italic;border-left:3px solid var(--brand);padding-left:10px;margin-top:12px;color:#cbd5e1">"${esc(w.example)}" ${spkBtn(w.example)}</div>`:""}
    ${syn?`<h2 class="section">동의어</h2><div class="syn" style="display:flex;flex-wrap:wrap;gap:6px">${syn}</div>`:""}
    ${ana?`<h2 class="section">유추 관계</h2><div style="font-family:ui-monospace,monospace;font-size:12px;color:var(--muted);line-height:1.7">${ana}</div>`:""}
    <button class="btn ghost" id="wclose" style="margin-top:20px">닫기</button>`);
  $("#wstar").onclick=()=>{ toggleStar(id); showWord(id); renderWords(); }; $("#wclose").onclick=closeSheet;
  wireSpeakers($("#genericSheetBody"));
}

/* ============================================================
   ROOTS (어원 학습)
   ============================================================ */
let rootFilter="all", rootSearch="";
function renderRoots(){
  const tn={prefix:"접두사",root:"어근",suffix:"접미사"};
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
      ${x.q_ko?`<div class="muted" style="font-size:13px;margin-bottom:6px">${fmtMath(x.q_ko)}</div>`:""}
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
function genBlockFigure(){
  const W=2+(Math.random()*3|0), D=2+(Math.random()*2|0); const set=new Set(), heights={};
  for(let x=0;x<W;x++)for(let y=0;y<D;y++){ const h=Math.random()*4|0; heights[x+","+y]=h;
    for(let z=0;z<h;z++) set.add(x+","+y+","+z); }
  const blocks=[...set].map(s=>s.split(",").map(Number));
  if(blocks.length<4) return genBlockFigure();
  // target = a top-of-column block (its top face is visible/labelable)
  const tops=[]; for(const k in heights){ const h=heights[k]; if(h>0){ const [x,y]=k.split(",").map(Number); tops.push([x,y,h-1]); } }
  const target=tops[Math.random()*tops.length|0];
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
  cubes.forEach(c=>{ svg+=P(c.right,"#3f4c63")+P(c.left,"#566481")+P(c.top,c.isT?"#22d3ee":"#93a4bd");
    if(c.isT) svg+=`<text x="${(c.sx+ox).toFixed(1)}" y="${(c.sy+th/2+oy).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="800" fill="#0f172a">?</text>`; });
  return svg+'</svg>';
}
function startBlockCounting(){
  const N=10, secs=180, qs=[];
  for(let i=0;i<N;i++){ const f=genBlockFigure(); qs.push({fig:f,correct:f.touch,options:bcOptions(f.touch)}); }
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
  for(const p of shuffle(READING)){ if(out.length>=n) break;
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
    if(it.anaId!=null){ const v={...getVA(it.anaId)}; v.seen=(v.seen||0)+1; if(ok){v.correct=(v.correct||0)+1;} else {v.wrong=(v.wrong||0)+1; state.wrong.va[it.anaId]=1;} setVA(it.anaId,v); }
    if(it.wordId!=null&&!ok) state.wrong.wk[it.wordId]=1;
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
// Recognizable swept-wing jet seen from behind/above (nose points up/away).
// Bank = rotate the whole jet; pitch = a clear ↑/↓ climb/dive marker.
function planeSVG(bank,pitch){
  const cx=60,cy=48;
  const jet=`
    <path d="M ${cx} ${cy-22} L ${cx+5} ${cy+6} L ${cx+42} ${cy+18} L ${cx+42} ${cy+12} L ${cx+5} ${cy-2}
             L ${cx+4} ${cy+18} L ${cx+11} ${cy+24} L ${cx} ${cy+20} L ${cx-11} ${cy+24} L ${cx-4} ${cy+18}
             L ${cx-5} ${cy-2} L ${cx-42} ${cy+12} L ${cx-42} ${cy+18} L ${cx-5} ${cy+6} Z"
          fill="#cbd5e1" stroke="#64748b" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${cx}" cy="${cy-16}" r="3.5" fill="#7c8aa3"/>`;
  const arrow= pitch>0?`<g><text x="${cx}" y="20" text-anchor="middle" font-size="15" font-weight="800" fill="#22d3ee">▲ 상승</text></g>`
             : pitch<0?`<g><text x="${cx}" y="20" text-anchor="middle" font-size="15" font-weight="800" fill="#f59e0b">▼ 하강</text></g>`
             : `<text x="${cx}" y="20" text-anchor="middle" font-size="13" font-weight="700" fill="#94a3b8">— 수평</text>`;
  return `<svg viewBox="0 0 120 96" xmlns="http://www.w3.org/2000/svg">${arrow}<g transform="rotate(${bank} ${cx} ${cy})">${jet}</g></svg>`;
}
function genIC(){
  const bank=IC_BANKS[Math.random()*IC_BANKS.length|0];
  const pitch=IC_PITCH[Math.random()*IC_PITCH.length|0];
  const correct={bank,pitch};
  const opts=[correct]; let guard=0;
  while(opts.length<4&&guard++<60){ const b=IC_BANKS[Math.random()*IC_BANKS.length|0], p=IC_PITCH[Math.random()*IC_PITCH.length|0];
    if(!opts.some(o=>o.bank===b&&o.pitch===p)) opts.push({bank:b,pitch:p}); }
  return {bank,pitch,options:shuffle(opts)};
}
function startInstrument(){
  const N=12, secs=180, qs=[]; for(let i=0;i<N;i++) qs.push(genIC());
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
  const q=s.qs[s.idx]; s.answered=false; const correctKey=q.options.findIndex(o=>o.bank===q.bank&&o.pitch===q.pitch);
  $("#icCount").textContent=`${s.idx+1} / ${s.N}`; $("#icBar").style.width=(s.idx/s.N*100)+"%";
  $("#icArea").innerHTML=`<div class="ic-instruments">
      <div class="ic-dial">${attitudeSVG(q.bank,q.pitch)}<div class="lbl">자세계 (Attitude Indicator)</div></div></div>
    <div class="ic-prompt">자세계를 보고 <b>같은 자세</b>의 비행기를 고르세요
      <br><span class="muted" style="font-size:12px">기울어진 정도·방향(뱅크)과 수평선 위치(상승/하강)를 확인하세요</span></div>
    <div class="ic-opts">${q.options.map((o,i)=>`<button data-i="${i}">${planeSVG(o.bank,o.pitch)}<div class="ol">${o.bank<0?"왼쪽 "+(-o.bank)+"° 뱅크":o.bank>0?"오른쪽 "+o.bank+"° 뱅크":"수평"} · ${o.pitch>0?"상승":o.pitch<0?"하강":"수평비행"}</div></button>`).join("")}</div>`;
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
      ${a.explain?`<div class="rx">${esc(a.explain)}</div>`:""}</div>`;
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
  $("#vaCount").textContent=`${s.idx+1} / ${s.items.length}`; $("#vaScore").textContent=`${s.score}점`; $("#vaBar").style.width=(s.idx/s.items.length*100)+"%";
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
    $("#vaExplain").innerHTML=`<b>${ok?"✅ 정답":"❌ 오답"}</b> · 관계: <b>${esc(a.relation||"")}</b><br>${esc(a.explain||"")}`;
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
function rcStats(){ const v=Object.values(state.rc); const done=v.filter(x=>x.done).length;
  let sc=0,to=0; v.forEach(x=>{sc+=x.score||0;to+=x.total||0;}); return {done,acc:to?Math.round(sc/to*100):null}; }
function renderReading(){ const s=rcStats(); $("#rcDone").textContent=s.done; $("#rcAccTop").textContent=s.acc==null?"–":s.acc+"%";
  if(!READING.length){ $("#rcList").innerHTML=`<div class="card center muted">독해 지문 준비 중 (데이터 없음)</div>`; return; }
  $("#rcList").innerHTML=READING.map(p=>{ const r=getRC(p.id);
    return `<div class="witem" data-id="${p.id}"><div style="min-width:0">
      <div class="w">${esc(p.title||("Passage "+p.id))}</div>
      <div class="k">${esc(p.topic||"")} · ${p.questions.length}문제${r.done?` · ${r.score}/${r.total}`:""}</div></div>
      ${r.done?'<span class="done-check">✓</span>':'<span class="go" style="color:var(--muted)">›</span>'}</div>`; }).join("");
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
// RC: 공식 시간 24분/25문항 ÷ 25 = 57.6 ≈ 58초/문항.
const SECRATE={ WK:12, VA:19, RC:58, AR:70, MK:53, AV:24, TR:11, IC:12, BC:9, PS:30, SJ:131 };
// Build a preset from a list of [sectionCode, count] specs; derives timer + label.
function composeMock(name,specs,tag){
  const secs=specs.reduce((s,[c,n])=>s+SECRATE[c]*n,0);
  const qn=specs.reduce((s,[,n])=>s+n,0);
  return {name,secs,specs,build:()=>specs.flatMap(([c,n])=>SECBUILD[c](n)),
    label:`${qn}문항 · ${fmtTime(secs)}${tag?" · "+tag:""}`};
}
const EXAM_PRESETS={
  // ── 전과목 통합 (full AFOQT simulation — excludes Physical Science & Situational Judgment) ──
  afoqt: composeMock("AFOQT 전체 모의고사",
    [["WK",12],["VA",12],["RC",10],["AR",10],["MK",10],["AV",8],["TR",10],["IC",8],["BC",8]], "전 과목"),
  // ── 섹터별 (composite-focused mocks) ──
  secVerbal: composeMock("Verbal 섹터",       [["WK",12],["VA",12],["RC",12]],            "Verbal"),
  secQuant:  composeMock("Quantitative 섹터", [["AR",12],["MK",12]],                       "Quant"),
  secPilot:  composeMock("Pilot 섹터",        [["AV",8],["TR",10],["IC",8],["BC",8]], "Pilot"),
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
  return shuffle(AVIATION).slice(0,n).map(q=>({
    section:"AV", prompt:q.q, promptKo:q.q_ko||"", stem:null, sub:AVCAT[q.topic]||q.topic||"",
    avId:q.id, avTopic:q.topic,
    options:q.options.slice(), answer:q.answer, explain:q.explain||""}));
}
// Generic bilingual MCQ builder (Arithmetic Reasoning / Math Knowledge / Physical Science).
function buildMCQ(pool,section,n){
  return shuffle(pool).slice(0,n).map(q=>({
    section, prompt:q.q, promptKo:q.q_ko||"", stem:null, sub:q.topic||"", qid:q.id,
    options:q.options.slice(), answer:q.answer, explain:q.explain||""}));
}
// Situational Judgment: scenario shown as a passage block, single best-answer.
function buildSJ(n){
  return shuffle(SITJUD).slice(0,n).map(q=>({
    section:"SJ", prompt:q.q||"가장 효과적인 행동은?", promptKo:"", stem:null, sub:"리더십·판단",
    passageId:"sj"+q.id, passageTitle:"상황 (Situation)",
    passageText:(q.scenario||"")+(q.scenario_ko?("\n\n"+q.scenario_ko):""),
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
    const correctKey=q.options.findIndex(o=>o.bank===q.bank&&o.pitch===q.pitch);
    const lbl=o=>`${o.bank<0?"왼쪽 "+(-o.bank)+"°":o.bank>0?"오른쪽 "+o.bank+"°":"수평"} · ${o.pitch>0?"상승":o.pitch<0?"하강":"수평비행"}`;
    const optionsHTML=q.options.map(o=>`${planeSVG(o.bank,o.pitch)}<div class="ol">${lbl(o)}</div>`);
    items.push({section:"IC", prompt:"자세계(Attitude Indicator)를 보고 같은 자세의 비행기를 고르세요", sub:"계기 해석",
      figureHTML:`<div class="ic-instruments"><div class="ic-dial">${attitudeSVG(q.bank,q.pitch)}<div class="lbl">자세계 (Attitude)</div></div></div>`,
      options:q.options.map(lbl), optionsHTML, answer:correctKey,
      explain:`정답: ${lbl(q.options[correctKey])}. 뱅크=기울어진 방향, 피치=수평선 위치(상승/하강).`});
  }
  return items;
}
// Predicted composite percentile from accumulated per-subtest accuracy.
function compositeEst(codes){
  let c=0,w=0; codes.forEach(s=>{ const o=state.secAcc[s]; if(o){ c+=o.c||0; w+=o.w||0; } });
  const n=c+w; if(n<5) return {pct:null,acc:null,n};
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
function buildWK(n){
  const pool=WORDS.filter(w=>w.synonyms&&w.synonyms.length);
  // weight toward high/mid tiers for exam realism, but keep some std
  const ranked=[...pool].sort((a,b)=>(TIERRANK[tierOf(a)]-TIERRANK[tierOf(b)]));
  const top=shuffle(ranked.slice(0,Math.min(ranked.length, n*12)));
  const items=[];
  for(const w of top){
    if(items.length>=n) break;
    const correct=w.synonyms[(Math.random()*w.synonyms.length)|0];
    if(!correct) continue;
    const wSyn=new Set(w.synonyms.map(s=>s.toLowerCase())); wSyn.add(w.word.toLowerCase());
    const dist=[];
    for(const o of shuffle(pool)){
      if(dist.length>=3) break;
      if(o.id===w.id) continue;
      const c=o.synonyms[(Math.random()*o.synonyms.length)|0]; if(!c) continue;
      const cl=c.toLowerCase();
      if(wSyn.has(cl)||cl===correct.toLowerCase()||dist.some(d=>d.toLowerCase()===cl)) continue;
      dist.push(c);
    }
    if(dist.length<3) continue;
    const options=shuffle([correct,...dist]);
    items.push({section:"WK",prompt:"다음 단어와 의미가 가장 가까운 것은?",
      stem:w.word, sub:(w.pos||"")+(tierOf(w)==="high"?" · ⭐빈출":""),
      options, answer:options.indexOf(correct), wordId:w.id, tier:tierOf(w),
      explain:`${w.word} = ${w.kor||""}  ·  동의어: ${w.synonyms.slice(0,4).join(", ")}`});
  }
  return items;
}
function vaItem(a){
  const opts=shuffle(a.options.map(o=>({t:`${o.pair[0]} : ${o.pair[1]}`,c:!!o.correct})));
  return {section:"VA",prompt:"다음과 같은 관계를 가진 짝은?",
    stem:`${a.stem[0]} : ${a.stem[1]}`, sub:"ANALOGY", anaId:a.id, relation:a.relation||"기타",
    options:opts.map(o=>o.t), answer:opts.findIndex(o=>o.c),
    explain:`관계: ${a.relation||""} — ${a.explain||""}`};
}
function buildVA(n){ return shuffle(ANALOGIES).slice(0,n).map(vaItem); }
function rcItem(p,qi){
  const q=p.questions[qi];
  return {section:"RC",prompt:q.q, stem:null, sub:p.topic||"",
    passageId:p.id, qIdx:qi, qType:q.type||"detail", passageTitle:p.title, passageText:p.passage,
    options:q.options.slice(), answer:q.answer, explain:q.explain||""};
}
function buildRC(n){
  const items=[];
  for(const p of shuffle(READING)){
    for(let qi=0;qi<p.questions.length;qi++){
      if(items.length>=n) break;
      items.push(rcItem(p,qi));
    }
    if(items.length>=n) break;
  }
  return items;
}
/* ----- 오답 노트(retest) builders ----- */
function buildWrongWK(){
  const ids=Object.keys(state.wrong.wk).map(Number);
  const out=[];
  for(const wid of shuffle(ids)){ const w=WMAP.get(wid); if(!w||!(w.synonyms&&w.synonyms.length)) continue;
    const one=buildWKfor(w); if(one) out.push(one); }
  return out;
}
function buildWKfor(w){
  const pool=WORDS.filter(x=>x.synonyms&&x.synonyms.length);
  const correct=w.synonyms[(Math.random()*w.synonyms.length)|0]; if(!correct) return null;
  const wSyn=new Set(w.synonyms.map(s=>s.toLowerCase())); wSyn.add(w.word.toLowerCase());
  const dist=[];
  for(const o of shuffle(pool)){ if(dist.length>=3) break; if(o.id===w.id) continue;
    const c=o.synonyms[(Math.random()*o.synonyms.length)|0]; if(!c) continue; const cl=c.toLowerCase();
    if(wSyn.has(cl)||cl===correct.toLowerCase()||dist.some(d=>d.toLowerCase()===cl)) continue; dist.push(c); }
  if(dist.length<3) return null;
  const options=shuffle([correct,...dist]);
  return {section:"WK",prompt:"다음 단어와 의미가 가장 가까운 것은?",stem:w.word,
    sub:(w.pos||"")+(tierOf(w)==="high"?" · ⭐빈출":""),options,answer:options.indexOf(correct),
    wordId:w.id,tier:tierOf(w),explain:`${w.word} = ${w.kor||""}  ·  동의어: ${w.synonyms.slice(0,4).join(", ")}`};
}
function buildWrongVA(){
  const ids=Object.keys(state.wrong.va).map(Number);
  return shuffle(ids).map(id=>ANALOGIES.find(a=>a.id===id)).filter(Boolean).map(vaItem);
}
function buildWrongRC(){
  const out=[];
  for(const key of shuffle(Object.keys(state.wrong.rc))){
    const [pid,qi]=key.split(":").map(Number); const p=READING.find(x=>x.id===pid);
    if(p&&p.questions[qi]) out.push(rcItem(p,qi));
  }
  return out;
}
// Retest the exact wrong MCQ questions (산수/수학/과학), rebuilt from their pool by id.
function buildWrongMCQ(pool,section,bucket){
  const ids=new Set(Object.keys(state.wrong[bucket]||{}).map(Number));
  return shuffle(pool.filter(q=>ids.has(q.id))).map(q=>({
    section, prompt:q.q, promptKo:q.q_ko||"", stem:null, sub:q.topic||"", qid:q.id,
    options:q.options.slice(), answer:q.answer, explain:q.explain||""}));
}
function buildWrongAV(){
  const ids=new Set(Object.keys(state.wrong.av||{}).map(Number));
  return shuffle(AVIATION.filter(q=>ids.has(q.id))).map(q=>({
    section:"AV", prompt:q.q, promptKo:q.q_ko||"", stem:null, sub:AVCAT[q.topic]||q.topic||"",
    avId:q.id, avTopic:q.topic, options:q.options.slice(), answer:q.answer, explain:q.explain||""}));
}
const WRONG_BUILD={ wk:buildWrongWK, va:buildWrongVA, rc:buildWrongRC,
  ar:()=>buildWrongMCQ(ARITH,"AR","ar"), mk:()=>buildWrongMCQ(MATHK,"MK","mk"),
  ps:()=>buildWrongMCQ(PHYSCI,"PS","ps"), av:buildWrongAV };
const WRONG_META={ wk:["📇","단어"],va:["🔗","유추"],rc:["📖","독해"],
  ar:["➗","산수"],mk:["📐","수학"],ps:["🔬","과학"],av:["🛩️","항공"] };
const WRONG_ORDER=["wk","va","rc","ar","mk","ps","av"];
function renderExamSetup(){
  exam=null; stopExamTimer();
  $("#examSetup").classList.remove("hidden"); $("#examRun").classList.add("hidden"); $("#examResult").classList.add("hidden");
  $$("#examSetup .exam-preset").forEach(btn=>{
    const k=btn.dataset.exam, r=state.exams[k], el=btn.querySelector(".last"); if(!el) return;
    el.textContent=r?`최고 ${r.best}/${r.bestTotal} · 최근 ${r.last}/${r.lastTotal}`
      :(EXAM_PRESETS[k]?EXAM_PRESETS[k].label:""); });
  // wrong-note (오답 노트)
  const wc=wrongCounts();
  const rows=WRONG_ORDER.filter(k=>wc[k]>0).map(k=>
    `<button class="exam-preset" data-retest="${k}" style="padding:13px"><div class="ic" style="font-size:20px">${WRONG_META[k][0]}</div>
      <div class="meta"><b>${WRONG_META[k][1]} 오답</b><div class="muted">${wc[k]}문제 다시 풀기</div></div><div class="go">›</div></button>`).join("");
  $("#retestList").innerHTML=rows||`<div class="card center muted" style="padding:14px">아직 틀린 문제가 없어요. 모의고사를 보면 여기 쌓입니다.</div>`;
  $$("#retestList [data-retest]").forEach(b=>b.onclick=()=>startRetest(b.dataset.retest));
  const tot=WRONG_ORDER.reduce((s,k)=>s+wc[k],0); $("#retestAll").classList.toggle("hidden",tot===0);
  $("#retestAll").textContent=`🔁 전체 오답 재시험 (${tot}문제)`;
}
function startExam(key,opts){
  const p=EXAM_PRESETS[key]; if(!p) return;
  const items=p.build();
  if(items.length<3){ toast("문제를 만들 데이터가 부족해요."); return; }
  const secs=opts&&opts.practice ? Math.round(p.secs*2.2) : p.secs;
  exam={key,name:p.name,items,idx:0,answers:new Array(items.length).fill(null),
        secsLeft:secs,startSecs:secs,total:items.length,submitted:false,timerId:null};
  // Activate the exam view directly — do NOT call go("exam") here, since that
  // re-runs renderExamSetup() and would wipe the exam we just built.
  $$(".view").forEach(v=>v.classList.remove("active")); $("#view-exam").classList.add("active");
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go==="home"));
  window.scrollTo(0,0);
  $("#examSetup").classList.add("hidden"); $("#examResult").classList.add("hidden"); $("#examRun").classList.remove("hidden");
  startExamTimer(); renderExamQ();
}
function fmtTime(s){ s=Math.max(0,s|0); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }
function startExamTimer(){ stopExamTimer(); updateTimerUI();
  exam.timerId=setInterval(()=>{ if(!exam) return stopExamTimer(); exam.secsLeft--; updateTimerUI();
    if(exam.secsLeft<=0) submitExam(true); },1000); }
function stopExamTimer(){ if(exam&&exam.timerId){ clearInterval(exam.timerId); exam.timerId=null; } }
function updateTimerUI(){ const t=$("#examTimer"); if(!t||!exam) return; t.textContent=fmtTime(exam.secsLeft); t.classList.toggle("warn",exam.secsLeft<=30); }
function renderExamQ(){
  const e=exam; if(!e) return;
  e.idx=clamp(e.idx,0,e.total-1); const it=e.items[e.idx];
  $("#examCount").textContent=`${e.idx+1} / ${e.total}`;
  $("#examBar").style.width=(e.idx/e.total*100)+"%";
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
  const ko=it.promptKo?`<div class="exam-ko">${esc(it.promptKo)}</div>`:"";
  // Visual subtests (Table Reading / Instrument / Block Counting) carry a pre-built
  // figure (table or SVG) and, for Instrument, picture options rendered via optionsHTML.
  const figure=it.figureHTML?`<div class="exam-figure">${it.figureHTML}</div>`:"";
  const choicesHTML=it.options.map((o,i)=>{
    const inner=it.optionsHTML?it.optionsHTML[i]:fmtMath(o);
    return `<button class="choice ${it.optionsHTML?"choice-fig":""} ${e.answers[e.idx]===i?"sel":""}" data-i="${i}">${inner}</button>`;
  }).join("");
  $("#examArea").innerHTML=`${passage}<div class="card">
    <span class="exam-sec">${secChip}</span>
    <div class="exam-prompt">${fmtMath(it.prompt)}</div>${ko}${stem}${sub}${figure}
    <div class="choices ${it.optionsHTML?"choices-fig":""}" id="examChoices">${choicesHTML}</div></div>`;
  wireSpeakers($("#examArea"));
  $$("#examChoices .choice").forEach(btn=>btn.onclick=()=>{
    e.answers[e.idx]=+btn.dataset.i;
    $$("#examChoices .choice").forEach(b=>b.classList.toggle("sel",b===btn));
    refreshExamGrid();
    if(e.idx<e.total-1){ setTimeout(()=>{ if(exam&&!exam.submitted&&exam.idx<exam.total-1){ exam.idx++; renderExamQ(); } },160); }
  });
  $("#examPrev").disabled=e.idx===0;
  $("#examNext").disabled=e.idx>=e.total-1;
  renderExamGrid();
}
function renderExamGrid(){
  const e=exam;
  $("#examGrid").innerHTML=e.items.map((it,i)=>
    `<button data-i="${i}" class="${e.answers[i]!=null?"answered":""} ${i===e.idx?"cur":""}">${i+1}</button>`).join("");
  $$("#examGrid button").forEach(b=>b.onclick=()=>{ e.idx=+b.dataset.i; renderExamQ(); });
}
function refreshExamGrid(){ const e=exam; const b=$(`#examGrid button[data-i="${e.idx}"]`); if(b) b.classList.add("answered"); }
// Record a graded item into the wrong-note and weakness stats.
// Per-subtest accuracy tally for predicted composite scores.
function recordSecAcc(sec,ok){ if(!sec) return; const o=state.secAcc[sec]||(state.secAcc[sec]={c:0,w:0}); if(ok)o.c++; else o.w++; }
function recordResult(it,ok){
  const W=state.wrong, K=state.weak;
  recordSecAcc(it.section, ok);
  const bump=(obj,cat)=>{ const o=obj[cat]||(obj[cat]={c:0,w:0}); if(ok)o.c++; else o.w++; };
  // per-topic weakness for the topic-based MCQ subtests
  const topic=(it.section==="AV"?it.avTopic:it.sub)||"";
  if(["AR","MK","PS","AV"].includes(it.section)&&topic) bump(K.topic||(K.topic={}), it.section+":"+topic);
  if(it.section==="WK"&&it.wordId!=null){
    if(ok) delete W.wk[it.wordId]; else W.wk[it.wordId]=1;
    bump(K.wkTier, it.tier||"std");
    state.wkSeen[it.wordId]=1;                 // coverage for readiness
  } else if(it.section==="VA"&&it.anaId!=null){
    if(ok) delete W.va[it.anaId]; else W.va[it.anaId]=1;
    bump(K.vaRel, it.relation||"기타");
    const v={...getVA(it.anaId)}; v.seen=(v.seen||0)+1; if(ok)v.correct=(v.correct||0)+1; else v.wrong=(v.wrong||0)+1; setVA(it.anaId,v);
  } else if(it.section==="RC"&&it.passageId!=null){
    const key=it.passageId+":"+(it.qIdx||0);
    if(ok) delete W.rc[key]; else W.rc[key]=1;
    bump(K.rcType, it.qType||"detail");
    const r={...getRC(it.passageId)}; r.seen=true; setRC(it.passageId,r);  // coverage
  } else if(it.section==="AV"&&it.avId!=null){
    state.avp[it.avId]=1;                      // coverage for readiness
    if(ok) delete W.av[it.avId]; else W.av[it.avId]=1;
  } else if(["AR","MK","PS"].includes(it.section)&&it.qid!=null){
    const b=W[it.section.toLowerCase()]; if(b){ if(ok) delete b[it.qid]; else b[it.qid]=1; }
  }
}
function wrongCounts(){ const c={}; for(const k of WRONG_ORDER) c[k]=Object.keys(state.wrong[k]||{}).length; return c; }
function startRetest(kind){
  let items = WRONG_BUILD[kind] ? WRONG_BUILD[kind]() : WRONG_ORDER.flatMap(k=>WRONG_BUILD[k]());
  if(items.length<1){ toast("오답이 없어요 👍"); return; }
  items=items.slice(0,60);
  const secs=Math.max(120, items.length*25);
  exam={key:null,name:"오답 재시험",items,idx:0,answers:new Array(items.length).fill(null),
        secsLeft:secs,startSecs:secs,total:items.length,submitted:false,timerId:null};
  $$(".view").forEach(v=>v.classList.remove("active")); $("#view-exam").classList.add("active");
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go==="home"));
  window.scrollTo(0,0);
  $("#examSetup").classList.add("hidden"); $("#examResult").classList.add("hidden"); $("#examRun").classList.remove("hidden");
  startExamTimer(); renderExamQ();
}
function submitExam(auto){
  const e=exam; if(!e||e.submitted) return;
  if(!auto){ const un=e.answers.filter(a=>a==null).length;
    if(un && !confirm(`아직 ${un}문제를 안 풀었어요. 그래도 제출할까요?`)) return; }
  e.submitted=true; stopExamTimer();
  let got=0; const bySec={};
  e.items.forEach((it,i)=>{ const ok=e.answers[i]===it.answer; if(ok)got++;
    (bySec[it.section]=bySec[it.section]||{got:0,total:0}).total++; if(ok)bySec[it.section].got++;
    recordResult(it,ok); });
  const total=e.total, pct=Math.round(got/total*100);
  const used=(e.startSecs||(EXAM_PRESETS[e.key]?EXAM_PRESETS[e.key].secs:0))-Math.max(0,e.secsLeft);
  bumpDay({studied:total,correct:got});
  if(e.key){ const prev=state.exams[e.key]||{best:0,bestTotal:total};
    state.exams[e.key]={best:Math.max(prev.best||0,got),bestTotal:total,last:got,lastTotal:total,date:todayStr()}; }
  state.examHist.push({key:e.key||"retest",date:todayStr(),got,total,acc:got/total,pctile:estPercentile(got/total),ts:Date.now()});
  if(state.examHist.length>200) state.examHist=state.examHist.slice(-200);
  saveNow();
  // render result
  $("#examRun").classList.add("hidden"); $("#examResult").classList.remove("hidden");
  $("#examEmoji").textContent=pct>=85?"🏆":pct>=70?"🎯":pct>=50?"💪":"📚";
  $("#examScore").textContent=`${got} / ${total} 정답 (${pct}%)`;
  const secName={WK:"단어",VA:"유추",RC:"독해",AV:"항공",AR:"산수",MK:"수학",PS:"과학",SJ:"상황",TR:"표읽기",IC:"계기",BC:"블록"};
  $("#examBreakDown").innerHTML=Object.keys(bySec).map(k=>
    `<div class="s"><b>${bySec[k].got}/${bySec[k].total}</b><span>${secName[k]||k}</span></div>`).join("");
  // estimated AFOQT-style percentile (unofficial)
  const acc=got/total, pctile=estPercentile(acc), multi=Object.keys(bySec).length>1;
  const secLines=Object.keys(bySec).map(k=>`${secName[k]||k} ${Math.round(bySec[k].got/bySec[k].total*100)}%`).join(" · ");
  const proj=$("#examProjection"); proj.classList.remove("hidden");
  if(e.key==="afoqt"){
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
  $("#examTimeUsed").textContent=`소요 시간 ${fmtTime(used)}${e.secsLeft<=0?" · ⏰ 시간 종료":""}`;
  $("#examReview").innerHTML=""; $("#examReviewBtn").classList.remove("hidden");
  window.scrollTo(0,0);
}
function renderExamReview(){
  const e=exam; if(!e) return;
  const secName={WK:"단어",VA:"유추",RC:"독해",AV:"항공",AR:"산수",MK:"수학",PS:"과학",SJ:"상황",TR:"표읽기",IC:"계기",BC:"블록"};
  $("#examReview").innerHTML=e.items.map((it,i)=>{
    const pick=e.answers[i], ok=pick===it.answer;
    // Visual subtests: show the table/dial/block figure so the review makes sense.
    const figure=it.figureHTML?`<div class="exam-figure exam-figure-rev">${it.figureHTML}</div>`:"";
    const opts=it.options.map((o,oi)=>{
      let cls=""; if(oi===it.answer) cls="ok"; else if(oi===pick) cls="no";
      const mark=oi===it.answer?"✓ ":(oi===pick?"✗ ":"");
      return `<div class="ro ${cls}">${mark}${fmtMath(o)}</div>`;
    }).join("");
    return `<div class="review-q">
      <div class="rh">${i+1}. ${secName[it.section]||it.section} ${ok?"✅":pick==null?"⬜ 미응답":"❌"}</div>
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
    bb.innerHTML=BADGES.map(b=>{ const on=!!state.badges[b.id];
      return `<div class="badge ${on?"on":"off"}" title="${esc(b.name)}"><div class="bi">${b.icon}</div><div class="bn">${esc(b.name)}</div></div>`;
    }).join(""); }
  const left=daysLeft(),rem=cnt.remaining,pace=newPerDay(),fin=pace?Math.ceil(rem/pace):0,ok=fin<=left;
  const todayDueN=dueCards().length, todayNewN=Math.min(pace,rem), todayN=todayDueN+todayNewN;
  $("#projection").innerHTML=rem===0?`<div class="center"><div class="big-emoji">🏁</div><b>모든 단어 학습 완료!</b><div class="muted">이제 복습으로 마스터하세요.</div></div>`
    :`📅 <b>오늘은 ${todayN}개</b> (복습 ${todayDueN} + 신규 ${todayNewN})<br>
      남은 단어 <b>${rem}</b>개 · 시험까지 <b>${left}</b>일<br>이 페이스(신규 ${pace}/일)면 <b>약 ${fin}일</b>에 1회독.<br>
      <span style="color:${ok?'var(--ok)':'var(--warn)'}">${ok?'✅ 일정 내 완주 가능!':'⚠️ 하루 신규 단어를 늘리면 더 안전해요.'}</span>
      <div class="muted" style="font-size:12px;margin-top:6px">⏳ 쉬는 날엔 남은 단어는 그대로, 남은 일수만 줄어서 다음날 개수가 자동으로 늘어나요.</div>`;
  renderComposite(); renderExamTrend(); renderWeakness();
}
const SEC_KO={WK:"단어",VA:"유추",RC:"독해",AR:"산수",MK:"수학",PS:"과학",AV:"항공",TR:"표읽기",BC:"블록",IC:"계기",SJ:"상황"};
// Approximate AFOQT composite -> subtest membership (unofficial).
const COMPOSITES=[
  {name:"🎓 Academic Aptitude",codes:["WK","VA","RC","AR","MK"]},
  {name:"🗣 Verbal",codes:["WK","VA","RC"]},
  {name:"🔢 Quantitative",codes:["AR","MK"]},
  // Pilot composite = Aviation + Block Counting + Table Reading + Instrument.
  {name:"✈️ Pilot",codes:["AV","BC","TR","IC"]},
  {name:"🛰 CSO",codes:["WK","AR","MK","TR","BC","AV"]},
];
// Sector mocks → which composite to show on their result screen.
const SECTOR_COMPOSITE={
  secVerbal:{name:"🗣 Verbal",codes:["WK","VA","RC"]},
  secQuant:{name:"🔢 Quantitative",codes:["AR","MK"]},
  secPilot:{name:"✈️ Pilot",codes:["AV","BC","TR","IC"]},
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
function repBar(label,o){ const p=accPct(o); const n=(o?.c||0)+(o?.w||0); const col=p<50?"var(--bad)":p<75?"var(--warn)":"var(--ok)";
  return `<div class="rep-row"><div class="lab"><span>${esc(label)}</span><span class="muted">${p}% · ${o.w||0}틀림/${n}</span></div>
    <div class="progressbar mini"><i style="width:${p}%;background:${col}"></i></div></div>`; }
function openReport(){ go("report"); }
function renderReport(){
  const box=$("#repBody"); if(!box) return;
  const subs=SUBTESTS.map(s=>({...s,o:state.secAcc[s.code]})).filter(s=>((s.o?.c||0)+(s.o?.w||0))>=3)
    .map(s=>({...s,acc:accPct(s.o),n:(s.o.c||0)+(s.o.w||0)})).sort((a,b)=>a.acc-b.acc);
  if(!subs.length){ box.innerHTML=`<div class="card rep-empty">아직 분석할 데이터가 부족해요.<br>퀴즈·시험·커리큘럼을 조금 풀면 약점을 분석해 드릴게요.<br><button class="btn primary" id="repGoDaily" style="max-width:240px;margin:14px auto 0">📅 오늘의 통합 학습 시작</button></div>`;
    $("#repGoDaily")&&($("#repGoDaily").onclick=()=>startExam("daily")); return; }
  const worst=subs[0];
  const wkBlock=()=>{ const arr=Object.entries(state.weak.wkTier).map(([k,o])=>({k,o,n:o.c+o.w})).filter(x=>x.n>=2);
    return arr.length?`<div class="rep-sub">📇 단어 — 등급별</div>${arr.map(x=>repBar(WK_TIER_KO[x.k]||x.k,x.o)).join("")}`:""; };
  const vaBlock=()=>{ const arr=Object.entries(state.weak.vaRel).map(([k,o])=>({k,o,a:accPct(o),n:o.c+o.w})).filter(x=>x.n>=2).sort((a,b)=>a.a-b.a).slice(0,5);
    return arr.length?`<div class="rep-sub">🔗 유추 — 약한 관계 유형</div>${arr.map(x=>repBar(x.k,x.o)).join("")}`:""; };
  const rcBlock=()=>{ const arr=Object.entries(state.weak.rcType).map(([k,o])=>({k,o,a:accPct(o),n:o.c+o.w})).filter(x=>x.n>=2).sort((a,b)=>a.a-b.a);
    return arr.length?`<div class="rep-sub">📖 독해 — 약한 문제 유형</div>${arr.map(x=>repBar(RC_TYPE_KO[x.k]||x.k,x.o)).join("")}`:""; };
  const topicBySec={}; for(const [k,o] of Object.entries(state.weak.topic||{})){ const i=k.indexOf(":"); const sec=k.slice(0,i),t=k.slice(i+1); (topicBySec[sec]=topicBySec[sec]||[]).push({t,o,a:accPct(o),n:o.c+o.w}); }
  const secKoName={AR:"산수",MK:"수학",PS:"과학",AV:"항공"};
  const topicBlocks=Object.keys(topicBySec).map(sec=>{ const arr=topicBySec[sec].filter(x=>x.n>=2).sort((a,b)=>a.a-b.a).slice(0,4);
    return arr.length?`<div class="rep-sub">${secKoName[sec]||sec} — 약한 주제</div>${arr.map(x=>repBar(x.t,x.o)).join("")}`:""; }).join("");
  const wc=wrongCounts(), wtot=WRONG_ORDER.reduce((s,k)=>s+wc[k],0);
  const recs=subs.slice(0,3).map(s=>`<div class="rep-rec"><div class="meta"><b>${esc(s.name)}</b><div class="muted">정답률 ${s.acc}% · ${s.n}문항</div></div><button class="btn primary" data-rec="${s.code}">연습</button></div>`).join("")
    +(wtot?`<div class="rep-rec"><div class="meta"><b>📕 오답 노트</b><div class="muted">틀린 ${wtot}문제 다시 풀기</div></div><button class="btn primary" id="repRetest">재시험</button></div>`:"");
  box.innerHTML=`<div class="rep-hero"><div style="font-size:12px;color:var(--brand2);font-weight:700">가장 약한 영역</div>
      <div class="big">${esc(worst.name)} · ${worst.acc}%</div>
      <div class="muted" style="font-size:12px;margin-top:4px">${worst.n}문항 기준 · 아래 "연습"으로 바로 보강하세요</div></div>
    <div class="rep-sub">📊 과목별 정답률 (약한 순)</div>
    ${subs.map(s=>repBar(s.name,s.o)).join("")}
    ${wkBlock()}${vaBlock()}${rcBlock()}${topicBlocks}
    <h2 class="section">💡 추천 — 바로 연습</h2>
    ${recs}
    <div class="guide-src" style="margin-top:6px">※ 푼 문제(퀴즈·시험·커리큘럼)를 종합한 분석이에요. 많이 풀수록 정확해집니다.</div>`;
  $$('#repBody [data-rec]').forEach(b=>b.onclick=()=>{ const s=SUBTESTS.find(x=>x.code===b.dataset.rec); if(s) s.go(); });
  $("#repRetest")&&($("#repRetest").onclick=()=>startRetest("all"));
}
function renderComposite(){
  const box=$("#compositeEst"); if(!box) return;
  const accOf=s=>{ const o=state.secAcc[s]; const n=o?(o.c+o.w):0; return n?Math.round(o.c/n*100):null; };
  const secLine=codes=>codes.filter(s=>accOf(s)!=null).map(s=>`${SEC_KO[s]} ${accOf(s)}%`).join(" · ")||"–";
  const block=(title,e,codes)=>`<div style="margin-bottom:13px">
      <div class="row" style="justify-content:space-between;align-items:baseline">
        <b style="font-size:15px">${title}</b>
        <span style="font-size:26px;font-weight:800;color:var(--brand2)">${e.pct==null?"–":e.pct+"<small style='font-size:13px'>th</small>"}</span></div>
      <div class="muted" style="font-size:11.5px;line-height:1.55;margin-top:2px">${e.acc==null
        ?"데이터 부족 — 관련 과목을 더 풀면 예측돼요."
        :`정답률 ${Math.round(e.acc*100)}% · ${secLine(codes)} · 표본 ${e.n}`}</div></div>`;
  box.innerHTML=COMPOSITES.map(c=>block(c.name,compositeEst(c.codes),c.codes)).join("")
    +`<div class="guide-src" style="margin-top:2px">※ 비공식 추정치입니다. 합성점수 구성·환산은 실제 AFOQT와 다를 수 있어요. 각 과목(항공·표읽기·블록·계기 포함)을 고루 풀수록 정확해집니다.</div>`;
}
function renderExamTrend(){
  const h=state.examHist||[]; const box=$("#examTrend");
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
  $$("#nav button").forEach(b=>b.onclick=()=>go(b.dataset.go));
  // home
  $("#btnStart").onclick=startStudy; $("#btnExam").onclick=()=>go("exam");
  $("#btnDaily").onclick=()=>startExam("daily");
  $("#btnCurr").onclick=()=>openCurriculum();
  $("#vkCurr").onclick=()=>openCurriculum("wk"); $("#vaCurr").onclick=()=>openCurriculum("va"); $("#rcCurr").onclick=()=>openCurriculum("rc");
  $("#currBack").onclick=()=>go("home");
  $("#repBack").onclick=()=>go("stats"); $("#btnReport")&&($("#btnReport").onclick=openReport); $("#repOpen")&&($("#repOpen").onclick=openReport);
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
  $("#vkStart").onclick=startStudy; $("#vkQuiz").onclick=()=>go("quiz"); $("#vkWords").onclick=()=>go("words");
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
  $("#examQuit").onclick=()=>{ if(!exam||exam.submitted||confirm("시험을 그만두고 나갈까요? 기록은 저장되지 않아요.")){ stopExamTimer(); exam=null; go("home"); } };
  $("#examPrev").onclick=()=>{ if(exam&&exam.idx>0){ exam.idx--; renderExamQ(); } };
  $("#examNext").onclick=()=>{ if(exam&&exam.idx<exam.total-1){ exam.idx++; renderExamQ(); } };
  $("#examSubmit").onclick=()=>submitExam(false);
  $("#examReviewBtn").onclick=()=>{ renderExamReview(); $("#examReviewBtn").classList.add("hidden"); $("#examReview").scrollIntoView({behavior:"smooth"}); };
  $("#examRetry").onclick=()=>{ if(exam&&exam.key) startExam(exam.key); else go("exam"); };
  $("#retestAll").onclick=()=>startRetest("all");
  $("#examDoneHome").onclick=()=>go("home");
  $("#optHighFirst").onchange=e=>{ state.settings.high_first=e.target.checked; saveLocal(); queuePush("settings",{}); renderHome(); };
  $("#optHighOnly").onchange=e=>{ state.settings.high_only=e.target.checked; saveLocal(); queuePush("settings",{}); renderHome(); };
  // study
  $("#studyBack").onclick=()=>{ session=null; go("vocab"); }; $("#doneHome").onclick=()=>go("home"); $("#doneMore").onclick=startStudy;
  $("#doneQuiz").onclick=()=>{ if(poolFor("today").length<4){ toast("오늘 학습한 단어가 4개 이상이면 퀴즈를 볼 수 있어요"); return; } session=null; startQuizScope("today"); };
  // quiz
  $("#quizBack").onclick=()=>go("vocab"); $("#quizGo").onclick=startQuiz;
  $("#quizRetry").onclick=()=>{ $("#quizDone").classList.add("hidden"); $("#quizStart").classList.remove("hidden"); $("#quizArea").innerHTML=""; };
  $("#quizHomeBtn").onclick=()=>go("home");
  $("#vkConfirm").onclick=()=>go("confirm");
  $("#confirmBack").onclick=()=>go("vocab"); $("#confirmGo").onclick=startConfirm;
  $("#confirmRetryBtn").onclick=()=>{ $("#confirmDone").classList.add("hidden"); $("#confirmStart").classList.remove("hidden"); $("#confirmArea").innerHTML=""; renderConfirmHub(); };
  $("#confirmHomeBtn").onclick=()=>go("home");
  // words
  $("#wordsBack").onclick=()=>go("vocab"); $("#searchBox").oninput=e=>{ wordSearch=e.target.value.trim(); renderWords(); };
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
    if(document.visibilityState==="hidden"){ saveNow(); flushPush(); return; }
    // Wake Lock is dropped when the tab is hidden — re-acquire it on return if auto-play is running.
    if(ap && ap.playing) apAcquireWake();
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
function registerSW(){
  if(!("serviceWorker" in navigator)) return;
  let reloaded=false;
  // When a new SW takes control, reload to pick up fresh assets — but never
  // mid-session (that would feel like getting kicked out). Defer until the
  // user is back on a hub screen.
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(reloaded) return;
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
    initSync();   // non-blocking: app already usable
    registerSW();
  }catch(e){
    console.error("boot failed:",e);
    $("#boot").innerHTML="<p class='center'>앱 로딩 중 오류가 발생했어요.<br>새로고침 해주세요.</p>"+
      "<button class='btn primary' style='max-width:200px;margin:16px auto' onclick='location.reload()'>새로고침</button>";
  }
}
document.addEventListener("DOMContentLoaded", boot);
})();
