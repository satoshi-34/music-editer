// src/components/PianoStaff.tsx
// ピアノ大譜表コンポーネント
// 各システムを PianoSystemCanvas（1SVGに右手+左手）で描画する

import type { Tool } from './Palette';
import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData, TimeSignature, CustomSymbolDef } from '../types/storage';
import type { NoteEvent } from '../types/storage';
import { InstrumentType } from '../audio/SoundSource';
import type { KeySignature } from '../utils/noteKeyUtils';
import type { SystemMeasureRange } from '../utils/measureLayoutUtils';
import type { IncomingArcEntry } from '../utils/incomingArcUtils';
import { createEmptyMeasures } from '../utils/voiceMeasureUtils';

type Props = {
  tool: Tool;
  scale?: number;
  systems?: number;
  measuresPerSystem?: number;
  gap?: number;
  rightHandData?: MeasureData[];
  leftHandData?: MeasureData[];
  onRightHandChange?: (data: MeasureData[]) => void;
  onLeftHandChange?: (data: MeasureData[]) => void;
  startMeasureIndex?: number;
  disabled?: boolean;
  currentInstrument?: InstrumentType;
  onPreviewNoteEvent?: (noteEvent: NoteEvent, instrument?: InstrumentType) => Promise<void>;
  previewAccidentalOnApply?: boolean;
  keySignature?: KeySignature;
  timeSignature?: TimeSignature;
  onKeySignatureChange?: (keySignature: KeySignature) => void;
  selectedMeasures?: { start: number; end: number };
  onMeasureSelect?: (absoluteIndex: number, shiftHeld: boolean) => void;
  // ドラッグ範囲選択（PianoSystemCanvas から呼ばれる）をそのまま親へ渡す
  onMeasureRangeSelect?: (startIndex: number, endIndex: number) => void;
  /** 拍範囲スライス選択（#333 段2）。小節選択ドラッグの拍まで見た版（PianoSystemCanvas 参照） */
  onBeatRangeSelect?: (sel: { startMeasure: number; startBeat: number; endMeasure: number; endBeat: number }) => void;
  customSymbolDefs?: CustomSymbolDef[];
  // 声部切り替えトグル（0=声部1・上声、1=声部2・下声）。省略時は従来通り声部1のみ。
  activeVoiceIndex?: 0 | 1;
  /** 編集レイヤーのパート側（#316）。0=右手・1=左手。省略時は従来の帯域推測 */
  activeLayerPartIndex?: number;
  // 印刷時に表示する段数。これ以降（内容のない末尾の段）は @media print で非表示になる。
  // 省略時は全段を印刷する。画面表示には影響しない。
  printVisibleSystems?: number;
  plannedMeasureWidths?: number[];
  systemRanges?: SystemMeasureRange[];
  incomingArcIndex?: Map<number, IncomingArcEntry[]>;
  // 小節幅の均し具合（0〜1）。「レイアウト」タブのスライダー値を Canvas へ中継する。
  measureWidthEvenness?: number;
  /**
   * ページの左右余白(mm)。値そのものは使わず、余白変更時に子の PianoSystemCanvas の
   * 描画 useEffect を確実に再実行させるための依存トリガーとして中継するだけ。
   * 詳細は PianoSystemCanvas.tsx 側のコメントを参照（ResizeObserver だけでは
   * 特定のタイミングで再描画が漏れることがあったための対策）。
   */
  pageMarginSideMm?: number;
  // 終止線を描く「内容のある最後の小節」の絶対インデックス。省略時は終止線を描かない。
  finalMeasureIndex?: number;
  // 演奏記号タブが選択されているときだけ true にする。PianoSystemCanvas 側のコメント参照。
  symbolsClickable?: boolean;
  // 段内の隣接パート間隔への加算補正(px)。「レイアウト」タブの「パート間隔」スライダー
  // （Issue #90）から中継する。省略時・0のときは従来どおり自動値のまま。
  partSpacingOffsetPx?: number;
  /**
   * 段ごとの間隔（上の段との距離）の追加オフセット(px)。systemRanges と同じ並び順の配列で、
   * 各段の直前に marginTop として乗せる（詳細は SingleStaff.tsx 側のコメント参照）。
   */
  systemGapOverridesPx?: number[];
  /**
   * 「空の段でページを満たす」(Issue #41)。SingleStaff.tsx 側のコメント参照。
   */
  emptyFillerRanges?: SystemMeasureRange[];
  onEmptyFillerClick?: (index: number) => void;
  // 印刷プレビュー中は true。PianoSystemCanvas 側のコメント参照（Issue #88）。
  isPrintPreview?: boolean;
};

