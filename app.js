/* ============================================================
   AFOQT Vocab Master — app.js
   - 로컬 우선(localStorage) + Supabase 실시간 동기화
   - SM-2 기반 간격반복(SRS), 6/1~7/10 일정 페이싱, 스트릭/통계
   ============================================================ */
(() => {
"use strict";

const VERSION = "2.0.0";
const CFG = window.AFOQT_CONFIG || {};
const LS = {
  state: "afoqt_state_v2",
  code:  "afoqt_sync_code",
  url:   "afoqt_sb_url",
  key:   "afoqt_sb_key",
};

/* ---------- helpers ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const nowISO = () => new Date().toISOString();
const todayStr = (d=new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return z.toISOString().slice(0,10);
};
const parseDate = s => { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
const dayDiff = (a,b) => Math.round((parseDate(b)-parseDate(a))/86400000);
const shuffle = a => { a=[...a]; for(let i=a.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]];} return a; };
const sample = (arr,n) => shuffle(arr).slice(0,n);

function toast(msg, ms=1800){
  const t=$("#toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"), ms);
}

/* ============================================================
   STATE
   ============================================================ */
let WORDS = [];
let WMAP = new Map();          // id -> word
let state = null;
let sb = null;                 // supabase client
let realtimeChan = null;

const DEFAULT_STATE = () => ({
  cards: {},   // id -> {status,reps,lapses,ease,interval,due,starred,updated_at}
  daily: {},   // 'YYYY-MM-DD' -> {studied,correct,new_learned,seconds,target,goal_met,updated_at}
  settings: {
    daily_goal: 0,            // 신규 단어/일 (0 = 자동 페이싱)
    start_date: CFG.START_DATE || "2026-06-01",
    exam_date:  CFG.EXAM_DATE  || "2026-07-10",
  },
});

function loadLocal(){
  try{ state = JSON.parse(localStorage.getItem(LS.state)) || DEFAULT_STATE(); }
  catch{ state = DEFAULT_STATE(); }
  // backfill missing keys
  const d = DEFAULT_STATE();
  state.cards = state.cards||{}; state.daily = state.daily||{};
  state.settings = Object.assign(d.settings, state.settings||{});
}
let saveTimer=null;
function saveLocal(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>localStorage.setItem(LS.state, JSON.stringify(state)), 150);
}

/* ---------- card accessors ---------- */
function getCard(id){
  return state.cards[id] || { status:"new", reps:0, lapses:0, ease:2.5, interval:0, due:null, starred:false };
}
function setCard(id, c){
  c.updated_at = nowISO();
  state.cards[id] = c;
  saveLocal(); queuePush("vocab_state", {id, ...c});
}

/* ---------- daily log ---------- */
function getDay(day=todayStr()){
  if(!state.daily[day]) state.daily[day] = {studied:0,correct:0,new_learned:0,seconds:0,target:0,goal_met:false};
  return state.daily[day];
}
function bumpDay(fields){
  const day=todayStr(), d=getDay(day);
  for(const k in fields) d[k]=(d[k]||0)+fields[k];
  // target locked once per day = due-at-start + newPerDay
  if(!d.target) d.target = plannedToday();
  d.goal_met = d.studied >= d.target;
  d.updated_at = nowISO();
  saveLocal(); queuePush("daily_log", {day, ...d});
}

/* ============================================================
   SCHEDULE / PACING
   ============================================================ */
function daysLeft(){ // inclusive, today..exam
  const diff = dayDiff(todayStr(), state.settings.exam_date);
  return Math.max(1, diff+1);
}
function newWordsRemaining(){
  let n=0; for(const w of WORDS){ const c=state.cards[w.id]; if(!c || c.status==="new") n++; } return n;
}
function autoPace(){
  return clamp(Math.ceil(newWordsRemaining()/daysLeft()), 5, 300);
}
function newPerDay(){
  return state.settings.daily_goal>0 ? state.settings.daily_goal : autoPace();
}
function dueCards(){ // ids due for review now (not new)
  const t=Date.now(), out=[];
  for(const w of WORDS){
    const c=state.cards[w.id];
    if(c && c.status!=="new" && c.due && new Date(c.due).getTime()<=t) out.push(w.id);
  }
  return out;
}
function newCardIds(limit){
  const out=[];
  for(const w of WORDS){
    const c=state.cards[w.id];
    if(!c || c.status==="new"){ out.push(w.id); if(out.length>=limit) break; }
  }
  return out;
}
function plannedToday(){ return dueCards().length + newPerDay(); }

/* counts */
function countByStatus(){
  let learned=0,mastered=0,totalRev=0;
  for(const w of WORDS){
    const c=state.cards[w.id]; if(!c||c.status==="new") continue;
    learned++; totalRev+=c.reps; if(c.status==="mastered") mastered++;
  }
  return {learned, mastered, totalRev, remaining: WORDS.length-learned};
}

/* ---------- streak ---------- */
function computeStreak(){
  let s=0; const cur=parseDate(todayStr());
  for(let i=0;;i++){
    const d=new Date(cur); d.setDate(d.getDate()-i);
    const key=todayStr(d), rec=state.daily[key];
    if(rec && rec.goal_met){ s++; }
    else if(i===0){ continue; }     // today not yet done — keep counting from yesterday
    else break;
  }
  return s;
}

/* ============================================================
   SRS ENGINE (SM-2 변형)
   ============================================================ */
function gradeCard(id, q){ // q: 'again'|'hard'|'good'|'easy'
  const c = {...getCard(id)};
  const wasNew = (c.status==="new");
  if(q==="again"){
    c.lapses++; c.ease=Math.max(1.3,c.ease-0.2); c.interval=0;
    c.status="learning"; c.due=nowISO();           // re-show within session
  } else {
    if(q==="hard"){ c.ease=Math.max(1.3,c.ease-0.15); c.interval = c.reps===0?1:Math.max(1,c.interval*1.2); }
    else if(q==="good"){ c.interval = c.reps===0?1 : c.reps===1?3 : c.interval*c.ease; }
    else /*easy*/{ c.ease+=0.15; c.interval = c.reps===0?2 : c.interval*c.ease*1.3; }
    c.reps++;
    c.status = c.interval>=21 ? "mastered" : (c.reps>=1 ? "review":"learning");
    const due=new Date(); due.setMinutes(due.getMinutes()+Math.round(c.interval*1440));
    c.due=due.toISOString();
  }
  setCard(id, c);
  return {wasNew, q};
}

/* ============================================================
   SUPABASE SYNC
   ============================================================ */
function syncCode(){
  let c=localStorage.getItem(LS.code);
  if(!c){ c=genCode(); localStorage.setItem(LS.code,c); }
  return c;
}
function genCode(){
  const r = (crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)).replace(/-/g,"");
  return "afq-"+r.slice(0,16);
}
function sbUrl(){ return localStorage.getItem(LS.url) || CFG.SUPABASE_URL || ""; }
function sbKey(){ return localStorage.getItem(LS.key) || CFG.SUPABASE_ANON_KEY || ""; }

