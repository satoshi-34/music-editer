# 設計: 音楽記号のリピート

## 概要

今回追加するのは、再生を自動ループさせる UI ではなく、譜面上に置く **開始リピート `||:` / 終了リピート `:||` の記号** である。  
ユーザーから見ると「パレットで記号を選び、小節をクリックして置く」だけでなく、**再生時にもその並び順で鳴る** 体験が必要になる。

この機能は音符イベントではなく **小節そのものの属性** なので、`MeasureData` に保存し、単旋律譜・ピアノ譜・弦楽四重奏譜の各描画経路から同じように参照する。

## 変更方針

### 1. リピート記号は `MeasureData` に持たせる

`NoteEvent` ではなく `MeasureData` に次の optional フラグを追加する。

- `repeatStart?: boolean`
- `repeatEnd?: boolean`

理由:

- 記号の位置は「音符」ではなく「小節線」に結びつく
- 小節内に音符がなくても記号だけ置ける
- 単旋律譜でも多段譜でも同じ保存構造で表現できる

### 2. パレットには専用モードを追加する

`Tool` 型へ `mode: 'repeat'` を追加し、以下の 2 ボタンを並べる。

- `||:`: 開始リピート
- `:||`: 終了リピート

操作ルール:

- ボタン選択後、対象小節をクリックすると該当フラグをトグル
- 同じ小節をもう一度クリックすると解除
- タイや臨時記号と同じく、もう一度同じボタンを押すと通常音符入力へ戻る

### 3. 描画は VexFlow の begin / end barline を使う

単旋律譜の `StaffCanvas.tsx` と多段譜の `PianoSystemCanvas.tsx` で、`Stave` 作成時に次を適用する。

- `repeatStart` が true のとき `setBegBarType(Barline.type.REPEAT_BEGIN)`
- `repeatEnd` が true のとき `setEndBarType(Barline.type.REPEAT_END)`

これにより、記号専用の SVG を手描きせず、既存の小節線レイアウトへ自然に乗せられる。

### 4. 小節複製処理を共通化する

既存コードには `prev.map(m => ({ events: [...] }))` のような複製が多く、ここへ新しい小節属性を追加すると、音符編集のたびにリピート記号が消える危険がある。  
そのため `repeatMarkerUtils.ts` を追加し、以下を共通化する。

- `cloneMeasureData()`
- `createEmptyMeasure()`
- `toggleMeasureRepeatMarker()`

これで、編集時も `repeatStart / repeatEnd` を落とさず扱える。

### 5. 再生時は `ScorePage` 側で小節順を事前展開する

実際の再生ボタンは `ScorePage` から `PlaybackEngine.playParts()` を呼んでいる。  
そのため、各音源実装へ渡す前に「再生順の小節配列」を展開する。

ルールは次の通り。

- `repeatStart` から `repeatEnd` までを 1 回だけ折り返す
- `repeatStart` が無い `repeatEnd` は譜面先頭へ戻る
- 同じ `repeatEnd` で二重三重に戻らないよう、通過済み終了位置を記録する
- 不正データでも無限ループしないよう、安全上限に達したら展開を打ち切る

## 影響範囲

| ファイル | 役割 |
|---|---|
| `src/types/storage.ts` | 小節データへ repeatStart / repeatEnd を追加 |
| `src/audio/repeatPlaybackUtils.ts` | リピート記号から再生順を展開 |
| `src/components/ScorePage.tsx` | 展開後の小節順を `PlaybackEngine` へ渡す |
| `src/components/Palette.tsx` | リピート記号ボタンの追加 |
| `src/components/StaffCanvas.tsx` | 単旋律譜での配置/描画 |
| `src/components/PianoSystemCanvas.tsx` | ピアノ譜・弦楽四重奏譜での配置/描画 |
| `src/utils/repeatMarkerUtils.ts` | 小節メタデータを落とさない共通処理 |
| `src/utils/storage.ts` | 保存データ検証に repeatStart / repeatEnd を追加 |

## セキュリティと堅牢性

- 保存時は `repeatStart / repeatEnd` が boolean かどうかを検証する
- 音符編集時に小節メタデータを落とさない共通複製関数を使う
- 同じ終了リピートでは 1 回までしか戻らないようにして、無限ループを防ぐ
