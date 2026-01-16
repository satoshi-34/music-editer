# 設計書

## 概要

五線譜エディタにおいて、1ページ目で音符を追加すると2ページ目の同じ位置にも音符が追加されてしまう不具合を修正します。この問題は、イベントハンドラー内で参照される`measureIndex`変数が、JavaScriptのクロージャの仕組みにより、意図しない値を参照してしまうことに起因しています。

本設計では、イベントハンドラーが正しい小節インデックスを参照するように、スコープ管理を改善します。

## アーキテクチャ

### 現在の問題点

1. **クロージャによる変数の共有**: ループ内で定義された`const measureIndex = globalIndex;`が、すべてのイベントハンドラーで共有される可能性がある
2. **スコープの不適切な管理**: イベントハンドラーが定義時のスコープではなく、ループ終了時のスコープを参照してしまう
3. **デバッグ情報の不足**: どの小節が対象になっているかを確認する手段がない

### 問題の詳細分析

現在のコードでは、以下のような構造になっています：

```typescript
let globalIndex = 0;

for (let line = 0; line < systems; line++) {
  for (let i = 0; i < chosen && globalIndex < score.length; i++, globalIndex++) {
    const measureIndex = globalIndex;  // ⚠️ この変数をクロージャでキャプチャ
    
    // ... 小節の描画 ...
    
    insertRect.addEventListener('click', (e) => {
      // ⚠️ ここで measureIndex を参照
      setScore(prev => {
        const next = prev.map(m => ({ events: [...(m?.events ?? [])] }));
        while (measureIndex >= next.length) next.push({ events: [] });
        const m = next[measureIndex];  // ⚠️ 意図しない値を参照する可能性
        // ...
      });
    });
  }
}
```

**問題の原因**:
- `const measureIndex = globalIndex;`は各反復で新しい変数を作成しますが、JavaScriptのスコープルールにより、イベントハンドラーが参照する値が意図したものと異なる場合があります
- 特に、複数の小節が同じ`measureIndex`を参照してしまう可能性があります

### 解決アプローチ

```
ループ開始
  ↓
各小節に対して
  ↓
即時実行関数（IIFE）またはブロックスコープで独立したスコープを作成
  ↓
スコープ内で measureIndex を定義
  ↓
イベントハンドラーを定義（独立したスコープの measureIndex を参照）
  ↓
デバッグログを追加（どの小節が対象か確認）
  ↓
ループ終了
```

**重要**: 各イベントハンドラーが独立したスコープの`measureIndex`を参照するようにします。

## コンポーネントとインターフェース

### 1. スコープ管理の改善

#### 方法1: 即時実行関数（IIFE）を使用

```typescript
for (let i = 0; i < chosen && globalIndex < score.length; i++, globalIndex++) {
  // 即時実行関数で独立したスコープを作成
  ((currentMeasureIndex: number) => {
    const measureIndex = currentMeasureIndex;
    
    // ... 小節の描画 ...
    
    insertRect.addEventListener('click', (e) => {
      console.log('クリックされた小節:', measureIndex); // デバッグログ
      
      setScore(prev => {
        const next = prev.map(m => ({ events: [...(m?.events ?? [])] }));
        
        // 範囲チェック
        if (measureIndex < 0 || measureIndex >= next.length) {
          console.warn('無効な小節インデックス:', measureIndex);
          return prev;
        }
        
        const m = next[measureIndex];
        // ... 音符を追加 ...
      });
    });
  })(globalIndex);
}
```

#### 方法2: ブロックスコープとconstを活用

```typescript
for (let i = 0; i < chosen && globalIndex < score.length; i++, globalIndex++) {
  // constで定義することで、各反復で新しい変数が作成される
  const measureIndex = globalIndex;
  
  // イベントハンドラーを定義する関数を作成
  const createClickHandler = (targetMeasureIndex: number) => {
    return (e: MouseEvent) => {
      console.log('クリックされた小節:', targetMeasureIndex); // デバッグログ
      
      setScore(prev => {
        const next = prev.map(m => ({ events: [...(m?.events ?? [])] }));
        
        // 範囲チェック
        if (targetMeasureIndex < 0 || targetMeasureIndex >= next.length) {
          console.warn('無効な小節インデックス:', targetMeasureIndex);
          return prev;
        }
        
        const m = next[targetMeasureIndex];
        // ... 音符を追加 ...
      });
    };
  };
  
  insertRect.addEventListener('click', createClickHandler(measureIndex));
}
```