export default function PianoStaff({
  tool,
  scale = 0.86,
  systems = 9,
  measuresPerSystem = 4,
  rightHandData,
  leftHandData,
  onRightHandChange,
  onLeftHandChange,
  startMeasureIndex = 0,
  disabled = false,
  currentInstrument = InstrumentType.PIANO,
  onPreviewNoteEvent,
  previewAccidentalOnApply = true,
  keySignature = 'C',
  timeSignature = [4, 4],
  onKeySignatureChange,
  selectedMeasures,
  onMeasureSelect,
  onMeasureRangeSelect,
  onBeatRangeSelect,
  customSymbolDefs,
  activeVoiceIndex = 0,
  activeLayerPartIndex,
  printVisibleSystems, plannedMeasureWidths, systemRanges, incomingArcIndex,
  measureWidthEvenness,
  pageMarginSideMm,
  finalMeasureIndex,
  symbolsClickable,
  partSpacingOffsetPx,
  systemGapOverridesPx,
  emptyFillerRanges,
  onEmptyFillerClick,
  isPrintPreview = false,
}: Props) {
  return (
    // system-stack: ページ内の段を縦方向へ均等配置するためのクラス（App.css 参照）
    <div className="system-stack">
      {Array.from({ length: systemRanges?.length ?? systems }, (_, i) => (
        // print-hidden-system: 内容のない末尾の段は印刷から除外する（画面では表示）
        <div
          key={i}
          className={printVisibleSystems != null && i >= printVisibleSystems ? 'print-hidden-system' : undefined}
          style={(systemGapOverridesPx?.[i] ?? 0) !== 0 ? { marginTop: systemGapOverridesPx![i] } : undefined}
        >
        <PianoSystemCanvas
          measuresPerSystem={systemRanges?.[i]?.count ?? measuresPerSystem}
          tool={tool}
          scale={scale}
          trebleData={rightHandData}
          bassData={leftHandData}
          onTrebleChange={onRightHandChange}
          onBassChange={onLeftHandChange}
          startMeasureIndex={systemRanges?.[i]?.start ?? startMeasureIndex + i * measuresPerSystem}
          disabled={disabled}
          currentInstrument={currentInstrument}
          onPreviewNoteEvent={onPreviewNoteEvent}
          previewAccidentalOnApply={previewAccidentalOnApply}
          keySignature={keySignature}
          timeSignature={timeSignature}
          onKeySignatureChange={onKeySignatureChange}
          selectedMeasures={selectedMeasures}
          onMeasureSelect={onMeasureSelect}
          onMeasureRangeSelect={onMeasureRangeSelect}
          onBeatRangeSelect={onBeatRangeSelect}
          customSymbolDefs={customSymbolDefs}
          activeVoiceIndex={activeVoiceIndex}
          activeLayerPartIndex={activeLayerPartIndex}
          plannedMeasureWidths={systemRanges?.[i]?.minimumWidths ?? plannedMeasureWidths?.slice(i * measuresPerSystem, (i + 1) * measuresPerSystem)}
          incomingArcIndex={incomingArcIndex}
          measureWidthEvenness={measureWidthEvenness}
          pageMarginSideMm={pageMarginSideMm}
          finalMeasureIndex={finalMeasureIndex}
          symbolsClickable={symbolsClickable}
          isPrintPreview={isPrintPreview}
          partSpacingOffsetPx={partSpacingOffsetPx}
        />
        </div>
      ))}
      {emptyFillerRanges?.map((range, i) => (
        // empty-stave-filler: 五線紙のような「空の段」プレースホルダー（Issue #41）。
        // SingleStaff.tsx 側のコメント参照。
        <div
          key={`empty-filler-${i}`}
          className="empty-stave-filler"
          role="button"
          tabIndex={0}
          onClick={() => onEmptyFillerClick?.(i)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onEmptyFillerClick?.(i);
            }
          }}
        >
          <PianoSystemCanvas
            measuresPerSystem={range.count}
            tool={tool}
            scale={scale}
            trebleData={createEmptyMeasures(range.count)}
            bassData={createEmptyMeasures(range.count)}
            onTrebleChange={() => {}}
            onBassChange={() => {}}
            startMeasureIndex={0}
            disabled
            currentInstrument={currentInstrument}
            keySignature={keySignature}
            timeSignature={timeSignature}
            plannedMeasureWidths={range.minimumWidths}
            measureWidthEvenness={measureWidthEvenness}
            pageMarginSideMm={pageMarginSideMm}
            partSpacingOffsetPx={partSpacingOffsetPx}
          />
        </div>
      ))}
    </div>
  );
}
