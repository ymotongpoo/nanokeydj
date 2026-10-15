# nanokeydj 実装計画

KORG nanoSERIES2 の3台（nanoKONTROL2、nanoPAD2、nanoKEY2）で操作する、ブラウザ上の2デッキDJアプリ。Web MIDI API で入力を受け、Web Audio API で再生とミキシングを行う。

## 方針

- Chrome を基準にする。Web MIDI は HTTPS か localhost でのみ動く。
- 依存は最小にする。ビルドは Vite、言語は TypeScript（strict）、テストは Vitest。UI はフレームワークを使わず素の DOM で組む。
- 純粋なロジック（MIDI パース、バインディング解決、再生クロック、カーブ計算、BPM 検出）は DOM と Web Audio から切り離し、Node 上の Vitest で検証する。
- 実機を持たない環境でも動作確認できるよう、画面上のコントロールと MIDI 入力が同じ「コントロール」を経由する。デモトラックの生成機能も持つ。
- nanoSERIES2 の CC 番号とノート番号は出荷時設定を前提にした初期値であり、実機での確認が要る。MIDI モニターと MIDI ラーン（任意のコントロールへの割り当て）を最初に作り、初期値が外れていても実機側で直せるようにする。

## 構成

```
src/
  midi/        parse.ts（バイト列→メッセージ）、devices.ts（ポート名→機種）、manager.ts（MIDIAccess ラッパー）
  control/     controls.ts（論理コントロールの定義）、bindings.ts（MIDI→コントロール）、defaults.ts（機種別の初期割り当て）
  audio/       clock.ts（再生位置の計算）、curves.ts（EQ・フィルター・クロスフェーダー・テンポ）、
               deck.ts、mixer.ts、engine.ts、bpm.ts、peaks.ts、demo.ts（デモトラック生成）
  ui/          app.ts、deck-view.ts、mixer-view.ts、monitor-view.ts、mapping-view.ts、waveform.ts
```

### 信号の流れ

```
MIDI 入力 → parse → Bindings（機種・種別・番号で引く）→ Control.handler(0..1) → Deck / Mixer
画面操作 ────────────────────────────────────────────→ Control.handler(0..1)
Deck: AudioBufferSourceNode → EQ（Low/Mid/High）→ ワンノブフィルター → チャンネルフェーダー → クロスフェーダー → マスター
```

## 初期割り当て

| 機器 | 割り当て |
|---|---|
| nanoKONTROL2 フェーダー1〜6 | A音量、B音量、クロスフェーダー、マスター、Aテンポ、Bテンポ |
| nanoKONTROL2 ノブ1〜4、5〜8 | Deck A と Deck B の Hi / Mid / Low / Filter |
| nanoKONTROL2 S/M/R（ch1、ch5） | Deck A と Deck B の Play / Cue / Sync |
| nanoKONTROL2 Track ◀ ▶ | フォーカスデッキの切り替え（A / B） |
| nanoKONTROL2 Marker Set（押している間） | ホットキュー削除モード |
| nanoPAD2 パッド1〜16 | Deck A ホットキュー1〜8、Deck B ホットキュー1〜8 |
| nanoKEY2 白鍵 C〜B | フォーカスデッキのビートループ（1/2〜32 拍）を入り切り |
| nanoKEY2 黒鍵 | フォーカスデッキのビートジャンプ（±4、±8 拍）とループ解除 |
| nanoKEY2 ピッチベンドボタン | フォーカスデッキの nudge（一時的なテンポ微調整） |

## マイルストーン

各マイルストーンの区切りでビルドとテストを通してコミットする。

1. **M0 リポジトリ初期化**: `.gitignore`、この計画書。
2. **M1 プロジェクト雛形**: Vite + TypeScript + Vitest、最小の画面。
3. **M2 MIDI 層**: メッセージのパース、機種判定、`MIDIAccess` のラッパー（ホットプラグ対応）、MIDI モニター画面。
4. **M3 コントロールとバインディング**: コントロール定義、バインディング解決、MIDI ラーン、`localStorage` への保存、初期割り当て。
5. **M4 オーディオ基盤**: 再生クロック、各種カーブ、Deck、Mixer、Engine、デモトラック生成。
6. **M5 画面**: デッキ表示、波形（全体と拡大）、ミキサー、ファイル読み込み、ドラッグ＆ドロップ。
7. **M6 BPM とビートグリッド**: BPM と最初の拍の検出、グリッド表示、Sync（テンポと位相）。
8. **M7 キューとループ**: Cue（CDJ 方式）、ホットキュー、ビートループ、ビートジャンプ、nudge。
9. **M8 コントローラー結線**: 3台の初期割り当てを全コントロールに接続し、フォーカスデッキを実装する。
10. **M9 仕上げ**: README、実機確認の手順書。

### 計画外（次の段階）

- キーロック（AudioWorklet + SoundTouch 系の WASM によるタイムストレッチ）
- ヘッドホン Cue（PFL）。ブラウザは1つの `AudioContext` で1出力しか扱えないため、マルチチャンネルのオーディオインターフェースが前提になる。
- nanoKONTROL2 のボタン LED のフィードバック（KONTROL Editor で LED モードを外部制御にする必要がある）
- nanoPAD2 の XY パッドによるエフェクト
- Tauri などで包んだデスクトップ版

## 既知のリスク

- 出荷時の CC・ノート番号は記憶と公式資料に基づく初期値で、実機で外れている可能性がある。
- nanoKONTROL2 のフェーダーは 7bit（128 段階）で、テンポ調整の分解能が粗い。中央付近は不感帯を設けてスナップさせる。
- ブラウザの `AudioBufferSourceNode` は再生中の位置を直接返さない。位置は再生クロックで計算する。
- 長い曲のデコードはメモリを使う（5 分のステレオ曲で約 100 MB）。2デッキなら許容範囲とする。
