# 設計書: バグ修正 (Bug Fixes)

## 概要

本設計書は、music-editer アプリケーションにおいて発見された9件のバグに対する修正設計を記述します。修正対象は以下のレイヤーに分類されます。

| レイヤー | ファイル | 修正件数 |
|---|---|---|
| データ永続化層 | `src/utils/storage.ts` | 1件 |
| 音声エンジン層 | `src/audio/SoundSource.ts`, `src/audio/AudioEngine.ts` | 3件 |
| 五線譜描画層 | `src/components/StaffCanvas.tsx` | 3件 |
| ページ管理層 | `src/components/ScorePage.tsx` | 2件 |

---

## 修正 1: `loadScoreData()` の再帰呼び出し除去

**ファイル**: `src/utils/storage.ts` 行 276–298

### 問題

チェックサム不一致時、プライマリデータを削除して `loadScoreData()` を再帰呼び出ししていた。
プライマリとバックアップが異なるデータを持ち、かつ両方ともチェックサム不一致の場合：
1. 第1回呼び出し: プライマリ不一致 → バックアップ存在 → PRIMARY削除 → 再帰
2. 第2回呼び出し: バックアップを rawData として読む → バックアップ不一致 → backupData === rawData のため分岐せず → バックアップデータを **エラーなく返す**（サイレントなデータ破損）

### 修正設計

再帰を削除し、インラインでバックアップを検証・使用するロジックに変更する。

```typescript
// Before (問題のあるコード)
if (currentChecksum !== metadata.dataChecksum) {
  const backupData = localStorage.getItem(STORAGE_KEYS.BACKUP);
  if (backupData && backupData !== rawData) {
    localStorage.removeItem(STORAGE_KEYS.PRIMARY);
    return loadScoreData(); // ← 再帰
  }
}

// After (修正後)
if (currentChecksum !== metadata.dataChecksum) {
  const backupRaw = localStorage.getItem(STORAGE_KEYS.BACKUP);
  if (backupRaw && backupRaw !== rawData) {
    try {
      const backupParsed = JSON.parse(backupRaw);
      if (
        validateSavedScoreData(backupParsed) &&
        generateChecksum(backupRaw) === metadata.dataChecksum
      ) {
        return { success: true, data: backupParsed }; // ← 直接返す
      }
    } catch {
      // バックアップも破損している場合はエラーへ
    }
  }
  return {
    success: false,
    error: { type: StorageErrorType.CORRUPTED_DATA, ... }
  };
}
```

### 影響範囲

- `loadScoreData()` 関数のみ
- 呼び出し元（`useScoreStorage.ts`）のインターフェース変更なし

---

## 修正 2: `_performInstrumentLoad()` の AudioContext null/closed 対応

**ファイル**: `src/audio/SoundSource.ts` 行 272–278

### 問題

AudioContext が `null` または `closed` の場合、`return` するだけで `synthMap` に何も登録しない。  
コメントに「楽器が『読み込み済み』として扱われる」とあり、実装の意図と動作が乖離していた。  
加えて、`reconnectAllSynths()` が呼ばれない場合は Synth が永遠に作成されない。

### 修正設計

AudioContext が利用できない場合はエラーをスローし、呼び出し元（`loadInstrument()`）の `finally` ブロックで `loadingPromises` をクリアする。次の呼び出し時に再試行可能にする。

```typescript
// Before
const context = this.Tone.getContext();
if (!context || context.state === 'closed') {
  console.log('AudioContextが未作成のため遅延...');
  return; // ← 誤動作の原因
}

// After
const context = this.Tone.getContext();
if (!context || context.state === 'closed') {
  throw new Error(
    `AudioContextが利用できないため楽器 ${type} を作成できません。` +
    `AudioContextを開始してから再試行してください。`
  );
}
```

### 影響範囲

- `_performInstrumentLoad()` → `loadInstrument()` のエラー伝播
- `loadInstrument()` の `finally` がエラー時も `loadingPromises.delete()` を実行するため、次回呼び出しは正常に再試行される
- `setCurrentInstrument()` の自動ロードもエラーハンドリング済み（catch で console.error）

---

## 修正 3: `unloadInstrument()` のリソースリーク修正

**ファイル**: `src/audio/SoundSource.ts` 行 519–527

### 問題

```typescript
// 問題のあるコード
if (this.loadingPromises.has(type)) {
  this.loadingPromises.get(type)?.then(() => {
    this.unloadInstrument(type); // ← 再帰呼び出し
  });
  this.loadingPromises.delete(type); // ← 同期的に削除済み
}
```

`delete` が非同期コールバックより先に実行される。コールバック内で `unloadInstrument` を再帰呼び出しすると：
- `synthMap.has(type)` が true → `dispose()` は正常実行
- `loadingPromises.has(type)` が false → 追加処理なし

見かけ上は動くが、再帰構造と Promise + 同期削除の順序依存があり、将来的な変更で壊れやすい。

### 修正設計

再帰をやめ、Promise 参照を保持してから削除し、コールバック内で直接 synthMap を操作する。

```typescript
// After
if (this.loadingPromises.has(type)) {
  const pendingPromise = this.loadingPromises.get(type)!;
  this.loadingPromises.delete(type); // 参照を持ってから削除
  pendingPromise.then(() => {
    const synth = this.synthMap.get(type);
    if (synth) {
      try { synth.dispose(); } catch {}
      this.synthMap.delete(type);
    }
  }).catch(() => {
    // ロード失敗時は synth 未作成なので何もしない
  });
}
```

### 影響範囲

- `unloadInstrument()` のみ
- `dispose()` 内のループからも `unloadInstrument()` の代わりに直接 `synthMap` を操作する既存コードは変更不要

---

## 修正 4: `getBoundingBox()` null 時のフォールバック改善

**ファイル**: `src/components/StaffCanvas.tsx` 行 674–679

### 問題

`getBoundingBox()` が `null` を返す場合、幅を固定 20px としていた。音符が多い場合や大きな音符では 20px が狭すぎ、クリック判定領域が重複する。

### 修正設計

小節幅 `wDraw` と音符数 `vfNotes.length` から比例幅を算出し、最小値を 20px として保証する。

```typescript
// Before
const width = bb ? bb.getW() : 20;

// After
const fallbackNoteWidth = Math.max(20, wDraw / (vfNotes.length + 1));
// ...
const width = bb ? bb.getW() : fallbackNoteWidth;
```

また `getAbsoluteX()` のフォールバックも既存の `anchors` 計算（行 759）と整合するよう修正。

```typescript
// Before
const leftX = n.getAbsoluteX ? n.getAbsoluteX() : (measLeft + j * 20);

// After
const leftX = n.getAbsoluteX
  ? n.getAbsoluteX()
  : (measLeft + (j + 1) * (wDraw / (vfNotes.length + 1)));
```

### 影響範囲

- `doInsertAt()` 関数内のクリック判定ロジックのみ
- VexFlow が正常に BoundingBox を返す場合（通常ケース）は動作変更なし

