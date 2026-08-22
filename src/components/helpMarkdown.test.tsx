// アプリ内ヘルプの簡易 markdown レンダラーのテスト（Issue #341）。
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderMarkdownLite } from './helpMarkdown';

describe('renderMarkdownLite', () => {
  it('箇条書きのインデント継続行は、直前の項目の続きとして同じ <li> に残る', () => {
    // README「調号」の実形（箇条書きの下にインデント付きの補足行が続く）
    const md = [
      '- **行頭クリックでも変更**: `♯ / ♭ / ♮` ツールで各段の行頭をクリック',
      '  拍子記号がある段では、その右側から音符の手前までを調号クリック領域として扱います',
      '  既存の音符セルを押したときは常に臨時記号として扱います',
      '- **表示位置**: 先頭行の調号を拍子記号の右側へ表示します',
    ].join('\n');
    const { container } = render(<>{renderMarkdownLite(md)}</>);
    const items = Array.from(container.querySelectorAll('li'));
    expect(items).toHaveLength(2);
    // 継続行がリストの外の段落へ吐き出されない
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(items[0].textContent).toContain('行頭クリックでも変更');
    expect(items[0].textContent).toContain('調号クリック領域');
    expect(items[0].textContent).toContain('常に臨時記号');
    expect(items[1].textContent).toContain('表示位置');
  });

  it('表・番号付きリスト・強調・コード・リンクの基本描画', () => {
    const md = [
      '| キー | 動作 |',
      '| --- | --- |',
      '| `V` | **声部**切替 |',
      '',
      '1. [説明](https://example.com)を読む',
      '2. 操作する',
    ].join('\n');
    const { container } = render(<>{renderMarkdownLite(md)}</>);
    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(container.querySelector('td code')?.textContent).toBe('V');
    expect(container.querySelector('td strong')?.textContent).toBe('声部');
    const ol = container.querySelector('ol')!;
    // リンクはテキストへ落ちる（<a> は作らない）
    expect(ol.querySelector('a')).toBeNull();
    expect(ol.textContent).toContain('説明を読む');
  });
});
