// Sound for the instruments, synthesised live with the Web Audio API: no audio
// files and nothing leaves the computer. It follows the display only and never
// touches the counts.
//
// The Bulb is a tungsten lamp on a phase-cut dimmer. Mains current pulls the
// filament's coils with a force proportional to the current squared, so a lamp
// hums at twice the mains frequency. A dimmer switches the current on part-way
// through each half cycle; the sudden step adds harmonics, which is the buzz of
// a dimmed lamp. Each display level becomes a filament temperature (as the
// picture uses), then the electrical power that holds it, then the dimmer's
// firing angle, and the hum is the force spectrum at that angle, shaped by the
// filament and glass and heard in a small room. Bright is a smooth, soft hum;
// half way is the loudest buzz; the dim, just-lit range is kept quieter and
// softer so it does not nag; near dark it fades out.
//
// The Bar is a needle meter, and a theremin-like voice sings its reading: 432
// Hz with the needle at zero, an octave higher at +4 and an octave lower at −4.
// It is kept rounded so it never whines: gently falling harmonics with no
// distortion, a warm vowel-like resonance, a roll-off that rises with the note
// so high notes keep their body, a second voice beating slowly beside it, a
// slow shallow vibrato and a small room. The pitch glides after the needle as
// it is drawn, overshoot and all, and the voice sings only while a part runs.
// A meter with a red set-point needle was a contact meter: from half way
// through a part, reaching the red needle in the direction asked closes the
// contacts, a relay pulls in and a small bell is struck once. The needle ticks
// against a stop pin past either end of the scale, and the meter lamp's supply
// hums faintly at twice the mains frequency.
//
// The Box plays a warm drone of the valve-and-gramophone era. It is the same in
// every session and never hears the device, so it carries nothing from the
// measurement. Two warm tones 10 hertz apart beat at a steady 10 a second, in
// the alpha range: a soft pulse on speakers, and in headphones, where each ear
// gets one tone, a binaural beat. A clockwork
// governor purrs at the same pace, and gramophone hiss, the odd crackle and the
// amplifier's mains hum sit underneath. Its volume holds steady from start to
// end, so nothing in it rises or falls as if in answer. Its knob clicks as it turns between
// parts, and at the end the latches clack, the wax seal cracks, the hinges
// creak and the lid comes to rest on its stop.
import { levelToTemperature, T_FULL } from "./tungsten.js";

// Mains frequency from the time zone: 60 Hz in most of the Americas and a few
// Asian and Pacific grids, 50 Hz elsewhere. The lamp hums at twice that.
const SIXTY =
  /^(America\/(?!Argentina|Santiago|Punta_Arenas|Montevideo|Asuncion|La_Paz|Cayenne|Nuuk|Godthab)|Asia\/(Seoul|Taipei|Manila|Riyadh)|Pacific\/(Honolulu|Guam|Saipan))/;
export const mainsHz = (zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "") =>
  SIXTY.test(zone) ? 60 : 50;

// --- The lamp -------------------------------------------------------------
const GRID = 24,
  HARMONICS = 48,
  MAX_ANGLE = Math.PI * 0.985;
