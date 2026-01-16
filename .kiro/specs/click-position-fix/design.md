# 設計書

## 概要

五線譜エディタにおけるクリック位置と音符描画位置のずれを修正します。この問題は、SVG座標変換の実装において、スケール変換が適用された状態での座標計算が不正確であることに起因しています。

本設計では、`clientToGroup`関数の座標変換ロジックを改善し、全てのクリックイベントハンドラーで一貫した座標変換を使用することで、正確な音符配置を実現します。

## アーキテクチャ

### 現在の問題点（前回修正時の分析）

1. **座標変換の不整合**: クリック座標（clientX/Y）をSVGの`<g>`ユーザー座標へ変換する際、CTM（Current Transformation Matrix）の逆変換が正しく適用されていない
2. **外部モニターやCSS変形での座標ずれ**: 拡大縮小やCSS変形が適用された環境で座標がずれる
3. **Y方向スナップの精度不足**: 線上クリックの取りこぼしが発生
4. **X方向挿入位置の不正確**: 見た目の横位置と実際の挿入位置が一致しない

### 解決アプローチ（前回の修正内容を踏襲）

```
ブラウザイベント (clientX, clientY)
         ↓
  getScreenCTM() で変換行列を取得
         ↓
  CTM.inverse() で逆変換
         ↓
  SVG <g> ユーザー座標 (x, y)
         ↓
  Y方向: getSpacingBetweenLines() で0.5行刻みスナップ
  X方向: getAbsoluteX() + BoundingBox で挿入位置計算
         ↓
  音符配置
```

**重要**: 全てのイベントハンドラーで`clientToGroup`を使用し、CTM逆変換による座標統一を徹底します。

## コンポーネントとインターフェース

### 1. 座標変換ユーティリティ

#### `clientToGroup`関数（改善版）

```typescript
/**
 * クライアント座標をSVGグループ座標に変換する
 * CTM（Current Transformation Matrix）の逆変換を使用して、
 * 拡大縮小やCSS変形が適用された環境でも正確に変換する
 * 
 * @param svg SVG要素
 * @param group 対象のSVGグループ要素（Vexflowのルートグループ）
 * @param clientX クライアントX座標（ブラウザビューポート座標）
 * @param clientY クライアントY座標（ブラウザビューポート座標）
 * @returns SVG <g> ユーザー座標系での座標
 */
function clientToGroup(
  svg: SVGSVGElement, 
  group: SVGGElement, 
  clientX: number, 
  clientY: number
): { x: number; y: number }
```

**改善内容:**
- `getScreenCTM()`でスクリーン座標からSVG座標への変換行列を取得
- `inverse()`で逆行列を計算し、クライアント座標をSVG座標に変換
- 外部モニター、CSS transform、ブラウザズームなど、あらゆる変形に対応
- 厳密なnullチェックとエラーハンドリング

**実装例:**
```typescript
function clientToGroup(svg: SVGSVGElement, group: SVGGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; 
  pt.y = clientY;
  const m = group.getScreenCTM();
  if (!m) {
    console.warn('getScreenCTM returned null, using fallback coordinates');
    return { x: 0, y: 0 };
  }
  const p = pt.matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}
```

#### `getVexflowGroup`関数（改善版）

```typescript
/**
 * VexflowがレンダリングしたSVGのルートグループを取得する
 * @param svg SVG要素
 * @returns ルートグループ要素、または見つからない場合はnull
 */
function getVexflowGroup(svg: SVGSVGElement): SVGGElement | null
```

**改善内容:**
- より確実なルートグループの特定
- Vexflowが生成する特定のクラス名や属性を利用した検索

### 2. イベントハンドラーの統一

全てのクリックイベントハンドラーで、以下の統一されたパターンを使用します：

```typescript
element.addEventListener('click', (e) => {
  // 1. SVGルートグループを取得（Vexflowが描画したグループ）
  const svgRoot = getVexflowGroup(svg) || svg;
  
  // 2. CTM逆変換で座標を変換
  const { x: lx, y: ly } = clientToGroup(
    svg, 
    svgRoot as SVGGElement, 
    e.clientX, 
    e.clientY
  );
  
  // 3. 変換後のSVG座標を使用して処理
  // Y座標: getSpacingBetweenLines()で0.5行刻みスナップ
  // X座標: getAbsoluteX() + BoundingBoxで挿入位置計算
  // ...
});
```

**重要な変更点:**
- `mousemove`、`click`、`mouseenter`など全てのイベントで同じ`clientToGroup`を使用
- 座標変換は常にCTM逆変換を使用（手動計算は行わない）
- Y座標のスナップは`getSpacingBetweenLines()`を基準に0.5行刻み
- X座標の挿入位置は`getAbsoluteX()`と`getBoundingBox()`で計算

### 3. X方向挿入位置の計算

