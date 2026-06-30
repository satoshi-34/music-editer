// src/utils/articulationUtils.ts
// アーティキュレーション記号のデータ操作ユーティリティ。
// articulationMarkingUtils.ts の関数を再エクスポートし、
// StaffCanvas / Palette が期待する名前で使えるようにしている。

import type { ArticulationMarking, ArticulationType } from '../types/storage';
import {
  toggleArticulationOnEvent,
  ARTICULATION_VALUES,
  isArticulationMarkingValue,
} from './articulationMarkingUtils';

export type { ArticulationType };
export { isArticulationMarkingValue };
export const ARTICULATION_TYPES: ArticulationType[] = ARTICULATION_VALUES;

/**
 * 音符イベントにアーティキュレーション記号を追加／削除する（トグル動作）。
 * applyArticulationToEvent という名前で外部から呼べるようにしている。
 */
export const applyArticulationToEvent = toggleArticulationOnEvent;

/**
 * アーティキュレーション記号の日本語ラベルを返す（ツールチップ・ボタン表示用）。
 */
export function articulationLabel(type: ArticulationMarking): string {
  switch (type) {
    case 'staccato': return 'スタッカート';
    case 'accent':   return 'アクセント';
    case 'tenuto':   return 'テヌート';
    case 'marcato':  return 'マルカート';
    case 'fermata':  return 'フェルマータ';
  }
}