#### 方法3: data属性を使用（推奨）

```typescript
for (let i = 0; i < chosen && globalIndex < score.length; i++, globalIndex++) {
  const measureIndex = globalIndex;
  
  // ... 小節の描画 ...
  
  // data属性に小節インデックスを保存
  insertRect.setAttribute('data-measure-index', String(measureIndex));
  
  insertRect.addEventListener('click', (e) => {
    // data属性から小節インデックスを取得
    const target = e.currentTarget as SVGRectElement;
    const targetMeasureIndex = parseInt(target.getAttribute('data-measure-index') || '0', 10);
    
    console.log('クリックされた小節:', targetMeasureIndex); // デバッグログ
    
    setScore(prev => {
      const next = prev.map(m => ({ events: [...(m?.events ?? [])] }));
      
      // 範囲チェック
      if (targetMeasureIndex < 0 || targetMeasureIndex >= next.length) {
        console.warn('無効な小節インデックス:', targetMeasureIndex);
        return prev;
      }
      
      const m = next[targetMeasureIndex];
      // ... 音符を追加 ...
    });
  });
}
```

**推奨する方法**: 方法3（data属性を使用）
- 最も明示的で理解しやすい
- デバッグ時にDOM要素を検査して小節インデックスを確認できる
- イベントハンドラーが常に正しい値を参照することが保証される

### 2. デバッグとロギング

```typescript
/**
 * 音符追加時のデバッグ情報を出力する
 * @param measureIndex 対象の小節インデックス
 * @param clickX クリックされたX座標
 * @param clickY クリックされたY座標
 * @param key 追加される音高
 */
function logNoteAddition(
  measureIndex: number,
  clickX: number,
  clickY: number,
  key: string
) {
  console.log('音符追加:', {
    小節インデックス: measureIndex,
    クリック位置: { x: clickX, y: clickY },
    音高: key,
    タイムスタンプ: new Date().toISOString(),
  });
}
```

### 3. 範囲チェックの強化

```typescript
/**
 * 小節インデックスが有効な範囲内にあるかチェックする
 * @param index チェックする小節インデックス
 * @param scoreLength 楽譜の小節数
 * @returns 有効な場合はtrue、無効な場合はfalse
 */
function isValidMeasureIndex(index: number, scoreLength: number): boolean {
  if (index < 0) {
    console.warn('小節インデックスが負の値です:', index);
    return false;
  }
  
  if (index >= scoreLength) {
    console.warn('小節インデックスが範囲外です:', { index, scoreLength });
    return false;
  }
  
  return true;
}
```

### 4. 修正後のイベントハンドラー

```typescript
insertRect.addEventListener('click', (e) => {
  // data属性から小節インデックスを取得
  const target = e.currentTarget as SVGRectElement;
  const targetMeasureIndex = parseInt(target.getAttribute('data-measure-index') || '0', 10);
  
  // 座標変換
  const { x: lx, y: ly } = clientToGroup(svg, svgRoot as SVGGElement, e.clientX, e.clientY);
  
  // Y座標から音高を計算
  const snappedLine = snapLineBySpacing(stave, ly);
  const key = lineToKeyTreble(snappedLine);
  
  // デバッグログ
  logNoteAddition(targetMeasureIndex, lx, ly, key);
  
  setScore(prev => {
    // 範囲チェック
    if (!isValidMeasureIndex(targetMeasureIndex, prev.length)) {
      return prev;
    }
    
    const next = prev.map(m => ({ events: [...(m?.events ?? [])] }));
    const m = next[targetMeasureIndex];
    
    // 拍数チェック
    const vfDur = toVFDur((tool as any)?.duration);
    const addBeats = beatsFromVF(vfDur);
    const curBeats = m.events.reduce((s2, ev) => s2 + beatsFromVF(toVFDur(ev.dur)), 0);
    
    if (curBeats + addBeats > BEATS_PER_MEASURE) {
      console.warn('小節が満杯です:', { measureIndex: targetMeasureIndex, curBeats, addBeats });
      return prev;
    }
    
    // X方向の挿入位置を計算
    let insertAt = vfNotes.length;
    let minDist = Infinity;
    
    if (vfNotes.length > 0) {
      // 小節の左端との距離をチェック
      const distLeft = Math.abs(lx - measLeft);
      if (distLeft < minDist) {
        minDist = distLeft;
        insertAt = 0;
      }
      
      // 小節の右端との距離をチェック
      const distRight = Math.abs(lx - measRight);
      if (distRight < minDist) {
        minDist = distRight;
        insertAt = vfNotes.length;
      }
      
      // 各音符の位置との距離をチェック
      for (let j = 0; j < vfNotes.length; j++) {
        const note: any = vfNotes[j];
        const leftX = note.getAbsoluteX ? note.getAbsoluteX() : (measLeft + j * 20);
        const bb = note.getBoundingBox?.();
        const width = bb ? bb.getW() : 20;
        const rightX = leftX + width;
        
        if (lx >= leftX && lx <= rightX) {
          insertAt = (lx < (leftX + rightX) / 2) ? j : (j + 1);
          minDist = 0;
          break;
        }
        
        if (lx < leftX) {
          const dist = leftX - lx;
          if (dist < minDist) {
            minDist = dist;
            insertAt = j;
          }
        }
        
        if (lx > rightX) {
          const dist = lx - rightX;
          if (dist < minDist) {
            minDist = dist;
            insertAt = j + 1;
          }
        }
      }
    }
    
    // 音符を追加
    const ev: NoteEvent = {
      dur: (['1','2','4','8','16','32','64'].includes((tool as any)?.duration) ? (tool as any).duration : '4') as DurKey,
      isRest: !!(tool as any)?.isRest,
      key,
    };
    
    m.events.splice(insertAt, 0, ev);
    
    console.log('音符が追加されました:', {
      小節インデックス: targetMeasureIndex,
      挿入位置: insertAt,
      音符: ev,
    });
    
    return next;
  });
});
```

