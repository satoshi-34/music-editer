// src/components/UiVariantBadge.test.tsx
// Issue #405（段1）: 隅の表示が「どの案か」を言葉で出していることを固定する。

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import UiVariantBadge from './UiVariantBadge';

describe('UiVariantBadge', () => {
  it.each([
    ['current', '現状'],
    ['a1', 'A1 文脈バー'],
    ['a2', 'A2 譜面側'],
  ] as const)('%s のとき「%s」と表示する', (variant, label) => {
    render(<UiVariantBadge variant={variant} />);
    const badge = screen.getByTestId('ui-variant-badge');
    expect(badge).toHaveTextContent(`UI案: ${label}`);
    // 観察記録の突き合わせ用に、案の識別子も属性で持たせる
    expect(badge).toHaveAttribute('data-ui-variant', variant);
  });

  it('対照群（current）でも表示する（表示の有無自体が案の違いにならないように）', () => {
    render(<UiVariantBadge variant="current" />);
    expect(screen.getByTestId('ui-variant-badge')).toBeInTheDocument();
  });
});
