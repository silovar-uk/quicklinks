# Quick Links Sync Worker

Quick Links の任意手動同期用 Cloudflare Worker です。R2 にはブラウザー側で AES-GCM 暗号化したスナップショットだけを保存します。

## Deploy

```bash
npx wrangler r2 bucket create quicklinks-sync
npx wrangler deploy
```

想定 Worker 名は `quicklinks-sync`、フロント側の既定エンドポイントは
`https://quicklinks-sync.silovar-uk.workers.dev` です。

別ドメインへデプロイする場合は、ブラウザーの `quick-links-sync-v1` 設定内 `endpoint` を変更してください。

## API

- `GET /v1/metadata?url=<public-http-url>`
- `GET /v1/vault/:vaultId`
- `PUT /v1/vault/:vaultId`

`/v1/metadata` は URL 種別を判定してページ情報を返します。一般ページは meta / JSON-LD / 本文冒頭までフォールバックします。YouTube は `YOUTUBE_API_KEY` が設定されていれば YouTube Data API v3 の `snippet` を優先し、未設定時は oEmbed と公開 HTML を使います。

YouTube の説明文を安定して取得するには Worker secret `YOUTUBE_API_KEY` を設定してください。

R2 bucket は公開せず、Worker binding 経由だけでアクセスしてください。

## Safety

- Origin は `https://silovar-uk.github.io` と localhost のみ許可
- Bearer token の SHA-256 だけを R2 custom metadata に保存
- 新規作成は `If-None-Match: *`
- 更新は `If-Match: <ETag>`
- payload 上限 5 MiB
- metadata 取得は http/https の公開URLのみ
- localhost・プライベートIP・link-local 等を拒否
- リダイレクト先を都度再検証
- HTML 読み込み上限 1.5 MiB、タイムアウト付き


## GitHub Actions

`.github/workflows/deploy-sync-worker.yml` を追加しています。

Repository secrets に次の2つを登録すると、`worker/**` の main 更新時に自動デプロイされます。Actions の **Deploy Quick Links Sync Worker** を手動実行することもできます。

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

YouTube Data API を利用する場合は任意で `YOUTUBE_API_KEY` も Repository secret に登録します。値がある場合だけデプロイ時に Worker secret を更新します。

API token はリポジトリへ直接書かないでください。
