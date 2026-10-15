import { allControlDefs, type ControlDef, type ControlKind } from './controls';

export type ControlHandler = (value: number) => void;

/**
 * コントロールの定義とハンドラーを持ち、値を種別に応じて配信する。
 * MIDI 入力も画面上の操作も dispatch() を通るので、入口によって挙動が変わらない。
 */
export class ControlRegistry {
  private defs = new Map<string, ControlDef>();
  private handlers = new Map<string, ControlHandler>();
  private last = new Map<string, number>();

  constructor(defs: ControlDef[] = allControlDefs()) {
    for (const def of defs) this.defs.set(def.id, def);
  }

  list(): ControlDef[] {
    return [...this.defs.values()];
  }

  get(id: string): ControlDef | undefined {
    return this.defs.get(id);
  }

  kindOf(id: string): ControlKind | undefined {
    return this.defs.get(id)?.kind;
  }

  setHandler(id: string, handler: ControlHandler): void {
    if (!this.defs.has(id)) throw new Error(`未定義のコントロール: ${id}`);
    this.handlers.set(id, handler);
  }

  /** 最後に届いた値。画面の表示に使う。 */
  value(id: string): number {
    return this.last.get(id) ?? 0;
  }

  /**
   * value は 0〜1。
   * trigger は 0 から正の値に変わったときだけ 1 を渡す。
   * hold は押下で 1、解放で 0 を渡す（値が変わらない重複は捨てる）。
   * continuous は値をそのまま渡す。
   */
  dispatch(id: string, value: number): void {
    const def = this.defs.get(id);
    if (!def) return;
    const clamped = Math.min(1, Math.max(0, value));
    const previous = this.last.get(id) ?? 0;
    this.last.set(id, clamped);
    const handler = this.handlers.get(id);
    if (!handler) return;

    switch (def.kind) {
      case 'continuous':
        handler(clamped);
        break;
      case 'trigger':
        if (clamped > 0 && previous === 0) handler(1);
        break;
      case 'hold': {
        const now = clamped > 0 ? 1 : 0;
        const before = previous > 0 ? 1 : 0;
        if (now !== before) handler(now);
        break;
      }
    }
  }
}
