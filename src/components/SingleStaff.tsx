// src/components/SingleStaff.tsx
// 単旋律譜（1段=1五線）用の編集可能ラッパーコンポーネント。
//
// これまで単旋律譜は StaffCanvas（systems/gap を自分の props として受け取り、
// 1コンポーネント内で複数段をまとめて描画する）を使っていたが、
// PianoStaff / QuartetStaff / PartExtractionStaff は「1回の呼び出しで
// PianoSystemCanvas が1段だけ描く」設計で、折り返し（何段描くか）は
// 呼び出し側が Array.from({length: systems}) のループで担っている。
// SingleStaff はこの「呼び出し側がループする」パターンに単旋律譜を合わせるための
// ラッパーで、partsConfig を要素数1にして PianoSystemCanvas を流用する。
// 詳細な調査・移行方針は docs/phase2-staffcanvas-retirement-feasibility.md を参照。
//
// PartExtractionStaff と異なり、こちらは編集可能（onChange を実際に呼ぶ）。
// props の受け渡し方は編集可能な既存ラッパーである PianoStaff.tsx に合わせている。
import PianoSystemCanvas, { type PartConfig } from './PianoSystemCanvas';
import type { Tool } from './Palette';
import type { MeasureData, TimeSignature, CustomSymbolDef, NoteEvent } from '../types/storage';
import { InstrumentType } from '../audio/SoundSource';
import type { KeySignature } from '../utils/noteKeyUtils';

type Props = {
  tool: Tool;
  scale?: number;
  systems?: number;
  measuresPerSystem?: number;
  // StaffCanvas 由来の props。PianoSystemCanvas には段間隔を明示指定する仕組みが無く、
  // 各段は PianoSystemCanvas の実高さ分だけ自然に積み上がるため、gap は現状使っていない
  // （将来 gap を再現したくなったら、段コンテナに margin-top を入れる形で対応する）。
  gap?: number;
  initialScoreData?: MeasureData[];
  onScoreDataChange?: (data: MeasureData[]) => void;
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
};

export default function SingleStaff({
  tool,
  scale = 0.86,
  systems = 9,
  measuresPerSystem = 4,
  initialScoreData,
  onScoreDataChange,
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
}: Props) {
  const data = initialScoreData ?? [];
  const handleChange = onScoreDataChange ?? (() => {});

  return (
    <div>
      {Array.from({ length: systems }, (_, i) => {
        const partsConfig: PartConfig[] = [
          {
            clef: 'treble',
            data,
            onChange: handleChange,
          },
        ];
        return (
          <PianoSystemCanvas
            key={i}
            measuresPerSystem={measuresPerSystem}
            tool={tool}
            scale={scale}
            partsConfig={partsConfig}
            showInstrumentLabels={false}
            startMeasureIndex={startMeasureIndex + i * measuresPerSystem}
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
          />
        );
      })}
    </div>
  );
}
