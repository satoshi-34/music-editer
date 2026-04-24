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

**ファイル**: `src/components/StaffCanvas.tsx`

> ⚠️ このバグは過去に複数回再発している。詳細は [`docs/safari-coordinate-transform.md`](../../docs/safari-coordinate-transform.md) を参照。

### 問題

`App.css` の `.page-wrapper { zoom: var(--scale, 1) }` と Safari の `getBoundingClientRect()` の非互換により、Safari でのみカーソル位置と音符描画位置の高さがずれる。

- Chrome: `getBoundingClientRect()` は CSS zoom を反映した視覚サイズを返す
- Safari 旧版: CSS zoom を反映しない論理サイズを返す

旧実装の `getScreenCTM().inverse()` も Safari で CSS zoom を反映しないため解決にならない。

### 修正設計

`StaffCanvas.tsx` の `clientToGroup()` を `getAccumulatedCSSZoom()` + viewBox 比率変換に置き換える。
`PianoSystemCanvas.tsx` に同一の実装がある（参照実装）。

```typescript
function getAccumulatedCSSZoom(el: Element): number {
  let zoom = 1;
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const z = parseFloat(window.getComputedStyle(node).zoom || '1');
    if (Number.isFinite(z) && z !== 1) zoom *= z;
    node = node.parentElement;
  }
  return zoom;
}

function clientToGroup(svg, _group, clientX, clientY) {
  const svgRect = svg.getBoundingClientRect();
  const cssZoom = getAccumulatedCSSZoom(svg);
  const expectedVisualW = svg.width.baseVal.value * cssZoom;
  const bcrReflectsZoom = Math.abs(svgRect.width - expectedVisualW) < svg.width.baseVal.value * 0.05;
  const visualW = bcrReflectsZoom ? svgRect.width : expectedVisualW;
  const visualH = bcrReflectsZoom ? svgRect.height : svg.height.baseVal.value * cssZoom;
  // viewBox 座標に変換
  const x = (clientX - svgRect.left) * (vbW / visualW);
  const y = (clientY - svgRect.top)  * (vbH / visualH);
  return { x, y };
}
```

### 再発防止ルール

- SVG キャンバスで mouse/click 座標変換をするコンポーネントを新規追加する際は、上記パターンを必ず使う
- `getScreenCTM().inverse()` および `getBoundingClientRect()` の単純差分は使わない
- 修正後は Safari で [`docs/REGRESSION.md`](../../docs/REGRESSION.md) セクション D のチェックを実行する
