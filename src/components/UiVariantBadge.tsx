// src/components/UiVariantBadge.tsx
// Issue #405（段1）: いまどのUI案が有効かを画面の隅に小さく出す表示。
//
// テスト会では「詰まった場面がどの案のときだったか」を後から突き合わせたい。
// 画面の隅に常に出しておけば、写真や録画からでも案を特定できる。
// 対照群の `current` でも出す（出ている案と出ていない案があると、
// 「表示があること自体」が違いになってしまうため）。
//
// 表示するだけで操作はできない。切り替えはURLの `?ui=` で行う。

import { UI_VARIANT_LABELS, type UiVariant } from '../utils/uiVariant';

interface UiVariantBadgeProps {
  variant: UiVariant;
}

export default function UiVariantBadge({ variant }: UiVariantBadgeProps) {
  return (
    <div className="ui-variant-badge" data-testid="ui-variant-badge" data-ui-variant={variant}>
      UI案: {UI_VARIANT_LABELS[variant]}
    </div>
  );
}