---

## 修正 5: スナップ計算の精度修正

**ファイル**: `src/components/StaffCanvas.tsx` 行 209

### 問題

`Number(line.toFixed(1))` は 0.1 刻みで丸めるため、0.5 刻みのスナップには不適切。  
例: `line = 0.49999...` → `toFixed(1)` → `"0.5"` → `0.5`（偶然正しい）  
例: `line = 1.449999...` → `toFixed(1)` → `"1.4"` → `1.4`（**0.5 刻みではない**）

### 修正設計

`Math.round(line * 2) / 2` を使用して 0.5 刻みで正確に丸める。

```typescript
// Before
bestLine = Number(line.toFixed(1));

// After

---

## 修正 10: SoundFont 再生失敗時の内蔵音源フォールバック

**ファイル**: `src/components/ScorePage.tsx`

### 問題

音色プレビューと全体再生は `PlaybackEngine` を経由していたが、`soundfont` モードで音源パック読み込みや `AudioContext` 再開に失敗した場合、実ブラウザではそのまま無音になりやすかった。  
とくにプレビューと再生ボタンはどちらも同じエンジン初期化経路を通るため、一度 SoundFont 側で失敗すると「両方とも鳴らない」状態になる。

### 修正設計

`ScorePage` に `runWithPlaybackFallback()` を追加し、通常は選択中の音源方式で再生を試み、`soundfont` 失敗時のみ `built-in` エンジンへ切り替えて再試行する。  
保存用の `playback-sound-runtime-settings.engineMode` はそのまま残しつつ、UI 表示用には「今実際に鳴っている方式」を別 state で持ち、内蔵音源へ逃がした瞬間だけ `built-in` 表示へ切り替える。

```typescript
try {
  const preferredEngine = await prepareAudioEngine();
  return await action(preferredEngine);
} catch (error) {
  if (soundRuntimeSettings.engineMode !== 'soundfont') {
    throw error;
  }

  const fallbackEngine = await switchToBuiltInFallbackEngine();
  return await action(fallbackEngine);
}
```

`switchToBuiltInFallbackEngine()` は一時的なローカル変数ではなく、`audioEngineRef.current` 自体を内蔵音源へ差し替える。これにより、再生予約直後にエンジンが破棄されて音が止まる事故を防ぐ。  
同時に `temporaryBuiltInFallbackRef` を立てておき、次回 `prepareAudioEngine()` のときに、ユーザーが選んでいた `soundfont` や `plugin` の設定へ戻す。  
`PlaybackControls` には `activeSoundEngineMode` と `isTemporaryBuiltInFallback` を渡し、選択中は `SoundFont` のままでも、実再生が `built-in` に落ちている間はセレクト表示と補足文を一致させる。

Safari でもまず選択中の音源方式で再生を試し、`initialize()` や音源読み込みで失敗した場合のみ `built-in` へ逃がす。  
これにより、SoundFont が正常に鳴る環境では、前回追加したリアル寄りの音色差をそのまま活かせる。

### 影響範囲

- `handleInstrumentPreview()`

---

## 修正 11: built-in 再生時の毎回再生成をやめて Safari 無音を減らす

**ファイル**: `src/components/ScorePage.tsx`

### 問題

`ScorePage` は再生ボタンと音色プレビューのたびに `prepareAudioEngine()` を通るが、  
以前の実装では `engineMode === 'built-in'` のたびに `recreateAudioEngine()` を呼び、
`SimpleAudioEngine` を毎回新しく作り直していた。

この方針は一見安全に見えるが、Safari では短い間隔で `AudioContext` を閉じて作り直すと、
ユーザー操作直後でも出力経路が不安定になり、再生開始処理は通るのに実音だけ出ないことがあった。  
とくに再生ボタンと音色プレビューは同じ経路を通るため、一度この状態に入ると両方まとめて無音になりやすい。

### 修正設計

通常の built-in 再生では既存エンジンを再利用し、毎回の再生成をやめる。  
作り直しは次の「必要な場面」に限定する。

- 音源方式やパック名を切り替えた直後
- 一時 built-in フォールバックから本来の方式へ戻すとき
- 背景復帰後の安全策で新しいエンジンへ差し替えるとき
- 実際に再生が失敗し、最後の保険として built-in を作り直すとき

これにより、Safari 向けに入れていた `SimpleAudioEngine.initialize()` の
`resume / primeOutput / closed 再作成` といった復旧処理を生かしつつ、
不要な `AudioContext` の作り直しだけを減らせる。

```typescript
// Before
if (soundRuntimeSettings.engineMode === 'built-in') {
  temporaryBuiltInFallbackRef.current = false;
  audioEngine = recreateAudioEngine();
} else if (temporaryBuiltInFallbackRef.current) {
  // ...
}

