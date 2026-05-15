import PianoSystemCanvas, { type PartConfig } from './PianoSystemCanvas';
import type { Tool } from './Palette';
import type { InstrumentPartDefinition, MeasureData, ScoreNotationMode, TimeSignature } from '../types/storage';
import type { NoteEvent } from '../types/storage';
import { InstrumentType } from '../audio/SoundSource';
import {
  TRANSPOSITION_WRITTEN_OFFSET_FIFTHS,
  TRANSPOSITION_WRITTEN_OFFSET_SEMITONES,
  shiftKeySignatureByFifths,
  transposeKeyBySemitones,
  type KeySignature,
} from '../utils/noteKeyUtils';

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
  /**
   * 編成譜の表示モード。`written` のとき、各パートの音符を
   * `transposition` の半音差ぶんシフトして「奏者が読む譜面」を出す。
   * 表示専用なので、written のときは編集はオフにする。
   */
  notationMode?: ScoreNotationMode;
};

/**
 * 1 パート分の小節データを記譜音表示用にシフトする。
 *
 * 実音データはそのまま保存しておきたいので、ここでは
 * 「表示用の MeasureData」を新しく作って返す。
 * 元データを書き換えないことで、表示モードを戻したときに
 * 元の音高がそのまま復元される。
 */
function transposeMeasuresForDisplay(
  measures: MeasureData[],
  semitones: number
): MeasureData[] {
  if (semitones === 0) {
    return measures;
  }
  return measures.map(measure => ({
    ...measure,
    events: measure.events.map(event => {
      if (event.isRest) {
        return event;
      }
      const shiftedKeys = event.keys.map(key => transposeKeyBySemitones(key, semitones));
      const shiftedArcs = event.arcs?.map(arc => ({
        ...arc,
        fromKey: transposeKeyBySemitones(arc.fromKey, semitones),
        toKey: transposeKeyBySemitones(arc.toKey, semitones),
      }));
      return { ...event, keys: shiftedKeys, arcs: shiftedArcs };
    }),
  }));
}

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
  notationMode = 'concert',
}: Props) {
  // 記譜音表示は「実音データを見た目だけシフトする」モード。
  // 編集まで許すと「画面では D に置いたのに保存は C」のような逆変換が必要になり、
  // 編集ロジック全体に影響が及ぶ。まずは表示専用に限定して安全に出す。
  const isWrittenMode = notationMode === 'written';
  const effectiveDisabled = disabled || isWrittenMode;
  return (
    <div>
      {Array.from({ length: systems }, (_, systemIndex) => {
        // ScorePage が持つ「編成のパート定義」を、描画コンポーネントが理解できる
        // `PartConfig` へ変換する。ここで変換をまとめると、将来パート名表示や
        // 音部記号の扱いを変えるときも EnsembleStaff だけを見ればよくなる。
        const partsConfig: PartConfig[] = instrumentationParts.map((part, partIndex) => {
          const rawData = partsData[partIndex] ?? [];
          // 記譜音表示モードのときだけ、パートの transposition に応じて
          // 表示用に半音シフトしたデータを作る。実音モードでは元データのまま。
          const semitones = isWrittenMode
            ? TRANSPOSITION_WRITTEN_OFFSET_SEMITONES[part.transposition] ?? 0
            : 0;
          const displayData = semitones === 0 ? rawData : transposeMeasuresForDisplay(rawData, semitones);
          // 記譜音表示では、音符だけでなく調号もパートごとにずらす。
          // 例: 実音 C メジャー（♭♯なし）→ B♭管は記譜 D メジャー（♯2）。
          // こうしないと、奏者が読む譜面と臨時記号の見え方が食い違う。
          const fifthsShift = isWrittenMode
            ? TRANSPOSITION_WRITTEN_OFFSET_FIFTHS[part.transposition] ?? 0
            : 0;
          const partKey = fifthsShift === 0 ? undefined : shiftKeySignatureByFifths(keySignature, fifthsShift);
          return {
            clef: part.clef,
            label: part.abbreviation || part.name,
            playbackInstrument: part.playbackInstrument,
            // 木管・金管・弦などの楽器グループ識別子。
            // PianoSystemCanvas はこの値が連続するパートをひとまとめにし、
            // 1 本の括弧で囲って描画する（オーケストラ譜の慣習）。
            bracketGroup: part.bracketGroup,
            keySignature: partKey,
            data: displayData,
            onChange: onPartChange[partIndex] ?? (() => {}),
          };
        });

        return (
          <PianoSystemCanvas
            key={systemIndex}
            measuresPerSystem={measuresPerSystem}
            tool={tool}
            scale={scale}
            partsConfig={partsConfig}
            showInstrumentLabels={systemIndex === 0}
            startMeasureIndex={startMeasureIndex + systemIndex * measuresPerSystem}
            disabled={effectiveDisabled}
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
