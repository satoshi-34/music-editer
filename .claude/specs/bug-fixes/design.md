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
ただし UI 上の `engineMode` は書き換えず、内蔵音源への切り替えは「その再生操作の間だけ」に限定する。

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

### 期待される効果

- 個別音符再生、臨時記号クリック後の確認音、全体再生、音色プレビューで同じ楽器音色を保てる
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
