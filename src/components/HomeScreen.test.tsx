// ホーム画面（Issue #500）の単体テスト。
// 画面が「何を出すか」「押したら何を呼ぶか」をここで固定し、
// 実際に譜面画面へ届くこと（配線）は App.test.tsx の統合テストで確かめる。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import HomeScreen, { type HomeOpenKind, type HomeScreenProps } from './HomeScreen';
import type { WorkSummary } from '../types/storage';

const WORKS: WorkSummary[] = [
  { id: 'w1', title: 'ソナタ', updatedAt: new Date(2026, 7, 30, 12, 34).getTime(), createdAt: 1 },
  { id: 'w2', title: '', updatedAt: new Date(2026, 7, 29, 9, 5).getTime(), createdAt: 1 },
];

const ALL_OPEN_KINDS: HomeOpenKind[] = ['file', 'musicxml', 'pdf', 'legacy'];

function renderHome(overrides: Partial<HomeScreenProps> = {}) {
  const props: HomeScreenProps = {
    appVersion: '3.6.0',
    resume: { workId: 'w1', title: 'ソナタ', updatedAt: WORKS[0].updatedAt },
    works: WORKS,
    availableOpenKinds: ALL_OPEN_KINDS,
    onResume: vi.fn(),
    onSelectWork: vi.fn(),
    onCreateNew: vi.fn(),
    onOpen: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<HomeScreen {...props} />);
  return props;
}

describe('ホーム画面（Issue #500）', () => {
  afterEach(() => cleanup());

  it('「前回の続き」が最上段に出て、作品名と最終更新日時が分かる', () => {
    const props = renderHome();
    const resume = screen.getByTestId('home-resume');
    expect(resume.textContent).toContain('前回の続きを開く');
    expect(resume.textContent).toContain('ソナタ');
    expect(resume.textContent).toContain('2026/08/30 12:34');

    fireEvent.click(resume);
    expect(props.onResume).toHaveBeenCalledTimes(1);
  });

  it('前回の続きが無いときは、何をすればよいかを言葉で示す（黙って空にしない）', () => {
    renderHome({ resume: null });
    expect(screen.queryByTestId('home-resume')).toBeNull();
    expect(screen.getByTestId('home-resume-empty').textContent).toContain('新しく作る');
  });

  it('譜種を選んで新規作成できる（4種類すべて）', () => {
    const props = renderHome();
    for (const type of ['single', 'piano', 'quartet', 'ensemble'] as const) {
      fireEvent.click(screen.getByTestId(`home-new-${type}`));
      expect(props.onCreateNew).toHaveBeenCalledWith(type);
    }
    expect(props.onCreateNew).toHaveBeenCalledTimes(4);
  });

  it('既存の「開く」導線をすべて呼べる', () => {
    const props = renderHome();
    for (const kind of ALL_OPEN_KINDS) {
      fireEvent.click(screen.getByTestId(`home-open-${kind}`));
      expect(props.onOpen).toHaveBeenCalledWith(kind);
    }
  });

  it('使えない「開く」導線（PDF変換API無し・旧手動保存なし）は並べない', () => {
    renderHome({ availableOpenKinds: ['file', 'musicxml'] });
    expect(screen.getByTestId('home-open-file')).toBeTruthy();
    expect(screen.queryByTestId('home-open-pdf')).toBeNull();
    expect(screen.queryByTestId('home-open-legacy')).toBeNull();
  });

  it('保存した作品の一覧から作品を開ける（タイトル未設定は「無題」）', () => {
    const props = renderHome();
    expect(screen.getByTestId('home-work-w2').textContent).toContain('無題');
    fireEvent.click(screen.getByTestId('home-work-w1'));
    expect(props.onSelectWork).toHaveBeenCalledWith('w1');
  });

  it('設定の入口はツールバーのタブへ送るだけ（設定を二重に持たない）', () => {
    const props = renderHome();
    fireEvent.click(screen.getByTestId('home-settings-score'));
    expect(props.onOpenSettings).toHaveBeenCalledWith('score');
    fireEvent.click(screen.getByTestId('home-settings-layout'));
    expect(props.onOpenSettings).toHaveBeenCalledWith('layout');
    fireEvent.click(screen.getByTestId('home-settings-playback'));
    expect(props.onOpenSettings).toHaveBeenCalledWith('playback');
  });

  it('バージョンをフッターに表示する（受入条件7）', () => {
    renderHome({ appVersion: '3.7.1' });
    expect(screen.getByTestId('home-version').textContent).toBe('v3.7.1');
  });

  it('ログイン要素は置かない（お試しの障壁を上げない方針）', () => {
    renderHome();
    const buttonLabels = screen.getAllByRole('button').map(button => button.textContent ?? '');
    expect(buttonLabels.some(label => /ログイン|サインイン|アカウント/.test(label))).toBe(false);
  });

  it('busy 中は設定を含む全ボタンが無効になる（round3/round4 P2: 連打の無言無視を見た目で防ぐ）', () => {
    render(
      <HomeScreen
        appVersion="1.0.0"
        resume={{ workId: 'w1', title: '作品', updatedAt: Date.now() }}
        works={[{ id: 'w1', title: '作品', updatedAt: Date.now(), createdAt: Date.now() }]}
        availableOpenKinds={['file', 'musicxml']}
        busy
        onResume={() => {}}
        onSelectWork={() => {}}
        onCreateNew={() => {}}
        onOpen={() => {}}
        onOpenSettings={() => {}}
      />
    );
    const buttons = [...document.querySelectorAll('.home-screen button')];
    expect(buttons.length).toBeGreaterThan(5);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByTestId('home-screen').getAttribute('aria-busy')).toBe('true');
  });
});