// Lamp power follows filament temperature roughly as T^3.8; a dimmer cannot
// exceed full mains, so anything at or above operating temperature is full.
const powerAt = (level) => Math.min(1, Math.pow(levelToTemperature(level) / T_FULL, 3.8));
// Share of full power a leading-edge dimmer passes when it fires at angle phi.
const conducted = (phi) => 1 - phi / Math.PI + Math.sin(2 * phi) / (2 * Math.PI);
export function firingAngle(p) {
  if (p >= 1) return 0;
  let lo = 0,
    hi = Math.PI;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (conducted(mid) > p) lo = mid;
    else hi = mid;
  }
  return Math.min(MAX_ANGLE, (lo + hi) / 2);
}
// Fourier series of the force over one half cycle, i^2 = sin^2 from the firing
// angle to the end, in harmonics of the hum.
function forceSpectrum(phi) {
  const N = 2048,
    re = new Float64Array(HARMONICS + 1),
    im = new Float64Array(HARMONICS + 1);
  for (let n = 0; n < N; n++) {
    const th = ((n + 0.5) / N) * Math.PI;
    if (th < phi) continue;
    const f = Math.sin(th) ** 2,
      c1 = Math.cos(2 * th),
      s1 = Math.sin(2 * th);
    // cos and sin of 2k*theta by rotation, without a trig call per harmonic.
    let c = c1,
      s = s1;
    for (let k = 1; k <= HARMONICS; k++) {
      re[k] += f * c;
      im[k] += f * s;
      const next = c * c1 - s * s1;
      s = s * c1 + c * s1;
      c = next;
    }
  }
  for (let k = 1; k <= HARMONICS; k++) {
    re[k] *= 2 / N;
    im[k] *= 2 / N;
  }
  return { re, im };
}
// How loud a frequency sounds relative to 1 kHz (the A-weighting curve).
function aWeight(f) {
  const f2 = f * f,
    ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return ra / 0.7943;
}
// The waveforms for every firing angle on the grid, built once. Higher
// harmonics radiate a little more strongly (vibration velocity), and a small
// nonlinear floor gives a bright lamp's hum the overtones that small speakers
// can play. Loudness, as the ear weighs it, is compressed so the buzz at half
// power is clearly louder than a bright hum without being harsh, and the lamp
// fades to silence as it goes dark.
// The dim, just-lit range (around 7% power, where the lamp rests and wanders
// most) is turned down by about 5 to 8 dB and its top end softened.
const dimness = (p) => Math.exp(-(((Math.log(p) - Math.log(0.07)) / 1.3) ** 2));
let lampTable = null;
function lamp() {
  if (lampTable) return lampTable;
  const rows = [];
  for (let j = 0; j < GRID; j++) {
    const phi = (j / (GRID - 1)) * MAX_ANGLE,
      { re, im } = forceSpectrum(phi),
      hum = Math.hypot(re[1], im[1]),
      soft = dimness(conducted(phi));
    let energy = 0,
      heard = 0;
    for (let k = 1; k <= HARMONICS; k++) {
      const w = Math.pow(k, 0.6) / Math.sqrt(1 + soft * (k / 20) ** 2);
      re[k] *= w;
      im[k] *= w;
      if (k > 1 && k <= 8) re[k] += (hum * 0.45) / k;
      const e = (re[k] * re[k] + im[k] * im[k]) / 2;
      energy += e;
      heard += e * aWeight(100 * k) ** 2;
    }
    rows.push({ phi, power: conducted(phi), re, im, rms: Math.sqrt(energy), heard: Math.sqrt(heard), edge: phi ? Math.sin(phi) ** 2 : 0 });
  }
  const loudest = rows.reduce((a, r) => (r.heard > a.heard ? r : a)),
    reference = loudest.rms / loudest.heard;
  for (const r of rows) {
    const fade = Math.min(1, r.power / 0.06),
      target = Math.pow(r.heard / loudest.heard, 0.5);
    // Keep the low hum well below the loudest buzz in plain level, so it never booms.
    r.gain =
      Math.min(target / r.heard, (0.5 * reference) / r.rms) * fade * fade * (3 - 2 * fade) * (1 - 0.6 * dimness(r.power));
  }
  return (lampTable = rows);
}
// A one-off bump each half cycle, for the faint sizzle at the dimmer's firing.
function pulseWave(ctx) {
  const n = 32,
    re = new Float32Array(n + 1),
    im = new Float32Array(n + 1),
    width = 0.05;
  // Fourier series of a narrow Gaussian at the start of each period, minus its mean.
  for (let k = 1; k <= n; k++) re[k] = 2 * width * Math.sqrt(2 * Math.PI) * Math.exp(-0.5 * (2 * Math.PI * k * width) ** 2);
  return { wave: ctx.createPeriodicWave(re, im, { disableNormalization: true }), mean: width * Math.sqrt(2 * Math.PI) };
}
function noiseBuffer(ctx, seconds = 2) {
  const length = Math.floor(ctx.sampleRate * seconds),
    buffer = ctx.createBuffer(1, length, ctx.sampleRate),
    data = buffer.getChannelData(0);
  let s = 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    data[i] = ((s >>> 0) / 4294967296) * 2 - 1;
  }
  return buffer;
}
// A small, soft room: a short decaying noise burst as the impulse response.
function room(ctx, seconds = 0.45, decay = 0.09, smooth = 0.35) {
  const length = Math.floor(ctx.sampleRate * seconds),
    buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let s = 0x2545f491 + c * 7919,
      low = 0;
    for (let i = 0; i < length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      low += (((s >>> 0) / 4294967296) * 2 - 1 - low) * smooth;
      data[i] = low * Math.exp(-i / (ctx.sampleRate * decay));
    }
  }
  const convolver = ctx.createConvolver();
  convolver.buffer = buffer;
  return convolver;
}
// Output chain for a voice: a little room, a safety limiter, volume. A voice
// with a room and a limiter of its own takes only the volume (shared: false).
export function createOutput(ctx, destination = ctx.destination, { shared = true } = {}) {
  const input = ctx.createGain(),
    volume = ctx.createGain();
  volume.gain.value = 0;
  if (shared) {
    const wet = ctx.createGain(),
      limiter = ctx.createDynamicsCompressor(),
      reverb = room(ctx);
    wet.gain.value = 0.14;
    limiter.threshold.value = -14;
    limiter.knee.value = 6;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    input.connect(limiter);
    input.connect(reverb).connect(wet).connect(limiter);
    limiter.connect(volume);
  } else input.connect(volume);
  volume.connect(destination);
  return {
    input,
    volume,
    fade(to, seconds = 0.25, at = ctx.currentTime) {
      volume.gain.cancelScheduledValues(at);
      volume.gain.setTargetAtTime(to, at, seconds / 3);
    },
    disconnect() {
      volume.disconnect();
    },
  };
}

