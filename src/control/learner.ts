import { Emitter } from '../util/emitter';
import { sourceKey, type Bindings, type MidiSource } from './bindings';
import type { ControlRegistry } from './registry';

/**
 * MIDI ラーン。キューに積んだコントロールへ、届いた入力を順に割り当てる。
 * ボタン類は押した瞬間（値が正）にだけ割り当て、離したときの 0 では進まない。
 */
export class Learner {
  readonly onChange = new Emitter<void>();

  private queue: string[] = [];
  /** この学習セッションで使った入力元。動かし続けているフェーダーが次の項目に誤って割り当たるのを防ぐ。 */
  private used = new Set<string>();

  constructor(
    private registry: ControlRegistry,
    private bindings: Bindings,
    private onBound: () => void,
  ) {}

  get target(): string | null {
    return this.queue[0] ?? null;
  }

  get remaining(): number {
    return this.queue.length;
  }

  start(controlIds: string[]): void {
    this.queue = controlIds.filter((id) => this.registry.get(id));
    this.used.clear();
    this.onChange.emit();
  }

  cancel(): void {
    this.queue = [];
    this.used.clear();
    this.onChange.emit();
  }

  /** 学習中なら入力を消費して true を返す。 */
  handleInput(source: MidiSource, value: number): boolean {
    const target = this.target;
    if (!target) return false;

    const key = sourceKey(source);
    if (this.used.has(key)) return true;
    if (this.registry.kindOf(target) !== 'continuous' && value <= 0) return true;

    this.bindings.unbindControl(target);
    this.bindings.bind(source, target);
    this.used.add(key);
    this.queue.shift();
    if (this.queue.length === 0) this.used.clear();
    this.onBound();
    this.onChange.emit();
    return true;
  }
}
