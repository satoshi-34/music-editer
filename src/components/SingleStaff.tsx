// src/components/SingleStaff.tsx
// 単旋律譜（1段=1五線）用の編集可能ラッパーコンポーネント。
//
// これまで単旋律譜は StaffCanvas（systems/gap を自分の props として受け取り、
// 1コンポーネント内で複数段をまとめて描画し、段ごとの小節数も自分で自動計算する）
// を使っていたが、印刷ブランチのマージ（自動段割り: systemRanges によって
// 呼び出し側が「各段が何小節を持つか」を事前に決める設計）により、
// 他パート（PianoStaff / QuartetStaff / EnsembleStaff）は「呼び出し側が
// systemRanges をループし、1回の呼び出しで PianoSystemCanvas が1段だけ描く」
// パターンに揃っている。
// SingleStaff もこのパターンに合わせ、PianoStaff の単一パート版として
// PianoSystemCanvas を流用する（props の受け渡し方は PianoStaff.tsx に合わせている）。
// 詳細な調査・移行方針は docs/phase2-staffcanvas-retirement-feasibility.md を参照。
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
  data?: MeasureData[];
  onChange?: (data: MeasureData[]) => void;
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
  // 印刷時に表示する段数。これ以降（内容のない末尾の段）は @media print で非表示になる。
  // 省略時は全段を印刷する。画面表示には影響しない。
  printVisibleSystems?: number;
  plannedMeasureWidths?: number[];
  // 自動段割りの結果（段ごとの開始小節・小節数）。指定時は systems/measuresPerSystem より
  // こちらを優先し、各段をこの範囲で描画する（PianoStaff と同様）。
  systemRanges?: SystemMeasureRange[];
  incomingArcIndex?: Map<number, IncomingArcEntry[]>;
  // 小節幅の均し具合（0〜1）。「その他」タブのスライダー値を Canvas へ中継する。
  measureWidthEvenness?: number;
  /**
   * ページの左右余白(mm)。値そのものは使わず、余白変更時に子の PianoSystemCanvas の
   * 描画 useEffect を確実に再実行させるための依存トリガーとして中継するだけ。
   * 詳細は PianoSystemCanvas.tsx 側のコメントを参照。
   */
  pageMarginSideMm?: number;
  // 終止線を描く「内容のある最後の小節」の絶対インデックス。省略時は終止線を描かない。
  finalMeasureIndex?: number;
  // 演奏記号タブが選択されているときだけ true にする。PianoSystemCanvas 側のコメント参照。
  symbolsClickable?: boolean;
  /**
   * 段ごとの間隔（上の段との距離）の追加オフセット(px)。systemRanges と同じ並び順の配列で、
   * 各段の直前に marginTop として乗せる。その他タブの「段の間隔」設定（全体値）に、
   * この段固有のオフセットを足し込む形で個別調整できるようにするため（詳細は
   * .claude/specs/page-layout-controls/design.md 参照）。省略時・値が0のときは従来どおり。
   */
  systemGapOverridesPx?: number[];
};

export default function SingleStaff({
  tool,
  scale = 0.86,
  systems = 9,
  measuresPerSystem = 4,
  data,
  onChange,
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
  printVisibleSystems, plannedMeasureWidths, systemRanges, incomingArcIndex,
  measureWidthEvenness,
  pageMarginSideMm,
  finalMeasureIndex,
  symbolsClickable,
  systemGapOverridesPx,
}: Props) {
  const scoreData = data ?? [];
  const handleChange = onChange ?? (() => {});

  return (
    // system-stack: ページ内の段を縦方向へ均等配置するためのクラス（App.css 参照）
    <div className="system-stack">
      {Array.from({ length: systemRanges?.length ?? systems }, (_, i) => {
        const partsConfig: PartConfig[] = [
          {
            clef: 'treble',
            data: scoreData,
            onChange: handleChange,
          },
        ];
        // 段ごとの間隔の個別オフセット。0のときは style を付けず従来どおりの見た目にする。
        const gapOverride = systemGapOverridesPx?.[i] ?? 0;
        return (
          // print-hidden-system: 内容のない末尾の段は印刷から除外する（画面では表示）
          <div
            key={i}
            className={printVisibleSystems != null && i >= printVisibleSystems ? 'print-hidden-system' : undefined}
            style={gapOverride !== 0 ? { marginTop: gapOverride } : undefined}
          >
            <PianoSystemCanvas
              measuresPerSystem={systemRanges?.[i]?.count ?? measuresPerSystem}
              tool={tool}
              scale={scale}
              partsConfig={partsConfig}
              showInstrumentLabels={false}
              startMeasureIndex={systemRanges?.[i]?.start ?? startMeasureIndex + i * measuresPerSystem}
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
              plannedMeasureWidths={systemRanges?.[i]?.minimumWidths ?? plannedMeasureWidths?.slice(i * measuresPerSystem, (i + 1) * measuresPerSystem)}
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
