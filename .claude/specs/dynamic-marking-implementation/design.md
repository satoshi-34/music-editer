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

## 追記: descresc. の追加（Issue #423, 2026-08-27）

### 問題

変化強弱の文字表記は `cresc.` / `dim.` の2つだけだった。実際の楽譜（月光ソナタなど）では
`dim.` と同じ意味で `descresc.` と書かれることがあり、その表記が選べなかった。

### 修正設計

**「dim. の表示バリエーション」ではなく、`RelativeDynamicMarking` の独立した値として追加した。**
表示バリエーションにすると `DynamicMarking` に「表記の種類」フィールドを足すことになり、
保存形式・バリデーション・パレットの選択状態がすべて二段構えになる。値を1つ増やすほうが、
既存の「同じ記号をもう一度選ぶと解除」「絶対強弱と共存」の仕組みにそのまま乗る。

- `RelativeDynamicMarking = 'cresc' | 'dim' | 'descresc'`。保存バリデーションは
  `isDynamicMarkingValue` 経由なので追加の変更は不要（新しい値がそのまま通り、未知の文字列は従来どおり弾かれる）
- 再生は `resolveDynamicVelocities` の `relative === 'cresc' ? 増 : 減` の分岐にそのまま乗り、
  `dim.` と同じく次の絶対強弱へ向かって段階的に弱くなる
- 描画・衝突回避で「文字系か（＝SMuFL グリフを持たないか）」を判定していた
  `value === 'cresc' || value === 'dim'` というベタ書きの分岐は、値が増えるたびに直し漏れるため
  `isRelativeDynamicMarkingValue()` に置き換えた（`dynamicGlyphMetricsFor` / `orderedDynamicMarkings` /
  パレットの文字サイズ分岐）
- 表記の正本は `editorContextLabels.dynamicSymbol()` に一本化した。
  `formatDynamicMarking()`（譜面描画）が同じ変換をコピーで持っていたため、
  そちらから `dynamicSymbol()` を呼ぶ形へ変えている（パレットのボタン・文脈バー・譜面の3か所で表記がずれない）

### MusicXML との対応

MusicXML の `<wedge>`（松葉）は別機能で、文字表記の `cresc.` / `dim.` は**もともと書き出していない**
（`dynamicsDirectionXml` は `pp`〜`ff` の絶対強弱だけを `<dynamics>` として出力する）。
`descresc.` も同じ扱いで、今回 MusicXML 側の変更は無い。将来 `<words>` として書き出す場合は、
`descresc.` は `dim.` と同じ `<direction-type><words>` に文字列そのままを載せるのが素直
（MusicXML に descresc. 専用の要素は無く、あくまで表記の違いであるため）。

### 影響範囲

| ファイル | 変更内容 |
|---|---|
| `src/types/storage.ts` | `RelativeDynamicMarking` に `'descresc'` を追加 |
| `src/utils/dynamicMarkingUtils.ts` | 一覧・文字系判定の共通化・表記を `dynamicSymbol` へ委譲 |
| `src/utils/editorContextLabels.ts` | `descresc.` の表記と日本語ラベル |
| `src/components/Palette.tsx` | ボタン追加（演奏記号タブ） |

## MusicXML 読み込みの追加（Issue #552・2026-09-02）

### 問題

書き出し側（`dynamicsDirectionXml`）は `<direction><direction-type><dynamics><p/>…` を
出していたのに、読み込み側に `<dynamics>` を解釈する処理が無かった（`musicXmlImport.ts` に
`dynamics` の文字列が1つも無い状態）。松葉（`<wedge>`）だけが復元されるため、
**自分で書き出したファイルでも往復で文字強弱が消える**非対称が残っていた
（2026-09-01 の運用者QA「トルコ行進曲・検聴版」で p・f が消えた）。

さらに書き出し側も、追加声部（声部2以降）のループでは強弱の `<direction>` を出していなかった。
読み込みだけ直しても声部2の往復は戻らないため、こちらも合わせて出すようにした。

### 修正設計

- **走査は増やさない**: 「音符の直前の `<direction>` を次の音符へ付ける」という規則は
  松葉とまったく同じなので、既存の `attachHairpinsToVoiceEvents` を
  `attachDirectionMarksToVoiceEvents` へ改名し、その1本の走査の中で
  `pendingDynamics`（松葉の `pendingTypes` と同じ待ち行列）も解決する。
  同じ歩き方の2枚目を作らない（別実装が片方だけ直る #280 型の事故を避ける）
- **五線ごとの振り分けは既存の仕組みに乗る**: 大譜表の読み込みでは、`<direction>` を
  自五線ぶんだけに絞る既存フィルタ（`allChildren`）を通ったあとの子要素を走査するため、
  `<staff>` 指定に従って各段へ付く。リハーサルマーク・速度標語の「1番目の五線だけ」規則とは
  意図的に別（強弱は段ごとに置かれるため。#552 仕様3）
