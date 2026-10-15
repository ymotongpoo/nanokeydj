export interface RecordingFormat {
  mime: string;
  extension: string;
}

/** ブラウザが録音できる形式のうち、好みの順で最初に使えるもの。 */
const FORMATS: RecordingFormat[] = [
  { mime: 'audio/webm;codecs=opus', extension: 'webm' },
  { mime: 'audio/ogg;codecs=opus', extension: 'ogg' },
  { mime: 'audio/mp4', extension: 'm4a' },
];

export function pickRecordingFormat(isSupported: (mime: string) => boolean): RecordingFormat | null {
  return FORMATS.find((format) => isSupported(format.mime)) ?? null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 保存するファイル名。例: nanokeydj-20261015-231507.webm */
export function recordingFileName(date: Date, extension: string): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `nanokeydj-${day}-${time}.${extension}`;
}

/** 経過時間の表示。1 時間を超えたら時も出す。 */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** マスター出力のストリームを MediaRecorder で録音する。 */
export class MixRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  readonly format: RecordingFormat | null;

  constructor(private stream: MediaStream) {
    this.format =
      typeof MediaRecorder === 'undefined'
        ? null
        : pickRecordingFormat((mime) => MediaRecorder.isTypeSupported(mime));
  }

  get supported(): boolean {
    return this.format !== null;
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** 録音を始めてからの秒数。 */
  get elapsed(): number {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  start(): void {
    if (!this.format || this.recording) return;
    this.chunks = [];
    const recorder = new MediaRecorder(this.stream, { mimeType: this.format.mime });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.start(1000);
    this.recorder = recorder;
    this.startedAt = performance.now();
  }

  /** 録音を止め、録れた音声を返す。録音していなければ null。 */
  stop(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive' || !this.format) return Promise.resolve(null);
    return new Promise((resolve) => {
      recorder.onstop = () => {
        this.recorder = null;
        resolve(new Blob(this.chunks, { type: this.format!.mime }));
      };
      recorder.stop();
    });
  }
}
