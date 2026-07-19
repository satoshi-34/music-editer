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
  yOffset?: number;
  currentInstrument?: InstrumentType;
  onPreviewNoteEvent?: (noteEvent: NoteEvent, instrument?: InstrumentType) => Promise<void>;
  previewAccidentalOnApply?: boolean;
  keySignature?: KeySignature;
  timeSignature?: TimeSignature;
  onKeySignatureChange?: (keySignature: KeySignature) => void;
  selectedMeasures?: { start: number; end: number };
  onMeasureSelect?: (absoluteIndex: number, shiftHeld: boolean) => void;
  customSymbolDefs?: CustomSymbolDef[];
  // 声部切り替えトグル（0=声部1・上声、1=声部2・下声）。省略時は従来通り声部1のみ。
  activeVoiceIndex?: 0 | 1;
  // 印刷時に表示する段数。これ以降（内容のない末尾の段）は @media print で非表示になる。
  // 省略時は全段を印刷する。画面表示には影響しない。
  printVisibleSystems?: number;
  plannedMeasureWidths?: number[];
  systemRanges?: SystemMeasureRange[];
  incomingArcIndex?: Map<number, IncomingArcEntry[]>;
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
  yOffset = 0,
  currentInstrument = InstrumentType.PIANO,
  onPreviewNoteEvent,
  previewAccidentalOnApply = true,
  keySignature = 'C',
  timeSignature = [4, 4],
  onKeySignatureChange,
  selectedMeasures,
  onMeasureSelect,
  customSymbolDefs,
  activeVoiceIndex = 0,
  printVisibleSystems, plannedMeasureWidths, systemRanges, incomingArcIndex,
}: Props) {
  return (
    // system-stack: ページ内の段を縦方向へ均等配置するためのクラス（App.css 参照）
    <div className="system-stack">
      {Array.from({ length: systemRanges?.length ?? systems }, (_, i) => (
        // print-hidden-system: 内容のない末尾の段は印刷から除外する（画面では表示）
        <div key={i} className={printVisibleSystems != null && i >= printVisibleSystems ? 'print-hidden-system' : undefined}>
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
          yOffset={yOffset}
          currentInstrument={currentInstrument}
          onPreviewNoteEvent={onPreviewNoteEvent}
          previewAccidentalOnApply={previewAccidentalOnApply}
          keySignature={keySignature}
          timeSignature={timeSignature}
          onKeySignatureChange={onKeySignatureChange}
          selectedMeasures={selectedMeasures}
          onMeasureSelect={onMeasureSelect}
          customSymbolDefs={customSymbolDefs}
          activeVoiceIndex={activeVoiceIndex}
          plannedMeasureWidths={systemRanges?.[i]?.minimumWidths ?? plannedMeasureWidths?.slice(i * measuresPerSystem, (i + 1) * measuresPerSystem)}
          incomingArcIndex={incomingArcIndex}
        />
        </div>
      ))}
    </div>
  );
}
