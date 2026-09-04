#!/usr/bin/env node

import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const appPath = resolve(repoRoot, "app.js");

class MemoryStorage {
  #data = new Map();

  getItem(key) {
    return this.#data.has(String(key)) ? this.#data.get(String(key)) : null;
  }

  setItem(key, value) {
    this.#data.set(String(key), String(value));
  }

  removeItem(key) {
    this.#data.delete(String(key));
  }

  clear() {
    this.#data.clear();
  }
}

function loadHarness() {
  const source = readFileSync(appPath, "utf8");
  const closeAt = source.lastIndexOf("\n})();");
  assert.notEqual(closeAt, -1, "app.js IIFE closing marker not found");

  // Export only through an in-memory instrumentation suffix. app.js on disk is
  // never rewritten, and every assertion below exercises its real functions.
  const expose = `
const __harnessToast = toast;
const __harnessForegroundPull = pullSynFeedOnForeground;
Object.assign(globalThis.__synfeedHarness, {
  LS,
  DEFAULT_STATE,
  clearSynFeedEmergency,
  compareSynFeedCandidates,
  flushSynFeedKeepalive,
  guardSynFeedNewRun,
  latestSynFeedSession,
  loadLocal,
  mergeSynFeedReplica,
  queueSynFeedReplica,
  refreshSynFeedSession,
  repairSynFeedSession,
  restoreSynFeedEmergency,
  saveNow,
  saveSynFeedEmergency,
  synFeedEmergencyKey,
  synFeedRunId,
  synFeedSave,
  getState: () => state,
  setState: value => { state = value; },
  getSynFeed: () => synFeed,
  setSynFeed: value => { synFeed = value; },
  setWords: value => {
    WORDS = value;
    WMAP = new Map(WORDS.map(word => [word.id, word]));
    synFeedPosIndex = null;
  },
  setForegroundPull: value => { pullSynFeedOnForeground = value; },
  setToast: value => { toast = value; },
  setSyncRuntime: value => {
    if (Object.hasOwn(value, "sb")) sb = value.sb;
    if (Object.hasOwn(value, "syncReady")) syncReady = value.syncReady;
    if (Object.hasOwn(value, "syncInitialSettled")) syncInitialSettled = value.syncInitialSettled;
    if (Object.hasOwn(value, "syncInitializing")) syncInitializing = value.syncInitializing;
    if (Object.hasOwn(value, "forceSyncRunning")) forceSyncRunning = value.forceSyncRunning;
    if (Object.hasOwn(value, "pullRetryInFlight")) pullRetryInFlight = value.pullRetryInFlight;
    if (Object.hasOwn(value, "synFeedForegroundPullInFlight")) synFeedForegroundPullInFlight = value.synFeedForegroundPullInFlight;
    if (Object.hasOwn(value, "synFeedLastPullAt")) synFeedLastPullAt = value.synFeedLastPullAt;
    if (Object.hasOwn(value, "synFeedRemoteFresh")) synFeedRemoteFresh = value.synFeedRemoteFresh;
    if (Object.hasOwn(value, "syncSessionCode")) syncSessionCode = value.syncSessionCode;
    if (Object.hasOwn(value, "syncSessionUrl")) syncSessionUrl = value.syncSessionUrl;
    if (Object.hasOwn(value, "syncSessionKey")) syncSessionKey = value.syncSessionKey;
    if (Object.hasOwn(value, "syncSessionImportMark")) syncSessionImportMark = value.syncSessionImportMark;
    if (Object.hasOwn(value, "syncCodeMismatch")) syncCodeMismatch = value.syncCodeMismatch;
    if (Object.hasOwn(value, "suppressPersistenceForReload")) suppressPersistenceForReload = value.suppressPersistenceForReload;
  },
  resetSyncRuntime: () => {
    clearTimeout(saveTimer); saveTimer = null;
    clearTimeout(pushTimer); pushTimer = null; pushDueAt = 0;
    clearTimeout(pullRetryTimer); pullRetryTimer = null;
    sb = null; syncReady = false; syncInitialSettled = false;
    syncInitializing = false; forceSyncRunning = false;
    pullRetryInFlight = null; synFeedForegroundPullInFlight = null;
    synFeedLastPullAt = 0; synFeedRemoteFresh = false;
    syncSessionCode = ""; syncSessionUrl = ""; syncSessionKey = "";
    syncSessionImportMark = ""; syncCodeMismatch = false;
    suppressPersistenceForReload = false;
    pushInFlight = null; pushRetryCount = 0; pushRetryAt = 0;
    pushQ.vocab_state.clear(); pushQ.verbal_progress.clear();
    pushQ.daily_log.clear(); pushQ.settings = null; pushQ.app_state = null;
    toast = __harnessToast;
    pullSynFeedOnForeground = __harnessForegroundPull;
  }
});
`;
  const instrumented = source.slice(0, closeAt) + expose + source.slice(closeAt);
  const localStorage = new MemoryStorage();
  const document = {
    visibilityState: "visible",
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const context = {
    AbortController,
    clearInterval,
    clearTimeout,
    console,
    crypto: webcrypto,
    Date,
    document,
    fetch: async () => { throw new Error("network disabled in synfeed test"); },
    JSON,
    localStorage,
    Map,
    Math,
    navigator: {},
    Set,
    setInterval,
    setTimeout,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URL,
    __synfeedHarness: {}
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: appPath, timeout: 5_000 });
  return {
    api: context.__synfeedHarness,
    localStorage,
    setFetch(value) { context.fetch = value; }
  };
}

