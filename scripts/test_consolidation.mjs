#!/usr/bin/env node
// 통합(Phase 2) 규칙 검증 — VIEW_ALIAS 커버리지, 오답노트 삭제 표식(wrongTs LWW), plan30 체크 부호 병합, vaFeed runId 병합,
// answerWK(미학습 단어 오답은 SRS 불변), loadLocal이 v4.143 상태의 제거 기능 필드를 보존.
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
class MemoryStorage { #d = new Map(); getItem(k){ return this.#d.has(String(k)) ? this.#d.get(String(k)) : null; } setItem(k, v){ this.#d.set(String(k), String(v)); } removeItem(k){ this.#d.delete(String(k)); } clear(){ this.#d.clear(); } }
const appSrc = readFileSync(resolve(root, "app.js"), "utf8"), html = readFileSync(resolve(root, "index.html"), "utf8");
function load() {
  const closeAt = appSrc.lastIndexOf("\n})();"); assert.notEqual(closeAt, -1);
  const expose = `Object.assign(globalThis.__h, { VIEW_ALIAS, NAVPARENT, TAB_DEFAULT, loadLocal, mergeMisc, answerWK, wrongAdd, wrongDel, newCardIds, getCard, isMockRecord,
    getState: () => state, setWords: v => { WORDS = v; WMAP = new Map(WORDS.map(w => [w.id, w])); }, setSb: v => { sb = v; } });`;
  const localStorage = new MemoryStorage();
  const document = { visibilityState: "visible", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
  const context = { AbortController, clearInterval, clearTimeout, console, crypto: webcrypto, Date, document, fetch: async () => { throw new Error("network disabled"); },
    JSON, localStorage, Map, Math, navigator: {}, Set, setInterval, setTimeout, TextDecoder, TextEncoder, Uint8Array, URL, Number, Object, Array, String, RegExp, Error, Promise, __h: {} };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(resolve(root, "evidence.js"), "utf8"), context, { filename: "evidence.js" });
  vm.runInContext(appSrc.slice(0, closeAt) + expose + appSrc.slice(closeAt), context, { filename: "app.js", timeout: 5000 });
  return { h: context.__h, localStorage };
}
const { h, localStorage } = load();
let passed = 0; const ok = (name, fn) => { fn(); passed++; console.log("  ✓ " + name); };
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

ok("VIEW_ALIAS 커버리지: index.html의 data-go·app.js의 go(\"…\") 대상이 전부 실제 화면이거나 별칭", () => {
  const views = new Set([...html.matchAll(/<main id="view-([a-z]+)"/g)].map(m => m[1]));
  const targets = new Set([...[...html.matchAll(/data-go="([a-z]+)"/g)].map(m => m[1]), ...[...appSrc.matchAll(/\bgo\("([a-z]+)"/g)].map(m => m[1])]);
  const bad = [...targets].filter(v => !views.has(v) && !h.VIEW_ALIAS[v]);
  deq(bad, [], "unknown go() targets: " + bad.join(","));
  assert.ok(views.size <= 19, "view count " + views.size);
  for (const [alias, [parent, tab]] of Object.entries(h.VIEW_ALIAS)) { assert.ok(views.has(parent), "alias parent missing: " + alias + "→" + parent);
    if (tab) assert.ok(html.includes(`data-tabs="${parent}"`) && html.includes(`data-pane="${tab}"`), "alias tab missing: " + alias); }
  for (const p of Object.values(h.NAVPARENT)) assert.ok(html.includes(`data-go="${p}"`), "NAVPARENT points to a nav button: " + p);
});
// v4.143 형태 상태 → 제거된 기능의 필드 보존
const legacy = { cards: { 5: { status: "review", reps: 2, lapses: 0, ease: 2.5, interval: 3, due: "2026-09-01T00:00:00Z" } }, v16: { done: { "0:1": 1 } }, curr: { va: { unlocked: 2, passed: { 0: 1 }, best: { 0: 9 } } },
  plan30: { start: "2026-09-01", done: { "2026-09-02": { wk: 1 } }, days: 30 }, checklist: { "2026-08-31:base": { 0: 1 } }, rootStep: 12, wrong: { wk: { 5: 2, 7: 1 }, va: {}, rc: {}, ar: {}, mk: {}, ps: {}, av: {} },
  exams: { daily: { best: 10, bestTotal: 22 }, full: { best: 50, bestTotal: 75 } }, settings: { verbal_theme_priority: 3, verbal_theme_mode: "due", plan_ps_sj: true, exam_date: "2026-12-01" } };
localStorage.setItem("afoqt_state_v2", JSON.stringify(legacy));
h.setWords([5, 6, 7, 8].map(id => ({ id, word: "W" + id, kor: "뜻" + id, tier: id === 8 ? "high" : "std", synonyms: ["x"] })));
h.loadLocal(); const st = h.getState();
ok("loadLocal: 제거된 기능(v16·curr·plan30·checklist·rootStep·daily/full 프리셋 기록·테마 설정)의 데이터가 그대로 남는다", () => {
  deq(st.v16, legacy.v16); deq(st.curr, legacy.curr); deq(st.plan30, legacy.plan30); deq(st.checklist, legacy.checklist); assert.equal(st.rootStep, 12);
  deq(st.exams.daily, legacy.exams.daily); deq(st.exams.full, legacy.exams.full); assert.equal(st.settings.verbal_theme_priority, 3); assert.equal(st.settings.plan_ps_sj, true);
  deq(st.wrong.wk, { 5: 2, 7: 1 }); deq(st.wrongTs, {});
});
ok("answerWK: 정답은 오답노트 제거(+wrongTs), 미학습 단어 오답은 SRS 불변 + 신규 덱 선두, 학습 단어 오답은 복습 강등", () => {
  h.setSb(null);
  h.answerWK(5, true); assert.equal(st.wrong.wk[5], undefined); assert.ok(st.wrongTs["wk:5"] > 0);
  h.answerWK(7, false); assert.equal(st.wrong.wk[7], 2); assert.equal(st.cards[7], undefined, "new word stays new (no SRS lapse)");
  const ids = h.newCardIds(3); assert.equal(ids[0], 7, "wrong-note new word first");
  h.answerWK(5, false); assert.equal(st.cards[5].status, "learning"); assert.equal(st.cards[5].lapses, 1);
  const tier = st.weak.wkTier; assert.ok(tier.std && tier.std.c + tier.std.w === 3);
  h.answerWK(6, false, { skill: false }); assert.equal(tier.std.c + tier.std.w, 3, "skill:false does not count");
});
ok("mergeMisc 오답노트: wrongTs가 더 최신인 쪽의 존재/부재 채택 (삭제 전파 · 재추가 승리 · 옛 데이터는 union)", () => {
  const now = Date.now();
  st.wrong.wk = { 5: 1, 9: 1 }; st.wrongTs = { "wk:5": now - 1000, "wk:9": now - 1000 };
  h.mergeMisc({ wrong: { wk: { 9: 3, 11: 1 } }, wrongTs: { "wk:5": now, "wk:11": now } });   // 원격: 5는 지움(더 최신), 9는 옛 값, 11 새로
  deq(st.wrong.wk, { 9: 3, 11: 1 }); assert.equal(st.wrongTs["wk:5"], now);   // 시각 없는 원격 카운트는 max로 보수적 병합
  h.mergeMisc({ wrong: { wk: { 5: 2 } }, wrongTs: { "wk:5": now + 5 } });   // 다른 기기에서 다시 틀림 → 재추가
  assert.equal(st.wrong.wk[5], 2);
  h.mergeMisc({ wrong: { wk: { 13: 1 } } });   // 시각 없는 옛 데이터 → union
  assert.equal(st.wrong.wk[13], 1);
  h.mergeMisc({ wrong: { wk: { 9: 5 } }, wrongTs: { "wk:9": now - 5000 } });   // 더 오래된 원격 값은 무시(존재는 유지, 카운트 max)
  assert.equal(st.wrong.wk[9], 5);
});
ok("mergeMisc plan30.done: 부호 있는 ms — |ts| 큰 쪽 (해제가 체크를 이길 수 있음)", () => {
  st.plan30 = { start: "2026-09-01", done: { "2026-09-23": { wk: 100 } }, days: 30 };
  h.mergeMisc({ plan30: { start: "2026-09-01", done: { "2026-09-23": { wk: -200, va: 50 } } } });
  deq(st.plan30.done["2026-09-23"], { wk: -200, va: 50 });
  h.mergeMisc({ plan30: { start: "2026-09-01", done: { "2026-09-23": { wk: 150 } } } });
  assert.equal(st.plan30.done["2026-09-23"].wk, -200);
});
ok("mergeMisc vaFeedSession: runId가 다르면 늦게 시작한 run이 이긴다, 같으면 count 큰 쪽", () => {
  const mk = (runId, count, startedAt, updatedAt) => ({ v: 1, runId, queue: [1, 2, 3], cursor: 0, count, startedAt, updatedAt });
  st.vaFeedSession = mk("sfr-aaaaaaaaaaaaaaaaaaaa", 50, "2026-09-20T00:00:00Z", "2026-09-22T00:00:00Z");
  h.mergeMisc({ vaFeedSession: mk("sfr-bbbbbbbbbbbbbbbbbbbb", 3, "2026-09-23T00:00:00Z", "2026-09-23T00:10:00Z") });
  assert.equal(st.vaFeedSession.runId, "sfr-bbbbbbbbbbbbbbbbbbbb", "newer run wins even with lower count");
  h.mergeMisc({ vaFeedSession: mk("sfr-aaaaaaaaaaaaaaaaaaaa", 999, "2026-09-20T00:00:00Z", "2026-09-24T00:00:00Z") });
  assert.equal(st.vaFeedSession.runId, "sfr-bbbbbbbbbbbbbbbbbbbb", "older run cannot come back");
  h.mergeMisc({ vaFeedSession: mk("sfr-bbbbbbbbbbbbbbbbbbbb", 7, "2026-09-23T00:00:00Z", "2026-09-23T00:20:00Z") });
  assert.equal(st.vaFeedSession.count, 7, "same run → higher count");
});
console.log(`Consolidation: ${passed} groups passed`);
