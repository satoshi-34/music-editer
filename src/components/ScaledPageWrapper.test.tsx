// src/components/ScaledPageWrapper.test.tsx
// transform: scale ベースのページ縮小（issue #13 対応）で、
// ラッパーの高さが「ページ実測高さ × scale」になることを確認する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import ScaledPageWrapper from './ScaledPageWrapper';

// ResizeObserver のコールバックをテストから直接呼べるようにするモック。
// jsdom には ResizeObserver がないため、実装の差し替えが必要。
let resizeCallback: ResizeObserverCallback | null = null;

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom はレイアウトを行わないため offsetHeight が常に 0 になる。
// テストごとに任意の値を返せるよう、prototype の getter を差し替える。
let mockOffsetHeight = 0;
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

describe('ScaledPageWrapper', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    resizeCallback = null;
    mockOffsetHeight = 0;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => mockOffsetHeight,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    }
  });

  it('子要素を .page-wrapper の中に描画する', () => {
    render(
      <ScaledPageWrapper scale={0.8}>
        <section className="print-page" data-testid="page">ページ内容</section>
      </ScaledPageWrapper>
    );

    const page = screen.getByTestId('page');
    expect(page).toBeInTheDocument();
    expect(page.parentElement).toHaveClass('page-wrapper');
  });

  it('ページの実測高さ × scale をラッパーの高さに設定する', () => {
    // A4 高さ相当（297mm ≒ 1122px）を実測値として返す
    mockOffsetHeight = 1122;

    render(
      <ScaledPageWrapper scale={0.8}>
        <section className="print-page" data-testid="page">ページ内容</section>
      </ScaledPageWrapper>
    );

    const wrapper = screen.getByTestId('page').parentElement as HTMLElement;
    // 1122 × 0.8 = 897.6px
    expect(wrapper.style.height).toBe('897.6px');
  });

  it('実測高さが 0（jsdom 等の未レイアウト環境）のときはインライン高さを設定しない', () => {
    mockOffsetHeight = 0;

    render(
      <ScaledPageWrapper scale={0.8}>
        <section className="print-page" data-testid="page">ページ内容</section>
      </ScaledPageWrapper>
    );

    const wrapper = screen.getByTestId('page').parentElement as HTMLElement;
    // CSS フォールバック（calc(297mm * var(--scale))）に任せる
    expect(wrapper.style.height).toBe('');
  });

  it('ページ高さの変化に ResizeObserver で追従する', () => {
    mockOffsetHeight = 1122;

    render(
      <ScaledPageWrapper scale={0.5}>
        <section className="print-page" data-testid="page">ページ内容</section>
      </ScaledPageWrapper>
    );

    const wrapper = screen.getByTestId('page').parentElement as HTMLElement;
    expect(wrapper.style.height).toBe('561px');

    // 段数が増えてページが伸びたケースを想定して高さを変え、Observer 経由で通知する
    mockOffsetHeight = 2000;
    act(() => {
      resizeCallback?.([], new MockResizeObserver(() => {}) as unknown as ResizeObserver);
    });

    expect(wrapper.style.height).toBe('1000px');
  });
});
