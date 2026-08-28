# 設計書: 保存・自動保存の再設計（起動時サイレント復元とスロット分離）

## 問題

- 起動時に自動読込が無く、常に空の譜面から始まっていた。
- 自動保存（編集から1.5秒後）と手動「保存」ボタンが同じ localStorage キー（`music-score-app-data` /
  `music-score-app-backup` / `music-score-app-meta`）を共有していた。
- そのため、次のような実害があった。
  1. リロード直後は空の譜面から始まる。そこにユーザーが新しい編集を始めると、
     自動保存が「ごく少量の新しい内容」で前回の保存データを上書きし、
     以前の譜面データが失われる。
  2. 手動「保存」ボタンで保存したデータも同じキーに書かれるため、自動保存や
     「新規作成」で簡単に上書き・消去されてしまい、「保存」の安心感が成立していなかった。
- 既知バグとして `.claude/../MEMORY.md` 側にも「リロードで保存データ喪失」の記録あり
  （検証時はリロード禁止という運用回避で対処していた）。

## 新設計

### 保存領域（localStorage キー構成）

```
手動保存スロット（従来のキー名を維持。「保存」「読込」ボタンが対象）
  music-score-app-data      … 現在の保存内容
  music-score-app-backup    … 直前世代（上書き前の内容）
  music-score-app-meta      … チェックサム・バージョン・保存時刻

自動保存スロット（新設。編集のたびに裏で書き込む）
  music-score-app-autosave          … 現在の自動保存内容
  music-score-app-autosave-backup   … 直前世代
  music-score-app-autosave-meta     … チェックサム・バージョン・保存時刻

移行マーカー（新設。旧キー→新キーの複製を1回だけ行うためのフラグ）
  music-score-app-autosave-migrated
```

`src/utils/storage.ts` では `StorageSlotKeys`（primary/backup/metadata の3キー1組）という
内部型を導入し、保存・読込・存在確認・クリアの実処理（`saveScoreDataToSlot` /
`loadScoreDataFromSlot` / `hasStoredDataInSlot` / `clearStoredDataInSlot`）をスロット共通化した。
手動用（`MANUAL_SLOT_KEYS`）と自動保存用（`AUTOSAVE_SLOT_KEYS`）はこの共通処理へキー名だけを
渡す薄いラッパー関数として公開する:

- 手動: `saveScoreData` / `loadScoreData` / `hasStoredData` / `clearStoredData`（従来と同じ関数名・シグネチャを維持）
- 自動保存: `saveAutosaveData` / `loadAutosaveData` / `hasAutosaveData` / `clearAutosaveData`（新規）

### データフロー

```
起動（ScorePage マウント）
  │
  ├─ migrateLegacyDataToAutosave()  … 旧データが残っていれば自動保存スロットへ複製（1回だけ）
  │
  ├─ loadAutosave()
  │     ├─ データあり → 画面へ復元し、restoreNotice を3秒表示 + console.info
  │     └─ データなし → rightHandData を undefined→[] にして「空で編集開始」
  │
  └─ setAutosaveRestoreReady(true)  … ここまでは自動保存の書き込みを止める

編集（rightHandData 等が変化するたび）
  │
  ├─ 1.5秒デバウンス
  ├─ autosaveRestoreReady === false → 何もしない（起動直後の空楽譜が上書きするのを防ぐ）
  ├─ buildScoreData() の parts が isEmptyScoreData() === true → 何もしない
  └─ saveAutosave(...) で自動保存スロットへ書き込み（直前世代は自動的に backup へ退避）

手動「保存」ボタン
  └─ saveScore(...) で手動保存スロットへ書き込み（自動保存とは別キー、影響なし）

手動「読込」ボタン
  └─ loadScore() で手動保存スロットから読み込み（自動保存の内容は無視）

「新規作成」ボタン
  └─ clearAutosaveData() で自動保存スロットのみ消去。手動保存スロットには触れない。
     画面状態は空の単旋律譜へ初期化（従来の `score-new-document` 設計を踏襲）。
```

### 世代バックアップ