// The lamp voice. set(level) follows the display level (-1 to 1).
export function createBulbVoice(ctx, output, hum = mainsHz() * 2) {
  const rows = lamp(),
    start = ctx.currentTime + 0.02,
    bank = rows.map((r) => {
      const osc = ctx.createOscillator(),
        g = ctx.createGain();
      osc.setPeriodicWave(ctx.createPeriodicWave(r.re, r.im, { disableNormalization: true }));
      osc.frequency.value = hum;
      g.gain.value = 0;
      osc.connect(g);
      return { osc, g };
    }),
    body = ctx.createGain(),
    glass = ctx.createBiquadFilter(),
    coil = ctx.createBiquadFilter(),
    soften = ctx.createBiquadFilter(),
    sizzle = ctx.createBufferSource(),
    band = ctx.createBiquadFilter(),
    gate = ctx.createGain(),
    gateDepth = ctx.createGain(),
    gateOffset = ctx.createConstantSource(),
    pulse = ctx.createOscillator(),
    sizzleLevel = ctx.createGain();
  // The filament and the glass envelope resonate; the room takes the edge off.
  glass.type = "peaking";
  glass.frequency.value = 1350;
  glass.Q.value = 1.1;
  glass.gain.value = 5;
  coil.type = "peaking";
  coil.frequency.value = 3400;
  coil.Q.value = 2;
  coil.gain.value = 2;
  soften.type = "lowpass";
  soften.frequency.value = 5500;
  soften.Q.value = 0.5;
  body.gain.value = 0.08;
  for (const b of bank) b.g.connect(body);
  // Sizzle: noise gated to a short burst at each firing, filtered high.
  const p = pulseWave(ctx);
  sizzle.buffer = noiseBuffer(ctx);
  sizzle.loop = true;
  band.type = "bandpass";
  band.frequency.value = 4200;
  band.Q.value = 0.9;
  gate.gain.value = 0;
  gateOffset.offset.value = p.mean;
  pulse.setPeriodicWave(p.wave);
  pulse.frequency.value = hum;
  gateDepth.gain.value = 1;
  pulse.connect(gateDepth).connect(gate.gain);
  gateOffset.connect(gate.gain);
  sizzleLevel.gain.value = 0;
  sizzle.connect(band).connect(gate).connect(sizzleLevel).connect(body);
  body.connect(glass).connect(coil).connect(soften).connect(output.input);
  for (const b of bank) b.osc.start(start);
  for (const node of [sizzle, pulse, gateOffset]) node.start(start);
  let active = [];
  return {
    set(level, at = ctx.currentTime) {
      const phi = firingAngle(powerAt(level)),
        x = (phi / MAX_ANGLE) * (GRID - 1),
        j = Math.min(GRID - 2, Math.floor(x)),
        f = x - j,
        next = [
          [j, (1 - f) * rows[j].gain],
          [j + 1, f * rows[j + 1].gain],
        ];
      // The display moves four times a second; the hum glides between its steps.
      for (const i of active) if (i !== j && i !== j + 1) bank[i].g.gain.setTargetAtTime(0, at, 0.1);
      for (const [i, g] of next) bank[i].g.gain.setTargetAtTime(g, at, 0.1);
      active = [j, j + 1];
      const edge = (1 - f) * rows[j].edge + f * rows[j + 1].edge,
        fade = (1 - f) * Math.min(1, rows[j].power / 0.06) + f * Math.min(1, rows[j + 1].power / 0.06);
      sizzleLevel.gain.setTargetAtTime(0.05 * edge * fade, at, 0.1);
    },
    stop(at = ctx.currentTime) {
      for (const b of bank) b.osc.stop(at + 0.05);
      for (const node of [sizzle, pulse, gateOffset]) node.stop(at + 0.05);
    },
  };
}

