// src/components/CoordinateTransform.test.tsx
// 座標変換関数の単体テスト
// Feature: click-position-fix, Task 1.1: 座標変換の単体テストを作成

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * DOMMatrixのモック実装
 */
class MockDOMMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  
  constructor(values?: number[]) {
    if (values && values.length >= 6) {
      this.a = values[0];
      this.b = values[1];
      this.c = values[2];
      this.d = values[3];
      this.e = values[4];
      this.f = values[5];
    } else {
      // 単位行列
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = 0;
    }
  }
  
  inverse(): MockDOMMatrix {
    // 2x2行列の逆行列を計算
    const det = this.a * this.d - this.b * this.c;
    
    if (det === 0 || !isFinite(det)) {
      throw new Error('Matrix is not invertible');
    }
    
    const result = new MockDOMMatrix();
    result.a = this.d / det;
    result.b = -this.b / det;
    result.c = -this.c / det;
    result.d = this.a / det;
    result.e = (this.c * this.f - this.d * this.e) / det;
    result.f = (this.b * this.e - this.a * this.f) / det;
    
    return result;
  }
}

/**
 * SVGPointのモック実装
 */
class MockSVGPoint {
  x: number = 0;
  y: number = 0;
  
  matrixTransform(matrix: MockDOMMatrix): MockSVGPoint {
    const result = new MockSVGPoint();
    result.x = matrix.a * this.x + matrix.c * this.y + matrix.e;
    result.y = matrix.b * this.x + matrix.d * this.y + matrix.f;
    return result;
  }
}

/**
 * テスト用のSVG要素とグループ要素を作成する
 */
function createTestSVGElements(): { svg: SVGSVGElement; group: SVGGElement } {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '800');
  svg.setAttribute('height', '600');
  
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(group);
  
  // DOMに追加してgetScreenCTMが機能するようにする
  document.body.appendChild(svg);
  
  // createSVGPointをモック
  (svg as any).createSVGPoint = () => new MockSVGPoint();
  
  // getScreenCTMをモック（単位行列を返す）
  (group as any).getScreenCTM = () => {
    return new MockDOMMatrix([1, 0, 0, 1, 0, 0]);
  };
  
  return { svg, group };
}

/**
 * クライアント座標をSVGグループ座標に変換する
 * （StaffCanvas.tsxから抽出したテスト用の関数）
 */
function clientToGroup(
  svg: SVGSVGElement, 
  group: SVGGElement, 
  clientX: number, 
  clientY: number
): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = clientX; 
  pt.y = clientY;
  
  const m = (group as any).getScreenCTM?.();
  
  if (!m) {
    console.warn('getScreenCTM returned null, using fallback coordinates');
    return { x: 0, y: 0 };
  }
  
  try {
    const p = pt.matrixTransform(m.inverse());
    
    if (!isFinite(p.x) || !isFinite(p.y)) {
      console.warn('Invalid coordinates after transformation:', { x: p.x, y: p.y });
      return { x: 0, y: 0 };
    }
    
    return { x: p.x, y: p.y };
  } catch (error) {
    console.error('Error during coordinate transformation:', error);
    return { x: 0, y: 0 };
  }
}

describe('座標変換関数の単体テスト', () => {
  let svg: SVGSVGElement;
  let group: SVGGElement;

  beforeEach(() => {
    // 各テストの前にDOMをクリーンアップ
    document.body.innerHTML = '';
    
    // 新しいSVG要素を作成
    const elements = createTestSVGElements();
    svg = elements.svg;
    group = elements.group;
  });

  describe('基本的な座標変換', () => {
    /**
     * Feature: click-position-fix, Task 1.1
     * **Validates: Requirements 1.1**
     * 
     * 既知の座標値での変換結果を検証
     */
    it('原点(0, 0)のクライアント座標を正しく変換できる', () => {
      // SVGの位置を設定
      svg.style.position = 'absolute';
      svg.style.left = '0px';
      svg.style.top = '0px';
      
      // 原点の座標を変換
      const result = clientToGroup(svg, group, 0, 0);
      
      // 変換結果が有効な数値であることを確認
      expect(isFinite(result.x)).toBe(true);
      expect(isFinite(result.y)).toBe(true);
      
      // 原点は原点に変換されるべき（変換なしの場合）
      expect(result.x).toBeCloseTo(0, 1);
      expect(result.y).toBeCloseTo(0, 1);
    });

    it('正の座標値を正しく変換できる', () => {
      svg.style.position = 'absolute';
      svg.style.left = '0px';
      svg.style.top = '0px';
      
      // 正の座標を変換
      const result = clientToGroup(svg, group, 100, 50);
      
      // 変換結果が有効な数値であることを確認
      expect(isFinite(result.x)).toBe(true);
      expect(isFinite(result.y)).toBe(true);
      
      // 座標が正しい範囲内にあることを確認
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.y).toBeGreaterThanOrEqual(0);
    });

    it('SVGの位置オフセットを考慮した変換ができる', () => {
      // SVGを画面上の特定位置に配置
      svg.style.position = 'absolute';
      svg.style.left = '50px';
      svg.style.top = '30px';
      
      // jsdomではSVGの位置オフセットが正しく反映されないため、
      // getScreenCTMをモックしてオフセットを含む変換行列を返す
      (group as any).getScreenCTM = () => {
        // オフセット(50, 30)を含む変換行列
        return new MockDOMMatrix([1, 0, 0, 1, 50, 30]);
      };
      
      // SVGの左上隅をクリックした場合
      const result = clientToGroup(svg, group, 50, 30);
      
      // 変換結果が有効な数値であることを確認
      expect(isFinite(result.x)).toBe(true);
      expect(isFinite(result.y)).toBe(true);
      
      // SVGの左上隅は(0, 0)に変換されるべき
      expect(result.x).toBeCloseTo(0, 1);
      expect(result.y).toBeCloseTo(0, 1);
    });
  });

  describe('スケール1.0での変換精度', () => {
    /**
     * Feature: click-position-fix, Task 1.1
     * **Validates: Requirements 1.1**
     * 
     * スケール1.0での変換精度を確認
     */
    it('スケール1.0で座標変換が正確に行われる', () => {
      svg.style.position = 'absolute';
      svg.style.left = '0px';
      svg.style.top = '0px';
      
      // スケール1.0を適用（変換なし）
      group.setAttribute('transform', 'scale(1.0, 1.0)');
      
      // 複数の座標点をテスト
      const testPoints = [
        { clientX: 0, clientY: 0, expectedX: 0, expectedY: 0 },
        { clientX: 100, clientY: 100, expectedX: 100, expectedY: 100 },
        { clientX: 200, clientY: 150, expectedX: 200, expectedY: 150 },
        { clientX: 400, clientY: 300, expectedX: 400, expectedY: 300 },
      ];
      
      for (const point of testPoints) {
        const result = clientToGroup(svg, group, point.clientX, point.clientY);
        
        // 変換結果が有効な数値であることを確認
        expect(isFinite(result.x)).toBe(true);
        expect(isFinite(result.y)).toBe(true);
        
        // スケール1.0では座標がほぼそのまま変換される
        // （SVGの位置オフセットがない場合）
        expect(result.x).toBeCloseTo(point.expectedX, 1);
        expect(result.y).toBeCloseTo(point.expectedY, 1);
      }
    });

    it('スケール1.0で小数点座標も正確に変換できる', () => {
      svg.style.position = 'absolute';
      svg.style.left = '0px';
      svg.style.top = '0px';
      
      group.setAttribute('transform', 'scale(1.0, 1.0)');
      
      // 小数点を含む座標をテスト
      const result = clientToGroup(svg, group, 123.456, 78.901);
      
      // 変換結果が有効な数値であることを確認
      expect(isFinite(result.x)).toBe(true);
      expect(isFinite(result.y)).toBe(true);
      
      // 小数点座標も正確に変換される
      expect(result.x).toBeCloseTo(123.456, 1);
      expect(result.y).toBeCloseTo(78.901, 1);
    });
  });

  describe('エラーハンドリング', () => {
    /**
     * Feature: click-position-fix, Task 1.1
     * **Validates: Requirements 1.1, 1.3**
     * 
     * エラーケースでの動作を検証
     */
    it('getScreenCTMがnullを返す場合、フォールバック座標を返す', () => {
      // getScreenCTMをモックしてnullを返すようにする
      const originalGetScreenCTM = (group as any).getScreenCTM;
      (group as any).getScreenCTM = () => null;
      
      const result = clientToGroup(svg, group, 100, 100);
      
      // フォールバック座標(0, 0)が返される
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
      
      // 元のメソッドを復元
      (group as any).getScreenCTM = originalGetScreenCTM;
    });

    it('変換結果が無効な値の場合、フォールバック座標を返す', () => {
      // getScreenCTMをモックして無効な変換行列を返すようにする
      const originalGetScreenCTM = (group as any).getScreenCTM;
      (group as any).getScreenCTM = () => {
        // NaNを含む変換行列を返す
        return new MockDOMMatrix([NaN, 0, 0, NaN, 0, 0]);
      };
      
      const result = clientToGroup(svg, group, 100, 100);
      
      // 無効な座標の場合、フォールバック座標(0, 0)が返される
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
      
      // 元のメソッドを復元
      (group as any).getScreenCTM = originalGetScreenCTM;
    });

    it('変換中に例外が発生した場合、フォールバック座標を返す', () => {
      // getScreenCTMをモックして例外を投げる逆行列を返すようにする
      const originalGetScreenCTM = (group as any).getScreenCTM;
      (group as any).getScreenCTM = () => {
        const matrix = new MockDOMMatrix([1, 0, 0, 1, 0, 0]);
        // inverseメソッドをオーバーライドして例外を投げる
        matrix.inverse = () => {
          throw new Error('Matrix inversion failed');
        };
        return matrix;
      };
      
      const result = clientToGroup(svg, group, 100, 100);
      
      // 例外が発生した場合、フォールバック座標(0, 0)が返される
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
      
      // 元のメソッドを復元
      (group as any).getScreenCTM = originalGetScreenCTM;
    });
  });

  describe('座標の妥当性検証', () => {
    /**
     * Feature: click-position-fix, Task 1.1
     * **Validates: Requirements 1.1**
     * 
     * 変換後の座標が妥当な範囲内にあることを確認
     */
    it('変換後の座標が有限値であることを確認', () => {
      svg.style.position = 'absolute';
      svg.style.left = '0px';
      svg.style.top = '0px';
      
      // 複数の座標をテスト
      const testPoints = [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 100 },
        { x: 200, y: 200 },
        { x: 400, y: 300 },
      ];
      
      for (const point of testPoints) {
        const result = clientToGroup(svg, group, point.x, point.y);
        
        // 変換結果が有限値であることを確認
        expect(isFinite(result.x)).toBe(true);
        expect(isFinite(result.y)).toBe(true);
        
        // NaNやInfinityではないことを確認
        expect(Number.isNaN(result.x)).toBe(false);
        expect(Number.isNaN(result.y)).toBe(false);
        expect(result.x).not.toBe(Infinity);
        expect(result.x).not.toBe(-Infinity);
        expect(result.y).not.toBe(Infinity);
        expect(result.y).not.toBe(-Infinity);
      }
    });

    it('負の座標値も正しく変換できる', () => {
      svg.style.position = 'absolute';
      svg.style.left = '100px';
      svg.style.top = '100px';
      
      // jsdomではSVGの位置オフセットが正しく反映されないため、
      // getScreenCTMをモックしてオフセットを含む変換行列を返す
      (group as any).getScreenCTM = () => {
        // オフセット(100, 100)を含む変換行列
        return new MockDOMMatrix([1, 0, 0, 1, 100, 100]);
      };
      
      // SVGの左上より左上の座標（負の相対座標になる）
      const result = clientToGroup(svg, group, 50, 50);
      
      // 変換結果が有効な数値であることを確認
      expect(isFinite(result.x)).toBe(true);
      expect(isFinite(result.y)).toBe(true);
      
      // 負の座標も正しく変換される
      expect(result.x).toBeLessThan(0);
      expect(result.y).toBeLessThan(0);
    });
  });
});