## データモデル

### 小節インデックスの管理

```typescript
type MeasureIndexInfo = {
  // 小節の絶対インデックス（0から始まる）
  absoluteIndex: number;
  
  // ページ番号（0から始まる）
  pageIndex: number;
  
  // ページ内の小節番号（0から始まる）
  measureInPage: number;
};
```

### イベントハンドラーのコンテキスト

```typescript
type EventHandlerContext = {
  // 対象の小節インデックス
  measureIndex: number;
  
  // 小節の描画位置
  bounds: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  
  // Vexflowオブジェクト
  stave: Stave;
  vfNotes: StaveNote[];
};
```

## 正確性プロパティ

*プロパティとは、システムの全ての有効な実行において真であるべき特性や振る舞いのことです。これは、人間が読める仕様と機械で検証可能な正確性保証の橋渡しとなります。*

### プロパティ 1: 音符追加の正確性

*任意の*小節インデックス`i`（0 ≤ i < scoreLength）と音符データに対して、小節`i`をクリックして音符を追加した場合、追加された音符は小節`i`にのみ存在し、他の小節`j`（j ≠ i）には存在してはならない。

**検証: 要件 1.1, 1.2, 1.3, 2.3, 3.2**

### プロパティ 2: 音符追加の分離

*任意の*小節インデックス`i`に対して、小節`i`に音符を追加する前後で、他の小節`j`（j ≠ i）のデータ（音符の数、音符の内容）は変更されてはならない。

**検証: 要件 3.1**

### プロパティ 3: 複数ページの独立性

*任意の*2つの異なるページ`p1`と`p2`に対して、ページ`p1`の小節に音符を追加した場合、ページ`p2`の小節のデータは変更されてはならない。

**検証: 要件 3.3**

### プロパティ 4: 範囲チェックの妥当性

*任意の*小節インデックス`i`に対して、`i < 0`または`i >= scoreLength`の場合、音符追加処理は実行されず、スコアデータは変更されてはならない。

**検証: 要件 3.4**

### プロパティ 5: イベントハンドラーの独立性

*任意の*連続する小節クリック操作のシーケンスに対して、各クリックは対応する小節にのみ音符を追加し、前のクリックで対象とした小節には影響を与えてはならない。

**検証: 要件 1.4, 2.4**

## エラーハンドリング

### 1. 無効な小節インデックス

**シナリオ**: 小節インデックスが負の値または範囲外の場合

**対応**:
- 警告メッセージをコンソールに出力
- 音符追加処理をスキップ
- 元のスコアデータを返す

```typescript
if (!isValidMeasureIndex(targetMeasureIndex, prev.length)) {
  console.warn('無効な小節インデックス:', targetMeasureIndex);
  return prev;
}
```

### 2. data属性の取得失敗

**シナリオ**: `data-measure-index`属性が存在しない、または無効な値の場合

**対応**:
- デフォルト値（0）を使用
- 警告メッセージをコンソールに出力