// After
if (temporaryBuiltInFallbackRef.current) {
  temporaryBuiltInFallbackRef.current = false;
  audioEngine = recreateAudioEngine();
} else {
  audioEngine = getAudioEngine();
}
```

### 影響範囲

- `prepareAudioEngine()` の built-in 準備経路
- 再生ボタン (`handlePlay`)
- 音色プレビュー (`handleInstrumentPreview`)

### セキュリティ・安定性配慮

- 再利用中でも `initialize()` を毎回通すため、`suspended / interrupted / closed` の状態確認は継続する
- 復旧不能な失敗時は従来どおり `runWithPlaybackFallback()` から built-in 再生成へ退避する
- 不要な `AudioContext` の増減を減らし、Safari 固有の不安定化を避ける

---

## 修正 12: Safari の silent failure に備えた手動音声復旧

**ファイル**: `src/components/ScorePage.tsx`, `src/components/PlaybackControls.tsx`

### 問題

Safari では、再生開始処理も `initialize()` も成功し、例外も発生しないのに、
実音だけ出ない `silent failure` が起こることがある。  
この場合は `runWithPlaybackFallback()` も発火せず、アプリ側から「失敗」と判定しにくい。

### 修正設計

ツールバーに `音声復旧` ボタンを追加し、ユーザーが明示的に押したときだけ
現在の再生エンジンを停止・破棄し、新しい `AudioContext` で再初期化する。

```typescript
getAudioEngine().stopAll();
const recoveredEngine = recreateAudioEngine();
await recoveredEngine.initialize();
```

これにより、Safari のタブやブラウザを閉じ直さなくても、
ページ内だけで音声経路をリセットできる可能性が高くなる。

### 影響範囲

- `PlaybackControls` の音声操作 UI
- `ScorePage` の音声復旧経路

### セキュリティ・安定性配慮

- 復旧処理はユーザー操作起点のボタンに限定し、自動で大量に `AudioContext` を作り直さない
- 復旧前に `stopAll()` とタイマー初期化を行い、古い再生予約が残らないようにする
- 復旧失敗時は、ページ再読み込みや Safari 再起動へ案内する
- `handlePlay()`（新規再生パス）
- `playback-sound-runtime-settings` の保持方針

### 期待される効果

- SoundFont の取得失敗時でも、少なくとも内蔵音源でプレビューや再生が鳴る
- ユーザーが「ボタンを押しても完全に無音」の状態に留まりにくくなる
- Safari 対策後も、ユーザーが選んだ SoundFont 設定自体は失われない
- Safari でも SoundFont が正常に使える環境では、楽器差や SoundFont パック差が再び反映される

## 修正 11: 個別音符再生の音色を現在選択へ同期

**ファイル**: `src/components/ScorePage.tsx`, `src/components/StaffCanvas.tsx`, `src/components/PianoSystemCanvas.tsx`

### 問題

再生ボタンや音色プレビューは `PlaybackEngine` 系で現在の楽器を参照していたが、音符クリックの個別再生は `defaultAudioEngine + SoundSource + NotePlayer` の別経路だった。  
このため、臨時記号適用後の確認音だけがデフォルト楽器や以前の楽器へ戻ることがあった。

### 修正設計

`ScorePage` の `currentInstrument` を譜面コンポーネントへ渡し、`StaffCanvas` / `PianoSystemCanvas` 側で `notePlayerRef.current.setSoundSource(currentInstrument)` を呼んで同期する。  
さらに `NotePlayer` 初期化直後にも `SoundSource` を `currentInstrument` にそろえてから楽器を読み込み、`useEffect` の初回実行が早すぎて同期を取りこぼすケースを防ぐ。

### 期待される効果

- 個別音符再生、臨時記号クリック後の確認音、全体再生、音色プレビューで同じ楽器音色を保てる

## 追記: 入力確認音を PlaybackEngine 系へ統一

### 問題

上記の同期だけでは、音符を置いた瞬間の確認音が `NotePlayer + SoundSource` の Tone.js 系シンセを通るため、  
再生ボタンや音色プレビューが使う `PlaybackEngine` 系の音と完全には一致しなかった。  
その結果、`ピアノ` を選んでいても SoundFont 側のピアノではなく、Tone.js 側の簡易シンセ音に聞こえるケースが残っていた。

### 修正設計

`ScorePage` に入力確認音専用の `handleInputNotePreview()` を追加し、`runWithPlaybackFallback()` を通じて現在の再生エンジンへ直接 `playNoteByName()` を送る。  
`StaffCanvas` / `PianoSystemCanvas` / `PianoStaff` / `QuartetStaff` には `onPreviewNoteEvent` を渡し、入力時の確認音は親の `PlaybackEngine` を優先利用する。

### 期待される効果

- 音符を置いた瞬間の確認音も、再生ボタン・音色プレビューと同じ音源方式 / 同じ楽器音色で鳴る
bestLine = Math.round(line * 2) / 2;
```

### 動作検証

| line 入力 | toFixed(1) | Math.round(x*2)/2 | 期待値 |
|---|---|---|---|
| 0.0 | 0.0 | 0.0 | 0.0 ✓ |
| 0.24 | 0.2 ❌ | 0.0 | 0.0 ✓ |
| 0.26 | 0.3 ❌ | 0.5 | 0.5 ✓ |
| 1.5 | 1.5 | 1.5 | 1.5 ✓ |
| 1.74 | 1.7 ❌ | 1.5 | 1.5 ✓ |

---

## 修正 6: 空小節の拍数を定数に抽出

**ファイル**: `src/components/ScorePage.tsx` 行 23–29

### 問題

空小節の拍数が `4` というマジックナンバーでハードコードされていた。アプリは現在 4/4 拍子固定だが、コードの意図が不明確。

### 修正設計

ファイル先頭に定数 `BEATS_PER_MEASURE` を定義し、参照する。

```typescript
const BEATS_PER_MEASURE = 4; // 4/4拍子固定

function calculateScoreDuration(...) {
  // ...
  totalDuration += (60 / bpm) * BEATS_PER_MEASURE;
}
```

---

## 修正 7: `AudioEngine.start()` の null ガードとロジック整理

**ファイル**: `src/audio/AudioEngine.ts` 行 127–144

### 問題

`this.Tone.getContext().state` を複数箇所で評価し、同じ処理（`Tone.start()`）を重複した if-else 分岐で記述。さらに `getContext()` が null を返す可能性への対応がない。

### 修正設計

`getContext()` の null チェックを追加し、`running` 以外は一律 `Tone.start()` を呼ぶよう簡潔化。

```typescript
// After
const toneContext = this.Tone.getContext();
if (!toneContext) {
  throw new Error('Tone.jsのAudioContextを取得できませんでした。');
}
console.log('[AudioEngine] 現在のTone.jsコンテキスト状態:', toneContext.state);

if (toneContext.state !== 'running') {
  await this.Tone.start();
} else {
  console.log('[AudioEngine] AudioContextは既に実行中です');
}
```

---

## 修正 8: keydown リスナーの Ref 化による効率化

**ファイル**: `src/components/StaffCanvas.tsx` 行 276–278, 401–462

### 問題

`useEffect` の依存配列に `selected` を含めていたため、音符を選択するたびにリスナーが削除・再登録されていた。音符配置操作が多い場合、これが頻繁に発生する。

### 修正設計

`selectedRef` と `disabledRef` を導入し、リスナーはマウント時に1度だけ登録する。

```typescript
// 追加するRef
const selectedRef = useRef(selected);
const disabledRef = useRef(disabled);
useEffect(() => { selectedRef.current = selected; }, [selected]);
useEffect(() => { disabledRef.current = disabled; }, [disabled]);

// リスナー内で ref を参照
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const selected = selectedRef.current;
    if (!selected || disabledRef.current) return;
    // ...
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, []); // 依存配列を空にしてマウント時1回のみ登録
```

### アーキテクチャ上の考慮

Ref パターンはイベントハンドラが最新の状態を参照する必要がある場合の React 標準的なアプローチ。  
`setScore` への `setState` コールバック（`prev => ...`）はすでに最新の状態を参照するため、変更不要。

---

## 修正 9: リサイズイベントのデバウンス追加

**ファイル**: `src/components/ScorePage.tsx` 行 285–290

### 問題

`resize` イベントはスクロール中に毎フレーム発火し、`setColumns()` が何度も呼ばれる。これにより `useAutoPageScale` を含む連鎖的な再レンダリングが発生する。

### 修正設計

`setTimeout` による 150ms デバウンスを実装し、リサイズ終了後に1回だけ状態更新する。

```typescript
// After
const [columns, setColumns] = useState(window.innerWidth < 1200 ? 1 : 2);
useEffect(() => {
  let timer: ReturnType<typeof setTimeout>;
  const onResize = () => {
    clearTimeout(timer);
    timer = setTimeout(() => setColumns(window.innerWidth < 1200 ? 1 : 2), 150);
  };
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    clearTimeout(timer); // アンマウント時もクリア
  };
}, []);
```