const { api, localStorage, setFetch } = loadHarness();
const OWN_DEVICE = "afd-11111111111111111111";
const PC_DEVICE = "afd-22222222222222222222";
const MOBILE_DEVICE = "afd-33333333333333333333";
const RUN_A = "sfr-aaaaaaaaaaaaaaaaaaaa";
const RUN_B = "sfr-bbbbbbbbbbbbbbbbbbbb";
const RUN_C = "sfr-cccccccccccccccccccc";

function plain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function words(ids) {
  return ids.map(id => ({
    id,
    word: `word-${id}`,
    kor: `뜻-${id}`,
    pos: "adjective",
    verbalPriority: 2,
    synonyms: [`synonym-${id}`]
  }));
}

function session({
  count = 0,
  cursor = 0,
  queue = [1, 2, 3, 4, 5, 6, 7, 8],
  runId,
  runEpoch,
  replaces,
  startedAt = "2026-09-05T00:00:00.000Z",
  updatedAt = "2026-09-05T00:00:00.000Z"
} = {}) {
  const value = {
    v: 1,
    priority: 2,
    queue: [...queue],
    cursor,
    cycle: 1,
    retry: [],
    recent: [],
    count,
    correct: Math.floor(count * 0.8),
    combo: 0,
    bestCombo: Math.min(count, 7),
    points: count * 10,
    added: 0,
    seed: 12345,
    answerSlots: [],
    lastAnswerSlot: null,
    current: null,
    startedAt,
    updatedAt
  };
  if (runId !== undefined) value.runId = runId;
  if (runEpoch !== undefined) value.runEpoch = runEpoch;
  if (replaces !== undefined) value.replaces = [...replaces];
  return value;
}

function replica(feedSession, {
  clock = 1,
  rev = clock,
  updatedAt = "2026-09-05T00:00:00.000Z",
  total = feedSession?.count || 0
} = {}) {
  return {
    v: 1,
    rev,
    stats: { total, correct: Math.min(total, feedSession?.correct || 0), bestCombo: 0, days: {} },
    checkpoint: { rev, clock, updatedAt, session: feedSession },
    updated_at: updatedAt
  };
}

