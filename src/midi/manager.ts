import { Emitter } from '../util/emitter';
import { identifyDevice, type DeviceKind } from './devices';
import { parseMidiMessage, type MidiMessage } from './parse';

export type MidiStatus = 'idle' | 'unsupported' | 'denied' | 'ready';

export interface MidiPortInfo {
  id: string;
  name: string;
  device: DeviceKind;
  connected: boolean;
}

export interface MidiEvent {
  device: DeviceKind;
  portName: string;
  message: MidiMessage;
  /** performance.now() 基準の時刻（ミリ秒）。 */
  timeStamp: number;
}

/** Web MIDI の MIDIAccess を包み、入力ポートの監視とメッセージ配信を行う。 */
export class MidiManager {
  readonly onMessage = new Emitter<MidiEvent>();
  readonly onPortsChanged = new Emitter<MidiPortInfo[]>();
  readonly onStatusChanged = new Emitter<MidiStatus>();

  private access: MIDIAccess | null = null;
  private attached = new Set<string>();
  private _status: MidiStatus = 'idle';

  get status(): MidiStatus {
    return this._status;
  }

  async start(): Promise<void> {
    if (!('requestMIDIAccess' in navigator)) {
      this.setStatus('unsupported');
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.setStatus('denied');
      return;
    }
    this.access.onstatechange = () => this.scan();
    this.setStatus('ready');
    this.scan();
  }

  ports(): MidiPortInfo[] {
    if (!this.access) return [];
    const ports: MidiPortInfo[] = [];
    for (const input of this.access.inputs.values()) {
      const name = input.name ?? '';
      ports.push({
        id: input.id,
        name,
        device: identifyDevice(name),
        connected: input.state === 'connected',
      });
    }
    return ports;
  }

  /** 実機がなくても同じ経路でメッセージを流すための入口。画面上のコントロールとテストが使う。 */
  inject(device: DeviceKind, data: ArrayLike<number>): void {
    const message = parseMidiMessage(data);
    if (!message) return;
    this.onMessage.emit({
      device,
      portName: `(virtual ${device})`,
      message,
      timeStamp: performance.now(),
    });
  }

  private scan(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      if (this.attached.has(input.id)) continue;
      this.attached.add(input.id);
      const name = input.name ?? '';
      const device = identifyDevice(name);
      input.onmidimessage = (event) => {
        if (!event.data) return;
        const message = parseMidiMessage(event.data);
        if (!message) return;
        this.onMessage.emit({
          device,
          portName: name,
          message,
          timeStamp: event.timeStamp,
        });
      };
    }
    this.onPortsChanged.emit(this.ports());
  }

  private setStatus(status: MidiStatus): void {
    this._status = status;
    this.onStatusChanged.emit(status);
  }
}
