# リハーサルマーク（練習番号 A, B, C…）の実装

## 背景

README ロードマップ「リハーサルマーク（練習番号 A, B, C…）— 小節クリック系ツールのパターンで追加」を実装した。
すでに「途中テンポ変更」（`MeasureData.bpm`）・「途中拍子変更」（`MeasureData.timeSignature`）・
「途中調号変更」（`MeasureData.keySignature`）・「途中音部記号変更」（`MeasureData.clef`）は
小節単位で実装済みで、パレットの専用ツール→小節クリック→インライン入力（またはドロップダウン）、
というパターンが確立している。リハーサルマークもこのパターンに沿って実装する。

## 設計

### 1. データ型

- `MeasureData.rehearsalMark?: string`（`src/types/storage.ts`）を追加した。
  "A" 〜 "Z"、"AA" のようなアルファベット表記だけでなく、"1" のような数字の練習番号にも
  使えるよう、値は自由文字列（1〜4文字）とした。他の小節単位フィールドと違い「継承」の概念は無く、
  「その小節にマークが付いているか否か」だけを表す単純なフラグ的フィールドである。
- バリデーションは `src/utils/storage.ts` の `validateMeasureData` に追加し、
  `undefined` または「trim して1〜4文字の非空文字列」のみ許可する。

### 2. 自動連番ロジック（`src/utils/rehearsalMarkUtils.ts`）

- `isValidRehearsalMark(value: string): boolean` — 1〜4文字の非空文字列か判定する。
- `suggestNextRehearsalMark(measures: MeasureData[]): string` — 既存の小節データを走査し、
  アルファベット表記（`/^[A-Za-z]+$/`）のマークだけを対象に、エクセルの列名と同じ規則
  （A=1, B=2, …, Z=26, AA=27, …）で数値化して最大値を求め、その次の値をアルファベットに戻して返す。
  既存のアルファベットマークが無ければ `"A"` を提案する。数字のマーク（"1" など）は連番の対象外とし、
  無視する（アルファベットと数字を混在させる運用はユーザーの自由入力に任せる）。
- 単体テスト: `src/utils/rehearsalMarkUtils.test.ts`（バリデーション、A→B→C、Z→AA、AA→AB、
  数字マーク混在時の挙動、途中の小節にしかマークが無い場合の最大値判定）。

### 3. 入力UI（インライン入力オーバーレイ）

`Palette.tsx` に `{ mode: 'measureRehearsal' }` ツールを追加し、「音部記号変更」の隣に
四角枠+"A" のアイコンで配置した。

`StaffCanvas.tsx` / `PianoSystemCanvas.tsx` の両方に、既存の `bpmEditState` と全く同じ構造の
`rehearsalEditState`（`measureAbsoluteIndex`, `currentValue`, `overlayX`, `overlayY`）を追加した。
小節クリック時（背景クリック・音符 hit 要素クリックの両方）に、その小節の既存マークがあればそれを、
無ければ `suggestNextRehearsalMark(score)` で提案した値を `currentValue` の初期値にしてオーバーレイを開く。
入力欄は `autoFocus` のテキスト入力（`maxLength={4}`）で、Enter で確定・Escape でキャンセル・
blur で確定という、途中テンポ変更と同じ操作性にした。

確定処理（`handleRehearsalConfirm`）は、trim して 1〜4文字の非空文字列なら
`rehearsalMark` に保存し、空欄または無効な値なら `undefined`（削除）にする。

### 4. 編成譜・多段譜での保存先

`PianoSystemCanvas.tsx`（ピアノ大譜表・弦楽四重奏・可変編成すべてで共用）では、
調号変更・`repeatStart`/`ending` と同じ「見た目の基準は最上段」パターンに合わせ、
リハーサルマークは **最上段（`partsScore[0]`）の小節データにのみ保存**することにした。

理由: リハーサルマークは「その小節から」ではなく「その小節に」付く一過性の目印であり、
クレフのように楽器ごとに異なるタイミングで必要になるものではない。合奏譜面全体で
共通の練習番号として使うのが一般的な浄書ルールであるため、調号と同じ「最上段基準」を採用した。

### 5. 描画（四角枠+太字）

標準的な浄書ルールに合わせ、SVG の `<rect>` + `<text>` を直接描画する
（`StaffCanvas.tsx` の `rehearsalMarkEntries` 収集→まとめて描画、`PianoSystemCanvas.tsx` も同様）。

**途中テンポ変更（`♩=XXX`）との位置関係**: 同じ小節に両方が設定された場合に重ならないよう、
縦に積む方針にした。

- 途中テンポ変更のテキストは、既存実装のとおり五線上端の 36px 上に表示する。
- リハーサルマークの四角枠は、テンポ表記よりさらに上（五線上端の 56px 上を枠の下端とし、
  枠の高さ 16px を足した位置を上端とする）に表示する。

こうすることで、テンポ変更が無い小節ではリハーサルマークだけが五線に近い位置に表示され、
両方がある小節では「リハーサルマーク（上）→テンポ表記（下）」の順に自然に積まれる。

段と段の間隔が狭いレイアウトでは、リハーサルマークの枠が前の段の五線のすぐ下（＝この段の
五線よりかなり上）に見えることがあるが、これは既存の途中テンポ変更でも同じ配置ロジック
（五線上端からの相対オフセット）を使っており、既存の挙動と一貫している。

`PianoSystemCanvas.tsx` では、保存先と同じく最上段（`pi === 0`）のときだけ
`rehearsalMarkEntries` に積むことで、最上段の上にのみ表示されるようにした。

### 6. MusicXML 書き出し・読み込み

- 書き出し（`src/utils/musicXmlExport.ts`）: 標準的な `<direction placement="above">
  <direction-type><rehearsal>A</rehearsal></direction-type></direction>` 要素として出力する。
  途中テンポ変更の `<direction>` の直後に出力する。
- 読み込み（`src/utils/musicXmlImport.ts`）: `measure.querySelector('direction-type rehearsal')`
  でテキストを取得し、1〜4文字の非空文字列なら `rehearsalMark` として復元する。
- 単体テスト: `src/utils/musicXmlRehearsalMark.test.ts`（書き出し時に該当小節だけに
  `<rehearsal>` が出力されること、export→import の往復で値が復元されること）。

### 7. Undo（既存挙動の確認）

小節単位ツール（`measureTempo` / `measureTimeSig` / `measureKeySig` / `measureClef`）は
`setScore` / `setPartsScore` を通じて `onScoreDataChange` → `ScorePage` の `pushHistory()` に
つながっており、リハーサルマークも同じ経路（`setScore`）で更新するため、既存の
Undo/Redo ボタンの活性・非活性の切り替わり（履歴スタックの push/pop）は他の小節単位ツールと
同じように動作する。今回の実装で新たに Undo 用のコードを追加する必要はなかった。

## 影響範囲

- `src/types/storage.ts`: `MeasureData.rehearsalMark` 追加
- `src/utils/storage.ts`: バリデーション追加
- `src/utils/rehearsalMarkUtils.ts`: 新規（バリデーション・自動連番）
- `src/components/Palette.tsx`: `measureRehearsal` ツール追加
- `src/components/StaffCanvas.tsx`: 入力オーバーレイ・描画・確定処理を追加
- `src/components/PianoSystemCanvas.tsx`: 同上（最上段のみ保存・描画）
- `src/utils/musicXmlExport.ts` / `musicXmlImport.ts`: `<rehearsal>` の書き出し・読み込み
- テスト: `rehearsalMarkUtils.test.ts`, `musicXmlRehearsalMark.test.ts`