`saveScoreDataToSlot` は、新しい内容を書き込む **直前** に、その時点で primary キーに
入っている内容（＝これから上書きされる世代）を backup キーへコピーする。これにより
「1つ前の世代」が常に backup に残る。従来は「保存のたびに primary と全く同じ内容を
backup にも書く」というミラー方式だったため、backup が世代バックアップとして機能して
いなかった（誤って保存した直後に「1つ前」へ戻す手段がなかった）。

### 空判定（`isEmptyScoreData`）

全パート・全小節について、`measure.events` と `measure.voices[].events` のいずれにも
イベントが無ければ「空」とみなす。空のときは自動保存を **スキップ**（＝何もしない）する
ことで、「起動直後の空楽譜」や「新規作成直後の空楽譜」が既存の自動保存データを
上書きしてしまう事故を防ぐ。「新規作成」で明示的に空へ戻したいときは、この判定に
頼らず `clearAutosaveData()` を直接呼んでいる（意図した「空にする」操作は素通りさせる）。

### 移行（`migrateLegacyDataToAutosave`）

自動保存/手動保存が同じキーを共有していた旧バージョンのデータ向けに、初回起動時
一度だけ実行する。

- 移行マーカー（`music-score-app-autosave-migrated`）があれば何もしない。
- 自動保存スロットに何も無ければ、旧キー（`music-score-app-data` / `-backup` / `-meta`）の
  内容をそのまま自動保存スロットへ複製する。
- 旧キー（＝現在の手動保存スロット）は複製するだけで、消去・書き換えは一切しない。
  そのため移行後もそのまま手動保存スロットとして使い続けられ、「読込」ボタンから
  従来どおり呼び出せる。
- 既にユーザーが自動保存スロットへ書き込んでいる場合（例えば移行後に一度でも
  編集した場合）は、再度この関数を呼んでも上書きしない（1回だけの移行を保証）。

### 通知

起動時のサイレント復元が成功したときは、`SaveLoadButtons` の自動保存ステータス表示の
隣に「自動保存データから復元しました」を3秒間表示する（`restoreNotice` props）。
あわせて `console.info('[ScorePage] 起動時に自動保存データから復元しました')` を出力する。

## 影響範囲

- `src/utils/storage.ts`: `StorageSlotKeys` 共通化、`saveAutosaveData` / `loadAutosaveData` /
  `hasAutosaveData` / `clearAutosaveData` / `isEmptyScoreData` / `migrateLegacyDataToAutosave` を追加。
  世代バックアップの書き込みタイミングを変更（ミラー方式→直前世代退避方式）。
- `src/utils/storage.test.ts`: 上記の新規関数のテストを追加。世代バックアップの仕様変更に
  伴い、既存のチェックサム復旧テストを新しい backup 仕様に合わせて更新。
- `src/hooks/useScoreStorage.ts`: `saveAutosave` / `loadAutosave` / `hasAutosaveData` /
  `clearAutosaveData` を追加公開。
- `src/hooks/useScoreStorage.test.ts`: 上記のテストを追加。
- `src/components/ScorePage.tsx`:
  - マウント時に一度だけ実行する起動時復元 `useEffect` を追加（`migrateLegacyDataToAutosave` →
    `loadAutosave` → 画面へ反映 → `autosaveRestoreReady` を true にする）。
  - 自動保存 `useEffect` は `autosaveRestoreReady` でゲートし、`saveScore` ではなく
    `saveAutosave` を呼ぶよう変更。`isEmptyScoreData` で空のときはスキップ。
  - `handleNewScore` は `clearStoredData()`（手動保存スロット消去）ではなく
    `clearAutosaveData()`（自動保存スロットのみ消去）を呼ぶよう変更。確認ダイアログの
    文言も「自動保存データも消去します（手動保存したデータは残ります）」に変更。
- `src/components/SaveLoadButtons.tsx`: `restoreNotice` props を追加し、起動時復元の
  通知を表示できるようにした。
- 依存ライブラリの追加はなし。

## 既知の制限・今後の課題

