// src/editor/dragSessions/types.ts
// 譜面側のドラッグリスナ（svg のタイ／松葉プレビュー・符頭のタイ／松葉ドラッグ）が共有する文脈（#695 段6c-2）。
// 値はいずれも描画 effect のローカルそのもの。
import type { MutableRefObject } from 'react';
import type { Tool } from '../../components/Palette';
import type { DragSessions } from '../types';

export interface TiePreviewContext {
  svg: SVGSVGElement;
  svgRoot: SVGGElement;
  dragSessionsRef: MutableRefObject<DragSessions>;
  /** タイ／松葉の新規ドラッグの破線プレビュー（描画 effect が 1 本作る） */
  tiePreviewPath: SVGPathElement;
  /** effect 開始時のツール（スナップショット。旧クロージャと同じ） */
  tool: Tool;
}
