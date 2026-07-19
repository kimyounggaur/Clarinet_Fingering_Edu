import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const APP_URL = new URL("../clarinet_solfege_trainer.html", import.meta.url);

function readRequired(url) {
  assert(fs.existsSync(url), `product HTML not found: ${url.pathname}`);
  return fs.readFileSync(url, "utf8");
}

function initializerFor(text, name) {
  const declaration = new RegExp(`\\bconst\\s+${name}\\s*=`, "g");
  const matches = [...text.matchAll(declaration)];
  assert.equal(matches.length, 1, `expected exactly one const ${name}`);
  const start = matches[0].index + matches[0][0].length;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "[" || char === "{" || char === "(") depth += 1;
    else if (char === "]" || char === "}" || char === ")") depth -= 1;
    else if (char === ";" && depth === 0) return text.slice(start, index).trim();
  }
  assert.fail(`could not extract const ${name}`);
}

function evaluateInitializer(text, name) {
  return vm.runInNewContext(`(${initializerFor(text, name)})`, Object.create(null), {
    filename: `clarinet_solfege_trainer.html:${name}`,
    timeout: 1_000,
  });
}

function markedCode(html, startMark, endMark) {
  const start = html.indexOf(startMark);
  const end = html.indexOf(endMark);
  assert(start >= 0 && end > start, `missing or reversed marker pair: ${startMark}`);
  assert.equal(
    html.indexOf(startMark, start + startMark.length),
    -1,
    `duplicate marker: ${startMark}`,
  );
  assert.equal(
    html.indexOf(endMark, end + endMark.length),
    -1,
    `duplicate marker: ${endMark}`,
  );
  return html.slice(start + startMark.length, end);
}

function toHost(value) {
  if (value === null || typeof value !== "object") return value;
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Set]") return Array.from(value, toHost);
  if (tag === "[object Map]") {
    return Array.from(value, ([key, entry]) => [toHost(key), toHost(entry)]);
  }
  if (Array.isArray(value)) return Array.from(value, toHost);
  return Object.fromEntries(Object.keys(value).map((key) => [key, toHost(value[key])]));
}

const html = readRequired(APP_URL);
const DATA = toHost(evaluateInitializer(html, "DATA"));
const COMPONENTS = toHost(evaluateInitializer(html, "COMPONENTS"));
const shortcutCode = markedCode(
  html,
  "/* TESTABLE_SHORTCUT_CORE_START */",
  "/* TESTABLE_SHORTCUT_CORE_END */",
);
const fingerCode = markedCode(
  html,
  "/* TESTABLE_FINGER_CORE_START */",
  "/* TESTABLE_FINGER_CORE_END */",
);

const context = vm.createContext({ console });
context.COMPONENTS = COMPONENTS;
context.DATA = DATA;
context.NOTE_BY_MIDI = new Map(DATA.map((note) => [note.midi, note]));
vm.runInContext(shortcutCode, context, {
  filename: "clarinet_solfege_trainer.html#TESTABLE_SHORTCUT_CORE",
  timeout: 1_000,
});
vm.runInContext(fingerCode, context, {
  filename: "clarinet_solfege_trainer.html#TESTABLE_FINGER_CORE",
  timeout: 1_000,
});
vm.runInContext(
  `globalThis.__keypadTest = {
    midiFromButton,
    validCombo: typeof validCombo === "function" ? validCombo : null,
    activeFingers,
    fingerTarget,
    fingerStateMap,
    keyRoles,
    diffTransition
  };`,
  context,
);

const core = context.__keypadTest;
assert.equal(typeof core.midiFromButton, "function", "midiFromButton test seam");
assert.equal(typeof core.validCombo, "function", "validCombo must be in the shortcut test seam");
assert.equal(typeof core.activeFingers, "function", "activeFingers test seam");
assert.equal(typeof core.fingerStateMap, "function", "fingerStateMap test seam");
assert.equal(typeof core.keyRoles, "function", "keyRoles test seam");
assert.equal(typeof core.diffTransition, "function", "diffTransition test seam");

const expectedMidis = DATA.map((note) => note.midi);
const reachable = new Set();
for (const octave of [3, 4, 5, 6]) {
  for (const button of [1, 2, 3, 4, 5, 6, 7]) {
    for (const accidental of ["flat", "natural", "sharp"]) {
      if (!core.validCombo(octave, button, accidental)) continue;
      const midi = core.midiFromButton(octave, button, accidental);
      assert(
        context.NOTE_BY_MIDI.has(midi),
        `validCombo accepted a MIDI absent from DATA: ${octave}/${button}/${accidental}`,
      );
      reachable.add(midi);
    }
  }
}
assert.deepStrictEqual([...reachable].sort((a, b) => a - b), expectedMidis);
assert.equal(reachable.size, 42, "all 42 pitches must be reachable");

for (const args of [
  [3, 1, "natural"],
  [3, 2, "natural"],
  [3, 3, "flat"],
  [6, 6, "sharp"],
  [6, 7, "natural"],
  [4, 3, "sharp"],
  [4, 7, "sharp"],
  [4, 1, "flat"],
  [4, 4, "flat"],
  [4, 0, "natural"],
  [4, 8, "natural"],
  [4, 1, "double-sharp"],
]) {
  assert.equal(core.validCombo(...args), false, `invalid combo accepted: ${args.join("/")}`);
}
for (const args of [
  [3, 3, "natural"],
  [4, 1, "natural"],
  [4, 1, "sharp"],
  [4, 2, "flat"],
  [5, 7, "natural"],
  [6, 6, "natural"],
]) {
  assert.equal(core.validCombo(...args), true, `valid combo rejected: ${args.join("/")}`);
}

