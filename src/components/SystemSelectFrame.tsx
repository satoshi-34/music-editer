// src/components/SystemSelectFrame.tsx
// 段（システム）1つぶんの外枠。段の左右端に「掴みしろ」を置き、クリックで
// その段を選択状態にする（Issue #482 = #450 の実装段階1）。
//
// これまで段ごとの小節数・間隔の調整UIは「段の下に常設の行」として譜面上に置いていたが、
// 譜面（紙面）に編集用の行がずっと居座るのは不自然、というフィードバックを受けて
// 「必要なときだけ段の横に出るフローティングパネル」へ移設した。
// このコンポーネントは4種類の譜面（SingleStaff / PianoStaff / QuartetStaff /
// EnsembleStaff）が共通で使う段のラッパーで、以前それぞれが持っていた
// 「print-hidden-system の付与 + 段ごとの間隔 marginTop」もここへまとめてある
// （同じ見た目のラッパーを4か所に複製しないため）。
import type { CSSProperties, ReactNode } from 'react';

type Props = {
  /** この段の先頭小節の絶対インデックス。段を一意に指す鍵で、未指定なら選択できない段（空の段など） */
  startMeasure?: number;
  /** 譜面全体での段の通し番号（1始まり）。当たり判定の読み上げ名に使う */
  systemNumber?: number;
  /** いま選択されている段の先頭小節。null は「どの段も選択していない」 */
  selectedSystemStart?: number | null;
  /** 左右端がクリックされたときに呼ばれる。渡されないときは当たり判定自体を描かない */
  onSelect?: (startMeasure: number, side: 'left' | 'right') => void;
  /** 選択中の段にだけ描くフローティングパネル。中身は呼び出し側（ScorePage）が組み立てる */
  renderPanel?: (startMeasure: number) => ReactNode;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

export default function SystemSelectFrame({
  startMeasure,
  systemNumber,
  selectedSystemStart = null,
  onSelect,
  renderPanel,
  className,
  style,
  children,
}: Props) {
  const selectable = startMeasure != null && onSelect != null;
  const selected = selectable && selectedSystemStart === startMeasure;
  // 選択枠は「薄い枠」（控えめな表示）にとどめる指定なので、クラスの付け外しだけで表現する
  const classNames = ['system-select-frame'];
  if (selected) classNames.push('system-select-frame--selected');
  if (className) classNames.push(className);

  return (
    <div
      className={classNames.join(' ')}
      style={style}
      data-testid={startMeasure != null ? `system-frame-${startMeasure}` : undefined}
    >
      {children}
      {selectable && (['left', 'right'] as const).map((side) => (
        // 当たり判定は五線の左右端（音部記号の手前／終止線の外〜ページ余白）に置く。
        // 音符が来ない場所なので、譜面への入力クリックと物理的に衝突しない
        // （実際の位置・幅は App.css の .system-select-edge を参照）。
        <button
          key={side}
          type="button"
          className={`system-select-edge system-select-edge--${side}`}
          // 段の外側をクリックしたら選択解除する仕組み（ScorePage）が、
          // 「この要素は選択解除の対象外」と判定するための目印
          data-system-select-keep="true"
          data-testid={`system-select-${side}-${startMeasure}`}
          aria-label={`段${systemNumber ?? ''}を選択してレイアウトを調整`}
          title={`段${systemNumber ?? ''}を選択してレイアウトを調整`}
          onClick={() => onSelect!(startMeasure!, side)}
        />
      ))}
      {selected && renderPanel?.(startMeasure!)}
    </div>
  );
}
