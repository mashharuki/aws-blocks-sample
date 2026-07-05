# AWS Blocks カタログ詳細

全Blockの設定オプションとコード例。SKILL.mdのStep 2/3でBlockを選定・実装する際の参考として使う。
実際のプロパティ名やメソッドシグネチャは日々更新される可能性があるため、コンパイルエラーが出た場合は
`node_modules/@aws-blocks/blocks` の型定義や公式リファレンス（Blocks reference）で最新のシグネチャを確認する。

## 目次

1. [データ・ストレージ](#1-データストレージ)
2. [認証](#2-認証)
3. [コンピュート・バックグラウンド](#3-コンピュートバックグラウンド)
4. [AI](#4-ai)
5. [通信](#5-通信)
6. [設定](#6-設定)
7. [観測性](#7-観測性)
8. [ホスティング・デプロイ](#8-ホスティングデプロイ)
9. [共通の仕組み: Conditional Exports](#9-共通の仕組み-conditional-exports)

---

## 1. データ・ストレージ

### KVStore

キーバリューストア。条件付き書き込みが必要な軽量データに使う。裏側は Amazon DynamoDB（単一テーブル）。

```typescript
import { KVStore } from '@aws-blocks/blocks';

const settings = new KVStore(scope, 'settings');

await settings.set('theme', { mode: 'dark' });
const value = await settings.get('theme');
await settings.setIfNotExists('lock:job-123', { owner: 'worker-a' }); // 条件付き書き込み
await settings.delete('theme');
```

**使いどころ**: フラグ、ロック、キャッシュ、単純な設定値の永続化。インデックス検索が要る場合は `DistributedTable` へ。

### DistributedTable

構造化データ + セカンダリインデックス。裏側は Amazon DynamoDB。CRUD/Todoアプリの定番。

```typescript
import { DistributedTable } from '@aws-blocks/blocks';

const todos = new DistributedTable(scope, 'todos', {
  schema: {
    id: 'string',
    userId: 'string',
    title: 'string',
    completed: 'boolean',
    createdAt: 'string',
  },
  key: { partition: 'userId', sort: 'id' },
  // 追加のクエリパターンが必要ならセカンダリインデックスを宣言する（DynamoDBのGSIに自動マッピング）
  indexes: {
    byCompleted: { partition: 'userId', sort: 'completed' },
  },
});

await todos.put({ id: crypto.randomUUID(), userId: 'u1', title: 'Buy milk', completed: false, createdAt: new Date().toISOString() });
const userTodos = await todos.query({ partition: 'u1' });
const incomplete = await todos.query({ partition: 'u1', index: 'byCompleted', sortValue: false });
await todos.delete({ partition: 'u1', sort: 'todo-id' });
```

**使いどころ**: ユーザーごとのリスト、タグ検索、状態別フィルタなど、パーティション+ソートキーで表現できるアクセスパターン。

### Database

Kysely クエリビルダによる SQL。裏側は Amazon Aurora Serverless v2（マネージド Postgres）。

```typescript
import { Database } from '@aws-blocks/blocks';

const db = new Database(scope, 'appdb');

// migrationやschemaはプロジェクトのマイグレーション機構に従う
const rows = await db.kysely
  .selectFrom('orders')
  .innerJoin('users', 'users.id', 'orders.userId')
  .select(['orders.id', 'users.email'])
  .where('orders.status', '=', 'pending')
  .execute();
```

**使いどころ**: JOINが必要な集計、既存のSQLベースの資産、複雑なレポーティング。ローカル開発では PGlite
（WASM版Postgres）でAuroraの挙動をオフライン再現するため、`npm run dev` でもSQLがそのまま動く。

### DistributedDatabase

アイドル時ゼロコストのサーバーレスSQL。裏側は Amazon Aurora DSQL。

```typescript
import { DistributedDatabase } from '@aws-blocks/blocks';

const db = new DistributedDatabase(scope, 'appdb');
```

**使いどころ**: `Database` と同様のSQLユースケースだが、アクセス頻度が低くアイドルコストを避けたい場合。

### FileBucket

presigned URL によるファイルアップロード/ダウンロード。裏側は Amazon S3。

```typescript
import { FileBucket } from '@aws-blocks/blocks';

const uploads = new FileBucket(scope, 'uploads');

const uploadUrl = await uploads.getUploadUrl({ key: `user-${userId}/avatar.png`, contentType: 'image/png' });
const downloadUrl = await uploads.getDownloadUrl({ key: `user-${userId}/avatar.png` });
await uploads.delete({ key: `user-${userId}/avatar.png` });
```

**使いどころ**: 画像・ファイルのアップロード機能。フロントエンドは presigned URL に直接PUTするため、
バックエンドを経由した大容量バイナリ転送を避けられる。

---

## 2. 認証

### AuthBasic

ユーザー名/パスワード認証をステートマシンAPIで扱う。裏側は Amazon DynamoDB + JWT。

```typescript
import { AuthBasic } from '@aws-blocks/blocks';

const auth = new AuthBasic(scope, 'auth');

// サインアップ〜確認までを状態遷移として扱う
await auth.signUp({ email, password });
await auth.confirmSignUp({ email, code });
const session = await auth.signIn({ email, password });

// ApiNamespace のハンドラ内で現在のユーザーを取得
const user = await auth.getCurrentUser(context);
```

**使いどころ**: 自前の認証UI/フローを完全にコントロールしたい場合。マネージドMFAやSSOは不要な小〜中規模アプリ。

### AuthCognito

MFA・グループ・パスキー等のマネージド機能。裏側は Amazon Cognito。

```typescript
import { AuthCognito } from '@aws-blocks/blocks';

const auth = new AuthCognito(scope, 'auth', {
  mfa: 'optional',
  passwordPolicy: { minLength: 8 },
});

const user = await auth.getCurrentUser(context);
if (!user.groups.includes('admin')) {
  throw new Error('forbidden');
}
```

**使いどころ**: エンタープライズ要件（MFA必須、グループベース認可）がある場合。`--template auth-cognito` で
最初からこのBlockが組み込まれたプロジェクトを作れる。

### AuthOIDC

Google/GitHub/OktaなどのOIDCプロバイダによるサインイン。OAuthリダイレクトフローを実装。

```typescript
import { AuthOIDC } from '@aws-blocks/blocks';

const auth = new AuthOIDC(scope, 'auth', {
  providers: ['google', 'github'],
});
```

**使いどころ**: 自前パスワード管理を避け、外部IdPに認証を委譲したいSaaS向けアプリ。

---

## 3. コンピュート・バックグラウンド

### AsyncJob

Fire-and-forgetのバックグラウンド処理。裏側は Amazon SQS + AWS Lambda。

```typescript
import { AsyncJob } from '@aws-blocks/blocks';

const sendWelcomeEmail = new AsyncJob(scope, 'sendWelcomeEmail', async (input: { userId: string }) => {
  // 重い処理・外部API呼び出し等をリクエストの応答から切り離して実行
});

// ApiNamespace のハンドラから起動（応答を待たない）
await sendWelcomeEmail.trigger({ userId: user.id });
```

**使いどころ**: メール送信、レポート生成、外部APIとの同期など、APIレスポンスをブロックしたくない処理。

### CronJob

スケジュール実行。裏側は Amazon EventBridge + AWS Lambda。

```typescript
import { CronJob } from '@aws-blocks/blocks';

new CronJob(scope, 'dailyCleanup', {
  schedule: 'rate(1 day)', // または cron式
  handler: async () => {
    // 定期実行するロジック
  },
});
```

**使いどころ**: 日次バッチ、期限切れデータのクリーンアップ、定期レポート。

---

## 4. AI

Agent と KnowledgeBase の詳細な実装パターン（HITL承認フロー、`useChat` フック、ローカルモック動作の
注意点）は [ai-agent-patterns.md](ai-agent-patterns.md) を参照する。ここでは概要のみ。

### KnowledgeBase

ドキュメントのセマンティック検索・RAG。裏側は Amazon Bedrock Knowledge Bases。

```typescript
import { KnowledgeBase } from '@aws-blocks/blocks';

const kb = new KnowledgeBase(scope, 'docs', {
  source: './knowledge',
  description: 'プロダクトドキュメント',
  chunking: { strategy: 'semantic' },
});

const results = await kb.retrieve('返金ポリシーは？', { maxResults: 4 });
```

### Agent

ツール実行・会話永続化・HITL承認付きのAIエージェント。裏側は Amazon Bedrock。

```typescript
import { Agent, BedrockModels } from '@aws-blocks/blocks';
import { z } from 'zod';

const agent = new Agent(scope, 'support', {
  model: { deployed: BedrockModels.BALANCED },
  systemPrompt: 'あなたはサポート担当者です。',
  tools: (tool) => ({
    searchDocs: tool({
      description: 'ドキュメント検索',
      parameters: z.object({ query: z.string() }),
      handler: async ({ input }) => kb.retrieve(input.query, { maxResults: 4 }),
    }),
  }),
});
```

---

## 5. 通信

### Realtime

WebSocket による pub/sub。裏側は Amazon API Gateway WebSocket。

```typescript
import { Realtime } from '@aws-blocks/blocks';

const channel = new Realtime(scope, 'notifications');

// サーバー側から配信
await channel.publish({ topic: `user-${userId}`, data: { type: 'todo.completed', id } });
```

```typescript
// フロントエンド側の購読（フレームワーク別の詳細は frontend-integration.md）
import { useRealtime } from '@aws-blocks/blocks/client';

useRealtime('notifications', `user-${userId}`, (message) => {
  console.log(message);
});
```

**使いどころ**: 通知、ライブ更新、共同編集のプレゼンス表示など。

### EmailClient

トランザクションメール送信。裏側は Amazon SES。

```typescript
import { EmailClient } from '@aws-blocks/blocks';

const email = new EmailClient(scope, 'email', { from: 'noreply@example.com' });

await email.send({ to: user.email, subject: 'ご登録ありがとうございます', body: '...' });
```

---

## 6. 設定

### AppSetting

設定値・シークレットの管理。裏側は AWS Systems Manager Parameter Store。

```typescript
import { AppSetting } from '@aws-blocks/blocks';

const apiKey = new AppSetting(scope, 'thirdPartyApiKey', { secret: true });

const value = await apiKey.get();
```

**使いどころ**: APIキー、フィーチャーフラグ、環境ごとに変わる設定値。`secret: true` を付けると暗号化保存される。

---

## 7. 観測性

| Block | 用途 | 裏側のAWSサービス |
|-------|------|-------------------|
| `Logger` | 相関ID付き構造化ログ | Amazon CloudWatch Logs |
| `Metrics` | カスタムアプリケーションメトリクス | Amazon CloudWatch |
| `Tracer` | 分散リクエストトレーシング | AWS X-Ray |
| `Dashboard` | 自動生成される観測性ダッシュボード | Amazon CloudWatch |

```typescript
import { Logger, Metrics } from '@aws-blocks/blocks';

const logger = new Logger(scope, 'app');
const metrics = new Metrics(scope, 'app');

export const api = new ApiNamespace(scope, 'api', (context) => ({
  async createTodo(title: string) {
    logger.info('creating todo', { title });
    metrics.increment('todo.created');
    // ...
  },
}));
```

観測性Blockは他のBlockと組み合わせて「常に入れておく」運用が推奨される。本番運用に入るプロジェクトでは
`review` モードでこれらが組み込まれているか確認する。

---

## 8. ホスティング・デプロイ

### Hosting

フロントエンドのSSR対応デプロイ。裏側は Amazon CloudFront + Amazon S3。CDKレイヤーのコンポーネントのため、
`@aws-blocks/blocks/cdk` からインポートする（アプリのランタイムコードとは別扱い）。

```typescript
import { Hosting } from '@aws-blocks/blocks/cdk';

new Hosting(scope, 'frontend', {
  buildOutputDir: './dist',
  framework: 'nextjs', // SSR対応
});
```

`npm run deploy` を実行すると、バックエンドのBlockと合わせてこの Hosting もデプロイされ、
CloudFront経由でフロントエンドが配信される。`npm run sandbox` はバックエンド検証用の軽量デプロイで、
Hostingを含まないケースが多い（詳細は [testing-deployment.md](testing-deployment.md)）。

---

## 9. 共通の仕組み: Conditional Exports

すべてのBlockは同一のソースコードが実行コンテキストに応じて異なる実装に解決される。

| コンテキスト | 実装 |
|-------------|------|
| ローカル開発（`npm run dev`） | メモリ/ファイルシステム実装（`.bb-data/` にJSON保存、`Database`はPGlite） |
| CDK synthesis（`cdk synth`, `npm run sandbox`, `npm run deploy`） | CDKコンストラクトを生成し、CloudFormationテンプレートに変換 |
| AWS Lambdaランタイム（デプロイ後の実行時） | AWS SDK経由で実サービスを呼び出す |

このためコードレビュー時は「ローカルでは動くが本番のconditional exportsパスでは異なる制約がある」
パターン（例: ローカルのcannedモデルを前提にした固定文字列マッチのテストコード）に注意する。