```typescript
/**
 * クリック位置から音符の挿入位置を計算する
 * getAbsoluteX()とBoundingBoxを使用して、見た目の横位置に基づいて判定
 */
const calculateInsertPosition = (localX: number, vfNotes: StaveNote[]): number => {
  if (vfNotes.length === 0) return 0;
  
  let insertAt = vfNotes.length;
  let minDist = Infinity;
  
  // 小節の左端との距離をチェック
  const distLeft = Math.abs(localX - measLeft);
  if (distLeft < minDist) {
    minDist = distLeft;
    insertAt = 0;
  }
  
  // 小節の右端との距離をチェック
  const distRight = Math.abs(localX - measRight);
  if (distRight < minDist) {
    minDist = distRight;
    insertAt = vfNotes.length;
  }
  
  // 各音符の位置との距離をチェック
  for (let j = 0; j < vfNotes.length; j++) {
    const note = vfNotes[j] as any;
    const leftX = note.getAbsoluteX ? note.getAbsoluteX() : (measLeft + j * 20);
    const bb = note.getBoundingBox?.();
    const width = bb ? bb.getW() : 20;
    const rightX = leftX + width;
    
    // クリック位置が音符の範囲内の場合
    if (localX >= leftX && localX <= rightX) {
      // 音符の中心より左なら前に、右なら後ろに挿入
      insertAt = (localX < (leftX + rightX) / 2) ? j : (j + 1);
      minDist = 0;
      break;
    }
    
    // 音符の左側との距離
    if (localX < leftX) {
      const dist = leftX - localX;
      if (dist < minDist) {
        minDist = dist;
        insertAt = j;
      }
    }
    
    // 音符の右側との距離
    if (localX > rightX) {
      const dist = localX - rightX;
      if (dist < minDist) {
        minDist = dist;
        insertAt = j + 1;
      }
    }
  }
  
  return insertAt;
};
```

### 3. ガイドライン更新ロジック

```typescript
/**
 * ガイドライン（横線と点）を更新する
 * getSpacingBetweenLines()を使用して正確な行間隔を取得し、
 * 0.5行刻みで最も近い位置にスナップする
 * 
 * @param localX SVG座標系でのX座標
 * @param localY SVG座標系でのY座標
 */
const updateGuide = (localX: number, localY: number) => {
  // getSpacingBetweenLines()で正確な行間隔を取得
  const topY = stave.getYForLine(0);
  const spacing = stave.getSpacingBetweenLines?.() as number 
    || ((stave.getYForLine(4) - topY) / 4);
  
  // 加線域を含む範囲で0.5行刻みスナップ
  const minLine = -EXTRA_TOP_LINES;
  const maxLine = 4 + EXTRA_BOTTOM_LINES;
  let bestLine = 0;
  let minDiff = Infinity;
  
  for (let line = minLine; line <= maxLine; line += 0.5) {
    const yCandidate = topY + line * spacing;
    const diff = Math.abs(localY - yCandidate);
    if (diff < minDiff) {
      minDiff = diff;
      bestLine = Number(line.toFixed(1));
    }
  }
  
  const yGuide = stave.getYForLine(bestLine);
  
  // ガイドラインの位置を更新
  guideLine.setAttribute('y1', String(yGuide));
  guideLine.setAttribute('y2', String(yGuide));
  guideLine.style.display = 'block';
  
  // ガイドドットの位置を更新（小節境界内に制限）
  const cx = Math.max(measLeft, Math.min(localX, measRight));
  guideDot.setAttribute('cx', String(cx));
  guideDot.setAttribute('cy', String(yGuide));
  guideDot.style.display = 'block';
};
```

## データモデル

### 座標変換の数学的モデル

SVG座標変換は、以下の変換行列を使用します：

```
[x']   [a  c  e]   [x]
[y'] = [b  d  f] × [y]
[1 ]   [0  0  1]   [1]
```

ここで：
- `(x, y)`: クライアント座標
- `(x', y')`: SVG座標
- `[a, b, c, d, e, f]`: 変換行列の要素（スケール、回転、平行移動を含む）

`getScreenCTM()`は、SVG要素からスクリーン座標への変換行列を返します。
逆変換を行うには、この行列の逆行列を計算し、クライアント座標に適用します。

### スケール適用時の考慮事項

Vexflowの`ctx.scale(s, s)`により、SVG内部の座標系がスケールされます。
このスケールは変換行列に反映されるため、`getScreenCTM()`を使用することで自動的に考慮されます。

## 正確性プロパティ

*プロパティとは、システムの全ての有効な実行において真であるべき特性や振る舞いのことです。これは、人間が読める仕様と機械で検証可能な正確性保証の橋渡しとなります。*

### プロパティ 1: 座標変換の正確性

*任意の*有効なクライアント座標（ブラウザのビューポート内）に対して、`clientToGroup`関数で変換されたSVG座標は、SVGの描画領域内に存在しなければならない。

**検証: 要件 1.1**

### プロパティ 2: スケール不変性

*任意の*スケール値（0.75〜1.0の範囲）と相対的なクリック位置（小節内の相対座標）に対して、座標変換後の相対位置は、スケール値に関わらず一貫していなければならない。具体的には、小節の中央をクリックした場合、どのスケール値でも小節の中央（拍位置2.0付近）に音符が配置されるべきである。

**検証: 要件 1.2, 4.1, 4.3, 4.4**

