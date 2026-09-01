// src/components/QuartetStaff.tsx
// 弦楽四重奏（Vn. I / Vn. II / Va. / Vc.）の N システムを描画するラッパー

import type { ReactNode } from 'react';
import PianoSystemCanvas, { type PartConfig } from './PianoSystemCanvas';
import SystemSelectFrame from './SystemSelectFrame';
import type { Tool } from './Palette';
import type { MeasureData, TimeSignature, CustomSymbolDef, TimeSignatureStyle } from '../types/storage';
import type { NoteEvent } from '../types/storage';
import { InstrumentType } from '../audio/SoundSource';
import type { KeySignature } from '../utils/noteKeyUtils';
import type { SystemMeasureRange } from '../utils/measureLayoutUtils';
import type { IncomingArcEntry } from '../utils/incomingArcUtils';
import { createEmptyMeasures } from '../utils/voiceMeasureUtils';

// パート譜表示（PartExtractionStaff）からも同じ clef/楽器定義を使うため export する
// fullLabel は総譜1段目に出すフル名（Issue #60）。2段目以降は label（略称）を使う。
// fullLabel を変えるときは utils/partExtractionUtils.ts の
// QUARTET_PART_EXTRACTION_LABELS（パート譜表示の選択肢の名前）も必ず一緒に変えること。
export const QUARTET_PART_CONFIGS: Omit<PartConfig, 'data' | 'onChange'>[] = [
  { clef: 'treble', label: 'Vn. I',  fullLabel: 'Violin I',  playbackInstrument: InstrumentType.VIOLIN },
  { clef: 'treble', label: 'Vn. II', fullLabel: 'Violin II', playbackInstrument: InstrumentType.VIOLIN },
  { clef: 'alto',   label: 'Va.',    fullLabel: 'Viola',     playbackInstrument: InstrumentType.VIOLA },
  { clef: 'bass',   label: 'Vc.',    fullLabel: 'Violoncello', playbackInstrument: InstrumentType.CELLO },
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
  currentInstrument?: InstrumentType;
  onPreviewNoteEvent?: (noteEvent: NoteEvent, instrument?: InstrumentType) => Promise<void>;
  previewAccidentalOnApply?: boolean;
  keySignature?: KeySignature;
  timeSignature?: TimeSignature;
  /** 曲頭の弱起（アウフタクト）の拍数（Issue #473）。省略時は弱起なし。描画は PianoSystemCanvas に委譲する */
  pickupBeats?: number;
  /** 拍子記号を数字で描くか記号（C / 𝄵）で描くか（Issue #422）。描画は PianoSystemCanvas に委譲する */
  timeSignatureStyle?: TimeSignatureStyle;
  onKeySignatureChange?: (keySignature: KeySignature) => void;
  customSymbolDefs?: CustomSymbolDef[];
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
  /**
   * 段の選択（左右端クリック）まわり（Issue #482）。値は ScorePage が持ち、
   * ここでは共通の段ラッパー（SystemSelectFrame）へそのまま中継するだけ。
   */
  selectedSystemStart?: number | null;
  onSystemSelect?: (startMeasure: number, side: 'left' | 'right') => void;
  renderSystemPanel?: (startMeasure: number) => ReactNode;
  /** このページの1段目が譜面全体で何段目か（0始まり）。段の読み上げ名「段N」に使う */
  systemNumberOffset?: number;
  // 小節選択（Issue #110の挿入・削除等で使う）。PianoStaff/SingleStaffと同じ仕組みを
  // 弦楽四重奏でも使えるよう中継する（絶対小節インデックスは startMeasureIndex 起点で共通）。
  selectedMeasures?: { start: number; end: number };
  onMeasureSelect?: (absoluteIndex: number, shiftHeld: boolean) => void;
  // ドラッグ範囲選択（PianoSystemCanvas から呼ばれる）をそのまま親へ渡す
  onMeasureRangeSelect?: (startIndex: number, endIndex: number) => void;
  /** 拍範囲スライス選択（#333 段2）。小節選択ドラッグの拍まで見た版（PianoSystemCanvas 参照） */
  onBeatRangeSelect?: (sel: { startMeasure: number; startBeat: number; endMeasure: number; endBeat: number }) => void;
  /**
   * このコンポーネントが譜面の1ページ目を描いているときだけ true（Issue #60）。
   * 総譜のいちばん最初の段だけパート名をフル名（Violin I）にし、以降は略称（Vn. I）にする。
   */
  isFirstPage?: boolean;
  /**
   * パートごとの表示名（略称・フル名）の差し替え。QUARTET_PART_CONFIGS と同じ並び順で、
   * ユーザーが「パート名編集」で書き換えた名前を受け取る（Issue #448）。
   * 省略時は従来どおり QUARTET_PART_CONFIGS の既定名を使う。
   */
  partLabels?: ReadonlyArray<{ label?: string; fullLabel?: string }>;
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
  currentInstrument = InstrumentType.PIANO,
  onPreviewNoteEvent,
  previewAccidentalOnApply = true,
  keySignature = 'C',
  timeSignature = [4, 4],
  pickupBeats,
  timeSignatureStyle = 'numeric',
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
  selectedMeasures,
  onMeasureSelect,
  onMeasureRangeSelect,
  onBeatRangeSelect,
  isFirstPage = false,
  partLabels,
  selectedSystemStart = null,
  onSystemSelect,
  renderSystemPanel,
  systemNumberOffset = 0,
}: Props) {
  return (
    // system-stack: ページ内の段を縦方向へ均等配置するためのクラス（App.css 参照）
    <div className="system-stack">
      {Array.from({ length: systemRanges?.length ?? systems }, (_, i) => {
        const partsConfig: PartConfig[] = QUARTET_PART_CONFIGS.map((cfg, pi) => ({
          ...cfg,
          // partLabels が渡された譜面では、ユーザーが空欄にした名前も「ラベルなし」として
          // 尊重したい。そのため ?? での既定名フォールバックではなく、
          // 「その要素が渡されているかどうか」で丸ごと差し替える（Issue #448）
          ...(partLabels?.[pi] ? { label: partLabels[pi].label, fullLabel: partLabels[pi].fullLabel } : {}),
          data: partsData[pi] ?? [],
          onChange: onPartChange[pi] ?? (() => {}),
        }));
        const gapOverride = systemGapOverridesPx?.[i] ?? 0;
        return (
          // print-hidden-system: 内容のない末尾の段は印刷から除外する（画面では表示）
          <SystemSelectFrame
            key={i}
            className={printVisibleSystems != null && i >= printVisibleSystems ? 'print-hidden-system' : undefined}
            style={gapOverride !== 0 ? { marginTop: gapOverride } : undefined}
            startMeasure={systemRanges?.[i]?.start}
            systemNumber={systemNumberOffset + i + 1}
            selectedSystemStart={selectedSystemStart}
            onSelect={onSystemSelect}
            renderPanel={renderSystemPanel}
          >
          <PianoSystemCanvas
            measuresPerSystem={systemRanges?.[i]?.count ?? measuresPerSystem}
            tool={tool}
            scale={scale}
            partsConfig={partsConfig}
            showInstrumentLabels={i === 0}
            // 譜面全体でいちばん最初の段（1ページ目の1段目）だけフル名にする（Issue #60）
            showFullInstrumentLabels={isFirstPage && i === 0}
            startMeasureIndex={systemRanges?.[i]?.start ?? startMeasureIndex + i * measuresPerSystem}
            disabled={disabled}
            currentInstrument={currentInstrument}
            onPreviewNoteEvent={onPreviewNoteEvent}
            previewAccidentalOnApply={previewAccidentalOnApply}
            keySignature={keySignature}
            timeSignature={timeSignature}
            pickupBeats={pickupBeats}
            timeSignatureStyle={timeSignatureStyle}
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
            selectedMeasures={selectedMeasures}
            onMeasureSelect={onMeasureSelect}
            onMeasureRangeSelect={onMeasureRangeSelect}
            onBeatRangeSelect={onBeatRangeSelect}
          />
          </SystemSelectFrame>
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
            timeSignatureStyle={timeSignatureStyle}
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
