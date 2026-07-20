# 設計書: アーティキュレーション（奏法記号）実装

## 概要

スタッカート / アクセント / テヌート / マルカート / フェルマータの 5 種を実装する。
強弱記号（Dynamics）と同じく **音符1つにぶら下がる記号** として扱い、**描画・保存・再生** を同じデータでそろえる。

## 問題点

- 既存の `NoteEvent` には「鳴らし方」の情報が無く、Finale のような基本的な奏法表現ができない
- スタッカート（短く切る）やアクセント（強く）は、見た目だけでなく再生の長さ・音量にも効かせたい
- 編集ツールは音価・タイ・臨時記号・リピート・強弱までで、奏法記号専用の入力経路が無い

## 修正設計

### 1. `NoteEvent` に奏法記号を追加（`types/storage.ts`）

スタッカート＋アクセントのように複数を同時に付けられるため、**文字列の配列**で持つ。

```ts
export type ArticulationMarking = 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'fermata';

export interface NoteEvent {
  // ...既存フィールド
  articulations?: ArticulationMarking[];
}
```

- 強弱（`dynamics: DynamicMarking[]`）はオブジェクト配列だが、奏法記号は付帯情報が無いので素の文字列配列で十分。
- 空になったら配列ごと `undefined` にして保存データを軽く保つ。

### 2. ユーティリティ（`utils/articulationMarkingUtils.ts` 新規）

1 か所に「記号一覧・トグル・VexFlow コード変換・再生効果」を集約する。

| 関数 | 役割 |
|---|---|
| `ARTICULATION_VALUES` | パレットの並び順も兼ねた一覧 |
| `isArticulationMarkingValue` | localStorage から読んだ値の検証用 |
| `toggleArticulationOnEvent(event, value)` | 付いていれば外す／無ければ足す。休符には付けない |
| `getArticulationVexflowCode(value)` | VexFlow の `Articulation` 記号コード（`a.` `a>` `a-` `a^` `a@a`）へ変換 |
| `isAboveArticulation(value)` | フェルマータ・マルカートを符頭の上に固定するか |
| `getArticulationPlaybackEffect(event)` | 付いている全記号を「長さ倍率 / 音量倍率」へ畳み込む |

再生効果（複数付いていれば倍率を掛け合わせる）:

| 記号 | 長さ倍率 | 音量倍率 | 意図 |
|---|---|---|---|
| staccato | 0.5 | 1.0 | 短く切る |
| accent | 1.0 | 1.3 | その音だけ強く |
| tenuto | 1.0 | 1.05 | 音価いっぱい保ち、ほんの少し強め |
| marcato | 0.7 | 1.4 | 強く＋やや短く |
| fermata | 1.8 | 1.0 | 長めに伸ばす |

### 3. パレット（`components/Palette.tsx`）

`Tool` 判別共用体に `{ mode: 'articulation'; articulation: ArticulationMarking }` を追加し、
強弱ボタン行の後ろに 5 つのボタンを並べる。選択中の再クリックでツール解除（既存記号と同じ挙動）。

### 4. 描画とクリック付与（`StaffCanvas.tsx` / `PianoSystemCanvas.tsx`）

- **描画**: `makeVFNote` の返却直前に `attachArticulations()` を呼び、VexFlow の `Articulation`
  モディファイアを符頭へ付ける。フェルマータ・マルカートは `setPosition(3)`（ABOVE）で上付きに固定。
  ライブラリ差異で失敗しても譜面全体の描画は止めないよう `try/catch` で包む（臨時記号と同じ方針）。
- **クリック付与**: クリックハンドラで `articulationMode` を取り出し、強弱記号と同じ位置（和音追加や
  新規挿入より先）で `toggleArticulationOnEvent` を適用。休符セルや空白セルでは何もしない（`return`）。

### 5. 再生反映（`ScorePage.tsx` / `PlaybackEngine.ts` / 各エンジン）

- `ScorePage` の `playParts` 用イベント生成で、強弱由来のベロシティへ `velocityScale` を掛けて 0..1 に収める。
- 長さ倍率は `PlaybackMeasureEvent.durationScale`（新規 optional）として両エンジンへ渡す。
- `SoundFontEngine` / `SimpleAudioEngine` は `soundDuration = duration * (durationScale ?? 1)` を発音長に使い、
  **次の音までの間隔（`partTime` / `currentTime` の進み）は元の `duration` のまま据え置く**。
  これでスタッカートは「音が短く切れるがテンポは変わらない」正しい挙動になる。

## 検証

