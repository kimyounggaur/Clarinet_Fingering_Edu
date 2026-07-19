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

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const DATA = toHost(
  vm.runInNewContext(`(${initializerFor(html, "DATA")})`, Object.create(null), {
    filename: "clarinet_solfege_trainer.html:DATA",
    timeout: 1_000,
  }),
);
const shortcutCode = markedCode(
  "/* TESTABLE_SHORTCUT_CORE_START */",
  "/* TESTABLE_SHORTCUT_CORE_END */",
);
const learningCode = markedCode(
  "/* TESTABLE_LEARNING_CORE_START */",
  "/* TESTABLE_LEARNING_CORE_END */",
);

// Required load order: shortcut theory → DATA/NOTE_BY_MIDI → learning core.
const context = vm.createContext({ console });
vm.runInContext(shortcutCode, context, {
  filename: "clarinet_solfege_trainer.html#TESTABLE_SHORTCUT_CORE",
  timeout: 1_000,
});
context.DATA = DATA;
context.NOTE_BY_MIDI = new Map(DATA.map((note) => [note.midi, note]));
vm.runInContext(learningCode, context, {
  filename: "clarinet_solfege_trainer.html#TESTABLE_LEARNING_CORE",
  timeout: 1_000,
});
vm.runInContext(
  `globalThis.__learningTest = {
    midiFromButton,
    SONGS,
    bankMidis,
    drawQuestions,
    questionsFromPool,
    judgeAnswer
  };`,
  context,
);
const core = context.__learningTest;
for (const name of ["midiFromButton", "bankMidis", "drawQuestions", "questionsFromPool", "judgeAnswer"]) {
  assert.equal(typeof core[name], "function", `${name} must be exported by the product seam`);
}

const expectedBanks = {
  low: [60, 62, 64, 65, 67, 69, 71],
  high: [72, 74, 76, 77, 79, 81, 83],
  semitone: [61, 63, 66, 68, 70, 73, 75, 78, 80, 82],
  all24: Array.from({ length: 24 }, (_, index) => 60 + index),
  all42: Array.from({ length: 42 }, (_, index) => 52 + index),
};
for (const [bank, expected] of Object.entries(expectedBanks)) {
  const actual = [...core.bankMidis(bank)];
  assert.deepStrictEqual(actual, expected, `${bank} bank contents/order`);
  assert.equal(new Set(actual).size, actual.length, `${bank} bank must not contain duplicates`);
  for (const midi of actual) {
    assert(context.NOTE_BY_MIDI.has(midi), `${bank} contains unknown MIDI ${midi}`);
  }
}

const lowQuestions = [...core.drawQuestions("low", 10, seededRng(42))];
assert.equal(lowQuestions.length, 10);
assert.equal(new Set(lowQuestions.slice(0, 7)).size, 7, "small banks exhaust a shuffled cycle first");
assert.equal(new Set(lowQuestions.slice(7)).size, 3, "the refill begins with a fresh non-repeating shuffle");
for (let index = 1; index < lowQuestions.length; index += 1) {
  assert.notEqual(lowQuestions[index], lowQuestions[index - 1], "adjacent quiz duplicates are forbidden");
}
assert.deepStrictEqual(
  lowQuestions,
  [...core.drawQuestions("low", 10, seededRng(42))],
  "injected RNG must make question generation reproducible",
);
for (const bank of ["high", "semitone", "all24", "all42"]) {
  const questions = [...core.drawQuestions(bank, 10, seededRng(7))];
  assert.equal(questions.length, 10, `${bank} session length`);
  assert(questions.every((midi) => expectedBanks[bank].includes(midi)));
  for (let index = 1; index < questions.length; index += 1) {
    assert.notEqual(questions[index], questions[index - 1], `${bank} adjacent duplicate`);
  }
  if (expectedBanks[bank].length >= 10) {
    assert.equal(new Set(questions).size, 10, `${bank} must sample without replacement`);
  }
}

assert.deepStrictEqual(
  [...core.questionsFromPool([67], 10, seededRng(9))],
  Array(10).fill(67),
  "wrong-only retry with one missed MIDI must terminate and repeat that target",
);
const wrongRetry = [...core.questionsFromPool([60, 64], 10, seededRng(9))];
assert.equal(wrongRetry.length, 10, "wrong-only retry session length");
for (let index = 1; index < wrongRetry.length; index += 1) {
  assert.notEqual(wrongRetry[index], wrongRetry[index - 1], "multi-target wrong-only retry avoids adjacent duplicates");
}

