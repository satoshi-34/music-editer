import PianoSystemCanvas, { type PartConfig } from './PianoSystemCanvas';
import type { Tool } from './Palette';
import type { InstrumentPartDefinition, MeasureData, ScoreNotationMode, TimeSignature, CustomSymbolDef } from '../types/storage';
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
   * 編集も許可し、入力された音符は実音へ逆変換してから保存する。
   */
  notationMode?: ScoreNotationMode;
  customSymbolDefs?: CustomSymbolDef[];
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
    // 古い保存データや import データでは events が配列でないことがある。
    // ここで落とすと記譜音表示モードのとき編成譜全体が描けなくなるため、
    // 壊れた小節はシフトせずそのまま下流（PianoSystemCanvas の安全化）へ渡す。
    events: Array.isArray(measure.events)
      ? measure.events.map(event => {
      // keys が配列でない壊れた音符は、ここでシフトせず素通りさせる。
      // 最終的な休符フォールバックは描画直前の sanitizeRenderEvent が担う。
      if (event.isRest || !Array.isArray(event.keys)) {
        return event;
      }
      const shiftedKeys = event.keys.map(key => transposeKeyBySemitones(key, semitones));
      const shiftedArcs = event.arcs?.map(arc => ({
        ...arc,
        fromKey: transposeKeyBySemitones(arc.fromKey, semitones),
        toKey: transposeKeyBySemitones(arc.toKey, semitones),
      }));
      return { ...event, keys: shiftedKeys, arcs: shiftedArcs };
        })
      : measure.events,
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
  customSymbolDefs,
}: Props) {
  // 記譜音表示は「実音データを見た目だけシフトする」モード。
  // 入力された音符は逆方向にシフトして実音として保存することで、
  // 保存データの正本は常に実音という整合性を保つ。
  const isWrittenMode = notationMode === 'written';
  return (
    // system-stack: ページ内の段を縦方向へ均等配置するためのクラス（App.css 参照）
    <div className="system-stack">
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
          const upstreamChange = onPartChange[partIndex] ?? (() => {});
          // 記譜音モードでは画面上の音符は記譜音側でやり取りされるため、
          // 保存する前に逆方向（-semitones）にシフトして実音へ戻す。
          // これにより、表示モードを切り替えても保存データは常に実音で一貫する。
          const wrappedChange = semitones === 0
            ? upstreamChange
            : (newDisplayed: MeasureData[]) => upstreamChange(transposeMeasuresForDisplay(newDisplayed, -semitones));
          return {
            clef: part.clef,
            label: part.abbreviation || part.name,
            playbackInstrument: part.playbackInstrument,
            // 木管・金管・弦などの楽器グループ識別子。
            // PianoSystemCanvas はこの値が連続するパートをひとまとめにし、
            // 1 本の括弧で囲って描画する（オーケストラ譜の慣習）。
            bracketGroup: part.bracketGroup,
            subBracketGroup: part.subBracketGroup,
            keySignature: partKey,
            data: displayData,
            onChange: wrappedChange,
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
            disabled={disabled}
            yOffset={yOffset}
            currentInstrument={currentInstrument}
            onPreviewNoteEvent={onPreviewNoteEvent}
            previewAccidentalOnApply={previewAccidentalOnApply}
            keySignature={keySignature}
            timeSignature={timeSignature}
            onKeySignatureChange={(newKey, partIndex) => {
              if (!onKeySignatureChange) return;
              // 記譜音モードでは canvas から「クリックされた段の記譜音側の新しい調号」が返ってくる。
              // 実音側の調号に逆変換してから上に渡すことで、保存される調号は常に実音で一貫する。
              // 実音モードや、移調なしのパートのときは、そのまま渡せばよい。
              const targetPart = partIndex !== undefined ? instrumentationParts[partIndex] : undefined;
              const fifths = isWrittenMode && targetPart
                ? TRANSPOSITION_WRITTEN_OFFSET_FIFTHS[targetPart.transposition] ?? 0
                : 0;
              const concertKey = fifths === 0 ? newKey : shiftKeySignatureByFifths(newKey, -fifths);
              onKeySignatureChange(concertKey);
            }}
            customSymbolDefs={customSymbolDefs}
          />
        );
      })}
    </div>
  );
}
