# 拍子記号と1番括弧/2番括弧の実装

## 背景

`エリーゼのために` をベンチマークに近づける検討の中で、
先に入れた `2 voice` よりも

- `4/4` 固定を外して `3/8` を持てること
- `1番括弧 / 2番括弧` を表示と再生で扱えること

の方が、譜面構造の再現度に直結すると分かった。

そのため今回は「複数声部の拡張」よりも優先して、
拍子と終止括弧をスコア構造へ入れる。

## 方針

### 1. 拍子はテンポ設定ではなくスコアデータにも保存する

既存の `TempoManager` は `timeSignature` を持っているが、
それは UI 設定寄りで、譜面ファイルの一部ではなかった。

今回から `SavedScoreData.timeSignature` を追加し、

- 保存時に譜面ごとの拍子を持つ
- 読み込み時に拍子を UI へ戻す
- 無効値は `4/4` に正規化する

ようにする。

### 2. 拍数計算は「4分音符 = 1拍」の既存単位を維持する

既存の音価計算は `4分音符 = 1` を前提にしている。
そのため `3/8` は `1.5` 拍として扱い、

- 音符追加時の小節上限
- 再生時間計算
- 空小節の長さ

を同じ単位でそろえる。

### 3. 描画用の拍子文字列と VexFlow の Voice 時間設定を分離しない

`StaffCanvas` / `PianoSystemCanvas` では、

- 表示用には `3/8` の文字列
- Voice には `{ num_beats: 3, beat_value: 8 }`

を同じ `timeSignature` から作る。

これで「見た目は 3/8 なのに内部では 4/4」というズレを防ぐ。

### 4. 1番括弧 / 2番括弧は小節への軽い印として保存する

終止括弧の保存形式は、
開始・中間・終了を直接保存せず `MeasureData.ending?: 1 | 2` にする。

理由:

- 編集 UI を単純にできる
- 保存データが短い
- 描画時に前後の小節を見れば `BEGIN / MID / END / BEGIN_END` を導ける
- 再生時は「今が1周目か2周目か」で判定できる

### 5. 終止括弧の描画は最上段だけに出す

ピアノ大譜表や弦楽四重奏では、
終止括弧は最上段だけに出した方が読みやすい。

そのため:

- 単旋律譜はその段に表示
- ピアノ譜 / 弦楽四重奏は最上段だけに表示

とする。

### 6. 再生展開は repeat 記号と ending 番号を組み合わせる

`expandMeasuresForPlayback()` を拡張し、

- 開始/終了リピートは従来どおり 1 回だけ折り返す
- 1周目は `ending: 1` の小節だけ鳴らす
- 2周目は `ending: 2` の小節だけ鳴らす

という基本規則を入れる。

今回は D.C. / D.S. までは広げず、
無限ループしない安全性を優先する。

## 変更対象

- `src/types/storage.ts`
- `src/utils/timeSignatureUtils.ts`
- `src/utils/endingBracketUtils.ts`
- `src/utils/storage.ts`
- `src/hooks/useScoreStorage.ts`
- `src/components/ScorePage.tsx`
- `src/components/Palette.tsx`
- `src/components/StaffCanvas.tsx`
- `src/components/PianoSystemCanvas.tsx`
- `src/components/PianoStaff.tsx`
- `src/components/QuartetStaff.tsx`
- `src/utils/repeatMarkerUtils.ts`
- `src/audio/repeatPlaybackUtils.ts`
- `src/data/demoScores.ts`

## セキュリティ / 安定性

- `timeSignature` は保存時と読込時の両方で検証し、未知値を `4/4` に戻す
- `ending` は `1 | 2` 以外を保存データとして受け入れない
- 再生展開は従来の安全上限を維持し、壊れた記号配置で無限ループしないようにする

## 現状の制限

- `エリーゼのために` は `3/8` の冒頭主題デモとして組み直し、
  16分音符主体のリズム感も含めて原曲らしさを優先したが、
  まだ説明用の短い抜粋であり、原典版全体の構成や細かな装飾までは含めていない
- ただしサンプルには、リピート記号・1番括弧 / 2番括弧・強弱記号を実データとして入れ、
  ユーザーが機能をすぐ体験できる状態にはしている
- 1番括弧 / 2番括弧の再生分岐は、まず単純な反復進行を安全に扱う実装を優先している
