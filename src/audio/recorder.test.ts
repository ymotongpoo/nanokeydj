import { describe, expect, it } from 'vitest';
import { formatElapsed, pickRecordingFormat, recordingFileName } from './recorder';

describe('pickRecordingFormat', () => {
  it('使える形式のうち、好みの順で最初のものを選ぶ', () => {
    expect(pickRecordingFormat(() => true)?.extension).toBe('webm');
    expect(pickRecordingFormat((m) => m.startsWith('audio/ogg'))?.extension).toBe('ogg');
    expect(pickRecordingFormat((m) => m === 'audio/mp4')?.extension).toBe('m4a');
  });

  it('どれも使えなければ null', () => {
    expect(pickRecordingFormat(() => false)).toBeNull();
  });
});

describe('recordingFileName', () => {
  it('日時から決める', () => {
    expect(recordingFileName(new Date(2026, 9, 5, 3, 7, 9), 'webm')).toBe('nanokeydj-20261005-030709.webm');
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, '00:00'],
    [5.9, '00:05'],
    [65, '01:05'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
    [-3, '00:00'],
  ])('%f 秒を %s と表示する', (seconds, text) => {
    expect(formatElapsed(seconds)).toBe(text);
  });
});
