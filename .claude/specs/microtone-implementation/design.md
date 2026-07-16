# 設計書: 微分音（四分音）の臨時記号

## 概要

半音の半分（50セント）を上げ下げする「四分音（クォータートーン）」の臨時記号を実装する。
既存の ♯/♭/♮ と同じ「ツールを選んで音符（和音の個別音）をクリック」という操作感に揃え、
描画・保存・再生（内蔵音源）・MusicXML書き出しまで一貫させる。

## 前提調査（結論）

### VexFlow の微分音臨時記号コード

`node_modules/vexflow/build/esm/src/tables.js` の `accidentals` マップを確認した結果:

```js
const accidentals = {
  '#': Glyphs.accidentalSharp,
  '##': Glyphs.accidentalDoubleSharp,
  b: Glyphs.accidentalFlat,
  bb: Glyphs.accidentalDoubleFlat,
  n: Glyphs.accidentalNatural,
  db: Glyphs.accidentalThreeQuarterTonesFlatZimmermann, // 3/4音フラット
  d:  Glyphs.accidentalQuarterToneFlatStein,             // 1/4音フラット（四分音下げ）
  '++': Glyphs.accidentalThreeQuarterTonesSharpStein,    // 3/4音シャープ
  '+':  Glyphs.accidentalQuarterToneSharpStein,          // 1/4音シャープ（四分音上げ）
  ...
};
```

採用コード:
- 四分音上げ（+50セント）: `'+'`（Stein の quarter-tone sharp）
- 四分音下げ（-50セント）: `'d'`（Stein の quarter-tone flat）

3/4音（`'++'` / `'db'`）は要件外のため今回は実装しない（既存の README ロードマップにも
「四分音」としか書かれておらず、3/4音は別要望として扱う）。

### 既存の臨時記号実装との関係

- `applyAccidentalToEvent`（StaffCanvas.tsx / PianoSystemCanvas.tsx に同名関数が重複実装されている）は
  `ev.keys` の文字列（VexFlow形式 "c/4" など）に `#`/`b` を埋め込む方式。
- 四分音は「半音そのものの絶対値」ではなく「半音とは独立した ±50セントの補正」という性質が強く、
  keys 文字列（音名+オクターブ）に混ぜ込むと、調号処理・移調・MusicXML の pitch 計算など
  既存ロジック全体に手を入れる必要が出て侵襲が大きい。
- そのため **設計方針として、keys 文字列は変更せず、NoteEvent に独立フィールド `microtones` を追加する**。
  和音の各音（keyIndex）ごとに四分音の種類を持たせる。

```ts
export interface NoteEvent {
  // ...既存フィールド...
  /**
   * 微分音（四分音）の臨時記号。和音の各音（keyIndex）ごとに1つ持つ。
   * 'quarterSharp': 半音の半分（+50セント）上げる
   * 'quarterFlat' : 半音の半分（-50セント）下げる
   * 通常の ♯/♭/♮ とは排他（同じ keyIndex には同時に持たない）。
   * 3/4音（3 quarter tones）は対象外。
   */
  microtones?: { keyIndex: number; type: 'quarterSharp' | 'quarterFlat' }[];
}
```

- keyIndex は `ev.keys` の配列インデックスに対応する。
- 通常の ♯/♭/♮ ツールを適用したら、その keyIndex の `microtones` エントリを取り除く（排他）。
- 逆に四分音ツールを適用したら、その keyIndex の keys 文字列の臨時記号（#/b）を取り除く
  （`setKeyAccidental(key, 'natural')` 相当で自然音に戻す）。

## 修正設計

### 1. 型定義・バリデーション

- `src/types/storage.ts`: `NoteEvent.microtones` を追加（上記の通り）。
- `src/utils/noteKeyUtils.ts`: `MicrotoneType = 'quarterSharp' | 'quarterFlat'` と、
  セント値を返す `microtoneCents(type): 50 | -50`、VexFlow の Accidental コードを返す
  `microtoneAccidentalCode(type): '+' | 'd'` を追加する。
- `src/utils/storage.ts` の `validateNoteEvent`: `microtones` が配列であること、
  各要素が `{ keyIndex: number(0以上の整数, keys.length未満), type: 'quarterSharp'|'quarterFlat' }`
  であることを検証する。壊れたデータは弾いて安全側に倒す（他フィールドと同じ方針）。
  旧セーブデータには `microtones` が無いため optional のまま読み込める（後方互換）。

### 2. 入力UI（Palette.tsx）

- `Tool` に `{ mode: 'microtone'; type: 'quarterSharp' | 'quarterFlat' }` を追加。
- 「音符・休符」タブの ♯♭♮ の隣に「四分音↑」「四分音↓」ボタンを追加する。
  見た目は既存の臨時記号ボタン（`btnStyle` 共通スタイル）に合わせ、記号は
  `𝄲`（上げ）/ `𝄳`（下げ）の Unicode 音楽記号を使う（フォントが無い環境向けに
  title/aria-label で「四分音上げ」「四分音下げ」を明示する）。
