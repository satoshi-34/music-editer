// 文脈バー（Issue #405 案A1）が使うラベルのテスト。
//
// レイヤー切替チップと文脈バーで同じ言葉になっていないと、
// 「今どこにいるか」を伝えるという目的そのものが崩れる。
import { describe, it, expect } from 'vitest';
import { pianoLayerLabel } from './editorContextLabels';

describe('pianoLayerLabel', () => {
  it('編集できる4つの組み合わせは、レイヤー切替チップと同じ言葉になる', () => {
    expect(pianoLayerLabel(0, 0)).toBe('右手・声部1');
    expect(pianoLayerLabel(0, 1)).toBe('右手・声部2');
    expect(pianoLayerLabel(1, 0)).toBe('左手・声部1');
    expect(pianoLayerLabel(1, 1)).toBe('左手・声部2');
  });

  // 現在の編集UIは声部2までだが、表示・再生・書き出しは声部3以降も扱う。
  // 手の呼び名（右手/左手）は分かっているので、そこは保ったまま声部だけ数字にする
  // （「パート1」に落とすと手の情報が消える・#408 Codex round1 P3）
  it('声部3以降でも手の呼び名は保つ', () => {
    expect(pianoLayerLabel(0, 2)).toBe('右手・声部3');
    expect(pianoLayerLabel(1, 3)).toBe('左手・声部4');
  });

  it('ピアノ譜に無いパート番号でも空欄にしない', () => {
    expect(pianoLayerLabel(5, 0)).toBe('パート6・声部1');
  });
});