- 起動時復元は `useEffect`（マウント後）で行うため、復元前に一瞬だけ空の譜面が
  描画される（ちらつき）。自動保存の書き込み自体は `autosaveRestoreReady` でゲート
  しているため、この一瞬の空表示が保存データへ影響することはない。
- 「自動保存から復元」を独立ボタンとして読込ボタンの隣に置く案は今回は見送った
  （起動時の自動復元で大半のケースをカバーできるため）。将来的に「起動時には
  自動復元しない設定」などが必要になった場合は、このボタンの追加を検討する。

## 追記（2026-07-30, Issue #117）: measuresPerSystem が自動保存 deps から漏れていた

### 問題

Issue #107（`ensembleSecondStaffParts` 欠落）と同じ形の取りこぼしが `measuresPerSystem`
（段あたり小節数）にもあった。自動保存 `useEffect` は `saveAutosave` の引数として
`measuresPerSystem` を渡す（＝保存対象）が、`measuresPerSystem` の `useState` 宣言が
自動保存 `useEffect` より**後方**にあったため、依存配列に入れられず
（`// 後方宣言のため deps に入れられない` というコメント付きで意図的に除外されていた）、
「段あたり小節数」だけを変更して閉じると自動保存が走らなかった。

なお、同じコメントで除外されていた `totalSystems` はコードを確認した結果
`const totalSystems = 12` の**定数**であり、変更されることが無いため元々 deps 不要
（バグではない）。トリアージにより本Issueは `measuresPerSystem` のみが対象で、
Issue本文にあった「段数/ページ」（`systemsPerPageSetting`）は画面設定として別に
localStorage 保存されており自動保存の対象外のため、範囲外と判断された。

### 修正設計

- `measuresPerSystem` の `useState` 宣言を自動保存 `useEffect` より前
  （`autoSaveStatus` の宣言の直前）へ移動し、依存配列に追加した。
  宣言を移動しても初期値は固定値 `4` で他状態に依存しないため、TDZ・宣言順の問題は
  発生しない。
- 自動保存 `useEffect` 直前のコメントを実態に合わせて更新（`totalSystems` は定数、
  `measuresPerSystem` は前方宣言化済みで deps に含む旨）。

### 影響範囲

- `src/components/ScorePage.tsx`: `measuresPerSystem` の `useState` 宣言位置の変更、
  自動保存 `useEffect` の依存配列とコメントの更新（`totalSystems` の宣言・他の関数
  （`handleExportFile` 等）は変更なし）。
- `src/components/ScorePageAutosaveDeps.test.tsx`: `measuresPerSystem` が自動保存の
  依存配列に含まれることを検証するテストを追加。

## 追記（2026-08-12, Issue #229）: ファイル保存の失敗が無言で、0バイトの抜け殻が残っていた

### 問題

`showSaveFilePicker`（File System Access API）は、ユーザーが保存先を決めてダイアログを
閉じた時点で **0 バイトのファイルを作る**。中身を書くのはそのあとの
`createWritable()` → `write()` → `close()` である。

埋め込みブラウザ・一部の WebView では、ファイル作成までは成功するのに直後の
`createWritable()` が `NotAllowedError` で弾かれることがある。旧実装はこのとき
`console.warn` だけを出して blob ダウンロードへ切り替えていたため、次の2つの実害があった
（運用者の実機テストで実際に誤認が発生した）。

1. **選んだ場所に 0 バイトのファイルが残る。** 見た目はファイル名も日時も正しいので、
   ユーザーはそれを保存できた本物だと思ってしまう（開くと空で、譜面は失われたように見える）
2. **ダウンロードへ切り替わったことが画面に出ない。** ユーザーは何が起きたか分からない

### 修正設計

#### 1. 戻り値を「保存できたか」ではなく「どの経路で終わったか」にする

`exportScoreToFile` の戻り値を `FileSystemFileHandle | null` から `ExportScoreResult`
（判別可能ユニオン）へ変えた。`null` のままでは「キャンセル」「非対応ブラウザの通常
ダウンロード」「書き込み失敗のフォールバック」の3つが区別できず、画面側が通知の要否を
判断できないため。

