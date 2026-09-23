// evidence.js 검증 — 해시 체인·병합·누산기·집계·재구성·CSV·리포트(비밀 미포함)·배선
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = { window: {} };
vm.runInNewContext(readFileSync(new URL('../evidence.js', import.meta.url), 'utf8'), context);
const E = context.window.AFOQTEvidence;
const DEV_A = 'afd-aaaaaaaaaaaaaaaaaaaa', DEV_B = 'afd-bbbbbbbbbbbbbbbbbbbb';
const Z = 540;                       // KST
let passed = 0; const ok = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);   // VM realm 배열/객체 → 프로토타입 무시

// 1. SHA-256
ok('sha256 vectors + random UTF-8 vs node createHash', () => {
  assert.equal(E.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(E.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const samples = ['한글 테스트', '이모지 🚀✈️ 섞기', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'w'.repeat(1000), '𝄞 surrogate', JSON.stringify({ a: [1, 2, { b: 'ü' }] })];
  for (let i = 0; i < 50; i++) samples.push(Array.from({ length: (i * 7) % 90 }, (_, j) => String.fromCharCode(0x20 + ((i * 31 + j * 17) % 0x3000))).join(''));
  for (const s of samples) assert.equal(E.sha256(s), createHash('sha256').update(s, 'utf8').digest('hex'), 'mismatch for ' + JSON.stringify(s.slice(0, 20)));
});
// 2. canonical
ok('canonical: key order independent, nested, undefined dropped', () => {
  assert.equal(E.canonical({ b: 1, a: { d: [1, 'x', null], c: undefined } }), '{"a":{"d":[1,"x",null]},"b":1}');
  assert.equal(E.canonical({ a: 1, b: 2 }), E.canonical({ b: 2, a: 1 }));
  assert.equal(E.canonical([undefined, NaN]), '[null,null]');
});
// 3. makeEvent / appendEvent / chain
function chain(dev, n, base = 1758600000) {
  const r = E.newReplica();
  for (let i = 0; i < n; i++) E.appendEvent(r, E.makeEvent(r, { y: i % 2 ? 'synfeed' : 'flash_review', s: base + i * 600, e: base + i * 600 + 500, z: Z, a: 400 + i, n: 10, c: 8, m: { p: 2 } }, dev), '2026-09-23T00:00:00Z');
  return r;
}
ok('makeEvent: id/q/hash, genesis prev empty, hash excludes rcv/h', () => {
  const r = E.newReplica();
  const e1 = E.makeEvent(r, { y: 'flash_new', s: 100, e: 200, z: Z, a: 90, n: 3, c: 3 }, DEV_A);
  assert.equal(e1.i, 'aaaaaaaa-000001'); assert.equal(e1.q, 1);
  assert.equal(e1.h, E.sha256('\n' + E.canonical({ d: DEV_A, i: e1.i, q: 1, y: 'flash_new', s: 100, e: 200, z: Z, a: 90, n: 3, c: 3 })));
  E.appendEvent(r, e1, '2026-09-23T00:00:00Z');
  const e2 = E.makeEvent(r, { y: 'exam', s: 300, e: 900, z: Z, a: 500, n: 25, c: 20, k: 'wk', sc: 20, t: 25, m: { kd: 'preset' } }, DEV_A);
  assert.equal(e2.q, 2); assert.equal(e2.h, E.eventHash(DEV_A, { ...e2, rcv: 123, h: 'junk' }, e1.h));
  assert.equal(E.makeEvent(r, { i: 'L-d-2026-09-19', y: 'legacy_daily', s: 1, e: 2, r: 'L' }, DEV_A).i, 'L-d-2026-09-19');
});
ok('verifyChain: 100 ok; tamper → badAt; delete → gapAt; missing genesis → partial', () => {
  const r = chain(DEV_A, 100);
  assert.equal(E.verifyChain(DEV_A, r.ev).ok, true); assert.equal(E.verifyChain(DEV_A, r.ev).verified, 100);
  const t = r.ev.map(e => ({ ...e })); t[40].a += 1;
  const v1 = E.verifyChain(DEV_A, t); assert.equal(v1.ok, false); assert.equal(v1.badAt, 41);
  const d = r.ev.filter(e => e.q !== 50); const v2 = E.verifyChain(DEV_A, d); assert.equal(v2.gapAt, 50);
  const p = E.verifyChain(DEV_A, r.ev.slice(10)); assert.equal(p.partial, true); assert.equal(p.ok, false);
});
// 5. mergeReplica
ok('mergeReplica: union by id, sorted, idempotent, never shrinks own, rcv filled, n/head not reduced', () => {
  const a5 = chain(DEV_A, 5), a3 = { ...a5, ev: a5.ev.slice(0, 3), n: 3, head: a5.ev[2].h };
  const m1 = E.mergeReplica(a3, a5); assert.equal(m1.replica.ev.length, 5); assert.equal(m1.replica.n, 5); assert.equal(m1.replica.head, a5.head); assert.equal(m1.changed, true);
  const m2 = E.mergeReplica(a5, a3); assert.equal(m2.replica.ev.length, 5); assert.equal(m2.replica.n, 5); assert.equal(m2.changed, false);
  const m3 = E.mergeReplica(m1.replica, a5); assert.equal(m3.changed, false);
  const withRcv = a5.ev.map(e => ({ ...e, rcv: 1758700000 }));
  const m4 = E.mergeReplica(a5, withRcv); assert.equal(m4.changed, true); assert.ok(m4.replica.ev.every(e => e.rcv === 1758700000));
  const junk = E.mergeReplica(a5, [{ i: 'bad' }, null, { ...a5.ev[0], h: 'zz' }]); assert.equal(junk.replica.ev.length, 5);
  const shuffled = E.mergeReplica(null, [a5.ev[3], a5.ev[1], a5.ev[0]]); deq([...shuffled.replica.ev.map(e => e.q)], [1, 2, 4]);
});
// 6. rollArchive / allEvents
ok('rollArchive moves old events out of hot window; allEvents unions with device tag', () => {
  const a = chain(DEV_A, 6), b = chain(DEV_B, 2, 1758900000);
  const cut = 1758600000 + 3 * 600;  // 처음 3개(e < cut)만 이동
  const { replicas, archive, moved } = E.rollArchive({ [DEV_A]: a, [DEV_B]: b }, [], cut);
  assert.equal(moved, 3); assert.equal(replicas[DEV_A].ev.length, 3); assert.equal(replicas[DEV_A].n, 6); assert.equal(replicas[DEV_A].head, a.head);
  assert.equal(archive.length, 3); assert.ok(archive.every(e => e.d === DEV_A));
  const again = E.rollArchive(replicas, archive, cut); assert.equal(again.archive.length, 3);
  const all = E.allEvents(replicas, archive); assert.equal(all.length, 8); assert.equal(all.filter(e => e.d === DEV_B).length, 2);
  assert.equal(E.verifyChain(DEV_A, E.eventsOfDevice(all, DEV_A)).ok, true);
});
// 7. act accumulator
ok('act: idle cap, pause/resume, ticks do not double count, end rounding', () => {
  let t = 1_000_000; const a = E.actNew('synfeed', { p: 2 }, t);
  E.actTouch(a, t += 10_000); E.actTouch(a, t += 20_000);            // 30s
  E.actTouch(a, t += 300_000);                                         // 5분 방치 → 60s만 인정
  assert.equal(a.a, 90_000);
  E.actAccrue(a, t += 10_000); E.actAccrue(a, t += 10_000); E.actTouch(a, t += 10_000);   // 30s 안에 tick 2번 + touch → 30s
  assert.equal(a.a, 120_000);
  E.actPause(a, t += 5_000); E.actTouch(a, t += 100_000); E.actResume(a, t += 100_000); E.actTouch(a, t += 5_000);
  assert.equal(a.a, 130_000);                                          // pause 전 5s + resume 후 5s
  E.actCount(a, true); E.actCount(a, false);
  const f = E.actEnd(a, t += 2_000, { k: 'x', m: { rt: 3 } }, Z);
  assert.equal(f.a, 132); assert.equal(f.n, 2); assert.equal(f.c, 1); assert.equal(f.k, 'x'); deq(f.m, { p: 2, rt: 3 }); assert.equal(f.z, Z);
  assert.equal(E.actNew('read', {}, 0).idle, 120_000); assert.equal(E.actNew('exam', {}, 0).idle, 180_000); assert.equal(E.actNew('flash_new', {}, 0).idle, 60_000);
});
// 8. legacyImport
const legacySrc = {
  daily: { '2026-09-17': { studied: 30, correct: 20, seconds: 900 }, '2026-09-19': { studied: 40, correct: 30, seconds: 1200, new_learned: 5 }, '2026-09-21': { studied: 0, correct: 0, seconds: 0 } },
  dayStats: { '2026-09-19': { WK: 12, VA: 3 }, '2026-09-20': { WK: 8 } }, synDays: { '2026-09-20': { n: 60, c: 41 } }, vaDays: {}, apExposure: { '2026-09-22': 25 },
  examHist: [{ key: 'wk', name: '단어 시험', ts: Date.UTC(2026, 8, 20, 3) , got: 18, total: 25, secs: 280, bySec: { WK: { got: 18, total: 25 } } },
    { key: 'mock_1', name: '기출 1', ts: Date.UTC(2026, 8, 17, 3), got: 90, total: 145, secs: 5000 },
    { key: 'retest', name: '오답 재시험', ts: Date.UTC(2026, 8, 22, 3), got: 5, total: 9, secs: 100, practice: 1 }]
};
ok('legacyImport: deterministic ids, window [attempt, install), idempotent, flags kept', () => {
  const ev = E.legacyImport(legacySrc, { attemptDate: '2026-09-18', installDay: '2026-09-23', z: Z });
  const ids = ev.map(e => e.i);
  deq(ids, ['L-d-2026-09-19', 'L-d-2026-09-20', 'L-d-2026-09-22', 'L-x-' + Date.UTC(2026, 8, 20, 3), 'L-x-' + Date.UTC(2026, 8, 22, 3)]);
  deq(E.legacyImport(legacySrc, { attemptDate: '2026-09-18', installDay: '2026-09-23', z: Z }).map(e => e.i), ids);
  const d19 = ev[0]; assert.equal(d19.a, 1200); assert.equal(d19.n, 40); deq(d19.m.ds, { WK: 12, VA: 3 }); assert.equal(d19.m.nl, 5); assert.equal(d19.r, 'L');
  assert.equal(ev[1].m.sf, 60); assert.equal(ev[2].m.ap, 25);
  const x = ev[3]; assert.equal(x.y, 'legacy_exam'); assert.equal(x.sc, 18); assert.equal(x.t, 25); assert.equal(x.m.kd, 'preset'); deq(x.m.bs, { WK: [18, 25] });
  assert.equal(ev[4].m.pr, 1); assert.equal(ev[4].m.kd, 'retest');
  assert.equal(E.legacyImport(legacySrc, { attemptDate: 'bad', installDay: '2026-09-23' }).length, 0);
});
// 9. aggregate (두 기기 합산 · legacy 중복 · live 우선 · 기간 필터)
ok('aggregate: two devices add up, legacy dedupe, live day overrides legacy, period filter', () => {
  const ra = E.newReplica(), rb = E.newReplica(), tag = '2026-09-23T00:00:00Z';
  const leg = E.legacyImport(legacySrc, { attemptDate: '2026-09-18', installDay: '2026-09-23', z: Z });
  for (const f of leg) E.appendEvent(ra, E.makeEvent(ra, f, DEV_A), tag);
  for (const f of leg) E.appendEvent(rb, E.makeEvent(rb, f, DEV_B), tag);          // 양쪽 모두 재구성 → 1회만 집계
  const d20 = E.daySec('2026-09-20', Z) + 3600 * 10;                                 // 9/20 live 이벤트 → 그날 legacy_daily 무시
  E.appendEvent(ra, E.makeEvent(ra, { y: 'synfeed', s: d20, e: d20 + 600, z: Z, a: 500, n: 50, c: 40 }, DEV_A), tag);
  E.appendEvent(rb, E.makeEvent(rb, { y: 'flash_review', s: d20 + 700, e: d20 + 1300, z: Z, a: 550, n: 20, c: 18 }, DEV_B), tag);
  E.appendEvent(rb, E.makeEvent(rb, { y: 'exam', s: d20 + 2000, e: d20 + 2600, z: Z, a: 580, n: 25, c: 21, k: 'wk', sc: 21, t: 25, m: { kd: 'preset', ts: 777, cs: 600, nm: '단어 시험' } }, DEV_B), tag);
  E.appendEvent(ra, E.makeEvent(ra, { y: 'snapshot', s: d20, e: d20, z: Z, m: { L: 1200, M: 300, V: 50, W: 40 } }, DEV_A), tag);
  const all = E.allEvents({ [DEV_A]: ra, [DEV_B]: rb }, []);
  const agg = E.aggregate(all, { from: '2026-09-18', to: '2026-09-23' });
  const byDay = Object.fromEntries(agg.days.map(d => [d.day, d]));
  assert.equal(byDay['2026-09-19'].active, 1200); assert.equal(byDay['2026-09-19'].reconstructed, true);
  assert.equal(byDay['2026-09-20'].active, 500 + 550 + 580 + 280);   // legacy_exam(280s)은 daily.seconds에 없던 시간이라 별도 가산 assert.equal(byDay['2026-09-20'].reconstructed, false); deq(byDay['2026-09-20'].devices, [DEV_A, DEV_B]);
  assert.equal(byDay['2026-09-20'].sessions, 4); assert.equal(byDay['2026-09-20'].best, 84);
  assert.equal(agg.exams.length, 3); assert.equal(agg.totals.mockExams, 2);        // legacy wk + live wk (retest practice 제외)
  assert.equal(agg.snapshots.length, 1); assert.equal(agg.snapshots[0].L, 1200);
  assert.equal(E.aggregate(all, { from: '2026-09-21', to: '2026-09-23' }).days.length, 1);
  assert.equal(agg.weeks.length, 2);
});
// 10. CSV
ok('CSV: BOM, quoting, CRLF, headers', () => {
  const csv = E.toCSV([['a', 'b'], ['x,y', 'say "hi"\nnew']]);
  assert.ok(csv.startsWith('﻿a,b\r\n')); assert.ok(csv.includes('"x,y","say ""hi""\nnew"\r\n'));
  const r = chain(DEV_A, 2);
  const s = E.csvSessions({ [DEV_A]: r }, [], { [r.ev[0].i]: 1758700000 });
  const lines = s.split('\r\n'); assert.equal(lines[0], '﻿event_id,device,type,type_label,start_local,end_local,tz,active_min,items,correct,accuracy,key,score,total,kind,src,recovered,late_upload,note,hash');
  assert.equal(lines.length, 4); assert.ok(lines[1].endsWith(r.ev[0].h)); assert.ok(lines[1].includes('UTC+09'));
});
// 11. buildReport — 비밀 미포함 · 백분위 없음 · 기간
ok('buildReport/renderHTML/csv never leak sentinels; no percentile; period from attempt date', () => {
  const ra = chain(DEV_A, 3, Math.round(Date.UTC(2026, 8, 22, 1) / 1000));
  const input = { replicas: { [DEV_A]: ra, SECRET_KEY: { ev: [], n: 0 } }, archive: [], recv: {}, settings: { official_attempt_date: '2026-09-18', retest_date: '2026-11-20', official_scores: 'Pilot 45 · Verbal 52', ev_since: '2026-09-23', synFeedSyncCode: 'SECRET_CODE' },
    counts: { learned: 1500, mastered: 400, verified: 100, remaining: 3100, total: 4678 }, version: '4.150.0', deviceId: DEV_A, now: Date.UTC(2026, 8, 23, 3), tz: Z, sb_key: 'SECRET_SB' };
  const rep = E.buildReport(input);
  assert.equal(rep.period.from, '2026-09-18'); assert.equal(rep.period.to, '2026-09-23'); assert.equal(rep.period.days, 6);
  assert.equal(rep.summary.sessions, 3); assert.equal(rep.devices.length, 2); assert.equal(rep.devices[0].verify.ok, true);
  const blob = JSON.stringify(rep) + E.renderHTML(rep) + E.summaryText(rep) + E.csvDaily(rep) + E.csvExams(rep) + E.csvSessions(input.replicas, [], {});
  for (const s of ['SECRET_CODE', 'SECRET_SB']) assert.equal(blob.includes(s), false, 'leaked ' + s);
  assert.equal(/percentile|백분위\s*\d|pctile/i.test(E.renderHTML(rep).replace(/Percentile estimates.*?않습니다\./s, '')), false);
  assert.ok(E.renderHTML(rep).includes('AFOQT Study Evidence Report') && E.renderHTML(rep).includes('Methodology'));
  assert.ok(E.renderHTML({ ...rep, days: [], exams: [], devices: [] }).includes('No activity'));
});
// 12. 배선
ok('wiring: script order, sw ASSETS, schema study_log policies are insert/select only', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('./evidence.js') > html.indexOf('./study-export.js') && html.indexOf('./evidence.js') < html.indexOf('./app.js'), 'evidence.js must load after study-export.js and before app.js');
  assert.ok(readFileSync(new URL('../sw.js', import.meta.url), 'utf8').includes('"./evidence.js"'));
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  assert.ok(/create table if not exists public\.study_log/.test(sql));
  const pol = [...sql.matchAll(/create policy "[^"]+" on public\.study_log\s+for (\w+)/g)].map(m => m[1]);
  deq(pol.sort(), ['insert', 'select']);
  assert.ok(/received_at\s*:=\s*now\(\)/.test(sql));
});
console.log(`Evidence: ${passed} groups passed`);
