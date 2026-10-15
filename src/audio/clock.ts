export interface LoopRegion {
  start: number;
  end: number;
}

/**
 * 再生位置の計算だけを担う。AudioBufferSourceNode は再生中の位置を返さないため、
 * 開始位置、開始時刻、再生レートから位置を求める。時刻は AudioContext.currentTime の秒。
 */
export class PlaybackClock {
  rate = 1;
  private base = 0;
  private anchor = 0;
  private playing = false;
  private region: LoopRegion | null = null;

  constructor(readonly duration: number) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  get loop(): LoopRegion | null {
    return this.region;
  }

  positionAt(now: number): number {
    if (!this.playing) return this.base;
    let position = this.base + (now - this.anchor) * this.rate;
    const loop = this.region;
    if (loop && position >= loop.end) {
      const length = loop.end - loop.start;
      position = loop.start + ((position - loop.start) % length);
    }
    return Math.min(position, this.duration);
  }

  /** ループなしで曲の終わりに達したか。 */
  hasEnded(now: number): boolean {
    if (!this.playing || this.region) return false;
    return this.base + (now - this.anchor) * this.rate >= this.duration;
  }

  play(now: number): void {
    if (this.playing) return;
    this.anchor = now;
    this.playing = true;
  }

  pause(now: number): void {
    if (!this.playing) return;
    this.base = this.positionAt(now);
    this.playing = false;
  }

  seek(now: number, position: number): void {
    this.base = Math.min(Math.max(position, 0), this.duration);
    this.anchor = now;
  }

  setRate(now: number, rate: number): void {
    this.reanchor(now);
    this.rate = rate;
  }

  setLoop(now: number, loop: LoopRegion | null): void {
    this.reanchor(now);
    this.region = loop;
    // ループの終端より先にいるときは、ループの先頭へ折り返す。
    if (loop && this.base >= loop.end) this.base = loop.start;
  }

  private reanchor(now: number): void {
    this.base = this.positionAt(now);
    this.anchor = now;
  }
}
