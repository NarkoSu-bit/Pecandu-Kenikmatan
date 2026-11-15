// Sound, synthesized: every effect is WebAudio oscillators and filtered
// noise, so the game ships no audio files and loads nothing over the network.
// The context starts on the first user gesture; every call before that is a
// silent no-op. Volumes are kept low and distance-attenuated for enemy shots.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let enabled = true;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      enabled = false;
      return false;
    }
    return true;
  }

  function tone(freq, dur, type, gain, slideTo = 0, when = 0) {
    if (!ensure() || !enabled) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, filterFreq, gain, type = 'lowpass', when = 0) {
    if (!ensure() || !enabled) return;
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const SHOTS = {
    pistol: () => {
      noise(0.09, 1800, 0.5);
      tone(180, 0.08, 'square', 0.25, 70);
    },
    rifle: () => {
      noise(0.12, 1400, 0.65);
      tone(140, 0.1, 'square', 0.3, 60);
    },
    smg: () => {
      noise(0.07, 2200, 0.45);
      tone(220, 0.06, 'square', 0.2, 90);
    },
    dmr: () => {
      noise(0.22, 900, 0.8);
      tone(110, 0.18, 'square', 0.35, 45);
    },
  };

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },
    shot(id, distance = 0) {
      const fn = SHOTS[id] ?? SHOTS.rifle;
      if (distance > 0) {
        // Enemy fire: quieter and duller with distance, never silent.
        const k = Math.max(0.12, 1 - distance / 55);
        if (!ensure() || !enabled) return;
        const t0 = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 900;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.5 * k, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
        src.connect(filter);
        filter.connect(g);
        g.connect(master);
        src.start(t0);
        src.stop(t0 + 0.14);
        return;
      }
      fn();
    },
    dryFire() {
      tone(900, 0.04, 'square', 0.12);
    },
    reload() {
      tone(500, 0.05, 'square', 0.15);
      tone(350, 0.05, 'square', 0.15, 0, 0.25);
      tone(650, 0.05, 'square', 0.18, 0, 0.55);
    },
    hit() {
      tone(1400, 0.05, 'sine', 0.25);
    },
    kill() {
      tone(1400, 0.05, 'sine', 0.25);
      tone(1800, 0.08, 'sine', 0.25, 0, 0.07);
    },
    hurt() {
      tone(120, 0.15, 'sawtooth', 0.3, 60);
      noise(0.12, 500, 0.25);
    },
    step() {
      noise(0.05, 700, 0.08);
    },
    plantBeep() {
      tone(880, 0.09, 'sine', 0.3);
    },
    bombTick() {
      tone(1100, 0.05, 'sine', 0.2);
    },
    explosion() {
      noise(0.9, 300, 0.9);
      tone(70, 0.8, 'sine', 0.5, 30);
    },
    roundWin() {
      tone(523, 0.14, 'sine', 0.3);
      tone(659, 0.14, 'sine', 0.3, 0, 0.14);
      tone(784, 0.24, 'sine', 0.3, 0, 0.28);
    },
    roundLoss() {
      tone(392, 0.16, 'sine', 0.3);
      tone(330, 0.16, 'sine', 0.3, 0, 0.16);
      tone(262, 0.3, 'sine', 0.3, 0, 0.32);
    },
    buy() {
      tone(1200, 0.06, 'sine', 0.25);
      tone(1600, 0.09, 'sine', 0.25, 0, 0.06);
    },
    defuse() {
      tone(1000, 0.05, 'sine', 0.2);
      tone(1000, 0.05, 'sine', 0.2, 0, 0.15);
    },
  };
}
