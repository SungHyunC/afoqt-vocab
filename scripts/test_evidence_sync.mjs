#!/usr/bin/env node
// app.js 안의 증거·일별 동기화 로직 검증 — loadLocal 정규화, mergeDaily(max), isMockRecord/kind 마이그레이션,
// evlog replica 병합·재푸시, study_log 수신 도장(rcv), study_log 테이블 부재 시 큐 격리, 기준선 설정 병합.
// test_synfeed_sync.mjs와 같은 vm 하니스: app.js는 디스크에서 바뀌지 않고, 노출 코드는 메모리에서만 덧붙는다.
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
class MemoryStorage { #d = new Map(); getItem(k){ return this.#d.has(String(k)) ? this.#d.get(String(k)) : null; } setItem(k, v){ this.#d.set(String(k), String(v)); } removeItem(k){ this.#d.delete(String(k)); } clear(){ this.#d.clear(); } }
function load() {
  const source = readFileSync(resolve(root, "app.js"), "utf8"), closeAt = source.lastIndexOf("\n})();");
  assert.notEqual(closeAt, -1);
  const expose = `
Object.assign(globalThis.__h, { LS, DEFAULT_STATE, loadLocal, mergeDaily, dailyExceeds, isMockRecord, bigExams, mergeEvlogRow, mergeStudyLogRows, queueEvlogReplica, queuePush, flushPushMap, flushPushPass, mergeSettings, deviceId, pushQ,
  getState: () => state, setState: v => { state = v; }, getStudyLogUnavailable: () => studyLogUnavailable, setSyncDot: fn => { setSyncDot = fn; },
  setSync: v => { if(Object.hasOwn(v,"sb")) sb = v.sb; if(Object.hasOwn(v,"syncReady")) syncReady = v.syncReady; if(Object.hasOwn(v,"syncSessionCode")) syncSessionCode = v.syncSessionCode; },
  setWords: v => { WORDS = v; WMAP = new Map(WORDS.map(w => [w.id, w])); } });
`;
  const localStorage = new MemoryStorage();
  const document = { visibilityState: "visible", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
  const context = { AbortController, clearInterval, clearTimeout, console, crypto: webcrypto, Date, document, fetch: async () => { throw new Error("network disabled"); },
    JSON, localStorage, Map, Math, navigator: {}, Set, setInterval, setTimeout, TextDecoder, TextEncoder, Uint8Array, URL, Number, Object, Array, String, RegExp, Error, Promise, __h: {} };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(resolve(root, "evidence.js"), "utf8"), context, { filename: "evidence.js" });
  vm.runInContext(source.slice(0, closeAt) + expose + source.slice(closeAt), context, { filename: "app.js", timeout: 5000 });
  return { h: context.__h, E: context.AFOQTEvidence, localStorage };
}
const { h, E, localStorage } = load();
let passed = 0; const ok = async (name, fn) => { await fn(); passed++; console.log("  ✓ " + name); };
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);   // vm realm 객체 → 프로토타입 무시
const DEV_B = "afd-bbbbbbbbbbbbbbbbbbbb";
const legacyState = { cards: {}, daily: { "2026-09-20": { studied: 30, correct: 20, seconds: 100, target: 40, goal_met: false, updated_at: "2026-09-20T10:00:00Z" } },
  examHist: [ { key: "retest", name: "오답 재시험", ts: 1, got: 3, total: 9, acc: .3 }, { key: "retest", name: "선택 모의고사 (단어·유추)", ts: 2, got: 30, total: 50, acc: .6 },
    { key: "retest", name: "유형 드릴 · 백분율", ts: 3, got: 5, total: 10, acc: .5, learn: 1 }, { key: "mock_1", name: "기출 1", ts: 4, got: 90, total: 145, acc: .62 }, { key: "wk", name: "단어", ts: 5, got: 20, total: 25, acc: .8 } ],
  settings: { daily_goal: 0, start_date: "2026-06-01", exam_date: "2026-09-11" } };
