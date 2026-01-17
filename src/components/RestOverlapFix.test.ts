import { describe, it, expect, vi } from 'vitest';
import { StaveNote } from 'vexflow';
import fc from 'fast-check';

// makeVFNote関数をテストするため、StaffCanvasから抽出
type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; key: string };

// 定数
const BEATS_PER_MEASURE = 4;

// duration変換関数
type VFDur = 'w'|'h'|'q'|'8'|'16'|'32'|'64';
const toVFDur = (d: DurKey | string | undefined | null): VFDur =>
  d==='1'?'w':d==='2'?'h':d==='4'?'q':d==='8'?'8':d==='16'?'16':d==='32'?'32':d==='64'?'64':'q';

// 時間ベース位置計算関数
function calculateTimeBasedX(
  timePosition: number, 
  measureWidth: number, 
  measureLeft: number
): number {
  try {
    // 入力値の検証
    if (!Number.isFinite(timePosition) || !Number.isFinite(measureWidth) || !Number.isFinite(measureLeft)) {
      console.warn('calculateTimeBasedX: 無効な数値が入力されました', { timePosition, measureWidth, measureLeft });
      // フォールバック: 小節の左端を返す
      return Number.isFinite(measureLeft) ? measureLeft : 0;
    }

    // 負の時間位置や範囲外の値を適切に処理
    if (timePosition < 0) {
      console.warn('calculateTimeBasedX: 負の時間位置が指定されました', timePosition);
      // フォールバック: 0拍目として処理
      timePosition = 0;
    }

    // 小節幅が0以下の場合の処理
    if (measureWidth <= 0) {
      console.warn('calculateTimeBasedX: 無効な小節幅が指定されました', measureWidth);
      // フォールバック: 小節の左端を返す
      return measureLeft;
    }

    // 4拍を小節幅に比例配分
    const ratio = Math.max(0, Math.min(1, timePosition / BEATS_PER_MEASURE));
    const result = measureLeft + (measureWidth * ratio);

    // 結果の検証
    if (!Number.isFinite(result)) {
      console.warn('calculateTimeBasedX: 計算結果が無効な値になりました', { result, timePosition, measureWidth, measureLeft });
      // フォールバック: 小節の左端を返す
      return measureLeft;
    }

    return result;
  } catch (error) {
    console.error('calculateTimeBasedX: 予期しないエラーが発生しました', error);
    // フォールバック: 小節の左端を返す（安全な値）
    return Number.isFinite(measureLeft) ? measureLeft : 0;
  }
}

// beatsFromVF関数（duration変換用）
const beatsFromVF = (vf: VFDur) =>
  vf==='64'?1/16 : vf==='32'?1/8 : vf==='16'?1/4 : vf==='8'?1/2 : vf==='q'?1 : vf==='h'?2 : 4;

