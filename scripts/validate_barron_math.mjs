import fs from "node:fs";

const specs = [
  ["barron_style_arithmetic.json", "AR", "bmd_ar_"],
  ["barron_style_mathknowledge.json", "MK", "bmd_mk_"],
];

const allIds = new Set();
const allPrompts = new Set();
let failed = false;
const fail = message => { failed = true; console.error(`FAIL: ${message}`); };

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
    const promptKey = String(q.q || "").trim().toLowerCase();
    if (allPrompts.has(promptKey)) fail(`${where}: duplicate English prompt`);
    else allPrompts.add(promptKey);
  }

  console.log(`${path}: ${types.length} types, ${questions.length} questions`);
}

if (failed) process.exit(1);
console.log(`OK: ${allIds.size} unique original math drills validated`);
