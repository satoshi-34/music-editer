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
    // 実寸を偽装してから位置を測り直させる（jsdom は高さ 0 を返すため）
    const MENU_HEIGHT = 44;
    menu.getBoundingClientRect = vi.fn(() => ({
      left: 20, right: 275, top: 0, bottom: MENU_HEIGHT, width: 255, height: MENU_HEIGHT, x: 20, y: 0, toJSON: () => ({}),
    })) as unknown as typeof menu.getBoundingClientRect;
    fireEvent(window, new Event('resize'));
    const top = parseFloat(menu.style.top);
    expect(top).toBeGreaterThanOrEqual(8);
    // メニュー**全体**が画面内（下の余白 8px）に収まっている（round2 P3: top だけ見ると
    // 下端がはみ出す実装でも通ってしまう）
    expect(top + MENU_HEIGHT).toBeLessThanOrEqual(window.innerHeight - 8);
  });

  it('描画後の実寸で位置を置き直し、resize でも追従する（見積もりより広いメニュー）', () => {
    const { container, trigger } = renderButton();
    fakeTriggerRect(trigger, { left: window.innerWidth - 20, bottom: 60 });
    fireEvent.click(trigger);
    const menu = openedMenu(container);
    const REAL_WIDTH = estimateVariantMenuWidth(OPTIONS.length) + 120;
    menu.getBoundingClientRect = vi.fn(() => ({
      left: 0, right: REAL_WIDTH, top: 66, bottom: 110, width: REAL_WIDTH, height: 44, x: 0, y: 66, toJSON: () => ({}),
    })) as unknown as typeof menu.getBoundingClientRect;
    fireEvent(window, new Event('resize'));
    // 実寸ぶん左へ寄る（見積もりのままだと右端がはみ出す）
    expect(menu.style.left).toBe(`${window.innerWidth - REAL_WIDTH - 8}px`);
  });

  it('▾ ボタンがスクロールで画面外へ出たら、メニューを画面端に残さず閉じる（round2 P2）', () => {
    const { container, trigger } = renderButton();
    fakeTriggerRect(trigger, { left: 20, bottom: 300 });
    fireEvent.click(trigger);
    openedMenu(container);
    // 縦ツールバーを下へスクロールしてボタンが上へ消えた状態
    fakeTriggerRect(trigger, { left: 20, bottom: -40 });
    fireEvent(window, new Event('scroll'));
    expect(container.querySelector(`[role="group"][aria-label="${MENU_LABEL}"]`)).toBeNull();
  });

  it('▾ ボタンが折りたたみで非表示（矩形 0）になったら閉じる', () => {
    const { container, trigger } = renderButton();
    fakeTriggerRect(trigger, { left: 20, bottom: 300 });
    fireEvent.click(trigger);
    openedMenu(container);
    // 折りたたみは display:none なので checkVisibility が false になる（矩形 0 で判定すると
    // レイアウトの無い jsdom で常に「消えた」扱いになるため、こちらで見る）
    (trigger as unknown as { checkVisibility: () => boolean }).checkVisibility = () => false;
    fireEvent(window, new Event('resize'));
    expect(container.querySelector(`[role="group"][aria-label="${MENU_LABEL}"]`)).toBeNull();
  });

  it('キーボードで部品の外へフォーカスが移ったら閉じる（round2 P2: Tab 移動・折りたたみ）', () => {
    const { container, trigger } = renderButton();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    fakeTriggerRect(trigger, { left: 20, bottom: 300 });
    fireEvent.click(trigger);
    const menu = openedMenu(container);
    // 部品の中（項目）へのフォーカス移動では閉じない
    const firstItem = within(menu).getAllByRole('button')[0];
    fireEvent.focusOut(trigger, { relatedTarget: firstItem });
    expect(container.querySelector(`[role="group"][aria-label="${MENU_LABEL}"]`)).toBeTruthy();
    // 部品の外へ出たら閉じる
    fireEvent.focusOut(firstItem, { relatedTarget: outside });
    expect(container.querySelector(`[role="group"][aria-label="${MENU_LABEL}"]`)).toBeNull();
    outside.remove();
  });

  it('Safari 流の「mousedown で relatedTarget=null の blur」でも、項目クリックが届く（round3 P2）', () => {
    const onSelectVariant = vi.fn();
    const { container, trigger } = renderButton(onSelectVariant);
    fakeTriggerRect(trigger, { left: 20, bottom: 300 });
    fireEvent.click(trigger);
    const menu = openedMenu(container);
    const item = within(menu).getByRole('button', { name: '5連符' });
    // Safari: 項目の mousedown → ▾ から blur（relatedTarget null）→ click の順（WebKit Bug 254655）
    fireEvent.mouseDown(item);
    fireEvent.focusOut(trigger, { relatedTarget: null });
    expect(container.querySelector(`[role="group"][aria-label="${MENU_LABEL}"]`), '閉じていない').toBeTruthy();
    fireEvent.mouseUp(item);
    fireEvent.click(item);
    expect(onSelectVariant).toHaveBeenCalledWith('5');
    expect(container.querySelector(`[role="group"][aria-label="${MENU_LABEL}"]`)).toBeNull();
    // 押下が部品の外で始まった null blur は従来どおり閉じる
    fireEvent.click(trigger);
    openedMenu(container);
    fireEvent.focusOut(trigger, { relatedTarget: null });
    expect(container.querySelector(`[role="group"][aria-label="${MENU_LABEL}"]`)).toBeNull();
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
