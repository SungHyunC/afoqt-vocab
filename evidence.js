/* AFOQT Master — 학습 증거 로그 (append-only · SHA-256 해시 체인 · 기기별 replica)
   DOM 없음. app.js보다 먼저 로드되며 window.AFOQTEvidence로 노출한다.
   node 테스트: scripts/test_evidence.mjs (vm.runInNewContext). 동기화 코드·키는 절대 받지 않는다. */
(() => {
"use strict";
const EV_V = 1;
const HASHED = ["i","q","y","s","e","z","a","n","c","k","sc","t","r","m"];   // 해시에 들어가는 필드(순서 무관 — canonical)
const ACT_IDLE = { default:60000, read:120000, passage:120000, exam:180000, autoplay:60000 };
const MOCK_KINDS = ["preset","mock","picked"];
const TYPE_LABEL = {
  flash_new:["Flashcards · new words","신규 단어 카드"], flash_review:["Flashcards · review","복습 카드"], flash_set:["Flashcards · deck","덱 카드"],
  confirm:["Verification quiz","확인 시험"], synfeed:["Synonym feed","동의어 무한 피드"], vafeed:["Analogy feed","유추 무한 피드"],
  exam:["Timed exam","모의고사"], exam_abandoned:["Exam (abandoned)","중단한 시험"], drill:["Drill","드릴"], retest:["Wrong-answer retest","오답 재시험"],
  passage:["Reading passage","독해 지문"], autoplay:["Hands-free audio review","자동 넘김"], rootcoach:["Root coach","어근 코치"], read:["Reading / review screen","읽기 화면"],
  va_practice:["Analogy practice","유추 연습"], snapshot:["Progress snapshot","진도 스냅샷"], legacy_daily:["Reconstructed day","재구성(일별)"],
  legacy_exam:["Reconstructed exam","재구성(시험)"], baseline_set:["Baseline updated","기준선 설정"], migrate:["App migration","앱 마이그레이션"],
  reset:["Local reset","기록 초기화"], restore:["Backup restored","백업 복원"] };
const SYSTEM_TYPES = new Set(["snapshot","baseline_set","migrate","reset","restore"]);
const KIND_LABEL = { preset:"Section/Full mock", mock:"Real-format mock", picked:"Custom sections", practice:"Practice (untimed)", learn:"Learning mode", retest:"Wrong-answer retest", drill:"Drill" };

/* ---------- SHA-256 (동기 · 순수 JS · UTF-8) ---------- */
const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
function utf8Bytes(str){ const out=[]; str=String(str);
  for(let i=0;i<str.length;i++){ let c=str.charCodeAt(i);
    if(c>=0xD800&&c<=0xDBFF&&i+1<str.length){ const d=str.charCodeAt(i+1); if(d>=0xDC00&&d<=0xDFFF){ c=0x10000+((c-0xD800)<<10)+(d-0xDC00); i++; } }
    if(c<0x80) out.push(c); else if(c<0x800) out.push(0xC0|(c>>6),0x80|(c&63));
    else if(c<0x10000) out.push(0xE0|(c>>12),0x80|((c>>6)&63),0x80|(c&63));
    else out.push(0xF0|(c>>18),0x80|((c>>12)&63),0x80|((c>>6)&63),0x80|(c&63)); }
  return out; }
function sha256(str){
  const m=utf8Bytes(str), bits=m.length*8; m.push(0x80); while(m.length%64!==56) m.push(0);
  const hi=Math.floor(bits/4294967296), lo=bits>>>0;
  m.push((hi>>>24)&255,(hi>>>16)&255,(hi>>>8)&255,hi&255,(lo>>>24)&255,(lo>>>16)&255,(lo>>>8)&255,lo&255);
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19; const w=new Array(64);
  for(let i=0;i<m.length;i+=64){
    for(let t=0;t<16;t++) w[t]=(m[i+t*4]<<24)|(m[i+t*4+1]<<16)|(m[i+t*4+2]<<8)|m[i+t*4+3];
    for(let t=16;t<64;t++){ const x=w[t-15],y=w[t-2];
      const s0=((x>>>7)|(x<<25))^((x>>>18)|(x<<14))^(x>>>3), s1=((y>>>17)|(y<<15))^((y>>>19)|(y<<13))^(y>>>10);
      w[t]=(w[t-16]+s0+w[t-7]+s1)|0; }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for(let t=0;t<64;t++){
      const S1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)), ch=(e&f)^(~e&g), t1=(h+S1+ch+K[t]+w[t])|0;
      const S0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)), maj=(a&b)^(a&c)^(b&c), t2=(S0+maj)|0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0; }
    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0; h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+h)|0; }
  return [h0,h1,h2,h3,h4,h5,h6,h7].map(x=>(x>>>0).toString(16).padStart(8,"0")).join(""); }

/* ---------- 정규화 · 직렬화 ---------- */
const isObj = v => !!v && typeof v==="object" && !Array.isArray(v);
const int = v => { const n=Math.round(Number(v)); return Number.isFinite(n)&&n>0?n:0; };
const sint = v => { const n=Math.round(Number(v)); return Number.isFinite(n)?n:0; };
const str = (v,max) => String(v==null?"":v).slice(0,max);
function canonical(v){
  if(v===undefined) return undefined;
  if(v===null||typeof v!=="object") return typeof v==="number"&&!Number.isFinite(v)?"null":JSON.stringify(v);
  if(Array.isArray(v)) return "["+v.map(x=>{ const s=canonical(x); return s===undefined?"null":s; }).join(",")+"]";
  const keys=Object.keys(v).filter(k=>v[k]!==undefined).sort();
  return "{"+keys.map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}"; }
