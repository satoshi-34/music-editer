// src/components/UiContextBar.tsx
// Issue #405（段2）: UI案 A1「文脈バー」。
//
// 譜面背景の左上に浮かせて（2026-08-25 実機所感で移設）、「いま どのレイヤーの・
// どのタブで・どのツールを持っているか」を言葉で出す。
// 譜面をクリックしたときに何が起きるかを、押す前に読み取れるようにするのが目的。
//
// この案が有効（`?ui=a1`）なときだけ描画される。対照群（current）では
// この要素自体が存在しないので、既存の見た目は1pxも変わらない。

import { buildContextBarSegments, type ContextBarInput } from '../utils/uiContextBar';

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
