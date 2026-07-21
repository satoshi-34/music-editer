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
