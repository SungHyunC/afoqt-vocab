import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = { window: {} };
vm.runInNewContext(readFileSync(new URL('../study-export.js', import.meta.url), 'utf8'), context);
const { build, markdown } = context.window.AFOQTStudyExport;
const state = { synFeedSyncCode: 'SECRET', settings: { key: 'SECRET' }, synFeedReplicas: { SECRET: {} },
  examHist: [{ name: 'Mixed', got: 1, total: 4, items: [
    { s: 'WK', t: 'WORD', o: ['yes', 'no'], a: 0, u: 0, ms: 1200 },
    { s: 'RC', q: 'why?', p: 7, o: ['a', 'b'], a: 0, u: 1 },
    { s: 'RC', p: 'missing', o: ['a'], a: 0, u: null },
    { s: 'TR', o: ['a'], a: 0, u: 9 }
  ] }, { name: 'Summary only', got: 3, total: 10 }],
  wrong: { rc: { '7:0': 2 }, ar: { removed: 1 } }, cards: { 1: { lapses: 2 } },
  secAcc: { WK: { c: 2, w: 3 } }, speed: { WK: { n: 1, ms: 1200 } } };
const pools = { rc: [{ id: 7, passage: 'Passage ``` with text', questions: [{ q: 'why?' }] }], wk: [{ id: 1, word: 'WORD' }] };
const before = JSON.stringify({ state, pools });
function freeze(x) { if(x && typeof x === 'object') { Object.freeze(x); Object.values(x).forEach(freeze); } }
freeze(state); freeze(pools);
const report = build(state, pools, 'test', '2026-09-08T00:00:00Z');
assert.equal(JSON.stringify({ state, pools }), before, 'export must not mutate any source');
assert.equal(JSON.stringify(report).includes('SECRET'), false);
assert.equal(report.summary.exams, 2);
assert.equal(report.summary.examsWithDetails, 1);
assert.equal(report.summary.detailedQuestions, 4);
const q = report.exams[0].questions;
assert.equal(q[0].result, 'correct'); assert.equal(q[0].selectedAnswer, 'yes');
assert.equal(q[1].result, 'incorrect'); assert.equal(q[1].passage, pools.rc[0].passage);
assert.equal(q[2].result, 'unanswered'); assert.equal(q[2].passage, null); assert.ok(q[2].contextNote);
assert.equal(q[3].result, 'unknown'); assert.ok(q[3].contextNote);
assert.equal(report.references.find(r => r.id === '7:0').content.id, 7);
assert.equal(report.references.find(r => r.id === 'removed').content, null);
assert.ok(markdown(report).includes('````json'));
report.aggregates.sectionAccuracy.WK.c = 999;
assert.equal(state.secAcc.WK.c, 2, 'export must be detached from live state');
assert.equal(build({}, {}, 'test').summary.detailedQuestions, 0);
// Boot wiring and offline availability.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(html.indexOf('./study-export.js') < html.indexOf('./app.js'));
assert.ok(readFileSync(new URL('../sw.js', import.meta.url), 'utf8').includes('"./study-export.js"'));
console.log('Study export: immutable data, privacy, answer mapping, missing context, references, empty state and offline wiring passed');