// meta는 작고 평평하게: 문자열 ≤48자, 깊이 ≤2, 배열 ≤12, 전체 ≤400자
function compactMeta(m, depth=0){
  if(!isObj(m)) return {};
  const out={};
  for(const k of Object.keys(m).sort()){ const v=m[k]; if(v==null) continue; const key=str(k,16);
    if(typeof v==="number"){ if(Number.isFinite(v)) out[key]=Math.round(v*100)/100; }
    else if(typeof v==="boolean") out[key]=v?1:0;
    else if(typeof v==="string") out[key]=v.slice(0,48);
    else if(Array.isArray(v)) out[key]=v.slice(0,12).map(x=>typeof x==="number"?Math.round(x*100)/100:str(x,24));
    else if(isObj(v)&&depth<1) out[key]=compactMeta(v,depth+1); }
  if(depth===0){ let keys=Object.keys(out);
    while(keys.length&&JSON.stringify(out).length>400){ const big=keys.sort((a,b)=>JSON.stringify(out[b]).length-JSON.stringify(out[a]).length)[0]; delete out[big]; keys=Object.keys(out); } }
  return out; }
function devShort(dev){ return String(dev||"").replace(/^afd-/,"").slice(0,8)||"unknown"; }
function validHash(h){ return typeof h==="string"&&/^[0-9a-f]{64}$/.test(h); }
function cleanEvent(e){
  if(!isObj(e)||typeof e.i!=="string"||!e.i||e.i.length>40||!int(e.q)||typeof e.y!=="string"||!validHash(e.h)) return null;
  const out={i:e.i,q:int(e.q),y:str(e.y,24),s:int(e.s),e:int(e.e),z:sint(e.z),a:int(e.a),n:int(e.n),c:int(e.c)};
  if(e.k!=null&&e.k!=="") out.k=str(e.k,40); if(e.sc!=null) out.sc=int(e.sc); if(e.t!=null) out.t=int(e.t); if(e.r) out.r=str(e.r,1);
  if(isObj(e.m)&&Object.keys(e.m).length) out.m=e.m;   // 이미 확정된 meta는 손대지 않는다(해시 보존)
  out.h=e.h; if(int(e.rcv)) out.rcv=int(e.rcv); if(e.d) out.d=str(e.d,32);
  return out; }
function newReplica(){ return {v:EV_V,n:0,head:"",ev:[],updated_at:""}; }
function cleanReplica(r){
  const out=newReplica(); if(!isObj(r)) return out;
  const seen=new Set();
  for(const raw of (Array.isArray(r.ev)?r.ev:[])){ const e=cleanEvent(raw); if(!e||seen.has(e.i)) continue; seen.add(e.i); delete e.d; out.ev.push(e); }
  out.ev.sort((a,b)=>a.q-b.q);
  const last=out.ev[out.ev.length-1];
  out.n=Math.max(int(r.n), last?last.q:0); out.head=validHash(r.head)?r.head:(last?last.h:"");
  out.updated_at=str(r.updated_at,40); return out; }
function eventHash(dev, ev, prev){ const body={d:String(dev||"")}; for(const k of HASHED) if(ev[k]!==undefined) body[k]=ev[k]; return sha256(String(prev||"")+"\n"+canonical(body)); }
// 새 이벤트 생성(아직 append 전). f.i가 있으면 결정적 id(재구성 이벤트용)
function makeEvent(replica, f, dev){
  const r=isObj(replica)?replica:newReplica(), q=int(r.n)+1;
  const ev={i:f&&f.i?str(f.i,40):devShort(dev)+"-"+String(q).padStart(6,"0"),q,y:str(f&&f.y||"read",24),s:int(f&&f.s),e:int(f&&f.e),z:sint(f&&f.z),a:int(f&&f.a),n:int(f&&f.n),c:int(f&&f.c)};
  if(ev.e<ev.s) ev.e=ev.s;
  if(f&&f.k!=null&&f.k!=="") ev.k=str(f.k,40); if(f&&f.sc!=null) ev.sc=int(f.sc); if(f&&f.t!=null) ev.t=int(f.t); if(f&&f.r) ev.r=str(f.r,1);
  const m=compactMeta(f&&f.m); if(Object.keys(m).length) ev.m=m;
  ev.h=eventHash(dev, ev, r.head||""); return ev; }
function appendEvent(replica, ev, nowISO){ replica.ev.push(ev); replica.n=ev.q; replica.head=ev.h; replica.updated_at=nowISO||replica.updated_at||""; return ev; }
// 체인 검증: 같은 기기의 전체 이벤트(아카이브 포함)를 q 순으로
function verifyChain(dev, events){
  const list=(events||[]).filter(Boolean).slice().sort((a,b)=>a.q-b.q);
  const out={ok:true,n:list.length,verified:0,head:list.length?list[list.length-1].h:"",gapAt:null,badAt:null,partial:false};
  if(!list.length) return out;
  if(list[0].q!==1){ out.ok=false; out.partial=true; return out; }
  let prev="";
  for(let i=0;i<list.length;i++){ const e=list[i];
    if(e.q!==i+1){ out.ok=false; out.gapAt=i+1; break; }
    if(eventHash(dev,e,prev)!==e.h){ out.ok=false; out.badAt=e.q; break; }
    out.verified++; prev=e.h; }
  return out; }
// 병합: id 기준 union · q 정렬 · 삭제 없음 · n/head는 줄지 않음 · rcv는 채워 넣기만
function mergeReplica(local, remote){
  const base=cleanReplica(local), map=new Map(base.ev.map(e=>[e.i,e])); let changed=false;
  const list=Array.isArray(remote)?remote:(isObj(remote)?(Array.isArray(remote.ev)?remote.ev:[]):[]);
  for(const raw of list){ const e=cleanEvent(raw); if(!e) continue; delete e.d;
    const cur=map.get(e.i);
    if(!cur){ map.set(e.i,e); changed=true; }
    else if(e.rcv&&!cur.rcv){ cur.rcv=e.rcv; changed=true; } }
  const ev=[...map.values()].sort((a,b)=>a.q-b.q), last=ev[ev.length-1];
  const rn=isObj(remote)&&!Array.isArray(remote)?int(remote.n):0, rh=isObj(remote)&&!Array.isArray(remote)&&validHash(remote.head)?remote.head:"";
  const n=Math.max(base.n, rn, last?last.q:0);
  let head=base.head; if(n>base.n){ head=(rn===n&&rh)?rh:(last&&last.q===n?last.h:head); }
  if(n!==base.n||head!==base.head) changed=true;
  const updated_at=(rn>=base.n&&isObj(remote)&&remote.updated_at)?str(remote.updated_at,40):base.updated_at;
  return {replica:{v:EV_V,n,head,ev,updated_at},changed}; }
