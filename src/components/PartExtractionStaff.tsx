// src/components/PartExtractionStaff.tsx
// ─────────────────────────────────────────────────────────────
// パート譜表示（総譜から1パートだけ抜き出した単一五線表示）用の共通描画コンポーネント。
//
// QuartetStaff は「Vn.I/Vn.II/Va./Vc. の4段固定」を前提に PianoSystemCanvas を
// 呼んでいるため、パートを1つに絞ってもそのままでは4段のまま空段が残ってしまう。
// このコンポーネントは partsConfig を要素数1で PianoSystemCanvas に渡すことで、
// 括弧なし・単一五線のパート譜を作る（描画自体は編成譜と同じ PianoSystemCanvas を流用）。
//
// 編集は View/Print 専用（onChange は常に no-op）にしている。パート譜表示中に
// 元データへ書き戻す経路まで作ると、総譜へ戻したときの整合性検証が増えて
// リスクが高いため、閲覧・印刷用途に絞った（詳細は
// .claude/specs/part-extraction/design.md を参照）。
// ─────────────────────────────────────────────────────────────

import PianoSystemCanvas, { type PartConfig } from './PianoSystemCanvas';
import type { Tool } from './Palette';
import type { MeasureData, TimeSignature, CustomSymbolDef, NoteEvent } from '../types/storage';
import { InstrumentType } from '../audio/SoundSource';
import type { KeySignature } from '../utils/noteKeyUtils';
import type { SystemMeasureRange } from '../utils/measureLayoutUtils';
import type { IncomingArcEntry } from '../utils/incomingArcUtils';

type Props = {
  tool: Tool;
  scale?: number;
  systems?: number;
  measuresPerSystem?: number;
  partConfig: Omit<PartConfig, 'data' | 'onChange'>;
  data: MeasureData[];
  startMeasureIndex?: number;
  yOffset?: number;
  currentInstrument?: InstrumentType;
  onPreviewNoteEvent?: (noteEvent: NoteEvent, instrument?: InstrumentType) => Promise<void>;
  previewAccidentalOnApply?: boolean;
  keySignature?: KeySignature;
  timeSignature?: TimeSignature;
  customSymbolDefs?: CustomSymbolDef[];
  plannedMeasureWidths?: number[];
  systemRanges?: SystemMeasureRange[];
  incomingArcIndex?: Map<number, IncomingArcEntry[]>;
};

// 何も起きない onChange。パート譜表示は閲覧・印刷専用のため、
// 音符クリックなどで内部 state が変わっても元データへは反映しない。
const NOOP_ON_CHANGE = () => {};

export default function PartExtractionStaff({
  tool,
  scale = 0.86,
  systems = 9,
  measuresPerSystem = 4,
  partConfig,
  data,
  startMeasureIndex = 0,
  yOffset = 0,
  currentInstrument = InstrumentType.PIANO,
  onPreviewNoteEvent,
  previewAccidentalOnApply = true,
  keySignature = 'C',
  timeSignature = [4, 4],
  customSymbolDefs, plannedMeasureWidths, systemRanges, incomingArcIndex,
}: Props) {
  return (
    <div>
      {Array.from({ length: systemRanges?.length ?? systems }, (_, i) => {
        const partsConfig: PartConfig[] = [
          {
            ...partConfig,
            data,
            onChange: NOOP_ON_CHANGE,
          },
        ];
        return (
          <PianoSystemCanvas
            key={i}
            measuresPerSystem={systemRanges?.[i]?.count ?? measuresPerSystem}
            tool={tool}
            scale={scale}
            partsConfig={partsConfig}
            showInstrumentLabels={false}
            startMeasureIndex={systemRanges?.[i]?.start ?? startMeasureIndex + i * measuresPerSystem}
            // パート譜表示は常に編集無効（閲覧・印刷専用）
            disabled
            yOffset={yOffset}
            currentInstrument={currentInstrument}
            onPreviewNoteEvent={onPreviewNoteEvent}
            previewAccidentalOnApply={previewAccidentalOnApply}
            keySignature={keySignature}
            timeSignature={timeSignature}
            customSymbolDefs={customSymbolDefs}
            plannedMeasureWidths={systemRanges?.[i]?.minimumWidths ?? plannedMeasureWidths?.slice(i * measuresPerSystem, (i + 1) * measuresPerSystem)}
            incomingArcIndex={incomingArcIndex}
          />
        );
      })}
    </div>
  );
}
