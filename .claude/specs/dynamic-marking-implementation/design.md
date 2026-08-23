# 設計書: 強弱記号（Dynamics）実装

## 概要

`p` / `mp` / `mf` / `f` / `ff` と、変化系の `cresc.` / `dim.` を実装する。  
今回はまず **音符にぶら下がる文字系の強弱記号** として扱い、**描画・保存・再生** を同じデータでそろえる。

## 問題点

- 既存の `NoteEvent` には強弱情報がなく、見た目と再生強さを同期できない
- 再生ベロシティは `ScorePlayer` / `NotePlayer` ともに固定値 `0.5`
- 編集ツールは音価・タイ・臨時記号・リピートまでで、強弱専用の入力経路が無い

## 修正設計

### 1. `NoteEvent` に強弱記号を追加

強弱は「どの音符から効き始めるか」が重要なので、小節ではなく `NoteEvent` に保存する。

```ts
type AbsoluteDynamicMarking = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff';
type RelativeDynamicMarking = 'cresc' | 'dim';

interface DynamicMarking {
  value: AbsoluteDynamicMarking | RelativeDynamicMarking;
}

interface NoteEvent {
  dynamics?: DynamicMarking[];
}
```

- 絶対強弱と変化強弱を同じ配列へ入れる
- 同じ種類（絶対 or 変化）は 1 音符につき 1 つだけ持つ
- optional にして既存セーブデータとの互換性を保つ

### 2. パレットに強弱ツールを追加

`Tool` 型へ `mode: 'dynamic'` を追加し、以下のボタンを並べる。

- `pp`
- `p`
- `mp`
- `mf`
- `f`
- `ff`
- `cresc.`
- `dim.`

操作は臨時記号と同じく「強弱ツールを選ぶ → 音符セルをクリック」。  
背景クリックでは新しい音符を挿入しない。

### 3. 描画は SVG テキストで下側へ表示

VexFlow の音符本体とは別に、描画後の SVG へテキストを直接追加する。

- 表示位置は各音符の符頭中央付近
- 五線の下側に配置
- 絶対強弱を上段、`cresc.` / `dim.` を下段に並べる

これにより、既存のタイ・スラー・調号レイアウトを壊しにくい。

### 4. 再生ベロシティへ反映

`dynamicMarkingUtils.ts` で強弱解決ロジックを共通化する。

- 絶対強弱:
  - `pp = 0.22`
  - `p = 0.34`
  - `mp = 0.46`
  - `mf = 0.58`
  - `f = 0.74`
  - `ff = 0.90`
- 変化強弱:
  - `cresc.` / `dim.` は、次の絶対強弱まで音符ごとに段階的に増減
  - 行き先の絶対強弱が無い場合は、既定値として `±0.2` ぶん変化させる

`ScorePlayer` だけでなく、現在の再生ボタン経路である
`ScorePage -> PlaybackEngine.playParts()` にもこの値を流す。

- `ScorePage` で再生順へ展開した小節ごとに `resolveDynamicVelocities()` を実行する
- 各 `PlaybackMeasureEvent` へ `velocity?: number` を付けて音源実装へ渡す
- `SimpleAudioEngine` / `SoundFontEngine` は未設定時だけ既定値 `0.5` を使う

個別クリック再生（`NotePlayer`）は、まず安定性優先で固定値のままにしておき、
今回の対象は再生ボタン経路の反映を優先する。

### 5. 保存データ検証

`src/utils/storage.ts` で `dynamics` を検証する。

- 配列であること
- 各要素が `{ value: ... }` 形式であること
- `value` が許可済みの強弱文字列であること

これで localStorage の不正データが描画・再生系へ流れ込むのを減らす。

## 影響範囲

- `src/types/storage.ts`
- `src/utils/dynamicMarkingUtils.ts`
- `src/utils/storage.ts`
- `src/components/Palette.tsx`
- `src/components/StaffCanvas.tsx`
- `src/components/PianoSystemCanvas.tsx`
- `src/audio/ScorePlayer.ts`
- `src/components/ScorePage.tsx`
- `src/audio/PlaybackEngine.ts`
- `src/audio/SimpleAudioEngine.ts`
- `src/audio/SoundFontEngine.ts`
- `src/audio/NotePlayer.ts`
- `README.md`

