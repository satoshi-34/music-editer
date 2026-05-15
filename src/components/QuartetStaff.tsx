// src/components/QuartetStaff.tsx
// 弦楽四重奏（Vn. I / Vn. II / Va. / Vc.）の N システムを描画するラッパー

import PianoSystemCanvas, { type PartConfig } from './PianoSystemCanvas';
import type { Tool } from './Palette';
import type { MeasureData, TimeSignature } from '../types/storage';
import type { NoteEvent } from '../types/storage';
import { InstrumentType } from '../audio/SoundSource';
import type { KeySignature } from '../utils/noteKeyUtils';

const QUARTET_PART_CONFIGS: Omit<PartConfig, 'data' | 'onChange'>[] = [
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
}: Props) {
  return (
    <div>
      {Array.from({ length: systems }, (_, i) => {
        const partsConfig: PartConfig[] = QUARTET_PART_CONFIGS.map((cfg, pi) => ({
          ...cfg,
          data: partsData[pi] ?? [],
          onChange: onPartChange[pi] ?? (() => {}),
        }));
        return (
          <PianoSystemCanvas
            key={i}
            measuresPerSystem={measuresPerSystem}
            tool={tool}
            scale={scale}
            partsConfig={partsConfig}
            showInstrumentLabels={i === 0}
            startMeasureIndex={startMeasureIndex + i * measuresPerSystem}
            disabled={disabled}
            yOffset={yOffset}
            currentInstrument={currentInstrument}
            onPreviewNoteEvent={onPreviewNoteEvent}
            previewAccidentalOnApply={previewAccidentalOnApply}
            keySignature={keySignature}
            timeSignature={timeSignature}
            onKeySignatureChange={onKeySignatureChange}
          />
        );
      })}
    </div>
  );
}
