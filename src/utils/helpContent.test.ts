// アプリ内ヘルプ（Issue #341）のコンテンツ層テスト。
// リファレンスの正本は README なので、実物の README も読み込んで
// 「目的別ガイドの参照先（seeAlso）が実在する」ことまで固定する。
import { describe, expect, it } from 'vitest';
import readmeRaw from '../../README.md?raw';
import { TASK_GUIDES, parseReadmeSections, searchHelp } from './helpContent';

const FIXTURE = `# アプリ

## 1. このアプリでできること
- いろいろ

## 3. 画面・各タブの説明
タブの説明の前文。

## 5. よく使う応用操作

### タイ／スラー
- 始点 → 終点の順にクリック

### 連符
- 数字を消せる

## 6. キーボードショートカット

| キー | 動作 |
| --- | --- |
| V | 声部切替 |

## 8. 開発者向け文書へのリンク
- ここは載せない
`;

describe('parseReadmeSections（README→リファレンス項目）', () => {
  it('操作章だけを ###（無ければ ##）単位で項目化し、開発者向け章は除く', () => {
    const sections = parseReadmeSections(FIXTURE);
    const titles = sections.map((s) => s.title);
    expect(titles).toEqual(['画面・各タブの説明', 'タイ／スラー', '連符', 'キーボードショートカット']);
    // 「できること」「開発者向け」は含まれない
    expect(sections.some((s) => s.body.includes('ここは載せない'))).toBe(false);
    // 章タイトルから番号は除去され、body は markdown のまま
    expect(sections[1].chapter).toBe('よく使う応用操作');
    expect(sections[1].body).toContain('始点 → 終点');
  });

  it('実物の README からも主要な操作項目が取れる（章番号の振り直しに依存しない）', () => {
    const sections = parseReadmeSections(readmeRaw);
    const titles = sections.map((s) => s.title);
    expect(titles).toContain('タイ／スラー');
    expect(titles).toContain('キーボードショートカット');
    expect(titles.length).toBeGreaterThan(15);
  });

  it('目的別ガイドの seeAlso は、実物の README のリファレンス項目に必ず実在する', () => {
    const titles = new Set(parseReadmeSections(readmeRaw).map((s) => s.title));
    for (const guide of TASK_GUIDES) {
      if (guide.seeAlso) {
        expect(titles.has(guide.seeAlso), `${guide.id} の seeAlso「${guide.seeAlso}」`).toBe(true);
      }
    }
  });
});

describe('searchHelp（横断検索）', () => {
  const sections = parseReadmeSections(FIXTURE);

  it('空クエリは全件を返す（一覧として眺められる）', () => {
    const { guides, sections: hit } = searchHelp('', sections);
    expect(guides).toHaveLength(TASK_GUIDES.length);
    expect(hit).toHaveLength(sections.length);
  });

  it('キーワードで目的別ガイドとリファレンスの両方に絞り込める', () => {
    const { guides, sections: hit } = searchHelp('タイ', sections);
    expect(guides.some((g) => g.id === 'tie-slur')).toBe(true);
    expect(hit.some((s) => s.title === 'タイ／スラー')).toBe(true);
  });

  it('スペース区切りは AND 条件（例:「連符 数字」）', () => {
    const { guides } = searchHelp('連符 数字', parseReadmeSections(FIXTURE));
    expect(guides.map((g) => g.id)).toContain('tuplet-number');
    expect(guides.map((g) => g.id)).not.toContain('tie-slur');
  });

  it('大文字小文字を区別しない（英字キーワード）', () => {
    const { guides } = searchHelp('musicxml', sections);
    expect(guides.some((g) => g.id === 'musicxml')).toBe(true);
  });
});