## セキュリティ配慮

- 保存データの `dynamics` は許可済み文字列だけ受け入れる
- ベロシティは必ず `0..1` に収まるよう丸める
- 背景クリックでは強弱ツールが新規音符挿入へ化けないよう分岐を分ける

## 追補（2026-08-23・Issue #380: 絶対強弱を Bravura の SMuFL グリフで描画）

**問題**: 強弱記号が通常フォント（Century Schoolbook イタリック）の文字 "pp" で、
音符・臨時記号（VexFlow 5 同梱の Bravura = SMuFL 準拠）と字形の系統が違っていた。
市販譜の強弱は専用グリフで、作曲科ユーザー（弟）の見慣れた字形と差が出る。

**修正設計**:
- `dynamicMarkingUtils.dynamicGlyphFor()` — 絶対強弱（pp/p/mp/mf/f/ff）を SMuFL の
  Dynamics 合字（U+E52B/E520/E52C/E52D/E522/E52F）へ対応づける。cresc./dim. は
  対応グリフが無いため null（テキストのまま。運用者指定）
- 描画（PianoSystemCanvas の強弱一括描画）: グリフありなら font-family "Bravura"・
  font-style なし（グリフ自体がイタリック形）・font-size は
  `ENGRAVING_TEXT_SP.dynamicsGlyph = 4`（SMuFL は 1em = 4sp 設計。字面は pp で高さ約
  1.7sp なので旧テキスト 2.0sp と見た目の大きさはほぼ揃う）。フォントは VexFlow 5 が
  読み込む Bravura をそのまま使う（追加ロードなし）
- 衝突回避（#373）の文字箱は `estimateDynamicMarkingsCollisionRect` が
  **Bravura 公式メタデータの実測値**（`DYNAMIC_GLYPH_METRICS`: bBox の左右オーバーハング・
  非対称な上下・opticalCenter 補正・複数記号の行割り）で見積もる。cresc/dim は
  文字数ベース。当初の文字数のみ→round 2 の近似幅→round 3 でメタデータ実測値へ、
  と段階的に正確化した（近似は mp などで実 bBox より小さく、横端の重なりを見逃す）
- 描画の横位置は text-anchor="middle"（文字送り中央）ではなく、Bravura の
  **opticalCenter を音符中心へ合わせる**（f では両者が約0.53spずれるため。
  アンカーは既定の start のまま x = anchorX − opticalCenter×倍率 で描く）

**影響範囲**: 表示の字形のみ。保存データ・パレット表示・MusicXML・再生・⤢/✥ は不変。
クリック判定は getBBox が SMuFL フォントの em 箱（縦約16sp）を返すため自動追従できず、
`data-smufl-glyph` 属性付きの text は、描画時に data 属性へ残した**グリフごとの字面実測値**
（`data-glyph-top-sp` / `data-glyph-bottom-sp`。Bravura メタデータの bBox）×サイズ倍率へ
クランプする（f 系は上1.776sp・下は p 系 0.568sp〜mf 0.66sp と非対称。倍率は実フォントサイズ ÷
設計サイズから復元。⤢ の 25〜400% に追従。属性が読めない場合は 1.8sp/1.0sp の包絡へ
フォールバック）。

**テスト**: PianoSystemCanvasDynamicsGlyph.test.tsx（15件: 6種のグリフを SMuFL 公式表の
コードポイント直書きで固定・cresc はテキストのまま・併記の行間・⤢ の scale 反映・
判定クランプの基本と f・scale=4 の非対称追従・文字箱のメタデータ単体検証・
光学中心揃え・隣接グリフの横端連鎖・表示ウェイトの regular 固定）。
グリフは表示ウェイト「太い」の一括 CSS の影響を受けないよう font-weight:400 と
font-synthesis:none をインラインで固定している（疑似太字の合成で実字面が
メタデータより広がるのを防ぐ）。既存の衝突回避テストは PP_TEXT をグリフ参照へ更新。
ScorePage 配線は ScorePagePartSymbolsWiring.test.tsx に復元→グリフ描画のケースを追加。