150ms は一般的なデバウンス遅延値（UX 的に体感しにくい範囲）。

---

## 正確性プロパティ

**プロパティ1: データ読み込みの非再帰性**
`loadScoreData()` の実行において、自身を再帰呼び出しするコードパスは存在しない。
**検証対象: 要件 1.1, 1.2**

**プロパティ2: チェックサム失敗時のエラー返却**
バックアップも含め全データのチェックサムが不一致の場合、関数は `success: false` を返し、アプリをハングさせない。
**検証対象: 要件 1.2, 1.4**

**プロパティ3: 楽器ロードの冪等性**
AudioContext が正常な状態で同じ楽器を複数回 `loadInstrument()` しても、`synthMap` に同じエントリは重複しない。
**検証対象: 要件 2.2, 2.3**

**プロパティ4: Synth リソースの完全解放**
`unloadInstrument()` 呼び出し後、対象楽器の Synth インスタンスは必ず `dispose()` され、`synthMap` から削除される。ロード中であっても完了後に解放される。
**検証対象: 要件 3.1, 3.2, 3.3**

**プロパティ5: スナップ値の離散性**
`snapLineBySpacing()` の戻り値 `bestLine` は常に `n * 0.5`（n は整数）である。
**検証対象: 要件 5.1, 5.2, 5.3**

**プロパティ6: keydown リスナーの単一登録**
`StaffCanvas` がマウントされている間、`window` の `keydown` リスナーの登録数は常に1である。
**検証対象: 要件 8.1, 8.2**

**プロパティ7: デバウンス後の正確な状態反映**
リサイズイベント終了から 150ms 後、`columns` 状態は `window.innerWidth` の現在値を正確に反映する。
**検証対象: 要件 9.1, 9.2**

---

## エラーハンドリング方針

| 修正 | エラー種別 | 対応方針 |
|---|---|---|
| 修正1 | CORRUPTED_DATA | `StorageResult<null>` でエラーを返却、クラッシュなし |
| 修正2 | AudioContext 未作成 | エラーをスロー、呼び出し元の catch で処理 |
| 修正3 | Promise 失敗 | `.catch()` でスキップ（Synth 未作成のため解放不要） |
| 修正4 | BoundingBox null | 比例幅でフォールバック（デグレードグレース） |
| 修正7 | getContext() null | 明確なエラーメッセージでスロー |

---

## 修正 10: Safari CSS zoom 座標ズレ修正（繰り返し再発バグ）

**ファイル**: `src/components/StaffCanvas.tsx`, `src/components/PianoSystemCanvas.tsx`

> ⚠️ このバグは過去に複数回再発している。詳細は [`docs/safari-coordinate-transform.md`](../../docs/safari-coordinate-transform.md) を参照。

### 問題

`App.css` の `.page-wrapper { zoom: var(--scale, 1) }` と Safari の `getBoundingClientRect()` の非互換により、Safari でのみカーソル位置と音符描画位置の高さがずれる。Mac の内蔵ディスプレイ（scale<1.0）でのみ発生し、外部モニター（scale=1.0）では正常。

失敗の連鎖:
1. `getComputedStyle(svgEl).getPropertyValue('--scale')` が Safari では SVG 要素で空を返す
2. フォールバックの DOM 走査も `getComputedStyle(el).zoom` が `zoom: var(--scale)` を解決できず 1 を返す
3. `cssZoom = 1` → `bcrReflectsZoom = true`（false positive）→ 補正コードが実行されない

### 修正設計

HTML 要素 `.page-wrapper` から `--scale` を読む（CSS カスタムプロパティは HTML 要素で確実に継承される）。
位置補正は `.page-wrapper.getBoundingClientRect()` を zoom 境界の視覚 anchor として使う。

```typescript
function getAccumulatedCSSZoom(el: Element): number {
  // SVG 要素では Safari で --scale が継承されないため、HTML 要素 .page-wrapper から読む
  const wrapper = el.closest('.page-wrapper');
  if (wrapper) {
    const v = parseFloat(window.getComputedStyle(wrapper).getPropertyValue('--scale').trim());
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 1;
}

function clientToGroup(svg, _group, clientX, clientY) {
  // clientY には yOffsetRef.current を加算済みで渡す
  const svgRect = svg.getBoundingClientRect();
  const cssZoom = getAccumulatedCSSZoom(svg);
  const logW = svg.width.baseVal.value;
  const logH = svg.height.baseVal.value;
  const expectedVisualW = logW * cssZoom;
  const bcrReflectsZoom = Math.abs(svgRect.width - expectedVisualW) < logW * 0.05;
  const visualW = bcrReflectsZoom ? svgRect.width : expectedVisualW;
  const visualH = bcrReflectsZoom ? svgRect.height : logH * cssZoom;

  let originLeft = svgRect.left, originTop = svgRect.top;
  if (!bcrReflectsZoom) {
    const zoomContainer = svg.closest('.page-wrapper');
    if (zoomContainer) {
      const cr = zoomContainer.getBoundingClientRect();
      originLeft = cr.left + (svgRect.left - cr.left) * cssZoom;
      originTop  = cr.top  + (svgRect.top  - cr.top)  * cssZoom;
    }
  }
  const x = (clientX - originLeft) * (vbW / visualW);
  const y = (clientY - originTop)  * (vbH / visualH);
  return { x, y };
}
```

### 再発防止ルール

- SVG キャンバスで mouse/click 座標変換をするコンポーネントを新規追加する際は、上記パターンを必ず使う
- `getScreenCTM().inverse()` および `getBoundingClientRect()` の単純差分は使わない
- `getAccumulatedCSSZoom` は SVG 要素ではなく HTML 要素から `--scale` を読む
- 修正後は Safari で [`docs/REGRESSION.md`](../../docs/REGRESSION.md) セクション D のチェックを実行する

---

## 修正 12: 弦楽四重奏対応・アルト記号サポート（新機能）

**ファイル**: `src/components/PianoSystemCanvas.tsx`, `src/components/QuartetStaff.tsx` (新規), `src/components/clefUtils.ts` (新規), `src/components/ScorePage.tsx`, `src/components/StaffCanvas.tsx`, `src/types/storage.ts`, `src/utils/storage.ts`

### 概要

Violin I / Violin II / Viola / Cello の 4 段譜面と、Viola パートへのアルト記号（ハ音記号）を追加した。既存のピアノ（2 段）は後方互換を維持したまま動作する。

### アルト記号の音高変換ロジック

アルト記号では中央線（line=2）が C4、最上線（line=0）が G4 になる。

```typescript
// clefUtils.ts
function lineToKeyAlto(line: number): string {
  const stepsDown = Math.round(line * 2); // 0.5行=半音ステップ
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 4 - stepsDown, oct = 4; // G4: idx=4, oct=4
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}

function keyToLineAlto(key: string): number {
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const base = 4 * 7 + idxMap['g']; // G4 = 32
  const target = oct * 7 + idxMap[letter];
  return (base - target) / 2;
}
```