| status | 意味 | 通知 |
| --- | --- | --- |
| `saved` | 選んだ場所へ書き込めた（`handle` は次回の上書き用） | 出さない |
| `cancelled` | 保存先ダイアログを閉じた（何も起きていない） | 出さない |
| `downloaded` | File System Access API 非対応（Safari/Firefox）の通常経路 | **出さない**（正常系のため） |
| `fallback-download` | 保存先は選べたのに書き込みに失敗し、ダウンロードで代替した | **出す**（`leftoverEmptyFile` で文面が変わる） |

`downloaded` と `fallback-download` を分けたのが要点で、Safari/Firefox では
ダウンロードこそが正しい保存経路なので、そこに警告を出すと毎回の保存が
「失敗したように見える」ノイズになる。

#### 2. 抜け殻ファイルの後始末（`tryRemoveCreatedFile`）

書き込みに失敗したら `handle.remove()` で空ファイルの削除を試みる。`remove()` は
Chromium 系にしかない新しめの API なので、**存在しない場合と例外を投げた場合の両方**を
「消せなかった」として扱い、`leftoverEmptyFile: true` を返して画面側から削除をお願いする。

**削除してよいのは「今回このダイアログで作ったハンドル」だけ**である。上書き用に
渡された既存ファイルのハンドル（`fileHandle` 引数）は消してはならない。既存ファイルの
中身はユーザーの財産であり、`createWritable` の失敗時には無傷のまま残っているためで、
ここを取り違えると「保存に失敗したらファイルが消えた」という、元の不具合より重い
データ喪失になる。実装では `createdHandle` という別変数でこの2つを区別している。

#### 3. ファイル作成後の `AbortError` はキャンセル扱いにしない

旧実装は `AbortError` を一律「ユーザーがキャンセルした」とみなしていたが、
ファイルを作ったあとに中断された場合は抜け殻が残る。そこで
**「まだファイルを作っていないとき（`createdHandle === null`）の `AbortError` だけ」**を
`cancelled` とし、それ以外はフォールバック経路（削除の試行＋通知）へ流す。

#### 4. 通知の出し方

`SaveLoadButtons` に `warningNotice` props を追加した。位置と形は既存の `restoreNotice`
トーストに合わせつつ、色を橙、`role` を `alert`（読み上げ時に割り込む）にして、
成功通知（緑・`role="status"`）と区別している。表示時間は 10 秒で、`restoreNotice` の
3 秒より長い。ユーザーに後始末（空ファイルの削除）をお願いすることがあり、読む前に
消えてしまうと通知の意味が無くなるため。

文面は削除の成否で変える。

- 削除できた: 「選択した場所へ書き込めなかったため、ダウンロードに保存しました」
- 削除できなかった: 上に「選択先にできた空のファイルは削除してください」を足す

### 影響範囲

- `src/utils/fileStorage.ts`: `ExportScoreResult` 型と `tryRemoveCreatedFile` /
  `downloadJson` を追加。`exportScoreToFile` の戻り値の型が変わった（呼び出し元は
  `ScorePage.handleExportFile` の1箇所のみ）。読み込み側 `importScoreFromFile` は変更なし。
- `src/components/ScorePage.tsx`: `fileSaveWarning` state とタイマー、`showFileSaveWarning` を追加。
  `handleExportFile` が `status` を見て通知を出す形になった。
- `src/components/SaveLoadButtons.tsx`: `warningNotice` props と橙のトーストを追加。
- `src/utils/fileStorage.test.ts`（新規）: 成功／キャンセル／`NotAllowedError` の3経路に加え、
  `remove()` 非対応・`remove()` が失敗・**上書き経路では削除しない**・ファイル作成後の
  `AbortError`・非対応ブラウザの `downloaded`・ファイル名の除去を固定。
- `src/components/ScorePageFileSaveFallback.test.tsx`（新規）: 画面まで通して通知が出ること、
  文面が削除の成否で変わること、成功・キャンセルでは通知が出ないことを固定。