// hot 창 밖(e < cutoffSec) 이벤트를 아카이브로 이동(전 기기 union, append-only). n/head는 그대로.
function rollArchive(replicas, archive, cutoffSec){
  const arc=Array.isArray(archive)?archive.map(cleanEvent).filter(Boolean):[], have=new Set(arc.map(e=>e.i)); let moved=0; const out={};
  for(const dev of Object.keys(replicas||{})){ const r=cleanReplica(replicas[dev]); const keep=[];
    for(const e of r.ev){ if(e.e<cutoffSec){ if(!have.has(e.i)){ arc.push({...e,d:dev}); have.add(e.i); } moved++; } else keep.push(e); }
    r.ev=keep; out[dev]=r; }
  return {replicas:out,archive:arc,moved}; }
// hot + 아카이브를 기기 표시(d) 붙여 하나로 (id 중복 제거)
function allEvents(replicas, archive){
  const map=new Map();
  for(const e of (Array.isArray(archive)?archive:[])){ const c=cleanEvent(e); if(c&&c.d&&!map.has(c.i)) map.set(c.i,c); }
  for(const dev of Object.keys(replicas||{})){ for(const e of cleanReplica(replicas[dev]).ev){ const c={...e,d:dev}; const cur=map.get(c.i); if(!cur||(c.rcv&&!cur.rcv)) map.set(c.i,c); } }
  return [...map.values()].sort((a,b)=>(a.e-b.e)||(a.q-b.q)||a.i.localeCompare(b.i)); }
function eventsOfDevice(events, dev){ return events.filter(e=>e.d===dev).sort((a,b)=>a.q-b.q); }

/* ---------- 활성 시간 누산기 (ms · 주입 시계) ----------
   입력이 있을 때마다 '마지막 입력 + idle'까지만 시간을 인정한다 → 켜둔 채 잊은 화면은 idle 이상 쌓이지 않는다.
   tick = 여기까지 계산했다는 시각. hidden(paused) 동안은 아무것도 쌓이지 않는다. */
function actNew(type, meta, now, idleMs){ const y=str(type||"read",24);
  return {y,m:isObj(meta)?meta:{},s:now,last:now,tick:now,a:0,n:0,c:0,paused:false,idle:int(idleMs)||ACT_IDLE[y]||ACT_IDLE.default}; }
function actAccrue(act, now){ if(!act||act.paused) return act; const upto=Math.min(now, act.last+act.idle); if(upto>act.tick){ act.a+=upto-act.tick; act.tick=upto; } return act; }
function actTouch(act, now){ if(!act) return act; if(!act.paused){ actAccrue(act, now); act.tick=now; } act.last=now; return act; }
function actPause(act, now){ if(!act||act.paused) return act; actAccrue(act, now); act.paused=true; return act; }
function actResume(act, now){ if(!act||!act.paused) return act; act.paused=false; act.last=now; act.tick=now; return act; }
function actCount(act, ok){ if(!act) return act; act.n++; if(ok) act.c++; return act; }
// 종료 → makeEvent에 넘길 필드. z = 로컬 UTC 오프셋(분)
function actEnd(act, now, extra, z){ if(!act) return null; actAccrue(act, now);
  const f={y:act.y,s:Math.round(act.s/1000),e:Math.round(now/1000),z:sint(z),a:Math.round(act.a/1000),n:act.n,c:act.c,m:{...act.m}};
  if(extra&&isObj(extra)){ for(const k of Object.keys(extra)){ if(k==="m"&&isObj(extra.m)) Object.assign(f.m,extra.m); else f[k]=extra[k]; } }
  return f; }

/* ---------- 날짜 · 집계 ---------- */
function dayOf(sec, z){ return new Date((int(sec)+sint(z)*60)*1000).toISOString().slice(0,10); }
function localStamp(sec, z){ if(!sec) return ""; return new Date((sec+sint(z)*60)*1000).toISOString().replace("T"," ").slice(0,16); }
function tzLabel(z){ z=sint(z); const s=z<0?"-":"+", a=Math.abs(z); return "UTC"+s+String(Math.floor(a/60)).padStart(2,"0")+(a%60?":"+String(a%60).padStart(2,"0"):""); }
function daySec(day, z){ const t=Date.parse(day+"T00:00:00Z"); return Number.isFinite(t)?Math.round(t/1000)-sint(z)*60:0; }
function addDays(day, n){ const d=new Date(day+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function dayDiff(a, b){ return Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/86400000); }
function weekStart(day){ const d=new Date(day+"T00:00:00Z"); const wd=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-wd); return d.toISOString().slice(0,10); }
function isScoredExam(e){ return (e.y==="exam"||e.y==="legacy_exam"||e.y==="retest"||e.y==="drill")&&e.t>0; }
function examKind(e){ return (e.m&&e.m.kd)||(e.y==="retest"?"retest":e.y==="drill"?"drill":"preset"); }
// 이중 계산 방지: (1) 같은 id는 첫 기기만 (2) live 이벤트가 있는 날의 legacy_daily 무시 (3) live exam과 같은 ts의 legacy_exam 무시
function dedupe(events){
  const byId=new Map();
  for(const e of events){ const cur=byId.get(e.i); if(!cur||String(e.d)<String(cur.d)) byId.set(e.i,e); }
  const list=[...byId.values()];
  const liveDays=new Set(), liveExamTs=new Set();
  for(const e of list){ if(e.r==="L"||SYSTEM_TYPES.has(e.y)) continue; liveDays.add(dayOf(e.e,e.z)); if(e.y==="exam"&&e.m&&e.m.ts) liveExamTs.add(String(e.m.ts)); }
  return list.filter(e=>{ if(e.y==="legacy_daily"&&liveDays.has(dayOf(e.e,e.z))) return false;
    if(e.y==="legacy_exam"&&liveExamTs.has(String(e.m&&e.m.ts||e.i.replace(/^L-x-/,"")))) return false; return true; }); }
