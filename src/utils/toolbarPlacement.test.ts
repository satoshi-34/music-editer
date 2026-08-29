// ツールバー配置（上／左）の決め方のテスト（Issue #483）。
//
// ここで守りたいのは3点:
// - 既定は従来どおり「上」で、壊れた保存値でも「上」に落ちる（受入条件5の土台）
// - 狭い画面では左を選んでいても「上」へ戻る（実装メモの判断）
// - 幅の丸めが効く（暴走した実測値で譜面が画面外へ押し出されない）
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DEFAULT_TOOLBAR_PLACEMENT,
  TOOLBAR_LEFT_MIN_VIEWPORT_WIDTH_PX,
  TOOLBAR_PLACEMENT_KEY,
  TOOLBAR_WIDTH_MAX_PX,
  TOOLBAR_WIDTH_MIN_COLLAPSED_PX,
  TOOLBAR_WIDTH_MIN_PX,
  isToolbarPlacement,
  loadStoredToolbarPlacement,
  resolveEffectiveToolbarPlacement,
  resolveToolbarWidth,
  saveToolbarPlacement,
} from './toolbarPlacement';

describe('isToolbarPlacement', () => {
  it('top / left だけを受け付ける', () => {
    expect(isToolbarPlacement('top')).toBe(true);
    expect(isToolbarPlacement('left')).toBe(true);
    expect(isToolbarPlacement('right')).toBe(false);
    expect(isToolbarPlacement(null)).toBe(false);
  });
});

describe('保存値の読み書き', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('未保存なら既定（上）', () => {
    expect(loadStoredToolbarPlacement()).toBe(DEFAULT_TOOLBAR_PLACEMENT);
    expect(DEFAULT_TOOLBAR_PLACEMENT).toBe('top');
  });

  it('保存した値を読み戻せる（次回起動時も維持される・受入条件2）', () => {
    saveToolbarPlacement('left');
    expect(localStorage.getItem(TOOLBAR_PLACEMENT_KEY)).toBe('left');
    expect(loadStoredToolbarPlacement()).toBe('left');
  });

  it('壊れた保存値は既定（上）に落とす', () => {
    localStorage.setItem(TOOLBAR_PLACEMENT_KEY, 'diagonal');
    expect(loadStoredToolbarPlacement()).toBe('top');
  });

  it('localStorage が使えなくても例外を投げない', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadStoredToolbarPlacement()).toBe('top');
    expect(() => saveToolbarPlacement('left')).not.toThrow();
  });
});

describe('resolveEffectiveToolbarPlacement', () => {
  it('上を選んでいれば画面幅によらず上', () => {
    expect(resolveEffectiveToolbarPlacement({ placement: 'top', viewportWidth: 1920 })).toBe('top');
    expect(resolveEffectiveToolbarPlacement({ placement: 'top', viewportWidth: 320 })).toBe('top');
  });

  it('十分広い画面では左をそのまま使う', () => {
    expect(
      resolveEffectiveToolbarPlacement({
        placement: 'left',
        viewportWidth: TOOLBAR_LEFT_MIN_VIEWPORT_WIDTH_PX,
      })
    ).toBe('left');
  });

  it('狭い画面では左を選んでいても上へ戻す', () => {
    expect(
      resolveEffectiveToolbarPlacement({
        placement: 'left',
        viewportWidth: TOOLBAR_LEFT_MIN_VIEWPORT_WIDTH_PX - 1,
      })
    ).toBe('top');
  });

  it('幅が測れないときは安全側の上にする', () => {
    expect(resolveEffectiveToolbarPlacement({ placement: 'left', viewportWidth: Number.NaN })).toBe('top');
  });
});

describe('resolveToolbarWidth', () => {
  it('妥当な実測値はそのまま使う', () => {
    expect(resolveToolbarWidth(260, { collapsed: false })).toBe(260);
  });

  it('狭すぎる実測値は下限へ丸める', () => {
    expect(resolveToolbarWidth(0, { collapsed: false })).toBe(TOOLBAR_WIDTH_MIN_PX);
  });

  it('折り畳み中は下限が下がる（隠したぶんの余白が返る・受入条件6）', () => {
    expect(resolveToolbarWidth(0, { collapsed: true })).toBe(TOOLBAR_WIDTH_MIN_COLLAPSED_PX);
  });

  it('広すぎる実測値は上限で止める（暴走値で譜面が画面外へ出ない）', () => {
    expect(resolveToolbarWidth(9999, { collapsed: false })).toBe(TOOLBAR_WIDTH_MAX_PX);
  });

  it('数値にならない実測値は下限にする（--toolbar-w: NaNpx を防ぐ）', () => {
    expect(resolveToolbarWidth(Number.NaN, { collapsed: false })).toBe(TOOLBAR_WIDTH_MIN_PX);
  });
});