検証: `lineToKey('alto', 0)` → `'g/4'`、`lineToKey('alto', 2)` → `'c/4'`

### N 段汎用レンダリング

`PianoSystemCanvas` に `partsConfig?: PartConfig[]` prop を追加し、段数を動的に対応した。

```typescript
// PartConfig 型
type PartConfig = {
  clef: ClefType;
  data: MeasureData[];
  onChange: (data: MeasureData[]) => void;
  label?: string; // 'Vn. I', 'Vn. II', 'Va.', 'Vc.'
};

// レイアウト動的計算
function computeLayout(n: number) {
  const STAVE_SPACING = 80;
  const FIRST_STAVE_Y = 20;
  return {
    staveYs: Array.from({ length: n }, (_, i) => FIRST_STAVE_Y + i * STAVE_SPACING),
    sysH: FIRST_STAVE_Y + n * STAVE_SPACING + 20,
  };
}
// N=2 では staveYs=[20,100], sysH=160 → 旧定数と完全一致
```

**StaveConnector の自動切替:**
- N=2 → `BRACE`（ピアノ記号）
- N>2 → `BRACKET`（オーケストラ角括弧）

### 後方互換設計

`partsConfig` が未指定の場合、既存の `trebleData`/`bassData` prop から 2 パートを組み立てる。ピアノモードの既存コードは変更不要。

### データ形式の拡張

```typescript
// storage.ts
type ScoreType = 'single' | 'piano' | 'quartet';  // 'quartet' 追加
type PartData = {
  partId: string;  // 'violin-1' | 'violin-2' | 'viola' | 'cello'
  clef: 'treble' | 'bass' | 'alto';  // 'alto' 追加
  measures: MeasureData[];
};
```

### キーボードハンドラの stale closure 対策

キーボードハンドラはマウント時 1 回だけ登録するため、クロージャが古い clef 値を参照しないよう `partsClefRef` を使う。

```typescript
const partsClefRef = useRef<ClefType[]>([]);
// render 本体（useEffect 外）で毎回更新
partsClefRef.current = parts.map(p => p.clef);
```

## 修正 11: Y 補正コントロールによる手動キャリブレーション

**ファイル**: `src/components/ScorePage.tsx`, `src/components/StaffCanvas.tsx`, `src/components/PianoSystemCanvas.tsx`, `src/components/PianoStaff.tsx`

### 背景

修正 10 の自動補正が Safari の特定バージョンや環境で機能しないケースに備え、ユーザーが Y 座標を手動で微調整できる仕組みを追加した。Mac 内蔵ディスプレイ + Safari の環境では `yOffset = 24` で正確に一致することを確認済み。

### 設計

- `ScorePage` がツールバーの「Y補正」ボタン + ポップアップパネルを管理
- `yOffset`（client px 単位）を `localStorage` に保存・復元
- `StaffCanvas` / `PianoSystemCanvas` に `yOffset` prop として渡し、各 `clientToGroup` 呼び出しに加算:

```typescript
// StaffCanvas / PianoSystemCanvas 内
const yOffsetRef = useRef(yOffset);
useEffect(() => { yOffsetRef.current = yOffset; }, [yOffset]);

// イベントハンドラ内
clientToGroup(svg, svgRoot, e.clientX, e.clientY + yOffsetRef.current)
```

- **方向**: 低音方向（画面下）がプラス、高音方向（画面上）がマイナス
- **UI**: ↑/↓ボタン、数値直接入力、キーボード ↑↓ キー対応。0 以外のときボタンに値を表示

## 修正 13: 和音（複数音符の同時配置・再生）対応

**ファイル**: `src/types/storage.ts`, `src/utils/storage.ts`, `src/components/StaffCanvas.tsx`, `src/components/PianoSystemCanvas.tsx`, `src/audio/NotePlayer.ts`, `src/audio/ScorePlayer.ts`

### 背景

これまで `NoteEvent` は 1 スロット = 1 音しか表現できなかった（`key: string`）。和音（C・E・G など複数音の同時発音）に対応するため、データモデルを `keys: string[]` に変更する。

### データモデル変更

```typescript
// 旧（v2）
interface NoteEvent {
  dur: DurKey;
  isRest: boolean;
  key: string;  // 単音
}

// 新（v3）
interface NoteEvent {
  dur: DurKey;
  isRest: boolean;
  keys: string[];  // 単音: ['c/4']、和音: ['c/4','e/4','g/4']
}
```

`CURRENT_VERSION` を `'2.0.0'` → `'3.0.0'` に更新。

### v2 → v3 マイグレーション

`loadScoreData()` 内で、バリデーション前に `migrateKeyToKeys()` を実行:

```typescript
function migrateKeyToKeys(parts: any[]): any[] {
  return parts.map(part => ({
    ...part,
    measures: (part.measures ?? []).map((m: any) => ({
      events: (m.events ?? []).map((ev: any) => {
        if (ev && typeof ev.key === 'string' && !Array.isArray(ev.keys)) {
          const { key, ...rest } = ev;
          return { ...rest, keys: [key] };
        }
        return ev;
      })
    }))
  }));
}
```

### UI: Shift+クリックで和音追加

クリックハンドラ内で `e.shiftKey` を検出し、既存スロットに新しい音高を追加:

```typescript
if (ev.shiftKey && !targetEvent.isRest) {
  const newKey = lineToKey(snapLine);
  if (targetEvent.keys.includes(newKey)) return prev;  // 重複防止
  const newKeys = [...targetEvent.keys, newKey]
    .sort((a, b) => keyToLine(b) - keyToLine(a));  // 低音から高音順
  next[measure].events[index] = { ...targetEvent, keys: newKeys };
}
```

**ソート方向の理由**: VexFlow は `keys` を低音から高音の順で受け取る。`keyToLine` は高い音ほど値が小さいため `b - a` で降順 → 低音が先頭になる。

### キーボードハンドラ: 全音を同時シフト

矢印キーで和音の全音高を同じ量だけ移動（音程を保ったまま）:

```typescript
// 半音シフト（Alt）
const delta = up ? 1 : -1;
const newKeys = ev.keys.map(k => {
  const midi = keyToMidi(k);
  return midi != null ? midiToKey(midi + delta, up) : k;
});

// 線/間 1段シフト（デフォルト）
const diff = up ? -0.5 : 0.5;
const newKeys = ev.keys.map(k => lineToKey(keyToLine(k) + diff));
```

### 音声レイヤー

**NotePlayer**: `playNoteEvent()` が `keys[]` をそのまま PolySynth に渡す:

```typescript
const toneKeys = noteEvent.keys.map(k => this._convertKeyToToneFormat(k));
synth.triggerAttackRelease(toneKeys, duration, time, velocity);
// PolySynth は string[] を受け取り全音を同時発音する
```

