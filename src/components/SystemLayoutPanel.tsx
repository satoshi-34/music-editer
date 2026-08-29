// src/components/SystemLayoutPanel.tsx
// 選択した段の横に出る、レイアウト調整のフローティングパネル（Issue #482）。
//
// 中身は廃止した「段下のコントロール行」と同じ 2 つの調整だけで、入力装置の置き場所を
// 移しただけ（値の意味・保存・Undo の挙動は一切変えない）:
//   - 小節数 ◀ N小節 ▶ … この段が持つ小節数
//   - 間隔 － ±Npx ＋   … 上の段との距離の追加オフセット
// 加えて、数値をクリックすると直接入力できる（拍子・調号などの「途中変更オーバーレイ」と
// 同じ型: autoFocus の入力欄、Enter で確定、Esc で取り消し、フォーカスを外しても確定）。
import { useRef, useState } from 'react';

type Props = {
  /** 見出しに出す段の名前（例: 「段3」） */
  systemLabel: string;
  /** パネルを段のどちら側に出すか。クリックされた端に合わせる */
  side: 'left' | 'right';
  /** この段の先頭小節。data-testid に使う（譜面全体で一意） */
  startMeasure: number;

  measureCount: number;
  /** 直接入力で受け付ける小節数の上限（この段の先頭から内容のある小節までの数） */
  maxMeasureCount: number;
  canDecreaseMeasure: boolean;
  canIncreaseMeasure: boolean;
  /** 小節数を delta ぶん増減する（既存の段下行と同じハンドラを共有する） */
  onMeasureDelta: (delta: number) => void;

  gapPx: number;
  gapMinPx: number;
  gapMaxPx: number;
  gapStepPx: number;
  /** 間隔を delta ぶん増減する（既存の段下行と同じハンドラを共有する） */
  onGapDelta: (delta: number) => void;

  /** Enter・Esc・「×」で段の選択を解除する */
  onClose: () => void;
};

/** 数値の直接入力欄。どちらの項目でも同じ作法（Enter確定 / Esc取消 / blur確定）にする */
function InlineNumberInput({
  defaultValue, min, max, onCommit, onCancel, onClose, testId, label,
}: {
  defaultValue: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  onCancel: () => void;
  /** Enter / Esc のときだけ呼ぶ「段の選択も解除する」処理 */
  onClose: () => void;
  testId: string;
  label: string;
}) {
  // Enter/Esc で確定・取消したあと、入力欄が消えるときの blur でもう一度
  // 確定処理が走るのを防ぐ（増減は「差分」で適用するため、二重に走ると倍動いてしまう）
  const settledRef = useRef(false);
  return (
    <input
      // 開いた瞬間に打ち始められるようにフォーカスを当てる（途中変更オーバーレイと同じ作法）
      autoFocus
      type="number"
      className="system-layout-panel-input"
      min={min}
      max={max}
      defaultValue={defaultValue}
      aria-label={label}
      data-testid={testId}
      // 数値をクリックしてすぐ打ち直せるよう、開いた時点で中身を選択しておく
      // （選択されていないと、既存の値の後ろに打ち足して「820」のような値になる）
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          settledRef.current = true;
          onCommit(Number((e.target as HTMLInputElement).value));
          onClose();
        } else if (e.key === 'Escape') {
          settledRef.current = true;
          onCancel();
          onClose();
        }
        // 譜面側のキー操作（矢印キーでの音符移動など）や、パネルの外側での
        // Enter/Esc（段の選択解除）へ二重に伝わらないよう、ここで止める
        e.stopPropagation();
      }}
      onBlur={(e) => {
        if (settledRef.current) return;
        onCommit(Number(e.target.value));
      }}
    />
  );
}