localStorage.setItem("afoqt_state_v2", JSON.stringify(legacyState));
h.setWords([{ id: 1, word: "A", kor: "가", synonyms: ["B"] }]);
h.loadLocal();
const st = h.getState();
await ok("loadLocal: v4.143 상태 정규화 — 증거 필드·기준선·설치일·kind 마이그레이션, 기존 값 보존", () => {
  deq(st.evReplicas, {}); assert.equal(st.settings.official_attempt_date, "2026-09-18"); assert.equal(st.settings.retest_date, "");
  assert.equal(st.settings.exam_date, "2026-09-11"); assert.match(st.evInstalledAt, /^\d{4}-\d{2}-\d{2}$/); assert.equal(st.settings.ev_since, st.evInstalledAt);
  assert.equal(st.daily["2026-09-20"].studied, 30); assert.equal(st.migExamKind, 1);
  deq(st.examHist.map(x => x.kind), ["retest", "picked", "learn", "mock", "preset"]);
  assert.ok(st.vaFeedSession == null && st.session == null);
});
await ok("isMockRecord/bigExams: 오답 재시험·드릴·학습 모드 제외, 큰 모의고사만", () => {
  deq(st.examHist.filter(h.isMockRecord).map(x => x.ts), [2, 4, 5]);
  deq(h.bigExams().map(x => x.ts), [2, 4, 5]);
  assert.equal(h.isMockRecord({ kind: "preset", practice: 1, total: 25 }), false);
  assert.equal(h.isMockRecord({ total: 25 }), true);   // kind 없는 옛 기록은 preset 취급
});
await ok("mergeDaily: 필드별 max — 다른 기기 몫이 사라지지 않고, 작은 원격 행은 무시", () => {
  const d = st.daily["2026-09-20"];
  assert.equal(h.mergeDaily({ day: "2026-09-20", studied: 20, correct: 25, seconds: 200, new_learned: 0, goal_met: true, updated_at: "2026-09-20T12:00:00Z" }), true);
  assert.equal(d.studied, 30); assert.equal(d.correct, 25); assert.equal(d.seconds, 200); assert.equal(d.goal_met, true); assert.equal(d.updated_at, "2026-09-20T12:00:00Z");
  assert.equal(h.mergeDaily({ day: "2026-09-20", studied: 10, correct: 1, seconds: 5, updated_at: "2026-09-21T00:00:00Z" }), false);
  assert.equal(d.studied, 30);
  assert.equal(h.mergeDaily({ day: "2026-09-19", studied: 7, correct: 7, seconds: 60, updated_at: "2026-09-19T00:00:00Z" }), true);
  assert.equal(st.daily["2026-09-19"].studied, 7);
  assert.equal(h.dailyExceeds(d, { studied: 30, correct: 25, seconds: 200, goal_met: true }), false);
  assert.equal(h.dailyExceeds(d, { studied: 29, correct: 25, seconds: 200, goal_met: true }), true);
  assert.equal(h.dailyExceeds({ studied: 0, seconds: 0 }, undefined), false);
});
await ok("mergeSettings: 기준선 필드 병합, 잘못된 날짜 거부, ev_since는 가장 이른 값", () => {
  assert.equal(h.mergeSettings({ updated_at: "2026-09-23T00:00:00Z", daily_goal: 0, data: { official_attempt_date: "2026-09-18", retest_date: "2026-11-20", official_scores: "Pilot 45", ev_since: "2026-09-10", syn_feed_timer: true } }), true);
  assert.equal(st.settings.retest_date, "2026-11-20"); assert.equal(st.settings.official_scores, "Pilot 45"); assert.equal(st.settings.ev_since, "2026-09-10"); assert.equal(st.settings.syn_feed_timer, true);
  h.mergeSettings({ updated_at: "2026-09-23T00:00:01Z", data: { retest_date: "bad", ev_since: "2026-09-15", official_attempt_date: "nope" } });
  assert.equal(st.settings.retest_date, ""); assert.equal(st.settings.ev_since, "2026-09-10"); assert.equal(st.settings.official_attempt_date, "2026-09-18");
});
// --- evlog replica 병합 ---
const own = h.deviceId();
function mkReplica(dev, n, base = 1758600000) { const r = E.newReplica(); for (let i = 0; i < n; i++) E.appendEvent(r, E.makeEvent(r, { y: "synfeed", s: base + i * 600, e: base + i * 600 + 500, z: 540, a: 300, n: 10, c: 8 }, dev), "2026-09-23T00:00:00Z"); return r; }
h.setSync({ sb: {}, syncReady: true, syncSessionCode: localStorage.getItem("afoqt_sync_code") || "" });
await ok("mergeEvlogRow: 다른 기기 행 union, 내 행이 서버보다 앞서면 재푸시 큐", () => {
  const rb = mkReplica(DEV_B, 3);
  assert.equal(h.mergeEvlogRow({ kind: "evlog", item_id: DEV_B, data: rb, updated_at: "2026-09-23T00:00:00Z" }), true);
  assert.equal(st.evReplicas[DEV_B].ev.length, 3); assert.equal(st.evReplicas[DEV_B].head, rb.head);
  assert.equal(h.mergeEvlogRow({ kind: "evlog", item_id: DEV_B, data: rb }), false);
  assert.equal(h.mergeEvlogRow({ kind: "evlog", item_id: "not-a-device", data: rb }), false);
  st.evReplicas[own] = mkReplica(own, 4);
  const serverCopy = { ...st.evReplicas[own], ev: st.evReplicas[own].ev.slice(0, 2), n: 2, head: st.evReplicas[own].ev[1].h };
  h.pushQ.verbal_progress.clear();
  assert.equal(h.mergeEvlogRow({ kind: "evlog", item_id: own, data: serverCopy }), false);
  assert.equal(st.evReplicas[own].ev.length, 4, "own replica never shrinks");
  const row = h.pushQ.verbal_progress.get("evlog:" + own); assert.ok(row, "own replica re-queued"); assert.equal(row.data.n, 4);
});
await ok("mergeStudyLogRows: 서버 수신 도장(rcv)이 내 이벤트에 채워지고, 타 기기 이벤트는 union", () => {
  const evs = st.evReplicas[own].ev;
  const rows = evs.slice(0, 2).map(e => ({ device_id: own, event_id: e.i, seq: e.q, data: e, received_at: "2026-09-23T01:00:00Z" }));
  const rc = mkReplica("afd-cccccccccccccccccccc", 2);
  rows.push(...rc.ev.map(e => ({ device_id: "afd-cccccccccccccccccccc", event_id: e.i, seq: e.q, data: e, received_at: "2026-09-23T01:00:00Z" })));
  assert.equal(h.mergeStudyLogRows(rows), true);
  assert.equal(st.evReplicas[own].ev.filter(e => e.rcv).length, 2); assert.equal(st.evReplicas["afd-cccccccccccccccccccc"].ev.length, 2);
  assert.ok(st.evReplicas["afd-cccccccccccccccccccc"].ev.every(e => e.rcv === Math.round(Date.parse("2026-09-23T01:00:00Z") / 1000)));
});
await ok("queuePush(study_log): 이벤트 행 형식", () => {
  h.pushQ.study_log.clear(); const e = st.evReplicas[own].ev[3]; h.queuePush("study_log", e);
  const row = h.pushQ.study_log.get(e.i); assert.ok(row); assert.equal(row.device_id, own); assert.equal(row.seq, e.q); assert.equal(row.data.h, e.h); assert.equal(row.client_ts, new Date(e.e * 1000).toISOString());
});
await ok("flushPushMap: study_log 테이블 부재 → 그 큐만 비우고 다른 테이블은 정상, err 표시 없음", async () => {
  let dots = []; h.setSyncDot(v => dots.push(v));
  const calls = [];
  h.setSync({ sb: { from(table) { return { upsert(rows, opts) { calls.push({ table, n: rows.length, opts }); return { async throwOnError() {
    if (table === "study_log") { const err = new Error("Could not find the table 'public.study_log' in the schema cache"); err.code = "PGRST205"; throw err; } } }; } }; } } });
  h.pushQ.daily_log.set("2026-09-20", { user_key: "x", day: "2026-09-20", studied: 30, updated_at: "2026-09-20T12:00:00Z" });
  const okAll = await h.flushPushPass();
  assert.equal(okAll, true); assert.equal(h.pushQ.study_log.size, 0); assert.equal(h.pushQ.daily_log.size, 0); assert.equal(h.getStudyLogUnavailable(), true);
  assert.equal(dots.includes("err"), false);
  assert.ok(["daily_log", "study_log"].every(t => calls.some(c => c.table === t)), "both tables attempted");
  assert.equal(calls.find(c => c.table === "study_log").opts.ignoreDuplicates, true);
  h.queuePush("study_log", st.evReplicas[own].ev[2]); assert.equal(h.pushQ.study_log.size, 0, "unavailable → no more queuing this session");
});
console.log(`Evidence sync: ${passed} groups passed`);
