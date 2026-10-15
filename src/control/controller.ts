import { Emitter } from '../util/emitter';
import type { MidiManager } from '../midi/manager';
import { Bindings, eventToInput, sourceKey, type Binding, type MidiSource } from './bindings';
import { defaultBindings } from './defaults';
import { Learner } from './learner';
import { Pickup } from './pickup';
import { ControlRegistry } from './registry';

export const STORAGE_KEY = 'nanokeydj.bindings.v1';
export const PICKUP_STORAGE_KEY = 'nanokeydj.pickup';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isBinding(value: unknown): value is Binding {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.device === 'string' &&
    typeof v.type === 'string' &&
    typeof v.number === 'number' &&
    typeof v.control === 'string'
  );
}

/** MIDI イベントをバインディングで引き、レジストリのコントロールへ配信する。 */
export class Controller {
  readonly registry = new ControlRegistry();
  readonly bindings: Bindings;
  readonly learner: Learner;
  readonly onBindingsChanged = new Emitter<void>();
  private pickup = new Pickup();
  private _pickupEnabled = true;

  constructor(
    midi: MidiManager | null,
    private storage: KeyValueStorage | null = typeof localStorage === 'undefined'
      ? null
      : localStorage,
  ) {
    this.bindings = new Bindings(this.load());
    this._pickupEnabled = this.storage?.getItem(PICKUP_STORAGE_KEY) !== '0';
    this.learner = new Learner(this.registry, this.bindings, () => this.save());
    midi?.onMessage.on((event) => {
      const input = eventToInput(event);
      if (input) this.handleInput(input.source, input.value);
    });
  }

  handleInput(source: MidiSource, value: number): void {
    if (this.learner.handleInput(source, value)) return;
    const control = this.bindings.resolve(source);
    if (!control) return;
    const def = this.registry.get(control);
    if (
      this._pickupEnabled &&
      def?.kind === 'continuous' &&
      !def.springReturn &&
      !this.pickup.accept(sourceKey(source), value, this.registry.value(control))
    ) {
      return;
    }
    this.registry.dispatch(control, value);
  }

  /**
   * 有効なとき、実機の値が画面の値に追いつくまでは反映しない。
   * 起動直後や画面側の操作のあとに、音が跳ぶのを防ぐ。
   */
  get pickupEnabled(): boolean {
    return this._pickupEnabled;
  }

  set pickupEnabled(enabled: boolean) {
    this._pickupEnabled = enabled;
    this.pickup.reset();
    this.storage?.setItem(PICKUP_STORAGE_KEY, enabled ? '1' : '0');
  }

  /** 実機の値が追いつくのを待っている入力元の数。 */
  get pickupWaiting(): number {
    return this.pickup.waiting;
  }

  resetToDefaults(): void {
    this.storage?.removeItem(STORAGE_KEY);
    this.pickup.reset();
    const fresh = new Bindings(defaultBindings());
    // Bindings は参照を共有しているので、中身を入れ替える。
    for (const control of this.registry.list().map((d) => d.id)) this.bindings.unbindControl(control);
    for (const binding of fresh.toJSON()) this.bindings.bind(binding, binding.control);
    this.onBindingsChanged.emit();
  }

  private load(): Binding[] {
    const raw = this.storage?.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every(isBinding)) return parsed;
      } catch {
        // 壊れた保存データは捨てて初期値を使う。
      }
    }
    return defaultBindings();
  }

  private save(): void {
    this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.bindings.toJSON()));
    this.onBindingsChanged.emit();
  }
}