export default function SystemLayoutPanel({
  systemLabel,
  side,
  startMeasure,
  measureCount,
  maxMeasureCount,
  canDecreaseMeasure,
  canIncreaseMeasure,
  onMeasureDelta,
  gapPx,
  gapMinPx,
  gapMaxPx,
  gapStepPx,
  onGapDelta,
  onClose,
}: Props) {
  // どちらの数値をいま直接入力しているか（null = ボタン操作の状態）
  const [editing, setEditing] = useState<'measures' | 'gap' | null>(null);

  /** 直接入力の確定。値が壊れていたら何もしないで入力欄を閉じるだけにする */
  const commitMeasures = (value: number) => {
    setEditing(null);
    if (!Number.isFinite(value)) return;
    const next = Math.round(value);
    // 増減ハンドラ（既存）を「差分」で呼ぶだけにして、上限・下限やUndoの積み方を
    // ボタン操作と完全に同じ経路へ通す（同じ判定を二重に書かないため）
    if (next !== measureCount) onMeasureDelta(next - measureCount);
  };
  const commitGap = (value: number) => {
    setEditing(null);
    if (!Number.isFinite(value)) return;
    const next = Math.round(value);
    if (next !== gapPx) onGapDelta(next - gapPx);
  };

  return (
    <div
      className={`system-layout-panel system-layout-panel--${side}`}
      // 段の外側クリックでの選択解除（ScorePage）の対象外にする目印
      data-system-select-keep="true"
      data-testid={`system-layout-panel-${startMeasure}`}
      role="group"
      aria-label={`${systemLabel}のレイアウト調整`}
      onKeyDown={(e) => {
        // 入力欄の外（ボタン上など）で押した Enter / Esc はその場で選択解除にする
        if (e.key === 'Enter' || e.key === 'Escape') {
          onClose();
          e.stopPropagation();
        }
      }}
    >
      <span className="system-layout-panel-label">{systemLabel}</span>
      <button
        type="button"
        className="system-layout-panel-button"
        disabled={!canDecreaseMeasure}
        onClick={() => onMeasureDelta(-1)}
        title="この段の末尾の小節を次の段へ送る"
        data-testid={`system-measure-decrease-${startMeasure}`}
      >
        ◀
      </button>
      {editing === 'measures' ? (
        <InlineNumberInput
          defaultValue={measureCount}
          min={1}
          max={maxMeasureCount}
          label="この段の小節数"
          testId={`system-measure-input-${startMeasure}`}
          onCommit={commitMeasures}
          onCancel={() => setEditing(null)}
          onClose={onClose}
        />
      ) : (
        <button
          type="button"
          className="system-layout-panel-value"
          onClick={() => setEditing('measures')}
          title="クリックして小節数を直接入力する"
          data-testid={`system-measure-count-${startMeasure}`}
        >
          {measureCount}小節
        </button>
      )}
      <button
        type="button"
        className="system-layout-panel-button"
        disabled={!canIncreaseMeasure}
        onClick={() => onMeasureDelta(1)}
        title="次の段の先頭の小節をこの段へ引き込む"
        data-testid={`system-measure-increase-${startMeasure}`}
      >
        ▶
      </button>

      <span className="system-layout-panel-label">間隔</span>
      <button
        type="button"
        className="system-layout-panel-button"
        disabled={gapPx <= gapMinPx}
        onClick={() => onGapDelta(-gapStepPx)}
        title="この段の間隔（上の段との距離）を詰める"
        data-testid={`system-gap-decrease-${startMeasure}`}
      >
        －
      </button>
      {editing === 'gap' ? (
        <InlineNumberInput
          defaultValue={gapPx}
          min={gapMinPx}
          max={gapMaxPx}
          label="この段の間隔(px)"
          testId={`system-gap-input-${startMeasure}`}
          onCommit={commitGap}
          onCancel={() => setEditing(null)}
          onClose={onClose}
        />
      ) : (
        <button
          type="button"
          className="system-layout-panel-value"
          onClick={() => setEditing('gap')}
          title="クリックして間隔(px)を直接入力する"
          data-testid={`system-gap-value-${startMeasure}`}
        >
          {gapPx >= 0 ? `+${gapPx}` : gapPx}px
        </button>
      )}
      <button
        type="button"
        className="system-layout-panel-button"
        disabled={gapPx >= gapMaxPx}
        onClick={() => onGapDelta(gapStepPx)}
        title="この段の間隔（上の段との距離）を広げる"
        data-testid={`system-gap-increase-${startMeasure}`}
      >
        ＋
      </button>
      <button
        type="button"
        className="system-layout-panel-button"
        onClick={onClose}
        title="閉じる（Esc / Enter でも閉じる）"
        data-testid={`system-layout-panel-close-${startMeasure}`}
      >
        ×
      </button>
    </div>
  );
}