function reset({ pool = [1, 2, 3, 4, 5, 6, 7, 8] } = {}) {
  api.resetSyncRuntime();
  localStorage.clear();
  localStorage.setItem(api.LS.device, OWN_DEVICE);
  localStorage.setItem(api.LS.code, "afq-shared-test-code");
  api.setWords(words(pool));
  const next = api.DEFAULT_STATE();
  next.synFeedReplicaVersion = 1;
  next.synFeedSyncCode = "afq-shared-test-code";
  next.synFeedReplicas = {};
  api.setState(next);
  api.setSynFeed(null);
  return next;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("stale active background save cannot rewind a farther device", () => {
  const state = reset();
  const stale = session({ count: 12, cursor: 4, runId: RUN_A, runEpoch: 40 });
  const farther = session({
    count: 18,
    cursor: 2,
    runId: RUN_A,
    runEpoch: 40,
    updatedAt: "2026-09-05T00:00:05.000Z"
  });
  state.synFeedReplicas[OWN_DEVICE] = replica(stale, { clock: 900, rev: 900 });
  state.synFeedReplicas[MOBILE_DEVICE] = replica(farther, { clock: 80, rev: 80 });
  state.synFeedSession = plain(stale);
  api.setSynFeed(plain(stale));

  // This is the exact hidden/background save path: persist locally without
  // claiming a new logical checkpoint clock.
  api.synFeedSave(true, false, false);
  assert.equal(api.getState().synFeedReplicas[OWN_DEVICE].checkpoint.clock, 900);

  const result = api.refreshSynFeedSession(true);
  assert.equal(result.activeChanged, true);
  assert.equal(api.getSynFeed().count, 18);
  assert.equal(api.getSynFeed().runId, RUN_A);
});

test("legacy clock ties select maximum monotonic progress", () => {
  const state = reset();
  const staleButNewerWallClock = session({
    count: 41,
    cursor: 1,
    startedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-09-05T00:10:00.000Z"
  });
  const fartherButOlderWallClock = session({
    count: 67,
    cursor: 3,
    startedAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z"
  });
  // Legacy sessions have neither runId nor runEpoch. Initial migrations can
  // also give both replicas the same logical clock.
  state.synFeedReplicas[PC_DEVICE] = replica(staleButNewerWallClock, {
    clock: 1,
    rev: 99,
    updatedAt: "2026-09-05T00:10:00.000Z"
  });
  state.synFeedReplicas[MOBILE_DEVICE] = replica(fartherButOlderWallClock, {
    clock: 1,
    rev: 1,
    updatedAt: "2026-09-05T00:00:00.000Z"
  });

  const winner = api.latestSynFeedSession();
  assert.equal(winner.count, 67);
  assert.match(api.synFeedRunId(winner), /^legacy:/);
});

test("a late high-progress legacy device beats an empty-server first run", () => {
  const state = reset();
  const firstRun = session({ count: 0, runId: RUN_B, runEpoch: 0 });
  const delayedLegacy = session({
    count: 500,
    cursor: 4,
    startedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z"
  });
  state.synFeedReplicas[MOBILE_DEVICE] = replica(firstRun, { clock: 1, rev: 1 });
  state.synFeedReplicas[PC_DEVICE] = replica(delayedLegacy, { clock: 900, rev: 900 });
  assert.equal(api.latestSynFeedSession().count, 500);
  assert.match(api.synFeedRunId(api.latestSynFeedSession()), /^legacy:/);
});

test("an intentional new run supersedes a high-progress old run", () => {
  const state = reset();
  const oldRun = session({ count: 750, cursor: 6, runId: RUN_A, runEpoch: 120 });
  const explicitReset = session({
    count: 0,
    cursor: 0,
    runId: RUN_B,
    runEpoch: 121,
    replaces: [RUN_A],
    startedAt: "2026-09-05T01:00:00.000Z",
    updatedAt: "2026-09-05T01:00:00.000Z"
  });
  state.synFeedReplicas[PC_DEVICE] = replica(oldRun, { clock: 900, rev: 900 });
  state.synFeedReplicas[MOBILE_DEVICE] = replica(explicitReset, { clock: 121, rev: 121 });

  assert.equal(api.latestSynFeedSession().runId, RUN_B);

  // runEpoch remains authoritative even after the bounded `replaces` ancestry
  // has rolled off after several explicit resets.
  const epochOnly = session({ count: 0, runId: RUN_B, runEpoch: 122 });
  const comparison = api.compareSynFeedCandidates(
    { id: MOBILE_DEVICE, session: epochOnly, clock: 122, rev: 122 },
    { id: PC_DEVICE, session: oldRun, clock: 999, rev: 999 }
  );
  assert.ok(comparison > 0, "higher runEpoch must beat old accumulated count and clock");
});

test("run ordering is stable regardless of replica arrival order", () => {
  const candidates = [
    [PC_DEVICE, session({ count: 100, runId: RUN_A, runEpoch: 10 })],
    [MOBILE_DEVICE, session({ count: 0, runId: RUN_B, runEpoch: 0, replaces: [RUN_A] })],
    [OWN_DEVICE, session({ count: 50, runId: RUN_C, runEpoch: 5 })]
  ];
  const orders = [
    candidates,
    [candidates[0], candidates[2], candidates[1]],
    [candidates[1], candidates[2], candidates[0]],
    [...candidates].reverse()
  ];
  for (const order of orders) {
    const state = reset();
    state.synFeedReplicas = Object.fromEntries(order.map(([id, feed]) => [id, replica(feed, { clock: feed.runEpoch || 1 })]));
    assert.equal(api.latestSynFeedSession().runId, RUN_A);
  }
});

test("changing the sync code isolates old local and emergency checkpoints", () => {
  reset();
  const oldFeed = session({ count: 88, cursor: 3, runId: RUN_A, runEpoch: 20 });
  const stored = api.DEFAULT_STATE();
  stored.synFeedReplicaVersion = 1;
  stored.synFeedSyncCode = "afq-old-code";
  stored.synFeedSession = oldFeed;
  stored.synFeedStats = { total: 88, correct: 70, bestCombo: 12, days: {} };
  stored.synFeedReplicas = { [OWN_DEVICE]: replica(oldFeed, { clock: 20, rev: 20 }) };
  localStorage.setItem(api.LS.state, JSON.stringify(stored));
  localStorage.setItem(api.LS.code, "afq-new-code");
  localStorage.setItem(api.LS.synfeed, JSON.stringify({
    v: 1,
    code: "afq-old-code",
    deviceId: OWN_DEVICE,
    replica: replica(oldFeed, { clock: 20, rev: 20 }),
    savedAt: "2026-09-05T00:00:00.000Z"
  }));

  api.loadLocal();
  const loaded = api.getState();
  assert.equal(loaded.synFeedSyncCode, "afq-new-code");
  assert.equal(loaded.synFeedSession, null);
  assert.deepEqual(plain(loaded.synFeedReplicas), {});
  assert.equal(loaded.synFeedStats.total, 0);
  assert.notEqual(localStorage.getItem(api.LS.synfeed), null, "another code's legacy emergency must remain recoverable");

  localStorage.setItem(api.LS.code, "afq-old-code");
  api.loadLocal();
  assert.equal(api.latestSynFeedSession().count, 88);
  assert.notEqual(localStorage.getItem(api.synFeedEmergencyKey("afq-old-code")), null);
  assert.equal(localStorage.getItem(api.LS.synfeed), null, "matching legacy emergency should migrate to its namespaced key");
});

test("an import handoff blocks a stale tab save before its storage event", () => {
  localStorage.clear();
  localStorage.setItem(api.LS.device, OWN_DEVICE);
  localStorage.setItem(api.LS.code, "afq-shared-test-code");
  localStorage.setItem(api.LS.import, "old-import-marker");
  const stored = api.DEFAULT_STATE();
  stored.synFeedReplicaVersion = 1;
  stored.synFeedSyncCode = "afq-shared-test-code";
  localStorage.setItem(api.LS.state, JSON.stringify(stored));
  api.loadLocal();
  const before = localStorage.getItem(api.LS.state);

  api.getState().rootStep = 999;
  localStorage.setItem(api.LS.import, "new-import-marker");
  api.saveNow();
  assert.equal(localStorage.getItem(api.LS.state), before);
});

test("new-run freshness gate requires a recent successful remote check", () => {
  reset();
  localStorage.setItem(api.LS.url, "https://example.supabase.co");
  localStorage.setItem(api.LS.key, "test-anon-key");
  api.setToast(() => {});
  let foregroundPulls = 0;
  api.setForegroundPull(() => {
    foregroundPulls += 1;
    return Promise.resolve(true);
  });
  api.setSyncRuntime({
    sb: {},
    syncReady: true,
    syncInitialSettled: true,
    syncInitializing: false,
    forceSyncRunning: false,
    pullRetryInFlight: null,
    synFeedForegroundPullInFlight: null,
    syncSessionCode: "afq-shared-test-code",
    syncSessionUrl: "https://example.supabase.co",
    syncSessionKey: "test-anon-key",
    syncSessionImportMark: "",
    synFeedRemoteFresh: false,
    synFeedLastPullAt: Date.now()
  });

  assert.equal(api.guardSynFeedNewRun(), false, "no successful feed pull must block reset");
  assert.equal(foregroundPulls, 0, "the not-fresh state is blocked before accepting a reset");

  api.setSyncRuntime({ synFeedRemoteFresh: true, synFeedLastPullAt: 0 });
  assert.equal(api.guardSynFeedNewRun(), false, "an expired freshness window must block reset");
  assert.equal(foregroundPulls, 1, "an expired window must trigger a foreground pull");

  api.setSyncRuntime({ synFeedRemoteFresh: true, synFeedLastPullAt: Date.now() });
  assert.equal(api.guardSynFeedNewRun(), true, "a recent successful pull may open a new run");
  assert.equal(foregroundPulls, 1);
});

test("keepalive cannot upload before a successful pull marks sync ready", () => {
  const state = reset();
  const feed = session({ count: 23, cursor: 7, runId: RUN_A, runEpoch: 30 });
  state.synFeedReplicas[OWN_DEVICE] = replica(feed, { clock: 30, rev: 30 });
  state.synFeedSession = plain(feed);
  localStorage.setItem(api.LS.url, "https://example.supabase.co");
  localStorage.setItem(api.LS.key, "test-anon-key");
  api.setSyncRuntime({
    sb: {},
    syncReady: false,
    syncInitialSettled: false,
    syncSessionCode: "afq-shared-test-code",
    syncSessionUrl: "https://example.supabase.co",
    syncSessionKey: "test-anon-key",
    syncSessionImportMark: "",
    syncCodeMismatch: false,
    suppressPersistenceForReload: false
  });

  const requests = [];
  setFetch((url, options) => {
    requests.push({ url, options });
    return Promise.resolve({ ok: true });
  });
  api.queueSynFeedReplica();
  api.flushSynFeedKeepalive();
  assert.equal(requests.length, 0, "pre-pull local data must never be sent with keepalive");

  // initSync/retryInitialPull set this flag only after pullAll succeeds.
  api.setSyncRuntime({ syncReady: true, syncInitialSettled: true });
  api.flushSynFeedKeepalive();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.keepalive, true);
  const uploaded = JSON.parse(requests[0].options.body);
  assert.equal(uploaded.user_key, "afq-shared-test-code");
  assert.equal(uploaded.data.checkpoint.session.count, 23);
});

