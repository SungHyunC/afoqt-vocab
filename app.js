/* ============================================================
   AFOQT Vocab Master — app.js (v2.1)
   Verbal 전체: Word Knowledge(WK) + Verbal Analogies(VA) + Reading(RC)
   로컬 우선 + Supabase 실시간 동기화, SM-2 SRS, 빈출 tier 페이싱
   ============================================================ */
(() => {
"use strict";

const VERSION = "2.6.1";
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
function toast(msg, ms=1800){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"), ms); }

/* ============================================================
   STATE
   ============================================================ */
let WORDS=[], WMAP=new Map(), ANALOGIES=[], READING=[], ROOTS=[];
let state=null, sb=null, realtimeChan=null;

const DEFAULT_STATE = () => ({
  cards:{},   // WK: id -> {status,reps,lapses,ease,interval,due,starred,updated_at}
  va:{},      // VA: id -> {seen,correct,wrong,streak,status,updated_at}
  rc:{},      // RC: id -> {done,score,total,updated_at}
  daily:{},   // 'YYYY-MM-DD' -> {studied,correct,new_learned,seconds,target,goal_met,updated_at}
  exams:{},   // 'wk'|'va'|'rc'|'full' -> {best,bestTotal,last,lastTotal,date}
  wrong:{wk:{},va:{},rc:{}},  // 오답 노트: wk wordId / va anaId / rc "pid:qi" -> 1
  weak:{vaRel:{},rcType:{},wkTier:{}},  // 약점 분석: category -> {c,w}
  examHist:[], // 점수 추이: {key,date,got,total,acc,pctile,ts}
  settings:{ daily_goal:0, high_first:true, high_only:false,
             start_date:CFG.START_DATE||"2026-06-01", exam_date:CFG.EXAM_DATE||"2026-07-10" },
});

function loadLocal(){
  try{ state=JSON.parse(localStorage.getItem(LS.state))||DEFAULT_STATE(); }catch{ state=DEFAULT_STATE(); }
  const d=DEFAULT_STATE();
  state.cards=state.cards||{}; state.va=state.va||{}; state.rc=state.rc||{}; state.daily=state.daily||{}; state.exams=state.exams||{};
  state.wrong=Object.assign({wk:{},va:{},rc:{}},state.wrong||{});
  state.weak=Object.assign({vaRel:{},rcType:{},wkTier:{}},state.weak||{});
  state.examHist=state.examHist||[];
  state.settings=Object.assign(d.settings, state.settings||{});
}
let saveTimer=null;
function saveLocal(){ clearTimeout(saveTimer); saveTimer=setTimeout(saveNow,150); }
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
function dueCards(){ const t=Date.now(),out=[]; for(const w of WORDS){ const c=state.cards[w.id]; if(c&&c.status!=="new"&&c.due&&new Date(c.due).getTime()<=t) out.push(w.id);} return out; }
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
function computeStreak(){ let s=0; const cur=parseDate(todayStr());
  for(let i=0;;i++){ const d=new Date(cur); d.setDate(d.getDate()-i); const r=state.daily[todayStr(d)];
    if(r&&r.goal_met) s++; else if(i===0) continue; else break; } return s; }

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
    setSyncDot("on"); await pullAll(); subscribeRealtime();
  }catch(e){ console.error(e); sb=null; setSyncDot("err"); }
}
async function pullAll(){
  if(!sb) return; const code=syncCode();
  try{
    const [vs,vp,dl,st]=await Promise.all([
      sb.from("vocab_state").select("*").eq("user_key",code),
      sb.from("verbal_progress").select("*").eq("user_key",code),
      sb.from("daily_log").select("*").eq("user_key",code),
      sb.from("settings").select("*").eq("user_key",code).maybeSingle(),
    ]);
    if(vs.data) vs.data.forEach(mergeCard);
    if(vp.data) vp.data.forEach(mergeVerbal);
    if(dl.data) dl.data.forEach(mergeDaily);
    if(st.data) mergeSettings(st.data);
    saveLocal(); renderAll();
  }catch(e){ console.error("pull fail",e); setSyncDot("err"); }
}
function mergeCard(r){ const cur=state.cards[r.word_id];
  if(!cur||new Date(r.updated_at)>new Date(cur.updated_at||0)) state.cards[r.word_id]={status:r.status,reps:r.reps,lapses:r.lapses,ease:r.ease,interval:r.interval,due:r.due,starred:r.starred,updated_at:r.updated_at}; }
function mergeVerbal(r){ const tgt=r.kind==="va"?state.va:r.kind==="rc"?state.rc:null; if(!tgt) return;
  const cur=tgt[r.item_id]; const d=Object.assign({},r.data,{updated_at:r.updated_at});
  if(!cur||new Date(r.updated_at)>new Date(cur.updated_at||0)) tgt[r.item_id]=d; }
function mergeDaily(r){ const cur=state.daily[r.day];
  if(!cur||new Date(r.updated_at)>new Date(cur.updated_at||0)) state.daily[r.day]={studied:r.studied,correct:r.correct,new_learned:r.new_learned,seconds:r.seconds,target:cur?.target||0,goal_met:r.goal_met,updated_at:r.updated_at}; }
function mergeSettings(r){ if(r.daily_goal!=null) state.settings.daily_goal=r.daily_goal;
  if(r.start_date) state.settings.start_date=r.start_date; if(r.exam_date) state.settings.exam_date=r.exam_date;
  if(r.data){ if(r.data.high_first!=null) state.settings.high_first=r.data.high_first; if(r.data.high_only!=null) state.settings.high_only=r.data.high_only; } }

function subscribeRealtime(){
  if(!sb) return; if(realtimeChan) sb.removeChannel(realtimeChan); const code=syncCode();
  realtimeChan=sb.channel("afoqt-"+code)
    .on("postgres_changes",{event:"*",schema:"public",table:"vocab_state",filter:`user_key=eq.${code}`},p=>{ if(p.new){mergeCard(p.new);saveLocal();softRender();}})
    .on("postgres_changes",{event:"*",schema:"public",table:"verbal_progress",filter:`user_key=eq.${code}`},p=>{ if(p.new){mergeVerbal(p.new);saveLocal();softRender();}})
    .on("postgres_changes",{event:"*",schema:"public",table:"daily_log",filter:`user_key=eq.${code}`},p=>{ if(p.new){mergeDaily(p.new);saveLocal();softRender();}})
    .on("postgres_changes",{event:"*",schema:"public",table:"settings",filter:`user_key=eq.${code}`},p=>{ if(p.new){mergeSettings(p.new);saveLocal();softRender();}})
    .subscribe();
}
const pushQ={vocab_state:new Map(),verbal_progress:new Map(),daily_log:new Map(),settings:null};
let pushTimer=null;
function queuePush(table,row){ if(!sb) return; const code=syncCode();
  if(table==="vocab_state") pushQ.vocab_state.set(row.id,{user_key:code,word_id:row.id,status:row.status,reps:row.reps,lapses:row.lapses,ease:row.ease,interval:row.interval,due:row.due,starred:!!row.starred,updated_at:row.updated_at});
  else if(table==="verbal_progress") pushQ.verbal_progress.set(row.kind+":"+row.item_id,{user_key:code,kind:row.kind,item_id:row.item_id,data:row.data,updated_at:row.data.updated_at||nowISO()});
  else if(table==="daily_log") pushQ.daily_log.set(row.day,{user_key:code,day:row.day,studied:row.studied,correct:row.correct,new_learned:row.new_learned,seconds:row.seconds,goal_met:row.goal_met,updated_at:row.updated_at});
  else if(table==="settings") pushQ.settings={user_key:code,daily_goal:state.settings.daily_goal,start_date:state.settings.start_date,exam_date:state.settings.exam_date,data:{high_first:state.settings.high_first,high_only:state.settings.high_only},updated_at:nowISO()};
  clearTimeout(pushTimer); pushTimer=setTimeout(flushPush,700); }
async function flushPush(){ if(!sb) return;
  try{
    if(pushQ.vocab_state.size){ const r=[...pushQ.vocab_state.values()]; pushQ.vocab_state.clear(); await sb.from("vocab_state").upsert(r,{onConflict:"user_key,word_id"}); }
    if(pushQ.verbal_progress.size){ const r=[...pushQ.verbal_progress.values()]; pushQ.verbal_progress.clear(); await sb.from("verbal_progress").upsert(r,{onConflict:"user_key,kind,item_id"}); }
    if(pushQ.daily_log.size){ const r=[...pushQ.daily_log.values()]; pushQ.daily_log.clear(); await sb.from("daily_log").upsert(r,{onConflict:"user_key,day"}); }
    if(pushQ.settings){ const r=pushQ.settings; pushQ.settings=null; await sb.from("settings").upsert(r,{onConflict:"user_key"}); }
  }catch(e){ console.error("push fail",e); setSyncDot("err"); } }

/* ============================================================
   NAVIGATION
   ============================================================ */
const NAVPARENT={study:"vocab",quiz:"vocab",words:"vocab",roots:"vocab",passage:"reading",exam:"home"};
function go(view){
  $$(".view").forEach(v=>v.classList.remove("active"));
  $("#view-"+view).classList.add("active");
  const navsel=NAVPARENT[view]||view;
  $$("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.go===navsel));
  window.scrollTo(0,0);
  ({home:renderHome,vocab:renderVocab,analogy:renderAnalogyHub,reading:renderReading,stats:renderStats,exam:renderExamSetup,roots:renderRoots}[view]||(()=>{}))();
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
  $("#overallBar").style.width=overall+"%";
  $("#overallLine").textContent=`전체 진도 ${cnt.learned} / ${WORDS.length} (${overall}%)`;
  $("#stStreak").textContent=computeStreak(); $("#stToday").textContent=today.studied; $("#stDue").textContent=dueCards().length;
  $("#recPace").textContent=`신규 ${newPerDay()}/일`;
  // section bars
  $("#wkBar").style.width=overall+"%";
  $("#wkSub").textContent=`어휘 ${cnt.learned}/${WORDS.length}`;
  const vaSeen=Object.values(state.va).filter(v=>v.seen>0).length;
  $("#vaBar").style.width=(ANALOGIES.length?Math.round(vaSeen/ANALOGIES.length*100):0)+"%";
  $("#vaSub").textContent=ANALOGIES.length?`유추 ${vaSeen}/${ANALOGIES.length}`:"준비 중";
  const rcDone=Object.values(state.rc).filter(v=>v.done).length;
  $("#rcBar").style.width=(READING.length?Math.round(rcDone/READING.length*100):0)+"%";
  $("#rcSub").textContent=READING.length?`독해 ${rcDone}/${READING.length}`:"준비 중";
}

/* ============================================================
   VOCAB HUB
   ============================================================ */
function renderVocab(){
  const cnt=countByStatus();
  $("#vkLearned").textContent=cnt.learned; $("#vkMastered").textContent=cnt.mastered;
  $("#vkHigh").textContent=cnt.highLearned; $("#vkRemain").textContent=cnt.remaining;
  $("#optHighFirst").checked=flag("high_first"); $("#optHighOnly").checked=flag("high_only");
}

/* ============================================================
   STUDY (flashcards)
   ============================================================ */
let session=null;
function startStudy(){
  const due=dueCards(), news=newCardIds(newPerDay());
  let queue=[...due,...news];
  if(!queue.length) queue=newCardIds(newPerDay());
  if(!queue.length){ toast("오늘 학습할 카드가 없어요! 🎉"); go("home"); return; }
  session={queue,idx:0,plan:queue.length,studied:0,correct:0,revealed:false,startTs:Date.now()};
  const d=getDay(); if(!d.target){ d.target=queue.length; saveLocal(); }
  go("study"); $("#studyDone").classList.add("hidden"); renderCard();
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
      <div class="word">${esc(w.word)}</div>
      <div class="pos">${esc(w.pos||"")}${w.source==="gre-magoosh"?" · GRE":""}${tierOf(w)==="high"?" · ⭐빈출":""}</div>
      <div class="reveal hidden" id="revealBox">
        <div class="kor">${esc(w.kor||"")}</div>
        <div class="def">${esc(w.def||"")}</div>
        ${w.example?`<div class="ex">"${esc(w.example)}"</div>`:""}
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
  $("#flashCard").onclick=e=>{ if(e.target.id==="starBtn")return; reveal(); };
  $("#starBtn").onclick=e=>{ e.stopPropagation(); toggleStar(id); const on=getCard(id).starred; $("#starBtn").classList.toggle("on",on); $("#starBtn").textContent=on?"★":"☆"; };
  $$("#gradeRow button").forEach(b=>b.onclick=()=>answer(id,b.dataset.q));
}
function reveal(){ if(session.revealed) return; session.revealed=true; $("#revealBox").classList.remove("hidden"); $("#tapHint").classList.add("hidden"); $("#gradeRow").classList.remove("hidden"); }
function answer(id,q){ const s=session, wasNew=getCard(id).status==="new"; gradeCard(id,q);
  s.studied++; if(q!=="again") s.correct++;
  bumpDay({studied:1,correct:q!=="again"?1:0,new_learned:wasNew?1:0,seconds:Math.round((Date.now()-(s.cardTs||s.startTs))/1000)}); s.cardTs=Date.now();
  if(q==="again"){ const w=s.queue.splice(s.idx,1)[0]; s.queue.splice(Math.min(s.idx+3,s.queue.length),0,w); } else s.idx++;
  renderHome(); renderCard(); }
function finishStudy(){ const s=session, secs=Math.round((Date.now()-s.startTs)/1000);
  $("#studyArea").innerHTML=""; $("#studyBar").style.width="100%"; $("#studyCount").textContent=`${s.plan} / ${s.plan}`;
  const acc=s.studied?Math.round(s.correct/s.studied*100):0;
  $("#doneSub").textContent=`${s.studied}개 학습 · 정답 ${acc}% · ${Math.round(secs/60)}분`;
  $("#studyDone").classList.remove("hidden");
  $("#doneMore").classList.toggle("hidden", dueCards().length===0 && newCardIds(1).length===0);
  if(getDay().goal_met) toast("🔥 오늘 목표 달성! 스트릭 +1"); session=null; }

/* ============================================================
   QUIZ (WK)
   ============================================================ */
let quiz=null;
function poolFor(scope){
  if(scope==="all") return WORDS.map(w=>w.id);
  if(scope==="high") return WORDS.filter(w=>tierOf(w)!=="std").map(w=>w.id);
  if(scope==="starred") return WORDS.filter(w=>getCard(w.id).starred).map(w=>w.id);
  if(scope==="due") return dueCards();
  return WORDS.filter(w=>{const c=state.cards[w.id];return c&&c.status!=="new";}).map(w=>w.id);
}
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
  $("#quizArea").innerHTML=`<div class="card"><div class="q-prompt">${esc(prompt)}</div><div class="q-word">${esc(qword)}</div>
    <div class="choices" id="choices">${opts.map(o=>`<button class="choice">${esc(o)}</button>`).join("")}</div></div>`;
  q.answered=false;
  $$("#choices .choice").forEach(btn=>btn.onclick=()=>{ if(q.answered)return; q.answered=true; const ok=btn.textContent===correct;
    $$("#choices .choice").forEach(b=>{ b.disabled=true; if(b.textContent===correct) b.classList.add("correct"); else if(b===btn) b.classList.add("wrong"); });
    if(ok) q.score+=10; bumpDay({studied:1,correct:ok?1:0}); renderHome();
    setTimeout(()=>{ q.idx++; renderQuiz(); }, ok?550:1100); });
}
function finishQuiz(){ const q=quiz,total=q.items.length,got=q.score/10,pct=Math.round(got/total*100);
  $("#quizArea").innerHTML=""; $("#quizBar").style.width="100%";
  $("#quizEmoji").textContent=pct>=90?"🏆":pct>=70?"🎯":pct>=50?"💪":"📚";
  $("#quizResult").textContent=`${got} / ${total} 정답 (${pct}%)`;
  $("#quizResultSub").textContent=pct>=90?"완벽해요!":pct>=70?"좋아요, 계속!":"복습하면 금방 올라요.";
  $("#quizDone").classList.remove("hidden"); quiz=null; }

/* ============================================================
   WORD LIST
   ============================================================ */
let wordFilter="all", wordSearch="";
function renderWords(){
  let list=WORDS.filter(w=>{ const c=getCard(w.id);
    if(wordFilter==="starred"&&!c.starred) return false;
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
      <h3 style="font-size:26px">${esc(w.word)}</h3><button class="btn sm ghost" id="wstar">${c.starred?'★':'☆'}</button></div>
    <div style="color:var(--brand2);font-size:12px;text-transform:uppercase">${esc(w.pos||"")}${w.source==="gre-magoosh"?" · GRE Magoosh":""}${tierOf(w)==="high"?" · ⭐빈출":""}</div>
    <div style="font-size:20px;font-weight:700;margin-top:10px">${esc(w.kor||"")}</div>
    <div class="muted" style="margin-top:6px;line-height:1.5">${esc(w.def||"")}</div>
    ${w.example?`<div style="font-style:italic;border-left:3px solid var(--brand);padding-left:10px;margin-top:12px;color:#cbd5e1">"${esc(w.example)}"</div>`:""}
    ${syn?`<h2 class="section">동의어</h2><div class="syn" style="display:flex;flex-wrap:wrap;gap:6px">${syn}</div>`:""}
    ${ana?`<h2 class="section">유추 관계</h2><div style="font-family:ui-monospace,monospace;font-size:12px;color:var(--muted);line-height:1.7">${ana}</div>`:""}
    <button class="btn ghost" id="wclose" style="margin-top:20px">닫기</button>`);
  $("#wstar").onclick=()=>{ toggleStar(id); showWord(id); renderWords(); }; $("#wclose").onclick=closeSheet;
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
   VERBAL ANALOGIES
   ============================================================ */
function vaStats(){ const v=Object.values(state.va); const seen=v.filter(x=>x.seen>0).length;
  const mastered=v.filter(x=>x.status==="mastered").length; let c=0,w=0; v.forEach(x=>{c+=x.correct;w+=x.wrong;});
  return {seen,mastered,acc:(c+w)?Math.round(c/(c+w)*100):null}; }
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
    if(ok) s.score+=10; bumpDay({studied:1,correct:ok?1:0});
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
    if(pick===q.answer) got++;
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
const EXAM_PRESETS={
  wk:  {name:"Word Knowledge",      secs:300,  build:()=>buildWK(25),                            label:"25문항 · 5:00"},
  va:  {name:"Verbal Analogies",    secs:480,  build:()=>buildVA(25),                            label:"25문항 · 8:00"},
  rc:  {name:"Reading Comprehension",secs:1500, build:()=>buildRC(25),                            label:"25문항 · 25:00"},
  // Full Verbal mock mirrors real AFOQT proportions (WK25 + VA25 + RC25).
  full:{name:"Verbal 전체 모의고사",  secs:3060, build:()=>[...buildWK(25),...buildVA(25),...buildRC(25)], label:"75문항 · 51:00 (실전)"},
};
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
function renderExamSetup(){
  exam=null; stopExamTimer();
  $("#examSetup").classList.remove("hidden"); $("#examRun").classList.add("hidden"); $("#examResult").classList.add("hidden");
  const map={wk:"lastWk",va:"lastVa",rc:"lastRc",full:"lastFull"};
  for(const k in map){ const r=state.exams[k]; const el=$("#"+map[k]);
    el.textContent=r?`최고 ${r.best}/${r.bestTotal} · 최근 ${r.last}/${r.lastTotal}`:EXAM_PRESETS[k].label; }
  // wrong-note (오답 노트)
  const wc=wrongCounts(), secName={wk:"📇 단어",va:"🔗 유추",rc:"📖 독해"};
  const rows=["wk","va","rc"].filter(k=>wc[k]>0).map(k=>
    `<button class="exam-preset" data-retest="${k}" style="padding:13px"><div class="ic" style="font-size:20px">${secName[k].split(" ")[0]}</div>
      <div class="meta"><b>${secName[k].split(" ")[1]} 오답</b><div class="muted">${wc[k]}문제 다시 풀기</div></div><div class="go">›</div></button>`).join("");
  $("#retestList").innerHTML=rows||`<div class="card center muted" style="padding:14px">아직 틀린 문제가 없어요. 모의고사를 보면 여기 쌓입니다.</div>`;
  $$("#retestList [data-retest]").forEach(b=>b.onclick=()=>startRetest(b.dataset.retest));
  const tot=wc.wk+wc.va+wc.rc; $("#retestAll").classList.toggle("hidden",tot===0);
  $("#retestAll").textContent=`🔁 전체 오답 재시험 (${tot}문제)`;
}
function startExam(key){
  const p=EXAM_PRESETS[key]; if(!p) return;
  const items=p.build();
  if(items.length<3){ toast("문제를 만들 데이터가 부족해요."); return; }
  exam={key,name:p.name,items,idx:0,answers:new Array(items.length).fill(null),
        secsLeft:p.secs,total:items.length,submitted:false,timerId:null};
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
  const samePrev=e.idx>0&&e.items[e.idx-1]?.passageId===it.passageId;
  const passage=it.section==="RC"?`<details class="exam-passage" ${samePrev?"":"open"}>
      <summary>📖 ${esc(it.passageTitle||"지문")} (탭하여 펼치기)</summary>
      <div class="passage">${esc(it.passageText)}</div></details>`:"";
  const stem=it.stem?`<div class="exam-stem">${esc(it.stem)}</div>`:"";
  const sub=it.sub?`<div class="exam-sub">${esc(it.sub)}</div>`:"";
  $("#examArea").innerHTML=`${passage}<div class="card">
    <span class="exam-sec">${it.section}</span>
    <div class="exam-prompt">${esc(it.prompt)}</div>${stem}${sub}
    <div class="choices" id="examChoices">${it.options.map((o,i)=>
      `<button class="choice ${e.answers[e.idx]===i?"sel":""}" data-i="${i}">${esc(o)}</button>`).join("")}</div></div>`;
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
function recordResult(it,ok){
  const W=state.wrong, K=state.weak;
  const bump=(obj,cat)=>{ const o=obj[cat]||(obj[cat]={c:0,w:0}); if(ok)o.c++; else o.w++; };
  if(it.section==="WK"&&it.wordId!=null){
    if(ok) delete W.wk[it.wordId]; else W.wk[it.wordId]=1;
    bump(K.wkTier, it.tier||"std");
  } else if(it.section==="VA"&&it.anaId!=null){
    if(ok) delete W.va[it.anaId]; else W.va[it.anaId]=1;
    bump(K.vaRel, it.relation||"기타");
  } else if(it.section==="RC"&&it.passageId!=null){
    const key=it.passageId+":"+(it.qIdx||0);
    if(ok) delete W.rc[key]; else W.rc[key]=1;
    bump(K.rcType, it.qType||"detail");
  }
}
function wrongCounts(){ return {wk:Object.keys(state.wrong.wk).length,va:Object.keys(state.wrong.va).length,rc:Object.keys(state.wrong.rc).length}; }
function startRetest(kind){
  let items=[];
  if(kind==="wk") items=buildWrongWK();
  else if(kind==="va") items=buildWrongVA();
  else if(kind==="rc") items=buildWrongRC();
  else items=[...buildWrongWK(),...buildWrongVA(),...buildWrongRC()];
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
  const used=(EXAM_PRESETS[e.key]?EXAM_PRESETS[e.key].secs:e.startSecs||0)-Math.max(0,e.secsLeft);
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
  const secName={WK:"단어",VA:"유추",RC:"독해"};
  $("#examBreakDown").innerHTML=Object.keys(bySec).map(k=>
    `<div class="s"><b>${bySec[k].got}/${bySec[k].total}</b><span>${secName[k]||k}</span></div>`).join("");
  // estimated AFOQT-style percentile (unofficial)
  const acc=got/total, pctile=estPercentile(acc), multi=Object.keys(bySec).length>1;
  const secLines=Object.keys(bySec).map(k=>`${secName[k]||k} ${Math.round(bySec[k].got/bySec[k].total*100)}%`).join(" · ");
  const proj=$("#examProjection"); proj.classList.remove("hidden");
  proj.innerHTML=`<div class="lbl">${e.key==="full"?"예상 AFOQT Verbal 백분위":"예상 백분위"}</div>
    <div class="big">${pctile}<span style="font-size:16px">th</span></div>
    <div class="seclist">정답률 ${Math.round(acc*100)}%${multi?` · ${secLines}`:""}</div>
    <div class="note">※ 비공식 추정치예요. 실제 AFOQT 환산과 다르며, ${e.key==="full"?"전체 모의고사를 여러 번 볼수록":"풀 모의고사로 볼수록"} 정확해집니다.</div>`;
  $("#examTimeUsed").textContent=`소요 시간 ${fmtTime(used)}${e.secsLeft<=0?" · ⏰ 시간 종료":""}`;
  $("#examReview").innerHTML=""; $("#examReviewBtn").classList.remove("hidden");
  window.scrollTo(0,0);
}
function renderExamReview(){
  const e=exam; if(!e) return;
  const secName={WK:"단어",VA:"유추",RC:"독해"};
  $("#examReview").innerHTML=e.items.map((it,i)=>{
    const pick=e.answers[i], ok=pick===it.answer;
    const opts=it.options.map((o,oi)=>{
      let cls=""; if(oi===it.answer) cls="ok"; else if(oi===pick) cls="no";
      const mark=oi===it.answer?"✓ ":(oi===pick?"✗ ":"");
      return `<div class="ro ${cls}">${mark}${esc(o)}</div>`;
    }).join("");
    return `<div class="review-q">
      <div class="rh">${i+1}. ${secName[it.section]||it.section} ${ok?"✅":pick==null?"⬜ 미응답":"❌"}</div>
      <div style="font-weight:600;margin-bottom:6px">${esc(it.stem||it.prompt)}</div>
      ${opts}
      ${it.explain?`<div class="rx">${esc(it.explain)}</div>`:""}</div>`;
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
  $("#calHead").innerHTML=["일","월","화","수","목","금","토"].map(d=>`<div class="dow">${d}</div>`).join("");
  let cells=""; for(let i=0;i<start.getDay();i++) cells+=`<div class="d" style="background:none"></div>`;
  for(let d=new Date(start); d<=exam; d.setDate(d.getDate()+1)){ const key=todayStr(d),rec=state.daily[key]; let cls="d";
    if(rec&&rec.goal_met) cls+=" met"; else if(rec&&rec.studied>0) cls+=" partial"; if(key===todayStr()) cls+=" today";
    cells+=`<div class="${cls}">${d.getDate()}</div>`; }
  $("#calGrid").innerHTML=cells;
  let met=0; for(const k in state.daily) if(state.daily[k].goal_met) met++;
  $("#calStreak").textContent=computeStreak(); $("#calMet").textContent=met;
  const left=daysLeft(),rem=cnt.remaining,pace=newPerDay(),fin=pace?Math.ceil(rem/pace):0,ok=fin<=left;
  $("#projection").innerHTML=rem===0?`<div class="center"><div class="big-emoji">🏁</div><b>모든 단어 학습 완료!</b><div class="muted">이제 복습으로 마스터하세요.</div></div>`
    :`남은 단어 <b>${rem}</b>개 · 시험까지 <b>${left}</b>일<br>현재 페이스(신규 ${pace}/일)면 <b>약 ${fin}일</b>에 1회독.<br>
      <span style="color:${ok?'var(--ok)':'var(--warn)'}">${ok?'✅ 일정 내 완주 가능!':'⚠️ 하루 신규 단어를 늘리면 더 안전해요.'}</span>`;
  renderExamTrend(); renderWeakness();
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
  $("#syncCodeView").textContent=syncCode(); $("#verLine").textContent=`v${VERSION} · 단어 ${WORDS.length} · 유추 ${ANALOGIES.length} · 독해 ${READING.length}`;
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
  $("#secWK").onclick=()=>go("vocab"); $("#secVA").onclick=()=>go("analogy"); $("#secRC").onclick=()=>go("reading");
  // vocab hub
  $("#vkStart").onclick=startStudy; $("#vkQuiz").onclick=()=>go("quiz"); $("#vkWords").onclick=()=>go("words");
  $("#vkExam").onclick=()=>startExam("wk"); $("#vkRoots").onclick=()=>go("roots");
  $("#rootsBack").onclick=()=>go("vocab");
  $("#rootsSearch").oninput=e=>{ rootSearch=e.target.value.trim(); renderRoots(); };
  $$("#rootsFilters .chip").forEach(c=>c.onclick=()=>{ $$("#rootsFilters .chip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); rootFilter=c.dataset.rf; renderRoots(); });
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
  // quiz
  $("#quizBack").onclick=()=>go("vocab"); $("#quizGo").onclick=startQuiz;
  $("#quizRetry").onclick=()=>{ $("#quizDone").classList.add("hidden"); $("#quizStart").classList.remove("hidden"); $("#quizArea").innerHTML=""; };
  $("#quizHomeBtn").onclick=()=>go("home");
  // words
  $("#wordsBack").onclick=()=>go("vocab"); $("#searchBox").oninput=e=>{ wordSearch=e.target.value.trim(); renderWords(); };
  $$("#wordFilters .chip").forEach(c=>c.onclick=()=>{ $$("#wordFilters .chip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); wordFilter=c.dataset.f; renderWords(); });
  // analogy
  $("#vaStart").onclick=()=>startAnalogy(false); $("#vaReview").onclick=()=>startAnalogy(true);
  $("#vaExam").onclick=()=>startExam("va");
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
  $("#resetAll").onclick=()=>{ if(confirm("이 기기의 학습 기록을 모두 지웁니다. 계속할까요?")){ state=DEFAULT_STATE(); saveLocal(); toast("초기화됨"); $("#settingsSheet").classList.remove("open"); go("home"); } };
  $("#forceUpdate").onclick=forceUpdate;
  // Flush pending saves before the app is backgrounded/closed (mobile-safe).
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="hidden") saveNow(); });
  window.addEventListener("pagehide", saveNow);
  window.addEventListener("beforeunload", saveNow);
}

/* ============================================================
   BOOT
   ============================================================ */
// Register the service worker and auto-apply updates so users never get stuck
// on a stale cached version (no need for ?v= cache-busting URLs).
function sessionActive(){ return !!(exam&&!exam.submitted)||!!session||!!vaSession||!!quiz; }
// Nuke all caches + service workers and hard-reload — guarantees the latest
// version, fixing any "I still see the old app" situation. Learning data lives
// in localStorage, which is NOT touched here.
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
