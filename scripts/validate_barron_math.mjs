import fs from "node:fs";

const specs = [
  ["barron_style_arithmetic.json", "AR", "bmd_ar_"],
  ["barron_style_mathknowledge.json", "MK", "bmd_mk_"],
];
const fullSpecs = [
  ["barron_style_full_arithmetic.json", "AR", "bmd_ar_full_", 1740],
  ["barron_style_full_mathknowledge.json", "MK", "bmd_mk_full_", 1320],
];

const allIds = new Set();
const allPrompts = new Set();
const typeIdsBySection = {};
const promptKey = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
let failed = false;
const fail = message => { failed = true; console.error(`FAIL: ${message}`); };
const publicPrompts = new Set();
for (const path of ["arithmetic.json", "mathknowledge.json"]) {
  if (!fs.existsSync(path)) continue;
  try { for (const q of JSON.parse(fs.readFileSync(path, "utf8"))) publicPrompts.add(promptKey(q && q.q)); }
  catch (error) { fail(`${path}: could not check public-pool duplicates (${error.message})`); }
}

for (const [path, section, prefix] of specs) {
  if (!fs.existsSync(path)) { fail(`${path}: missing`); continue; }
  let data;
  try { data = JSON.parse(fs.readFileSync(path, "utf8")); }
  catch (error) { fail(`${path}: invalid JSON (${error.message})`); continue; }

  const types = Array.isArray(data.types) ? data.types : [];
  const questions = Array.isArray(data.questions) ? data.questions : [];
  if (data.version !== 1) fail(`${path}: version must be 1`);
  if (typeof data.notice !== "string" || !data.notice.trim()) fail(`${path}: notice is required`);
  if (types.length !== 6) fail(`${path}: expected 6 types, found ${types.length}`);
  if (questions.length !== 60) fail(`${path}: expected 60 questions, found ${questions.length}`);

  const typeIds = new Set();
  for (const type of types) {
    if (!type || typeof type.id !== "string" || !type.id) { fail(`${path}: invalid type id`); continue; }
    if (typeIds.has(type.id)) fail(`${path}: duplicate type ${type.id}`);
    typeIds.add(type.id);
    if (typeof type.name !== "string" || !type.name.trim()) fail(`${path}: ${type.id} needs a name`);
    if (typeof (type.description ?? type.desc) !== "string" || !(type.description ?? type.desc).trim())
      fail(`${path}: ${type.id} needs a description`);
  }
  typeIdsBySection[section] = typeIds;

  for (const typeId of typeIds) {
    const group = questions.filter(q => q && q.typeId === typeId);
    if (group.length !== 10) fail(`${path}: ${typeId} expected 10 questions, found ${group.length}`);
    const answerCounts = [0, 0, 0, 0, 0];
    for (const q of group) if (Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 5) answerCounts[q.answer]++;
    if (answerCounts.some(n => n !== 2)) fail(`${path}: ${typeId} answer positions are ${answerCounts.join(",")}, expected 2 each`);
  }

  for (const [index, q] of questions.entries()) {
    const where = `${path} question ${index + 1}`;
    if (!q || typeof q !== "object") { fail(`${where}: not an object`); continue; }
    if (q.section !== section) fail(`${where}: section must be ${section}`);
    if (!typeIds.has(q.typeId)) fail(`${where}: unknown typeId ${q.typeId}`);
    if (typeof q.id !== "string" || !q.id.startsWith(prefix)) fail(`${where}: invalid id ${q.id}`);
    else if (allIds.has(q.id)) fail(`${where}: duplicate global id ${q.id}`);
    else allIds.add(q.id);
    for (const field of ["topic", "q", "q_ko", "explain"])
      if (typeof q[field] !== "string" || !q[field].trim()) fail(`${where}: ${field} is required`);
    if (!Array.isArray(q.options) || q.options.length !== 5) fail(`${where}: exactly 5 options required`);
    else {
      const normalized = q.options.map(x => String(x).trim().toLowerCase());
      if (normalized.some(x => !x)) fail(`${where}: empty option`);
      if (new Set(normalized).size !== 5) fail(`${where}: duplicate options`);
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 4) fail(`${where}: answer must be 0..4`);
    const normalizedPrompt = promptKey(q.q);
    if (allPrompts.has(normalizedPrompt)) fail(`${where}: duplicate English prompt`);
    else allPrompts.add(normalizedPrompt);
  }

  console.log(`${path}: ${types.length} types, ${questions.length} questions`);
}

