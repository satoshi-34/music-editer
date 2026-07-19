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
        return (
          // print-hidden-system: 内容のない末尾の段は印刷から除外する（画面では表示）
          <div key={i} className={printVisibleSystems != null && i >= printVisibleSystems ? 'print-hidden-system' : undefined}>
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
          />
          </div>
        );
      })}
    </div>
  );
}
