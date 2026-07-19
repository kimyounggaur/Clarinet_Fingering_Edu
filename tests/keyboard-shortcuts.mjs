import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const APP_URL = new URL("../clarinet_solfege_trainer.html", import.meta.url);
assert(fs.existsSync(APP_URL), `product HTML not found: ${APP_URL.pathname}`);
const html = fs.readFileSync(APP_URL, "utf8");

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

function markedCode(startMark, endMark) {
  const start = html.indexOf(startMark);
  const end = html.indexOf(endMark);
  assert(start >= 0 && end > start, `missing or reversed marker pair: ${startMark}`);
  assert.equal(html.indexOf(startMark, start + startMark.length), -1, `duplicate ${startMark}`);
  assert.equal(html.indexOf(endMark, end + endMark.length), -1, `duplicate ${endMark}`);
  return html.slice(start + startMark.length, end);
}

function functionSource(name) {
  const declaration = new RegExp(`\\bfunction\\s+${name}\\s*\\(`, "g");
  const matches = [...html.matchAll(declaration)];
  assert.equal(matches.length, 1, `expected exactly one function ${name}`);
  let signatureDepth = 1;
  let signatureQuote = null;
  let signatureEscaped = false;
  let signatureEnd = -1;
  for (
    let index = matches[0].index + matches[0][0].length;
    index < html.length;
    index += 1
  ) {
    const char = html[index];
    if (signatureQuote) {
      if (signatureEscaped) signatureEscaped = false;
      else if (char === "\\") signatureEscaped = true;
      else if (char === signatureQuote) signatureQuote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      signatureQuote = char;
      continue;
    }
    if (char === "(") signatureDepth += 1;
    else if (char === ")") {
      signatureDepth -= 1;
      if (signatureDepth === 0) {
        signatureEnd = index;
        break;
      }
    }
  }
  assert(signatureEnd >= 0, `unterminated signature for function ${name}`);
  const open = html.indexOf("{", signatureEnd + 1);
  assert(open >= 0, `missing body for function ${name}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < html.length; index += 1) {
    const char = html[index];
    const next = html[index + 1];
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
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(matches[0].index, index + 1);
    }
  }
  assert.fail(`unterminated body for function ${name}`);
}

function callCount(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function toHost(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Array.from(value, toHost);
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Set]") return Array.from(value, toHost);
  return Object.fromEntries(Object.keys(value).map((key) => [key, toHost(value[key])]));
}

const DATA = toHost(
  vm.runInNewContext(`(${initializerFor(html, "DATA")})`, Object.create(null), {
    filename: "clarinet_solfege_trainer.html:DATA",
    timeout: 1_000,
  }),
);
const NOTE_BY_MIDI = new Map(DATA.map((note) => [note.midi, note]));
const productCode = markedCode(
  "/* TESTABLE_SHORTCUT_CORE_START */",
  "/* TESTABLE_SHORTCUT_CORE_END */",
);
const context = vm.createContext({ console });
context.DATA = DATA;
context.NOTE_BY_MIDI = NOTE_BY_MIDI;
vm.runInContext(productCode, context, {
  filename: "clarinet_solfege_trainer.html#TESTABLE_SHORTCUT_CORE",
  timeout: 1_000,
});
vm.runInContext(
  `globalThis.__shortcutTest = {
    midiFromButton,
    deriveQuickCategory,
    nextQuickBand,
    resolveQuickRequest,
    shortcutKindFromEvent,
    semitoneDegrees: [...SEMITONE_DEGREES]
  };`,
  context,
);
const core = context.__shortcutTest;

for (const name of [
  "midiFromButton",
  "deriveQuickCategory",
  "nextQuickBand",
  "resolveQuickRequest",
  "shortcutKindFromEvent",
]) {
  assert.equal(typeof core[name], "function", `${name} must be exported by the product seam`);
}

const project = (request) => ({
  kind: request.kind,
  digit: request.digit,
  octave: request.octave,
  accidental: request.accidental,
  inputAcc: request.inputAcc,
  midi: request.midi,
  valid: request.valid,
});
const requests = (kind, band) =>
  [1, 2, 3, 4, 5, 6, 7].map((digit) => core.resolveQuickRequest(kind, digit, band));

const low = requests("low-natural", 5);
const high = requests("high-natural", 4);
const lowSemitones = requests("semitone", 4);
const highSemitones = requests("semitone", 5);
const lowMidi = low.map((request) => request.midi);
const highMidi = high.map((request) => request.midi);
const lowIds = low.map((request) => NOTE_BY_MIDI.get(request.midi)?.id);
const highIds = high.map((request) => NOTE_BY_MIDI.get(request.midi)?.id);
const validLowSemitones = lowSemitones.filter((request) => request.valid);
const validHighSemitones = highSemitones.filter((request) => request.valid);

assert.deepStrictEqual(lowMidi, [60, 62, 64, 65, 67, 69, 71]);
assert.deepStrictEqual(highMidi, [72, 74, 76, 77, 79, 81, 83]);
assert.deepStrictEqual(lowIds, ["C4", "D4", "E4", "F4", "G4", "A4", "B4"]);
assert.deepStrictEqual(highIds, ["C5", "D5", "E5", "F5", "G5", "A5", "B5"]);
assert.deepStrictEqual(validLowSemitones.map((request) => request.midi), [61, 63, 66, 68, 70]);
assert.deepStrictEqual(validHighSemitones.map((request) => request.midi), [73, 75, 78, 80, 82]);
assert.deepStrictEqual([...core.semitoneDegrees], [1, 2, 4, 5, 6]);
assert.deepStrictEqual(
  lowSemitones.filter((request) => request.valid).map((request) => request.digit),
  [1, 2, 4, 5, 6],
);

for (const request of [...low, ...high, ...validLowSemitones, ...validHighSemitones]) {
  assert(NOTE_BY_MIDI.has(request.midi), `shortcut MIDI ${request.midi} must exist in DATA`);
  assert.equal(request.inputAcc, request.accidental);
}
for (const request of [...lowSemitones, ...highSemitones]) {
  assert.equal(request.valid, ![3, 7].includes(request.digit));
}
assert.deepStrictEqual(project(core.resolveQuickRequest("low-natural", 1, 5)), {
  kind: "low-natural",
  digit: 1,
  octave: 4,
  accidental: "natural",
  inputAcc: "natural",
  midi: 60,
  valid: true,
});
assert.deepStrictEqual(project(core.resolveQuickRequest("high-natural", 1, 4)), {
  kind: "high-natural",
  digit: 1,
  octave: 5,
  accidental: "natural",
  inputAcc: "natural",
  midi: 72,
  valid: true,
});
assert.deepStrictEqual(project(core.resolveQuickRequest("semitone", 6, 4)), {
  kind: "semitone",
  digit: 6,
  octave: 4,
  accidental: "sharp",
  inputAcc: "sharp",
  midi: 70,
  valid: true,
});
assert.equal(core.resolveQuickRequest("unknown", 1, 4), null);
assert.equal(core.resolveQuickRequest("low-natural", 0, 4), null);
assert.equal(core.resolveQuickRequest("low-natural", 8, 4), null);
assert.equal(core.resolveQuickRequest("low-natural", 1.5, 4), null);

const all24 = new Set([
  ...lowMidi,
  ...highMidi,
  ...validLowSemitones.map((request) => request.midi),
  ...validHighSemitones.map((request) => request.midi),
]);
assert.equal(all24.size, 24);
assert.deepStrictEqual([...all24].sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => 60 + i));

assert.equal(core.deriveQuickCategory(4, "natural"), "low-natural");
assert.equal(core.deriveQuickCategory(5, "natural"), "high-natural");
assert.equal(core.deriveQuickCategory(4, "sharp"), "semitone");
assert.equal(core.deriveQuickCategory(5, "sharp"), "semitone");
for (const [octave, accidental] of [
  [3, "natural"],
  [6, "natural"],
  [4, "flat"],
  [5, "flat"],
  [3, "sharp"],
  [6, "sharp"],
]) {
  assert.equal(core.deriveQuickCategory(octave, accidental), null);
}

let quickBand = 4;
let request = core.resolveQuickRequest("high-natural", 1, quickBand);
quickBand = core.nextQuickBand(quickBand, request.octave);
assert.equal(request.midi, 72); // Shift+1
assert.equal(quickBand, 5);
request = core.resolveQuickRequest("semitone", 2, quickBand);
quickBand = core.nextQuickBand(quickBand, request.octave);
assert.equal(request.midi, 75); // Alt+2
assert.equal(quickBand, 5);
request = core.resolveQuickRequest("low-natural", 1, quickBand);
quickBand = core.nextQuickBand(quickBand, request.octave);
assert.equal(request.midi, 60); // Control+1
assert.equal(quickBand, 4);
request = core.resolveQuickRequest("semitone", 6, quickBand);
quickBand = core.nextQuickBand(quickBand, request.octave);
assert.equal(request.midi, 70); // Alt+6
assert.equal(quickBand, 4);
assert.equal(core.nextQuickBand(quickBand, 6), 4, "octave 6 preserves the semitone band");
assert.equal(core.nextQuickBand(quickBand, 5), 5, "octave 5 selects the high semitone band");

function keyboardEvent(overrides = {}) {
  const altGraph = Boolean(overrides.altGraph);
  return {
    code: "Digit1",
    key: "1",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    getModifierState(name) {
      return name === "AltGraph" && altGraph;
    },
    ...overrides,
  };
}

assert.equal(core.shortcutKindFromEvent(keyboardEvent({ ctrlKey: true })), "low-natural");
assert.equal(
  core.shortcutKindFromEvent(keyboardEvent({ shiftKey: true, key: "!" })),
  "high-natural",
  "the parser must use KeyboardEvent.code rather than shifted key text",
);
assert.equal(core.shortcutKindFromEvent(keyboardEvent({ altKey: true })), "semitone");
assert.equal(core.shortcutKindFromEvent(keyboardEvent({ altKey: true, code: "Digit3" })), "semitone");
for (const event of [
  keyboardEvent(),
  keyboardEvent({ ctrlKey: true, shiftKey: true }),
  keyboardEvent({ ctrlKey: true, altKey: true }),
  keyboardEvent({ shiftKey: true, altKey: true }),
  keyboardEvent({ metaKey: true, ctrlKey: true }),
  keyboardEvent({ ctrlKey: true, altGraph: true }),
  keyboardEvent({ ctrlKey: true, isComposing: true }),
  keyboardEvent({ ctrlKey: true, repeat: true }),
  keyboardEvent({ ctrlKey: true, target: { closest: () => ({}) } }),
  keyboardEvent({ ctrlKey: true, code: "Numpad1" }),
  keyboardEvent({ ctrlKey: true, code: "Digit8" }),
]) {
  assert.equal(core.shortcutKindFromEvent(event), null);
}
assert.equal(
  core.shortcutKindFromEvent({
    code: "Digit7",
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
  }),
  "low-natural",
  "getModifierState is optional",
);

assert.equal(NOTE_BY_MIDI.get(61).id, "Cs4");
assert.equal(NOTE_BY_MIDI.get(78).id, "Fs5");
assert.equal(DATA.filter((note) => note.alternate).length, 19);

// Structural integration contracts cover the real product handler chain while
// browser verification exercises its DOM behavior. These assertions prevent a
// pure-mapping-only false positive if the adapters bypass the shared pipeline.
const selectSource = functionSource("selectNoteRequest");
assert.equal(callCount(selectSource, /\bdispatch\s*\(/g), 1, "valid selection dispatches once");
assert.equal(callCount(selectSource, /\brender\s*\(/g), 1, "valid selection renders once");
assert.equal(
  callCount(selectSource, /animator\.transitionTo\s*\(/g),
  1,
  "valid selection starts at most one animator transition",
);
const beginSource = functionSource("beginNoteInput");
assert.equal(callCount(beginSource, /selectNoteRequest\s*\(/g), 1);
assert.equal(callCount(beginSource, /audioGate\.attack\s*\(/g), 1, "valid input attacks once");
const routeSource = functionSource("routeNoteInput");
assert.equal(callCount(routeSource, /beginNoteInput\s*\(/g), 1, "free input uses the shared begin path");
assert(routeSource.indexOf('state.mode==="quiz"') < routeSource.indexOf("beginNoteInput("));
const quickSource = functionSource("handleQuickShortcut");
const invalidAt = quickSource.indexOf("if(!request.valid)");
const routeAt = quickSource.indexOf("routeNoteInput(");
assert(invalidAt >= 0 && routeAt > invalidAt, "invalid shortcuts must return before routing");
assert.match(
  quickSource.slice(invalidAt, routeAt),
  /if\(!request\.valid\)\{showToast\(invalidRequestMessage\(request\)\);return\}/,
  "invalid shortcuts must terminate immediately after their single toast",
);
assert.equal(callCount(quickSource, /routeNoteInput\s*\(/g), 1);
assert.equal(callCount(quickSource, /showToast\s*\(/g), 1, "invalid shortcut emits one toast");
assert.doesNotMatch(
  quickSource.slice(invalidAt, routeAt),
  /\b(?:dispatch|render|updateHash)\s*\(|animator\.|audioGate\./,
  "invalid shortcut must not mutate selection, URL, animation, or audio",
);
const globalSource = functionSource("handleGlobalKeyDown");
assert.match(
  globalSource,
  /if\(quickKind\)\{handleQuickShortcut\(event,quickKind\);return\}/,
  "handled modifier shortcuts must not fall through to the legacy handler",
);
const toastSource = functionSource("showToast");
assert.equal(callCount(toastSource, /clearTimeout\s*\(toastTimer\)/g), 1);
assert.equal(callCount(toastSource, /toastTimer\s*=\s*setTimeout\s*\(/g), 1);

console.log("keyboard-shortcuts: PASS — 24 mappings, band/event parsing, and product pipeline contracts pass");
