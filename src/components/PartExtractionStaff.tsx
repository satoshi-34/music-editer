// src/components/PartExtractionStaff.tsx
// ─────────────────────────────────────────────────────────────
// パート譜表示（総譜から1パートだけ抜き出した単一五線表示）用の共通描画コンポーネント。
//
// QuartetStaff は「Vn.I/Vn.II/Va./Vc. の4段固定」を前提に PianoSystemCanvas を
// 呼んでいるため、パートを1つに絞ってもそのままでは4段のまま空段が残ってしまう。
// このコンポーネントは partsConfig を要素数1で PianoSystemCanvas に渡すことで、
// 括弧なし・単一五線のパート譜を作る（描画自体は編成譜と同じ PianoSystemCanvas を流用）。
//
// Issue #111 で音符の入力・削除だけ編集できるようになった。onChange を受け取ると
// そのまま上位（ScorePage）の総譜データへ書き戻す（パート譜は総譜の派生ビューで、
// 別データを持たない）。onChange を渡さない・disabled のときは従来どおり
// 閲覧・印刷専用として振る舞う（詳細は
// .claude/specs/part-extraction/design.md を参照）。
// ─────────────────────────────────────────────────────────────

import PianoSystemCanvas, { type PartConfig } from './PianoSystemCanvas';
import type { Tool } from './Palette';
import type { MeasureData, TimeSignature, CustomSymbolDef, NoteEvent } from '../types/storage';
import { InstrumentType } from '../audio/SoundSource';
import type { KeySignature } from '../utils/noteKeyUtils';
import type { SystemMeasureRange } from '../utils/measureLayoutUtils';
import type { IncomingArcEntry } from '../utils/incomingArcUtils';
import { createDisplayTransposeBridge } from '../utils/displayTransposeUtils';

type Props = {
  tool: Tool;
  scale?: number;
  systems?: number;
  measuresPerSystem?: number;
  partConfig: Omit<PartConfig, 'data' | 'onChange'>;
  data: MeasureData[];
  /**
   * 音符の入力・削除を上位（総譜データ）へ書き戻すハンドラ（Issue #111）。
   * 省略すると従来どおり閲覧・印刷専用になる。
   */
  onChange?: (measures: MeasureData[]) => void;
  /** true の間は編集不可（再生中・印刷プレビュー中・編集対象外のパートなど） */
  disabled?: boolean;
  /**
   * 記譜音表示のための半音シフト量（実音 → 記譜音 の向き）。
   * 0 なら実音のまま。0 以外なら表示を +semitones、保存を -semitones して
   * 「保存データの正本は常に実音」を保つ（EnsembleStaff と同じ共通関数を使う）。
   */
  transpositionSemitones?: number;
  startMeasureIndex?: number;
  currentInstrument?: InstrumentType;
  onPreviewNoteEvent?: (noteEvent: NoteEvent, instrument?: InstrumentType) => Promise<void>;
  previewAccidentalOnApply?: boolean;
  keySignature?: KeySignature;
  timeSignature?: TimeSignature;
  customSymbolDefs?: CustomSymbolDef[];
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
  // 段内の隣接パート間隔への加算補正(px)。「レイアウト」タブの「パート間隔」スライダー
  // （Issue #90）から中継する。パート譜表示は常に1段のため見た目には影響しないが、
  // 他の Staff ラッパーと同じ props 形状にそろえるために受け取る。
  partSpacingOffsetPx?: number;
};

// 何も起きない onChange。onChange を渡さない（閲覧・印刷専用の）呼び出し元のための既定値。
const NOOP_ON_CHANGE = () => {};

export default function PartExtractionStaff({
  tool,
  scale = 0.86,
  systems = 9,
  measuresPerSystem = 4,
  partConfig,
  data,
  onChange,
  disabled = false,
  transpositionSemitones = 0,
  startMeasureIndex = 0,
  currentInstrument = InstrumentType.PIANO,
  onPreviewNoteEvent,
  previewAccidentalOnApply = true,
  keySignature = 'C',
  timeSignature = [4, 4],
  customSymbolDefs, plannedMeasureWidths, systemRanges, incomingArcIndex,
  measureWidthEvenness,
  pageMarginSideMm,
  finalMeasureIndex,
  partSpacingOffsetPx,
}: Props) {
  // 表示用データ（実音→記譜音）と保存用 onChange（記譜音→実音）を対で作る。
  // 総譜側（EnsembleStaff）とまったく同じ共通関数を通すことで、移調の向きが
  // 総譜とパート譜で食い違う事故を防ぐ（Issue #111）。
  const { displayMeasures, handleDisplayChange } = createDisplayTransposeBridge(
    data,
    onChange ?? NOOP_ON_CHANGE,
    transpositionSemitones,
  );
  return (
    <div>
      {Array.from({ length: systemRanges?.length ?? systems }, (_, i) => {
        const partsConfig: PartConfig[] = [
          {
            ...partConfig,
            data: displayMeasures,
            onChange: handleDisplayChange,
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
            disabled={disabled}
            currentInstrument={currentInstrument}
            onPreviewNoteEvent={onPreviewNoteEvent}
            previewAccidentalOnApply={previewAccidentalOnApply}
            keySignature={keySignature}
            timeSignature={timeSignature}
            customSymbolDefs={customSymbolDefs}
            plannedMeasureWidths={systemRanges?.[i]?.minimumWidths ?? plannedMeasureWidths?.slice(i * measuresPerSystem, (i + 1) * measuresPerSystem)}
            incomingArcIndex={incomingArcIndex}
            measureWidthEvenness={measureWidthEvenness}
            pageMarginSideMm={pageMarginSideMm}
            finalMeasureIndex={finalMeasureIndex}
            partSpacingOffsetPx={partSpacingOffsetPx}
          />
        );
      })}
    </div>
  );
}
