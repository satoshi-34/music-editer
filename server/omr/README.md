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
    （`unauthorized` / `noFile` / `notPdf` / `tooLarge` / `tooManyPages` / `timeout` / `conversionFailed` / `noOutput`）

制限: 20MB・20ページ・120秒。受け取ったPDFと変換結果は、リクエストの完了時に必ず削除します。

## 共有トークン（#493・公開時は必須）

環境変数 `OMR_API_TOKEN` を設定すると、`x-omr-token` ヘッダが一致しないリクエストを
変換前に 401 で断ります（未設定ならローカル開発向けに検査なし）。
アプリ側は `VITE_OMR_API_TOKEN` に同じ値を設定するとヘッダを付けます。

トークンの生成例:

```sh
openssl rand -hex 32
```

## 試用公開（Air + Cloudflare Tunnel + Vercel プレビュー）

商用化前は GCP を使わず、手元マシン（Air）で動かして限定公開する構成です
（判断の経緯は design.md の 6.5 節）。

1. **Air でコンテナを起動**（トークン付き・呼び出し元オリジンも絞る）:
   ```sh
   OMR_API_TOKEN=<生成したトークン> \
   OMR_ALLOWED_ORIGIN=<プレビューのオリジン> \
   docker compose --profile omr up -d omr
   ```
   プレビューのオリジンには、デプロイごとに変わるURLではなく**ブランチ固定のプレビューURL**
   （`https://<プロジェクト>-git-<ブランチ>-<アカウント>.vercel.app`）を使うと差し替え不要です。
   ※ CORS はブラウザ経由の呼び出し制限で、curl 等の直接叩きには効きません。直接叩きの防護は
   上の共有トークンが担います（設計書 6.5 節）。
2. **Cloudflare Tunnel で外向けURLを作る**（無料・カード不要・自宅ポートは開けない）:
   ```sh
   brew install cloudflared
   cloudflared tunnel --url http://localhost:8080
   ```
   表示された `https://～.trycloudflare.com` が変換APIのURLになります
   （このクイックトンネルは起動のたびにURLが変わります。固定したい場合は
   Cloudflare アカウントで named tunnel を作ります）。
3. **Vercel のプレビュー環境にだけ**環境変数を設定（Settings → Environment Variables で
   対象を Preview のみにする）: `VITE_OMR_API_URL`＝トンネルのURL、`VITE_OMR_API_TOKEN`＝同じトークン。
4. プレビューデプロイのURLを試用者（弟）に渡す。**本番（Production）には設定しない**こと。
   本番バンドルには PDF ボタンもトークンも載りません。

注意: Air がスリープ中は変換できません。また x86_64 コンテナのため Apple Silicon では
エミュレーション実行になり、変換は実測より数倍遅くなることがあります。

## テスト

入口のロジック（multipart 解析・上限・理由コード）はリポジトリの vitest で動きます。

```sh
npx vitest --run server/omr/convert.test.js
```

Audiveris そのものの動作確認はコンテナで行ってください。

```sh
docker compose --profile omr run --rm omr audiveris -help
```
