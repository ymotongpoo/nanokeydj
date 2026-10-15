export type DeviceKind = 'nanokontrol2' | 'nanopad2' | 'nanokey2' | 'unknown';

export const DEVICE_LABELS: Record<DeviceKind, string> = {
  nanokontrol2: 'nanoKONTROL2',
  nanopad2: 'nanoPAD2',
  nanokey2: 'nanoKEY2',
  unknown: 'その他',
};

/**
 * MIDI ポート名から機種を判定する。
 * OS により「nanoKONTROL2 SLIDER/KNOB」や「nanoKONTROL2 CTRL」のように接尾辞が付くため、
 * 英数字だけに正規化して機種名を含むかで見る。
 */
export function identifyDevice(portName: string | null | undefined): DeviceKind {
  const normalized = (portName ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.includes('nanokontrol2')) return 'nanokontrol2';
  if (normalized.includes('nanopad2')) return 'nanopad2';
  if (normalized.includes('nanokey2')) return 'nanokey2';
  return 'unknown';
}
