// Issue #569 round1 の差し戻し3点（共通部品 ToolVariantButton の作り）を固定するテスト。
//
//   P1: プルダウンを `position: absolute` で出すと、親の `.toolbar-panel`
//       （`overflow-x: auto`。左＝縦配置では `overflow-x: hidden`）に切られて
//       項目の大半が見えなくなる。既存のリセットメニューと同じ
//       「fixed + ボタンの実測位置 + ビューポート内クランプ」になっていることを確かめる
//   P2: `aria-haspopup="menu"` と中身（role="group"）の食い違いを無くしたこと
//   P2: 項目選択・Escape のあと ▾ ボタンへフォーカスが戻ること
//
// 位置の検証に実クリックの配線テストを使えないのは、テストのクリックが
// 「画面から切られて見えない要素」でも届いてしまい、この不備を素通りさせるため。
// ここではボタンの矩形を偽装して、計算された座標そのものを見る。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';

import ToolVariantButton, { type ToolVariantOption } from './ToolVariantButton';
import { estimateVariantMenuWidth } from '../utils/toolbarPlacement';

/** パレット側から渡ってくる共通ボタンスタイルの代役（見た目は問わないので最小限） */
const buttonStyle = (active: boolean, extra?: React.CSSProperties): React.CSSProperties => ({
  width: 36, height: 30, border: active ? '2px solid #333' : '1px solid #ccc', ...extra,
});

const OPTIONS: ToolVariantOption[] = [2, 3, 4, 5, 6, 7].map((n) => ({
  key: String(n),
  symbol: `${n}連符`,
  ariaLabel: `${n}連符`,
  title: `${n}連符`,
}));

const MENU_LABEL = '連符の種類を選ぶ';

function renderButton(onSelectVariant = vi.fn()) {
  const view = render(
    <ToolVariantButton
      options={OPTIONS}
      currentKey="3"
      active={false}
      onActivate={vi.fn()}
      onSelectVariant={onSelectVariant}
      menuAriaLabel={MENU_LABEL}
      buttonStyle={buttonStyle}
    />
  );
  const trigger = view.container.querySelector(`button[aria-label="${MENU_LABEL}"]`) as HTMLButtonElement;
  expect(trigger, '▾ ボタン').toBeTruthy();
  return { ...view, trigger };
}

/** ▾ ボタンの画面上の位置を偽装する（jsdom は実際のレイアウトをしないため） */
function fakeTriggerRect(trigger: HTMLElement, rect: { left: number; bottom: number }) {
  trigger.getBoundingClientRect = vi.fn(() => ({
    left: rect.left, right: rect.left + 14, top: rect.bottom - 30, bottom: rect.bottom,
    width: 14, height: 30, x: rect.left, y: rect.bottom - 30, toJSON: () => ({}),
  })) as unknown as typeof trigger.getBoundingClientRect;
}

function openedMenu(container: HTMLElement): HTMLElement {
  const menu = container.querySelector(`[role="group"][aria-label="${MENU_LABEL}"]`) as HTMLElement | null;
  expect(menu, 'プルダウン').toBeTruthy();
  return menu!;
}

describe('ToolVariantButton のプルダウンの出し方（#569 round1）', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('親パネルの overflow に切られないよう fixed で描き、ボタンの実測位置に合わせる', () => {
    const { container, trigger } = renderButton();
    fakeTriggerRect(trigger, { left: 100, bottom: 60 });
    fireEvent.click(trigger);

    const menu = openedMenu(container);
    // `absolute` だと `.toolbar-panel` の overflow に切られる（差し戻しの理由そのもの）
    expect(menu.style.position).toBe('fixed');
    // ボタンの下 6px に出る（リセットメニューと同じ間隔）
    expect(menu.style.top).toBe('66px');
    expect(menu.style.left).toBe('100px');
  });

  it('画面の右端に近いボタンから開いても、メニュー全体が画面内に収まる（左へ寄せる）', () => {
    const { container, trigger } = renderButton();
    // 横1行のツールバーでは、連符ボタンが右端近くまで押し出されることがある
    fakeTriggerRect(trigger, { left: window.innerWidth - 20, bottom: 60 });
    fireEvent.click(trigger);

    const menu = openedMenu(container);
    const menuWidth = estimateVariantMenuWidth(OPTIONS.length);
    expect(menu.style.left).toBe(`${window.innerWidth - menuWidth - 8}px`);
    // 右端が画面内（余白8px）に収まっている＝6項目すべて見える
    expect(parseFloat(menu.style.left) + menuWidth).toBeLessThanOrEqual(window.innerWidth - 8);
  });

  it('左（縦）配置で画面下部のボタンから開いても、メニューが画面外へ出ない（上へずらす）', () => {
    const { container, trigger } = renderButton();
    // 縦ツールバーは上から下まで伸びるので、連符ボタンが画面の底近くに来る
    fakeTriggerRect(trigger, { left: 20, bottom: window.innerHeight - 8 });
    fireEvent.click(trigger);

    const menu = openedMenu(container);
    const top = parseFloat(menu.style.top);
    expect(top).toBeGreaterThanOrEqual(8);
    // メニューの高さぶんの余地が画面下に残っている
    expect(top).toBeLessThanOrEqual(window.innerHeight - 8);
    expect(top).toBeLessThan(window.innerHeight - 8);
  });

  it('▾ の名乗りと中身が食い違わない（aria-haspopup="menu" を付けない）', () => {
    const { container, trigger } = renderButton();
    expect(trigger.getAttribute('aria-haspopup')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // 中身は「並んだボタンの塊」。role="menu" ではないので menuitem も要らない
    expect(openedMenu(container).querySelectorAll('button').length).toBe(OPTIONS.length);
  });

  it('項目を選んで閉じたあと、フォーカスが ▾ ボタンへ戻る', () => {
    const onSelectVariant = vi.fn();
    const { container, trigger } = renderButton(onSelectVariant);
    fireEvent.click(trigger);
    fireEvent.click(within(openedMenu(container)).getByRole('button', { name: '5連符' }));

    expect(onSelectVariant).toHaveBeenCalledWith('5');
    // 戻さないとフォーカスが文書の先頭へ落ち、キーボード利用者が現在地を見失う
    expect(document.activeElement).toBe(trigger);
  });

  it('Escape で閉じたときもフォーカスが ▾ ボタンへ戻る', () => {
    const { container, trigger } = renderButton();
    fireEvent.click(trigger);
    const menu = openedMenu(container);
    fireEvent.keyDown(menu, { key: 'Escape' });

    expect(container.querySelector(`[role="group"][aria-label="${MENU_LABEL}"]`)).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
