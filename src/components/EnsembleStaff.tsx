import PianoSystemCanvas, { type PartConfig } from './PianoSystemCanvas';
import type { Tool } from './Palette';
import type { InstrumentPartDefinition, MeasureData, TimeSignature } from '../types/storage';
import type { NoteEvent } from '../types/storage';
import { InstrumentType } from '../audio/SoundSource';
import type { KeySignature } from '../utils/noteKeyUtils';

type Props = {
  tool: Tool;
  scale?: number;
  systems?: number;
  measuresPerSystem?: number;
  instrumentationParts: InstrumentPartDefinition[];
  partsData: MeasureData[][];
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

export default function EnsembleStaff({
  tool,
  scale = 0.86,
  systems = 3,
  measuresPerSystem = 4,
  instrumentationParts,
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
      {Array.from({ length: systems }, (_, systemIndex) => {
        // ScorePage が持つ「編成のパート定義」を、描画コンポーネントが理解できる
        // `PartConfig` へ変換する。ここで変換をまとめると、将来パート名表示や
        // 音部記号の扱いを変えるときも EnsembleStaff だけを見ればよくなる。
        const partsConfig: PartConfig[] = instrumentationParts.map((part, partIndex) => ({
          clef: part.clef,
          label: part.abbreviation || part.name,
          playbackInstrument: part.playbackInstrument,
          // 木管・金管・弦などの楽器グループ識別子。
          // PianoSystemCanvas はこの値が連続するパートをひとまとめにし、
          // 1 本の括弧で囲って描画する（オーケストラ譜の慣習）。
          bracketGroup: part.bracketGroup,
          data: partsData[partIndex] ?? [],
          onChange: onPartChange[partIndex] ?? (() => {}),
        }));

        return (
          <PianoSystemCanvas
            key={systemIndex}
            measuresPerSystem={measuresPerSystem}
            tool={tool}
            scale={scale}
            partsConfig={partsConfig}
            showInstrumentLabels={systemIndex === 0}
            startMeasureIndex={startMeasureIndex + systemIndex * measuresPerSystem}
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