- `README.md`: 「困ったとき」に、この通知が出たときの対処（ダウンロードに入っている／
  空ファイルを消す）を追記。

### 今後の課題

- 上書き用のハンドルで書き込みに失敗した場合、そのハンドルは `fileHandleRef` に
  残したままにしている（保存先を忘れる＝次回またダイアログが出て、壊れた環境では
  再び空ファイルが作られるため）。同じ場所への保存が続けて失敗する環境では、
  毎回ダウンロードへ切り替わる形になる。
- `WorkListPanel` の作品削除など、他の失敗経路の通知は今回の対象外。

## 追記（2026-08-13, Issue #236）: 手動「保存」が成功しても画面に何も出なかった

### 問題

「その他」タブの「保存」ボタンは、押しても画面が何ひとつ変わらなかった。保存自体は
成功しているのに（localStorage の `music-score-app-data` に書かれている）、押した本人には
「保存されたのか、ボタンが効かなかったのか」が分からない。

失敗時も同じく分かりにくかった。`useScoreStorage` の `error` は
`SaveLoadButtons` の `error` props 経由で赤い `.error-message` として出るため
**無言ではなかった**（例外を握りつぶしている箇所は無く、`saveScoreDataToSlot` の
`try/catch` は `StorageResult.error` として必ず外へ返している）が、
ツールバーのボタン列の中に英文で小さく出るだけで、「保存の結果」だとは読み取りにくい。

### 修正設計

#### 1. 表示系を新設せず、既存の自動保存インジケータに相乗りする

画面右下には自動保存の状態（「自動保存中…」「✓ 自動保存済み」）を出す控えめな固定表示が
既にある。手動保存の結果もここに出す。同じ意味の表示（＝保存の成否）が画面の2箇所に
増えると、どちらを見ればよいのか分からなくなるため、**枠は1つのまま共用**する。

`SaveLoadButtons` に `manualSaveStatus: 'idle' | 'saved' | 'failed'` を追加し、
出す内容は次の優先順で決める（`saveIndicator`）。

| 条件 | 文言 | 色 | `role` |
| --- | --- | --- | --- |
| `manualSaveStatus === 'saved'` | ✓ 保存しました | 緑 `#4caf50` | `status` |
| `manualSaveStatus === 'failed'` | ⚠ 保存できませんでした | 赤 `#d32f2f` | `alert` |
| `autoSaveStatus === 'saving'` | 自動保存中… | 灰 `#999` | `status` |
| `autoSaveStatus === 'saved'` | ✓ 自動保存済み | 緑 `#4caf50` | `status` |

**手動保存を優先する**のは、ユーザーが自分で押して結果を待っている表示だからである。
自動保存は裏で勝手に走るものなので、待たせない側を譲る。
不透明度も手動のときだけ 0.75 → 1 に上げる（枠・位置・大きさは自動保存と同じ）。
失敗は `role="alert"` にして、スクリーンリーダーでは読み上げに割り込ませる。

#### 2. 表示時間は成功3秒・失敗10秒

成功は自動保存の通知と同じ3秒。失敗は「なぜ保存できなかったか」の詳細（赤い
`.error-message`）まで目を移してもらう必要があるため、Issue #229 の警告トーストと同じ
考え方で長め（10秒）に残す。タイマーはアンマウント時に片付ける
（`fileSaveWarningTimerRef` と同じ `useEffect` にまとめた）。

#### 3. 失敗の詳細表示は既存のまま

赤い「⚠ 保存できませんでした」は**何が起きたかの見出し**で、理由の文言は従来どおり
`.error-message`（`useScoreStorage` の `error`）が担う。読込の失敗も同じ経路を使っており、
そこを手動保存専用に作り替えると読込側の表示が消えるため、二重表示を承知で残している。

### 影響範囲

- `src/components/SaveLoadButtons.tsx`: `manualSaveStatus` props と `saveIndicator` の
  出し分けを追加。既存の自動保存インジケータの `<span>` をそのまま流用し、
  テスト用に `data-testid="save-status-indicator"` を付けた。