// --- Shared pieces for the meter and the box ---------------------------------
// A short knock: filtered noise, struck and dying away.
function knock(ctx, into, noise, at, freq, q, peak, decay, length = Math.min(0.3, decay * 12)) {
  const source = ctx.createBufferSource(),
    band = ctx.createBiquadFilter(),
    g = ctx.createGain();
  source.buffer = noise;
  band.type = "bandpass";
  band.frequency.value = freq;
  band.Q.value = q;
  g.gain.setValueAtTime(peak, at);
  g.gain.setTargetAtTime(0, at + 0.001, decay);
  source.connect(band).connect(g).connect(into);
  // A different stretch of the noise each time, so no two knocks are alike.
  source.start(at, Math.random() * Math.max(0, noise.duration - length));
  source.stop(at + length);
}

// --- The needle meter -------------------------------------------------------
// The tone for a needle at z, and the roll-off that keeps it rounded there.
export const meterPitch = (z) => 432 * 2 ** (Math.max(-4.4, Math.min(4.4, z)) / 4);
const rollFor = (f) => Math.min(2800, 3.2 * f);
// The meter's voice. follow(z, singing) follows the needle as drawn; contact()
// closes the set-point contact; pin() is the needle against a stop pin.
export function createMeterVoice(ctx, output, hum = mainsHz() * 2) {
  const start = ctx.currentTime + 0.02,
    out = ctx.createGain(),
    limiter = ctx.createDynamicsCompressor(),
    wet = ctx.createGain(),
    reverb = room(ctx, 0.6, 0.12, 0.3);
  out.gain.value = 0;
  limiter.threshold.value = -18;
  limiter.ratio.value = 4;
  wet.gain.value = 0.22;
  out.connect(limiter);
  out.connect(reverb).connect(wet).connect(limiter);
  limiter.connect(output.input);
  // The singing voice: two slightly detuned oscillators with soft, falling
  // harmonics, through a warm resonance and a gentle roll-off.
  const wave = ctx.createPeriodicWave(new Float32Array(7), new Float32Array([0, 1, 0.38, 0.17, 0.08, 0.035, 0.015])),
    main = ctx.createOscillator(),
    second = ctx.createOscillator(),
    secondLevel = ctx.createGain(),
    waver = ctx.createOscillator(),
    waverMain = ctx.createGain(),
    waverSecond = ctx.createGain(),
    clean = ctx.createBiquadFilter(),
    vowel = ctx.createBiquadFilter(),
    roll = ctx.createBiquadFilter(),
    voice = ctx.createGain(),
    rest = meterPitch(0);
  main.setPeriodicWave(wave);
  second.setPeriodicWave(wave);
  main.frequency.value = rest;
  second.frequency.value = rest + 0.9;
  secondLevel.gain.value = 0.55;
  waver.frequency.value = 4.6;
  waverMain.gain.value = waverSecond.gain.value = rest * 0.0035;
  waver.connect(waverMain).connect(main.frequency);
  waver.connect(waverSecond).connect(second.frequency);
  clean.type = "highpass";
  clean.frequency.value = 70;
  vowel.type = "peaking";
  vowel.frequency.value = 700;
  vowel.Q.value = 0.9;
  vowel.gain.value = 3;
  roll.type = "lowpass";
  roll.frequency.value = rollFor(rest);
  roll.Q.value = 0.5;
  voice.gain.value = 0;
  main.connect(clean);
  second.connect(secondLevel).connect(clean);
  clean.connect(vowel).connect(roll).connect(voice).connect(out);
  // The meter lamp's supply.
  const supply = ctx.createOscillator(),
    supplyLevel = ctx.createGain(),
    re = new Float32Array(6),
    im = new Float32Array(6);
  for (let k = 1; k < 6; k++) im[k] = 0.55 ** (k - 1);
  supply.setPeriodicWave(ctx.createPeriodicWave(re, im, { disableNormalization: true }));
  supply.frequency.value = hum;
  supplyLevel.gain.value = 0.006;
  supply.connect(supplyLevel).connect(out);
  const running = [main, second, waver, supply];
  for (const node of running) node.start(start);
  out.gain.setTargetAtTime(0.75, start, 0.5);
  const noise = noiseBuffer(ctx, 1);
  // A small electric bell struck once: inharmonic partials ringing down.
  function bell(at, base = 1180, peak = 0.2) {
    for (const [ratio, level, decay] of [
      [1, 1, 1.2],
      [2.76, 0.45, 0.55],
      [5.4, 0.2, 0.28],
      [8.93, 0.08, 0.14],
    ]) {
      const osc = ctx.createOscillator(),
        g = ctx.createGain();
      osc.frequency.value = base * ratio;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak * level, at + 0.002);
      g.gain.setTargetAtTime(0, at + 0.002, decay / 3);
      osc.connect(g).connect(out);
      osc.start(at);
      osc.stop(at + decay * 3);
    }
  }
  return {
    // z as the needle is drawn; it sings only while a part runs.
    follow(z, singing, at = ctx.currentTime) {
      const f = meterPitch(z);
      main.frequency.setTargetAtTime(f, at, 0.06);
      second.frequency.setTargetAtTime(f + 0.9, at, 0.06);
      roll.frequency.setTargetAtTime(rollFor(f), at, 0.06);
      waverMain.gain.setTargetAtTime(f * 0.0035, at, 0.2);
      waverSecond.gain.setTargetAtTime(f * 0.0035, at, 0.2);
      voice.gain.setTargetAtTime(singing ? 0.075 : 0, at, singing ? 0.35 : 0.6);
    },
    // The contacts close: the relay pulls in, then the bell.
    contact(at = ctx.currentTime) {
      knock(ctx, out, noise, at, 420, 2, 0.5, 0.018);
      knock(ctx, out, noise, at + 0.006, 2600, 6, 0.6, 0.004);
      bell(at + 0.03);
    },
    // The needle against a stop pin.
    pin(at = ctx.currentTime) {
      knock(ctx, out, noise, at, 3600, 8, 0.35, 0.003);
      knock(ctx, out, noise, at, 900, 3, 0.15, 0.01);
    },
    stop(at = ctx.currentTime) {
      for (const node of running) node.stop(at + 0.05);
    },
  };
}

