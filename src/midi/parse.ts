/** チャンネルは 1〜16 で表す（バイト列の 0〜15 に 1 を足す）。 */
export type MidiMessage =
  | { type: 'noteOn'; channel: number; note: number; velocity: number }
  | { type: 'noteOff'; channel: number; note: number; velocity: number }
  | { type: 'cc'; channel: number; controller: number; value: number }
  /** value は 0〜16383。中央は 8192。 */
  | { type: 'pitchBend'; channel: number; value: number }
  | { type: 'programChange'; channel: number; program: number }
  | { type: 'channelPressure'; channel: number; pressure: number }
  | { type: 'polyPressure'; channel: number; note: number; pressure: number }
  | { type: 'sysex'; length: number }
  | { type: 'other'; status: number };

/**
 * MIDI のバイト列を 1 つのメッセージに変換する。
 * タイミングクロックやアクティブセンシングなどのリアルタイムメッセージは null を返す。
 * ベロシティ 0 のノートオンはノートオフとして扱う。
 */
export function parseMidiMessage(data: ArrayLike<number>): MidiMessage | null {
  if (data.length === 0) return null;
  const status = data[0]! & 0xff;
  if (status >= 0xf8) return null;
  if (status === 0xf0) return { type: 'sysex', length: data.length };
  if (status >= 0xf0) return { type: 'other', status };
  if (status < 0x80) return null;

  const channel = (status & 0x0f) + 1;
  const d1 = (data[1] ?? 0) & 0x7f;
  const d2 = (data[2] ?? 0) & 0x7f;

  switch (status & 0xf0) {
    case 0x80:
      return { type: 'noteOff', channel, note: d1, velocity: d2 };
    case 0x90:
      return d2 === 0
        ? { type: 'noteOff', channel, note: d1, velocity: 0 }
        : { type: 'noteOn', channel, note: d1, velocity: d2 };
    case 0xa0:
      return { type: 'polyPressure', channel, note: d1, pressure: d2 };
    case 0xb0:
      return { type: 'cc', channel, controller: d1, value: d2 };
    case 0xc0:
      return { type: 'programChange', channel, program: d1 };
    case 0xd0:
      return { type: 'channelPressure', channel, pressure: d1 };
    case 0xe0:
      return { type: 'pitchBend', channel, value: (d2 << 7) | d1 };
    default:
      return { type: 'other', status };
  }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** ノート番号を表示用の名前にする。60 は C4。 */
export function noteName(note: number): string {
  const octave = Math.floor(note / 12) - 1;
  return `${NOTE_NAMES[note % 12]}${octave}`;
}

/** モニター画面に出す 1 行の説明。 */
export function describeMessage(message: MidiMessage): string {
  switch (message.type) {
    case 'noteOn':
      return `ch${message.channel} Note On ${message.note} (${noteName(message.note)}) vel ${message.velocity}`;
    case 'noteOff':
      return `ch${message.channel} Note Off ${message.note} (${noteName(message.note)})`;
    case 'cc':
      return `ch${message.channel} CC ${message.controller} = ${message.value}`;
    case 'pitchBend':
      return `ch${message.channel} Pitch Bend ${message.value}`;
    case 'programChange':
      return `ch${message.channel} Program ${message.program}`;
    case 'channelPressure':
      return `ch${message.channel} Pressure ${message.pressure}`;
    case 'polyPressure':
      return `ch${message.channel} Poly Pressure ${message.note} = ${message.pressure}`;
    case 'sysex':
      return `SysEx (${message.length} bytes)`;
    case 'other':
      return `Status 0x${message.status.toString(16)}`;
  }
}
