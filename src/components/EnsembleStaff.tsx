import PianoSystemCanvas, { type PartConfig } from './PianoSystemCanvas';
import type { Tool } from './Palette';
import type { InstrumentPartDefinition, MeasureData, ScoreNotationMode, TimeSignature, CustomSymbolDef } from '../types/storage';
import type { NoteEvent } from '../types/storage';
import { InstrumentType } from '../audio/SoundSource';
import {
  TRANSPOSITION_WRITTEN_OFFSET_FIFTHS,
  TRANSPOSITION_WRITTEN_OFFSET_SEMITONES,
  shiftKeySignatureByFifths,
  type KeySignature,
} from '../utils/noteKeyUtils';
import type { SystemMeasureRange } from '../utils/measureLayoutUtils';
import type { IncomingArcEntry } from '../utils/incomingArcUtils';
import { transposeMeasuresForDisplay } from '../utils/displayTransposeUtils';

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
  // 印刷時に表示する段数。これ以降（内容のない末尾の段）は @media print で非表示になる。
  // 省略時は全段を印刷する。画面表示には影響しない。
  printVisibleSystems?: number;
  plannedMeasureWidths?: number[];
  systemRanges?: SystemMeasureRange[];
  incomingArcIndex?: Map<number, IncomingArcEntry[]>;
  // 小節幅の均し具合（0〜1）。「その他」タブのスライダー値を Canvas へ中継する。
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
  /**
   * 段ごとの間隔（上の段との距離）の追加オフセット(px)。systemRanges と同じ並び順の配列で、
   * 各段の直前に marginTop として乗せる（詳細は SingleStaff.tsx 側のコメント参照）。
   */
  systemGapOverridesPx?: number[];
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
  notationMode = 'concert',
  customSymbolDefs,
  printVisibleSystems, plannedMeasureWidths, systemRanges, incomingArcIndex,
  measureWidthEvenness,
  pageMarginSideMm,
  finalMeasureIndex,
  symbolsClickable,
  systemGapOverridesPx,
}: Props) {
  // 記譜音表示は「実音データを見た目だけシフトする」モード。
  // 入力された音符は逆方向にシフトして実音として保存することで、
  // 保存データの正本は常に実音という整合性を保つ。
  const isWrittenMode = notationMode === 'written';
  return (
    // system-stack: ページ内の段を縦方向へ均等配置するためのクラス（App.css 参照）
    <div className="system-stack">
      {Array.from({ length: systemRanges?.length ?? systems }, (_, systemIndex) => {
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

        const gapOverride = systemGapOverridesPx?.[systemIndex] ?? 0;
        return (
          // print-hidden-system: 内容のない末尾の段は印刷から除外する（画面では表示）
          <div
            key={systemIndex}
            className={printVisibleSystems != null && systemIndex >= printVisibleSystems ? 'print-hidden-system' : undefined}
            style={gapOverride !== 0 ? { marginTop: gapOverride } : undefined}
          >
          <PianoSystemCanvas
            measuresPerSystem={systemRanges?.[systemIndex]?.count ?? measuresPerSystem}
            tool={tool}
            scale={scale}
            partsConfig={partsConfig}
            showInstrumentLabels={systemIndex === 0}
            startMeasureIndex={systemRanges?.[systemIndex]?.start ?? startMeasureIndex + systemIndex * measuresPerSystem}
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
            plannedMeasureWidths={systemRanges?.[systemIndex]?.minimumWidths ?? plannedMeasureWidths?.slice(systemIndex * measuresPerSystem, (systemIndex + 1) * measuresPerSystem)}
            incomingArcIndex={incomingArcIndex}
            measureWidthEvenness={measureWidthEvenness}
            pageMarginSideMm={pageMarginSideMm}
            finalMeasureIndex={finalMeasureIndex}
            symbolsClickable={symbolsClickable}
          />
          </div>
        );
      })}
    </div>
  );
}
