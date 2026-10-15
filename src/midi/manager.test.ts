import { afterEach, describe, expect, it, vi } from 'vitest';
import { MidiManager, type MidiEvent } from './manager';

interface FakeInput {
  id: string;
  name: string;
  state: 'connected' | 'disconnected';
  onmidimessage: ((event: { data: Uint8Array; timeStamp: number }) => void) | null;
}

function fakeInput(id: string, name: string): FakeInput {
  return { id, name, state: 'connected', onmidimessage: null };
}

function fakeAccess(inputs: FakeInput[]) {
  const map = new Map(inputs.map((i) => [i.id, i]));
  return {
    inputs: map,
    onstatechange: null as (() => void) | null,
    set(next: FakeInput[]) {
      map.clear();
      for (const input of next) map.set(input.id, input);
      this.onstatechange?.();
    },
  };
}

function stubMidi(access: ReturnType<typeof fakeAccess> | 'denied' | 'unsupported') {
  if (access === 'unsupported') {
    vi.stubGlobal('navigator', {});
  } else {
    vi.stubGlobal('navigator', {
      requestMIDIAccess: () =>
        access === 'denied' ? Promise.reject(new Error('denied')) : Promise.resolve(access),
    });
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('MidiManager', () => {
  it('Web MIDI がなければ unsupported', async () => {
    stubMidi('unsupported');
    const midi = new MidiManager();
    await midi.start();
    expect(midi.status).toBe('unsupported');
  });

  it('許可されなければ denied', async () => {
    stubMidi('denied');
    const midi = new MidiManager();
    await midi.start();
    expect(midi.status).toBe('denied');
  });

  it('入力ポートのメッセージを機種つきで配信する', async () => {
    const input = fakeInput('p1', 'nanoKONTROL2 SLIDER/KNOB');
    stubMidi(fakeAccess([input]));
    const midi = new MidiManager();
    const events: MidiEvent[] = [];
    midi.onMessage.on((e) => events.push(e));
    await midi.start();

    input.onmidimessage?.({ data: new Uint8Array([0xb0, 16, 64]), timeStamp: 12 });
    input.onmidimessage?.({ data: new Uint8Array([0xf8]), timeStamp: 13 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      device: 'nanokontrol2',
      message: { type: 'cc', controller: 16, value: 64 },
      timeStamp: 12,
    });
    expect(midi.ports()).toEqual([
      { id: 'p1', name: 'nanoKONTROL2 SLIDER/KNOB', device: 'nanokontrol2', connected: true },
    ]);
  });

  it('後から挿したポートを拾い、接続状況の変化を通知する', async () => {
    const access = fakeAccess([]);
    stubMidi(access);
    const midi = new MidiManager();
    const changes: number[] = [];
    midi.onPortsChanged.on((ports) => changes.push(ports.length));
    const events: MidiEvent[] = [];
    midi.onMessage.on((e) => events.push(e));
    await midi.start();

    const pad = fakeInput('p2', 'nanoPAD2 PAD');
    access.set([pad]);
    pad.onmidimessage?.({ data: new Uint8Array([0x99, 36, 100]), timeStamp: 1 });
    expect(changes).toEqual([0, 1]);
    expect(events[0]?.device).toBe('nanopad2');
  });

  it('同じ id で別のオブジェクトとして再接続されても受信できる', async () => {
    const access = fakeAccess([fakeInput('p3', 'nanoKEY2 KEYBOARD')]);
    stubMidi(access);
    const midi = new MidiManager();
    const events: MidiEvent[] = [];
    midi.onMessage.on((e) => events.push(e));
    await midi.start();

    const replugged = fakeInput('p3', 'nanoKEY2 KEYBOARD');
    access.set([replugged]);
    replugged.onmidimessage?.({ data: new Uint8Array([0x90, 60, 90]), timeStamp: 5 });
    expect(events).toHaveLength(1);
  });

  it('inject は実機と同じ経路でメッセージを流す', () => {
    const midi = new MidiManager();
    const events: MidiEvent[] = [];
    midi.onMessage.on((e) => events.push(e));
    midi.inject('nanokey2', [0xe0, 0, 0x40]);
    midi.inject('nanokey2', [0xf8]);
    expect(events).toHaveLength(1);
    expect(events[0]?.message).toEqual({ type: 'pitchBend', channel: 1, value: 8192 });
  });
});