- **対応外の強弱は取り込まない**: `pp/p/mp/mf/f/ff` 以外（`sfz`・`fp`・`ppp`・
  `<other-dynamics>` など）は最も近い値へ寄せずに捨てる。勝手に別の記号へ化けるほうが
  害が大きいため。捨てた件数は `MusicXmlImportResult.unsupportedDynamicsCount` で返し、
  ScorePage の読み込み通知（`importNotices`）へ
  `describeImportedUnsupportedDynamics` として積む（#318「黙って消さない」）
- **件数の数え方**: 声部・五線ごとの走査で数えると、五線で分けて2回読むパート（大譜表）で
  二重に数える。そこで `countUnsupportedDynamics` が文書全体を1回だけ見る
- **二重付与の防止**: 同じ音符に既にある値は足さない（`<dynamics>` が重複したファイル・
  往復で二重化したデータのどちらでも1つに畳む）

### 影響範囲

- `utils/musicXmlImport.ts`（`readImportableDynamics` / `attachDirectionMarksToVoiceEvents` /
  `countUnsupportedDynamics` / `MusicXmlImportResult.unsupportedDynamicsCount`）
- `utils/musicXmlExport.ts`（追加声部のループで強弱 `<direction>` を出す）
- `utils/scoreEditorNotices.ts`（`describeImportedUnsupportedDynamics`）
- `components/ScorePage.tsx`（読み込み通知へ積む）
- テスト: `utils/musicXmlDynamics.test.ts`（往復・松葉との共存・声部2・大譜表の staff 振り分け・
  未対応記号のスキップと件数・強弱が無いファイルの回帰）

## 大譜表では強弱を両手に共有する（Issue #626・2026-09-04）

運用者QA（悲愴 第2楽章 8小節版）「全声部同じ音量で何か違う」。原因: 強弱の解決
（`resolveDynamicVelocities`）がパート単位・主声部の音ごとで、右手に付いた p は右手だけを下げ、
左手の伴奏は既定 0.5 のまま＝伴奏が旋律より大きく鳴っていた。記譜の意味では強弱は
「その時点の全体の音量」で、旋律を浮かせるのは奏者の匙加減（別件）。

- **拍位置で引く時系列** `buildDynamicVelocityTimeline(partsMeasures, beatsPerMeasure)`:
  全パート・全声部の記号を絶対拍位置で1本に並べ、`velocityAt(絶対拍)` で任意の位置の基準音量を返す。
  絶対強弱はその位置から切り替え、cresc./dim.（文字・松葉）は**次の絶対強弱の位置まで直線**で変化
  （次が無ければ終端まで ±0.2）。二分探索で音ごとに O(log 記号数)
- 最初の案（片手の記号を他方の主声部の音へ写してから従来の解決を掛ける）は Codex round1〜2 で
  「主声部が休符の区間・小節をまたぐと副声部が既定へ戻る」「写し先が無いと逆行する」「同じ写し先に
  cresc. と f が集まると両方載る」と穴が続いたため撤回。音の index に縛られた解決をやめ、
  位置で引く形にしたことで全部消える
- ScorePage の再生経路: ピアノは両パートの記号で1本、四重奏・編成譜はパートごとに1本。
  どの声部の音も自分の拍位置（複数声部は `startBeat`、単声部は前向きの累積）で引く。
  途中再生は「切る前の全列」で作り、絶対拍は時系列側の `positionOf(小節, 拍)`
- 絶対拍は「各小節の実際の前進幅」（拍子の拍数と中身の長さの大きいほう＝エンジンの前進と同じ）の
  累積（`measureAdvanceBeats`）。小節番号 × 拍子の拍数だと途中拍子変更で位置が衝突する（round3 P2）。
  **時計は各パート自身**: 記号は「小節番号・小節内拍」で集め（`collectDynamicMarkings`、ピアノは両手ぶん）、
  受け取るパートが自分の前進幅で絶対拍へ置き直す。エンジン・ハイライト・タイ・ペダルはすべて
  各パート独立の前進で動くので、両手の最大で共有すると全部と食い違う（round4〜5）。片手だけ長い
  小節は元データが拍子に合っていない状態で、その小節内だけ左右の記号の位置が拍数ぶんずれるのは許容
- 相対記号は**その位置での実音量**から始め、先行の区間はそこで打ち切る（cresc. の途中の dim. で跳ばない）。
  同一位置では絶対強弱を先に適用してから相対を始める（パートの走査順に依存しない）。
  次の絶対強弱は後ろ向きの1回の走査で決め、`velocityAt` は二分探索（round3 P3）
- 従来の `resolveDynamicVelocities`（音ごとの段階変化）はプレビュー等の既存用途に残す
- やらないこと: 旋律を浮かせる声部バランス係数（#626 の項目3）。聴き比べてから別途

テスト: `dynamicMarkingUtils.test.ts`（片手の p の共有・切り替え位置・cresc. の直線と到達・±0.2・
休符区間と小節またぎ・両手の別記号の時系列・記号なし）、
`ScorePageGrandStaffDynamicsWiring.test.tsx`（実マウントで右手だけの p が左手と副声部の velocity へ届く）