/**
 * Vexflow Staveのモック実装
 * Y方向スナップのテストに使用
 */
class MockStave {
  private topY: number;
  private spacing: number;
  
  constructor(topY: number = 100, spacing: number = 10) {
    this.topY = topY;
    this.spacing = spacing;
  }
  
  /**
   * 指定された線番号のY座標を取得
   */
  getYForLine(line: number): number {
    return this.topY + line * this.spacing;
  }
  
  /**
   * 線間の間隔を取得
   */
  getSpacingBetweenLines(): number {
    return this.spacing;
  }
}

/**
 * Y座標を最も近い五線の線または間にスナップする
 * （StaffCanvas.tsxから抽出したテスト用の関数）
 */
function snapLineBySpacing(stave: any, y: number): number {
  const EXTRA_TOP_LINES = 6;
  const EXTRA_BOTTOM_LINES = 10;
  
  // 五線の最上部（第1線）のY座標を取得
  const topY = stave.getYForLine(0);
  
  // getSpacingBetweenLines()で正確な行間隔を取得
  // フォールバック：第1線と第5線の間隔から計算
  const spacing = stave.getSpacingBetweenLines?.() || ((stave.getYForLine(4) - topY) / 4);
  
  // 加線域を含む範囲を設定
  const minLine = -EXTRA_TOP_LINES;
  const maxLine = 4 + EXTRA_BOTTOM_LINES;
  
  // 最も近い線を探索（0.5行刻み）
  let bestLine = 0;
  let minDiff = Infinity;
  
  for (let line = minLine; line <= maxLine; line += 0.5) {
    const yCandidate = topY + line * spacing;
    const diff = Math.abs(y - yCandidate);
    
    if (diff < minDiff) {
      minDiff = diff;
      bestLine = Number(line.toFixed(1)); // 浮動小数点誤差を回避
    }
  }
  
  return bestLine;
}