function aggregate(events, opts){
  const o=opts||{}, list=dedupe(events||[]).filter(e=>{ if(SYSTEM_TYPES.has(e.y)&&e.y!=="snapshot") return false;
    const d=dayOf(e.e,e.z); return (!o.from||d>=o.from)&&(!o.to||d<=o.to); });
  const days={}, byType={}, exams=[], snapshots=[];
  for(const e of list){ const day=dayOf(e.e,e.z);
    if(e.y==="snapshot"){ snapshots.push({day,dev:e.d,...(e.m||{})}); continue; }
    const D=days[day]||(days[day]={day,active:0,items:0,correct:0,sessions:0,devices:new Set(),byType:{},exams:[],reconstructed:false,best:null});
    D.devices.add(e.d); if(e.r==="L") D.reconstructed=true;
    D.active+=e.a; D.items+=e.n; D.correct+=e.c; D.sessions++;
    const T=D.byType[e.y]||(D.byType[e.y]={active:0,items:0,correct:0,n:0}); T.active+=e.a; T.items+=e.n; T.correct+=e.c; T.n++;
    const G=byType[e.y]||(byType[e.y]={active:0,items:0,correct:0,n:0}); G.active+=e.a; G.items+=e.n; G.correct+=e.c; G.n++;
    if(isScoredExam(e)){ const x={id:e.i,day,dev:e.d,type:e.y,kind:examKind(e),key:e.k||"",name:(e.m&&e.m.nm)||"",score:e.sc||0,total:e.t||0,pct:e.t?Math.round((e.sc||0)/e.t*100):0,
        clock:(e.m&&int(e.m.cs))||0,active:e.a,practice:!!(e.m&&e.m.pr),learn:!!(e.m&&e.m.ln),src:e.r==="m"?"mock":e.r==="L"?"reconstructed":"app",bySec:(e.m&&isObj(e.m.bs))?e.m.bs:{},timedOut:(e.m&&Array.isArray(e.m.to))?e.m.to:[],start:e.s,end:e.e,z:e.z};
      D.exams.push(x); exams.push(x); if(!x.practice&&!x.learn&&MOCK_KINDS.includes(x.kind)&&(D.best==null||x.pct>D.best)) D.best=x.pct; } }
  const dayList=Object.values(days).sort((a,b)=>a.day.localeCompare(b.day)).map(d=>({...d,devices:[...d.devices].sort()}));
  const weeks={}; for(const d of dayList){ const w=weekStart(d.day); const W=weeks[w]||(weeks[w]={start:w,active:0,items:0,sessions:0,days:0}); W.active+=d.active; W.items+=d.items; W.sessions+=d.sessions; W.days++; }
  const totals={active:0,items:0,correct:0,sessions:0,exams:exams.length,daysActive:dayList.filter(d=>d.active>0||d.items>0).length,mockExams:exams.filter(x=>MOCK_KINDS.includes(x.kind)&&!x.practice&&!x.learn).length};
  for(const d of dayList){ totals.active+=d.active; totals.items+=d.items; totals.correct+=d.correct; totals.sessions+=d.sessions; }
  return {days:dayList,weeks:Object.values(weeks).sort((a,b)=>a.start.localeCompare(b.start)),byType,exams:exams.sort((a,b)=>a.end-b.end),snapshots:snapshots.sort((a,b)=>a.day.localeCompare(b.day)),totals}; }

/* ---------- 재구성(legacy) — 신규 기록 이전 구간을 기존 데이터에서 1회 생성 ---------- */
function legacyImport(src, opts){
  const s=isObj(src)?src:{}, o=opts||{}, from=String(o.attemptDate||""), until=String(o.installDay||""), z=sint(o.z), out=[];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(until)) return out;
  const daily=isObj(s.daily)?s.daily:{}, ds=isObj(s.dayStats)?s.dayStats:{}, sf=isObj(s.synDays)?s.synDays:{}, vf=isObj(s.vaDays)?s.vaDays:{}, ap=isObj(s.apExposure)?s.apExposure:{};
  const days=new Set([...Object.keys(daily),...Object.keys(ds),...Object.keys(sf),...Object.keys(vf),...Object.keys(ap)].filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>=from&&d<until));
  for(const day of [...days].sort()){ const d=isObj(daily[day])?daily[day]:{}, m={fs:1};
    const n=int(d.studied), c=int(d.correct), a=int(d.seconds); let any=n>0||a>0;
    if(isObj(ds[day])){ const t={}; for(const k of Object.keys(ds[day]).sort()) if(int(ds[day][k])) t[str(k,4)]=int(ds[day][k]); if(Object.keys(t).length){ m.ds=t; any=true; } }
    if(isObj(sf[day])&&int(sf[day].n)){ m.sf=int(sf[day].n); m.sfc=int(sf[day].c); any=true; }
    if(isObj(vf[day])&&int(vf[day].n)){ m.vf=int(vf[day].n); m.vfc=int(vf[day].c); any=true; }
    if(int(ap[day])){ m.ap=int(ap[day]); any=true; }
    if(int(d.new_learned)) m.nl=int(d.new_learned);
    if(!any) continue;
    const s0=daySec(day,z); out.push({i:"L-d-"+day,y:"legacy_daily",s:s0,e:s0+86399,z,a,n,c,r:"L",m}); }
  const fromMs=daySec(from,z)*1000, untilMs=daySec(until,z)*1000;
  for(const h of (Array.isArray(s.examHist)?s.examHist:[])){ if(!isObj(h)||!int(h.ts)||h.ts<fromMs||h.ts>=untilMs||!int(h.total)) continue;
    const end=Math.round(h.ts/1000), secs=int(h.secs), key=String(h.key||"");
    const kd=h.kind||(key.startsWith("mock_")?"mock":key==="retest"?"retest":h.learn?"learn":h.practice?"practice":!key?"picked":"preset");
    const bs={}; if(isObj(h.bySec)) for(const k of Object.keys(h.bySec).sort()) bs[str(k,4)]=[int(h.bySec[k].got),int(h.bySec[k].total)];
    const m={kd,ts:h.ts,cs:secs}; if(h.name) m.nm=str(h.name,40); if(h.practice) m.pr=1; if(h.learn) m.ln=1; if(Object.keys(bs).length) m.bs=bs; if(Array.isArray(h.skipped)&&h.skipped.length) m.sk=h.skipped.slice(0,12);
    // 시험 기록은 실제 제출 시각이 있는 원본이라 '재구성(L)' 표시 대신 legacy_exam 타입으로만 구분한다(mock 출처는 유지)
    const f={i:"L-x-"+h.ts,y:"legacy_exam",s:Math.max(0,end-secs),e:end,z,a:secs,n:int(h.total),c:int(h.got),k:key||"retest",sc:int(h.got),t:int(h.total),m};
    if(key.startsWith("mock_")) f.r="m"; out.push(f); }
  return out; }

