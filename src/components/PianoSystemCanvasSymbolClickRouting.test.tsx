// 記号字面クリックの意味（Issue #385 続報 → 2026-08-24 の実機フィードバックで統一）:
//   - **常に「その記号を選ぶ」**（✥ 位置調整パネルを開く）。ツールやタブで意味が変わらない
//   - ⤢（サイズ変更ツール）中だけ、その場でサイズ調整パネルを開く
//   - 削除は ✥ パネルの「この記号を削除」ボタン（＋従来どおり音符クリックのトグル）
// 一時期あった「同種ツール中はトグル解除」は、pp ツールを持ったまま pp を押すと
// 消えて選択できない詰みになったため撤回した（履歴は design.md 追補5）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { SCORE_EDIT_NOTICE_EVENT } from '../utils/scoreEditorNotices';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return { playNoteEvent: vi.fn().mockResolvedValue(undefined), setSoundSource: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() };
  })
}));
vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: { isInitializedState: vi.fn().mockReturnValue(false), initialize: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockResolvedValue(undefined) }
}));
vi.mock('../audio/SoundSource', () => ({
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
  SoundSource: vi.fn().mockImplementation(function() {
    return { getCurrentInstrument: vi.fn().mockReturnValue('piano'), setCurrentInstrument: vi.fn(), loadInstrument: vi.fn().mockResolvedValue(undefined), reconnectAllSynths: vi.fn(), dispose: vi.fn() };
  })
}));

const WIDTH = 700;

function renderWithTool(tool: unknown, events: MeasureData['events']) {
  const onChange = vi.fn();
  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={tool as never}
      scale={1}
      partsConfig={[{ clef: 'treble', data: [{ events }], onChange }]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
      symbolsClickable={true}
    />
  );
  return { container, onChange };
}

const PP_EVENT: MeasureData['events'][number] = { dur: '1', isRest: false, keys: ['b/4'], dynamics: [{ value: 'pp' }] };

function clickRegion(container: HTMLElement) {
  const region = container.querySelector('.symbol-hit-region') as SVGRectElement;
  expect(region).toBeTruthy();
  fireEvent.click(region, { clientX: 10, clientY: 10 });
}

describe('記号字面クリックのツール別ルーティング（Issue #385 続報）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => WIDTH, configurable: true });
    (SVGElement.prototype as unknown as { getBBox: () => { x: number; y: number; width: number; height: number } }).getBBox =
      () => ({ x: 0, y: 0, width: 10, height: 10 });
  });
  afterEach(() => {
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
  });

  it('同じ強弱ツール選択中でも、記号の字面クリックは「選択」（消えない・2026-08-24 統一）', () => {
    // 一時期は同種ツール中トグル解除にしていたが、pp ツールを持ったまま pp を押すと
    // 消えてしまい選択・位置調整ができない詰みになったため撤回した
    const { container, onChange } = renderWithTool({ mode: 'dynamic', dynamic: 'pp' }, [PP_EVENT]);
    clickRegion(container);
    const overlay = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('記号位置調整');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('アーティキュレーションツール選択中も、字面クリックは「選択」で記号は消えない', () => {
    const { container, onChange } = renderWithTool(
      { mode: 'articulation', articulation: 'staccato' },
      [{ dur: '1', isRest: false, keys: ['b/4'], articulations: ['staccato'] }],
    );
    clickRegion(container);
    expect(container.querySelector('.symbol-adjust-overlay')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('⤢（サイズ変更ツール）選択中の字面クリックはサイズ調整オーバーレイを開く', () => {
    const { container, onChange } = renderWithTool({ mode: 'symbolAdjustResize' }, [PP_EVENT]);
    clickRegion(container);
    const overlay = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('記号サイズ変更');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('それ以外のツール（音符ツール等）では従来どおり ✥（位置調整）が開く', () => {
    const { container } = renderWithTool({ duration: '4', isRest: false }, [PP_EVENT]);
    clickRegion(container);
    const overlay = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('記号位置調整');
  });

  it('✥ オーバーレイの「この記号を削除」で記号が消え、通知が出る（裁定B）', () => {
    const notices: string[] = [];
    const onNotice = (e: Event) => notices.push((e as CustomEvent<{ message: string }>).detail?.message ?? '');
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    try {
      // 調整値（symbolAdjust.dynamics）を事前に持たせ、削除で一緒に消えることまで検証する
      // （Codex最終ゲート P3: 元データに無いと120行の確認が常時成功してしまう）
      const { container, onChange } = renderWithTool(
        { duration: '4', isRest: false },
        [{ ...PP_EVENT, symbolAdjust: { dynamics: { offsetY: -20 } } }],
      );
      clickRegion(container);
      const button = Array.from(container.querySelectorAll('.symbol-adjust-overlay button'))
        .find((b) => b.textContent === 'この記号を削除') as HTMLButtonElement;
      expect(button).toBeTruthy();
      // 実ブラウザでは mousedown の preventDefault が入力欄の blur（＝確定して閉じる）を
      // 抑止することでボタンの click が成立する。jsdom はこの focus 連動を再現できない
      // （手動 fireEvent.blur は preventDefault を素通りする）ため、
      // 「mousedown が preventDefault されたこと」自体を fireEvent の戻り値
      // （false = preventDefault 済み）で固定する（Codex最終ゲート P3）
      expect(fireEvent.mouseDown(button)).toBe(false);
      fireEvent.click(button);
      expect(container.querySelector('.symbol-adjust-overlay')).toBeNull();
      const saved = onChange.mock.calls.at(-1)![0][0].events[0];
      expect(saved.dynamics).toBeUndefined();
      expect(saved.symbolAdjust?.dynamics).toBeUndefined();
      expect(notices.join(' ')).toContain('強弱記号を削除しました');
    } finally {
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    }
  });
});
