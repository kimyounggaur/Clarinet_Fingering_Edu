import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const APP_URL = new URL("../clarinet_solfege_trainer.html", import.meta.url);
assert(fs.existsSync(APP_URL), `product HTML not found: ${APP_URL.pathname}`);
const html = fs.readFileSync(APP_URL, "utf8");

function markedCode(startMark, endMark) {
  const start = html.indexOf(startMark);
  const end = html.indexOf(endMark);
  assert(start >= 0 && end > start, `missing or reversed marker pair: ${startMark}`);
  assert.equal(html.indexOf(startMark, start + startMark.length), -1, `duplicate ${startMark}`);
  assert.equal(html.indexOf(endMark, end + endMark.length), -1, `duplicate ${endMark}`);
  return html.slice(start + startMark.length, end);
}

const context = vm.createContext({ console });
vm.runInContext(
  markedCode("/* TESTABLE_AUDIO_CORE_START */", "/* TESTABLE_AUDIO_CORE_END */"),
  context,
  {
    filename: "clarinet_solfege_trainer.html#TESTABLE_AUDIO_CORE",
    timeout: 1_000,
  },
);
vm.runInContext(
  `globalThis.__audioTest = {
    CLARINET_AUDIO_VERSION,
    CLARINET_AUDIO_PROFILES,
    clarinetAudioProfile,
    clarinetAudioProfileForMidi,
    soundingMidiForAudio,
    frequencyForMidi,
    clarinetTonePlan,
    buildClarinetHarmonics
  };`,
  context,
);
const core = context.__audioTest;

assert.equal(core.CLARINET_AUDIO_VERSION, "clarinet-hybrid-v2");
assert.deepEqual(
  Array.from(Object.keys(core.CLARINET_AUDIO_PROFILES)),
  ["chalumeau", "throat", "clarion", "altissimo"],
);
assert.equal(core.soundingMidiForAudio(60, "Bb", false), 58, "B-flat sounding pitch");
assert.equal(core.soundingMidiForAudio(60, "A", false), 57, "A clarinet sounding pitch");
assert.equal(core.soundingMidiForAudio(60, "Bb", true), 60, "written-pitch playback");
assert(Math.abs(core.frequencyForMidi(69) - 440) < 1e-9, "A4 tuning");
assert(
  Math.abs(core.frequencyForMidi(70) / core.frequencyForMidi(69) - 2 ** (1 / 12)) < 1e-12,
  "equal-tempered semitone",
);

const registerForMidi = (midi) => {
  if (midi <= 66) return "chalumeau";
  if (midi <= 70) return "throat";
  if (midi <= 84) return "clarion";
  return "altissimo";
};

for (const writtenMidi of Array.from({ length: 42 }, (_, index) => index + 52)) {
  for (const instrument of ["Bb", "A"]) {
    for (const soundWritten of [false, true]) {
      const plan = core.clarinetTonePlan(
        writtenMidi,
        registerForMidi(writtenMidi),
        instrument,
        soundWritten,
      );
      assert(Number.isFinite(plan.frequency) && plan.frequency > 0, `frequency ${writtenMidi}`);
      assert.equal(
        plan.midi,
        soundWritten ? writtenMidi : writtenMidi - (instrument === "A" ? 3 : 2),
      );
      assert(plan.attack >= 0.03 && plan.attack <= 0.08, `attack ${writtenMidi}`);
      assert(plan.release >= 0.1 && plan.release <= 0.25, `release ${writtenMidi}`);
      assert(plan.peak > plan.sustain && plan.peak < 0.5, `level ${writtenMidi}`);
      assert(plan.cutoff >= 3_600 && plan.cutoff <= 10_500, `cutoff ${writtenMidi}`);
      const dark = Array.from(
        core.buildClarinetHarmonics(
          plan.frequency,
          plan.register,
          "dark",
          48_000,
          plan.profile,
        ),
      );
      const bright = Array.from(
        core.buildClarinetHarmonics(
          plan.frequency,
          plan.register,
          "bright",
          48_000,
          plan.profile,
        ),
      );
      const combinedPeak =
        plan.peak *
        (dark.reduce((sum, value) => sum + Math.abs(value), 0) * plan.profile.dark +
          bright.reduce((sum, value) => sum + Math.abs(value), 0) * plan.profile.bright);
      assert(combinedPeak < 0.9, `pre-filter combined headroom ${writtenMidi}`);
    }
  }
}