### プロパティ 3: 縦方向スナップの妥当性

*任意の*Y座標に対して、`snapLineBySpacing`関数が返す線番号は、有効な範囲（-EXTRA_TOP_LINES から 4+EXTRA_BOTTOM_LINES）内の0.5刻みの値でなければならない。

**検証: 要件 2.3**

### プロパティ 4: 横方向境界制限

*任意の*X座標に対して、ガイドドットのX座標は、小節の左端（measLeft）以上、右端（measRight）以下でなければならない。

**検証: 要件 2.4**

### プロパティ 5: 挿入位置の妥当性

*任意の*小節内のクリック位置に対して、計算された挿入インデックスは、0以上、既存の音符数以下でなければならない。

**検証: 要件 3.1**

### プロパティ 6: 拍位置の範囲

*任意の*小節内のクリック位置から計算された拍位置は、0以上、BEATS_PER_MEASURE（4）以下でなければならない。

**検証: 要件 3.2**

### プロパティ 7: 音高変換のラウンドトリップ

*任意の*有効な音高（key文字列）に対して、`keyToLineTreble`で線番号に変換し、その線番号を`lineToKeyTreble`で音高に戻した場合、元の音高と同じ音名・オクターブでなければならない（臨時記号は無視）。

**検証: 要件 3.3**

### プロパティ 8: 選択・挿入判定の一貫性

*任意の*音符位置とクリック位置に対して、音符の中心からの距離が選択半径（`min(SELECT_NEAR_PX, cellWidth * SELECT_NEAR_FRAC)`）以下の場合は選択、それより大きい場合は挿入と判定されなければならない。

**検証: 要件 3.4**



## エラーハンドリング

### 1. 変換行列取得の失敗

**シナリオ**: `getScreenCTM()`が`null`を返す場合

**対応**: 
- フォールバック座標（0, 0）を返す
- コンソールに警告を出力
- ユーザーには影響を与えないが、開発者が問題を認識できるようにする

```typescript
function clientToGroup(svg: SVGSVGElement, group: SVGGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; 
  pt.y = clientY;
  const m = group.getScreenCTM();
  if (!m) {
    console.warn('getScreenCTM returned null, using fallback coordinates');
    return { x: 0, y: 0 };
  }
  const p = pt.matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}
```

### 2. SVGグループの取得失敗

**シナリオ**: `getVexflowGroup`がグループを見つけられない場合

**対応**:
- SVG要素自体をフォールバックとして使用
- 座標変換は引き続き機能する

```typescript
const svgRoot = getVexflowGroup(svg) || svg;
```

### 3. 無効な座標値

**シナリオ**: 座標変換の結果が`NaN`や`Infinity`になる場合

**対応**:
- 座標の妥当性チェックを追加
- 無効な場合はデフォルト値を使用

```typescript
function sanitizeCoordinate(value: number, fallback: number): number {
  return isFinite(value) ? value : fallback;
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
// Feature: click-position-fix, Property 1: 座標変換の正確性
```

### テストケース

#### 単体テスト

1. **座標変換の基本動作**
   - 既知の座標値での変換結果を検証
   - スケール1.0での変換が正確であることを確認

2. **エッジケース**
   - 小節の境界でのクリック
   - 五線の最上部・最下部でのクリック
   - 最小スケール（0.75）と最大スケール（1.0）での動作

3. **回帰テスト**（要件5.1〜5.4）
   - 音符の選択機能が正常に動作することを確認
   - キーボードによる音符移動が正常に動作することを確認
   - 音符の削除機能が正常に動作することを確認
   - 複数ページのレイアウトが正常に表示されることを確認

#### プロパティベーステスト

各プロパティ（1〜8）に対して、対応するプロパティテストを実装します：

1. **プロパティ 1**: ランダムなクライアント座標を生成し、変換後の座標が有効範囲内にあることを検証
2. **プロパティ 2**: ランダムなスケール値と相対位置を生成し、変換の一貫性を検証
3. **プロパティ 3**: ランダムなY座標を生成し、スナップ後の線番号が有効範囲内にあることを検証
4. **プロパティ 4**: ランダムなX座標を生成し、制限後の座標が小節境界内にあることを検証
5. **プロパティ 5**: ランダムなクリック位置を生成し、挿入インデックスが有効範囲内にあることを検証
6. **プロパティ 6**: ランダムなクリック位置を生成し、拍位置が有効範囲内にあることを検証
7. **プロパティ 7**: ランダムな音高を生成し、ラウンドトリップ変換が一貫していることを検証
8. **プロパティ 8**: ランダムな音符位置とクリック位置を生成し、選択・挿入判定が一貫していることを検証

### テスト実行環境

- **ブラウザ環境**: Vitestのブラウザモードを使用してDOM APIをテスト
- **モックDOM**: 必要に応じて`jsdom`を使用してSVG要素をモック
- **CI/CD**: 全てのプルリクエストでテストを自動実行

### テストカバレッジ目標

- 座標変換関数: 100%
- イベントハンドラー: 90%以上
- 全体: 85%以上