**ScorePlayer**: `ScheduledNote.note: string[]` に変更。`generatePlaybackSchedule()` が `event.keys.map(k => convertKeyToToneFormat(k))` で配列を生成。`createPlaybackPart()` は `synth.triggerAttackRelease(event.note, ...)` でそのまま渡す。

### 影響範囲

- VexFlow の `StaveNote` は `keys: string[]` を元々受け入れており、変更なしで和音を表示できる
- PolySynth も `string[]` を受け入れるため、音声側の変更は型変更のみ
- テストファイル全件を `key: 'x/y'` → `keys: ['x/y']` に一括更新（7 ファイル）
## 追記: 再生ボタン / プレビューボタンの built-in 最終フォールバック

### 問題

- 実ブラウザでは `SoundFont` 失敗時だけでなく、既存の built-in `AudioContext` が不安定化して無音になることがある
- 既存の `runWithPlaybackFallback()` は `soundfont` モード時しか built-in へ逃がしておらず、再生ボタンと音色プレビューが同時に無音になるケースを拾い切れない

### 修正

- `src/components/ScorePage.tsx` の `runWithPlaybackFallback()` を一般化し、
  優先エンジンでの再生が失敗したら **常に新しい built-in エンジンを生成して 1 回再試行** するようにした
- これにより、SoundFont 読み込み失敗だけでなく、既存 `AudioContext` の不調でもユーザー操作に対して音が出る確率を上げる

### 影響範囲

- `src/components/ScorePage.tsx`

## 追記: 既定休符位置を五線の第二線へそろえる修正

### 問題

- 新しく置いた休符と空小節の見た目用休符が、五線の中央寄りに見えていた
- 既存の `restKey(clef)` は VexFlow の整列都合には合っていたが、
  「既定では下から 2 本目の線に見せたい」という UI 要件とは少しずれていた
- 一方で、2 voice 描画は `Formatter.alignRests` に依存しており、
  既定キーを雑に差し替えるだけでは既存の重なり回避を壊すリスクがあった

### 修正

- `src/components/clefUtils.ts` に `defaultRestDisplayKey(clef)` を追加し、
  保存データ側の既定休符位置を「下から 2 本目の線」に統一した
- 既存の `restKey(clef)` は Formatter 用の従来位置として残し、
  描画時だけこちらを使って VexFlow の `alignRests` 前提を維持した
- `StaffCanvas.tsx` / `PianoSystemCanvas.tsx` では `formatToStave()` 後に、
  まだ従来位置に残っている既定休符だけを 1 段下げる補正を追加した
- これにより、単声部では見た目を改善しつつ、
  多声部で自動調整された休符はそのまま尊重できるようにした

### 確認ポイント

- 新規休符の初期位置
- 空小節プレースホルダー休符の初期位置
- デモ譜面に埋め込んでいる既存休符データの初期位置
- 休符選択後の `↑/↓` 移動が見た目とずれないこと
- 2 voice で `alignRests` による重なり回避が崩れないこと

## 追記: 単声部の休符の既定位置を標準浄書位置へ戻す修正（Issue #51）

### 問題

- 上記「既定休符位置を五線の第二線へそろえる修正」で導入した「下から2本目の線」は、
  実際には標準の浄書ルールと異なっていた（運用者の実機報告）
- 標準では、全休符は第4線（上から2本目の線）からぶら下げ、
  2分休符以下は五線中央に置くのが正しく、全休符とそれ以外で基準線が異なる
- 従来の `defaultRestDisplayKey(clef)` は音価を区別せず、単声部のすべての休符に
  同じ既定位置（五線中央 line 2）を使っていたため、全休符だけ標準位置からずれていた

### 修正

- `src/components/clefUtils.ts` に `wholeRestDisplayKey(clef)`（第4線 = line 1）と、
  音価で振り分ける `defaultRestDisplayKeyForDuration(clef, duration)` を追加した
  （`duration === '1'` のときだけ `wholeRestDisplayKey`、それ以外は従来の `defaultRestDisplayKey`）
- 単声部の休符を生成しているすべての箇所（新規配置・自動休符補完
  `fillPriorMeasureRests`/`buildRestEventsForBeats`・表示用パディング休符
  `computeVoiceDisplayPadding`/`buildTrailingRestEventsForBeats`・空小節の見た目休符
  プレースホルダー・デモ譜面 `demoScores.ts`）を `defaultRestDisplayKeyForDuration` 経由に変更した
- `computeVoiceDisplayPadding`/`buildTrailingRestEventsForBeats`（`voiceMeasureUtils.ts`）は、
  固定の休符キー文字列ではなく `(duration) => string` のコールバックを受け取る形に変更し、
  貪欲分割で生成される休符ごとに音価に応じたキーを選べるようにした
- `PianoSystemCanvas.tsx` の `makeVFNote` では、保存データの休符キーが
  「音価によらない旧既定位置（五線中央）」のままであれば、描画時に音価に応じた
  標準位置へ自動的に引き上げる自己修復ロジックにした。ユーザーが実際に位置を
  カスタマイズした休符（旧既定位置と一致しないキー）はそのまま尊重する
- 2声部共存小節の休符の上下振り分け（`restKeyForVoice` / `restDisplayLineForVoice`）は
  今回のスコープ外とし、変更していない

### 確認ポイント

- 単旋律・ピアノ・弦楽四重奏・編成譜の単声部小節で、全休符/2分休符/4分休符が標準位置に表示されること
- 2声部共存小節の休符の上下振り分けが従来どおりであること
- 旧既定位置（五線中央）で保存済みの全休符が、再読込・再描画時に自動で正しい位置へ上がること
- `npx vitest --run src` / lint / build が成功すること

## 追記: 保存後に読込ボタンが有効化されない問題

### 問題

- 実ブラウザQAで「保存」クリック後も「読込」ボタンが disabled のまま残るケースを確認した
- 保存データの有無は `localStorage` を直接見る `hasStoredData()` で判定していた
- `localStorage` の中身が変わっても React はそれを state 変更として検知しないため、保存完了後にツールバーが再描画されない場合があった

### 修正

- `ScorePage` に `storedDataAvailable` state を追加し、初期値だけ `hasStoredData()` から読む
- `saveScore()` が成功したタイミングで `storedDataAvailable` を `true` に更新する
- `loadScore()` 後にも `hasStoredData()` を読み直し、保存領域の実態とボタン状態をそろえる

### 影響範囲

- `src/components/ScorePage.tsx`

### 確認ポイント

- 初回起動時、保存データがない場合は「読込」が無効であること
- 「保存」クリック後、ページを切り替えなくても「読込」が有効になること
- 「読込」クリック後もコンソールエラーが出ず、保存した譜面が復元されること

## 追記: 休符の右側クリックが休符置換になる問題

### 問題

- 1小節目に8分休符を置き、その次に8分音符を置こうとすると、既存の8分休符が音符へ置換されることがあった
- 休符イベントの透明 hit rect は、選択しやすくするため時間枠全体を覆っている
- そのため、休符の右側の空白をクリックしても「休符本体をクリックした」と扱われ、同音価の休符置換ルートへ入っていた