function setSyncDot(s){ // 'on'|'off'|'err'
  const d=$("#syncDot"); d.className="sync-dot "+s;
  const txt={on:"✅ 실시간 동기화 켜짐",off:"오프라인 모드 (이 기기에만 저장)",err:"⚠️ 동기화 오류 — 키 확인 필요"}[s];
  $("#syncStatusText").textContent = s==="on" ? `✅ 연결됨 · 코드 ${syncCode()}` : txt;
}

async function initSync(){
  if(!sbUrl() || !sbKey() || !window.supabase){ setSyncDot("off"); return; }
  try{
    sb = window.supabase.createClient(sbUrl(), sbKey(), { realtime:{ params:{ eventsPerSecond:5 } } });
    setSyncDot("on");
    await pullAll();
    subscribeRealtime();
  }catch(e){ console.error(e); sb=null; setSyncDot("err"); }
}

async function pullAll(){
  if(!sb) return;
  const code=syncCode();
  const [vs, dl, st] = await Promise.all([
    sb.from("vocab_state").select("*").eq("user_key",code),
    sb.from("daily_log").select("*").eq("user_key",code),
    sb.from("settings").select("*").eq("user_key",code).maybeSingle(),
  ]);
  if(vs.data) for(const r of vs.data) mergeCard(r);
  if(dl.data) for(const r of dl.data) mergeDaily(r);
  if(st.data) mergeSettings(st.data);
  saveLocal(); renderAll();
}
function mergeCard(r){
  const cur=state.cards[r.word_id];
  if(!cur || new Date(r.updated_at) > new Date(cur.updated_at||0)){
    state.cards[r.word_id]={status:r.status,reps:r.reps,lapses:r.lapses,ease:r.ease,
      interval:r.interval,due:r.due,starred:r.starred,updated_at:r.updated_at};
  }
}
function mergeDaily(r){
  const cur=state.daily[r.day];
  if(!cur || new Date(r.updated_at) > new Date(cur.updated_at||0)){
    state.daily[r.day]={studied:r.studied,correct:r.correct,new_learned:r.new_learned,
      seconds:r.seconds,target:cur?.target||0,goal_met:r.goal_met,updated_at:r.updated_at};
  }
}
function mergeSettings(r){
  if(r.daily_goal!=null) state.settings.daily_goal=r.daily_goal;
  if(r.start_date) state.settings.start_date=r.start_date;
  if(r.exam_date)  state.settings.exam_date=r.exam_date;
}