const productionProfiles = Array.from({ length: 42 }, (_, index) =>
  core.clarinetAudioProfileForMidi(index + 52, registerForMidi(index + 52)),
);
for (let index = 1; index < productionProfiles.length; index += 1) {
  const previous = productionProfiles[index - 1];
  const current = productionProfiles[index];
  assert(Math.abs(current.even - previous.even) < 0.13, `timbre continuity at MIDI ${index + 52}`);
  assert(
    Math.abs(20 * Math.log10(current.sustain / previous.sustain)) < 0.5,
    `sustain continuity at MIDI ${index + 52}`,
  );
  assert(Math.abs(current.cutoff - previous.cutoff) < 900, `filter continuity at MIDI ${index + 52}`);
}

function spectrumStats(coefficients, frequency) {
  let oddEnergy = 0;
  let evenEnergy = 0;
  let weighted = 0;
  let energy = 0;
  let absolute = 0;
  coefficients.forEach((amplitude, harmonic) => {
    if (!harmonic) return;
    assert(Number.isFinite(amplitude) && amplitude >= 0);
    const partialEnergy = amplitude * amplitude;
    if (frequency * harmonic <= 1_000) {
      if (harmonic % 2) oddEnergy += partialEnergy;
      else evenEnergy += partialEnergy;
    }
    weighted += partialEnergy * harmonic;
    energy += partialEnergy;
    absolute += Math.abs(amplitude);
  });
  return {
    oddEvenRatio: oddEnergy / Math.max(1e-12, evenEnergy),
    centroid: weighted / energy,
    theoreticalPeak: absolute,
  };
}

const lowFrequency = core.frequencyForMidi(52);
const oddEvenRatios = [];
for (const register of ["chalumeau", "throat", "clarion", "altissimo"]) {
  const profile = core.clarinetAudioProfile(register);
  assert(profile.even > 0 && profile.even <= 1, `${register} even-harmonic weight`);
  assert(profile.brightDelay >= 0.01 && profile.brightDelay <= 0.03, `${register} bright delay`);
  const dark = Array.from(core.buildClarinetHarmonics(lowFrequency, register, "dark", 48_000));
  const bright = Array.from(core.buildClarinetHarmonics(lowFrequency, register, "bright", 48_000));
  const expectedPartials = Math.min(48, Math.floor((48_000 * 0.45) / lowFrequency));
  assert.equal(dark.length, expectedPartials + 1, `${register} band-limited partial count`);
  assert.equal(dark[0], 0, `${register} has no DC coefficient`);
  assert(dark[1] > 0 && bright[1] > 0, `${register} keeps the fundamental`);
  const darkStats = spectrumStats(dark, lowFrequency);
  const brightStats = spectrumStats(bright, lowFrequency);
  assert(darkStats.theoreticalPeak <= 1.751, `${register} dark headroom`);
  assert(brightStats.theoreticalPeak <= 1.751, `${register} bright headroom`);
  assert(brightStats.centroid > darkStats.centroid, `${register} bright layer centroid`);
  oddEvenRatios.push(darkStats.oddEvenRatio);
}
assert(
  oddEvenRatios.every((ratio, index) => index === 0 || ratio < oddEvenRatios[index - 1]),
  "low-register odd/even dominance must relax toward altissimo",
);

for (const sampleRate of [44_100, 48_000]) {
  for (const midi of [50, 58, 69, 82, 91]) {
    const frequency = core.frequencyForMidi(midi);
    const coefficients = Array.from(
      core.buildClarinetHarmonics(frequency, registerForMidi(midi + 2), "bright", sampleRate),
    );
    assert(
      (coefficients.length - 1) * frequency <= sampleRate * 0.45 + 1e-6,
      `Nyquist guard ${sampleRate}/${midi}`,
    );
  }
}

assert.match(html, /createDynamicsCompressor\(\)/, "master dynamics protection");
assert.match(html, /createConvolver\(\)/, "algorithmic room response");
assert.match(
  html,
  /room\.normalize=false;room\.buffer=createRoomImpulse/,
  "convolver normalization must be set before assigning the impulse",
);
assert.match(html, /createBufferSource\(\)/, "breath and tongue noise source");
assert.match(html, /audioActiveVoices/, "voice lifecycle diagnostics");
assert.match(
  html,
  /for\(const current of \[\.\.\.liveVoices\]\)stopVoice\(current,.045,true\);muteMaster\(ctx\)/,
  "releaseAll must stop every live voice and mute the room tail",
);
assert.doesNotMatch(html, /AudioWorklet/, "single-file engine must not depend on worklet loading");

console.log(
  "audio-engine: PASS — 42 pitches, 4 register profiles, band-limited dual spectra, breath/room/master contracts pass",
);
