/*
 * 画面表示の線の太さの下限（フロア）の修正前後を撮るスニペット — Issue #210
 *
 * 【これは何か】
 * 画面に出ている譜面の1段目を、**いま画面に出ているのと同じデバイスピクセル数**で
 * PNG に切り出す道具です。この Issue で見たいのは「線が1画素を塗り切れずにかすれる」
 * という**ラスタライズの結果**なので、`capture-ab-images.js`（ページ原寸で撮る）とは違い、
 * 実際の表示倍率のまま撮るところが要点です。
 *
 * 【使い方】
 *   1. アプリを開き、譜種を「編成譜 → 室内オーケストラ」にして「画面表示のズーム」を 50% にする
 *   2. コンソールにこのファイルを貼り付けて実行
 *   3. `await floorShot('before-chamber-50.png')` でダウンロードされる
 *
 * 出力は左が原寸（1:1 デバイスピクセル）、右が4倍の拡大です。拡大は
 * 画素を補間せずそのまま引き伸ばしている（ニアレストネイバー）ので、
 * 原寸の画素の濃さがそのまま見えます。
 *
 * 【なぜ画面キャプチャではないか】
 * 譜面は SVG で描かれるが、線の太さは App.css 側で決まるため、SVG をそのまま
 * 取り出しても見た目が再現できない。描画中の要素の**計算後スタイル**を属性へ焼き込み、
 * 音楽フォントを base64 で埋め込んで「単体で完結する SVG」にしてから canvas へ描いている
 * （`capture-ab-images.js` と同じ考え方）。人間が手で撮るより位置ずれが起きず、
 * 修正前後がまったく同じ切り出し・同じ倍率になる。
 *
 * 【注意】保存データもアプリのコードも変更しない。
 */
(function () {
  'use strict';

  const HOST = 'https://cdn.jsdelivr.net/npm/@vexflow-fonts/';
  const FONTS = { Bravura: 'bravura/bravura.woff2', Academico: 'academico/academico.woff2' };
  /** クローンへ焼き込む CSS プロパティ。太さ・色・書体まわりだけで足りる */
  const COPY = [
    'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
    'font-family', 'font-size', 'font-style', 'font-weight', 'opacity', 'visibility', 'display',
    'text-anchor', 'letter-spacing', 'transform',
  ];
  /** 塗り矩形の縦線は width も CSS で決まる（Issue #210）ので、属性へ写しておく */
  const GEOMETRY = ['width', 'height', 'x', 'y'];

  let fontCssCache = null;

  /** 音楽フォントを base64 で埋め込む @font-face を作る（1回だけ取得してキャッシュ） */
  async function fontCss() {
    if (fontCssCache) return fontCssCache;
    const parts = [];
    for (const [family, path] of Object.entries(FONTS)) {
      const bytes = new Uint8Array(await (await fetch(HOST + path)).arrayBuffer());
      // 一度に String.fromCharCode へ渡すと引数が多すぎて落ちるので分割する
      let bin = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      parts.push(`@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${btoa(bin)}) format("woff2");}`);
    }
    fontCssCache = parts.join('\n');
    return fontCssCache;
  }

  /** style="..." の中に " が入ると属性が壊れるので ' に寄せる（font-family が該当する） */
  const singleQuote = (s) => s.replace(/"/g, "'");

  function inlineComputedStyles(original, clone) {
    const src = [original, ...original.querySelectorAll('*')];
    const dst = [clone, ...clone.querySelectorAll('*')];
    for (let i = 0; i < src.length; i++) {
      const cs = getComputedStyle(src[i]);
      let decl = '';
      for (const prop of COPY) {
        const v = cs.getPropertyValue(prop);
        // transform は none のときに書くと無駄なので飛ばす
        if (v && v !== 'none') decl += `${prop}:${v};`;
      }
      dst[i].setAttribute('style', singleQuote(decl));
      // CSS のジオメトリプロパティ（rect の width など）は属性値と食い違うことがあるので、
      // 計算後の値を属性へ書き戻してから切り離す
      if (src[i].tagName === 'rect') {
        for (const prop of GEOMETRY) {
          const v = cs.getPropertyValue(prop);
          if (v && v.endsWith('px')) dst[i].setAttribute(prop, Number.parseFloat(v).toString());
        }
      }
    }
  }

  /** 1段ぶん（.score-area svg の systemIndex 番目）を単体 SVG にする。座標は SVG 自身の論理座標 */
  async function buildSystemSvg(systemIndex) {
    const svg = document.querySelectorAll('.print-page .score-area svg')[systemIndex || 0];
    if (!svg) throw new Error('段が見つかりません');
    const clone = svg.cloneNode(true);
    inlineComputedStyles(svg, clone);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.insertAdjacentHTML('afterbegin', `<defs><style type="text/css">${await fontCss()}</style></defs>`);
    return new XMLSerializer().serializeToString(clone);
  }

  function svgToImage(svgText, width, height) {
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
    const img = new Image();
    img.width = width;
    img.height = height;
    return new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('SVG の読み込みに失敗しました'));
      img.src = url;
    });
  }

  /**
   * いま画面に出ているのと同じ大きさ（デバイスピクセル）で1段ぶんを撮る。
   * @returns 原寸を左、4倍拡大を右に並べた canvas
   */
  async function buildFloorCanvas(systemIndex, magnify) {
    const svgEl = document.querySelectorAll('.print-page .score-area svg')[systemIndex || 0];
    const rect = svgEl.getBoundingClientRect(); // 画面上の実サイズ（CSS px・ズーム込み）
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    const img = await svgToImage(await buildSystemSvg(systemIndex), w, h);

    const base = document.createElement('canvas');
    base.width = w;
    base.height = h;
    const bctx = base.getContext('2d');
    bctx.fillStyle = '#ffffff';
    bctx.fillRect(0, 0, w, h);
    bctx.drawImage(img, 0, 0, w, h);

    const z = magnify || 4;
    const GAP = 24;
    const out = document.createElement('canvas');
    out.width = w + GAP + w * z;
    out.height = Math.max(h, h * z);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(base, 0, 0);
    // 画素を補間しない＝原寸の1画素がそのまま z×z の四角として見える
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, w, h, w + GAP, 0, w * z, h * z);
    return { canvas: out, deviceSize: `${w}x${h}`, cssSize: `${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`, dpr };
  }

  async function floorShot(name, systemIndex, magnify) {
    const { canvas, deviceSize, cssSize, dpr } = await buildFloorCanvas(systemIndex, magnify);
    const a = document.createElement('a');
    a.download = name || 'floor.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
    return { name: a.download, deviceSize, cssSize, dpr, out: `${canvas.width}x${canvas.height}` };
  }

  window.buildFloorCanvas = buildFloorCanvas;
  window.floorShot = floorShot;
  console.log('[floorCapture] 準備できました。await floorShot("before-chamber-50.png")');
})();