- `src/components/ScorePage.tsx`: `manualSaveStatus` state・`showManualSaveStatus` を追加し、
  `handleSave` が成否のどちらでも呼ぶようにした。保存処理そのものは変更なし。
- `src/components/ScorePageManualSaveFeedback.test.tsx`（新規）: 画面まで通した成功・失敗の
  表示と、インジケータの優先順・`role` を固定。
- `README.md`: 「基本操作」の保存の項に、右下の表示について1文追記。
- ストレージ層（`storage.ts` / `useScoreStorage.ts`）は変更なし。

### 無言のボタンの棚卸し（トリアージの3点目）

「その他」タブを中心に、押しても結果が分からないボタンを洗い出した。
**本Issueで直したのは「保存」のみ**で、残りは別Issue化の材料。

| ボタン | 現状 | 判定 |
| --- | --- | --- |
| 保存 | 本Issueで対応済み | ✅ |
| 読込 | 成功すれば譜面そのものが変わる。失敗は `.error-message` | フィードバックあり |
| ファイル保存 | 書き込み失敗時のみ橙トースト（#229）。成功・キャンセルは無言 | OS のダイアログとダウンロードが実質のフィードバック。優先度低 |
| ファイルを開く | 成功すれば譜面が変わる | フィードバックあり |
| **MusicXML書出 / MIDI書出** | `downloadMusicXml()` / `downloadMidi()` を呼ぶだけで、**成功も失敗も画面に出ない**。例外は誰も捕まえずコンソールに出るだけ | **別Issue候補（最有力）** |
| PDF書出 / 印刷 | `window.print()` でブラウザのダイアログが開く | フィードバックあり |
| **サンプル保存**（DEV ビルドのみ） | `saveCustomPianoDemoScore()` の成否を画面に出さない | 別Issue候補（DEV 限定のため優先度低） |
| 既定として保存 / 初期設定に戻す | `settingsProfileNotice` で数秒表示（#39） | フィードバックあり |
| 作品一覧の削除 | 確認ダイアログあり。削除後は一覧から消える | フィードバックあり |

### 実装中に見つけた別件（本Issueのスコープ外）

**自動保存が編集していなくても回り続ける。** 自動保存 `useEffect` の依存配列に
`scoreTimeSignature` が入っているが、この値は
`normalizeTimeSignature(tempoSettings.timeSignature)` の戻り値＝**レンダーのたびに
新しい配列**である。そのため再レンダーのたびに effect が貼り直され、1.5秒後に自動保存が
走り、そのステータス更新でまた再レンダーが起きる、という自走ループになっている
（ブラウザ実測: 何も操作していなくても右下の「✓ 自動保存済み」が約8秒周期で点滅し続ける）。
本Issueの表示とは独立した既存の挙動なので触っていないが、`useMemo` で配列を安定させれば
止まる見込み。

## 追記（2026-08-15, Issue #278）: MusicXML書出・MIDI書出が成功も失敗も無言だった

### 問題

「その他」タブの **MusicXML書出 / MIDI書出** は、`downloadMusicXml()` / `downloadMidi()` を
呼ぶだけで、**成功しても失敗しても画面に何も出なかった**（Issue #236 で作った
「無言のボタンの棚卸し」の最有力候補）。

- 成功時: ダウンロードが始まれば気づけるが、ブラウザの設定によっては保存先ダイアログも
  出ないため「押したのに何も起きない」ように見える
- 失敗時: **完全に無言**。`handleExportMusicXml` / `handleExportMidi` に `try/catch` が無く、
  例外は誰も捕まえずコンソールに流れるだけだった（利用者はコンソールを開かない）

書出処理は `scoreToMusicXml()` / `scoreToMidi()`（変換）と `URL.createObjectURL()`＋
`<a>.click()`（ダウンロード）からできており、どちらの段でも例外は起こりうる。

### 修正設計

#### 1. 表示は #236 の右下インジケータを共用する（新しい表示を増やさない）

