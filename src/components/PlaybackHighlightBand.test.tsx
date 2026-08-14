// src/components/PlaybackHighlightBand.test.tsx
// Issue #268: 再生中の音符を「符頭の色替え」ではなく「背面の淡色の縦帯」で示すことの固定。
//
// 元の実装は .vf-note-hit そのものに青い fill/stroke を書き込んでいたため、
//   - 選択中の音符の青い枠（.vf-note-selected）と見分けが付かない
//   - 当たり判定 rect の属性を書き換えるので、消し損ねると譜面に色が残る
//   - 多段譜で1つの符頭しか光らない
// という問題があった。ここではそれぞれが直っていることを DOM で固定する。

import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import PlaybackHighlight from './PlaybackHighlight';
import type { PlaybackPosition } from '../audio/ScorePlayer';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** PianoSystemCanvas と同じ属性を持つ当たり判定 rect */
const makeHitRect = (measureIndex: number, noteIndex: number, y: number): SVGRectElement => {
  const el = document.createElementNS(SVG_NS, 'rect');
  el.setAttribute('class', 'vf-note-hit');
  el.setAttribute('data-measure', String(measureIndex));
  el.setAttribute('data-note', String(noteIndex));
  el.setAttribute('x', String(100 + noteIndex * 40));
  el.setAttribute('y', String(y));
  el.setAttribute('width', '40');
  el.setAttribute('height', '60');
  el.setAttribute('data-note-left', String(110 + noteIndex * 40));
  el.setAttribute('data-note-right', String(122 + noteIndex * 40));
  el.setAttribute('fill', 'transparent');
  el.setAttribute('stroke', 'none');
  return el;
};

/**
 * 段（system）を1つ作る。ピアノ大譜表と同じく、1つの <svg> の中に
 * 上段（右手 y=30）と下段（左手 y=150）の当たり判定が入る。
 */
const makeSystem = (measureIndexes: number[], opts?: { lowerStaffNotes?: number }): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  // 五線などの「先に描かれる要素」。帯がこれより前（背面）に入ることを見るための目印
  const staveLine = document.createElementNS(SVG_NS, 'line');
  staveLine.setAttribute('class', 'vf-stave-line');
  svg.appendChild(staveLine);

  for (const m of measureIndexes) {
    for (let n = 0; n < 3; n++) {
      svg.appendChild(makeHitRect(m, n, 30));
    }
    for (let n = 0; n < (opts?.lowerStaffNotes ?? 3); n++) {
      svg.appendChild(makeHitRect(m, n, 150));
    }
  }
  return svg;
};

let scoreArea: HTMLElement;

beforeEach(() => {
  scoreArea = document.createElement('div');
  scoreArea.className = 'score-area';
  document.body.appendChild(scoreArea);
  window.scrollTo = vi.fn();
});

afterEach(() => {
  scoreArea.remove();
  vi.clearAllMocks();
});

const position = (measureIndex: number, noteIndex: number): PlaybackPosition =>
  ({ measureIndex, beatPosition: 0, noteIndex });

