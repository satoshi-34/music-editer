// 編集ログの本番ガードのテスト。DEV=false では console に何も出さない
// （利用者のコンソールを開発情報で汚さない・情報も漏らさない）
import { describe, it, expect, vi, afterEach } from 'vitest';
import { logEditOp, logRenderPass } from './editDebugLog';

describe('editDebugLog', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('本番ビルド相当（DEV=false）では何も出さない', () => {
    vi.stubEnv('DEV', false);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logEditOp('テスト', { a: 1 });
    logRenderPass({ b: 2 });
    expect(infoSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('開発時は [編集] / [描画] の接頭辞つきで出る', () => {
    vi.stubEnv('DEV', true);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logEditOp('クリック', { part: 0 });
    logRenderPass({ n: 1 });
    expect(String(infoSpy.mock.calls[0][0])).toContain('[編集] クリック');
    expect(String(debugSpy.mock.calls[0][0])).toContain('[描画]');
  });
});