Issue #236 と同じ考え方で、**枠は1つのまま**にする。書出ボタンは `SaveLoadButtons` の外
（「その他」タブの並びの後ろ）にあるが、結果の表示だけを `SaveLoadButtons` へ集約した
（`exportStatus` props を新設）。固定表示を2つ出すと画面右下で重なって読めなくなり、
`role="status"` が2つになって支援技術に二重で読み上げられてしまうため。

出す内容は次の優先順で決める（`saveIndicator`）。書出を先頭に足しただけで、既存の
手動保存・自動保存の順序は変えていない。

| 条件 | 文言 | 色 | `role` |
| --- | --- | --- | --- |
| `exportStatus.kind === 'success'` | ✓ MusicXMLを書き出しました / ✓ MIDIを書き出しました | 緑 `#4caf50` | `status` |
| `exportStatus.kind === 'error'` | ⚠ MusicXMLを書き出せませんでした: 〈理由〉 | 赤 `#d32f2f` | `alert` |
| `manualSaveStatus === 'saved'` | ✓ 保存しました | 緑 | `status` |
| （以下 #236 のまま） | | | |

#### 2. 新しい操作の結果を出すときは、古いほうの表示を消す

同じ枠を共用しているため、**先に出ていた表示が残っていると新しい操作の結果が隠れる**
（例: 書出の失敗は10秒残るので、その間に「保存」を押しても結果が見えない）。
`ScorePage` 側の `showExportStatus` / `showManualSaveStatus` を対称に作り、
どちらも「相手のタイマーを止めて idle に戻してから自分を出す」ようにした。
表示の優先順（`SaveLoadButtons`）だけで解こうとすると、この「あとから押した操作」の
向きを表現できない。

#### 3. 表示時間は成功3秒・失敗10秒（#236 とそろえる）

失敗は理由まで読む時間が要るので長め。タイマーはアンマウント時に片付ける
（`fileSaveWarningTimerRef` / `manualSaveStatusTimerRef` と同じ `useEffect` にまとめた）。

#### 4. 失敗の理由は文面に含める

手動保存の失敗（#236）は理由を `.error-message`（`useScoreStorage` の `error`）が担うが、
書出は `useScoreStorage` を通らないので、理由の受け皿がどこにも無い。そのため
`⚠ MusicXMLを書き出せませんでした: 〈理由〉` と1文に含める形にした。
`describeExportError()` は `Error` 以外（文字列など）が throw されたときも
`String()` で文字にして出す（`[object Object]` になっても、無言よりはましなため）。
理由の文が長くなることがあるので、インジケータの `<span>` に `maxWidth: 360` を付けた
（右端固定のまま左へ伸びて画面外へ出てしまうのを防ぐ）。

### 影響範囲

- `src/components/ScorePage.tsx`: `exportStatus` state・`showExportStatus` を追加し、
  `handleExportMusicXml` / `handleExportMidi` を `try/catch` で包んだ。
  `showManualSaveStatus` に「書出の表示を消す」処理を追加。
  **書き出すファイルの中身（`scoreToMusicXml` / `scoreToMidi`）は一切変更していない。**
- `src/components/SaveLoadButtons.tsx`: `ExportStatus` 型と `exportStatus` props を追加し、
  `saveIndicator` の先頭に置いた。`<span>` に `maxWidth` / `lineHeight` を追加。
- `src/components/ScorePageExportFeedback.test.tsx`（新規）: 成功・失敗の表示、
  失敗時の `role="alert"` と色、失敗のあと押し直すと成功表示に変わることを固定。
- PDF書出（`window.print()`）は対象外。ブラウザの印刷ダイアログが開くこと自体が
  フィードバックになっているため（Issue 本文の指定どおり）。

### 残った「無言のボタン」

#236 の棚卸し表のうち、**MusicXML書出 / MIDI書出は本Issueで解消**した。
残るのは **サンプル保存**（DEV ビルド限定のため優先度低）と、
**ファイル保存の成功・キャンセル**（OS のダイアログとダウンロードが実質のフィードバック）。

## Safari でファイルを開けない問題の修正（#464・2026-08-28 実機）

