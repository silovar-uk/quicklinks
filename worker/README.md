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

- `GET /v1/vault/:vaultId`
- `PUT /v1/vault/:vaultId`

R2 bucket は公開せず、Worker binding 経由だけでアクセスしてください。

## Safety

- Origin は `https://silovar-uk.github.io` と localhost のみ許可
- Bearer token の SHA-256 だけを R2 custom metadata に保存
- 新規作成は `If-None-Match: *`
- 更新は `If-Match: <ETag>`
- payload 上限 5 MiB