test("emergency checkpoints round-trip independently for each sync code", () => {
  const state = reset();
  const codeA = "afq-code-a";
  const codeB = "afq-code-b";
  const feedA = session({ count: 31, cursor: 7, runId: RUN_A, runEpoch: 31 });
  const feedB = session({ count: 64, cursor: 0, runId: RUN_B, runEpoch: 64 });

  const bind = code => {
    localStorage.setItem(api.LS.code, code);
    api.setSyncRuntime({
      syncSessionCode: code,
      syncSessionUrl: "",
      syncSessionKey: "",
      syncSessionImportMark: "",
      syncCodeMismatch: false,
      suppressPersistenceForReload: false
    });
  };
  bind(codeA);
  state.synFeedReplicas[OWN_DEVICE] = replica(feedA, { clock: 31, rev: 31 });
  api.saveSynFeedEmergency();
  bind(codeB);
  state.synFeedReplicas[OWN_DEVICE] = replica(feedB, { clock: 64, rev: 64 });
  api.saveSynFeedEmergency();

  const keyA = api.synFeedEmergencyKey(codeA);
  const keyB = api.synFeedEmergencyKey(codeB);
  assert.notEqual(keyA, keyB);
  assert.equal(JSON.parse(localStorage.getItem(keyA)).code, codeA);
  assert.equal(JSON.parse(localStorage.getItem(keyB)).code, codeB);

  const restore = code => {
    const empty = api.DEFAULT_STATE();
    empty.synFeedReplicaVersion = 1;
    empty.synFeedSyncCode = code;
    empty.synFeedReplicas = {};
    api.setState(empty);
    api.setSynFeed(null);
    bind(code);
    assert.equal(api.restoreSynFeedEmergency(code), true);
    return api.latestSynFeedSession();
  };
  assert.equal(restore(codeA).count, 31);
  assert.equal(restore(codeB).count, 64);

  api.clearSynFeedEmergency(codeA);
  assert.equal(localStorage.getItem(keyA), null);
  assert.notEqual(localStorage.getItem(keyB), null, "clearing code A must preserve code B's recovery point");
});