- 隠しファイル入力（.score.json / MusicXML）が `display: none` だと、Safari は
  プログラムからの `.click()` を無視することがあり「開く→ファイル」で何も起きない
  （Chromium は動く）。「レイアウトに存在するが不可視」の定石スタイル
  （fixed 1×1・opacity 0・pointer-events none・clip-path）へ変更した
- あわせて `tabIndex={-1}` / `aria-hidden="true"` を付与し、見えないタブストップ・
  読み上げ対象にならないようにした（Codex round1）
- `accept` は拡張子のみだと Safari の解釈ゆらぎで正しいファイルまでグレーアウトする
  ことがあるため、MIME を併記（.json+application/json、
  .xml/.musicxml+application/xml,text/xml,application/vnd.recordare.musicxml+xml）
- .mxl（圧縮MusicXML）は #465 で対応済み（下記の節を参照）
- 配線テスト: ScorePageFileOpenWiring.test.tsx（メニュー→click 呼び出し・display:none でない・
  a11y 属性・accept の MIME 併記を実マウントで固定）

### 続報: 「開く」を select からボタン群へ（#464・2026-08-28 実機で確定）

不可視スタイル化（前節）後も Safari でダイアログが開かなかった。実機の切り分け
（デバッグ用の直接ボタン→開く／select の change 経由→開かない）により、
**Safari は `<select>` の change イベントをファイルダイアログを開ける「ユーザー操作
（user activation）」と認めない**ことが確定。「開く」メニューを select からボタン群
（ファイル／MusicXML／以前の手動保存）へ変更した。書き出しメニューはダウンロード系で
ダイアログを開かないため select のまま。配線テスト（ScorePageFileOpenWiring）は
ボタン経由の click 検証+「開く combobox が存在しない」の回帰ガードへ更新。

## 圧縮MusicXML（.mxl）の読み込み対応（#465・2026-08-28）

Finale の既定書き出しは .mxl（ZIP コンテナ）で、対面テスト（2026-08-28）で弟の実ファイルが
開けなかった実害を受けて対応した。

- 展開は `src/utils/mxlUtils.ts`。判定は拡張子ではなく**マジックバイト（PK\x03\x04）**で行う
  ため、「.xml なのに実は zip」のファイルも救える
- エントリ解決は MusicXML 仕様どおり META-INF/container.xml の rootfile を最優先し、
  無い/壊れている場合は「META-INF 以外の最初の .xml/.musicxml」へフォールバック
  （現実の .mxl には container 欠落品が流通しているため）
- 失敗は MxlExtractError（notZip / brokenZip / noXmlEntry / tooLarge）で理由を持ち、
  describeMxlExtractFailed が「非圧縮で書き出し直す」代替手順つきで通知する（#318）。
  「.mxl なのに ZIP マジックが無い」ファイル（先頭破損）も一般の XML パース失敗へ落とさず
  notZip として通知する
- **zip bomb 対策（Codex 指摘）**: 伸長は container.xml と選ばれた MusicXML 本体の
  2エントリだけに限定（fflate `unzipSync` の filter で他をスキップ）。さらに
  圧縮ファイル 32MB・展開後1エントリ 128MB・エントリ数 1024 の上限を設け、
  超過は tooLarge で通知する。名前の列挙も filter（全 false）で行い伸長しない
- 読み込み経路は readAsText → **readAsArrayBuffer** に変更。非圧縮 XML は TextDecoder(utf-8)
  で従来どおり読む（回帰テストあり）
- ZIP 展開は fflate（依存ゼロ・MIT・軽量）。JSZip は Promise ベースで依存も大きく見送り。
  追加は scripts/safe-add-package-in-docker.sh（--ignore-scripts）経由
- テスト: mxlUtils.test.ts（container あり/なし/壊れ rootfile/XML 無し/非ZIP/切断 ZIP/
  サイズ上限の7件）・ScorePageMxlImport.test.tsx（.mxl 読込・非圧縮回帰・XML 無し ZIP・
  切断 ZIP・マジック無し .mxl の通知、実マウント5件）