const active = (pattern) => [...core.activeFingers(pattern)];
assert.deepStrictEqual(active([]), []);
assert.deepStrictEqual(active([2]), ["L1"], "key 2 belongs to L1");
assert.deepStrictEqual(
  active([3, 4, 8, 13, 15, 17, 18, 20, 24]),
  ["LT", "L1", "L2", "L3", "L4", "R1", "R2", "R3"],
  "E3 must not count linked key 24 as an R4 contact",
);
assert(active([3, 4, 8, 13, 17, 18, 20, 24]).includes("R4"));

const keyRole = (pattern, keyId) => core.keyRoles(pattern).get(keyId);
assert.equal(keyRole([1, 3], 3), "direct", "LT directly covers keys 1 and 3");
assert.equal(keyRole([3, 4, 8, 13, 17, 19], 19), "direct", "key 19 belongs to R2");
assert.equal(keyRole([3, 4, 5, 7, 8], 7), "direct", "R1 covers the 5+7 pair");
assert.equal(keyRole([3, 9, 10], 9), "direct", "L4 covers the 9+10 pair");
assert.equal(keyRole([3, 4, 8, 11, 12, 13], 12), "linked", "11→12 linkage");
assert.equal(
  keyRole([3, 4, 8, 13, 15, 17, 18, 20, 24], 24),
  "linked",
  "15→24 linkage",
);
assert.equal(
  keyRole([3, 4, 8, 13, 17, 18, 20, 24], 24),
  "direct",
  "key 24 is direct when 15/16 are absent",
);

const statesForKey2 = core.fingerStateMap([2]);
assert.equal(statesForKey2.L1.active, true);
assert.equal(statesForKey2.L1.key, 2);
assert.equal(statesForKey2.L4.active, false);
const r4LinkedTarget = toHost(core.fingerTarget("R4", [15, 24], false));
assert.equal(r4LinkedTarget.key, null, "R4 must stay at rest for linked key 24");

const linkedSeen = new Set();
for (const note of DATA) {
  for (const pattern of [note.primary, note.alternate].filter(Boolean)) {
    const fingerStates = core.fingerStateMap(pattern);
    assert.equal(Object.keys(fingerStates).length, 9, `${note.id} must expose 9 finger states`);
    for (const state of Object.values(fingerStates)) {
      assert.equal(typeof state.active, "boolean");
      assert(Array.isArray(state.xy) && state.xy.length === 2);
      assert(state.xy.every(Number.isFinite));
    }
    const roles = core.keyRoles(pattern);
    assert.equal(roles.size, pattern.length, `${note.id} role coverage`);
    for (const [keyId, role] of roles) {
      assert(role === "direct" || keyId === 12 || keyId === 24);
      if (role === "linked") linkedSeen.add(keyId);
    }
  }
}
assert.deepStrictEqual([...linkedSeen].sort((a, b) => a - b), [12, 24]);

const byMidi = new Map(DATA.map((note) => [note.midi, note]));
const c4 = byMidi.get(60).primary;
const d4 = byMidi.get(62).primary;
const g4 = byMidi.get(67).primary;
const bb4 = byMidi.get(70).primary;
const b4 = byMidi.get(71).primary;
const cSharp4 = byMidi.get(61).primary;

const cToD = core.diffTransition(c4, d4);
const cToDMoves = toHost(cToD.moves);
assert.deepStrictEqual(cToDMoves.filter((move) => move.type === "RELEASE").map((m) => m.finger), ["L3"]);
assert.deepStrictEqual([...cToD.keysOff], [13]);
assert.deepStrictEqual([...cToD.keysOn], []);

const breakCrossing = core.diffTransition(bb4, b4);
const crossingMoves = toHost(breakCrossing.moves);
assert.equal(crossingMoves.find((move) => move.finger === "LT").type, "HOLD");
assert.equal(crossingMoves.find((move) => move.finger === "L1").type, "SLIDE");
assert.deepStrictEqual([...breakCrossing.keysOffSlide], [0]);
assert(!breakCrossing.keysOff.includes(0), "a slide-owned key must not be released by track A1");
assert.equal(breakCrossing.roles.get(24), "linked");

const toOpen = core.diffTransition(cSharp4, g4);
assert.equal(toHost(toOpen.moves).filter((move) => move.type === "RELEASE").length, active(cSharp4).length);
assert.deepStrictEqual([...toOpen.keysOn], []);
assert.deepStrictEqual([...toOpen.keysOff], cSharp4);

const same = core.diffTransition(c4, c4);
assert.deepStrictEqual([...same.keysOff], []);
assert.deepStrictEqual([...same.keysOffSlide], []);
assert.deepStrictEqual([...same.keysOn], []);
assert(toHost(same.moves).every((move) => move.type === "HOLD" || move.type === "IDLE"));

const frozen = core.diffTransition(c4, d4, { L3: [99, 88] });
assert.deepStrictEqual(
  toHost(frozen.moves).find((move) => move.finger === "L3").from,
  [99, 88],
  "interrupts must resume from the frozen finger position",
);

console.log(`keypad-coverage: PASS — ${reachable.size}/42 pitches, finger/linkage/diff contracts pass`);
