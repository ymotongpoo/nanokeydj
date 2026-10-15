export const DECK_IDS = ['A', 'B'] as const;
export type DeckId = (typeof DECK_IDS)[number];

/**
 * continuous: 0〜1 の連続値（フェーダー、ノブ）
 * trigger: 押した瞬間に 1 回だけ働く（ボタン）
 * hold: 押している間だけ 1、離すと 0（Cue、修飾キー）
 */
export type ControlKind = 'continuous' | 'trigger' | 'hold';

export interface ControlDef {
  id: string;
  label: string;
  kind: ControlKind;
  group: string;
  /** ピッチベンドのように、離すと中央へ戻る入力。ピックアップの対象にしない。 */
  springReturn?: boolean;
}

export const HOTCUE_COUNT = 8;
export const LOOP_BEATS = [0.5, 1, 2, 4, 8, 16, 32] as const;
export const JUMP_BEATS = [-8, -4, 4, 8] as const;

export const EQ_BANDS = ['high', 'mid', 'low'] as const;
export type EqBand = (typeof EQ_BANDS)[number];

const EQ_LABELS: Record<EqBand, string> = { high: 'Hi', mid: 'Mid', low: 'Low' };

/** 画面と MIDI から操作できる論理コントロールの一覧。 */
export function allControlDefs(): ControlDef[] {
  const defs: ControlDef[] = [];
  for (const deck of DECK_IDS) {
    const group = `Deck ${deck}`;
    defs.push(
      { id: `deck.${deck}.play`, label: `${group} Play`, kind: 'trigger', group },
      { id: `deck.${deck}.cue`, label: `${group} Cue`, kind: 'hold', group },
      { id: `deck.${deck}.sync`, label: `${group} Sync`, kind: 'trigger', group },
      { id: `deck.${deck}.tempo`, label: `${group} テンポ`, kind: 'continuous', group },
    );
    for (let n = 1; n <= HOTCUE_COUNT; n++) {
      defs.push({
        id: `deck.${deck}.hotcue.${n}`,
        label: `${group} ホットキュー ${n}`,
        kind: 'trigger',
        group,
      });
    }
  }
  for (const deck of DECK_IDS) {
    const group = `Mixer ${deck}`;
    defs.push({ id: `mixer.${deck}.volume`, label: `Ch ${deck} 音量`, kind: 'continuous', group });
    for (const band of EQ_BANDS) {
      defs.push({
        id: `mixer.${deck}.eq.${band}`,
        label: `Ch ${deck} EQ ${EQ_LABELS[band]}`,
        kind: 'continuous',
        group,
      });
    }
    defs.push({
      id: `mixer.${deck}.filter`,
      label: `Ch ${deck} フィルター`,
      kind: 'continuous',
      group,
    });
  }
  defs.push(
    { id: 'mixer.crossfader', label: 'クロスフェーダー', kind: 'continuous', group: 'Mixer' },
    { id: 'mixer.master', label: 'マスター音量', kind: 'continuous', group: 'Mixer' },
  );

  const focusGroup = 'フォーカスデッキ';
  defs.push(
    { id: 'focus.A', label: 'Deck A にフォーカス', kind: 'trigger', group: focusGroup },
    { id: 'focus.B', label: 'Deck B にフォーカス', kind: 'trigger', group: focusGroup },
    { id: 'focused.play', label: 'Play', kind: 'trigger', group: focusGroup },
    { id: 'focused.cue', label: 'Cue', kind: 'hold', group: focusGroup },
    { id: 'focused.sync', label: 'Sync', kind: 'trigger', group: focusGroup },
    { id: 'focused.nudge', label: 'Nudge', kind: 'continuous', group: focusGroup, springReturn: true },
    { id: 'focused.loop.in', label: 'ループイン', kind: 'trigger', group: focusGroup },
    { id: 'focused.loop.out', label: 'ループアウト', kind: 'trigger', group: focusGroup },
    { id: 'focused.loop.exit', label: 'ループ解除', kind: 'trigger', group: focusGroup },
  );
  for (const beats of LOOP_BEATS) {
    defs.push({
      id: `focused.loop.${beats}`,
      label: `ビートループ ${beats} 拍`,
      kind: 'trigger',
      group: focusGroup,
    });
  }
  for (const beats of JUMP_BEATS) {
    defs.push({
      id: `focused.jump.${beats}`,
      label: `ビートジャンプ ${beats > 0 ? '+' : ''}${beats} 拍`,
      kind: 'trigger',
      group: focusGroup,
    });
  }
  defs.push({
    id: 'modifier.delete',
    label: 'ホットキュー削除（押している間）',
    kind: 'hold',
    group: 'その他',
  });
  return defs;
}