describe('座標変換のプロパティベーステスト', () => {
  let svg: SVGSVGElement;
  let group: SVGGElement;

  beforeEach(() => {
    // 各テストの前にDOMをクリーンアップ
    document.body.innerHTML = '';
    
    // 新しいSVG要素を作成
    const elements = createTestSVGElements();
    svg = elements.svg;
    group = elements.group;
  });

  /**
   * Feature: click-position-fix, Property 1: 座標変換の正確性
   * **Validates: Requirements 1.1**
   * 
   * プロパティ 1: 座標変換の正確性
   * 任意の有効なクライアント座標（ブラウザのビューポート内）に対して、
   * clientToGroup関数で変換されたSVG座標は、SVGの描画領域内に存在しなければならない。
   */
  describe('プロパティ 1: 座標変換の正確性', () => {
    it('任意のクライアント座標を変換した結果は有限値である', () => {
      // SVGの位置を設定
      svg.style.position = 'absolute';
      svg.style.left = '0px';
      svg.style.top = '0px';
      
      // プロパティテスト: 任意のクライアント座標に対して
      fc.assert(
        fc.property(
          // ビューポート内の座標を生成（0〜2000の範囲）
          fc.integer({ min: 0, max: 2000 }),
          fc.integer({ min: 0, max: 2000 }),
          (clientX, clientY) => {
            // 座標を変換
            const result = clientToGroup(svg, group, clientX, clientY);
            
            // 変換結果は有限値でなければならない
            expect(isFinite(result.x)).toBe(true);
            expect(isFinite(result.y)).toBe(true);
            
            // NaNやInfinityではないことを確認
            expect(Number.isNaN(result.x)).toBe(false);
            expect(Number.isNaN(result.y)).toBe(false);
            expect(result.x).not.toBe(Infinity);
            expect(result.x).not.toBe(-Infinity);
            expect(result.y).not.toBe(Infinity);
            expect(result.y).not.toBe(-Infinity);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });

    it('任意のクライアント座標を変換した結果は妥当な範囲内である', () => {
      // SVGの位置を設定
      svg.style.position = 'absolute';
      svg.style.left = '0px';
      svg.style.top = '0px';
      
      // SVGのサイズを取得
      const svgWidth = 800;
      const svgHeight = 600;
      
      // プロパティテスト: 任意のクライアント座標に対して
      fc.assert(
        fc.property(
          // ビューポート内の座標を生成
          fc.integer({ min: 0, max: svgWidth }),
          fc.integer({ min: 0, max: svgHeight }),
          (clientX, clientY) => {
            // 座標を変換
            const result = clientToGroup(svg, group, clientX, clientY);
            
            // 変換結果は有限値でなければならない
            expect(isFinite(result.x)).toBe(true);
            expect(isFinite(result.y)).toBe(true);
            
            // SVGの描画領域内に存在する（スケールなしの場合）
            // 多少のマージンを許容（変換誤差を考慮）
            const margin = 10;
            expect(result.x).toBeGreaterThanOrEqual(-margin);
            expect(result.x).toBeLessThanOrEqual(svgWidth + margin);
            expect(result.y).toBeGreaterThanOrEqual(-margin);
            expect(result.y).toBeLessThanOrEqual(svgHeight + margin);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });

    it('任意のスケール値で座標変換が正しく機能する', () => {
      // SVGの位置を設定
      svg.style.position = 'absolute';
      svg.style.left = '0px';
      svg.style.top = '0px';
      
      // プロパティテスト: 任意のスケール値とクライアント座標に対して
      fc.assert(
        fc.property(
          // スケール値を生成（0.75〜1.0の範囲、NaNやInfinityを除外）
          fc.double({ min: 0.75, max: 1.0, noNaN: true }),
          // クライアント座標を生成
          fc.integer({ min: 0, max: 800 }),
          fc.integer({ min: 0, max: 600 }),
          (scale, clientX, clientY) => {
            // スケール値が有効であることを確認
            if (!isFinite(scale) || scale === 0) {
              return; // 無効なスケール値はスキップ
            }
            
            // スケールを適用した変換行列を設定
            (group as any).getScreenCTM = () => {
              return new MockDOMMatrix([scale, 0, 0, scale, 0, 0]);
            };
            
            // 座標を変換
            const result = clientToGroup(svg, group, clientX, clientY);
            
            // 変換結果は有限値でなければならない
            expect(isFinite(result.x)).toBe(true);
            expect(isFinite(result.y)).toBe(true);
            
            // スケールを考慮した座標が正しく計算される
            // スケールが適用されると、座標は拡大される
            const expectedX = clientX / scale;
            const expectedY = clientY / scale;
            
            // 変換結果が期待値に近いことを確認（誤差を許容）
            expect(result.x).toBeCloseTo(expectedX, 1);
            expect(result.y).toBeCloseTo(expectedY, 1);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });

    it('任意のオフセット値で座標変換が正しく機能する', () => {
      // プロパティテスト: 任意のオフセット値とクライアント座標に対して
      fc.assert(
        fc.property(
          // オフセット値を生成
          fc.integer({ min: 0, max: 500 }),
          fc.integer({ min: 0, max: 500 }),
          // クライアント座標を生成
          fc.integer({ min: 0, max: 800 }),
          fc.integer({ min: 0, max: 600 }),
          (offsetX, offsetY, clientX, clientY) => {
            // オフセットを含む変換行列を設定
            (group as any).getScreenCTM = () => {
              return new MockDOMMatrix([1, 0, 0, 1, offsetX, offsetY]);
            };
            
            // 座標を変換
            const result = clientToGroup(svg, group, clientX, clientY);
            
            // 変換結果は有限値でなければならない
            expect(isFinite(result.x)).toBe(true);
            expect(isFinite(result.y)).toBe(true);
            
            // オフセットを考慮した座標が正しく計算される
            const expectedX = clientX - offsetX;
            const expectedY = clientY - offsetY;
            
            // 変換結果が期待値に近いことを確認（誤差を許容）
            expect(result.x).toBeCloseTo(expectedX, 1);
            expect(result.y).toBeCloseTo(expectedY, 1);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });

    it('任意のスケールとオフセットの組み合わせで座標変換が正しく機能する', () => {
      // プロパティテスト: 任意のスケール、オフセット、クライアント座標に対して
      fc.assert(
        fc.property(
          // スケール値を生成（0.75〜1.0の範囲、NaNやInfinityを除外）
          fc.double({ min: 0.75, max: 1.0, noNaN: true }),
          // オフセット値を生成
          fc.integer({ min: 0, max: 300 }),
          fc.integer({ min: 0, max: 300 }),
          // クライアント座標を生成
          fc.integer({ min: 0, max: 800 }),
          fc.integer({ min: 0, max: 600 }),
          (scale, offsetX, offsetY, clientX, clientY) => {
            // スケール値が有効であることを確認
            if (!isFinite(scale) || scale === 0) {
              return; // 無効なスケール値はスキップ
            }
            
            // スケールとオフセットを含む変換行列を設定
            (group as any).getScreenCTM = () => {
              return new MockDOMMatrix([scale, 0, 0, scale, offsetX, offsetY]);
            };
            
            // 座標を変換
            const result = clientToGroup(svg, group, clientX, clientY);
            
            // 変換結果は有限値でなければならない
            expect(isFinite(result.x)).toBe(true);
            expect(isFinite(result.y)).toBe(true);
            
            // スケールとオフセットを考慮した座標が正しく計算される
            const expectedX = (clientX - offsetX) / scale;
            const expectedY = (clientY - offsetY) / scale;
            
            // 変換結果が期待値に近いことを確認（誤差を許容）
            expect(result.x).toBeCloseTo(expectedX, 1);
            expect(result.y).toBeCloseTo(expectedY, 1);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });

    it('エラーケース: getScreenCTMがnullを返す場合、常にフォールバック座標を返す', () => {
      // プロパティテスト: 任意のクライアント座標に対して
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 2000 }),
          fc.integer({ min: 0, max: 2000 }),
          (clientX, clientY) => {
            // getScreenCTMをモックしてnullを返すようにする
            (group as any).getScreenCTM = () => null;
            
            // 座標を変換
            const result = clientToGroup(svg, group, clientX, clientY);
            
            // フォールバック座標(0, 0)が返される
            expect(result.x).toBe(0);
            expect(result.y).toBe(0);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
  });
});

/**
 * 音高変換関数（StaffCanvas.tsxから抽出）
 */

/**
 * 線番号からト音記号の音高に変換
 * @param line 線番号（0.5刻み）
 * @returns 音高文字列（例: "c/5", "d/4"）
 */
function lineToKeyTreble(line: number): string {
  const snapped = Math.round(line * 2) / 2;
  const stepsDown = Math.round(snapped * 2); // F5 を 0 として下に+0.5ずつ
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 3 - stepsDown, oct = 5;
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}

/**
 * ト音記号の音高から線番号に変換
 * @param key 音高文字列（例: "c/5", "d#/4", "eb/3", "b/-1"）
 * @returns 線番号（0.5刻み）
 */
function keyToLineTreble(key: string): number {
  const m = key.match(/^([a-g])([#b]?)[/ ]([-]?[0-9]+)$/i); 
  if (!m) return 2;
  const letter = m[1].toLowerCase(), oct = +m[3];
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const target = oct * 7 + (idxMap[letter] ?? 0);
  const base = 5 * 7 + idxMap['f'];
  return (base - target) / 2;
}

describe('Y方向スナップのプロパティベーステスト', () => {
  /**
   * Feature: click-position-fix, Property 3: 縦方向スナップの妥当性
   * **Validates: Requirements 2.3**
   * 
   * プロパティ 3: 縦方向スナップの妥当性
   * 任意のY座標に対して、snapLineBySpacing関数が返す線番号は、
   * 有効な範囲（-EXTRA_TOP_LINES から 4+EXTRA_BOTTOM_LINES）内の0.5刻みの値でなければならない。
   */
  describe('プロパティ 3: 縦方向スナップの妥当性', () => {
    const EXTRA_TOP_LINES = 6;
    const EXTRA_BOTTOM_LINES = 10;
    const MIN_LINE = -EXTRA_TOP_LINES;
    const MAX_LINE = 4 + EXTRA_BOTTOM_LINES;
    
    it('任意のY座標に対してスナップされた線番号は有効な範囲内である', () => {
      // プロパティテスト: 任意のY座標に対して
      fc.assert(
        fc.property(
          // 五線の設定を生成
          fc.double({ min: 50, max: 200, noNaN: true }), // topY
          fc.double({ min: 5, max: 20, noNaN: true }),   // spacing
          // Y座標を生成（五線の範囲を大きく超える範囲も含む）
          fc.double({ min: -100, max: 500, noNaN: true }),
          (topY, spacing, y) => {
            // スケール値が有効であることを確認
            if (!isFinite(topY) || !isFinite(spacing) || !isFinite(y) || spacing === 0) {
              return; // 無効な値はスキップ
            }
            
            // モックStaveを作成
            const stave = new MockStave(topY, spacing);
            
            // Y座標をスナップ
            const snappedLine = snapLineBySpacing(stave, y);
            
            // スナップされた線番号は有限値でなければならない
            expect(isFinite(snappedLine)).toBe(true);
            expect(Number.isNaN(snappedLine)).toBe(false);
            
            // スナップされた線番号は有効な範囲内でなければならない
            expect(snappedLine).toBeGreaterThanOrEqual(MIN_LINE);
            expect(snappedLine).toBeLessThanOrEqual(MAX_LINE);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('任意のY座標に対してスナップされた線番号は0.5刻みである', () => {
      // プロパティテスト: 任意のY座標に対して
      fc.assert(
        fc.property(
          // 五線の設定を生成
          fc.double({ min: 50, max: 200, noNaN: true }), // topY
          fc.double({ min: 5, max: 20, noNaN: true }),   // spacing
          // Y座標を生成
          fc.double({ min: -100, max: 500, noNaN: true }),
          (topY, spacing, y) => {
            // スケール値が有効であることを確認
            if (!isFinite(topY) || !isFinite(spacing) || !isFinite(y) || spacing === 0) {
              return; // 無効な値はスキップ
            }
            
            // モックStaveを作成
            const stave = new MockStave(topY, spacing);
            
            // Y座標をスナップ
            const snappedLine = snapLineBySpacing(stave, y);
            
            // スナップされた線番号は0.5刻みでなければならない
            // つまり、2倍した値が整数でなければならない
            const doubled = snappedLine * 2;
            expect(Math.abs(doubled - Math.round(doubled))).toBeLessThan(0.001);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('線の位置に正確にスナップする', () => {
      // プロパティテスト: 任意の線番号に対して
      fc.assert(
        fc.property(
          // 五線の設定を生成
          fc.double({ min: 50, max: 200, noNaN: true }), // topY
          fc.double({ min: 5, max: 20, noNaN: true }),   // spacing
          // 線番号を生成（0.5刻み）
          fc.integer({ min: MIN_LINE * 2, max: MAX_LINE * 2 }),
          (topY, spacing, lineInt) => {
            // スケール値が有効であることを確認
            if (!isFinite(topY) || !isFinite(spacing) || spacing === 0) {
              return; // 無効な値はスキップ
            }
            
            // 線番号を0.5刻みに変換
            const line = lineInt / 2;
            
            // モックStaveを作成
            const stave = new MockStave(topY, spacing);
            
            // 線の正確な位置を取得
            const exactY = stave.getYForLine(line);
            
            // その位置をスナップ
            const snappedLine = snapLineBySpacing(stave, exactY);
            
            // スナップされた線番号は元の線番号と一致するべき
            expect(snappedLine).toBeCloseTo(line, 1);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('線の中間位置は最も近い線または間にスナップする', () => {
      // プロパティテスト: 任意の線番号と中間位置に対して
      fc.assert(
        fc.property(
          // 五線の設定を生成
          fc.double({ min: 50, max: 200, noNaN: true }), // topY
          fc.double({ min: 5, max: 20, noNaN: true }),   // spacing
          // 線番号を生成（0.5刻み）
          fc.integer({ min: MIN_LINE * 2, max: (MAX_LINE - 1) * 2 }),
          // 中間位置のオフセット（0〜0.5の範囲）
          fc.double({ min: 0, max: 0.5, noNaN: true }),
          (topY, spacing, lineInt, offset) => {
            // スケール値が有効であることを確認
            if (!isFinite(topY) || !isFinite(spacing) || !isFinite(offset) || spacing === 0) {
              return; // 無効な値はスキップ
            }
            
            // 線番号を0.5刻みに変換
            const line = lineInt / 2;
            
            // モックStaveを作成
            const stave = new MockStave(topY, spacing);
            
            // 線の位置とオフセットを加えた位置を取得
            const y = stave.getYForLine(line) + offset * spacing;
            
            // その位置をスナップ
            const snappedLine = snapLineBySpacing(stave, y);
            
            // スナップされた線番号は有効な範囲内でなければならない
            expect(snappedLine).toBeGreaterThanOrEqual(MIN_LINE);
            expect(snappedLine).toBeLessThanOrEqual(MAX_LINE);
            
            // スナップされた線番号は0.5刻みでなければならない
            const doubled = snappedLine * 2;
            expect(Math.abs(doubled - Math.round(doubled))).toBeLessThan(0.001);
            
            // スナップされた線番号は元の線番号または次の線番号に近いべき
            // オフセットが0.25未満なら元の線、0.25以上なら次の線
            const expectedLine = offset < 0.25 ? line : line + 0.5;
            expect(Math.abs(snappedLine - expectedLine)).toBeLessThan(0.1);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('範囲外のY座標も有効な範囲内の線番号にスナップする', () => {
      // プロパティテスト: 範囲外のY座標に対して
      fc.assert(
        fc.property(
          // 五線の設定を生成
          fc.double({ min: 50, max: 200, noNaN: true }), // topY
          fc.double({ min: 5, max: 20, noNaN: true }),   // spacing
          // 範囲外のY座標を生成
          fc.oneof(
            fc.double({ min: -1000, max: -100, noNaN: true }), // 上方向に大きく外れた座標
            fc.double({ min: 1000, max: 2000, noNaN: true })   // 下方向に大きく外れた座標
          ),
          (topY, spacing, y) => {
            // スケール値が有効であることを確認
            if (!isFinite(topY) || !isFinite(spacing) || !isFinite(y) || spacing === 0) {
              return; // 無効な値はスキップ
            }
            
            // モックStaveを作成
            const stave = new MockStave(topY, spacing);
            
            // Y座標をスナップ
            const snappedLine = snapLineBySpacing(stave, y);
            
            // スナップされた線番号は有限値でなければならない
            expect(isFinite(snappedLine)).toBe(true);
            expect(Number.isNaN(snappedLine)).toBe(false);
            
            // スナップされた線番号は有効な範囲内でなければならない
            expect(snappedLine).toBeGreaterThanOrEqual(MIN_LINE);
            expect(snappedLine).toBeLessThanOrEqual(MAX_LINE);
            
            // スナップされた線番号は0.5刻みでなければならない
            const doubled = snappedLine * 2;
            expect(Math.abs(doubled - Math.round(doubled))).toBeLessThan(0.001);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('異なるspacing値でも正しくスナップする', () => {
      // プロパティテスト: 様々なspacing値に対して
      fc.assert(
        fc.property(
          // 五線の設定を生成（spacingを広い範囲で）
          fc.double({ min: 50, max: 200, noNaN: true }),  // topY
          fc.double({ min: 2, max: 50, noNaN: true }),    // spacing（広い範囲）
          // Y座標を生成（五線の範囲内に制限）
          fc.double({ min: -100, max: 300, noNaN: true }),
          (topY, spacing, yOffset) => {
            // スケール値が有効であることを確認
            if (!isFinite(topY) || !isFinite(spacing) || !isFinite(yOffset) || spacing === 0) {
              return; // 無効な値はスキップ
            }
            
            // Y座標を五線の範囲内に調整
            const y = topY + yOffset;
            
            // モックStaveを作成
            const stave = new MockStave(topY, spacing);
            
            // Y座標をスナップ
            const snappedLine = snapLineBySpacing(stave, y);
            
            // スナップされた線番号は有限値でなければならない
            expect(isFinite(snappedLine)).toBe(true);
            expect(Number.isNaN(snappedLine)).toBe(false);
            
            // スナップされた線番号は有効な範囲内でなければならない
            expect(snappedLine).toBeGreaterThanOrEqual(MIN_LINE);
            expect(snappedLine).toBeLessThanOrEqual(MAX_LINE);
            
            // スナップされた線番号は0.5刻みでなければならない
            const doubled = snappedLine * 2;
            expect(Math.abs(doubled - Math.round(doubled))).toBeLessThan(0.001);
            
            // スナップされたY座標を計算
            const snappedY = stave.getYForLine(snappedLine);
            const distance = Math.abs(snappedY - y);
            
            // 距離の妥当性を確認
            // Y座標が五線の範囲内にある場合、距離は最大でもspacing/2以下
            // Y座標が範囲外の場合、最も近い境界線にスナップされる
            const minY = stave.getYForLine(MIN_LINE);
            const maxY = stave.getYForLine(MAX_LINE);
            
            if (y >= minY && y <= maxY) {
              // 範囲内の場合、距離はspacing/2以下であるべき
              expect(distance).toBeLessThanOrEqual(spacing / 2 + 0.1); // 誤差を許容
            } else {
              // 範囲外の場合、境界線にスナップされる
              if (y < minY) {
                expect(snappedLine).toBe(MIN_LINE);
              } else {
                expect(snappedLine).toBe(MAX_LINE);
              }
            }
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
  });
});

/**
 * X方向挿入位置の計算関数（StaffCanvas.tsxから抽出）
 * 
 * @param localX クリックされたX座標（SVG座標系）
 * @param notePositions 音符の位置情報の配列
 * @param measLeft 小節の左端X座標
 * @param measRight 小節の右端X座標
 * @returns 挿入インデックス（0以上、音符数以下）
 */
function calculateInsertPosition(
  localX: number,
  notePositions: Array<{ leftX: number; rightX: number }>,
  measLeft: number,
  measRight: number
): number {
  const noteCount = notePositions.length;
  
  if (noteCount === 0) {
    return 0;
  }
  
  let insertAt = noteCount;
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
    insertAt = noteCount;
  }
  
  // 各音符の位置との距離をチェック
  for (let j = 0; j < noteCount; j++) {
    const { leftX, rightX } = notePositions[j];
    
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
}

describe('X方向挿入位置のプロパティベーステスト', () => {
  /**
   * Feature: click-position-fix, Property 5: 挿入位置の妥当性
   * **Validates: Requirements 3.1**
   * 
   * プロパティ 5: 挿入位置の妥当性
   * 任意の小節内のクリック位置に対して、計算された挿入インデックスは、
   * 0以上、既存の音符数以下でなければならない。
   */
  describe('プロパティ 5: 挿入位置の妥当性', () => {
    it('任意のクリック位置に対して挿入インデックスは有効な範囲内である', () => {
      // プロパティテスト: 任意のクリック位置と音符配置に対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 0, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 100, max: 600, noNaN: true }), // measRight
          // 音符の数を生成（0〜10個）
          fc.integer({ min: 0, max: 10 }),
          // クリック位置のオフセット（小節の左端からの相対位置、0〜1の範囲）
          fc.double({ min: -0.2, max: 1.2, noNaN: true }),
          (measLeft, measRight, noteCount, clickOffset) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            const measWidth = measRight - measLeft;
            
            // 音符の位置を生成（小節内に均等に配置）
            const notePositions: Array<{ leftX: number; rightX: number }> = [];
            if (noteCount > 0) {
              const cellWidth = measWidth / (noteCount + 1);
              for (let i = 0; i < noteCount; i++) {
                const centerX = measLeft + (i + 1) * cellWidth;
                const noteWidth = Math.min(cellWidth * 0.6, 30); // 音符の幅
                notePositions.push({
                  leftX: centerX - noteWidth / 2,
                  rightX: centerX + noteWidth / 2,
                });
              }
            }
            
            // クリック位置を計算
            const localX = measLeft + clickOffset * measWidth;
            
            // クリック位置が有効であることを確認
            if (!isFinite(localX)) {
              return; // 無効な値はスキップ
            }
            
            // 挿入位置を計算
            const insertAt = calculateInsertPosition(localX, notePositions, measLeft, measRight);
            
            // 挿入インデックスは有限値でなければならない
            expect(isFinite(insertAt)).toBe(true);
            expect(Number.isNaN(insertAt)).toBe(false);
            
            // 挿入インデックスは0以上でなければならない
            expect(insertAt).toBeGreaterThanOrEqual(0);
            
            // 挿入インデックスは音符数以下でなければならない
            expect(insertAt).toBeLessThanOrEqual(noteCount);
            
            // 挿入インデックスは整数でなければならない
            expect(Number.isInteger(insertAt)).toBe(true);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('音符が0個の場合、挿入インデックスは常に0である', () => {
      // プロパティテスト: 任意のクリック位置に対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 0, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 100, max: 600, noNaN: true }), // measRight
          // クリック位置のオフセット
          fc.double({ min: 0, max: 1, noNaN: true }),
          (measLeft, measRight, clickOffset) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            const measWidth = measRight - measLeft;
            const localX = measLeft + clickOffset * measWidth;
            
            // クリック位置が有効であることを確認
            if (!isFinite(localX)) {
              return; // 無効な値はスキップ
            }
            
            // 音符が0個の場合
            const notePositions: Array<{ leftX: number; rightX: number }> = [];
            
            // 挿入位置を計算
            const insertAt = calculateInsertPosition(localX, notePositions, measLeft, measRight);
            
            // 挿入インデックスは常に0でなければならない
            expect(insertAt).toBe(0);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('小節の左端をクリックした場合、挿入インデックスは0である', () => {
      // プロパティテスト: 任意の音符配置に対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 0, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 100, max: 600, noNaN: true }), // measRight
          // 音符の数を生成（1〜10個）
          fc.integer({ min: 1, max: 10 }),
          (measLeft, measRight, noteCount) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            const measWidth = measRight - measLeft;
            
            // 音符の位置を生成
            const notePositions: Array<{ leftX: number; rightX: number }> = [];
            const cellWidth = measWidth / (noteCount + 1);
            for (let i = 0; i < noteCount; i++) {
              const centerX = measLeft + (i + 1) * cellWidth;
              const noteWidth = Math.min(cellWidth * 0.6, 30);
              notePositions.push({
                leftX: centerX - noteWidth / 2,
                rightX: centerX + noteWidth / 2,
              });
            }
            
            // 小節の左端をクリック
            const localX = measLeft;
            
            // 挿入位置を計算
            const insertAt = calculateInsertPosition(localX, notePositions, measLeft, measRight);
            
            // 挿入インデックスは0でなければならない
            expect(insertAt).toBe(0);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('小節の右端をクリックした場合、挿入インデックスは音符数と等しい', () => {
      // プロパティテスト: 任意の音符配置に対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 0, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 100, max: 600, noNaN: true }), // measRight
          // 音符の数を生成（1〜10個）
          fc.integer({ min: 1, max: 10 }),
          (measLeft, measRight, noteCount) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            const measWidth = measRight - measLeft;
            
            // 音符の位置を生成
            const notePositions: Array<{ leftX: number; rightX: number }> = [];
            const cellWidth = measWidth / (noteCount + 1);
            for (let i = 0; i < noteCount; i++) {
              const centerX = measLeft + (i + 1) * cellWidth;
              const noteWidth = Math.min(cellWidth * 0.6, 30);
              notePositions.push({
                leftX: centerX - noteWidth / 2,
                rightX: centerX + noteWidth / 2,
              });
            }
            
            // 小節の右端をクリック
            const localX = measRight;
            
            // 挿入位置を計算
            const insertAt = calculateInsertPosition(localX, notePositions, measLeft, measRight);
            
            // 挿入インデックスは音符数と等しくなければならない
            expect(insertAt).toBe(noteCount);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('音符の中心をクリックした場合、その音符の前後に挿入される', () => {
      // プロパティテスト: 任意の音符配置と音符インデックスに対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 0, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 100, max: 600, noNaN: true }), // measRight
          // 音符の数を生成（1〜10個）
          fc.integer({ min: 1, max: 10 }),
          // クリックする音符のインデックス
          fc.integer({ min: 0, max: 9 }),
          // 音符内の相対位置（0=左端、0.5=中心、1=右端）
          fc.double({ min: 0, max: 1, noNaN: true }),
          (measLeft, measRight, noteCount, noteIndex, relativePos) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            // 音符インデックスが有効な範囲内であることを確認
            if (noteIndex >= noteCount) {
              return; // 無効なインデックスはスキップ
            }
            
            const measWidth = measRight - measLeft;
            
            // 音符の位置を生成
            const notePositions: Array<{ leftX: number; rightX: number }> = [];
            const cellWidth = measWidth / (noteCount + 1);
            for (let i = 0; i < noteCount; i++) {
              const centerX = measLeft + (i + 1) * cellWidth;
              const noteWidth = Math.min(cellWidth * 0.6, 30);
              notePositions.push({
                leftX: centerX - noteWidth / 2,
                rightX: centerX + noteWidth / 2,
              });
            }
            
            // 指定された音符の位置を取得
            const { leftX, rightX } = notePositions[noteIndex];
            
            // 音符内の相対位置からクリック位置を計算
            const localX = leftX + (rightX - leftX) * relativePos;
            
            // クリック位置が有効であることを確認
            if (!isFinite(localX)) {
              return; // 無効な値はスキップ
            }
            
            // 挿入位置を計算
            const insertAt = calculateInsertPosition(localX, notePositions, measLeft, measRight);
            
            // 挿入インデックスは音符の前後（noteIndex または noteIndex + 1）でなければならない
            expect(insertAt === noteIndex || insertAt === noteIndex + 1).toBe(true);
            
            // 音符の左半分をクリックした場合は前に、右半分をクリックした場合は後ろに挿入される
            if (relativePos < 0.5) {
              expect(insertAt).toBe(noteIndex);
            } else {
              expect(insertAt).toBe(noteIndex + 1);
            }
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('音符と音符の間をクリックした場合、最も近い音符の前後に挿入される', () => {
      // プロパティテスト: 任意の音符配置に対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 0, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 100, max: 600, noNaN: true }), // measRight
          // 音符の数を生成（2〜10個、間を作るため最低2個）
          fc.integer({ min: 2, max: 10 }),
          // クリックする間のインデックス（0は最初の音符の前、1は1番目と2番目の間、など）
          fc.integer({ min: 1, max: 9 }),
          (measLeft, measRight, noteCount, gapIndex) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            // 間のインデックスが有効な範囲内であることを確認
            if (gapIndex >= noteCount) {
              return; // 無効なインデックスはスキップ
            }
            
            const measWidth = measRight - measLeft;
            
            // 音符の位置を生成
            const notePositions: Array<{ leftX: number; rightX: number }> = [];
            const cellWidth = measWidth / (noteCount + 1);
            for (let i = 0; i < noteCount; i++) {
              const centerX = measLeft + (i + 1) * cellWidth;
              const noteWidth = Math.min(cellWidth * 0.6, 30);
              notePositions.push({
                leftX: centerX - noteWidth / 2,
                rightX: centerX + noteWidth / 2,
              });
            }
            
            // 指定された間の中央をクリック
            const prevNote = notePositions[gapIndex - 1];
            const nextNote = notePositions[gapIndex];
            const localX = (prevNote.rightX + nextNote.leftX) / 2;
            
            // クリック位置が有効であることを確認
            if (!isFinite(localX)) {
              return; // 無効な値はスキップ
            }
            
            // 挿入位置を計算
            const insertAt = calculateInsertPosition(localX, notePositions, measLeft, measRight);
            
            // 挿入インデックスは間のインデックスと等しくなければならない
            expect(insertAt).toBe(gapIndex);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('小節の範囲外をクリックした場合でも有効な挿入インデックスを返す', () => {
      // プロパティテスト: 範囲外のクリック位置に対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 100, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 200, max: 600, noNaN: true }), // measRight
          // 音符の数を生成（1〜10個）
          fc.integer({ min: 1, max: 10 }),
          // 範囲外のオフセット（負の値または1より大きい値）
          fc.oneof(
            fc.double({ min: -1, max: -0.1, noNaN: true }), // 左側に外れた位置
            fc.double({ min: 1.1, max: 2, noNaN: true })    // 右側に外れた位置
          ),
          (measLeft, measRight, noteCount, clickOffset) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            const measWidth = measRight - measLeft;
            
            // 音符の位置を生成
            const notePositions: Array<{ leftX: number; rightX: number }> = [];
            const cellWidth = measWidth / (noteCount + 1);
            for (let i = 0; i < noteCount; i++) {
              const centerX = measLeft + (i + 1) * cellWidth;
              const noteWidth = Math.min(cellWidth * 0.6, 30);
              notePositions.push({
                leftX: centerX - noteWidth / 2,
                rightX: centerX + noteWidth / 2,
              });
            }
            
            // 範囲外のクリック位置を計算
            const localX = measLeft + clickOffset * measWidth;
            
            // クリック位置が有効であることを確認
            if (!isFinite(localX)) {
              return; // 無効な値はスキップ
            }
            
            // 挿入位置を計算
            const insertAt = calculateInsertPosition(localX, notePositions, measLeft, measRight);
            
            // 挿入インデックスは有限値でなければならない
            expect(isFinite(insertAt)).toBe(true);
            expect(Number.isNaN(insertAt)).toBe(false);
            
            // 挿入インデックスは0以上でなければならない
            expect(insertAt).toBeGreaterThanOrEqual(0);
            
            // 挿入インデックスは音符数以下でなければならない
            expect(insertAt).toBeLessThanOrEqual(noteCount);
            
            // 左側に外れた場合は0、右側に外れた場合は音符数になるべき
            if (clickOffset < 0) {
              expect(insertAt).toBe(0);
            } else {
              expect(insertAt).toBe(noteCount);
            }
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('音符の幅が異なる場合でも正しく挿入位置を計算する', () => {
      // プロパティテスト: 異なる音符幅に対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 0, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 200, max: 700, noNaN: true }), // measRight
          // 音符の数を生成（1〜5個）
          fc.integer({ min: 1, max: 5 }),
          // 各音符の幅を生成（配列）
          fc.array(fc.double({ min: 10, max: 50, noNaN: true }), { minLength: 1, maxLength: 5 }),
          // クリック位置のオフセット
          fc.double({ min: 0, max: 1, noNaN: true }),
          (measLeft, measRight, noteCount, noteWidths, clickOffset) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            // 音符幅の配列が有効であることを確認
            if (noteWidths.length < noteCount) {
              return; // 配列が短すぎる場合はスキップ
            }
            
            const measWidth = measRight - measLeft;
            
            // 音符の位置を生成（異なる幅で）
            const notePositions: Array<{ leftX: number; rightX: number }> = [];
            const cellWidth = measWidth / (noteCount + 1);
            for (let i = 0; i < noteCount; i++) {
              const centerX = measLeft + (i + 1) * cellWidth;
              const noteWidth = noteWidths[i];
              
              // 音符幅が有効であることを確認
              if (!isFinite(noteWidth) || noteWidth <= 0) {
                return; // 無効な幅はスキップ
              }
              
              notePositions.push({
                leftX: centerX - noteWidth / 2,
                rightX: centerX + noteWidth / 2,
              });
            }
            
            // クリック位置を計算
            const localX = measLeft + clickOffset * measWidth;
            
            // クリック位置が有効であることを確認
            if (!isFinite(localX)) {
              return; // 無効な値はスキップ
            }
            
            // 挿入位置を計算
            const insertAt = calculateInsertPosition(localX, notePositions, measLeft, measRight);
            
            // 挿入インデックスは有限値でなければならない
            expect(isFinite(insertAt)).toBe(true);
            expect(Number.isNaN(insertAt)).toBe(false);
            
            // 挿入インデックスは0以上でなければならない
            expect(insertAt).toBeGreaterThanOrEqual(0);
            
            // 挿入インデックスは音符数以下でなければならない
            expect(insertAt).toBeLessThanOrEqual(noteCount);
            
            // 挿入インデックスは整数でなければならない
            expect(Number.isInteger(insertAt)).toBe(true);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
  });
});

/**
 * 拍位置計算関数（StaffCanvas.tsxから抽出）
 */

/**
 * Vexflowのdurationから拍数を計算
 * @param vf Vexflowのduration文字列
 * @returns 拍数（4分音符=1拍）
 */
function beatsFromVF(vf: string): number {
  if (vf === '64') return 1/16;
  if (vf === '32') return 1/8;
  if (vf === '16') return 1/4;
  if (vf === '8') return 1/2;
  if (vf === 'q') return 1;
  if (vf === 'h') return 2;
  if (vf === 'w') return 4;
  return 1; // デフォルトは4分音符
}

/**
 * DurKeyからVexflowのdurationに変換
 * @param d DurKey文字列
 * @returns Vexflowのduration文字列
 */
function toVFDur(d: string | undefined | null): string {
  if (d === '1') return 'w';
  if (d === '2') return 'h';
  if (d === '4') return 'q';
  if (d === '8') return '8';
  if (d === '16') return '16';
  if (d === '32') return '32';
  if (d === '64') return '64';
  return 'q'; // デフォルトは4分音符
}

/**
 * 小節内のクリック位置から拍位置を計算
 * @param localX クリックされたX座標（SVG座標系）
 * @param measLeft 小節の左端X座標
 * @param measRight 小節の右端X座標
 * @returns 拍位置（0〜4の範囲）
 */
function calculateBeatPosition(
  localX: number,
  measLeft: number,
  measRight: number
): number {
  const BEATS_PER_MEASURE = 4;
  
  // 小節内の相対位置を計算（0〜1の範囲）
  const measWidth = measRight - measLeft;
  if (measWidth <= 0) {
    return 0; // 無効な小節幅の場合は0を返す
  }
  
  const relativeX = (localX - measLeft) / measWidth;
  
  // 相対位置を拍位置に変換（0〜4の範囲）
  const beatPosition = relativeX * BEATS_PER_MEASURE;
  
  // 範囲を制限（0〜4）
  return Math.max(0, Math.min(BEATS_PER_MEASURE, beatPosition));
}

describe('拍位置計算のプロパティベーステスト', () => {
  /**
   * Feature: click-position-fix, Property 6: 拍位置の範囲
   * **Validates: Requirements 3.2**
   * 
   * プロパティ 6: 拍位置の範囲
   * 任意の小節内のクリック位置から計算された拍位置は、
   * 0以上、BEATS_PER_MEASURE（4）以下でなければならない。
   */
  describe('プロパティ 6: 拍位置の範囲', () => {
    const BEATS_PER_MEASURE = 4;
    
    it('任意のクリック位置に対して拍位置は有効な範囲内である', () => {
      // プロパティテスト: 任意のクリック位置に対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 0, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 100, max: 600, noNaN: true }), // measRight
          // クリック位置のオフセット（小節の左端からの相対位置、-0.2〜1.2の範囲）
          fc.double({ min: -0.2, max: 1.2, noNaN: true }),
          (measLeft, measRight, clickOffset) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            const measWidth = measRight - measLeft;
            const localX = measLeft + clickOffset * measWidth;
            
            // クリック位置が有効であることを確認
            if (!isFinite(localX)) {
              return; // 無効な値はスキップ
            }
            
            // 拍位置を計算
            const beatPosition = calculateBeatPosition(localX, measLeft, measRight);
            
            // 拍位置は有限値でなければならない
            expect(isFinite(beatPosition)).toBe(true);
            expect(Number.isNaN(beatPosition)).toBe(false);
            
            // 拍位置は0以上でなければならない
            expect(beatPosition).toBeGreaterThanOrEqual(0);
            
            // 拍位置はBEATS_PER_MEASURE以下でなければならない
            expect(beatPosition).toBeLessThanOrEqual(BEATS_PER_MEASURE);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('小節の左端をクリックした場合、拍位置は0である', () => {
      // プロパティテスト: 任意の小節範囲に対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 0, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 100, max: 600, noNaN: true }), // measRight
          (measLeft, measRight) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            // 小節の左端をクリック
            const localX = measLeft;
            
            // 拍位置を計算
            const beatPosition = calculateBeatPosition(localX, measLeft, measRight);
            
            // 拍位置は0でなければならない
            expect(beatPosition).toBeCloseTo(0, 5);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('小節の右端をクリックした場合、拍位置は4である', () => {
      // プロパティテスト: 任意の小節範囲に対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 0, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 100, max: 600, noNaN: true }), // measRight
          (measLeft, measRight) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            // 小節の右端をクリック
            const localX = measRight;
            
            // 拍位置を計算
            const beatPosition = calculateBeatPosition(localX, measLeft, measRight);
            
            // 拍位置は4でなければならない
            expect(beatPosition).toBeCloseTo(BEATS_PER_MEASURE, 5);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('小節の中央をクリックした場合、拍位置は2である', () => {
      // プロパティテスト: 任意の小節範囲に対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 0, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 100, max: 600, noNaN: true }), // measRight
          (measLeft, measRight) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            // 小節の中央をクリック
            const localX = (measLeft + measRight) / 2;
            
            // 拍位置を計算
            const beatPosition = calculateBeatPosition(localX, measLeft, measRight);
            
            // 拍位置は2でなければならない
            expect(beatPosition).toBeCloseTo(BEATS_PER_MEASURE / 2, 5);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('小節の範囲外をクリックした場合でも拍位置は0〜4の範囲内である', () => {
      // プロパティテスト: 範囲外のクリック位置に対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 100, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 200, max: 600, noNaN: true }), // measRight
          // 範囲外のオフセット（負の値または1より大きい値）
          fc.oneof(
            fc.double({ min: -2, max: -0.1, noNaN: true }), // 左側に外れた位置
            fc.double({ min: 1.1, max: 3, noNaN: true })    // 右側に外れた位置
          ),
          (measLeft, measRight, clickOffset) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            const measWidth = measRight - measLeft;
            const localX = measLeft + clickOffset * measWidth;
            
            // クリック位置が有効であることを確認
            if (!isFinite(localX)) {
              return; // 無効な値はスキップ
            }
            
            // 拍位置を計算
            const beatPosition = calculateBeatPosition(localX, measLeft, measRight);
            
            // 拍位置は有限値でなければならない
            expect(isFinite(beatPosition)).toBe(true);
            expect(Number.isNaN(beatPosition)).toBe(false);
            
            // 拍位置は0以上でなければならない
            expect(beatPosition).toBeGreaterThanOrEqual(0);
            
            // 拍位置はBEATS_PER_MEASURE以下でなければならない
            expect(beatPosition).toBeLessThanOrEqual(BEATS_PER_MEASURE);
            
            // 左側に外れた場合は0、右側に外れた場合は4になるべき
            if (clickOffset < 0) {
              expect(beatPosition).toBeCloseTo(0, 5);
            } else {
              expect(beatPosition).toBeCloseTo(BEATS_PER_MEASURE, 5);
            }
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('拍位置は小節内の相対位置に比例する', () => {
      // プロパティテスト: 任意の相対位置に対して
      fc.assert(
        fc.property(
          // 小節の範囲を生成
          fc.double({ min: 0, max: 500, noNaN: true }), // measLeft
          fc.double({ min: 100, max: 600, noNaN: true }), // measRight
          // 相対位置を生成（0〜1の範囲）
          fc.double({ min: 0, max: 1, noNaN: true }),
          (measLeft, measRight, relativePos) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measRight) || measRight <= measLeft) {
              return; // 無効な値はスキップ
            }
            
            const measWidth = measRight - measLeft;
            const localX = measLeft + relativePos * measWidth;
            
            // クリック位置が有効であることを確認
            if (!isFinite(localX)) {
              return; // 無効な値はスキップ
            }
            
            // 拍位置を計算
            const beatPosition = calculateBeatPosition(localX, measLeft, measRight);
            
            // 期待される拍位置を計算
            const expectedBeatPosition = relativePos * BEATS_PER_MEASURE;
            
            // 拍位置は期待値に近いべき
            expect(beatPosition).toBeCloseTo(expectedBeatPosition, 5);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('異なる小節幅でも拍位置の計算が一貫している', () => {
      // プロパティテスト: 様々な小節幅に対して
      fc.assert(
        fc.property(
          // 小節の左端を生成
          fc.double({ min: 0, max: 500, noNaN: true }),
          // 小節の幅を生成（広い範囲）
          fc.double({ min: 50, max: 500, noNaN: true }),
          // 相対位置を生成（0〜1の範囲）
          fc.double({ min: 0, max: 1, noNaN: true }),
          (measLeft, measWidth, relativePos) => {
            // 小節の範囲が有効であることを確認
            if (!isFinite(measLeft) || !isFinite(measWidth) || measWidth <= 0) {
              return; // 無効な値はスキップ
            }
            
            const measRight = measLeft + measWidth;
            const localX = measLeft + relativePos * measWidth;
            
            // クリック位置が有効であることを確認
            if (!isFinite(localX)) {
              return; // 無効な値はスキップ
            }
            
            // 拍位置を計算
            const beatPosition = calculateBeatPosition(localX, measLeft, measRight);
            
            // 期待される拍位置を計算
            const expectedBeatPosition = relativePos * BEATS_PER_MEASURE;
            
            // 拍位置は期待値に近いべき（小節幅に関わらず）
            expect(beatPosition).toBeCloseTo(expectedBeatPosition, 5);
            
            // 拍位置は有効な範囲内でなければならない
            expect(beatPosition).toBeGreaterThanOrEqual(0);
            expect(beatPosition).toBeLessThanOrEqual(BEATS_PER_MEASURE);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('beatsFromVF関数が正しい拍数を返す', () => {
      // 各duration値に対する期待される拍数
      const testCases = [
        { vf: '64', expectedBeats: 1/16 },
        { vf: '32', expectedBeats: 1/8 },
        { vf: '16', expectedBeats: 1/4 },
        { vf: '8', expectedBeats: 1/2 },
        { vf: 'q', expectedBeats: 1 },
        { vf: 'h', expectedBeats: 2 },
        { vf: 'w', expectedBeats: 4 },
      ];
      
      for (const testCase of testCases) {
        const beats = beatsFromVF(testCase.vf);
        expect(beats).toBeCloseTo(testCase.expectedBeats, 10);
      }
    });
    
    it('toVFDur関数が正しいVexflow durationを返す', () => {
      // 各DurKeyに対する期待されるVexflow duration
      const testCases = [
        { durKey: '1', expectedVF: 'w' },
        { durKey: '2', expectedVF: 'h' },
        { durKey: '4', expectedVF: 'q' },
        { durKey: '8', expectedVF: '8' },
        { durKey: '16', expectedVF: '16' },
        { durKey: '32', expectedVF: '32' },
        { durKey: '64', expectedVF: '64' },
      ];
      
      for (const testCase of testCases) {
        const vf = toVFDur(testCase.durKey);
        expect(vf).toBe(testCase.expectedVF);
      }
    });
    
    it('任意のduration値に対して拍数は0より大きく4以下である', () => {
      // プロパティテスト: 任意のduration値に対して
      fc.assert(
        fc.property(
          // duration値を生成
          fc.constantFrom('64', '32', '16', '8', 'q', 'h', 'w'),
          (vf) => {
            // 拍数を計算
            const beats = beatsFromVF(vf);
            
            // 拍数は有限値でなければならない
            expect(isFinite(beats)).toBe(true);
            expect(Number.isNaN(beats)).toBe(false);
            
            // 拍数は0より大きくなければならない
            expect(beats).toBeGreaterThan(0);
            
            // 拍数はBEATS_PER_MEASURE以下でなければならない
            expect(beats).toBeLessThanOrEqual(BEATS_PER_MEASURE);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('複数の音符の合計拍数が4を超えないことを検証', () => {
      // プロパティテスト: 任意の音符の組み合わせに対して
      fc.assert(
        fc.property(
          // 音符のduration配列を生成（1〜8個）
          fc.array(
            fc.constantFrom('64', '32', '16', '8', 'q', 'h', 'w'),
            { minLength: 1, maxLength: 8 }
          ),
          (durations) => {
            // 合計拍数を計算
            let totalBeats = 0;
            const validDurations: string[] = [];
            
            for (const dur of durations) {
              const beats = beatsFromVF(dur);
              
              // 拍数が有効であることを確認
              expect(isFinite(beats)).toBe(true);
              expect(beats).toBeGreaterThan(0);
              
              // 合計が4を超えない場合のみ追加
              if (totalBeats + beats <= BEATS_PER_MEASURE) {
                totalBeats += beats;
                validDurations.push(dur);
              } else {
                // 4を超える場合は追加しない
                break;
              }
            }
            
            // 合計拍数は0より大きくなければならない
            expect(totalBeats).toBeGreaterThan(0);
            
            // 合計拍数はBEATS_PER_MEASURE以下でなければならない
            expect(totalBeats).toBeLessThanOrEqual(BEATS_PER_MEASURE);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('無効な小節幅の場合、拍位置は0を返す', () => {
      // プロパティテスト: 無効な小節幅に対して
      fc.assert(
        fc.property(
          // 小節の左端を生成
          fc.double({ min: 0, max: 500, noNaN: true }),
          // クリック位置を生成
          fc.double({ min: 0, max: 500, noNaN: true }),
          (measLeft, localX) => {
            // 無効な小節幅（measRight <= measLeft）
            const measRight = measLeft; // 幅が0
            
            // 拍位置を計算
            const beatPosition = calculateBeatPosition(localX, measLeft, measRight);
            
            // 無効な小節幅の場合、拍位置は0を返すべき
            expect(beatPosition).toBe(0);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
  });
});

describe('音高変換のラウンドトリップテスト', () => {
  /**
   * Feature: click-position-fix, Property 7: 音高変換のラウンドトリップ
   * **Validates: Requirements 3.3**
   * 
   * プロパティ 7: 音高変換のラウンドトリップ
   * 任意の有効な音高（key文字列）に対して、keyToLineTrebleで線番号に変換し、
   * その線番号をlineToKeyTrebleで音高に戻した場合、
   * 元の音高と同じ音名・オクターブでなければならない（臨時記号は無視）。
   */
  describe('プロパティ 7: 音高変換のラウンドトリップ', () => {
    it('任意の音高に対してラウンドトリップ変換が一貫している', () => {
      // プロパティテスト: 任意の音高に対して
      fc.assert(
        fc.property(
          // 音名を生成（c, d, e, f, g, a, b）
          fc.constantFrom('c', 'd', 'e', 'f', 'g', 'a', 'b'),
          // 臨時記号を生成（なし、#、b）
          fc.constantFrom('', '#', 'b'),
          // オクターブを生成（0〜8の範囲）
          fc.integer({ min: 0, max: 8 }),
          (letter, accidental, octave) => {
            // 音高文字列を構築
            const key = `${letter}${accidental}/${octave}`;
            
            // 音高を線番号に変換
            const line = keyToLineTreble(key);
            
            // 線番号は有限値でなければならない
            expect(isFinite(line)).toBe(true);
            expect(Number.isNaN(line)).toBe(false);
            
            // 線番号を音高に戻す
            const roundTripKey = lineToKeyTreble(line);
            
            // ラウンドトリップ後の音高は有効な形式でなければならない（負のオクターブも許容）
            expect(roundTripKey).toMatch(/^[a-g]\/[-]?[0-9]+$/);
            
            // 音名とオクターブを抽出
            const originalMatch = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i);
            const roundTripMatch = roundTripKey.match(/^([a-g])[/ ]([-]?[0-9]+)$/i);
            
            expect(originalMatch).not.toBeNull();
            expect(roundTripMatch).not.toBeNull();
            
            if (originalMatch && roundTripMatch) {
              const originalLetter = originalMatch[1].toLowerCase();
              const originalOctave = parseInt(originalMatch[3], 10);
              const roundTripLetter = roundTripMatch[1].toLowerCase();
              const roundTripOctave = parseInt(roundTripMatch[2], 10);
              
              // 音名とオクターブが一致するべき
              // （臨時記号は線番号に影響しないため、ラウンドトリップ後は失われる）
              expect(roundTripLetter).toBe(originalLetter);
              expect(roundTripOctave).toBe(originalOctave);
            }
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('任意の線番号に対してラウンドトリップ変換が一貫している', () => {
      // プロパティテスト: 任意の線番号に対して
      fc.assert(
        fc.property(
          // 線番号を生成（-10〜20の範囲、0.5刻み）
          fc.integer({ min: -20, max: 40 }),
          (lineInt) => {
            // 線番号を0.5刻みに変換
            const line = lineInt / 2;
            
            // 線番号を音高に変換
            const key = lineToKeyTreble(line);
            
            // 音高は有効な形式でなければならない（負のオクターブも許容）
            expect(key).toMatch(/^[a-g]\/[-]?[0-9]+$/);
            
            // 音高を線番号に戻す
            const roundTripLine = keyToLineTreble(key);
            
            // 線番号は有限値でなければならない
            expect(isFinite(roundTripLine)).toBe(true);
            expect(Number.isNaN(roundTripLine)).toBe(false);
            
            // ラウンドトリップ後の線番号は元の線番号と一致するべき
            // （0.5刻みにスナップされるため、誤差を許容）
            expect(roundTripLine).toBeCloseTo(line, 1);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('特定の音高に対してラウンドトリップ変換が正確である', () => {
      // 具体的な音高のテストケース（実装に基づいて修正）
      const testCases = [
        { key: 'c/4', expectedLine: 5 },
        { key: 'e/4', expectedLine: 4 },
        { key: 'g/4', expectedLine: 3 },
        { key: 'b/4', expectedLine: 2 },
        { key: 'd/5', expectedLine: 1 },
        { key: 'f/5', expectedLine: 0 },
        { key: 'a/5', expectedLine: -1 },
        { key: 'c/5', expectedLine: 1.5 },
        { key: 'e/5', expectedLine: 0.5 },
        { key: 'g/5', expectedLine: -0.5 },
      ];
      
      for (const testCase of testCases) {
        // 音高を線番号に変換
        const line = keyToLineTreble(testCase.key);
        
        // 期待される線番号と一致するか確認
        expect(line).toBeCloseTo(testCase.expectedLine, 1);
        
        // 線番号を音高に戻す
        const roundTripKey = lineToKeyTreble(line);
        
        // ラウンドトリップ後の音高は元の音高と一致するべき
        expect(roundTripKey).toBe(testCase.key);
      }
    });
    
    it('臨時記号付きの音高に対してラウンドトリップ変換が正確である（臨時記号は失われる）', () => {
      // 臨時記号付きの音高のテストケース
      const testCases = [
        { key: 'c#/4', expectedKey: 'c/4' },
        { key: 'db/4', expectedKey: 'd/4' },
        { key: 'f#/5', expectedKey: 'f/5' },
        { key: 'gb/5', expectedKey: 'g/5' },
        { key: 'a#/3', expectedKey: 'a/3' },
        { key: 'bb/3', expectedKey: 'b/3' },
      ];
      
      for (const testCase of testCases) {
        // 音高を線番号に変換
        const line = keyToLineTreble(testCase.key);
        
        // 線番号は有限値でなければならない
        expect(isFinite(line)).toBe(true);
        
        // 線番号を音高に戻す
        const roundTripKey = lineToKeyTreble(line);
        
        // ラウンドトリップ後の音高は臨時記号が失われた音高と一致するべき
        expect(roundTripKey).toBe(testCase.expectedKey);
      }
    });
    
    it('広い範囲のオクターブに対してラウンドトリップ変換が正確である', () => {
      // プロパティテスト: 広い範囲のオクターブに対して
      fc.assert(
        fc.property(
          // 音名を生成
          fc.constantFrom('c', 'd', 'e', 'f', 'g', 'a', 'b'),
          // オクターブを生成（0〜9の広い範囲）
          fc.integer({ min: 0, max: 9 }),
          (letter, octave) => {
            // 音高文字列を構築
            const key = `${letter}/${octave}`;
            
            // 音高を線番号に変換
            const line = keyToLineTreble(key);
            
            // 線番号は有限値でなければならない
            expect(isFinite(line)).toBe(true);
            expect(Number.isNaN(line)).toBe(false);
            
            // 線番号を音高に戻す
            const roundTripKey = lineToKeyTreble(line);
            
            // ラウンドトリップ後の音高は元の音高と一致するべき
            expect(roundTripKey).toBe(key);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
    
    it('無効な音高文字列に対してデフォルト値を返す', () => {
      // 無効な音高文字列のテストケース
      const invalidKeys = [
        '',
        'invalid',
        'h/5',
        'c',
        '/5',
        'c/x',
        'c#',
        '5',
      ];
      
      for (const invalidKey of invalidKeys) {
        // 無効な音高を線番号に変換
        const line = keyToLineTreble(invalidKey);
        
        // デフォルト値（2）が返されるべき
        expect(line).toBe(2);
      }
    });
    
    it('線番号の0.5刻みスナップが正しく機能する', () => {
      // プロパティテスト: 任意の線番号に対して
      fc.assert(
        fc.property(
          // 線番号を生成（小数点を含む）
          fc.double({ min: -10, max: 20, noNaN: true }),
          (line) => {
            // 線番号が有効であることを確認
            if (!isFinite(line)) {
              return; // 無効な値はスキップ
            }
            
            // 線番号を音高に変換
            const key = lineToKeyTreble(line);
            
            // 音高は有効な形式でなければならない（負のオクターブも許容）
            expect(key).toMatch(/^[a-g]\/[-]?[0-9]+$/);
            
            // 音高を線番号に戻す
            const roundTripLine = keyToLineTreble(key);
            
            // 線番号は有限値でなければならない
            expect(isFinite(roundTripLine)).toBe(true);
            expect(Number.isNaN(roundTripLine)).toBe(false);
            
            // ラウンドトリップ後の線番号は0.5刻みにスナップされるべき
            const doubled = roundTripLine * 2;
            expect(Math.abs(doubled - Math.round(doubled))).toBeLessThan(0.001);
            
            // ラウンドトリップ後の線番号は元の線番号に近いべき
            // （0.5刻みにスナップされるため、最大0.25の誤差）
            expect(Math.abs(roundTripLine - line)).toBeLessThanOrEqual(0.26);
          }
        ),
        { numRuns: 100 } // 最低100回の反復
      );
    });
  });
});