// --- The box ----------------------------------------------------------------
// Pink noise (Paul Kellet's filter).
function pink(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds),
    b = ctx.createBuffer(1, n, ctx.sampleRate),
    d = b.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + v * 0.0555179;
    b1 = 0.99332 * b1 + v * 0.0750759;
    b2 = 0.969 * b2 + v * 0.153852;
    b3 = 0.8665 * b3 + v * 0.3104856;
    b4 = 0.55 * b4 + v * 0.5329522;
    b5 = -0.7616 * b5 - v * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + v * 0.5362) * 0.11;
    b6 = v * 0.115926;
  }
  return b;
}
// The odd crackle of a record: sparse, soft, at random.
function crackle(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds),
    b = ctx.createBuffer(1, n, ctx.sampleRate),
    d = b.getChannelData(0);
  for (let i = 0; i < n - 64; i++)
    if (Math.random() < 3 / ctx.sampleRate) {
      const a = Math.random() ** 2 * 0.9,
        len = 6 + ((Math.random() * 36) | 0);
      for (let k = 0; k < len; k++) d[i + k] += a * (Math.random() * 2 - 1) * Math.exp(-k / 5);
    }
  return b;
}
// The drone's two tones and their beat, the same from start to end.
export const BOX_BEAT = Object.freeze({ base: 110, beat: 10 });
// The box's voice. phones(on) sends one tone to each ear; knob() is the Ask
// knob's detent; opening() is the reveal, in time with the picture.
export function createBoxVoice(ctx, output, { phones = false, level = 0.62, purr = 0.07, hum = mainsHz() * 2 } = {}) {
  const now = ctx.currentTime + 0.02,
    { base, beat } = BOX_BEAT,
    out = ctx.createGain(),
    warm = ctx.createBiquadFilter(),
    comp = ctx.createDynamicsCompressor();
  out.gain.value = 0;
  warm.type = "lowpass";
  warm.frequency.value = 4600;
  warm.Q.value = 0.4;
  comp.threshold.value = -22;
  comp.ratio.value = 3;
  out.connect(warm).connect(comp).connect(output.input);
  // The drone holds one level from start to end: a swell could be taken for an
  // answer, and the box gives none.
  const body = ctx.createGain();
  body.gain.value = 0.78;
  body.connect(out);
  // Two warm tones whose difference is the beat.
  const wave = ctx.createPeriodicWave(new Float32Array([0, 1, 0.3, 0.11, 0.045, 0.02]), new Float32Array(6)),
    a = ctx.createOscillator(),
    b = ctx.createOscillator(),
    ga = ctx.createGain(),
    gb = ctx.createGain(),
    pa = ctx.createStereoPanner(),
    pb = ctx.createStereoPanner();
  a.setPeriodicWave(wave);
  b.setPeriodicWave(wave);
  a.frequency.value = base;
  b.frequency.value = base + beat;
  ga.gain.value = gb.gain.value = 0.12;
  a.connect(ga).connect(pa).connect(body);
  b.connect(gb).connect(pb).connect(body);
  // A fifth above, faint, with a slow theremin-like waver.
  const fifth = ctx.createOscillator(),
    waver = ctx.createOscillator(),
    waverDepth = ctx.createGain(),
    gf = ctx.createGain();
  fifth.frequency.value = base * 1.5;
  waver.frequency.value = 0.23;
  waverDepth.gain.value = 0.7;
  waver.connect(waverDepth).connect(fifth.frequency);
  gf.gain.value = 0.03;
  fifth.connect(gf).connect(body);
  // The purr of a clockwork governor, pulsing at the beat.
  const purrSource = ctx.createBufferSource(),
    purrBand = ctx.createBiquadFilter(),
    purrGate = ctx.createGain(),
    pulse = ctx.createOscillator(),
    pulseDepth = ctx.createGain(),
    pulseOffset = ctx.createConstantSource(),
    purrLevel = ctx.createGain();
  purrSource.buffer = pink(ctx, 4);
  purrSource.loop = true;
  purrBand.type = "bandpass";
  purrBand.frequency.value = 480;
  purrBand.Q.value = 0.9;
  purrGate.gain.value = 0;
  pulse.frequency.value = beat;
  pulseDepth.gain.value = 0.5;
  pulseOffset.offset.value = 0.5;
  pulse.connect(pulseDepth).connect(purrGate.gain);
  pulseOffset.connect(purrGate.gain);
  purrLevel.gain.value = purr;
  purrSource.connect(purrBand).connect(purrGate).connect(purrLevel).connect(body);
  // Gramophone hiss and crackle, and the amplifier's mains hum.
  const hiss = ctx.createBufferSource(),
    hissFilter = ctx.createBiquadFilter(),
    hissLevel = ctx.createGain(),
    crack = ctx.createBufferSource(),
    crackFilter = ctx.createBiquadFilter(),
    crackLevel = ctx.createGain(),
    mains = ctx.createOscillator(),
    mainsLevel = ctx.createGain();
  hiss.buffer = pink(ctx, 5);
  hiss.loop = true;
  hissFilter.type = "highpass";
  hissFilter.frequency.value = 900;
  hissLevel.gain.value = 0.022;
  hiss.connect(hissFilter).connect(hissLevel).connect(out);
  crack.buffer = crackle(ctx, 9);
  crack.loop = true;
  crackFilter.type = "highpass";
  crackFilter.frequency.value = 1200;
  crackLevel.gain.value = 0.1;
  crack.connect(crackFilter).connect(crackLevel).connect(out);
  mains.frequency.value = hum;
  mainsLevel.gain.value = 0.007;
  mains.connect(mainsLevel).connect(out);
  const running = [a, b, waver, fifth, purrSource, pulse, pulseOffset, hiss, crack, mains];
  for (const node of running) node.start(now);
  out.gain.setTargetAtTime(level, now, 1.4);
  const noise = pink(ctx, 2),
    burst = (at, freq, q, peak, decay) => knock(ctx, out, noise, at, freq, q, peak, decay, 0.25);
  // Old hinges: stick-slip pulses rung through a wooden body.
  function creak(at, seconds, peak = 0.5) {
    const osc = ctx.createOscillator(),
      shaper = ctx.createWaveShaper(),
      body = ctx.createBiquadFilter(),
      soften = ctx.createBiquadFilter(),
      g = ctx.createGain(),
      curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = i / 511.5 - 1;
      curve[i] = x > 0.82 ? (x - 0.82) / 0.18 : 0;
    }
    shaper.curve = curve;
    osc.type = "sawtooth";
    let f = 58;
    for (let s = 0; s < seconds; s += 0.035) {
      f = Math.max(38, Math.min(150, f + (Math.random() - 0.42) * 18));
      osc.frequency.setValueAtTime(f, at + s);
    }
    body.type = "bandpass";
    body.frequency.value = 820;
    body.Q.value = 3.2;
    soften.type = "lowpass";
    soften.frequency.value = 2600;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.15);
    g.gain.setValueAtTime(peak, at + seconds * 0.7);
    g.gain.linearRampToValueAtTime(0, at + seconds);
    osc.connect(shaper).connect(body).connect(soften).connect(g).connect(out);
    osc.start(at);
    osc.stop(at + seconds + 0.05);
  }
  const voice = {
    // Headphones: one tone to each ear. Speakers: both tones in both.
    phones(on, at = ctx.currentTime) {
      pa.pan.setTargetAtTime(on ? -1 : 0, at, 0.3);
      pb.pan.setTargetAtTime(on ? 1 : 0, at, 0.3);
    },
    // The Ask knob clicks into its next detent.
    knob(at = ctx.currentTime) {
      burst(at + 0.02, 2600, 7, 0.35, 0.004);
      burst(at + 0.05, 1400, 5, 0.25, 0.006);
    },
    // The reveal, in time with the picture: two latches, the wax cracking
    // along the join, the hinges, then the lid at its stop.
    opening(at = ctx.currentTime) {
      for (const t of [0.2, 0.42]) {
        burst(at + t, 1500, 4, 0.7, 0.012);
        burst(at + t + 0.004, 3800, 8, 0.4, 0.004);
      }
      burst(at + 0.62, 900, 2.5, 0.55, 0.02);
      for (let i = 0; i < 4; i++) burst(at + 0.63 + i * 0.018, 2600 + Math.random() * 1600, 3, 0.18, 0.006);
      creak(at + 0.9, 1.45, 0.42);
      burst(at + 2.5, 180, 1.2, 0.6, 0.09);
      burst(at + 2.51, 620, 2, 0.22, 0.03);
    },
    stop(at = ctx.currentTime) {
      for (const node of running) node.stop(at + 0.05);
    },
  };
  voice.phones(phones, now);
  return voice;
}

