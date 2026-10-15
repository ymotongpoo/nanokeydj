import type { DeviceKind } from '../midi/devices';
import type { MidiEvent } from '../midi/manager';

/**
 * noteClass はオクターブを無視したノート（0〜11 の音名）。
 * nanoKEY2 のオクターブシフトで割り当てがずれないように使う。
 */
export type SourceType = 'cc' | 'note' | 'noteClass' | 'pitchBend';

export interface MidiSource {
  device: DeviceKind;
  type: SourceType;
  number: number;
}

export interface Binding extends MidiSource {
  control: string;
}

export function sourceKey(source: MidiSource): string {
  return `${source.device}:${source.type}:${source.number}`;
}

export function describeSource(source: MidiSource): string {
  switch (source.type) {
    case 'cc':
      return `CC ${source.number}`;
    case 'note':
      return `Note ${source.number}`;
    case 'noteClass':
      return `音名 ${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][source.number]}`;
    case 'pitchBend':
      return 'Pitch Bend';
  }
}

/** MIDI イベントを、バインディングの引き当てに使う入力元と 0〜1 の値に変換する。 */
export function eventToInput(event: MidiEvent): { source: MidiSource; value: number } | null {
  const { message, device } = event;
  switch (message.type) {
    case 'cc':
      return {
        source: { device, type: 'cc', number: message.controller },
        value: message.value / 127,
      };
    case 'noteOn':
    case 'noteOff': {
      const value = message.type === 'noteOn' ? Math.max(message.velocity, 1) / 127 : 0;
      if (device === 'nanokey2') {
        return { source: { device, type: 'noteClass', number: message.note % 12 }, value };
      }
      return { source: { device, type: 'note', number: message.note }, value };
    }
    case 'pitchBend':
      return {
        source: { device, type: 'pitchBend', number: 0 },
        value: message.value / 16383,
      };
    default:
      return null;
  }
}

/** 入力元からコントロールを引く対応表。1 つの入力元は 1 つのコントロールにだけ結びつく。 */
export class Bindings {
  private byKey = new Map<string, Binding>();

  constructor(initial: Binding[] = []) {
    for (const binding of initial) this.byKey.set(sourceKey(binding), { ...binding });
  }

  bind(source: MidiSource, control: string): void {
    this.byKey.set(sourceKey(source), { ...source, control });
  }

  unbindControl(control: string): void {
    for (const [key, binding] of this.byKey) {
      if (binding.control === control) this.byKey.delete(key);
    }
  }

  resolve(source: MidiSource): string | undefined {
    return this.byKey.get(sourceKey(source))?.control;
  }

  sourcesFor(control: string): MidiSource[] {
    const sources: MidiSource[] = [];
    for (const binding of this.byKey.values()) {
      if (binding.control === control) {
        sources.push({ device: binding.device, type: binding.type, number: binding.number });
      }
    }
    return sources;
  }

  toJSON(): Binding[] {
    return [...this.byKey.values()].map((b) => ({ ...b }));
  }
}