```typescript
const targetMeasureIndex = parseInt(
  target.getAttribute('data-measure-index') || '0',
  10
);

if (isNaN(targetMeasureIndex)) {
  console.warn('data-measure-indexの解析に失敗しました');
  return;
}
```

### 3. 小節が満杯の場合

**シナリオ**: 追加しようとする音符の拍数が、小節の残り拍数を超える場合

**対応**:
- 警告メッセージをコンソールに出力
- 音符追加処理をスキップ
- 元のスコアデータを返す

```typescript
if (curBeats + addBeats > BEATS_PER_MEASURE) {
  console.warn('小節が満杯です:', {
    measureIndex: targetMeasureIndex,
    curBeats,
    addBeats,
  });
  return prev;
}
```

## テスト戦略

### 単体テストとプロパティベーステストの併用

本機能では、以下の2つのテストアプローチを組み合わせます：

1. **単体テスト**: 特定の例やエッジケースを検証
2. **プロパティベーステスト**: 全ての入力に対して成り立つべき性質を検証

両者は補完的であり、単体テストは具体的なバグを捕捉し、プロパティベーステストは一般的な正確性を保証します。

### プロパティベーステストの設定

**使用ライブラリ**: `fast-check`（TypeScript/JavaScriptのプロパティベーステストライブラリ）

**設定**:
- 各プロパティテストは最低100回の反復を実行
- ランダムシードを記録して再現可能性を確保
- 失敗時には最小の反例を自動的に縮小

**タグ形式**:
```typescript
// Feature: multi-page-note-isolation, Property 1: 小節インデックスの一意性
```

### テストケース

#### 単体テスト

1. **小節インデックスの正確性**
   - 1ページ目の小節をクリックして、1ページ目にのみ音符が追加されることを確認
   - 2ページ目の小節をクリックして、2ページ目にのみ音符が追加されることを確認
   - 複数ページにわたって音符を追加し、各ページが独立していることを確認

2. **エッジケース**
   - 最初の小節（インデックス0）をクリック
   - 最後の小節をクリック
   - 空の小節をクリック
   - 満杯の小節をクリック

3. **回帰テスト**（要件5.1〜5.4）
   - 音符の選択機能が正常に動作することを確認
   - ガイドライン表示機能が正常に動作することを確認
   - 音符の削除機能が正常に動作することを確認
   - 複数ページのレイアウトが正常に表示されることを確認

#### プロパティベーステスト

各プロパティ（1〜4）に対して、対応するプロパティテストを実装します：

1. **プロパティ 1**: ランダムな小節インデックスを生成し、イベントハンドラーが正しいインデックスを参照することを検証
2. **プロパティ 2**: ランダムな小節インデックスと音符データを生成し、音符追加が他の小節に影響しないことを検証
3. **プロパティ 3**: ランダムな小節インデックス（範囲外を含む）を生成し、範囲チェックが正しく機能することを検証
4. **プロパティ 4**: ランダムな複数の小節インデックスを生成し、各イベントハンドラーが独立したスコープを持つことを検証

### テスト実行環境

- **ブラウザ環境**: Vitestのブラウザモードを使用してDOM APIをテスト
- **モックDOM**: 必要に応じて`jsdom`を使用してSVG要素をモック
- **CI/CD**: 全てのプルリクエストでテストを自動実行

### テストカバレッジ目標

- イベントハンドラー: 100%
- スコープ管理関数: 100%
- 全体: 90%以上

## 実装の注意点

### 1. すべてのイベントハンドラーを修正

以下のイベントハンドラーすべてに、同じスコープ管理の改善を適用する必要があります：

- `insertRect.addEventListener('click', ...)`
- `insertRect.addEventListener('mousemove', ...)`
- `hit.addEventListener('click', ...)` （セル方式の選択）
- `hit.addEventListener('mousemove', ...)`
- `hit.addEventListener('mouseenter', ...)`

### 2. data属性の一貫性

すべてのインタラクティブな要素（`insertRect`、`hit`など）に`data-measure-index`属性を設定します。

### 3. デバッグログの条件付き出力

本番環境ではデバッグログを無効化できるように、環境変数やフラグで制御します：

```typescript
const DEBUG = process.env.NODE_ENV === 'development';

if (DEBUG) {
  console.log('クリックされた小節:', targetMeasureIndex);
}
```

### 4. パフォーマンスへの影響

data属性の追加やログ出力は、パフォーマンスにほとんど影響しません。ただし、大量の小節（100以上）を描画する場合は、ログ出力を最小限に抑えることを推奨します。
