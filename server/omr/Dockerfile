# PDF楽譜 → .mxl 変換API（Issue #487）
#
# Audiveris 5.11 の公式 .deb（Java 21 同梱）を**無改造のまま**入れ、
# Node の薄いHTTPラッパーから子プロセスとして呼ぶだけの構成にしている。
# コードを取り込まないので AGPL は本体アプリへ伝播しない（設計書参照）。
#
# .deb は ubuntu24.04 向けが配布されているため、ベースイメージも合わせる。
FROM ubuntu:24.04

# 変換したいバージョンを差し替えられるように引数化する
ARG AUDIVERIS_VERSION=5.11.0
ARG AUDIVERIS_DEB=Audiveris-${AUDIVERIS_VERSION}-ubuntu24.04-x86_64.deb

ENV DEBIAN_FRONTEND=noninteractive
# バッチ変換では画面を使わないので AWT をヘッドレスに固定する（X が無い環境での失敗回避）
ENV JAVA_TOOL_OPTIONS=-Djava.awt.headless=true

# poppler-utils(pdfinfo) はページ数上限（20ページ）の確定判定に使う。
# GPL だが Audiveris と同じく無改造バイナリの子プロセス起動のみ（プロセス分離）。
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ca-certificates curl nodejs fontconfig fonts-dejavu-core \
      poppler-utils; \
    curl -fsSL -o /tmp/audiveris.deb \
      "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/${AUDIVERIS_DEB}"; \
    # .deb の依存（Tesseract のデータ等）は apt に解決させる
    apt-get install -y --no-install-recommends /tmp/audiveris.deb; \
    rm -f /tmp/audiveris.deb; \
    rm -rf /var/lib/apt/lists/*; \
    # 実行ファイルの置き場所はパッケージの作り方で変わりうるので、
    # 決め打ちにせずビルド時に探して固定の名前へ繋いでおく
    launcher="$(find /opt /usr/lib /usr/share -maxdepth 4 -type f -name 'Audiveris' -perm -u+x 2>/dev/null | head -n1)"; \
    test -n "$launcher"; \
    ln -sf "$launcher" /usr/local/bin/audiveris; \
    audiveris -help >/dev/null 2>&1 || true

WORKDIR /srv/omr
COPY package.json convert.js audiveris.js server.js ./

# 変換した楽譜を残さないため、書き込みは一時ディレクトリだけに限る運用にしている
# （実際の削除は audiveris.js の finally が行う）
ENV PORT=8080
EXPOSE 8080

# ユーザーの楽譜を扱うので root では動かさない（ubuntu イメージ既定の非 root ユーザー）
USER ubuntu

CMD ["node", "server.js"]