for (const [path, section, prefix, expectedSeconds] of fullSpecs) {
  if (!fs.existsSync(path)) { fail(`${path}: missing`); continue; }
  let data;
  try { data = JSON.parse(fs.readFileSync(path, "utf8")); }
  catch (error) { fail(`${path}: invalid JSON (${error.message})`); continue; }

  if (data.version !== 1) fail(`${path}: version must be 1`);
  if (data.section !== section) fail(`${path}: section must be ${section}`);
  if (typeof data.notice !== "string" || !data.notice.trim()) fail(`${path}: notice is required`);
  const sets = Array.isArray(data.sets) ? data.sets : [];
  if (sets.length !== 1) fail(`${path}: expected 1 fixed set, found ${sets.length}`);
  const setIds = new Set(), typeIds = typeIdsBySection[section] || new Set();

  for (const set of sets) {
    const where = `${path} set ${set && set.id || "?"}`;
    if (!set || typeof set !== "object") { fail(`${where}: not an object`); continue; }
    if (typeof set.id !== "string" || !set.id || setIds.has(set.id)) fail(`${where}: invalid or duplicate set id`);
    else setIds.add(set.id);
    for (const field of ["name", "name_ko", "description"])
      if (typeof set[field] !== "string" || !set[field].trim()) fail(`${where}: ${field} is required`);
    if (set.timeSeconds !== expectedSeconds) fail(`${where}: timeSeconds must be ${expectedSeconds}`);
    const questions = Array.isArray(set.questions) ? set.questions : [];
    if (questions.length !== 25) fail(`${where}: expected 25 questions, found ${questions.length}`);
    const answerCounts = [0, 0, 0, 0, 0], usedTypes = new Set(), wordCounts = [];

    for (const [index, q] of questions.entries()) {
      const qWhere = `${where} question ${index + 1}`;
      if (!q || typeof q !== "object") { fail(`${qWhere}: not an object`); continue; }
      if (q.section !== section) fail(`${qWhere}: section must be ${section}`);
      if (!typeIds.has(q.typeId)) fail(`${qWhere}: unknown typeId ${q.typeId}`); else usedTypes.add(q.typeId);
      if (typeof q.id !== "string" || !q.id.startsWith(prefix)) fail(`${qWhere}: invalid id ${q.id}`);
      else if (allIds.has(q.id)) fail(`${qWhere}: duplicate global id ${q.id}`);
      else allIds.add(q.id);
      for (const field of ["topic", "q", "q_ko", "explain"])
        if (typeof q[field] !== "string" || !q[field].trim()) fail(`${qWhere}: ${field} is required`);
      if (!Array.isArray(q.options) || q.options.length !== 5) fail(`${qWhere}: exactly 5 options required`);
      else {
        const normalizedOptions = q.options.map(x => String(x).trim().toLowerCase());
        if (normalizedOptions.some(x => !x)) fail(`${qWhere}: empty option`);
        if (new Set(normalizedOptions).size !== 5) fail(`${qWhere}: duplicate options`);
      }
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 4) fail(`${qWhere}: answer must be 0..4`);
      else answerCounts[q.answer]++;
      const normalizedPrompt = promptKey(q.q);
      if (allPrompts.has(normalizedPrompt)) fail(`${qWhere}: duplicate Barron-style prompt`);
      else allPrompts.add(normalizedPrompt);
      if (publicPrompts.has(normalizedPrompt)) fail(`${qWhere}: duplicates a public-pool prompt`);
      wordCounts.push(String(q.q || "").trim().split(/\s+/).filter(Boolean).length);
    }

    if (answerCounts.some(n => n !== 5)) fail(`${where}: answer positions are ${answerCounts.join(",")}, expected 5 each`);
    if (usedTypes.size !== 6) fail(`${where}: expected all 6 types, found ${usedTypes.size}`);
    if (section === "AR") {
      const avg = wordCounts.reduce((a, b) => a + b, 0) / Math.max(1, wordCounts.length);
      if (wordCounts.some(n => n < 15)) fail(`${where}: AR warm-up stems must still have at least 15 words`);
      if (avg < 27.5 || avg > 29.5) fail(`${where}: AR average stem length ${avg.toFixed(1)} must stay between 27.5 and 29.5 words`);
      if (wordCounts.filter(n => n >= 25).length < 15) fail(`${where}: fewer than 15 AR stems have at least 25 words`);
      if (wordCounts.filter(n => n >= 32).length < 7) fail(`${where}: fewer than 7 AR stems have at least 32 words`);
      if (wordCounts.filter(n => n < 25).length < 5) fail(`${where}: AR set needs at least 5 concise warm-up stems`);
    }
    console.log(`${path}: ${questions.length} questions, ${expectedSeconds / 60} minutes, answers ${answerCounts.join("/")}`);
  }
}

if (failed) process.exit(1);
console.log(`OK: ${allIds.size} unique original math questions validated`);