describe('再生中ハイライトの縦帯（Issue #268）', () => {
  it('帯は段の SVG の先頭に入る＝五線・符頭より背面になる', () => {
    const svg = makeSystem([0]);
    scoreArea.appendChild(svg);

    render(<PlaybackHighlight currentPosition={position(0, 1)} isPlaying={true} />);

    const band = svg.querySelector('rect.vf-playback-band');
    expect(band).not.toBeNull();
    // firstChild であること = SVG の描画順で最初 = いちばん奥
    expect(svg.firstChild).toBe(band);
  });

  it('帯はクリックを奪わない（再生中でも音符を選べる）', () => {
    scoreArea.appendChild(makeSystem([0]));

    render(<PlaybackHighlight currentPosition={position(0, 1)} isPlaying={true} />);

    const band = document.querySelector('rect.vf-playback-band')!;
    expect(band.getAttribute('pointer-events')).toBe('none');
  });

  it('既定の色は選択枠の青ではなく琥珀色（選択と再生位置を見分けられる）', () => {
    scoreArea.appendChild(makeSystem([0]));

    render(<PlaybackHighlight currentPosition={position(0, 1)} isPlaying={true} />);

    const band = document.querySelector('rect.vf-playback-band')!;
    expect(band.getAttribute('fill')).toBe('rgba(245, 158, 11, 0.35)');
    // .vf-note-selected の青（#1d4ed8）や旧実装の #007bff は使わない
    expect(band.getAttribute('fill')).not.toMatch(/#1d4ed8|#007bff|123, 255/);
    expect(band.getAttribute('stroke')).toBe('none');
  });

  it('多段譜では1本の帯が上段と下段を貫く（片方のパートにしか音が無くても同じ高さ）', () => {
    // 下段は音符2つだけ = noteIndex 2 は上段にしか存在しない
    const svg = makeSystem([0], { lowerStaffNotes: 2 });
    scoreArea.appendChild(svg);

    const { rerender } = render(<PlaybackHighlight currentPosition={position(0, 0)} isPlaying={true} />);
    const bothStaves = svg.querySelector('rect.vf-playback-band')!;
    const yBoth = bothStaves.getAttribute('y');
    const hBoth = bothStaves.getAttribute('height');

    rerender(<PlaybackHighlight currentPosition={position(0, 2)} isPlaying={true} />);
    const upperOnly = svg.querySelectorAll('rect.vf-playback-band');
    expect(upperOnly).toHaveLength(1);
    expect(upperOnly[0].getAttribute('y')).toBe(yBoth);
    expect(upperOnly[0].getAttribute('height')).toBe(hBoth);
    // 上段(y=30)の上端から下段(y=150,h=60)の下端まで
    expect(yBoth).toBe('30');
    expect(hBoth).toBe('180');
  });

  it('鳴っている音符が居ない段には帯を出さない', () => {
    const system1 = makeSystem([0]);
    const system2 = makeSystem([1]);
    scoreArea.appendChild(system1);
    scoreArea.appendChild(system2);

    render(<PlaybackHighlight currentPosition={position(1, 0)} isPlaying={true} />);

    expect(system1.querySelectorAll('rect.vf-playback-band')).toHaveLength(0);
    expect(system2.querySelectorAll('rect.vf-playback-band')).toHaveLength(1);
  });

  it('位置が進むと帯は1本のまま移動する（増えない）', () => {
    const svg = makeSystem([0]);
    scoreArea.appendChild(svg);

    const { rerender } = render(<PlaybackHighlight currentPosition={position(0, 0)} isPlaying={true} />);
    const firstX = svg.querySelector('rect.vf-playback-band')!.getAttribute('x');

    rerender(<PlaybackHighlight currentPosition={position(0, 1)} isPlaying={true} />);
    const bands = svg.querySelectorAll('rect.vf-playback-band');
    expect(bands).toHaveLength(1);
    expect(bands[0].getAttribute('x')).not.toBe(firstX);
  });

  it('停止すると帯が消え、当たり判定 rect の属性は元のまま（譜面に色が残らない）', () => {
    const svg = makeSystem([0]);
    scoreArea.appendChild(svg);

    const { rerender } = render(<PlaybackHighlight currentPosition={position(0, 1)} isPlaying={true} />);
    expect(svg.querySelectorAll('rect.vf-playback-band')).toHaveLength(1);

    rerender(<PlaybackHighlight currentPosition={position(0, 1)} isPlaying={false} />);
    expect(svg.querySelectorAll('rect.vf-playback-band')).toHaveLength(0);

    // 当たり判定 rect は最初から一度も書き換えられていない
    svg.querySelectorAll('rect.vf-note-hit').forEach(el => {
      expect(el.getAttribute('fill')).toBe('transparent');
      expect(el.getAttribute('stroke')).toBe('none');
      expect(el.classList.contains('playback-highlight')).toBe(false);
    });
  });

  it('アンマウントでも帯が残らない（タブ切替などでコンポーネントが外れる場合）', () => {
    const svg = makeSystem([0]);
    scoreArea.appendChild(svg);

    const { unmount } = render(<PlaybackHighlight currentPosition={position(0, 1)} isPlaying={true} />);
    expect(svg.querySelectorAll('rect.vf-playback-band')).toHaveLength(1);

    unmount();
    expect(svg.querySelectorAll('rect.vf-playback-band')).toHaveLength(0);
  });

  it('「小節内のN番目の子要素」のような当てずっぽうの一致では帯を出さない', () => {
    // 旧実装は `g.vf-stavenote:nth-child(N)` もセレクタに含めていたため、
    // data-measure / data-note を持たない無関係な音符に帯が付いてしまう経路があった
    const svg = document.createElementNS(SVG_NS, 'svg');
    for (let i = 0; i < 4; i++) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'vf-stavenote');
      svg.appendChild(g);
    }
    scoreArea.appendChild(svg);

    render(<PlaybackHighlight currentPosition={position(0, 1)} isPlaying={true} />);

    expect(document.querySelectorAll('rect.vf-playback-band')).toHaveLength(0);
  });

  it('再生位置が整数でなくてもセレクタを壊さない', () => {
    scoreArea.appendChild(makeSystem([0]));

    expect(() => {
      render(
        <PlaybackHighlight
          currentPosition={{ measureIndex: -1, beatPosition: 0, noteIndex: 1.5 }}
          isPlaying={true}
        />
      );
    }).not.toThrow();
    expect(document.querySelectorAll('rect.vf-playback-band')).toHaveLength(0);
  });
});
