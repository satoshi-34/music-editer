// src/components/QuartetStaff.tsx
// 弦楽四重奏（Vn. I / Vn. II / Va. / Vc.）の N システムを描画するラッパー

import PianoSystemCanvas, { type PartConfig } from './PianoSystemCanvas';
import type { Tool } from './Palette';
import type { MeasureData, TimeSignature, CustomSymbolDef } from '../types/storage';
import type { NoteEvent } from '../types/storage';
import { InstrumentType } from '../audio/SoundSource';
import type { KeySignature } from '../utils/noteKeyUtils';
import type { SystemMeasureRange } from '../utils/measureLayoutUtils';
import type { IncomingArcEntry } from '../utils/incomingArcUtils';
import { createEmptyMeasures } from '../utils/voiceMeasureUtils';

// パート譜表示（PartExtractionStaff）からも同じ clef/楽器定義を使うため export する
export const QUARTET_PART_CONFIGS: Omit<PartConfig, 'data' | 'onChange'>[] = [
  { clef: 'treble', label: 'Vn. I',  playbackInstrument: InstrumentType.VIOLIN },
  { clef: 'treble', label: 'Vn. II', playbackInstrument: InstrumentType.VIOLIN },
  { clef: 'alto',   label: 'Va.',    playbackInstrument: InstrumentType.VIOLA },
  { clef: 'bass',   label: 'Vc.',    playbackInstrument: InstrumentType.CELLO },
];

type Props = {
  tool: Tool;
  scale?: number;
  systems?: number;
  measuresPerSystem?: number;
  partsData: MeasureData[][];   // length 4: [vn1, vn2, va, vc]
  onPartChange: ((data: MeasureData[]) => void)[];
  startMeasureIndex?: number;
  disabled?: boolean;
  yOffset?: number;
  currentInstrument?: InstrumentType;
  onPreviewNoteEvent?: (noteEvent: NoteEvent, instrument?: InstrumentType) => Promise<void>;
  previewAccidentalOnApply?: boolean;
  keySignature?: KeySignature;
  timeSignature?: TimeSignature;
  onKeySignatureChange?: (keySignature: KeySignature) => void;
  customSymbolDefs?: CustomSymbolDef[];
  // 印刷時に表示する段数。これ以降（内容のない末尾の段）は @media print で非表示になる。
  // 省略時は全段を印刷する。画面表示には影響しない。
  printVisibleSystems?: number;
  plannedMeasureWidths?: number[];
  systemRanges?: SystemMeasureRange[];
  incomingArcIndex?: Map<number, IncomingArcEntry[]>;
  // 小節幅の均し具合（0〜1）。「その他」タブのスライダー値を Canvas へ中継する。
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
  // 段内の隣接パート間隔への加算補正(px)。「その他」タブの「パート間隔」スライダー
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

export default function QuartetStaff({
  tool,
  scale = 0.86,
  systems = 9,
  measuresPerSystem = 4,
  partsData,
  onPartChange,
  startMeasureIndex = 0,
  disabled = false,
  yOffset = 0,
  currentInstrument = InstrumentType.PIANO,
  onPreviewNoteEvent,
  previewAccidentalOnApply = true,
  keySignature = 'C',
  timeSignature = [4, 4],
  onKeySignatureChange,
  customSymbolDefs,
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
      {Array.from({ length: systemRanges?.length ?? systems }, (_, i) => {
        const partsConfig: PartConfig[] = QUARTET_PART_CONFIGS.map((cfg, pi) => ({
          ...cfg,
          data: partsData[pi] ?? [],
          onChange: onPartChange[pi] ?? (() => {}),
        }));
        const gapOverride = systemGapOverridesPx?.[i] ?? 0;
        return (
          // print-hidden-system: 内容のない末尾の段は印刷から除外する（画面では表示）
          <div
            key={i}
            className={printVisibleSystems != null && i >= printVisibleSystems ? 'print-hidden-system' : undefined}
            style={gapOverride !== 0 ? { marginTop: gapOverride } : undefined}
          >
          <PianoSystemCanvas
            measuresPerSystem={systemRanges?.[i]?.count ?? measuresPerSystem}
            tool={tool}
            scale={scale}
            partsConfig={partsConfig}
            showInstrumentLabels={i === 0}
            startMeasureIndex={systemRanges?.[i]?.start ?? startMeasureIndex + i * measuresPerSystem}
            disabled={disabled}
            yOffset={yOffset}
            currentInstrument={currentInstrument}
            onPreviewNoteEvent={onPreviewNoteEvent}
            previewAccidentalOnApply={previewAccidentalOnApply}
            keySignature={keySignature}
            timeSignature={timeSignature}
            onKeySignatureChange={onKeySignatureChange}
            customSymbolDefs={customSymbolDefs}
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
        );
      })}
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
            partsConfig={QUARTET_PART_CONFIGS.map((cfg) => ({
              ...cfg,
              data: createEmptyMeasures(range.count),
              onChange: () => {},
            }))}
            showInstrumentLabels={false}
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
