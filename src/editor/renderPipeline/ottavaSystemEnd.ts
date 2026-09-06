// src/editor/renderPipeline/ottavaSystemEnd.ts
// オッターバ（8va/8vb）括弧の段末処理（#695 段6a）。PianoSystemCanvas の描画 effect 末尾に
// あった「開いたままの括弧を段の右端まで／中間段は全幅で描く」処理を、閉包の代わりに
// OttavaSystemEndDeps を受け取る関数へ物理移設した。本文は移設前のまま（挙動ゼロ差）。
import type { Stave } from 'vexflow';
import type { NoteEvent } from '../../types/storage';
import type { ResolvedSymbolAdjust } from '../../utils/symbolAdjustUtils';
import type { PartConfig, RenderCollectors } from '../../components/PianoSystemCanvas';

/** オッターバ記号と五線の上端の隙間（px）。PianoSystemCanvas から移設・同じ値 */
export const OTTAVA_STAFF_GAP_PX = 28;

export type PendingOttava = {
  kind: '8va' | '8vb'; startX: number; lineY: number; adjust: ResolvedSymbolAdjust;
  partIndex?: number; measureAbsoluteIndex?: number; eventIndex?: number; voiceIndex?: number; event?: NoteEvent;
};
export type OttavaOrigin = {
  adjust: ResolvedSymbolAdjust;
  measureAbsoluteIndex: number; eventIndex: number; voiceIndex: number; event: NoteEvent;
};

export interface OttavaSystemEndDeps {
  staveSets: Stave[][];
  parts: PartConfig[];
  pendingOttavaByKey: Map<string, PendingOttava>;
  ottavaEntries: RenderCollectors['ottavaEntries'];
  partHasOttava: (pi: number) => boolean;
  ottavaOpenBefore: (pi: number) => Map<'8va' | '8vb', OttavaOrigin>;
  ottavaEndsAfter: (pi: number, kind: '8va' | '8vb') => boolean;
}

export function drawOttavaSystemEnd(deps: OttavaSystemEndDeps): void {
  const { staveSets, parts, pendingOttavaByKey, ottavaEntries, partHasOttava, ottavaOpenBefore, ottavaEndsAfter } = deps;
  // ── オッターバの段またぎ: 段末の後処理（実機報告 2026-08-28）──
  // (a) この段で開始したまま終了が来なかった括弧は、次の段以降に終了があるなら
  //     段の右端まで描く（終端フックなし＝続きがあることを示す）
  // (b) 前の段から開いたまま、この段に開始も終了も無い中間段は、全幅の括弧を描く
  {
    const systemRightXOf = (pi: number) => {
      const staves = staveSets[pi] ?? [];
      const last = staves[staves.length - 1];
      return last ? last.getX() + last.getWidth() : 0;
    };
    const systemLeftXOf = (pi: number) => {
      const first = staveSets[pi]?.[0];
      if (!first) return 0;
      const g = first as unknown as { getNoteStartX?: () => number };
      return typeof g.getNoteStartX === 'function' ? g.getNoteStartX() : first.getX();
    };
    // (a) この段で開始したまま終了が来なかった括弧（パート×種類ごと）
    for (const carried of pendingOttavaByKey.values()) {
      if (carried.partIndex === undefined) continue;
      if (!ottavaEndsAfter(carried.partIndex, carried.kind)) continue; // 終了がどこにも無い開始は描かない
      ottavaEntries.push({ ...carried, endX: systemRightXOf(carried.partIndex), openEnd: true });
    }
    pendingOttavaByKey.clear();
    parts.forEach((_, pi) => {
      if (!partHasOttava(pi)) return;
      for (const kind of ['8va', '8vb'] as const) {
        const origin = ottavaOpenBefore(pi).get(kind);
        if (!origin) continue; // 開いていない／この段の終了で消費済み
        if (!ottavaEndsAfter(pi, kind)) continue; // 終了がどこにも無い開始は従来どおり描かない
        const first = staveSets[pi]?.[0];
        if (!first) continue;
        const topY = first.getYForLine(0);
        const botY = first.getYForLine(4);
        ottavaEntries.push({
          kind,
          startX: systemLeftXOf(pi),
          endX: systemRightXOf(pi),
          lineY: kind === '8va' ? topY - OTTAVA_STAFF_GAP_PX : botY + OTTAVA_STAFF_GAP_PX,
          adjust: origin.adjust,
          partIndex: pi,
          measureAbsoluteIndex: origin.measureAbsoluteIndex,
          eventIndex: origin.eventIndex,
          voiceIndex: origin.voiceIndex,
          event: origin.event,
          openEnd: true,
        });
      }
    });
  }
}