### 修正

- `StaffCanvas` / `PianoSystemCanvas` の休符クリック処理で、休符本体付近かどうかを描画アンカー中心の固定幅で再判定する
- VexFlow の休符 bounding box は横に広く返る場合があるため、休符判定には音符用の `noteVisualLeft/Right` を流用しない
- 休符本体から外れたクリックは、休符の選択・置換ではなく通常の挿入処理へ流す
- 休符本体をクリックした場合は従来どおり、1回目は選択、同じ休符の2回目クリックで置換/分割する

### 影響範囲

- `src/components/StaffCanvas.tsx`
- `src/components/PianoSystemCanvas.tsx`

### 確認ポイント

- 8分休符の右側クリックで8分音符が追加され、休符が消えないこと
- 休符本体クリックでは休符を選択できること
- 同じ休符本体をもう一度クリックしたときの置換/分割挙動が残っていること

## 追記: 実在しない背景画像 paper-bg.png への参照を削除

### 問題

- `src/App.css` の `.app-root` が `url('/paper-bg.png')` を背景画像として参照していた
- この画像は `public/` にも Git 履歴のどこにも存在せず、ページを開くたびに 404 リクエストが発生していた（デプロイ先でも同様）
- 画像が取得できないため、実際の表示は以前からフォールバック色 `#0b2a1a`（深緑）の単色だった

### 修正

- 存在しない `url()` 参照を削除し、実際に表示されていた単色 `background: #0b2a1a;` に整理した
- 見た目は従来と変わらず、無駄な 404 リクエストだけがなくなる

### 影響範囲

- `src/App.css`（`.app-root` の `background` 指定のみ）

### 確認ポイント

- 楽譜ページの背景（ツールバー下・ページ外周）が従来どおり深緑の単色で表示されること
- DevTools の Network タブで `paper-bg.png` への 404 リクエストが発生しないこと

## 追記: 段間クリックの当たり判定バグ（隣の段の加線域に吸われる問題）

### 問題

- 単旋律譜（`StaffCanvas.tsx`）で、2段目の五線をクリックしたつもりが、1段目の超低音（下に加線が6本以上伸びた音）として配置される不具合があった。
- 原因は、小節ごとの音符挿入用クリック当たり判定 rect（`rect.vf-hit`）の縦方向の範囲（`rectTop`/`rectBottom`）が、加線域を含めるために五線の上下に広く取られていたこと。
  - `rectTop = stave.getYForLine(-EXTRA_TOP_LINES)`（`EXTRA_TOP_LINES = 6`）
  - `rectBottom = stave.getYForLine(4 + EXTRA_BOTTOM_LINES)`（`EXTRA_BOTTOM_LINES = 10`）
  - 段の間隔は `gap`（デフォルト110px）だが、上記の余白の合計（約 (6+10)×10px=160px 相当）が `gap` を上回るケースがあり、隣接する段の当たり判定 rect と縦方向に重なっていた。
- SVG では DOM で先に描画された（＝上の段の）rect が下の段の rect の上に一部重なって存在する形になり、重なった領域のクリックは常に上の段の rect が受け取ってしまう。そのため「2段目の上部をクリックしたのに1段目の下側の加線域として扱われる」という誤配置が発生していた。
- 多段譜（`PianoSystemCanvas.tsx`、ピアノ大譜表・弦楽四重奏・編成譜で共通利用）でも、同一システム内の隣接パート（ピアノの右手/左手など）の間で同様の重なりがあった。
  - `staveTop = stave.getYForLine(-EXTRA_TOP)`（`EXTRA_TOP = 4`）
  - `staveBot = stave.getYForLine(4 + EXTRA_BOTTOM)`（`EXTRA_BOTTOM = 6`）
  - パート間隔 `STAVE_SPACING`（80px）に対し、余白合計（(4+6)×10px=100px 相当）の方が大きく、同様に重なっていた。

### 修正設計

「クリックYに最も近い段（または最も近いパート）に必ず割り当てる」方式のうち、既存コードへの侵襲が最も小さい **「当たり判定 rect 自体を隣接する段/パートとの中間点でクリップする」** 方式を採用した。

- 隣接する段（パート）同士は `line0`（五線の基準位置、`stave.getYForLine(0)`）が `gap`（または `STAVE_SPACING`）間隔で並んでいるため、中間点は `自分のline0 ± (gap/2)`（スケール `s` で割った値）で求まる。
- 上端・下端のクリップ計算は、**必ず同じ基準点（`line0`）を使う**。実装時に一度、上端クリップは `line0` 基準、下端クリップは `line4`（五線下端）基準という非対称な実装をしてしまい、五線の高さ分だけ重なりが残るバグを作り込んだため、レビューで修正した（`staveLine0` という単一の変数にまとめて両側で使うようにした）。
- 先頭の段（パート）は上側に隣がないためクリップせず、最後の段（パート）は下側に隣がないためクリップしない。
- 音高スナップ（`snapLineBySpacing` の 0.5行刻みロジック）自体は変更していない。変わるのは「どの段/パートの小節としてクリックを受け取るか」の当たり判定範囲だけであり、判定された段の中での音高計算ロジックは従来通り。

```typescript
// src/components/StaffCanvas.tsx（挿入用 insertRect の縦範囲）
const halfGapY = (gap / 2) / s;
const staveLine0 = stave.getYForLine(0);
let rectTop = stave.getYForLine(-EXTRA_TOP_LINES);
let rectBottom = stave.getYForLine(4 + EXTRA_BOTTOM_LINES);
if (line > 0) {
  rectTop = Math.max(rectTop, staveLine0 - halfGapY);
}
if (line < systems - 1) {
  rectBottom = Math.min(rectBottom, staveLine0 + halfGapY);
}
```

```typescript
// src/components/PianoSystemCanvas.tsx（パート間の当たり判定）
const halfPartGapY = (STAVE_SPACING / 2) / s;
const staveLine0 = stave.getYForLine(0);
let staveTop = stave.getYForLine(-EXTRA_TOP);
let staveBot = stave.getYForLine(4 + EXTRA_BOTTOM);
if (pi > 0) {
  staveTop = Math.max(staveTop, staveLine0 - halfPartGapY);
}
if (pi < parts.length - 1) {
  staveBot = Math.min(staveBot, staveLine0 + halfPartGapY);
}
```

この方式により、五線のすぐ上下の加線2〜3本分のクリックは従来通り入力できる（クリップ境界は段/パート間隔の中間点なので、通常の加線入力範囲までは削られない）一方、隣接する段・パートの当たり判定と重ならなくなる。

### 影響範囲

- `src/components/StaffCanvas.tsx`（単旋律譜・複数段の当たり判定）
- `src/components/PianoSystemCanvas.tsx`（ピアノ大譜表・弦楽四重奏・編成譜のパート間の当たり判定）
- `src/components/StaffCanvas.test.tsx`（回帰テストを追加）

