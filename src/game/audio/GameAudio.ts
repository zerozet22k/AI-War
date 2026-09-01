export type GameSoundCue =
  | 'select'
  | 'bullet'
  | 'tracer'
  | 'shell'
  | 'cannon'
  | 'rocket'
  | 'missile'
  | 'flak'
  | 'artillery'
  | 'bomb'
  | 'torpedo'
  | 'laser'
  | 'plasma'
  | 'ion'
  | 'pulse'
  | 'railgun'
  | 'crystal'
  | 'shard'
  | 'acid'
  | 'meteor'
  | 'explosionSmall'
  | 'explosionLarge'
  | 'airCrash'
  | 'shipSinking'
  | 'buildingCollapse'
  | 'impact'
  | 'impactMetal'
  | 'impactHeavy'
  | 'impactEnergy'
  | 'impactCrystal'
  | 'impactAcid'
  | 'impactWater'
  | 'resourceGather'
  | 'resourceDeposit'
  | 'heal'
  | 'repair'
  | 'alert'
  | 'enemySpotted'
  | 'structureCritical'
  | 'unitCritical'
  | 'incomingOrdnance'
  | 'resourceDepleted'
  | 'uiClick'
  | 'orderMove'
  | 'orderAttack'
  | 'orderDefend'
  | 'orderRetreat'
  | 'orderScout'
  | 'abilitySpeed'
  | 'abilityWeapon'
  | 'abilityFortify'
  | 'abilitySlow'
  | 'cargoLoad'
  | 'cargoUnload'
  | 'productionStart'
  | 'unitReady'
  | 'ironcladReady'
  | 'aetherReady'
  | 'nullforgeReady'
  | 'constructionStart'
  | 'constructionComplete'
  | 'researchStart'
  | 'researchComplete'
  | 'victory'
  | 'defeat'
  | 'draw';

interface PlayOptions {
  pan?: number;
  gain?: number;
}

const STORAGE_KEY = 'ai-war-audio-muted';

const TECH_CUES = new Set<GameSoundCue>([
  'bullet', 'tracer', 'shell', 'cannon', 'rocket', 'missile', 'flak', 'artillery', 'bomb', 'torpedo',
  'laser', 'plasma', 'ion', 'pulse', 'railgun', 'crystal', 'shard', 'acid', 'meteor',
  'explosionSmall', 'explosionLarge', 'airCrash', 'shipSinking', 'buildingCollapse',
  'impact', 'impactMetal', 'impactHeavy', 'impactEnergy', 'impactCrystal', 'impactAcid', 'impactWater',
  'heal', 'repair', 'abilitySpeed', 'abilityWeapon', 'abilityFortify', 'abilitySlow',
]);

/** Small synthesized SFX engine. Keeping the source waveforms in code means
 * sounds work in packaged/offline builds without streaming a large audio
 * bundle, while the cue names give us one stable place to replace individual
 * sounds with race-pack files later. */