/* ---------- 리포트 모델 (입력은 화이트리스트 객체만 — 동기화 코드·키가 들어올 자리가 없다) ---------- */
function fmtHM(sec){ sec=int(sec); const h=Math.floor(sec/3600), m=Math.round((sec%3600)/60); return h?`${h}h ${String(m).padStart(2,"0")}m`:`${m}m`; }
function pct(c,n){ return n?Math.round(c/n*100):0; }
function buildReport(input){
  const inp=isObj(input)?input:{}, replicas=isObj(inp.replicas)?inp.replicas:{}, archive=Array.isArray(inp.archive)?inp.archive:[];
  const st=isObj(inp.settings)?inp.settings:{}, now=int(inp.now)||Date.now(), z=sint(inp.tz), recv=isObj(inp.recv)?inp.recv:{};
  const events=allEvents(replicas,archive).map(e=>(recv[e.i]&&!e.rcv)?{...e,rcv:int(recv[e.i])}:e);
  const today=dayOf(Math.round(now/1000),z);
  const firstDay=events.length?events.map(e=>dayOf(e.e,e.z)).sort()[0]:today;
  const from=/^\d{4}-\d{2}-\d{2}$/.test(String(st.official_attempt_date||""))?st.official_attempt_date:firstDay;
  const period={from,to:today,days:Math.max(1,dayDiff(from,today)+1)};
  const agg=aggregate(events,{from,to:today}), all=aggregate(events,{});
  const devices=Object.keys(replicas).sort().map(dev=>{ const evs=eventsOfDevice(events,dev), v=verifyChain(dev,evs), r=cleanReplica(replicas[dev]);
    const rec=evs.filter(e=>e.rcv), late=evs.filter(e=>e.rcv&&e.rcv-e.e>7*86400).length, compacted=evs.filter(e=>e.m&&e.m.cm).length;
    return {id:dev,short:devShort(dev),self:dev===inp.deviceId,events:evs.length,total:r.n,head:r.head,verify:v,serverReceived:rec.length,lastReceived:rec.length?Math.max(...rec.map(e=>e.rcv)):0,late,compacted,
      first:evs.length?evs[0].e:0,last:evs.length?evs[evs.length-1].e:0}; });
  const baselineEvents=events.filter(e=>e.y==="baseline_set").map(e=>({day:dayOf(e.e,e.z),dev:e.d,...(e.m||{})}));
  const systemEvents=events.filter(e=>SYSTEM_TYPES.has(e.y)&&e.y!=="snapshot").map(e=>({day:dayOf(e.e,e.z),stamp:localStamp(e.e,e.z),dev:e.d,type:e.y,meta:e.m||{}}));
  const counts=isObj(inp.counts)?inp.counts:{};
  return {
    generatedAt:localStamp(Math.round(now/1000),z)+" "+tzLabel(z), generatedISO:new Date(now).toISOString(), version:str(inp.version,20), device:str(inp.deviceId,32), tz:z,
    period, baseline:{attemptDate:str(st.official_attempt_date,10),retestDate:str(st.retest_date,10),officialScores:str(st.official_scores,120),evSince:str(st.ev_since,10)},
    summary:{active:agg.totals.active,activeLabel:fmtHM(agg.totals.active),sessions:agg.totals.sessions,items:agg.totals.items,correct:agg.totals.correct,accuracy:pct(agg.totals.correct,agg.totals.items),
      exams:agg.totals.exams,mockExams:agg.totals.mockExams,daysActive:agg.totals.daysActive,daysInPeriod:period.days,reconstructedDays:agg.days.filter(d=>d.reconstructed).length},
    allTime:{active:all.totals.active,activeLabel:fmtHM(all.totals.active),sessions:all.totals.sessions,items:all.totals.items,exams:all.totals.exams,firstDay,daysActive:all.totals.daysActive},
    days:agg.days, weeks:agg.weeks, byType:agg.byType, exams:agg.exams, snapshots:agg.snapshots, devices, baselineEvents, systemEvents,
    vocab:{learned:int(counts.learned),mastered:int(counts.mastered),verified:int(counts.verified),remaining:int(counts.remaining),total:int(counts.total)},
    eventCount:events.length, typeLabel:TYPE_LABEL, kindLabel:KIND_LABEL }; }