function subscribeRealtime(){
  if(!sb) return;
  if(realtimeChan) sb.removeChannel(realtimeChan);
  const code=syncCode();
  realtimeChan = sb.channel("afoqt-"+code)
    .on("postgres_changes",{event:"*",schema:"public",table:"vocab_state",filter:`user_key=eq.${code}`},
        p=>{ if(p.new){ mergeCard(p.new); saveLocal(); softRender(); }})
    .on("postgres_changes",{event:"*",schema:"public",table:"daily_log",filter:`user_key=eq.${code}`},
        p=>{ if(p.new){ mergeDaily(p.new); saveLocal(); softRender(); }})
    .on("postgres_changes",{event:"*",schema:"public",table:"settings",filter:`user_key=eq.${code}`},
        p=>{ if(p.new){ mergeSettings(p.new); saveLocal(); softRender(); }})
    .subscribe();
}

/* push queue (debounced batching) */
const pushQ = { vocab_state:new Map(), daily_log:new Map(), settings:null };
let pushTimer=null;
function queuePush(table, row){
  if(!sb) return;
  const code=syncCode();
  if(table==="vocab_state"){
    pushQ.vocab_state.set(row.id, {user_key:code, word_id:row.id, status:row.status, reps:row.reps,
      lapses:row.lapses, ease:row.ease, interval:row.interval, due:row.due, starred:!!row.starred, updated_at:row.updated_at});
  } else if(table==="daily_log"){
    pushQ.daily_log.set(row.day, {user_key:code, day:row.day, studied:row.studied, correct:row.correct,
      new_learned:row.new_learned, seconds:row.seconds, goal_met:row.goal_met, updated_at:row.updated_at});
  } else if(table==="settings"){
    pushQ.settings = {user_key:code, daily_goal:state.settings.daily_goal, start_date:state.settings.start_date,
      exam_date:state.settings.exam_date, updated_at:nowISO()};
  }
  clearTimeout(pushTimer); pushTimer=setTimeout(flushPush, 700);
}
async function flushPush(){
  if(!sb) return;
  try{
    if(pushQ.vocab_state.size){ const rows=[...pushQ.vocab_state.values()]; pushQ.vocab_state.clear();
      await sb.from("vocab_state").upsert(rows, {onConflict:"user_key,word_id"}); }
    if(pushQ.daily_log.size){ const rows=[...pushQ.daily_log.values()]; pushQ.daily_log.clear();
      await sb.from("daily_log").upsert(rows, {onConflict:"user_key,day"}); }
    if(pushQ.settings){ const row=pushQ.settings; pushQ.settings=null;
      await sb.from("settings").upsert(row, {onConflict:"user_key"}); }
  }catch(e){ console.error("push fail",e); setSyncDot("err"); }
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function go(view){
  $$(".view").forEach(v=>v.classList.remove("active"));
  $("#view-"+view).classList.add("active");
  $$("#nav button").forEach(b=>b.classList.toggle("on", b.dataset.go===view));
  window.scrollTo(0,0);
  if(view==="home") renderHome();
  if(view==="words") renderWords();
  if(view==="stats") renderStats();
  if(view==="quiz"){ $("#quizArea").innerHTML=""; $("#quizStart").classList.remove("hidden"); $("#quizDone").classList.add("hidden"); }
}

/* ============================================================
   HOME
   ============================================================ */
function renderHome(){
  const dl=dayDiff(todayStr(), state.settings.exam_date);
  $("#daysLeft").textContent = dl<0 ? "0" : dl;
  const [ey,em,ed]=state.settings.exam_date.split("-");
  $("#examLine").textContent = `목표일 ${+em}/${+ed}`;

  const cnt=countByStatus();
  const today=getDay();
  const target=today.target || plannedToday();
  const pct = target? clamp(Math.round(today.studied/target*100),0,100):0;
  $("#goalRing").style.setProperty("--p",pct);
  $("#ringPct").textContent = pct+"%";

  const overall = Math.round(cnt.learned/WORDS.length*100);
  $("#overallBar").style.width = overall+"%";
  $("#overallLine").textContent = `전체 진도 ${cnt.learned} / ${WORDS.length} (${overall}%)`;

  $("#stStreak").textContent  = computeStreak();
  $("#stToday").textContent   = today.studied;
  $("#stDue").textContent     = dueCards().length;
  $("#stLearned").textContent = cnt.learned;
  $("#stMastered").textContent= cnt.mastered;
  $("#stRemain").textContent  = cnt.remaining;
  $("#recPace").textContent   = `신규 ${newPerDay()}/일`;
}

/* ============================================================
   STUDY (flashcards)
   ============================================================ */
let session=null;
function startStudy(){
  const due=dueCards();
  const news=newCardIds(newPerDay());
  let queue=[...due, ...news];
  if(!queue.length){
    // 더 볼 게 없으면 신규 추가 제안
    queue=newCardIds(newPerDay());
  }
  if(!queue.length){ toast("오늘 학습할 카드가 없어요! 🎉"); go("home"); return; }
  session={ queue, idx:0, plan:queue.length, studied:0, correct:0, newSeen:0,
            revealed:false, startTs:Date.now() };
  const d=getDay(); if(!d.target){ d.target=queue.length; saveLocal(); }   // 오늘 목표 고정
  go("study");
  $("#studyDone").classList.add("hidden");
  renderCard();
}
function renderCard(){
  const s=session;
  if(s.idx>=s.queue.length){ return finishStudy(); }
  const id=s.queue[s.idx], w=WMAP.get(id), c=getCard(id);
  const isNew = c.status==="new";
  $("#studyMode").textContent = isNew ? "🆕 신규" : "🔁 복습";
  $("#studyCount").textContent = `${Math.min(s.studied+1,s.plan)} / ${s.plan}`;
  $("#studyBar").style.width = clamp(s.studied/s.plan*100,0,100)+"%";
  s.revealed=false;

  const syn=(w.synonyms||[]).map(x=>`<span>${esc(x)}</span>`).join("");
  const ana=(w.analogyRelations||[]).map(esc).join("<br>");
  $("#studyArea").innerHTML = `
    <div class="flash" id="flashCard">
      <button class="star-btn ${c.starred?'on':''}" id="starBtn">${c.starred?'★':'☆'}</button>
      <div class="word">${esc(w.word)}</div>
      <div class="pos">${esc(w.pos||"")}</div>
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

  $("#flashCard").onclick=(e)=>{ if(e.target.id==="starBtn")return; reveal(); };
  $("#starBtn").onclick=(e)=>{ e.stopPropagation(); toggleStar(id); $("#starBtn").classList.toggle("on"); $("#starBtn").textContent=getCard(id).starred?"★":"☆"; };
  $$("#gradeRow button").forEach(b=>b.onclick=()=>answer(id, b.dataset.q));
}
function reveal(){
  if(session.revealed) return;
  session.revealed=true;
  $("#revealBox").classList.remove("hidden");
  $("#tapHint").classList.add("hidden");
  $("#gradeRow").classList.remove("hidden");
}
function predict(id,q){ // 예상 다음 간격(일) — 실제 채점 전 미리보기
  const c={...getCard(id)};
  if(q==="hard") return c.reps===0?1:Math.max(1,c.interval*1.2);
  if(q==="good") return c.reps===0?1:c.reps===1?3:c.interval*c.ease;
  if(q==="easy") return c.reps===0?2:c.interval*c.ease*1.3;
  return 0;
}
function fmtIv(d){ if(d<1) return "<1일"; if(d>=21) return "마스터"; return Math.round(d)+"일"; }
function answer(id,q){
  const s=session;
  const wasNew = getCard(id).status==="new";
  gradeCard(id,q);
  s.studied++;
  if(q!=="again") s.correct++;
  bumpDay({studied:1, correct:q!=="again"?1:0, new_learned:wasNew?1:0,
           seconds:Math.round((Date.now()-(s.cardTs||s.startTs))/1000)});
  s.cardTs=Date.now();
  if(q==="again"){ // 같은 세션에서 다시 보여주기
    const w=s.queue.splice(s.idx,1)[0];
    s.queue.splice(Math.min(s.idx+3,s.queue.length),0,w);
  } else {
    s.idx++;
  }
  renderHome();
  renderCard();
}
function finishStudy(){
  const s=session; const secs=Math.round((Date.now()-s.startTs)/1000);
  $("#studyArea").innerHTML=""; $("#studyBar").style.width="100%";
  $("#studyCount").textContent=`${s.plan} / ${s.plan}`;
  const acc=s.studied?Math.round(s.correct/s.studied*100):0;
  $("#doneSub").textContent = `${s.studied}개 학습 · 정답 ${acc}% · ${Math.round(secs/60)}분`;
  $("#studyDone").classList.remove("hidden");
  const dueNow=dueCards().length, more=newCardIds(1).length;
  $("#doneMore").classList.toggle("hidden", dueNow===0 && more===0);
  if(getDay().goal_met) toast("🔥 오늘 목표 달성! 스트릭 +1");
  session=null;
}

function toggleStar(id){ const c={...getCard(id)}; c.starred=!c.starred; setCard(id,c); }

/* ============================================================
   QUIZ
   ============================================================ */
let quiz=null;
function poolFor(scope){
  if(scope==="all") return WORDS.map(w=>w.id);
  if(scope==="starred") return WORDS.filter(w=>getCard(w.id).starred).map(w=>w.id);
  if(scope==="due") return dueCards();
  // learned
  return WORDS.filter(w=>{const c=state.cards[w.id];return c&&c.status!=="new";}).map(w=>w.id);
}
function startQuiz(){
  const scope=$("#quizScope").value, type=$("#quizType").value;
  let pool=poolFor(scope);
  if(pool.length<4){ toast("문제를 낼 단어가 부족해요. 먼저 학습하거나 범위를 넓혀보세요."); return; }
  const ids=sample(pool, Math.min(10,pool.length));
  quiz={ items:ids, idx:0, score:0, type, answered:false };
  $("#quizStart").classList.add("hidden");
  $("#quizDone").classList.add("hidden");
  renderQuiz();
}
function renderQuiz(){
  const q=quiz;
  if(q.idx>=q.items.length) return finishQuiz();
  const id=q.items[q.idx], w=WMAP.get(id);
  let type=q.type==="mix" ? ["e2k","k2e","syn"][Math.floor(Math.random()*3)] : q.type;
  if(type==="syn" && !(w.synonyms&&w.synonyms.length)) type="e2k";
  $("#quizCount").textContent=`${q.idx+1} / ${q.items.length}`;
  $("#quizScore").textContent=`${q.score}점`;
  $("#quizBar").style.width=(q.idx/q.items.length*100)+"%";

  let prompt, qword, correct, choices;
  if(type==="e2k"){
    prompt="이 단어의 뜻은?"; qword=w.word; correct=w.kor;
    choices=sample(WORDS.filter(x=>x.id!==id&&x.kor),3).map(x=>x.kor);
  } else if(type==="k2e"){
    prompt="다음 뜻의 단어는?"; qword=w.kor; correct=w.word;
    choices=sample(WORDS.filter(x=>x.id!==id),3).map(x=>x.word);
  } else { // syn
    prompt=`"${w.word}" 와(과) 비슷한 말은?`; qword=w.word;
    correct=w.synonyms[Math.floor(Math.random()*w.synonyms.length)];
    const others=WORDS.filter(x=>x.id!==id&&x.synonyms&&x.synonyms.length);
    choices=sample(others,3).map(x=>x.synonyms[0]);
  }
  const opts=shuffle([correct,...choices]);
  $("#quizArea").innerHTML=`
    <div class="card">
      <div class="q-prompt">${esc(prompt)}</div>
      <div class="q-word">${esc(qword)}</div>
      <div class="choices" id="choices">
        ${opts.map(o=>`<button class="choice">${esc(o)}</button>`).join("")}
      </div>
    </div>`;
  q.answered=false;
  $$("#choices .choice").forEach(btn=>{
    btn.onclick=()=>{
      if(q.answered)return; q.answered=true;
      const ok = btn.textContent===correct;
      $$("#choices .choice").forEach(b=>{
        b.disabled=true;
        if(b.textContent===correct) b.classList.add("correct");
        else if(b===btn) b.classList.add("wrong");
      });
      if(ok) q.score+=10;
      bumpDay({studied:1, correct: ok?1:0});
      renderHome();
      setTimeout(()=>{ q.idx++; renderQuiz(); }, ok?550:1100);
    };
  });
}
function finishQuiz(){
  const q=quiz, total=q.items.length, got=q.score/10;
  $("#quizArea").innerHTML=""; $("#quizBar").style.width="100%";
  const pct=Math.round(got/total*100);
  $("#quizEmoji").textContent = pct>=90?"🏆":pct>=70?"🎯":pct>=50?"💪":"📚";
  $("#quizResult").textContent=`${got} / ${total} 정답 (${pct}%)`;
  $("#quizResultSub").textContent = pct>=90?"완벽해요!":pct>=70?"좋아요, 계속!":"복습하면 금방 올라요.";
  $("#quizDone").classList.remove("hidden");
  quiz=null;
}

/* ============================================================
   WORDS LIST
   ============================================================ */
let wordFilter="all", wordSearch="";
function renderWords(){
  const t=Date.now();
  let list=WORDS.filter(w=>{
    const c=getCard(w.id);
    if(wordFilter==="starred" && !c.starred) return false;
    if(["new","learning","review","mastered"].includes(wordFilter) && c.status!==wordFilter) return false;
    if(wordSearch){
      const q=wordSearch.toLowerCase();
      if(!(w.word.toLowerCase().includes(q) || (w.kor||"").includes(wordSearch) || (w.def||"").toLowerCase().includes(q))) return false;
    }
    return true;
  });
  $("#wordCount").textContent=`${list.length}개`;
  const cap=list.slice(0,400);
  $("#wordList").innerHTML = cap.map(w=>{
    const c=getCard(w.id);
    const lbl={new:"미학습",learning:"학습중",review:"복습",mastered:"마스터"}[c.status];
    return `<div class="witem" data-id="${w.id}">
      <div style="min-width:0">
        <div class="w">${esc(w.word)} ${c.starred?'<span style="color:var(--gold)">★</span>':''}</div>
        <div class="k">${esc(w.kor||w.def||"")}</div>
      </div>
      <span class="tag ${c.status}">${lbl}</span>
    </div>`;
  }).join("") + (list.length>400?`<div class="center muted" style="padding:12px">검색으로 좁혀보세요 (${list.length-400}개 더)</div>`:"");
  $$("#wordList .witem").forEach(el=>el.onclick=()=>showWord(+el.dataset.id));
}
function showWord(id){
  const w=WMAP.get(id), c=getCard(id);
  const syn=(w.synonyms||[]).map(x=>`<span>${esc(x)}</span>`).join("");
  const ana=(w.analogyRelations||[]).map(esc).join("<br>");
  openSheet(`
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <h3 style="font-size:26px">${esc(w.word)}</h3>
      <button class="btn sm ghost" id="wstar">${c.starred?'★ 즐겨찾기':'☆ 즐겨찾기'}</button>
    </div>
    <div class="pos" style="color:var(--brand2);font-size:12px;text-transform:uppercase">${esc(w.pos||"")}</div>
    <div class="kor" style="font-size:20px;font-weight:700;margin-top:10px">${esc(w.kor||"")}</div>
    <div class="def muted" style="margin-top:6px;line-height:1.5">${esc(w.def||"")}</div>
    ${w.example?`<div class="ex" style="font-style:italic;border-left:3px solid var(--brand);padding-left:10px;margin-top:12px;color:#cbd5e1">"${esc(w.example)}"</div>`:""}
    ${syn?`<h2 class="section">동의어</h2><div class="syn" style="display:flex;flex-wrap:wrap;gap:6px">${syn}</div>`:""}
    ${ana?`<h2 class="section">유추 관계</h2><div class="ana" style="font-family:ui-monospace,monospace;font-size:12px;color:var(--muted);line-height:1.7">${ana}</div>`:""}
    <button class="btn ghost" id="wclose" style="margin-top:20px">닫기</button>
  `);
  $("#wstar").onclick=()=>{ toggleStar(id); showWord(id); renderWords(); };
  $("#wclose").onclick=closeSheet;
}

/* ============================================================
   STATS
   ============================================================ */
function renderStats(){
  const cnt=countByStatus();
  $("#sLearned").textContent=cnt.learned;
  $("#sMastered").textContent=cnt.mastered;
  $("#sTotalRev").textContent=cnt.totalRev;
  let cor=0,stu=0; for(const k in state.daily){ cor+=state.daily[k].correct; stu+=state.daily[k].studied; }
  $("#sAcc").textContent = stu? Math.round(cor/stu*100)+"%" : "–";

  // calendar 6/1 .. 7/10
  const start=parseDate(state.settings.start_date), exam=parseDate(state.settings.exam_date);
  const head=["일","월","화","수","목","금","토"].map(d=>`<div class="dow">${d}</div>`).join("");
  $("#calHead").innerHTML=head;
  let cells="";
  // leading blanks to first weekday
  for(let i=0;i<start.getDay();i++) cells+=`<div class="d" style="background:none"></div>`;
  for(let d=new Date(start); d<=exam; d.setDate(d.getDate()+1)){
    const key=todayStr(d), rec=state.daily[key];
    let cls="d";
    if(rec && rec.goal_met) cls+=" met";
    else if(rec && rec.studied>0) cls+=" partial";
    if(key===todayStr()) cls+=" today";
    cells+=`<div class="${cls}">${d.getDate()}</div>`;
  }
  $("#calGrid").innerHTML=cells;
  let met=0; for(const k in state.daily) if(state.daily[k].goal_met) met++;
  $("#calStreak").textContent=computeStreak();
  $("#calMet").textContent=met;

  // projection
  const left=daysLeft(), rem=cnt.remaining, pace=newPerDay();
  const finishDays = pace? Math.ceil(rem/pace) : 0;
  const onTrack = finishDays<=left;
  $("#projection").innerHTML = rem===0
    ? `<div class="center"><div class="big-emoji">🏁</div><b>모든 단어 학습 완료!</b><div class="muted">이제 복습으로 마스터하세요.</div></div>`
    : `<div>남은 단어 <b>${rem}</b>개 · 시험까지 <b>${left}</b>일<br>
       현재 페이스(신규 ${pace}/일)면 <b>약 ${finishDays}일</b> 안에 1회독 완료.<br>
       <span style="color:${onTrack?'var(--ok)':'var(--warn)'}">${onTrack?'✅ 일정 내 완주 가능!':'⚠️ 하루 신규 단어를 늘리면 더 안전해요.'}</span></div>`;
}

/* ============================================================
   SETTINGS SHEET
   ============================================================ */
function openSheet(html){ const bg=$("#genericSheet")||createGeneric(); $("#genericSheetBody").innerHTML=html; bg.classList.add("open"); }
function createGeneric(){
  const bg=document.createElement("div"); bg.className="sheet-bg"; bg.id="genericSheet";
  bg.innerHTML=`<div class="sheet" id="genericSheetBody"></div>`;
  bg.onclick=e=>{ if(e.target===bg) closeSheet(); };
  document.body.appendChild(bg); return bg;
}
function closeSheet(){ $("#genericSheet")?.classList.remove("open"); }

function openSettings(){
  $("#setGoal").value = state.settings.daily_goal||"";
  $("#setStart").value= state.settings.start_date;
  $("#setExam").value = state.settings.exam_date;
  $("#setUrl").value  = localStorage.getItem(LS.url)||"";
  $("#setKey").value  = localStorage.getItem(LS.key)||"";
  $("#syncCodeView").textContent=syncCode();
  $("#verLine").textContent=`v${VERSION}`;
  setSyncDot(sb?"on":(sbUrl()&&sbKey()?"err":"off"));
  $("#settingsSheet").classList.add("open");
}
function saveSettings(){
  const g=parseInt($("#setGoal").value,10);
  state.settings.daily_goal = isNaN(g)?0:Math.max(0,g);
  if($("#setStart").value) state.settings.start_date=$("#setStart").value;
  if($("#setExam").value)  state.settings.exam_date=$("#setExam").value;
  const url=$("#setUrl").value.trim(), key=$("#setKey").value.trim();
  let reconnect=false;
  if(url!==(localStorage.getItem(LS.url)||"")){ localStorage.setItem(LS.url,url); reconnect=true; }
  if(key!==(localStorage.getItem(LS.key)||"")){ localStorage.setItem(LS.key,key); reconnect=true; }
  saveLocal(); queuePush("settings",{}); flushPush();
  $("#settingsSheet").classList.remove("open");
  toast("저장됨");
  renderHome();
  if(reconnect){ if(realtimeChan&&sb){sb.removeChannel(realtimeChan);} sb=null; initSync(); }
}

/* ============================================================
   RENDER orchestration
   ============================================================ */
function renderAll(){ renderHome(); }
function softRender(){
  const active=$(".view.active")?.id;
  if(active==="view-home") renderHome();
  else if(active==="view-words") renderWords();
  else if(active==="view-stats") renderStats();
}

function esc(s){ return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }

/* ============================================================
   WIRING
   ============================================================ */
function wire(){
  $$("#nav button").forEach(b=>b.onclick=()=>go(b.dataset.go));
  $("#btnStart").onclick=startStudy;
  $("#btnQuizHome").onclick=()=>go("quiz");
  $("#studyBack").onclick=()=>{ session=null; go("home"); };
  $("#doneHome").onclick=()=>go("home");
  $("#doneMore").onclick=startStudy;

  $("#quizBack").onclick=()=>go("home");
  $("#quizGo").onclick=startQuiz;
  $("#quizRetry").onclick=()=>{ $("#quizDone").classList.add("hidden"); $("#quizStart").classList.remove("hidden"); };
  $("#quizHomeBtn").onclick=()=>go("home");

  $("#searchBox").oninput=e=>{ wordSearch=e.target.value.trim(); renderWords(); };
  $$("#wordFilters .chip").forEach(c=>c.onclick=()=>{
    $$("#wordFilters .chip").forEach(x=>x.classList.remove("on")); c.classList.add("on");
    wordFilter=c.dataset.f; renderWords();
  });

  $("#btnSettings").onclick=openSettings;
  $("#closeSettings").onclick=()=>$("#settingsSheet").classList.remove("open");
  $("#settingsSheet").onclick=e=>{ if(e.target.id==="settingsSheet") $("#settingsSheet").classList.remove("open"); };
  $("#saveSettings").onclick=saveSettings;
  $("#copyCode").onclick=()=>{ navigator.clipboard?.writeText(syncCode()); toast("동기화 코드 복사됨"); };
  $("#newCode").onclick=()=>{ if(confirm("새 동기화 코드를 만들면 이 기기는 새 데이터로 시작합니다(기존 코드의 클라우드 데이터는 남아있음). 계속할까요?")){ localStorage.setItem(LS.code,genCode()); location.reload(); } };
  $("#enterCode").onclick=()=>{ const c=prompt("다른 기기와 동기화할 코드를 입력하세요:", syncCode()); if(c&&c.trim()){ localStorage.setItem(LS.code,c.trim()); toast("코드 적용 — 동기화 중…"); location.reload(); } };
  $("#resetAll").onclick=()=>{ if(confirm("이 기기의 학습 기록을 모두 지웁니다. 계속할까요?")){ state=DEFAULT_STATE(); saveLocal(); toast("초기화됨"); $("#settingsSheet").classList.remove("open"); go("home"); } };
}

/* ============================================================
   BOOT
   ============================================================ */
async function boot(){
  loadLocal();
  wire();
  try{
    const res=await fetch("./words.json",{cache:"force-cache"});
    WORDS=await res.json();
  }catch(e){ $("#boot").innerHTML="<p class='center'>단어 데이터를 불러오지 못했습니다.</p>"; return; }
  WMAP=new Map(WORDS.map(w=>[w.id,w]));
  $("#boot").classList.remove("active");
  go("home");
  initSync();                 // 비동기 — 연결되면 자동 머지
  if("serviceWorker" in navigator){ navigator.serviceWorker.register("./sw.js").catch(()=>{}); }
}
document.addEventListener("DOMContentLoaded", boot);

})();
