import { beforeEach, describe, expect, it } from 'vitest';
import { Deck } from './deck';

/** Deck が触る範囲だけを模した AudioContext。時刻は手で進める。 */
class FakeSource {
  buffer: unknown = null;
  playbackRate = { value: 1, setValueAtTime: (v: number) => void (this.playbackRate.value = v) };
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  connect() {}
  disconnect() {}
  start(_when: number, offset: number) {
    this.startedAt = offset;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeContext {
  currentTime = 0;
  sources: FakeSource[] = [];
  createGain() {
    return { connect() {}, gain: { value: 1 } };
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

const buffer = (duration: number) => ({ duration }) as unknown as AudioBuffer;

function setup() {
  const ctx = new FakeContext();
  const deck = new Deck('A', ctx as unknown as AudioContext);
  deck.load(buffer(120), 'test');
  deck.setAnalysis(120, 0.25); // 1 拍 = 0.5 秒、最初の拍は 0.25 秒
  return { ctx, deck };
}

describe('Deck の再生', () => {
  let ctx: FakeContext;
  let deck: Deck;
  beforeEach(() => ({ ctx, deck } = setup()));

  it('時刻に応じて位置が進み、ポーズで止まる', () => {
    deck.seek(10);
    deck.play();
    ctx.currentTime = 2;
    expect(deck.position).toBeCloseTo(12);
    deck.pause();
    ctx.currentTime = 5;
    expect(deck.position).toBeCloseTo(12);
  });

  it('曲を読み込み直すとキューとホットキューと BPM を捨てる', () => {
    deck.seek(10);
    deck.hotcue(0);
    deck.load(buffer(60), 'next');
    expect(deck.hotcues.every((c) => c === null)).toBe(true);
    expect(deck.bpm).toBeNull();
    expect(deck.cuePoint).toBe(0);
  });

  it('解析が終わるとキューポイントを最初の拍に置く', () => {
    expect(deck.cuePoint).toBe(0.25);
  });
});

describe('Cue（CDJ 方式）', () => {
  let ctx: FakeContext;
  let deck: Deck;
  beforeEach(() => ({ ctx, deck } = setup()));

  it('再生中に押すとキューポイントへ戻って止まる', () => {
    deck.seek(30);
    deck.play();
    ctx.currentTime = 1;
    deck.cuePress();
    expect(deck.playing).toBe(false);
    expect(deck.position).toBeCloseTo(0.25);
  });

  it('キューポイント上で押している間だけ再生し、離すと戻る', () => {
    deck.seek(deck.cuePoint);
    deck.cuePress();
    expect(deck.playing).toBe(true);
    ctx.currentTime = 0.8;
    expect(deck.position).toBeCloseTo(1.05);
    deck.cueRelease();
    expect(deck.playing).toBe(false);
    expect(deck.position).toBeCloseTo(0.25);
  });

  it('止まっていてキューポイントから離れていれば、そこを新しいキューポイントにする', () => {
    deck.seek(7.5);
    deck.cuePress();
    expect(deck.cuePoint).toBeCloseTo(7.5);
    expect(deck.playing).toBe(false);
  });

  it('Cue を押したまま Play を押すと、離しても再生が続く', () => {
    deck.seek(deck.cuePoint);
    deck.cuePress();
    deck.togglePlay();
    deck.cueRelease();
    expect(deck.playing).toBe(true);
  });
});

describe('ホットキュー', () => {
  it('空きなら位置に打ち、打ってあれば飛んで再生する', () => {
    const { ctx, deck } = setup();
    deck.seek(20);
    deck.hotcue(2);
    expect(deck.hotcues[2]).toBeCloseTo(20);
    expect(deck.playing).toBe(false);

    deck.seek(0);
    deck.hotcue(2);
    ctx.currentTime = 1;
    expect(deck.playing).toBe(true);
    expect(deck.position).toBeCloseTo(21);
  });

  it('削除できる', () => {
    const { deck } = setup();
    deck.seek(20);
    deck.hotcue(0);
    deck.clearHotcue(0);
    expect(deck.hotcues[0]).toBeNull();
  });

  it('範囲外の番号は無視する', () => {
    const { deck } = setup();
    expect(() => deck.hotcue(99)).not.toThrow();
    expect(() => deck.clearHotcue(-1)).not.toThrow();
  });
});

describe('ループとビートジャンプ', () => {
  it('ビートループは拍に揃って入り、同じ長さをもう一度押すと解除される', () => {
    const { deck } = setup();
    deck.seek(10.3);
    deck.beatLoop(4);
    expect(deck.loop?.start).toBeCloseTo(10.25);
    expect(deck.loop?.end).toBeCloseTo(12.25);
    deck.beatLoop(4);
    expect(deck.loop).toBeNull();
  });

  it('別の長さを押すとループを入れ替える', () => {
    const { deck } = setup();
    deck.seek(10.3);
    deck.beatLoop(4);
    deck.beatLoop(2);
    expect(deck.loop && deck.loop.end - deck.loop.start).toBeCloseTo(1);
  });

  it('BPM が分からないときはループもジャンプもしない', () => {
    const ctx = new FakeContext();
    const deck = new Deck('B', ctx as unknown as AudioContext);
    deck.load(buffer(60), 'no-bpm');
    deck.seek(10);
    deck.beatLoop(4);
    deck.beatJump(4);
    expect(deck.loop).toBeNull();
    expect(deck.position).toBe(10);
  });

  it('ビートジャンプで拍の数だけ位置が動く', () => {
    const { deck } = setup();
    deck.seek(10);
    deck.beatJump(4);
    expect(deck.position).toBeCloseTo(12);
    deck.beatJump(-8);
    expect(deck.position).toBeCloseTo(8);
  });

  it('ループ中のビートジャンプはループごと動く', () => {
    const { deck } = setup();
    deck.seek(10.3);
    deck.beatLoop(4);
    deck.beatJump(4);
    expect(deck.loop?.start).toBeCloseTo(12.25);
    expect(deck.loop?.end).toBeCloseTo(14.25);
    expect(deck.position).toBeCloseTo(12.3);
  });

  it('曲の外へ出るジャンプは何もしない', () => {
    const { deck } = setup();
    deck.seek(1);
    deck.beatJump(-8);
    expect(deck.position).toBeCloseTo(1);
    deck.seek(119);
    deck.beatJump(8);
    expect(deck.position).toBeCloseTo(119);
  });

  it('ループを入れても再生中のノードを作り直さない', () => {
    const { ctx, deck } = setup();
    deck.seek(10.3);
    deck.play();
    const count = ctx.sources.length;
    deck.beatLoop(4);
    expect(ctx.sources).toHaveLength(count);
    const source = ctx.sources.at(-1)!;
    expect(source.loop).toBe(true);
    expect(source.loopEnd).toBeCloseTo(12.25);
  });
});

describe('手動ループ', () => {
  it('ループインとアウトで、その区間のループが入る', () => {
    const { ctx, deck } = setup();
    deck.seek(10);
    deck.loopIn();
    expect(deck.loop).toBeNull();
    expect(deck.loopInPoint).toBeCloseTo(10);
    deck.play();
    ctx.currentTime = 1.5;
    deck.loopOut();
    expect(deck.loopInPoint).toBeNull();
    expect(deck.loop?.start).toBeCloseTo(10);
    expect(deck.loop?.end).toBeCloseTo(11.5);
    ctx.currentTime = 2.5;
    expect(deck.position).toBeGreaterThanOrEqual(10);
    expect(deck.position).toBeLessThan(11.5);
  });

  it('ループインなしのアウトは何もしない', () => {
    const { deck } = setup();
    deck.seek(10);
    deck.loopOut();
    expect(deck.loop).toBeNull();
  });

  it('短すぎる区間は受け付けない', () => {
    const { deck } = setup();
    deck.seek(10);
    deck.loopIn();
    deck.loopOut();
    expect(deck.loop).toBeNull();
    expect(deck.loopInPoint).toBeCloseTo(10);
  });

  it('ループ中のインとアウトは、始点と終点だけを動かす', () => {
    const { ctx, deck } = setup();
    deck.seek(10);
    deck.loopIn();
    deck.seek(12);
    deck.loopOut();
    expect(deck.loop).toEqual({ start: 10, end: 12 });

    deck.seek(10.5);
    deck.loopIn();
    expect(deck.loop).toEqual({ start: 10.5, end: 12 });

    deck.play();
    ctx.currentTime = 0.5;
    deck.loopOut();
    expect(deck.loop?.start).toBeCloseTo(10.5);
    expect(deck.loop?.end).toBeCloseTo(11);
  });

  it('解除はループイン待ちの始点も取り消す', () => {
    const { deck } = setup();
    deck.seek(10);
    deck.loopIn();
    deck.exitLoop();
    expect(deck.loopInPoint).toBeNull();
    deck.seek(12);
    deck.loopOut();
    expect(deck.loop).toBeNull();
  });

  it('曲を替えるとループイン待ちを捨てる', () => {
    const { deck } = setup();
    deck.seek(10);
    deck.loopIn();
    deck.load(buffer(60), 'next');
    expect(deck.loopInPoint).toBeNull();
  });
});

describe('テンポと Sync', () => {
  it('nudge は一時的に再生レートを上下させ、0 で元に戻る', () => {
    const { deck } = setup();
    deck.setNudge(1);
    expect(deck.rate).toBeCloseTo(1.05);
    deck.setNudge(0);
    expect(deck.rate).toBe(1);
  });

  it('Sync で相手の実効テンポに合う', () => {
    const { ctx, deck } = setup();
    const other = new Deck('B', ctx as unknown as AudioContext);
    other.load(buffer(120), 'other');
    other.setAnalysis(128, 0.1);
    other.setTempoRate(1.02);
    deck.sync(other);
    expect(deck.effectiveBpm).toBeCloseTo(128 * 1.02);
  });

  it('両方が再生中なら拍の位相も揃う', () => {
    const { ctx, deck } = setup();
    const other = new Deck('B', ctx as unknown as AudioContext);
    other.load(buffer(120), 'other');
    other.setAnalysis(120, 0.4);
    deck.seek(10.1);
    other.seek(30.3);
    deck.play();
    other.play();
    deck.sync(other);
    const phase = (d: Deck) => {
      const beats = ((d.position - d.firstBeat) * d.bpm!) / 60;
      return beats - Math.floor(beats);
    };
    expect(phase(deck)).toBeCloseTo(phase(other), 6);
  });

  it('相手の BPM が分からなければ何もしない', () => {
    const { ctx, deck } = setup();
    const other = new Deck('B', ctx as unknown as AudioContext);
    other.load(buffer(60), 'no-bpm');
    deck.sync(other);
    expect(deck.rate).toBe(1);
  });
});
