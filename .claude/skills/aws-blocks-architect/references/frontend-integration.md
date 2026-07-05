# フロントエンド連携

AWS Blocks の型安全なフロントエンド連携パターン。SKILL.mdのStep 4を実装する際の参考にする。

## 目次

1. [型安全RPCの基本](#1-型安全rpcの基本)
2. [Next.js](#2-nextjs)
3. [React (Vite等)](#3-react-vite等)
4. [Vue / Nuxt](#4-vue--nuxt)
5. [Realtimeの購読](#5-realtimeの購読)
6. [認証状態の扱い](#6-認証状態の扱い)
7. [モバイル・デスクトップ](#7-モバイルデスクトップ)
8. [エラーハンドリング](#8-エラーハンドリング)

---

## 1. 型安全RPCの基本

バックエンドの `aws-blocks/index.ts` で `export const api = new ApiNamespace(...)` した内容は、
コード生成なしにそのままフロントエンドから `import { api } from 'aws-blocks'` で使える。

```typescript
// aws-blocks/index.ts（バックエンド）
export const api = new ApiNamespace(scope, 'api', (context) => ({
  async listTodos() { /* ... */ },
  async createTodo(title: string) { /* ... */ },
}));
```

```typescript
// src/App.tsx（フロントエンド）
import { api } from 'aws-blocks';

const todos = await api.listTodos();       // 戻り値の型が自動推論される
await api.createTodo('Buy milk');          // 引数の型もチェックされる
// await api.createTodo(123);              // ← コンパイルエラーになる
```

内部的にはJSON-RPCプロキシが自動生成され、ローカル開発時はローカルサーバーへ、デプロイ後は
API Gateway経由でLambdaへリクエストが飛ぶ。**呼び出し側のコードは環境で変える必要がない。**

バックエンドの関数シグネチャを変更した場合、フロントエンドの呼び出し箇所は型チェックで即座に
エラーとして検出される。変更の影響範囲を洗い出すときは `npm run typecheck` を実行する。

---

## 2. Next.js

`--template nextjs` で作成したプロジェクト、または既存Next.jsプロジェクトに組み込む場合の型安全RPC呼び出し例。

```typescript
// app/todos/page.tsx (Server Component)
import { api } from 'aws-blocks';

export default async function TodosPage() {
  const todos = await api.listTodos();
  return <TodoList items={todos} />;
}
```

```typescript
// app/todos/actions.ts (Server Action)
'use server';
import { api } from 'aws-blocks';

export async function createTodo(formData: FormData) {
  const title = formData.get('title') as string;
  await api.createTodo(title);
}
```

Server Component/Server Actionから直接 `api` を呼べるため、多くの場合クライアント側に
APIキーやエンドポイントURLを露出させる必要がない。クライアントコンポーネントから呼ぶ場合は
Server Action経由にするか、公開してよい操作に限定する。

---

## 3. React (Vite等)

```typescript
import { useEffect, useState } from 'react';
import { api } from 'aws-blocks';

function TodoList() {
  const [todos, setTodos] = useState<Awaited<ReturnType<typeof api.listTodos>>>([]);

  useEffect(() => {
    api.listTodos().then(setTodos);
  }, []);

  return (
    <ul>
      {todos.map((t) => <li key={t.id}>{t.title}</li>)}
    </ul>
  );
}
```

`Awaited<ReturnType<typeof api.xxx>>` パターンで、バックエンドの戻り値型からフロントエンドの
状態の型を導出できる。手動で型を再定義しない。

---

## 4. Vue / Nuxt

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from 'aws-blocks';

const todos = ref<Awaited<ReturnType<typeof api.listTodos>>>([]);

onMounted(async () => {
  todos.value = await api.listTodos();
});
</script>
```

Nuxtの場合はサーバーサイド（`server/`配下やuseFetchのハンドラ内）から直接 `api` を呼び出すことも可能。

---

## 5. Realtimeの購読

```typescript
import { useRealtime } from '@aws-blocks/blocks/client';

function NotificationBell({ userId }: { userId: string }) {
  const [count, setCount] = useState(0);

  useRealtime('notifications', `user-${userId}`, (message) => {
    if (message.type === 'todo.completed') {
      setCount((c) => c + 1);
    }
  });

  return <Badge count={count} />;
}
```

WebSocket接続の確立・再接続・クリーンアップはフック側で処理される。トピック名（例: `user-${userId}`）は
サーバー側の `publish` と一致させる。

---

## 6. 認証状態の扱い

Auth系Blockはクライアント向けのセッション管理フックも提供する（Blockの種類により名称が異なる場合がある）。

```typescript
import { useAuth } from '@aws-blocks/blocks/client';

function LoginForm() {
  const { signIn, signOut, user, isLoading } = useAuth();

  if (isLoading) return <Spinner />;
  if (!user) return <button onClick={() => signIn({ email, password })}>Sign in</button>;
  return <button onClick={() => signOut()}>Sign out ({user.email})</button>;
}
```

サーバー側の `ApiNamespace` ハンドラでは、フロントエンドから渡された `userId` などの値を信頼せず、
必ず `auth.getCurrentUser(context)` でセッションから解決したユーザー情報を使う。

---

## 7. モバイル・デスクトップ

AWS Blocks は Web（Next.js, Nuxt, Astro, React, Vue, Svelte, Angular）だけでなく、
ネイティブモバイル（Swift, Kotlin/Kotlin Multiplatform, Dart/Flutter）とデスクトップも対象範囲。
型安全性はバックエンドからクライアントSDKまで一貫して提供される。ネイティブSDKの詳細なAPIは
プラットフォームごとに異なるため、対象プラットフォームが決まったら公式ドキュメントの
Supported platforms ページで最新のSDK名・インストール方法を確認する。

---

## 8. エラーハンドリング

`ApiNamespace` のハンドラ内で投げた例外はRPC境界を越えてフロントエンドに伝播する。
ユーザー向けメッセージと内部エラーを区別する。

```typescript
// バックエンド
export const api = new ApiNamespace(scope, 'api', (context) => ({
  async createTodo(title: string) {
    if (!title.trim()) {
      throw new Error('title must not be empty'); // フロントエンドでcatchできる
    }
    // ...
  },
}));
```

```typescript
// フロントエンド
try {
  await api.createTodo(title);
} catch (err) {
  toast.error(err instanceof Error ? err.message : '不明なエラーが発生しました');
}
```

機密情報（スタックトレース、内部のテーブル名等）をエラーメッセージに含めない。バックエンドで
キャッチしてユーザー向けの安全なメッセージに変換してから投げ直す。