/* ---------- CSV (UTF-8 BOM · RFC4180 · CRLF) ---------- */
function csvCell(v){ if(v==null) return ""; const s=String(v); return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
function toCSV(rows){ return "﻿"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n")+"\r\n"; }
function csvSessions(replicas, archive, recv){
  const events=dedupe(allEvents(replicas,archive)).filter(e=>!SYSTEM_TYPES.has(e.y)||e.y==="snapshot"), rc=isObj(recv)?recv:{};
  const rows=[["event_id","device","type","type_label","start_local","end_local","tz","active_min","items","correct","accuracy","key","score","total","kind","src","recovered","late_upload","note","hash"]];
  for(const e of events){ const r=e.rcv||int(rc[e.i]); const late=r&&r-e.e>7*86400?1:0;
    rows.push([e.i,devShort(e.d),e.y,(TYPE_LABEL[e.y]||[e.y])[0],localStamp(e.s,e.z),localStamp(e.e,e.z),tzLabel(e.z),Math.round(e.a/60*10)/10,e.n,e.c,e.n?pct(e.c,e.n)+"%":"",e.k||"",e.sc!=null?e.sc:"",e.t!=null?e.t:"",
      isScoredExam(e)?examKind(e):"",e.r==="m"?"mock":e.r==="L"?"reconstructed":"app",e.m&&e.m.rc?1:0,late,e.r==="L"?"reconstructed from pre-logging data (time = flashcards/exams only)":(e.m&&e.m.ps?"paused segment":""),e.h]); }
  return toCSV(rows); }
function csvDaily(report){
  const rows=[["date","active_min","sessions","items","correct","accuracy","exams","best_mock_pct","devices","reconstructed"]];
  for(const d of report.days) rows.push([d.day,Math.round(d.active/60*10)/10,d.sessions,d.items,d.correct,d.items?pct(d.correct,d.items)+"%":"",d.exams.map(x=>`${x.name||x.key} ${x.score}/${x.total}`).join("; "),d.best==null?"":d.best+"%",d.devices.map(devShort).join(" "),d.reconstructed?1:0]);
  return toCSV(rows); }
function csvExams(report){
  const rows=[["event_id","datetime_local","tz","device","kind","key","name","timed","practice","total","score","pct","clock_min","active_min","by_section","timed_out_sections","src"]];
  for(const x of report.exams) rows.push([x.id,localStamp(x.end,x.z),tzLabel(x.z),devShort(x.dev),x.kind,x.key,x.name,x.practice||x.learn?0:1,x.practice?1:0,x.total,x.score,x.pct+"%",Math.round(x.clock/60*10)/10,Math.round(x.active/60*10)/10,
    Object.keys(x.bySec).map(k=>`${k}:${x.bySec[k][0]}/${x.bySec[k][1]}`).join(" "),x.timedOut.join(" "),x.src]);
  return toCSV(rows); }

/* ---------- 인쇄용 HTML (영문 헤딩 + 한글 부제) ---------- */
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function weeklySVG(weeks){
  const W=Math.max(1,weeks.length), w=640, h=170, pad=28, bw=Math.max(6,Math.floor((w-pad*2)/W)-4), max=Math.max(60,...weeks.map(x=>x.active/60));
  const bars=weeks.map((x,i)=>{ const v=x.active/60, bh=Math.round((h-pad*2)*v/max), xx=pad+i*(bw+4), yy=h-pad-bh;
    return `<rect x="${xx}" y="${yy}" width="${bw}" height="${bh}" fill="#4f46e5"/><text x="${xx+bw/2}" y="${h-pad+12}" font-size="8" text-anchor="middle" fill="#333">${esc(x.start.slice(5))}</text>`+(v>0?`<text x="${xx+bw/2}" y="${yy-3}" font-size="8" text-anchor="middle" fill="#111">${Math.round(v)}</text>`:""); }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Weekly active minutes"><line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" stroke="#999"/><text x="${pad}" y="12" font-size="9" fill="#333">Active minutes per week (week starting Mon) · 주별 활성 학습 분</text>${bars}</svg>`; }
function scoreSVG(exams){
  const pts=exams.filter(x=>MOCK_KINDS.includes(x.kind)&&!x.practice&&!x.learn); if(pts.length<2) return "";
  const w=640,h=160,pad=28,n=pts.length, xs=i=>pad+i*((w-pad*2)/(n-1)), ys=p=>h-pad-(h-pad*2)*p/100;
  const path=pts.map((x,i)=>`${i?"L":"M"}${xs(i).toFixed(1)},${ys(x.pct).toFixed(1)}`).join(" ");
  const dots=pts.map((x,i)=>`<circle cx="${xs(i).toFixed(1)}" cy="${ys(x.pct).toFixed(1)}" r="3" fill="${x.src==="mock"?"#dc2626":"#4f46e5"}"/><text x="${xs(i).toFixed(1)}" y="${h-pad+12}" font-size="8" text-anchor="middle" fill="#333">${esc(x.day.slice(5))}</text>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Exam score timeline"><line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" stroke="#999"/><text x="${pad}" y="12" font-size="9" fill="#333">Raw score % (red = real-format mock form, blue = app-generated) · 원점수 추이</text><path d="${path}" fill="none" stroke="#4f46e5" stroke-width="1.5"/>${dots}</svg>`; }
function renderHTML(r){
  const H=(en,ko)=>`<h3 class="ev-h">${esc(en)} <small>${esc(ko)}</small></h3>`;
  const card=(inner,cls="")=>`<section class="ev-card ${cls}">${inner}</section>`;
  const kv=(k,v)=>`<div class="ev-kv"><span>${esc(k)}</span><b>${v}</b></div>`;
  const b=r.baseline, s=r.summary;
  const head=card(`<h2 class="ev-title">AFOQT Study Evidence Report <small>AFOQT 학습 기록 증빙 리포트</small></h2>
    <div class="ev-grid">${kv("Period · 기간",`${esc(r.period.from)} → ${esc(r.period.to)} (${r.period.days} days)`)}${kv("Official AFOQT attempt · 공식 응시일",esc(b.attemptDate||"—"))}${kv("Retest target · 재응시 목표일",esc(b.retestDate||"not set"))}
    ${kv("Official scores (self-reported) · 공식 점수(자기 기재)",esc(b.officialScores||"—"))}${kv("Generated · 생성",esc(r.generatedAt))}${kv("App version · 앱 버전",esc(r.version))}${kv("Devices · 기기",r.devices.map(d=>esc(d.short)+(d.self?" (this device)":"")).join(", ")||"—")}${kv("Logging since · 상세 기록 시작",esc(b.evSince||"—"))}</div>`);
  const sum=card(H("Summary (since official attempt)","요약 — 공식 응시일 이후")+`<div class="ev-stats">
    <div><b>${esc(s.activeLabel)}</b><span>active study time<br>활성 학습 시간</span></div><div><b>${s.sessions}</b><span>sessions<br>세션</span></div><div><b>${s.items}</b><span>items answered<br>풀이 항목</span></div>
    <div><b>${s.accuracy}%</b><span>accuracy<br>정답률</span></div><div><b>${s.exams}</b><span>scored exams (${s.mockExams} timed mocks)<br>채점 시험(모의고사 ${s.mockExams})</span></div><div><b>${s.daysActive}/${s.daysInPeriod}</b><span>active days / days in period<br>활동일/기간</span></div></div>
    <p class="ev-note">All-time · 전체 기간: ${esc(r.allTime.activeLabel)} active, ${r.allTime.sessions} sessions, ${r.allTime.items} items, ${r.allTime.exams} exams since ${esc(r.allTime.firstDay)}.${s.reconstructedDays?` ${s.reconstructedDays} day(s) marked ® are reconstructed from pre-logging data.`:""}</p>`);
  const dayRows=r.days.map(d=>`<tr><td>${esc(d.day)}${d.reconstructed?" ®":""}</td><td class="r">${Math.round(d.active/60)}</td><td class="r">${d.sessions}</td><td class="r">${d.items}</td><td class="r">${d.items?pct(d.correct,d.items)+"%":"—"}</td><td>${esc(d.exams.map(x=>`${x.name||x.key} ${x.score}/${x.total}${x.practice?" (practice)":""}`).join("; "))}</td><td>${esc(d.devices.map(devShort).join(" "))}</td></tr>`).join("");
  const daily=card(H("Daily Log","일별 기록")+`<table class="ev-table"><thead><tr><th>Date<br>날짜</th><th>Active min<br>활성 분</th><th>Sessions<br>세션</th><th>Items<br>항목</th><th>Accuracy<br>정답률</th><th>Exams (score)<br>시험(점수)</th><th>Device<br>기기</th></tr></thead><tbody>${dayRows||`<tr><td colspan="7">No activity in period · 기간 내 활동 없음</td></tr>`}</tbody></table>`);
  const weekly=card(H("Weekly Activity","주별 활동")+(r.weeks.length?weeklySVG(r.weeks):`<p class="ev-note">No data · 데이터 없음</p>`));
  const exRows=r.exams.map(x=>`<tr><td>${esc(x.day)}</td><td>${esc(r.kindLabel[x.kind]||x.kind)}${x.practice?" · practice":""}${x.learn?" · learning":""}</td><td>${esc(x.name||x.key)}</td><td class="r">${x.score}/${x.total}</td><td class="r">${x.pct}%</td><td class="r">${Math.round(x.clock/60)}</td><td class="r">${Math.round(x.active/60)}</td><td>${esc(x.src)}${x.timedOut.length?` · timed out: ${esc(x.timedOut.join(","))}`:""}</td></tr>`).join("");
  const exams=card(H("Score Timeline (raw scores only)","점수 추이 — 원점수만")+scoreSVG(r.exams)+`<table class="ev-table"><thead><tr><th>Date</th><th>Kind<br>종류</th><th>Exam<br>시험</th><th>Score<br>점수</th><th>%</th><th>Clock min<br>시계 분</th><th>Active min<br>활성 분</th><th>Source<br>출처</th></tr></thead><tbody>${exRows||`<tr><td colspan="8">No scored exams in period · 기간 내 채점 시험 없음</td></tr>`}</tbody></table>
    <p class="ev-note">Percentile estimates and synthetic "perfect" pilot-section scores are intentionally excluded. · 추정 백분위와 가상 만점 처리 점수는 포함하지 않습니다.</p>`,"ev-break");
  const snapRows=r.snapshots.map(x=>`<tr><td>${esc(x.day)}</td><td class="r">${int(x.L)}</td><td class="r">${int(x.M)}</td><td class="r">${int(x.V)}</td><td class="r">${int(x.W)}</td></tr>`).join("");
  const vocab=card(H("Vocabulary Progress","어휘 진도")+`<div class="ev-grid">${kv("Words studied (now) · 학습 단어",`${r.vocab.learned} / ${r.vocab.total}`)}${kv("Mastered · 마스터",r.vocab.mastered)}${kv("Verified by blind quiz · 확인 시험 통과",r.vocab.verified)}${kv("Remaining · 남은 단어",r.vocab.remaining)}</div>`+
    (snapRows?`<table class="ev-table"><thead><tr><th>Date</th><th>Studied<br>학습</th><th>Mastered<br>마스터</th><th>Verified<br>확인</th><th>Wrong notes open<br>오답 노트</th></tr></thead><tbody>${snapRows}</tbody></table>`:""));
  const method=card(H("Methodology & Limitations","측정 방법과 한계")+`<ul class="ev-list">
    <li><b>Active time</b> counts only while the app is visible and the user has interacted within the last 60 s (120 s on reading screens, 180 s during exams). Time while the device is locked, the tab is hidden, or the user is idle is not counted. · 활성 시간은 앱이 보이고 최근 60초(읽기 120초·시험 180초) 안에 입력이 있었던 구간만 계산합니다. 잠금·백그라운드·유휴 시간은 제외됩니다.</li>
    <li><b>Clock minutes</b> for exams are the countdown time consumed; active minutes are the interaction-based measure above. · 시험의 시계 분은 소진된 제한시간, 활성 분은 위 기준의 실제 상호작용 시간입니다.</li>
    <li><b>Items</b> are answered questions or graded flashcards; feed items include re-asked questions. · 항목은 답한 문제·채점한 카드 수이며 피드는 재출제를 포함합니다.</li>
    <li>App-generated questions are unofficial practice material. Rows marked <b>mock</b> come from full-length AFOQT-format practice forms. Scores are raw (correct/total), never converted to official scaled scores. · 앱 문제는 비공식 연습 자료이며, mock은 실전 형식 연습 폼입니다. 점수는 원점수이며 공식 환산 점수가 아닙니다.</li>
    <li>Days marked ® (${s.reconstructedDays}) predate detailed logging (started ${esc(b.evSince||"—")}) and were reconstructed from the app's earlier daily counters; their time covers flashcards and exams only. · ® 표시 일자는 상세 기록 이전 구간을 기존 일별 카운터에서 재구성한 것으로, 시간은 플래시카드·시험만 포함합니다.</li>
    <li>Events are appended to a per-device SHA-256 hash chain and are never edited or deleted by the app; timestamps come from the device clock. When the optional server log is enabled, each event also carries the server's own receipt time. · 이벤트는 기기별 SHA-256 해시 체인에 추가만 되며 앱은 수정·삭제하지 않습니다. 시각은 기기 시계 기준이고, 서버 로그가 켜져 있으면 서버 수신 시각도 함께 남습니다.</li>
    <li>This report contains no personal identifiers or sync credentials; device IDs are random per-installation identifiers. · 이 리포트에는 개인 식별 정보와 동기화 자격 정보가 없으며 기기 ID는 설치별 무작위 식별자입니다.</li></ul>`);
  const devRows=r.devices.map(d=>`<tr><td>${esc(d.short)}${d.self?" (this device)":""}</td><td class="r">${d.events}${d.total>d.events?` / ${d.total}`:""}</td><td>${d.verify.ok?"✓ verified":d.verify.partial?"partial (older events on another device)":d.verify.badAt?`✗ mismatch at #${d.verify.badAt}`:d.verify.gapAt?`gap at #${d.verify.gapAt}`:"—"}${d.compacted?` · ${d.compacted} meta compacted`:""}</td><td class="r">${d.serverReceived}${d.late?` (${d.late} late)`:""}</td><td>${d.lastReceived?esc(localStamp(d.lastReceived,r.tz)):"—"}</td><td class="ev-hash">${esc(d.head||"—")}</td></tr>`).join("");
  const sys=r.systemEvents.length?`<p class="ev-note">System events · 시스템 이벤트: ${r.systemEvents.map(x=>`${esc(x.stamp)} ${esc(x.type)}${x.meta.from?` ${esc(x.meta.from)}→${esc(x.meta.to||"")}`:""}`).join("; ")}</p>`:"";
  const integ=card(H("Integrity","무결성")+`<table class="ev-table"><thead><tr><th>Device<br>기기</th><th>Events<br>이벤트</th><th>Chain check<br>체인 검증</th><th>Server-received<br>서버 수신</th><th>Last receipt<br>최근 수신</th><th>Head hash (SHA-256)<br>최신 해시</th></tr></thead><tbody>${devRows||`<tr><td colspan="6">—</td></tr>`}</tbody></table>${sys}
    <p class="ev-note">Generated ${esc(r.generatedISO)} · ${r.eventCount} events total. Verify by recomputing each event hash as SHA-256(previous hash + "\\n" + canonical JSON of the event with its device id). · 검증: 각 이벤트 해시는 SHA-256(직전 해시 + 줄바꿈 + 기기 id를 포함한 정규화 JSON)으로 재계산할 수 있습니다.</p>`);
  return head+sum+daily+weekly+exams+vocab+method+integ; }
function summaryText(r){ const s=r.summary;
  return [`AFOQT Study Evidence — ${r.period.from} → ${r.period.to} (${r.period.days} days)`,`Official attempt: ${r.baseline.attemptDate||"—"} · Retest target: ${r.baseline.retestDate||"not set"}`,
    `Active study time: ${s.activeLabel} · Sessions: ${s.sessions} · Items: ${s.items} (${s.accuracy}% correct) · Scored exams: ${s.exams} (timed mocks ${s.mockExams}) · Active days: ${s.daysActive}/${s.daysInPeriod}`,
    `Devices: ${r.devices.map(d=>`${d.short} (${d.events} events, chain ${d.verify.ok?"verified":"partial"}, head ${(d.head||"").slice(0,16)}…)`).join("; ")||"—"}`,`Generated ${r.generatedAt} · app ${r.version}`].join("\n"); }

window.AFOQTEvidence = Object.freeze({ EV_V, ACT_IDLE, TYPE_LABEL, KIND_LABEL, MOCK_KINDS,
  sha256, canonical, compactMeta, devShort, cleanEvent, cleanReplica, newReplica, eventHash, makeEvent, appendEvent, verifyChain, mergeReplica, rollArchive, allEvents, eventsOfDevice,
  actNew, actAccrue, actTouch, actPause, actResume, actCount, actEnd,
  dayOf, localStamp, tzLabel, daySec, addDays, dayDiff, weekStart, dedupe, aggregate, legacyImport, buildReport, fmtHM,
  toCSV, csvSessions, csvDaily, csvExams, renderHTML, summaryText, weeklySVG, scoreSVG });
})();