test("pool additions/removals repair the queue without losing accumulated work", () => {
  reset({ pool: [1, 3, 4, 6, 7, 8] });
  const old = session({ count: 81, cursor: 4, queue: [1, 2, 3, 4, 5, 6], runId: RUN_A, runEpoch: 10 });
  old.recent = [2, 5, 6];
  old.retry = [{ id: 2, dueAt: 85 }, { id: 5, dueAt: 86 }, { id: 6, dueAt: 87 }];
  old.current = { id: 5 }; // Removed from the updated word pool.

  const repaired = api.repairSynFeedSession(old);
  assert.ok(repaired);
  assert.deepEqual(plain(repaired.queue), [1, 3, 4, 6, 7, 8]);
  assert.equal(repaired.cursor, 3);
  assert.equal(repaired.queue[repaired.cursor], 6);
  assert.equal(repaired.current, null);
  assert.deepEqual(plain(repaired.recent), [6]);
  assert.deepEqual(plain(repaired.retry), [{ id: 6, dueAt: 87 }]);
  assert.equal(repaired.count, 81);
  assert.equal(repaired.correct, old.correct);
  assert.equal(repaired.points, old.points);

  // If an already-answered current question becomes invalid after synonym data
  // changes, repair advances exactly once instead of making it reappear.
  const changedOptions = session({
    count: 82,
    cursor: 2,
    queue: [1, 3, 4, 6, 7, 8],
    runId: RUN_A,
    runEpoch: 10
  });
  changedOptions.current = { id: 4, isRetry: false, chosen: 0 };
  const afterOptionChange = api.repairSynFeedSession(changedOptions);
  assert.ok(afterOptionChange);
  assert.equal(afterOptionChange.current, null);
  assert.equal(afterOptionChange.cursor, 3);
  assert.equal(afterOptionChange.queue[afterOptionChange.cursor], 6);
  assert.equal(afterOptionChange.count, 82);

  // Removing the final pending item exhausts that cycle; start the next cycle
  // instead of moving the cursor backward onto an already completed word.
  api.setWords(words([1, 2, 3, 4, 5]));
  const removedAtEnd = session({ count: 83, cursor: 5, queue: [1, 2, 3, 4, 5, 6], runId: RUN_A, runEpoch: 10 });
  removedAtEnd.current = { id: 6 };
  const nextCycle = api.repairSynFeedSession(removedAtEnd);
  assert.ok(nextCycle);
  assert.equal(nextCycle.cycle, 2);
  assert.equal(nextCycle.cursor, 0);
  assert.deepEqual(plain(nextCycle.queue), [1, 2, 3, 4, 5]);
  assert.equal(nextCycle.count, 83);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

console.log(`\nSynonym-feed sync regression: ${passed}/${tests.length} passed`);