// --- The app's player -------------------------------------------------------
let context = null;
// Browsers start sound only after the person interacts with the page. Call this
// from a click; any later click or key press resumes a suspended context, for
// example after the page was reloaded during a session.
export function unlockSound() {
  try {
    context ??= new AudioContext({ latencyHint: "playback" });
    if (context.state === "suspended") context.resume().catch(() => {});
  } catch {
    context = null;
  }
}
const resume = () => {
  if (context?.state === "suspended") context.resume().catch(() => {});
};
document.addEventListener("pointerdown", resume, true);
document.addEventListener("keydown", resume, true);
// How loud each game plays. The meter and the box carry their own levels.
const LOUD = { Bulb: 0.75, Bar: 1, Box: 1 };
// One running instrument sound. It is silent while the page is hidden or the
// instrument is out of view. voice is the game's own voice, which does nothing
// once the sound has stopped: set(level) for the Bulb; follow, contact and pin
// for the Bar; knob, opening and phones for the Box.
export function startSound(game, { phones = false } = {}) {
  unlockSound();
  if (!context) return null;
  const output = createOutput(context, context.destination, { shared: game === "Bulb" }),
    own =
      game === "Bulb"
        ? createBulbVoice(context, output)
        : game === "Bar"
          ? createMeterVoice(context, output)
          : createBoxVoice(context, output, { phones }),
    loud = LOUD[game] ?? 0.75;
  let shown = true,
    stopped = false;
  const level = () => (shown && !document.hidden ? loud : 0),
    onVisibility = () => output.fade(level(), 0.2),
    voice = Object.fromEntries(
      Object.entries(own)
        .filter(([name]) => name !== "stop")
        .map(([name, f]) => [name, (...args) => (stopped ? undefined : f(...args))]),
    );
  document.addEventListener("visibilitychange", onVisibility);
  output.fade(level(), 0.4);
  return {
    voice,
    audible(on) {
      if (stopped || shown === !!on) return;
      shown = !!on;
      output.fade(level(), 0.2);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      output.fade(0, 0.3);
      own.stop(context.currentTime + 0.6);
      setTimeout(() => output.disconnect(), 900);
    },
  };
}