assert.equal(core.judgeAnswer(61, 61), true, "enharmonic spellings share MIDI and are correct");
assert.equal(core.judgeAnswer(61, 62), false);
assert.equal(core.judgeAnswer("61", 61), false, "quiz grading must use numeric MIDI identity");

const SONGS = toHost(core.SONGS);
const expectedSongNotes = {
  airplane: [
    [3, 1], [2, 1], [1, 1], [2, 1], [3, 1], [3, 1], [3, 2],
    [2, 1], [2, 1], [2, 2], [3, 1], [5, 1], [5, 2],
    [3, 1], [2, 1], [1, 1], [2, 1], [3, 1], [3, 1], [3, 1], [3, 1],
    [2, 1], [2, 1], [3, 1], [2, 1], [1, 4],
  ],
  "little-star": [
    [1, 1], [1, 1], [5, 1], [5, 1], [6, 1], [6, 1], [5, 2],
    [4, 1], [4, 1], [3, 1], [3, 1], [2, 1], [2, 1], [1, 2],
    [5, 1], [5, 1], [4, 1], [4, 1], [3, 1], [3, 1], [2, 2],
    [5, 1], [5, 1], [4, 1], [4, 1], [3, 1], [3, 1], [2, 2],
    [1, 1], [1, 1], [5, 1], [5, 1], [6, 1], [6, 1], [5, 2],
    [4, 1], [4, 1], [3, 1], [3, 1], [2, 1], [2, 1], [1, 2],
  ],
  butterfly: [
    [5, 1], [3, 1], [3, 2], [4, 1], [2, 1], [2, 2],
    [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [5, 1], [5, 2],
    [5, 1], [3, 1], [3, 2], [4, 1], [2, 1], [2, 2],
    [1, 1], [3, 1], [5, 1], [5, 1], [3, 1], [3, 1], [3, 2],
    [2, 1], [2, 1], [2, 1], [2, 1], [2, 1], [3, 1], [4, 2],
    [3, 1], [3, 1], [3, 1], [3, 1], [3, 1], [4, 1], [5, 2],
    [5, 1], [3, 1], [3, 2], [4, 1], [2, 1], [2, 2],
    [1, 1], [3, 1], [5, 1], [5, 1], [1, 1], [1, 1], [1, 2],
  ],
};
const expectedSongMeta = {
  airplane: { title: "비행기", bpm: 100 },
  "little-star": { title: "반짝반짝 작은 별", bpm: 92 },
  butterfly: { title: "나비야", bpm: 96 },
};

assert.equal(SONGS.length, 3, "exactly three public-domain built-in melodies are required");
assert.equal(new Set(SONGS.map((song) => song.id)).size, SONGS.length, "song ids must be unique");
for (const song of SONGS) {
  assert(Object.hasOwn(expectedSongMeta, song.id), `unexpected song id: ${song.id}`);
  assert.equal(song.title, expectedSongMeta[song.id].title);
  assert.equal(song.bpm, expectedSongMeta[song.id].bpm);
  assert(song.bpm >= 60 && song.bpm <= 140, `${song.id} BPM range`);
  assert.equal(song.octave, 4, `${song.id} is an octave-4 beginner melody`);
  assert.equal(song.accidental, "natural", `${song.id} must use natural notes`);
  assert.match(song.origin, /퍼블릭\s*도메인/, `${song.id} must document public-domain origin`);
  assert(!Object.hasOwn(song, "lyrics"), `${song.id} must not include lyrics`);
  assert(song.notes.length >= 8);
  assert.deepStrictEqual(song.notes, expectedSongNotes[song.id], `${song.id} transcription changed`);

  for (const entry of song.notes) {
    const isTuple = Array.isArray(entry);
    const degree = isTuple ? entry[0] : entry.deg;
    const beats = isTuple ? entry[1] : entry.beats;
    const octave = isTuple ? song.octave : entry.oct;
    const accidental = isTuple ? song.accidental : entry.acc;
    assert(Number.isInteger(degree) && degree >= 1 && degree <= 7, `${song.id} degree`);
    assert(Number.isFinite(beats) && beats > 0, `${song.id} beat duration`);
    const midi = core.midiFromButton(octave, degree, accidental);
    assert(midi >= 52 && midi <= 93 && context.NOTE_BY_MIDI.has(midi), `${song.id} MIDI ${midi}`);
    assert(midi >= 60 && midi <= 69, `${song.id} must stay within C4–A4`);
  }
}
assert(!SONGS.some((song) => /학교종/.test(`${song.id} ${song.title} ${song.origin}`)));

console.log("learning-modes: PASS — 5 banks, deterministic quizzes, MIDI grading, and 3 songs pass");
