# PDF楽譜 → .mxl 変換API（Issue #487）

PDFの楽譜を [Audiveris](https://github.com/Audiveris/audiveris)（OMR エンジン）で
MusicXML（.mxl）へ変換して返すだけの、小さな HTTP サーバーです。
アプリ本体は PDF を解釈せず、返ってきた .mxl を既存の MusicXML 読込経路へ流します。

設計の詳細・AGPL の整理は [`.claude/specs/omr-import/design.md`](../../.claude/specs/omr-import/design.md) を参照してください。

## 起動（ローカル）

```sh
# 変換API（初回はイメージのビルドに時間がかかります）
docker compose --profile omr up omr

# アプリ側（別ターミナル）: 変換APIの場所を教えると「開く」に「PDF (β)」ボタンが出ます
VITE_OMR_API_URL=http://localhost:8080 npm run dev
```

`VITE_OMR_API_URL` を設定しない限り、アプリに PDF の導線は出ません（本番は当面この状態）。

## API

- `GET /health` → `{"ok":true}`
- `POST /convert`（`multipart/form-data`・フィールド名 `file`）
  - 成功: `200` で .mxl のバイト列
  - 失敗: `{"error":{"reason":"...","message":"..."}}`
    （`noFile` / `notPdf` / `tooLarge` / `tooManyPages` / `timeout` / `conversionFailed` / `noOutput`）

制限: 20MB・20ページ・120秒。受け取ったPDFと変換結果は、リクエストの完了時に必ず削除します。

## テスト

入口のロジック（multipart 解析・上限・理由コード）はリポジトリの vitest で動きます。

```sh
npx vitest --run server/omr/convert.test.js
```

Audiveris そのものの動作確認はコンテナで行ってください。

```sh
docker compose --profile omr run --rm omr audiveris -help
```
