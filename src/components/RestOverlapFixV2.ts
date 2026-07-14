import { StaveNote } from 'vexflow';

type NoteEvent = { dur: string; isRest: boolean; key: string; dots?: 1 | 2 };

// 付点1個=1.5倍、複付点(2個)=1.75倍
const dotBeatsMultiplier = (dots?: 1 | 2) => (dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1);

// 定数
const BEATS_PER_MEASURE = 4;

// duration変換関数
type VFDur = 'w'|'h'|'q'|'8'|'16'|'32'|'64';
const toVFDur = (d: string | undefined | null): VFDur =>
  d==='1'?'w':d==='2'?'h':d==='4'?'q':d==='8'?'8':d==='16'?'16':d==='32'?'32':d==='64'?'64':'q';

// beatsFromVF関数（duration変換用）
const beatsFromVF = (vf: VFDur) =>
  vf==='64'?1/16 : vf==='32'?1/8 : vf==='16'?1/4 : vf==='8'?1/2 : vf==='q'?1 : vf==='h'?2 : 4;

/**
 * 時間位置をX座標に変換する（音部記号パディング対応版）
 * @param timePosition 拍単位での時間位置（0から開始）
 * @param measureWidth 小節の幅（ピクセル）
 * @param measureLeft 小節の左端X座標
 * @param hasClef この小節に音部記号があるかどうか
 * @returns X座標（ピクセル）
 */
function calculateTimeBasedXV2(
  timePosition: number, 
  measureWidth: number, 
  measureLeft: number,
  hasClef: boolean = false
): number {
  try {
    // 入力値の検証
    if (!Number.isFinite(timePosition) || !Number.isFinite(measureWidth) || !Number.isFinite(measureLeft)) {
      console.warn('calculateTimeBasedX: 無効な数値が入力されました', { timePosition, measureWidth, measureLeft });
      return Number.isFinite(measureLeft) ? measureLeft : 0;
    }

    // 負の時間位置や範囲外の値を適切に処理
    if (timePosition < 0) {
      console.warn('calculateTimeBasedX: 負の時間位置が指定されました', timePosition);
      timePosition = 0;
    }

    // 小節幅が0以下の場合の処理
    if (measureWidth <= 0) {
      console.warn('calculateTimeBasedX: 無効な小節幅が指定されました', measureWidth);
      return measureLeft;
    }

    // 音部記号がある場合のパディングを考慮
    // 音部記号分のスペースを除いた実際の音符配置領域を計算
    const clefPadding = hasClef ? 50 : 0; // CLEF_PAD_FIRSTに相当
    const effectiveLeft = measureLeft + clefPadding;
    const effectiveWidth = Math.max(0, measureWidth - clefPadding);

    // 4拍を実効幅に比例配分
    const ratio = Math.max(0, Math.min(1, timePosition / BEATS_PER_MEASURE));
    const result = effectiveLeft + (effectiveWidth * ratio);

    // 結果の検証
    if (!Number.isFinite(result)) {
      console.warn('calculateTimeBasedX: 計算結果が無効な値になりました', { result, timePosition, measureWidth, measureLeft });
      return measureLeft;
    }

    return result;
  } catch (error) {
    console.error('calculateTimeBasedX: 予期しないエラーが発生しました', error);
    return Number.isFinite(measureLeft) ? measureLeft : 0;
  }
}

/**
 * 休符の位置を時間ベースで調整する（改良版）
 * 音部記号パディングを考慮した時間ベース位置計算を使用
 * @param vfNotes VexflowのStaveNoteリスト
 * @param events 元の音符・休符データ
 * @param measureLeft 小節の左端X座標
 * @param measureWidth 小節の幅（ピクセル）
 * @param hasClef この小節に音部記号があるかどうか（デフォルト: false）
 */
export function adjustRestPositionsV2(
  vfNotes: StaveNote[], 
  events: NoteEvent[], 
  measureLeft: number, 
  measureWidth: number,
  hasClef: boolean = false
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
          // 時間ベースのX座標を計算（音部記号パディング考慮）
          const targetX = calculateTimeBasedXV2(currentTime, measureWidth, measureLeft, hasClef);
          
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
        const beats = beatsFromVF(duration) * dotBeatsMultiplier(event.dots);
        
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

    // 処理結果をログに記録（調整が実際に行われた場合のみ）
    if (adjustedCount > 0) {
      console.log(`adjustRestPositions: 完了 - 調整済み: ${adjustedCount}, エラー: ${errorCount}`);
    } else if (errorCount > 0) {
      console.warn(`adjustRestPositions: エラーが発生しました - エラー: ${errorCount}`);
    }

  } catch (error) {
    console.error('adjustRestPositions: 予期しないエラーが発生しました', error);
    // フォールバック: 何もしない（既存の位置を維持）
  }
}