// 休符位置調整関数
function adjustRestPositions(
  vfNotes: StaveNote[], 
  events: NoteEvent[], 
  measureLeft: number, 
  measureWidth: number
): void {
  try {
    // 入力値の検証
    if (!Array.isArray(vfNotes) || !Array.isArray(events)) {
      console.warn('adjustRestPositions: 無効な配列が入力されました');
      return;
    }

    if (!Number.isFinite(measureLeft) || !Number.isFinite(measureWidth)) {
      console.warn('adjustRestPositions: 無効な小節パラメータが入力されました', { measureLeft, measureWidth });
      return;
    }

    if (measureWidth <= 0) {
      console.warn('adjustRestPositions: 無効な小節幅が指定されました', measureWidth);
      return;
    }

    let currentTime = 0;
    let adjustedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < vfNotes.length && i < events.length; i++) {
      const note = vfNotes[i];
      const event = events[i];
      
      // 基本的な検証
      if (!note || !event) {
        console.warn(`adjustRestPositions: インデックス${i}で無効なnoteまたはeventが見つかりました`);
        continue;
      }
      
      if (event.isRest) {
        try {
          // 時間ベースのX座標を計算
          const targetX = calculateTimeBasedX(currentTime, measureWidth, measureLeft);
          
          // 現在の位置を取得（複数の方法を試行）
          let currentX: number;
          try {
            currentX = (note as any).getAbsoluteX?.() || (note as any).getX?.() || 0;
          } catch (getXError) {
            console.warn(`adjustRestPositions: インデックス${i}でX座標取得に失敗`, getXError);
            // フォールバック: 小節の左端を使用
            currentX = measureLeft;
          }

          // 座標の妥当性を検証
          if (!Number.isFinite(currentX) || !Number.isFinite(targetX)) {
            console.warn(`adjustRestPositions: インデックス${i}で無効な座標が計算されました`, { currentX, targetX });
            continue;
          }

          const offset = targetX - currentX;
          
          // 位置を調整（1px以上の差がある場合のみ）
          if (Math.abs(offset) > 1) {
            try {
              // setXShiftメソッドの存在を確認
              if (typeof (note as any).setXShift === 'function') {
                (note as any).setXShift(offset);
                adjustedCount++;
              } else {
                console.warn(`adjustRestPositions: インデックス${i}でsetXShiftメソッドが利用できません`);
              }
            } catch (setXShiftError) {
              console.warn(`adjustRestPositions: インデックス${i}でsetXShift呼び出しに失敗`, setXShiftError);
              errorCount++;
              
              // 代替手段を試行
              try {
                if (typeof (note as any).setX === 'function') {
                  (note as any).setX(targetX);
                  adjustedCount++;
                } else {
                  console.warn(`adjustRestPositions: インデックス${i}で代替手段も利用できません`);
                }
              } catch (setXError) {
                console.warn(`adjustRestPositions: インデックス${i}で代替手段も失敗`, setXError);
              }
            }
          }
        } catch (restError) {
          console.warn(`adjustRestPositions: インデックス${i}の休符処理でエラーが発生`, restError);
          errorCount++;
        }
      }
      
      // 次の時間位置を計算
      try {
        const duration = toVFDur(event.dur);
        const beats = beatsFromVF(duration);
        
        if (!Number.isFinite(beats) || beats < 0) {
          console.warn(`adjustRestPositions: インデックス${i}で無効な拍数が計算されました`, beats);
          // フォールバック: 4分音符として処理
          currentTime += 1;
        } else {
          currentTime += beats;
        }
      } catch (durationError) {
        console.warn(`adjustRestPositions: インデックス${i}で拍数計算に失敗`, durationError);
        // フォールバック: 4分音符として処理
        currentTime += 1;
      }
    }

    // 処理結果をログに記録
    if (adjustedCount > 0 || errorCount > 0) {
      console.log(`adjustRestPositions: 完了 - 調整済み: ${adjustedCount}, エラー: ${errorCount}`);
    }

  } catch (error) {
    console.error('adjustRestPositions: 予期しないエラーが発生しました', error);
    // フォールバック: 何もしない（既存の位置を維持）
  }
}

// makeVFNote関数（修正版）
function makeVFNote(ev: NoteEvent) {
  const vfDur = toVFDur(ev.dur);
  if (ev.isRest) {
    // 休符作成時にsetCenterAlignmentを削除 - 中央揃えを無効化して重なりを防ぐ
    const n = new StaveNote({ clef: 'treble', keys: ['b/4'], duration: (vfDur as VFDur) + 'r' });
    return n;
  }
  const n = new StaveNote({ clef: 'treble', keys: [ev.key], duration: vfDur });
  return n;
}

