class SoundFX {
  private ctx: AudioContext | null = null;

  private getCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private tone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.08, delay = 0) {
    const ctx = this.getCtx();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  diceRoll() {
    this.tone(240, 0.06, 'triangle', 0.06, 0);
    this.tone(320, 0.06, 'triangle', 0.06, 0.06);
    this.tone(420, 0.08, 'sine', 0.07, 0.12);
  }

  tokenStep() {
    this.tone(520, 0.09, 'sine', 0.07, 0);
  }

  tokenCapture() {
    this.tone(660, 0.1, 'triangle', 0.09, 0);
    this.tone(880, 0.16, 'triangle', 0.09, 0.08);
  }

  coinEarned() {
    this.tone(880, 0.08, 'sine', 0.07, 0);
    this.tone(1174, 0.16, 'sine', 0.08, 0.07);
  }

  victory() {
    this.tone(523.25, 0.14, 'triangle', 0.09, 0);
    this.tone(659.25, 0.14, 'triangle', 0.09, 0.12);
    this.tone(783.99, 0.14, 'triangle', 0.09, 0.24);
    this.tone(1046.5, 0.35, 'triangle', 0.1, 0.36);
  }

  ring() {
    this.tone(440, 0.18, 'sine', 0.06, 0);
    this.tone(554.37, 0.22, 'sine', 0.06, 0.18);
  }
}

export const soundFx = new SoundFX();