### 確認ポイント

- 単旋律譜で2段目の五線内・五線のすぐ上をクリックすると、2段目に正しい音高で配置されること（1段目の超低音として誤配置されないこと）
- 1段目の五線のすぐ下（加線2本分程度）のクリックは、従来通り1段目の低音として入力できること
- ピアノ大譜表で右手パートの下端付近・左手パートの上端付近のクリックが、それぞれ正しいパートに割り当てられること
- 隣接する段・パートの `rect.vf-hit` 同士が縦方向に重ならないこと（ユニットテストで検証）

## 単旋律譜: 段をまたぐと矢印キーの音高変更が効かなくなる問題（2026-07-20）

### 問題

単旋律モード（SingleStaff 経由の PianoSystemCanvas）で、「＋小節を追加」→段ごとの「◀/▶」で小節数調整→「段割りをリセット」などの操作で複数の段を行き来しながら編集していると、音符クリックで選択（確認音も鳴る）はできるのに、ArrowUp/ArrowDown で音高が変わらない（表示もデータも不変）状態になる。同じ譜面をピアノ大譜表に切り替えると正常に動く（切り替えでコンポーネントが作り直され、後述の残存選択が消えるため）。

### 原因

SingleStaff / PianoStaff などは「1段 = 1つの PianoSystemCanvas」を並べる構造で、各インスタンスが

1. 楽譜**全体**のコピー（`partsScore`）
2. 独自の選択 state（`selected` / `selectedArc` / `selectedHairpin`）
3. 独自の `window` keydown リスナー

を持つ。ある段で音符を選択しても**他の段のインスタンスの選択は解除されない**ため、段を移って編集すると複数インスタンスに選択が残る。この状態で矢印キーを押すと、選択を持つ全インスタンスが同時に反応し、それぞれが「自分のコピーに自分の選択分だけシフトを適用した楽譜全体」を `onChange` で親へ送る。親には最後に通知したインスタンスの内容が残るので、**最後以外のインスタンスで行った変更（＝いまクリックした音符の変更）は上書きで消える**。ブラウザ検証では、3段に選択が残った状態で最後の段以外の全音符が「選択できるのに矢印で動かない」ことを確認した。

### 修正設計

選択を楽譜全体で常に1つに保つ。PianoSystemCanvas に `pianosystemcanvas-selection-claimed` という window CustomEvent を追加し、

- 選択（音符・スラー/タイ・松葉のいずれか）が作られたインスタンスは、自分のインスタンスIDを載せてこのイベントを発行する
- 他のインスタンスはイベントを受けて自分の選択をすべて解除する（`selected` は描画 useEffect の deps にあるため、青い選択枠も再描画で消える）

これで keydown に反応するインスタンスは常に1つになり、上書き競合が起きない。

### 影響範囲

- `src/components/PianoSystemCanvas.tsx`（選択一意化イベントの発行・受信）
- `src/components/SingleStaffArrowKeyEdit.test.tsx`（回帰テストを新規追加）

### 確認ポイント

- 単旋律譜で段をまたいで音符を選択し直しても、選択マーカーが常に1つだけ表示されること
- 最後に選択した音符が ArrowUp/ArrowDown で正しく動き、他の段の音符が勝手に動かないこと
- ピアノ大譜表・四重奏・編成譜（同じ構造）でも同様に選択が一意になること

## 選択・ホバー系の矩形が条件により黒塗りになる問題（2026-07-24, Issue #50）

### 問題

ピアノ譜で音符付近に、青枠＋黒塗りの大きな矩形が表示されることがある（音符にカーソルを合わせる/外すの操作に伴い発生）。過去にも一度発生し、その後の変更で解消したように見えたが再発した。

### 原因

`PianoSystemCanvas.tsx` が `document.createElementNS` で動的生成する rect のうち、以下の3つは**fill/stroke属性を持たずCSSクラスに依存**していた。

- `sr`（`.vf-note-selected`。音符選択時の青枠。今回の黒塗りバグの実体）
- `guideChordRect`（`.vf-guide-chord`。和音追加ゾーンの縦ストライプ）
- `keySignatureDebugRect`（`.vf-key-signature-debug`。調号クリック領域の確認用表示）

SVGのfill既定値は黒のため、CSSが適用されない・他ルール（印刷インク統一の `.print-page svg rect:not([fill="none"])` 系など）に負ける・クラス名の変更漏れ等、どれか一つでも起きると黒い矩形として現れる。発生条件が環境依存で再現が不安定なのはこのため。

同種の当たり判定rect（`ir`=`.vf-hit`、`hit`=`.vf-note-hit`、演奏記号の `symbol-hit-region`、リハーサルマーク枠）は既に明示fill/strokeを持っており対象外。

### 修正設計

上記3つのrectに、CSSの値と同じ値を属性としても明示する（CSSは残したまま、属性だけでも正しい見た目になることを保証する）。

- `sr`: `fill="none"` `stroke="#1d4ed8"` `stroke-width="2"`
- `guideChordRect`: `fill="rgba(99, 153, 255, 0.18)"` `stroke="rgba(70, 130, 220, 0.55)"` `stroke-width="1.5"`
- `keySignatureDebugRect`: `fill="rgba(245, 158, 11, 0.16)"` `stroke="rgba(180, 83, 9, 0.55)"` `stroke-width="1.2"` `rx="3"` `ry="3"`

印刷インク統一CSS（`.print-page svg rect:not([fill="none"])` 系）は class 名（`.vf-hit` / `.vf-note-hit` / `.vf-note-selected` / `.vf-key-signature-debug`）で除外しており、fill属性の値そのものでは判定していないため、属性を追加しても印刷時の除外ロジックには影響しない。`vf-guide-chord` はこの除外リストに元々含まれていないが、`display:none` が既定でJS操作時のみ一時的に表示される要素であり、静的な印刷スナップショットには現れないため影響なし。

### 影響範囲

- `src/components/PianoSystemCanvas.tsx`（3箇所のrect生成に明示fill/stroke属性を追加）

### 確認ポイント

- `createElementNS(...,'rect')` の全7箇所（`hit`=symbol-hit-region、`guideChordRect`、`ir`=vf-hit、`keySignatureDebugRect`、`hit`=vf-note-hit、`sr`=vf-note-selected、リハーサルマーク枠）のうち、修正前からfill未設定だったのはこの3箇所のみであることをgrepで確認済み
- ブラウザで音符を選択し、DOM上で `rect.vf-note-selected` の `fill` 属性が `none`、`stroke` が `#1d4ed8` になっていること（computed styleも一致）を確認
- 印刷プレビューで黒塗りの矩形が出ないこと（新規譜面に音符を1つ配置した状態で確認。表示された黒塗りrectは全て正当なもの＝小節線・符幹・符頭で、想定外の大きな黒矩形は無し）