- 選択して和音の個別音をクリックで付与、再クリックで解除（既存の臨時記号ツールと同じ操作）。

### 3. 描画（StaffCanvas.tsx / PianoSystemCanvas.tsx）

- `makeVFNote` 内で、通常の `resolveDisplayAccidentalsForKeys` による ♯/♭/♮ 描画とは別に、
  `ev.microtones` を見て該当 keyIndex に `new Accidental(microtoneAccidentalCode(type))` を追加する。
  微分音は小節内での「持続」概念（courtesy accidental）を持たない一時的な記号として扱い、
  常に明示的に表示する（トリルなどの装飾記号と同様の「毎回表示」方針）。
- `applyAccidentalToEvent`（♯/♭/♮ 用）を呼ぶ箇所では、対象 keyIndex の `microtones` エントリを
  取り除く処理を追加する（排他）。
- 新規に `applyMicrotoneToEvent(ev, type, keyIndex)` を追加する。
  - 対象 keyIndex に既に同じ type が付いていれば解除（トグル）。
  - 適用時は対象 keyIndex の keys 文字列の #/b を除去し、自然音の綴りに揃える。
- クリックハンドラに `microtoneMode` を追加し、`accidentalMode` の分岐と同じ構造で処理する
  （和音の個別音クリック判定 `findKeyIndexAtLine` を再利用）。

### 4. 再生（内蔵音源）

- `src/audio/NotePlayer.ts`（クリック確認音・和音対応）:
  - ローカルの `NoteEvent` 型に `microtones` を追加。
  - `playNoteEvent` で `toneKeys` を作る際、対象 keyIndex に microtone があれば
    文字列キーではなく `Tone.Frequency(toneKey).toFrequency() * 2 ** (cents / 1200)` で求めた
    数値（Hz）を配列に混ぜて渡す。Tone.js の `triggerAttackRelease` は配列の各要素を
    個別に音高解決するため、文字列と数値の混在で問題なく動く。
- `src/audio/SimpleAudioEngine.ts`（内蔵エンジンでの譜面全体再生）:
  - `noteToFrequency(note, centsOffset = 0)` にセントオフセット引数を追加し、
    `frequency *= 2 ** (centsOffset / 1200)` を最後に掛ける。
  - 譜面再生ループは現状 `event.keys[0]`（先頭音のみ）を再生する実装になっている
    （和音の複数音同時再生は既存の制限で今回のスコープ外）。そのため、
    先頭音（keyIndex 0）に microtone が付いている場合だけ centsOffset を渡す。
    和音の2音目以降の微分音は「内蔵エンジンでの全体再生では鳴らない」既知の制限として
    README に明記する（表示・クリック確認音では和音全体に対応済み）。

### 5. 再生（SoundFont）

- `soundfont-player` のソースを確認したが、`detune` / `playbackRate` / `cents` に相当する
  オプションは存在しない（`play(name, when, { gain, duration, attack, decay, sustain, release, ... }`)。
  半音単位のサンプル切り替えのみで、任意セントのピッチシフトは提供されていない。
- そのため **SoundFont 再生では微分音は半音に丸まる（既知の制限）** として、
  `SoundFontEngine.ts` にコメントを残し、README にも明記する。無理にリサンプリングは自作しない。

### 6. MusicXML書き出し

- `src/utils/musicXmlExport.ts` の `keyToPitchXml` を拡張し、microtone 情報を渡せるようにする。
- alter は `0.5`（quarterSharp）/ `-0.5`（quarterFlat）を出力し、
  `<accidental>quarter-sharp</accidental>` / `<accidental>quarter-flat</accidental>` を付与する。
- 読み込み（`musicXmlImport.ts`）側の対応は工数の都合で **今回のスコープ外**。
  microtone 付きで書き出した MusicXML を読み込んでも microtone 情報は復元されない
  （既知の制限として README に明記）。

## 影響範囲

- `src/types/storage.ts`, `src/utils/storage.ts`, `src/utils/noteKeyUtils.ts`
- `src/components/Palette.tsx`, `src/components/StaffCanvas.tsx`, `src/components/PianoSystemCanvas.tsx`
- `src/audio/NotePlayer.ts`, `src/audio/SimpleAudioEngine.ts`, `src/audio/SoundFontEngine.ts`（コメントのみ）
- `src/utils/musicXmlExport.ts`
- 新規/既存テスト: `src/utils/noteKeyUtils.test.ts`, `src/utils/storage.test.ts`,
  `src/audio/SimpleAudioEngine.test.ts`, `src/utils/musicXmlExport.test.ts`（存在すれば）

## 除外項目（スコープ外）

- 3/4音（3 quarter tones）の記号
- SoundFont 再生でのセント単位ピッチシフト（サンプル自体の制約）
- MusicXML 読み込み時の microtone 復元
- 内蔵エンジンでの譜面全体再生時、和音の2音目以降の microtone 反映
  （クリック確認音・ピアノ譜含む描画は和音全体対応）
