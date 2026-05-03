// src/components/PianoStaff.tsx
// ピアノ大譜表コンポーネント
// 各システムを PianoSystemCanvas（1SVGに右手+左手）で描画する

import type { Tool } from './Palette';
import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { InstrumentType } from '../audio/SoundSource';
import type { KeySignature } from '../utils/noteKeyUtils';

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
  previewAccidentalOnApply?: boolean;
  keySignature?: KeySignature;
  onKeySignatureChange?: (keySignature: KeySignature) => void;
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
  previewAccidentalOnApply = true,
  keySignature = 'C',
  onKeySignatureChange,
}: Props) {
  return (
    <div>
      {Array.from({ length: systems }, (_, i) => (
        <PianoSystemCanvas
          key={i}
          measuresPerSystem={measuresPerSystem}
          tool={tool}
          scale={scale}
          trebleData={rightHandData}
          bassData={leftHandData}
          onTrebleChange={onRightHandChange}
          onBassChange={onLeftHandChange}
          startMeasureIndex={startMeasureIndex + i * measuresPerSystem}
          disabled={disabled}
          yOffset={yOffset}
          currentInstrument={currentInstrument}
          previewAccidentalOnApply={previewAccidentalOnApply}
          keySignature={keySignature}
          onKeySignatureChange={onKeySignatureChange}
        />
      ))}
    </div>
  );
}
