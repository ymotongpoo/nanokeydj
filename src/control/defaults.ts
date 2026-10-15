import { HOTCUE_COUNT, JUMP_BEATS, LOOP_BEATS, type DeckId } from './controls';
import type { Binding } from './bindings';

/**
 * 出荷時設定を前提にした初期割り当て。実機で外れていたら MIDI ラーンで直す。
 *
 * nanoKONTROL2（CC モード）:
 *   フェーダー CC 0〜7、ノブ CC 16〜23、S は CC 32〜39、M は CC 48〜55、R は CC 64〜71
 *   Play 41、Stop 42、Rew 43、FF 44、Rec 45、Cycle 46、Track ◀ 58、Track ▶ 59、Marker Set 60
 * nanoPAD2: シーン 1 のパッドがノート 36〜51 を送る前提（未確認）。
 * nanoKEY2: 鍵盤はオクターブを無視した音名で、ピッチベンドボタンは Pitch Bend で受ける。
 */

function cc(control: string, number: number): Binding {
  return { device: 'nanokontrol2', type: 'cc', number, control };
}

function nanoKontrol2Defaults(): Binding[] {
  const bindings: Binding[] = [
    cc('mixer.A.volume', 0),
    cc('mixer.B.volume', 1),
    cc('mixer.crossfader', 2),
    cc('mixer.master', 3),
    cc('deck.A.tempo', 4),
    cc('deck.B.tempo', 5),
    cc('focus.A', 58),
    cc('focus.B', 59),
    cc('focused.play', 41),
    cc('focused.loop.exit', 46),
    cc('modifier.delete', 60),
  ];
  const decks: [DeckId, number][] = [
    ['A', 0],
    ['B', 4],
  ];
  for (const [deck, offset] of decks) {
    bindings.push(
      cc(`mixer.${deck}.eq.high`, 16 + offset),
      cc(`mixer.${deck}.eq.mid`, 17 + offset),
      cc(`mixer.${deck}.eq.low`, 18 + offset),
      cc(`mixer.${deck}.filter`, 19 + offset),
      cc(`deck.${deck}.play`, 32 + offset),
      cc(`deck.${deck}.cue`, 48 + offset),
      cc(`deck.${deck}.sync`, 64 + offset),
    );
  }
  return bindings;
}

const PAD_BASE_NOTE = 36;

function nanoPad2Defaults(): Binding[] {
  const bindings: Binding[] = [];
  const decks: DeckId[] = ['A', 'B'];
  decks.forEach((deck, deckIndex) => {
    for (let n = 1; n <= HOTCUE_COUNT; n++) {
      bindings.push({
        device: 'nanopad2',
        type: 'note',
        number: PAD_BASE_NOTE + deckIndex * HOTCUE_COUNT + (n - 1),
        control: `deck.${deck}.hotcue.${n}`,
      });
    }
  });
  return bindings;
}

/** 白鍵 C D E F G A B の音名番号。 */
const WHITE_KEY_CLASSES = [0, 2, 4, 5, 7, 9, 11];

function nanoKey2Defaults(): Binding[] {
  const key = (number: number, control: string): Binding => ({
    device: 'nanokey2',
    type: 'noteClass',
    number,
    control,
  });
  const bindings: Binding[] = LOOP_BEATS.map((beats, i) =>
    key(WHITE_KEY_CLASSES[i]!, `focused.loop.${beats}`),
  );
  // 黒鍵: C# D# が後ろへ、F# G# が前へのビートジャンプ。A# がループ解除。
  const jumpKeys = [1, 3, 6, 8];
  JUMP_BEATS.forEach((beats, i) => bindings.push(key(jumpKeys[i]!, `focused.jump.${beats}`)));
  bindings.push(key(10, 'focused.loop.exit'));
  bindings.push({
    device: 'nanokey2',
    type: 'pitchBend',
    number: 0,
    control: 'focused.nudge',
  });
  return bindings;
}

export function defaultBindings(): Binding[] {
  return [...nanoKontrol2Defaults(), ...nanoPad2Defaults(), ...nanoKey2Defaults()];
}