- 単体テスト 10 件（`articulationMarkingUtils.test.ts`）: トグル・休符除外・倍率の畳み込み・コード定義・検証関数。
- パレットのボタン数テスト（`BackwardCompatibility.test.tsx`）を 30 → 35 へ更新。
- 全テスト 582 件パス、`tsc -b && vite build` 成功。

## やってはいけないこと

- 休符に奏法記号を付けない（鳴らし方の指示なので意味を持たない）。
- `durationScale` で「次の音までの間隔」を縮めない（スタッカートでテンポが速くなってしまう）。
- VexFlow の `Articulation` 生成失敗で譜面描画全体を止めない（`try/catch` で握りつぶす）。

## 影響範囲

- `src/types/storage.ts` — 型追加（後方互換、optional）
- `src/utils/articulationMarkingUtils.ts` / `.test.ts` — 新規
- `src/utils/storage.ts` — 保存データ検証に `articulations` を追加
- `src/utils/voiceMeasureUtils.ts` — `cloneNoteEvent` で `articulations` を複製
- `src/components/Palette.tsx` — ツール追加・ボタン行・ラベル
- `src/components/StaffCanvas.tsx` / `PianoSystemCanvas.tsx` — 描画と付与
- `src/components/ScorePage.tsx` — 再生時の長さ・音量へ反映
- `src/audio/PlaybackEngine.ts` — `PlaybackMeasureEvent.durationScale` 追加
- `src/audio/SoundFontEngine.ts` / `SimpleAudioEngine.ts` — 発音長へ `durationScale` を適用

## 追記（バグ修正）: PianoSystemCanvas でフェルマータ・途中テンポ変更（tempoMarking）が描画されていなかった

上の「描画とクリック付与」の節は StaffCanvas/PianoSystemCanvas 両方に描画があると書いていたが、
実際には **`PianoSystemCanvas.tsx`（ピアノ2段譜・弦楽四重奏などの複数段編成）には
`articulations` / `tempoMarking` を描く経路が一切無かった**。クリックで `articulations` 配列自体は
保存データへ正しく付与されるが、画面に何も表示されないまま気付きにくいサイレント欠落になっていた
（複雑テスト楽譜の低音部 `c/2,g/2,c/3`・`fermata` 付き全音符などで再現）。

### 原因

- `PianoSystemCanvas.tsx` のローカル `NoteEvent` 型（ファイル冒頭）に `articulations` / `tempoMarking`
  フィールドが定義されておらず、`dynamics` や `fingering` と違って描画情報を集める配列
  （`dynamicTextEntries` 相当）自体が存在しなかった。
- なお VexFlow の `StaveNote` 自体は正しく全音符の符頭（3和音なら3個）を構築・描画しており、
  「符頭が欠ける」という現象は本調査では再現しなかった（一時的なレイアウト再計算前の
  古い DOM を見ていた可能性が高い）。

### 修正

`StaffCanvas.tsx` の実装（VexFlow の `Articulation` モディファイアではなく、**素の SVG 要素を
音符の位置情報から計算して自前描画する方式**）をそのまま `PianoSystemCanvas.tsx` へ移植した。

- `NoteEvent` 型に `articulations?: ArticulationMarking[]` と `tempoMarking?: string` を追加
- `articulationEntries` / `tempoMarkingEntries` 収集配列を追加し、アクティブ声部・非アクティブ声部の
  両方のイベント走査ループで push する（`fingeringEntries` と同じ位置・同じ方針）
- 全音符描画後に一括で SVG を組み立てる描画ループを追加（フェルマータ＝弧＋点、
  スタッカート＝符頭上の小さい丸、アクセント＝楔形、テヌート＝水平線。`marcato` は
  StaffCanvas 側も未実装のため今回も未対応のまま）
- `tempoMarking` はコード記号と同じ位置（五線上端より24px上）にイタリック体で表示

### 検証

- `docker compose run --rm app npx tsc --noEmit` / `npx vitest run`（925件）とも green（既存の
  回帰テストのみ。新規の描画ロジックは SVG 要素の手組み立てで、既存の `fingeringEntries` 等と
  同型のためユニットテストは追加していない）
- ブラウザ DOM 実測: 複雑テスト楽譜 measure index 23（左手 `c/2,g/2,c/3` + フェルマータ、右手
  `c/5,e/5,g/5,c/6` + フェルマータ + `tempoMarking:"Fine"`）で、修正前は `svg.querySelector('[class*=fermata]')`
  が無く `text` 要素にも `"Fine"` が見つからなかったが、修正後は両方の五線に半円弧＋点のフェルマータが
  描画され、`svg` 内の `text` 一覧に `"Fine"` が含まれることを確認した。符頭数は修正前後とも
  左手3個・右手4個で変化なし（符頭欠けは本修正の対象ではなかった）。
