// src/components/UiContextBar.tsx
// Issue #405（段2）: UI案 A1「文脈バー」。
//
// ツールバーに1行だけ常設し、「いま どのレイヤーの・どのタブで・どのツールを持っているか」を
// 言葉で出す。譜面をクリックしたときに何が起きるかを、押す前に読み取れるようにするのが目的。
//
// この案が有効（`?ui=a1`）なときだけ描画される。対照群（current）では
// この要素自体が存在しないので、既存の見た目は1pxも変わらない。

import { buildContextBarSegments, type ContextBarInput } from '../utils/uiContextBar';

/**
 * ツールバーの高さ上限に上乗せする量（px）。
 *
 * このバー自体は約27pxだが、狭い幅では上下の余白ぶんも効くので少し多めに取る。
 * ScorePage の高さ計算（resolveToolbarHeight）へ、バーを出すときだけ渡す。
 * 渡さないと実高が上限で切り捨てられ、固定ヘッダーの下へ譜面が潜る
 * （#408 Codex round1 P2）。
 */
export const UI_CONTEXT_BAR_HEIGHT_ALLOWANCE_PX = 44;

type UiContextBarProps = ContextBarInput;

export default function UiContextBar(props: UiContextBarProps) {
  const segments = buildContextBarSegments(props);
  return (
    <div
      className="ui-context-bar"
      data-testid="ui-context-bar"
      // 読み上げ環境でも「何の行か」が分かるように名前を付ける。
      // 中身は操作できない表示専用なので role は付けない（タブやツール本体と混同させない）
      aria-label="いま編集している対象"
    >
      {segments.map((segment, index) => (
        <span className="ui-context-bar-item" key={segment.key} data-context-key={segment.key}>
          {/* 区切りは要素の間だけに置く（先頭に出さない）。CSS が無い環境でも
              「A / B / C」と読めるよう、装飾ではなく文字として入れている */}
          {index > 0 && <span className="ui-context-bar-separator" aria-hidden="true">/</span>}
          <span className="ui-context-bar-caption">{segment.caption}</span>
          <span className="ui-context-bar-value" data-testid={`ui-context-bar-${segment.key}`}>
            {segment.value}
          </span>
        </span>
      ))}
    </div>
  );
}
