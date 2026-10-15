import { describe, expect, it } from 'vitest';
import { identifyDevice } from './devices';

describe('identifyDevice', () => {
  it.each([
    ['nanoKONTROL2 SLIDER/KNOB', 'nanokontrol2'],
    ['nanoKONTROL2 CTRL', 'nanokontrol2'],
    ['nanoPAD2 PAD', 'nanopad2'],
    ['nanoPAD2', 'nanopad2'],
    ['nanoKEY2 KEYBOARD', 'nanokey2'],
    ['KORG nanoKEY2', 'nanokey2'],
    ['nano KEY 2', 'nanokey2'],
  ])('%s を %s と判定する', (name, kind) => {
    expect(identifyDevice(name)).toBe(kind);
  });

  it('初代の nanoKONTROL は別機種として扱う', () => {
    expect(identifyDevice('nanoKONTROL SLIDER/KNOB')).toBe('unknown');
  });

  it('名前がなければ unknown', () => {
    expect(identifyDevice(null)).toBe('unknown');
    expect(identifyDevice('')).toBe('unknown');
  });
});
