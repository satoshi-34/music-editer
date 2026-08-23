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
import { createDisplayTransposeBridge } from '../utils/displayTransposeUtils';
import { createEmptyMeasures } from '../utils/voiceMeasureUtils';

type Props = {
  tool: Tool;
  scale?: number;
  systems?: number;
  measuresPerSystem?: number;
  instrumentationParts: InstrumentPartDefinition[];
  partsData: MeasureData[][];
  onPartChange: ((data: MeasureData[]) => void)[];
  /**
   * staffCount: 2（大譜表）パートの2段目（低音部）の小節データ。
   * instrumentationParts と同じ添字で対応する。staffCount: 1 のパートの位置は無視される。
   */
  secondStaffPartsData?: MeasureData[][];
  onSecondStaffPartChange?: ((data: MeasureData[]) => void)[];
  startMeasureIndex?: number;
  disabled?: boolean;
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
  // 小節幅の均し具合（0〜1）。「レイアウト」タブのスライダー値を Canvas へ中継する。
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
  // ScorePage からは常に true（2026-08-24 統一）。PianoSystemCanvas 側のコメント参照。
  symbolsClickable?: boolean;
  // 段内の隣接パート間隔への加算補正(px)。「レイアウト」タブの「パート間隔」スライダー
  // （Issue #90）から中継する。省略時・0のときは従来どおり自動値のまま。
  partSpacingOffsetPx?: number;
  /**
   * 段ごとの間隔（上の段との距離）の追加オフセット(px)。systemRanges と同じ並び順の配列で、
   * 各段の直前に marginTop として乗せる（詳細は SingleStaff.tsx 側のコメント参照）。
   */
  systemGapOverridesPx?: number[];
  /**
   * 「空の段でページを満たす」(Issue #41)。SingleStaff.tsx 側のコメント参照。
   */
  emptyFillerRanges?: SystemMeasureRange[];
  onEmptyFillerClick?: (index: number) => void;
  // 印刷プレビュー中は true。PianoSystemCanvas 側のコメント参照（Issue #88）。
  isPrintPreview?: boolean;
  // 小節選択（Issue #110の挿入・削除等で使う）。PianoStaff/SingleStaffと同じ仕組みを
  // 編成譜でも使えるよう中継する（絶対小節インデックスは startMeasureIndex 起点で共通）。
  selectedMeasures?: { start: number; end: number };
  onMeasureSelect?: (absoluteIndex: number, shiftHeld: boolean) => void;
  // ドラッグ範囲選択（PianoSystemCanvas から呼ばれる）をそのまま親へ渡す
  onMeasureRangeSelect?: (startIndex: number, endIndex: number) => void;
  /** 拍範囲スライス選択（#333 段2）。小節選択ドラッグの拍まで見た版（PianoSystemCanvas 参照） */
  onBeatRangeSelect?: (sel: { startMeasure: number; startBeat: number; endMeasure: number; endBeat: number }) => void;
  /**
   * このコンポーネントが譜面の1ページ目を描いているときだけ true（Issue #60）。
   * 浄書の慣習では、総譜の「いちばん最初の段」だけパート名をフル名（Flute）で書き、
   * 以降の段は略称（Fl.）にする。EnsembleStaff はページごとに1つ描画されるため、
   * 「最初の段」かどうかはページ番号と段番号の両方を見ないと判定できない。
   */
  isFirstPage?: boolean;
};