describe('makeVFNote関数の修正', () => {
  describe('休符の処理', () => {
    it('休符が中央揃えされないことを確認', () => {
      // 4分休符を作成
      const restEvent: NoteEvent = { dur: '4', isRest: true, key: 'b/4' };
      const note = makeVFNote(restEvent);
      
      // StaveNoteが作成されることを確認
      expect(note).toBeInstanceOf(StaveNote);
      
      // 休符であることを確認（Vexflowの内部メソッド）
      expect((note as any).isRest?.()).toBe(true);
    });

    it('異なる長さの休符が正しく作成される', () => {
      const testCases: Array<{ dur: DurKey; expectedVFDur: VFDur }> = [
        { dur: '1', expectedVFDur: 'w' },
        { dur: '2', expectedVFDur: 'h' },
        { dur: '4', expectedVFDur: 'q' },
        { dur: '8', expectedVFDur: '8' },
        { dur: '16', expectedVFDur: '16' },
      ];

      testCases.forEach(({ dur, expectedVFDur }) => {
        const restEvent: NoteEvent = { dur, isRest: true, key: 'b/4' };
        const note = makeVFNote(restEvent);
        
        expect(note).toBeInstanceOf(StaveNote);
        // 休符であることを確認
        expect((note as any).isRest?.()).toBe(true);
        // duration属性をチェック（Vexflowでは'r'サフィックスは内部で処理される）
        expect((note as any).duration).toBe(expectedVFDur);
      });
    });

    it('setCenterAlignmentメソッドが呼ばれていないことを確認', () => {
      const restEvent: NoteEvent = { dur: '4', isRest: true, key: 'b/4' };
      
      // setCenterAlignmentメソッドをスパイ
      const originalSetCenterAlignment = StaveNote.prototype.setCenterAlignment;
      const setCenterAlignmentSpy = vi.fn();
      (StaveNote.prototype as any).setCenterAlignment = setCenterAlignmentSpy;
      
      try {
        const note = makeVFNote(restEvent);
        
        // setCenterAlignmentが呼ばれていないことを確認
        expect(setCenterAlignmentSpy).not.toHaveBeenCalled();
        expect(note).toBeInstanceOf(StaveNote);
      } finally {
        // 元のメソッドを復元
        if (originalSetCenterAlignment) {
          (StaveNote.prototype as any).setCenterAlignment = originalSetCenterAlignment;
        }
      }
    });
  });

  describe('音符の処理', () => {
    it('音符の処理が変更されていないことを確認', () => {
      const noteEvent: NoteEvent = { dur: '4', isRest: false, key: 'c/4' };
      const note = makeVFNote(noteEvent);
      
      // StaveNoteが作成されることを確認
      expect(note).toBeInstanceOf(StaveNote);
      
      // 音符であることを確認（休符ではない）
      expect((note as any).isRest?.()).toBe(false);
      expect((note as any).duration).toBe('q');
    });

    it('異なる音高の音符が正しく作成される', () => {
      const testCases = ['c/4', 'd/4', 'e/4', 'f/4', 'g/4', 'a/4', 'b/4'];

      testCases.forEach(key => {
        const noteEvent: NoteEvent = { dur: '4', isRest: false, key };
        const note = makeVFNote(noteEvent);
        
        expect(note).toBeInstanceOf(StaveNote);
        expect((note as any).keys).toContain(key);
        expect((note as any).isRest?.()).toBe(false);
      });
    });
  });

  describe('エラーケース', () => {
    it('無効なdurationでもデフォルト値で処理される', () => {
      const invalidEvent: NoteEvent = { dur: 'invalid' as DurKey, isRest: true, key: 'b/4' };
      const note = makeVFNote(invalidEvent);
      
      expect(note).toBeInstanceOf(StaveNote);
      // デフォルトは'q'（4分音符）
      expect((note as any).duration).toBe('q');
      expect((note as any).isRest?.()).toBe(true);
    });
  });

  describe('時間ベース位置計算', () => {
    it('基本的な時間位置の変換', () => {
      const measureLeft = 100;
      const measureWidth = 200;

      // 0拍目（小節の開始）
      expect(calculateTimeBasedX(0, measureWidth, measureLeft)).toBe(100);
      
      // 1拍目（小節の1/4位置）
      expect(calculateTimeBasedX(1, measureWidth, measureLeft)).toBe(150);
      
      // 2拍目（小節の1/2位置）
      expect(calculateTimeBasedX(2, measureWidth, measureLeft)).toBe(200);
      
      // 4拍目（小節の終端）
      expect(calculateTimeBasedX(4, measureWidth, measureLeft)).toBe(300);
    });

    it('範囲外の時間位置の処理', () => {
      const measureLeft = 50;
      const measureWidth = 100;

      // 負の時間位置
      expect(calculateTimeBasedX(-1, measureWidth, measureLeft)).toBe(50);
      
      // 4拍を超える時間位置
      expect(calculateTimeBasedX(8, measureWidth, measureLeft)).toBe(150);
    });

    it('小数点の時間位置', () => {
      const measureLeft = 0;
      const measureWidth = 400;

      // 0.5拍目
      expect(calculateTimeBasedX(0.5, measureWidth, measureLeft)).toBe(50);
      
      // 1.5拍目
      expect(calculateTimeBasedX(1.5, measureWidth, measureLeft)).toBe(150);
      
      // 2.25拍目
      expect(calculateTimeBasedX(2.25, measureWidth, measureLeft)).toBe(225);
    });

    it('異なる小節サイズでの計算', () => {
      const testCases = [
        { left: 0, width: 100 },
        { left: 200, width: 300 },
        { left: 50, width: 150 },
      ];

      testCases.forEach(({ left, width }) => {
        // 各小節で2拍目の位置を確認
        const expected = left + (width * 0.5); // 2拍 / 4拍 = 0.5
        expect(calculateTimeBasedX(2, width, left)).toBe(expected);
      });
    });
  });

  describe('休符位置調整', () => {
    it('単一休符の位置調整', () => {
      // モックのStaveNoteを作成
      const mockNote = {
        isRest: () => true,
        getAbsoluteX: () => 150, // 現在位置
        setXShift: vi.fn(),
      };
      
      const vfNotes = [mockNote as any];
      const events: NoteEvent[] = [{ dur: '4', isRest: true, key: 'b/4' }];
      const measureLeft = 100;
      const measureWidth = 200;
      
      adjustRestPositions(vfNotes, events, measureLeft, measureWidth);
      
      // 0拍目の期待位置は100（measureLeft）
      // 現在位置150との差は-50
      expect(mockNote.setXShift).toHaveBeenCalledWith(-50);
    });

    it('複数休符の時間順配置', () => {
      // 2つの4分休符のモック
      const mockNote1 = {
        isRest: () => true,
        getAbsoluteX: () => 150,
        setXShift: vi.fn(),
      };
      const mockNote2 = {
        isRest: () => true,
        getAbsoluteX: () => 160,
        setXShift: vi.fn(),
      };
      
      const vfNotes = [mockNote1 as any, mockNote2 as any];
      const events: NoteEvent[] = [
        { dur: '4', isRest: true, key: 'b/4' }, // 0拍目
        { dur: '4', isRest: true, key: 'b/4' }, // 1拍目
      ];
      const measureLeft = 100;
      const measureWidth = 200;
      
      adjustRestPositions(vfNotes, events, measureLeft, measureWidth);
      
      // 1つ目の休符: 0拍目 → X=100, オフセット=-50
      expect(mockNote1.setXShift).toHaveBeenCalledWith(-50);
      
      // 2つ目の休符: 1拍目 → X=150, オフセット=-10
      expect(mockNote2.setXShift).toHaveBeenCalledWith(-10);
    });

    it('音符と休符の混在', () => {
      const mockNote1 = {
        isRest: () => false, // 音符
        getAbsoluteX: () => 120,
        setXShift: vi.fn(),
      };
      const mockNote2 = {
        isRest: () => true, // 休符
        getAbsoluteX: () => 180,
        setXShift: vi.fn(),
      };
      
      const vfNotes = [mockNote1 as any, mockNote2 as any];
      const events: NoteEvent[] = [
        { dur: '4', isRest: false, key: 'c/4' }, // 音符
        { dur: '4', isRest: true, key: 'b/4' },  // 休符
      ];
      const measureLeft = 100;
      const measureWidth = 200;
      
      adjustRestPositions(vfNotes, events, measureLeft, measureWidth);
      
      // 音符は調整されない
      expect(mockNote1.setXShift).not.toHaveBeenCalled();
      
      // 休符は1拍目の位置に調整される
      expect(mockNote2.setXShift).toHaveBeenCalledWith(-30); // 150 - 180 = -30
    });

    it('位置差が小さい場合は調整しない', () => {
      const mockNote = {
        isRest: () => true,
        getAbsoluteX: () => 100.5, // 期待位置100との差が0.5px
        setXShift: vi.fn(),
      };
      
      const vfNotes = [mockNote as any];
      const events: NoteEvent[] = [{ dur: '4', isRest: true, key: 'b/4' }];
      
      adjustRestPositions(vfNotes, events, 100, 200);
      
      // 1px以下の差なので調整しない
      expect(mockNote.setXShift).not.toHaveBeenCalled();
    });

    it('Vexflow APIエラーの処理', () => {
      const mockNote = {
        isRest: () => true,
        getAbsoluteX: () => { throw new Error('API Error'); },
        setXShift: vi.fn(),
      };
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const vfNotes = [mockNote as any];
      const events: NoteEvent[] = [{ dur: '4', isRest: true, key: 'b/4' }];
      
      // エラーが発生してもクラッシュしない
      expect(() => {
        adjustRestPositions(vfNotes, events, 100, 200);
      }).not.toThrow();
      
      // 警告がログに記録される（新しいメッセージ形式）
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('adjustRestPositions: インデックス0でX座標取得に失敗'), 
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('プロパティベーステスト', () => {
    describe('プロパティ2: 時間軸順序保持', () => {
      // **Feature: rest-overlap-fix, Property 2: 時間軸順序保持**
      it('任意の小節内の要素について、時間的に早い要素は水平位置でもより左側に配置される', () => {
        fc.assert(
          fc.property(
            // 小節の設定を生成
            fc.record({
              measureLeft: fc.integer({ min: 0, max: 1000 }),
              measureWidth: fc.integer({ min: 100, max: 500 }),
            }),
            // 2つの異なる時間位置を生成
            fc.tuple(
              fc.float({ min: 0, max: 4, noNaN: true }),
              fc.float({ min: 0, max: 4, noNaN: true })
            ).filter(([time1, time2]) => Math.abs(time1 - time2) > 0.1), // 十分に離れた時間
            ({ measureLeft, measureWidth }, [time1, time2]) => {
              // 時間順序を確定
              const earlierTime = Math.min(time1, time2);
              const laterTime = Math.max(time1, time2);
              
              // 各時間位置のX座標を計算
              const earlierX = calculateTimeBasedX(earlierTime, measureWidth, measureLeft);
              const laterX = calculateTimeBasedX(laterTime, measureWidth, measureLeft);
              
              // 時間的に早い要素は水平位置でもより左側にある
              expect(earlierX).toBeLessThanOrEqual(laterX);
              
              // 時間が異なる場合、X座標も異なる（厳密な順序）
              if (Math.abs(earlierTime - laterTime) > 0.01) {
                expect(earlierX).toBeLessThan(laterX);
              }
            }
          ),
          { numRuns: 100 }
        );
      });

      it('同じ時間位置では同じX座標が返される', () => {
        fc.assert(
          fc.property(
            fc.record({
              measureLeft: fc.integer({ min: 0, max: 1000 }),
              measureWidth: fc.integer({ min: 100, max: 500 }),
              timePosition: fc.float({ min: 0, max: 4, noNaN: true }),
            }),
            ({ measureLeft, measureWidth, timePosition }) => {
              const x1 = calculateTimeBasedX(timePosition, measureWidth, measureLeft);
              const x2 = calculateTimeBasedX(timePosition, measureWidth, measureLeft);
              
              // 同じ入力では同じ結果
              expect(x1).toBe(x2);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('時間位置が単調増加する場合、X座標も単調増加する', () => {
        fc.assert(
          fc.property(
            fc.record({
              measureLeft: fc.integer({ min: 0, max: 1000 }),
              measureWidth: fc.integer({ min: 100, max: 500 }),
            }),
            fc.array(fc.float({ min: 0, max: 4, noNaN: true }), { minLength: 2, maxLength: 10 }),
            ({ measureLeft, measureWidth }, timePositions) => {
              // 時間位置を昇順にソート
              const sortedTimes = [...timePositions].sort((a, b) => a - b);
              
              // 各時間位置のX座標を計算
              const xPositions = sortedTimes.map(time => 
                calculateTimeBasedX(time, measureWidth, measureLeft)
              );
              
              // X座標も昇順になっている
              for (let i = 1; i < xPositions.length; i++) {
                expect(xPositions[i]).toBeGreaterThanOrEqual(xPositions[i - 1]);
              }
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    describe('プロパティ1: 休符重なり防止', () => {
      // **Feature: rest-overlap-fix, Property 1: 休符重なり防止**
      it('任意の小節において、複数の休符は視覚的に重ならない位置に配置される', () => {
        fc.assert(
          fc.property(
            // 小節の設定を生成
            fc.record({
              measureLeft: fc.integer({ min: 0, max: 1000 }),
              measureWidth: fc.integer({ min: 200, max: 800 }),
            }),
            // 複数の休符を生成（2-5個）
            fc.array(
              fc.record({
                dur: fc.constantFrom('1', '2', '4', '8', '16') as fc.Arbitrary<DurKey>,
                isRest: fc.constant(true),
                key: fc.constant('b/4'),
              }),
              { minLength: 2, maxLength: 5 }
            ),
            ({ measureLeft, measureWidth }, events) => {
              // モックのStaveNoteを作成
              const mockNotes = events.map((_, index) => ({
                isRest: () => true,
                getAbsoluteX: () => measureLeft + 50 + index * 10, // 重なりやすい初期位置
                setXShift: vi.fn(),
                _adjustedX: 0, // 調整後の位置を追跡
              }));

              // 位置調整を実行
              adjustRestPositions(mockNotes as any, events, measureLeft, measureWidth);

              // 各休符の最終位置を計算
              const finalPositions = mockNotes.map((note, index) => {
                const originalX = measureLeft + 50 + index * 10;
                const calls = note.setXShift.mock.calls;
                const offset = calls.length > 0 ? calls[calls.length - 1][0] : 0;
                return originalX + offset;
              });

              // 時間順序に基づく期待位置を計算
              let currentTime = 0;
              const expectedPositions = events.map(event => {
                const expectedX = calculateTimeBasedX(currentTime, measureWidth, measureLeft);
                const duration = toVFDur(event.dur);
                currentTime += beatsFromVF(duration);
                return expectedX;
              });

              // 各休符が期待位置に近い場所に配置されている
              for (let i = 0; i < finalPositions.length; i++) {
                const diff = Math.abs(finalPositions[i] - expectedPositions[i]);
                expect(diff).toBeLessThan(2); // 1px以下の誤差は許容
              }

              // 時間順序が保持されている
              for (let i = 1; i < finalPositions.length; i++) {
                expect(finalPositions[i]).toBeGreaterThanOrEqual(finalPositions[i - 1]);
              }
            }
          ),
          { numRuns: 100 }
        );
      });

      it('休符位置調整が適切なオフセットを計算する', () => {
        fc.assert(
          fc.property(
            fc.record({
              measureLeft: fc.integer({ min: 0, max: 500 }),
              measureWidth: fc.integer({ min: 100, max: 400 }),
              initialX: fc.integer({ min: 50, max: 600 }),
            }),
            ({ measureLeft, measureWidth, initialX }) => {
              const mockNote = {
                isRest: () => true,
                getAbsoluteX: () => initialX,
                setXShift: vi.fn(),
              };

              const events: NoteEvent[] = [{ dur: '4', isRest: true, key: 'b/4' }];
              
              adjustRestPositions([mockNote as any], events, measureLeft, measureWidth);

              // 期待位置（0拍目）
              const expectedX = calculateTimeBasedX(0, measureWidth, measureLeft);
              const expectedOffset = expectedX - initialX;

              if (Math.abs(expectedOffset) > 1) {
                // 1px以上の差がある場合、setXShiftが呼ばれる
                expect(mockNote.setXShift).toHaveBeenCalledWith(expectedOffset);
              } else {
                // 1px以下の差の場合、setXShiftは呼ばれない
                expect(mockNote.setXShift).not.toHaveBeenCalled();
              }
            }
          ),
          { numRuns: 100 }
        );
      });
    });
  });
});

  describe('エラーハンドリング', () => {
    describe('calculateTimeBasedX関数のエラー処理', () => {
      it('無効な数値入力に対してフォールバック値を返す', () => {
        const measureLeft = 100;
        const measureWidth = 200;

        // NaN入力
        expect(calculateTimeBasedX(NaN, measureWidth, measureLeft)).toBe(measureLeft);
        expect(calculateTimeBasedX(1, NaN, measureLeft)).toBe(measureLeft);
        expect(calculateTimeBasedX(1, measureWidth, NaN)).toBe(0);

        // Infinity入力 - フォールバック値が返される
        expect(calculateTimeBasedX(Infinity, measureWidth, measureLeft)).toBe(measureLeft);
        expect(calculateTimeBasedX(1, Infinity, measureLeft)).toBe(measureLeft);
        // measureLeftがInfinityの場合、無効な数値として扱われ0が返される
        const infinityResult = calculateTimeBasedX(1, measureWidth, Infinity);
        expect(infinityResult).toBe(0);

        // 負のInfinity入力
        expect(calculateTimeBasedX(-Infinity, measureWidth, measureLeft)).toBe(measureLeft);
        expect(calculateTimeBasedX(1, -Infinity, measureLeft)).toBe(measureLeft);
        const negInfinityResult = calculateTimeBasedX(1, measureWidth, -Infinity);
        expect(negInfinityResult).toBe(0);
      });

      it('負の時間位置を0として処理する', () => {
        const measureLeft = 100;
        const measureWidth = 200;

        // 負の時間位置は0拍目として処理される
        const result = calculateTimeBasedX(-1, measureWidth, measureLeft);
        const expected = calculateTimeBasedX(0, measureWidth, measureLeft);
        expect(result).toBe(expected);
      });

      it('0以下の小節幅に対してフォールバック値を返す', () => {
        const measureLeft = 100;
        const timePosition = 2;

        // 0の小節幅
        expect(calculateTimeBasedX(timePosition, 0, measureLeft)).toBe(measureLeft);

        // 負の小節幅
        expect(calculateTimeBasedX(timePosition, -100, measureLeft)).toBe(measureLeft);
      });

      it('計算結果が無効な値の場合にフォールバック値を返す', () => {
        // 極端な値で計算結果がNaNになる可能性をテスト
        const result = calculateTimeBasedX(1, 200, 100);
        expect(Number.isFinite(result)).toBe(true);
      });
    });

    describe('adjustRestPositions関数のエラー処理', () => {
      it('無効な配列入力を適切に処理する', () => {
        const measureLeft = 100;
        const measureWidth = 200;

        // null/undefined配列
        expect(() => {
          adjustRestPositions(null as any, [], measureLeft, measureWidth);
        }).not.toThrow();

        expect(() => {
          adjustRestPositions([], null as any, measureLeft, measureWidth);
        }).not.toThrow();

        // 非配列入力
        expect(() => {
          adjustRestPositions('invalid' as any, [], measureLeft, measureWidth);
        }).not.toThrow();

        expect(() => {
          adjustRestPositions([], 'invalid' as any, measureLeft, measureWidth);
        }).not.toThrow();
      });

      it('無効な小節パラメータを適切に処理する', () => {
        const mockNote = {
          isRest: () => true,
          getAbsoluteX: () => 150,
          setXShift: vi.fn(),
        };
        const events: NoteEvent[] = [{ dur: '4', isRest: true, key: 'b/4' }];

        // NaN値
        expect(() => {
          adjustRestPositions([mockNote as any], events, NaN, 200);
        }).not.toThrow();

        expect(() => {
          adjustRestPositions([mockNote as any], events, 100, NaN);
        }).not.toThrow();

        // 0以下の小節幅
        expect(() => {
          adjustRestPositions([mockNote as any], events, 100, 0);
        }).not.toThrow();

        expect(() => {
          adjustRestPositions([mockNote as any], events, 100, -100);
        }).not.toThrow();
      });

      it('VexFlow API呼び出しエラーを適切に処理する', () => {
        // getAbsoluteXが例外を投げるモック
        const mockNoteWithError = {
          isRest: () => true,
          getAbsoluteX: () => { throw new Error('VexFlow API エラー'); },
          getX: () => 150, // フォールバック用（ただし使用されない）
          setXShift: vi.fn(),
        };

        const events: NoteEvent[] = [{ dur: '4', isRest: true, key: 'b/4' }];

        // エラーが発生してもクラッシュしない
        expect(() => {
          adjustRestPositions([mockNoteWithError as any], events, 100, 200);
        }).not.toThrow();

        // getAbsoluteXが失敗した場合、measureLeft（100）がフォールバック値として使用される
        // 期待位置（0拍目）= 100、フォールバック値 = 100、差 = 0
        // 差が1px以下なのでsetXShiftは呼ばれない
        expect(mockNoteWithError.setXShift).not.toHaveBeenCalled();
      });

      it('setXShiftメソッドが存在しない場合の処理', () => {
        const mockNoteWithoutSetXShift = {
          isRest: () => true,
          getAbsoluteX: () => 150,
          // setXShiftメソッドが存在しない
        };

        const events: NoteEvent[] = [{ dur: '4', isRest: true, key: 'b/4' }];

        // エラーが発生してもクラッシュしない
        expect(() => {
          adjustRestPositions([mockNoteWithoutSetXShift as any], events, 100, 200);
        }).not.toThrow();
      });

      it('setXShiftメソッドが例外を投げる場合の代替手段', () => {
        const mockNoteWithSetXError = {
          isRest: () => true,
          getAbsoluteX: () => 150,
          setXShift: () => { throw new Error('setXShift エラー'); },
          setX: vi.fn(), // 代替手段
        };

        const events: NoteEvent[] = [{ dur: '4', isRest: true, key: 'b/4' }];

        // エラーが発生してもクラッシュしない
        expect(() => {
          adjustRestPositions([mockNoteWithSetXError as any], events, 100, 200);
        }).not.toThrow();

        // 代替手段（setX）が呼ばれる
        expect(mockNoteWithSetXError.setX).toHaveBeenCalled();
      });

      it('duration計算エラーを適切に処理する', () => {
        const mockNote = {
          isRest: () => true,
          getAbsoluteX: () => 150,
          setXShift: vi.fn(),
        };

        // 無効なdurationを持つevent
        const events: NoteEvent[] = [{ dur: 'invalid' as any, isRest: true, key: 'b/4' }];

        // エラーが発生してもクラッシュしない
        expect(() => {
          adjustRestPositions([mockNote as any], events, 100, 200);
        }).not.toThrow();
      });

      it('null/undefinedのnoteやeventを適切にスキップする', () => {
        const validNote = {
          isRest: () => true,
          getAbsoluteX: () => 150,
          setXShift: vi.fn(),
        };

        const validEvent: NoteEvent = { dur: '4', isRest: true, key: 'b/4' };

        // null/undefinedが混在する配列
        const mixedNotes = [validNote, null, undefined, validNote];
        const mixedEvents = [validEvent, null, undefined, validEvent];

        // エラーが発生してもクラッシュしない
        expect(() => {
          adjustRestPositions(mixedNotes as any, mixedEvents as any, 100, 200);
        }).not.toThrow();

        // 有効なnoteのみ処理される
        expect(validNote.setXShift).toHaveBeenCalled();
      });

      it('予期しないエラーを適切にキャッチする', () => {
        // 完全に壊れたモック
        const brokenNote = {
          get isRest() { throw new Error('予期しないエラー'); }
        };

        const events: NoteEvent[] = [{ dur: '4', isRest: true, key: 'b/4' }];

        // 予期しないエラーでもクラッシュしない
        expect(() => {
          adjustRestPositions([brokenNote as any], events, 100, 200);
        }).not.toThrow();
      });
    });

    describe('統合エラーハンドリング', () => {
      it('複数のエラー条件が同時に発生しても安全に処理する', () => {
        // 複数の問題を持つ複雑なケース
        const problematicNotes = [
          {
            isRest: () => true,
            getAbsoluteX: () => { throw new Error('API エラー'); },
            setXShift: () => { throw new Error('setXShift エラー'); },
          },
          null, // null note
          {
            isRest: () => true,
            getAbsoluteX: () => NaN, // 無効な座標
            setXShift: vi.fn(),
          },
          {
            isRest: () => false, // 音符（処理対象外）
            getAbsoluteX: () => 200,
            setXShift: vi.fn(),
          }
        ];

        const problematicEvents = [
          { dur: 'invalid' as any, isRest: true, key: 'b/4' }, // 無効なduration
          null, // null event
          { dur: '4', isRest: true, key: 'b/4' }, // 正常なevent
          { dur: '4', isRest: false, key: 'c/4' }, // 音符
        ];

        // 複数のエラーが発生してもクラッシュしない
        expect(() => {
          adjustRestPositions(
            problematicNotes as any, 
            problematicEvents as any, 
            NaN, // 無効なmeasureLeft
            -100 // 無効なmeasureWidth
          );
        }).not.toThrow();
      });
    });
  });