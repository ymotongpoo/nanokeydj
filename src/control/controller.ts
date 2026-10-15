import { Emitter } from '../util/emitter';
import type { MidiManager } from '../midi/manager';
import { Bindings, eventToInput, type Binding, type MidiSource } from './bindings';
import { defaultBindings } from './defaults';
import { Learner } from './learner';
import { ControlRegistry } from './registry';

export const STORAGE_KEY = 'nanokeydj.bindings.v1';

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

  constructor(
    midi: MidiManager | null,
    private storage: KeyValueStorage | null = typeof localStorage === 'undefined'
      ? null
      : localStorage,
  ) {
    this.bindings = new Bindings(this.load());
    this.learner = new Learner(this.registry, this.bindings, () => this.save());
    midi?.onMessage.on((event) => {
      const input = eventToInput(event);
      if (input) this.handleInput(input.source, input.value);
    });
  }

  handleInput(source: MidiSource, value: number): void {
    if (this.learner.handleInput(source, value)) return;
    const control = this.bindings.resolve(source);
    if (control) this.registry.dispatch(control, value);
  }

  resetToDefaults(): void {
    this.storage?.removeItem(STORAGE_KEY);
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