export default function EnsembleStaff({
  tool,
  scale = 0.86,
  systems = 3,
  measuresPerSystem = 4,
  instrumentationParts,
  partsData,
  onPartChange,
  secondStaffPartsData,
  onSecondStaffPartChange,
  startMeasureIndex = 0,
  disabled = false,
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
  partSpacingOffsetPx,
  systemGapOverridesPx,
  emptyFillerRanges,
  onEmptyFillerClick,
  isPrintPreview = false,
  selectedMeasures,
  onMeasureSelect,
  onMeasureRangeSelect,
  onBeatRangeSelect,
  isFirstPage = false,
}: Props) {
  // 記譜音表示は「実音データを見た目だけシフトする」モード。
  // 入力された音符は逆方向にシフトして実音として保存することで、
  // 保存データの正本は常に実音という整合性を保つ。
  const isWrittenMode = notationMode === 'written';
  // partsConfig は staffCount:2 パートを2段へ展開するため、段（スロット）の並び順と
  // instrumentationParts の並び順がずれる。onKeySignatureChange 等で「どの段がどの
  // パート定義に対応するか」を引けるよう、展開後スロット index → 元の part index の
  // 対応表を作っておく。
  const slotToPartIndex: number[] = [];
  instrumentationParts.forEach((part, partIndex) => {
    slotToPartIndex.push(partIndex);
    if (part.staffCount === 2) slotToPartIndex.push(partIndex);
  });
  return (
    // system-stack: ページ内の段を縦方向へ均等配置するためのクラス（App.css 参照）
    <div className="system-stack">
      {Array.from({ length: systemRanges?.length ?? systems }, (_, systemIndex) => {
        // ScorePage が持つ「編成のパート定義」を、描画コンポーネントが理解できる
        // `PartConfig` へ変換する。ここで変換をまとめると、将来パート名表示や
        // 音部記号の扱いを変えるときも EnsembleStaff だけを見ればよくなる。
        const partsConfig: PartConfig[] = instrumentationParts.flatMap((part, partIndex) => {
          const rawData = partsData[partIndex] ?? [];
          // 記譜音表示モードのときだけ、パートの transposition に応じて
          // 表示用に半音シフトしたデータを作る。実音モードでは元データのまま。
          const semitones = isWrittenMode
            ? TRANSPOSITION_WRITTEN_OFFSET_SEMITONES[part.transposition] ?? 0
            : 0;
          // 表示用データ（実音→記譜音）と保存用 onChange（記譜音→実音）は必ず対で必要なので、
          // 共通の createDisplayTransposeBridge でまとめて作る（パート譜側も同じ関数を使う）。
          const { displayMeasures: displayData, handleDisplayChange: wrappedChange } =
            createDisplayTransposeBridge(rawData, onPartChange[partIndex] ?? (() => {}), semitones);
          // 記譜音表示では、音符だけでなく調号もパートごとにずらす。
          // 例: 実音 C メジャー（♭♯なし）→ B♭管は記譜 D メジャー（♯2）。
          // こうしないと、奏者が読む譜面と臨時記号の見え方が食い違う。
          const fifthsShift = isWrittenMode
            ? TRANSPOSITION_WRITTEN_OFFSET_FIFTHS[part.transposition] ?? 0
            : 0;
          const partKey = fifthsShift === 0 ? undefined : shiftKeySignatureByFifths(keySignature, fifthsShift);
          const isGrandStaff = part.staffCount === 2;
          const primaryEntry: PartConfig = {
            clef: part.clef,
            label: part.abbreviation || part.name,
            // 総譜1段目に出すフル名。略称しか登録されていないパートは略称で代用する。
            fullLabel: part.name || part.abbreviation,
            playbackInstrument: part.playbackInstrument,
            // 木管・金管・弦などの楽器グループ識別子。
            // PianoSystemCanvas はこの値が連続するパートをひとまとめにし、
            // 1 本の括弧で囲って描画する（オーケストラ譜の慣習）。
            // 大譜表（2段）パートは、自分の2段を必ずブレースで束ねるため
            // bracketGroup を 'keyboard' に固定する（隣のパートとの見た目上の
            // グループ分けには使わない。ピアノ専用譜面の既定と同じ扱い）。
            bracketGroup: isGrandStaff ? 'keyboard' : part.bracketGroup,
            subBracketGroup: isGrandStaff ? undefined : part.subBracketGroup,
            keySignature: partKey,
            data: displayData,
            onChange: wrappedChange,
          };
          if (!isGrandStaff) {
            return [primaryEntry];
          }

          // 大譜表の2段目（低音部）。移調・調号は1段目と同じパート定義に従う。
          const rawSecondData = secondStaffPartsData?.[partIndex] ?? [];
          const { displayMeasures: displaySecondData, handleDisplayChange: wrappedSecondChange } =
            createDisplayTransposeBridge(rawSecondData, onSecondStaffPartChange?.[partIndex] ?? (() => {}), semitones);
          const secondEntry: PartConfig = {
            clef: 'bass',
            label: undefined,
            playbackInstrument: part.playbackInstrument,
            bracketGroup: 'keyboard',
            subBracketGroup: undefined,
            keySignature: partKey,
            data: displaySecondData,
            onChange: wrappedSecondChange,
          };
          return [primaryEntry, secondEntry];
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
            // 譜面全体でいちばん最初の段（1ページ目の1段目）だけフル名にする（Issue #60）
            showFullInstrumentLabels={isFirstPage && systemIndex === 0}
            startMeasureIndex={systemRanges?.[systemIndex]?.start ?? startMeasureIndex + systemIndex * measuresPerSystem}
            disabled={disabled}
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
              // partIndex は展開後の段（スロット）index のため、slotToPartIndex で
              // 元の instrumentationParts index へ変換してから引く。
              const targetPart = partIndex !== undefined ? instrumentationParts[slotToPartIndex[partIndex]] : undefined;
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
            isPrintPreview={isPrintPreview}
            partSpacingOffsetPx={partSpacingOffsetPx}
            selectedMeasures={selectedMeasures}
            onMeasureSelect={onMeasureSelect}
            onMeasureRangeSelect={onMeasureRangeSelect}
            onBeatRangeSelect={onBeatRangeSelect}
          />
          </div>
        );
      })}
      {emptyFillerRanges?.map((range, i) => (
        // empty-stave-filler: 五線紙のような「空の段」プレースホルダー（Issue #41）。
        // SingleStaff.tsx 側のコメント参照。編成譜も楽器グループの括弧が付いた見た目で
        // プレースホルダーを描けるよう、実際のパート定義（clef/bracketGroup 等）を使い、
        // データだけをローカルの空小節に差し替える。
        <div
          key={`empty-filler-${i}`}
          className="empty-stave-filler"
          role="button"
          tabIndex={0}
          onClick={() => onEmptyFillerClick?.(i)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onEmptyFillerClick?.(i);
            }
          }}
        >
          <PianoSystemCanvas
            measuresPerSystem={range.count}
            tool={tool}
            scale={scale}
            partsConfig={instrumentationParts.flatMap((part) => {
              const isGrandStaff = part.staffCount === 2;
              const primaryEntry: PartConfig = {
                clef: part.clef,
                label: part.abbreviation || part.name,
                playbackInstrument: part.playbackInstrument,
                bracketGroup: isGrandStaff ? 'keyboard' : part.bracketGroup,
                subBracketGroup: isGrandStaff ? undefined : part.subBracketGroup,
                data: createEmptyMeasures(range.count),
                onChange: () => {},
              };
              if (!isGrandStaff) return [primaryEntry];
              // 実データと同じ段数の見た目にそろえる（大譜表パートぶんの空の低音部）。
              const secondEntry: PartConfig = {
                clef: 'bass',
                label: undefined,
                playbackInstrument: part.playbackInstrument,
                bracketGroup: 'keyboard',
                subBracketGroup: undefined,
                data: createEmptyMeasures(range.count),
                onChange: () => {},
              };
              return [primaryEntry, secondEntry];
            })}
            showInstrumentLabels={false}
            startMeasureIndex={0}
            disabled
            currentInstrument={currentInstrument}
            keySignature={keySignature}
            timeSignature={timeSignature}
            plannedMeasureWidths={range.minimumWidths}
            measureWidthEvenness={measureWidthEvenness}
            pageMarginSideMm={pageMarginSideMm}
            partSpacingOffsetPx={partSpacingOffsetPx}
          />
        </div>
      ))}
    </div>
  );
}