class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private readonly lastPlayed = new Map<GameSoundCue, number>();

  constructor() {
    if (typeof window !== 'undefined') this.muted = window.localStorage.getItem(STORAGE_KEY) === '1';
  }

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.48;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.48, this.context.currentTime, 0.015);
    }
  }

  toggleMuted(): boolean {
    this.unlock();
    this.setMuted(!this.muted);
    if (!this.muted) this.play('select');
    return this.muted;
  }

  play(cue: GameSoundCue, options: PlayOptions = {}): void {
    if (this.muted) return;
    const context = this.context;
    const master = this.master;
    // Browsers require a user gesture before audio can start. Do not create a
    // suspended context here: queued battle cues would otherwise all fire on
    // the first later click. MainScene unlocks explicitly from pointer input.
    if (!context || !master) return;

    const nowMs = performance.now();
    const cooldown = cue === 'bullet' || cue === 'tracer' || cue === 'laser' || cue === 'pulse' || cue === 'flak'
      ? 28
      : cue === 'impact' || cue.startsWith('impact')
        ? 45
        : cue === 'select' || cue === 'uiClick'
          ? 55
          : cue === 'alert' || cue === 'structureCritical' || cue === 'unitCritical' || cue === 'incomingOrdnance'
            ? 2400
            : cue === 'enemySpotted'
              ? 1500
              : cue.startsWith('order')
                ? 450
                : cue.startsWith('ability')
                  ? 160
                  : cue === 'cargoLoad' || cue === 'cargoUnload'
                    ? 280
            : cue === 'resourceGather' || cue === 'heal' || cue === 'repair'
              ? 420
              : cue.startsWith('explosion')
                ? 70
                : 90;
    if (nowMs - (this.lastPlayed.get(cue) ?? -Infinity) < cooldown) return;
    this.lastPlayed.set(cue, nowMs);

    const start = context.currentTime + 0.004;
    const bus = context.createGain();
    const color = context.createBiquadFilter();
    const drive = context.createWaveShaper();
    const compressor = context.createDynamicsCompressor();
    const panner = context.createStereoPanner();
    const delay = context.createDelay(0.25);
    const feedback = context.createGain();
    const wet = context.createGain();
    panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0));
    bus.gain.value = Math.max(0, Math.min(1.5, options.gain ?? 1));
    color.type = 'lowpass';
    color.frequency.value = TECH_CUES.has(cue) ? 11800 : 9200;
    color.Q.value = 0.42;
    drive.curve = this.softClipCurve(TECH_CUES.has(cue) ? 18 : 7);
    drive.oversample = '2x';
    compressor.threshold.value = -18;
    compressor.knee.value = 16;
    compressor.ratio.value = TECH_CUES.has(cue) ? 4 : 2.5;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.14;
    delay.delayTime.value = 0.028 + (cue.length % 5) * 0.008;
    feedback.gain.value = TECH_CUES.has(cue) ? 0.16 : 0.08;
    wet.gain.value = TECH_CUES.has(cue) ? 0.14 : 0.055;

    // Every cue gets a polished dry path plus a very short filtered echo.
    // Mild saturation and compression turn bare oscillators/noise into a
    // denser sci-fi transient without requiring streamed audio files.
    bus.connect(color).connect(drive).connect(compressor).connect(panner);
    bus.connect(delay).connect(wet).connect(panner);
    delay.connect(feedback).connect(delay);
    panner.connect(master);

    switch (cue) {
      case 'select':
        this.tone(bus, 'sine', 520, 760, start, 0.075, 0.16);
        break;
      case 'uiClick':
        this.tone(bus, 'triangle', 310, 245, start, 0.055, 0.11);
        this.tone(bus, 'sine', 620, 520, start + 0.018, 0.045, 0.05);
        break;
      case 'bullet':
        this.noise(bus, start, 0.065, 0.2, 'bandpass', 5200, 1250);
        this.fmTone(bus, 280, 68, start, 0.075, 0.09, 105, 130);
        break;
      case 'tracer':
        this.noise(bus, start, 0.045, 0.14, 'highpass', 6800, 2100);
        this.fmTone(bus, 760, 145, start, 0.065, 0.075, 180, 260);
        break;
      case 'shell':
        this.noise(bus, start, 0.19, 0.34, 'lowpass', 1900, 280);
        this.fmTone(bus, 170, 36, start, 0.22, 0.22, 74, 190);
        break;
      case 'cannon':
        this.noise(bus, start, 0.36, 0.45, 'lowpass', 2100, 190);
        this.fmTone(bus, 125, 24, start, 0.42, 0.38, 51, 240);
        this.noise(bus, start + 0.05, 0.2, 0.13, 'bandpass', 2600, 620);
        break;
      case 'rocket':
        this.noise(bus, start, 0.34, 0.24, 'bandpass', 3600, 720);
        this.fmTone(bus, 190, 52, start, 0.31, 0.13, 68, 150);
        break;
      case 'missile':
        this.noise(bus, start, 0.38, 0.2, 'bandpass', 4200, 900);
        this.fmTone(bus, 230, 620, start, 0.3, 0.1, 93, 210);
        this.fmTone(bus, 820, 1180, start + 0.055, 0.24, 0.04, 210, 125);
        break;
      case 'flak':
        this.noise(bus, start, 0.085, 0.23, 'bandpass', 2400, 480);
        this.fmTone(bus, 390, 72, start, 0.09, 0.1, 140, 175);
        this.noise(bus, start + 0.05, 0.075, 0.13, 'highpass', 5100, 1700);
        break;
      case 'artillery':
        this.noise(bus, start, 0.5, 0.5, 'lowpass', 2300, 150);
        this.fmTone(bus, 112, 19, start, 0.54, 0.42, 43, 270);
        break;
      case 'bomb':
        this.noise(bus, start, 0.18, 0.14, 'bandpass', 1800, 430);
        this.fmTone(bus, 520, 58, start, 0.46, 0.14, 72, 165);
        this.fmTone(bus, 118, 38, start + 0.07, 0.37, 0.075, 39, 95);
        break;
      case 'torpedo':
        this.fmTone(bus, 245, 43, start, 0.34, 0.22, 37, 115);
        this.noise(bus, start, 0.28, 0.1, 'lowpass', 920, 180);
        break;
      case 'laser':
        this.fmTone(bus, 2100, 440, start, 0.13, 0.12, 310, 520);
        this.noise(bus, start, 0.085, 0.045, 'highpass', 7200, 2600);
        break;
      case 'plasma':
        this.fmTone(bus, 480, 74, start, 0.28, 0.22, 86, 310);
        this.fmTone(bus, 920, 205, start + 0.018, 0.22, 0.075, 190, 160);
        this.noise(bus, start, 0.2, 0.075, 'bandpass', 2600, 540);
        break;
      case 'ion':
        this.fmTone(bus, 1380, 180, start, 0.19, 0.12, 240, 460);
        this.noise(bus, start, 0.14, 0.07, 'highpass', 7600, 1900);
        break;
      case 'pulse':
        this.fmTone(bus, 440, 1280, start, 0.105, 0.105, 155, 280);
        this.noise(bus, start + 0.012, 0.075, 0.035, 'bandpass', 5200, 2300);
        break;
      case 'railgun':
        this.noise(bus, start, 0.11, 0.25, 'highpass', 8800, 1700);
        this.fmTone(bus, 1850, 86, start, 0.15, 0.17, 330, 620);
        this.fmTone(bus, 135, 29, start + 0.02, 0.22, 0.17, 45, 180);
        break;
      case 'crystal':
        this.fmTone(bus, 1250, 410, start, 0.2, 0.14, 267, 240);
        this.tone(bus, 'sine', 1870, 740, start + 0.02, 0.16, 0.055);
        break;
      case 'shard':
        this.fmTone(bus, 1680, 520, start, 0.15, 0.13, 345, 285);
        this.noise(bus, start + 0.02, 0.1, 0.05, 'highpass', 8200, 2900);
        break;
      case 'acid':
        this.fmTone(bus, 330, 72, start, 0.31, 0.14, 47, 175);
        this.noise(bus, start, 0.28, 0.1, 'bandpass', 1500, 310);
        break;
      case 'meteor':
        this.noise(bus, start, 0.56, 0.34, 'lowpass', 2700, 210);
        this.fmTone(bus, 175, 28, start, 0.58, 0.22, 39, 245);
        this.fmTone(bus, 680, 76, start + 0.03, 0.46, 0.075, 118, 210);
        break;
      case 'explosionSmall':
        this.noise(bus, start, 0.38, 0.4, 'lowpass', 2400, 140);
        this.fmTone(bus, 145, 24, start, 0.4, 0.27, 48, 230);
        break;
      case 'explosionLarge':
        this.noise(bus, start, 0.82, 0.62, 'lowpass', 2800, 90);
        this.fmTone(bus, 105, 17, start, 0.84, 0.5, 34, 310);
        this.noise(bus, start + 0.07, 0.58, 0.18, 'bandpass', 3400, 420);
        break;
      case 'airCrash':
        this.noise(bus, start, 0.72, 0.37, 'bandpass', 4600, 430);
        this.fmTone(bus, 760, 42, start, 0.78, 0.22, 91, 280);
        this.noise(bus, start + 0.46, 0.44, 0.34, 'lowpass', 2100, 130);
        break;
      case 'shipSinking':
        this.fmTone(bus, 142, 27, start, 0.92, 0.29, 38, 210);
        this.noise(bus, start + 0.1, 0.78, 0.3, 'lowpass', 1400, 110);
        this.fmTone(bus, 76, 19, start + 0.4, 0.7, 0.27, 25, 125);
        break;
      case 'buildingCollapse':
        this.noise(bus, start, 1.05, 0.5, 'lowpass', 2500, 80);
        this.fmTone(bus, 118, 16, start, 0.98, 0.41, 31, 285);
        this.noise(bus, start + 0.19, 0.66, 0.2, 'bandpass', 3100, 360);
        break;
      case 'impact':
        this.noise(bus, start, 0.09, 0.15, 'bandpass', 3200, 620);
        this.fmTone(bus, 230, 58, start, 0.11, 0.09, 82, 115);
        break;
      case 'impactMetal':
        this.noise(bus, start, 0.105, 0.17, 'highpass', 6200, 1400);
        this.fmTone(bus, 1580, 310, start, 0.19, 0.105, 370, 420);
        this.fmTone(bus, 260, 72, start, 0.13, 0.075, 73, 140);
        break;
      case 'impactHeavy':
        this.noise(bus, start, 0.52, 0.49, 'lowpass', 2900, 120);
        this.fmTone(bus, 116, 19, start, 0.54, 0.42, 37, 290);
        this.noise(bus, start + 0.065, 0.34, 0.14, 'bandpass', 3600, 470);
        break;
      case 'impactEnergy':
        this.fmTone(bus, 1760, 135, start, 0.22, 0.14, 315, 560);
        this.fmTone(bus, 880, 240, start + 0.018, 0.2, 0.07, 167, 210);
        this.noise(bus, start, 0.17, 0.075, 'highpass', 8400, 2100);
        break;
      case 'impactCrystal':
        [1860, 1320, 930].forEach((frequency, index) => this.fmTone(bus, frequency, frequency * 0.66, start + index * 0.024, 0.18, 0.07, frequency * 0.19, frequency * 0.22));
        this.noise(bus, start + 0.015, 0.14, 0.055, 'highpass', 9200, 2800);
        break;
      case 'impactAcid':
        this.noise(bus, start, 0.38, 0.16, 'bandpass', 1900, 260);
        this.fmTone(bus, 280, 51, start, 0.34, 0.12, 43, 160);
        this.fmTone(bus, 620, 102, start + 0.055, 0.26, 0.055, 86, 135);
        break;
      case 'impactWater':
        this.noise(bus, start, 0.56, 0.22, 'lowpass', 1700, 100);
        this.fmTone(bus, 134, 27, start, 0.44, 0.22, 31, 130);
        this.noise(bus, start + 0.1, 0.34, 0.09, 'bandpass', 2600, 430);
        break;
      case 'resourceGather':
        this.noise(bus, start, 0.11, 0.09, 'bandpass', 1250);
        this.tone(bus, 'triangle', 190, 260, start, 0.13, 0.07);
        break;
      case 'resourceDeposit':
        [523, 659, 784].forEach((frequency, index) => this.tone(bus, 'sine', frequency, frequency, start + index * 0.055, 0.11, 0.1));
        break;
      case 'heal':
        this.tone(bus, 'sine', 420, 760, start, 0.3, 0.09);
        this.tone(bus, 'sine', 630, 1040, start + 0.07, 0.28, 0.055);
        break;
      case 'repair':
        this.noise(bus, start, 0.16, 0.085, 'highpass', 5200, 1600);
        this.fmTone(bus, 220, 340, start, 0.12, 0.075, 83, 150);
        this.fmTone(bus, 360, 180, start + 0.11, 0.14, 0.065, 117, 125);
        break;
      case 'alert':
        [740, 520, 740, 520].forEach((frequency, index) => this.fmTone(bus, frequency, frequency * 0.82, start + index * 0.16, 0.13, 0.085, 74, 150));
        this.noise(bus, start, 0.64, 0.035, 'bandpass', 4200, 980);
        break;
      case 'enemySpotted':
        this.fmTone(bus, 760, 1480, start, 0.18, 0.12, 136, 180);
        this.fmTone(bus, 390, 720, start + 0.11, 0.15, 0.06, 89, 130);
        this.fmTone(bus, 1460, 780, start + 0.24, 0.2, 0.09, 230, 200);
        break;
      case 'structureCritical':
        [180, 135, 180, 110].forEach((frequency, index) => {
          this.tone(bus, 'sawtooth', frequency, frequency * 0.82, start + index * 0.18, 0.14, 0.11);
        });
        this.noise(bus, start, 0.72, 0.08, 'bandpass', 720);
        break;
      case 'unitCritical':
        [620, 420, 620].forEach((frequency, index) => this.fmTone(bus, frequency, frequency * 0.78, start + index * 0.13, 0.12, 0.08, 67, 140));
        this.noise(bus, start + 0.02, 0.34, 0.045, 'highpass', 2400);
        break;
      case 'incomingOrdnance':
        [880, 1175, 880, 1568].forEach((frequency, index) => this.tone(bus, 'sine', frequency, frequency, start + index * 0.09, 0.07, 0.07));
        this.tone(bus, 'triangle', 190, 95, start, 0.42, 0.055);
        break;
      case 'resourceDepleted':
        this.tone(bus, 'triangle', 520, 250, start, 0.22, 0.1);
        this.tone(bus, 'sine', 330, 145, start + 0.16, 0.3, 0.08);
        this.noise(bus, start + 0.06, 0.28, 0.07, 'highpass', 1450);
        break;
      case 'orderMove':
        this.tone(bus, 'triangle', 330, 440, start, 0.1, 0.1);
        break;
      case 'orderAttack':
        this.fmTone(bus, 310, 690, start, 0.13, 0.12, 98, 180);
        this.noise(bus, start + 0.04, 0.1, 0.085, 'bandpass', 3600, 850);
        break;
      case 'orderDefend':
        this.tone(bus, 'triangle', 390, 310, start, 0.12, 0.1);
        this.tone(bus, 'sine', 260, 260, start + 0.1, 0.16, 0.07);
        break;
      case 'orderRetreat':
        [520, 390, 260].forEach((frequency, index) => this.tone(bus, 'sawtooth', frequency, frequency * 0.88, start + index * 0.1, 0.1, 0.07));
        break;
      case 'orderScout':
        this.tone(bus, 'sine', 620, 930, start, 0.12, 0.09);
        this.tone(bus, 'sine', 780, 1170, start + 0.11, 0.16, 0.07);
        break;
      case 'abilitySpeed':
        this.noise(bus, start, 0.24, 0.1, 'highpass', 2200);
        this.tone(bus, 'sawtooth', 180, 720, start, 0.22, 0.1);
        break;
      case 'abilityWeapon':
        this.fmTone(bus, 230, 980, start, 0.22, 0.13, 92, 240);
        this.fmTone(bus, 860, 1480, start + 0.07, 0.18, 0.075, 176, 160);
        break;
      case 'abilityFortify':
        this.noise(bus, start, 0.19, 0.18, 'lowpass', 680);
        this.tone(bus, 'triangle', 150, 72, start, 0.26, 0.18);
        this.tone(bus, 'sine', 300, 180, start + 0.05, 0.23, 0.08);
        break;
      case 'abilitySlow':
        this.tone(bus, 'sine', 860, 170, start, 0.34, 0.12);
        this.tone(bus, 'triangle', 430, 105, start + 0.05, 0.31, 0.08);
        break;
      case 'cargoLoad':
        this.fmTone(bus, 190, 320, start, 0.14, 0.1, 54, 130);
        this.noise(bus, start + 0.08, 0.11, 0.08, 'bandpass', 820);
        this.tone(bus, 'triangle', 260, 320, start + 0.15, 0.1, 0.06);
        break;
      case 'cargoUnload':
        this.fmTone(bus, 340, 120, start, 0.15, 0.09, 71, 135);
        this.noise(bus, start + 0.07, 0.14, 0.07, 'highpass', 1050);
        break;
      case 'productionStart':
        this.fmTone(bus, 145, 235, start, 0.2, 0.11, 42, 140);
        this.tone(bus, 'triangle', 210, 260, start + 0.09, 0.2, 0.09);
        break;
      case 'unitReady':
        this.tone(bus, 'triangle', 392, 392, start, 0.12, 0.13);
        this.tone(bus, 'triangle', 523, 523, start + 0.1, 0.12, 0.13);
        this.tone(bus, 'triangle', 784, 784, start + 0.2, 0.2, 0.15);
        break;
      case 'ironcladReady':
        this.fmTone(bus, 145, 230, start, 0.2, 0.13, 44, 145);
        this.tone(bus, 'triangle', 220, 277, start + 0.11, 0.2, 0.11);
        this.noise(bus, start + 0.04, 0.2, 0.08, 'lowpass', 850);
        break;
      case 'aetherReady':
        [659, 988, 1319].forEach((frequency, index) => this.tone(bus, 'sine', frequency * 0.82, frequency, start + index * 0.07, 0.22, 0.08));
        break;
      case 'nullforgeReady':
        [165, 247, 330].forEach((frequency, index) => this.tone(bus, index === 1 ? 'square' : 'triangle', frequency, frequency * 1.08, start + index * 0.08, 0.14, 0.09));
        this.noise(bus, start + 0.18, 0.1, 0.07, 'highpass', 1800);
        break;
      case 'constructionStart':
        this.noise(bus, start, 0.1, 0.14, 'bandpass', 900);
        this.fmTone(bus, 138, 62, start, 0.17, 0.11, 39, 130);
        break;
      case 'constructionComplete':
        this.tone(bus, 'triangle', 262, 330, start, 0.16, 0.13);
        this.tone(bus, 'triangle', 392, 523, start + 0.12, 0.26, 0.14);
        break;
      case 'researchStart':
        this.tone(bus, 'sine', 330, 660, start, 0.42, 0.1);
        this.tone(bus, 'sine', 495, 990, start + 0.06, 0.38, 0.07);
        break;
      case 'researchComplete':
        this.tone(bus, 'sine', 523, 523, start, 0.2, 0.13);
        this.tone(bus, 'sine', 659, 659, start + 0.12, 0.22, 0.13);
        this.tone(bus, 'sine', 1047, 1047, start + 0.24, 0.42, 0.16);
        break;
      case 'victory':
        [262, 330, 392, 523].forEach((frequency, index) => this.tone(bus, 'triangle', frequency, frequency, start + index * 0.16, 0.34, 0.15));
        break;
      case 'defeat':
        [294, 247, 196, 147].forEach((frequency, index) => this.tone(bus, 'sawtooth', frequency, frequency * 0.92, start + index * 0.2, 0.38, 0.1));
        break;
      case 'draw':
        [262, 311, 294, 262].forEach((frequency, index) => this.tone(bus, 'triangle', frequency, frequency, start + index * 0.18, 0.28, 0.1));
        break;
    }

    window.setTimeout(() => {
      bus.disconnect();
      color.disconnect();
      drive.disconnect();
      compressor.disconnect();
      delay.disconnect();
      feedback.disconnect();
      wet.disconnect();
      panner.disconnect();
    }, 2400);
  }

  private tone(
    destination: AudioNode,
    type: OscillatorType,
    from: number,
    to: number,
    start: number,
    duration: number,
    volume: number,
  ): void {
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    oscillator.type = type;
    const pitchDrift = 0.985 + Math.random() * 0.03;
    oscillator.frequency.setValueAtTime(from * pitchDrift, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to * pitchDrift), start + duration);
    oscillator.detune.value = (Math.random() - 0.5) * 9;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(14000, Math.max(950, Math.max(from, to) * 3.1)), start);
    filter.frequency.exponentialRampToValueAtTime(Math.min(12000, Math.max(700, Math.min(from, to) * 4.2)), start + duration);
    filter.Q.value = type === 'square' || type === 'sawtooth' ? 0.9 : 0.45;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), start + Math.min(0.009, duration * 0.14));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(filter).connect(envelope).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
  }

  /** Frequency modulation produces the inharmonic metallic/energy timbre
   * missing from simple game-console oscillator sweeps. */
  private fmTone(
    destination: AudioNode,
    from: number,
    to: number,
    start: number,
    duration: number,
    volume: number,
    modulationFrequency: number,
    modulationDepth: number,
  ): void {
    if (!this.context) return;
    const carrier = this.context.createOscillator();
    const modulator = this.context.createOscillator();
    const modulation = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    carrier.type = 'sine';
    modulator.type = 'sine';
    carrier.frequency.setValueAtTime(from, start);
    carrier.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
    modulator.frequency.setValueAtTime(modulationFrequency * 1.18, start);
    modulator.frequency.exponentialRampToValueAtTime(Math.max(1, modulationFrequency * 0.72), start + duration);
    modulation.gain.setValueAtTime(modulationDepth, start);
    modulation.gain.exponentialRampToValueAtTime(Math.max(1, modulationDepth * 0.08), start + duration);
    const bassTransient = Math.max(from, to) < 350;
    filter.type = bassTransient ? 'lowpass' : 'bandpass';
    filter.frequency.setValueAtTime(
      bassTransient ? Math.max(700, from * 5) : Math.min(12000, Math.max(380, from * 1.35)),
      start,
    );
    filter.frequency.exponentialRampToValueAtTime(
      bassTransient ? Math.max(180, to * 5) : Math.min(10000, Math.max(260, to * 1.7)),
      start + duration,
    );
    filter.Q.value = bassTransient ? 0.5 : 0.75;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), start + Math.min(0.008, duration * 0.12));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    modulator.connect(modulation).connect(carrier.frequency);
    carrier.connect(filter).connect(envelope).connect(destination);
    carrier.start(start);
    modulator.start(start);
    carrier.stop(start + duration + 0.01);
    modulator.stop(start + duration + 0.01);
  }

  private noise(
    destination: AudioNode,
    start: number,
    duration: number,
    volume: number,
    filterType: BiquadFilterType,
    frequency: number,
    endFrequency = frequency,
  ): void {
    if (!this.context) return;
    if (!this.noiseBuffer) {
      const length = this.context.sampleRate * 2;
      this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = 0.92 + Math.random() * 0.16;
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    filter.Q.value = filterType === 'bandpass' ? 1.4 : 0.7;
    envelope.gain.setValueAtTime(Math.max(0.001, volume), start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(envelope).connect(destination);
    source.start(start);
    source.stop(start + duration + 0.01);
  }

  private softClipCurve(amount: number): Float32Array<ArrayBuffer> {
    const samples = 512;
    const curve = new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT));
    const radians = Math.PI / 180;
    for (let index = 0; index < samples; index += 1) {
      const x = (index * 2) / (samples - 1) - 1;
      curve[index] = ((3 + amount) * x * 20 * radians) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }
}

export const gameAudio = new GameAudio();
