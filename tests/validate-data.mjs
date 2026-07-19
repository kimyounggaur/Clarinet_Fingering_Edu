import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const APP_URL = new URL("../clarinet_solfege_trainer.html", import.meta.url);
const SOURCE_URL = new URL(
  "../01%20Source/clarinet_standard_fingering_chart.html",
  import.meta.url,
);

function readRequired(url, label) {
  assert(fs.existsSync(url), `${label} not found: ${url.pathname}`);
  return fs.readFileSync(url, "utf8");
}

function initializerFor(text, name, label) {
  const declaration = new RegExp(`\\bconst\\s+${name}\\s*=`, "g");
  const matches = [...text.matchAll(declaration)];
  assert.equal(
    matches.length,
    1,
    `${label} must contain exactly one const ${name} declaration`,
  );

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
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[" || char === "{" || char === "(") depth += 1;
    else if (char === "]" || char === "}" || char === ")") depth -= 1;
    else if (char === ";" && depth === 0) return text.slice(start, index).trim();
  }

  assert.fail(`${label}: could not find the end of const ${name}`);
}

function evaluateInitializer(source, label) {
  return vm.runInNewContext(`(${source})`, Object.create(null), {
    filename: label,
    timeout: 1_000,
  });
}

function toHost(value) {
  if (value === null || typeof value !== "object") return value;
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Set]") return Array.from(value, toHost);
  if (tag === "[object Map]") {
    return Array.from(value, ([key, entry]) => [toHost(key), toHost(entry)]);
  }
  if (Array.isArray(value)) return Array.from(value, toHost);
  return Object.fromEntries(
    Object.keys(value).map((key) => [key, toHost(value[key])]),
  );
}

function readConstants(html, label) {
  return Object.fromEntries(
    ["COMPONENTS", "ROUND_IDS", "HORIZONTAL_IDS", "DATA", "REGISTER"].map(
      (name) => [
        name,
        toHost(evaluateInitializer(initializerFor(html, name, label), `${label}:${name}`)),
      ],
    ),
  );
}

const sourceHtml = readRequired(SOURCE_URL, "canonical source HTML");
const appHtml = readRequired(APP_URL, "product HTML");
const inlineScripts = [...appHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
assert.equal(inlineScripts.length, 1, "product HTML must contain exactly one inline script");
assert.doesNotThrow(
  () => new vm.Script(inlineScripts[0][1], { filename: "clarinet_solfege_trainer.html#inline-script" }),
  "the complete product script must compile",
);
const canonical = readConstants(sourceHtml, "canonical source");
const product = readConstants(appHtml, "product HTML");

for (const name of [
  "COMPONENTS",
  "ROUND_IDS",
  "HORIZONTAL_IDS",
  "DATA",
  "REGISTER",
]) {
  assert.deepStrictEqual(product[name], canonical[name], `${name} differs from canonical source`);
}

const { COMPONENTS, ROUND_IDS, HORIZONTAL_IDS, DATA, REGISTER } = product;
assert.equal(DATA.length, 42, "DATA must contain 42 chromatic notes");
assert.equal(DATA.filter((note) => note.alternate).length, 19, "alternate count");
assert.equal(DATA[0].midi, 52, "lowest written pitch must be E3/MIDI 52");
assert.equal(DATA.at(-1).midi, 93, "highest written pitch must be A6/MIDI 93");
assert.equal(COMPONENTS.length, 25, "the canonical key map has 25 components");
assert.equal(new Set(DATA.map((note) => note.id)).size, 42, "note ids must be unique");
assert.equal(new Set(DATA.map((note) => note.midi)).size, 42, "MIDI values must be unique");
assert.equal(new Set(ROUND_IDS).size, ROUND_IDS.length, "ROUND_IDS must be unique");
assert.equal(
  new Set(HORIZONTAL_IDS).size,
  HORIZONTAL_IDS.length,
  "HORIZONTAL_IDS must be unique",
);

for (const [index, note] of DATA.entries()) {
  assert.equal(note.index, index + 1, `DATA[${index}].index`);
  assert.equal(note.midi, 52 + index, `DATA[${index}] must keep the chromatic MIDI order`);
  assert.equal(
    note.id,
    note.primaryName.replace("♯", "s"),
    `${note.primaryName} must retain its stable URL id`,
  );
  assert(Object.hasOwn(REGISTER, note.register), `${note.id} has an unknown register`);
  assert(Array.isArray(note.primary), `${note.id}.primary must be an array`);
  for (const [variant, pattern] of [
    ["primary", note.primary],
    ["alternate", note.alternate],
  ]) {
    if (pattern === null) continue;
    assert(Array.isArray(pattern), `${note.id}.${variant} must be an array or null`);
    assert.equal(
      new Set(pattern).size,
      pattern.length,
      `${note.id}.${variant} contains a duplicate key id`,
    );
    for (const keyId of pattern) {
      assert(
        Number.isInteger(keyId) && keyId >= 0 && keyId <= 24,
        `${note.id}.${variant} contains invalid key ${keyId}`,
      );
    }
  }
}

for (const [index, component] of COMPONENTS.entries()) {
  assert.equal(component.length, 4, `COMPONENTS[${index}] must be [x,y,w,h]`);
  assert(component.every(Number.isFinite), `COMPONENTS[${index}] must be finite`);
  assert(component[2] > 0 && component[3] > 0, `COMPONENTS[${index}] size must be positive`);
}
for (const keyId of [...ROUND_IDS, ...HORIZONTAL_IDS]) {
  assert(Number.isInteger(keyId) && keyId >= 0 && keyId < COMPONENTS.length);
}

assert(
  Buffer.byteLength(appHtml, "utf8") <= 400 * 1024,
  "clarinet_solfege_trainer.html exceeds the 400 KiB performance budget",
);
assert.doesNotMatch(
  appHtml,
  /<(?:script|link|img|audio|video|source|iframe)\b[^>]*\b(?:src|href)\s*=/i,
  "the single-file app must not load external resources",
);
assert.doesNotMatch(
  appHtml,
  /(?:@import\s+|url\s*\(\s*["']?\s*(?:https?:|\/\/))/i,
  "the single-file app must not contain remote CSS resources",
);

console.log(
  `validate-data: PASS — ${DATA.length} notes, ${DATA.filter((n) => n.alternate).length} alternates, canonical diff 0`,
);
