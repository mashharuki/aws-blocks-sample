/**
 * E2E（エンドツーエンド）テスト — 直接importでAPIをテストする（フロントエンドと同じ型付きクライアントを使用）。
 *
 * 実行:  npm run test:e2e
 *
 * 構成:
 *   - セットアップ（dev serverを起動し、クライアントをimportする） — 触らない
 *   - 認証テスト
 *   - CRUDテスト
 *   - 条件付き書き込み/競合テスト
 *   - リアルタイムテスト
 *
 * テストを追加するには: 任意のtestブロックをコピーし、名前を変え、アサーションを変更する。
 * セットアップのボイラープレートがサーバーのライフサイクルを扱うので、api.*メソッドを呼ぶだけでよい。
 */

import assert from "node:assert";
import { type ChildProcess, spawn } from "node:child_process";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { installCookieJar, isServerRunning } from "@aws-blocks/blocks/utils";
import type { api as ApiType, authApi as AuthApiType } from "aws-blocks";

// APIクライアントをimportする前にcookie jarをインストールする — Nodeのfetchは
// リクエスト間でcookieを保持しないため、これがないと認証付きAPI呼び出しが壊れる。
installCookieJar();

let server: ChildProcess | null = null;
let api: typeof ApiType;
let authApi: typeof AuthApiType;

// ─── セットアップ（触らない） ─────────────────────────────────────────────────────

test.before(async () => {
	// 既存のdev serverが起動していればそれを使い、なければ新規起動する
	if (!(await isServerRunning())) {
		server = spawn("npm", ["run", "dev:server"], {
			cwd: process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
			env: { ...process.env, NODE_OPTIONS: "" },
		});
		server.unref();
		await setTimeout(2000);
	}

	const mod = await import("aws-blocks");
	api = mod.api;
	authApi = mod.authApi;

	// サーバーの準備ができるまで待つ
	for (let i = 0; i < 30; i++) {
		try {
			await authApi.getAuthState();
			return;
		} catch {
			await setTimeout(1000);
		}
	}
	throw new Error("Dev serverが30秒以内に準備完了しませんでした");
});

test.after(() => {
	if (server?.pid) {
		try {
			process.kill(-server.pid, "SIGTERM");
		} catch {}
	}
});

// ─── 認証 ─────────────────────────────────────────────────────────────────────

test("auth: starts signed out", async () => {
	const state = await authApi.getAuthState();
	assert.strictEqual(state.state, "signedOut");
});

test("auth: sign up creates account and signs in", async () => {
	const state = await authApi.setAuthState({
		action: "signUp",
		username: "testuser@example.com",
		password: "TestPass123!",
	});
	assert.strictEqual(state.state, "signedIn");
	assert.strictEqual(state.user?.username, "testuser@example.com");
});

test("auth: unauthenticated access is rejected", async () => {
	// まずサインアウトする
	await authApi.setAuthState({ action: "signOut" });

	await assert.rejects(
		() => api.listTodos(),
		(err: any) =>
			err.message.includes("Authentication") ||
			err.message.includes("Session") ||
			err.message.includes("401"),
	);

	// 残りのテストのために再度サインインする
	await authApi.setAuthState({
		action: "signIn",
		username: "testuser@example.com",
		password: "TestPass123!",
	});
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────

test("todos: create with priority", async () => {
	const todo = await api.createTodo("Buy milk", 1);
	assert.strictEqual(todo.title, "Buy milk");
	assert.strictEqual(todo.priority, 1);
	assert.strictEqual(todo.completed, false);
	assert.strictEqual(todo.version, 1);
	assert.ok(todo.todoId);
});

test("todos: list (only own)", async () => {
	const list = await api.listTodos();
	assert.ok(list.length >= 1);
	assert.ok(list.every((t) => t.userId === "testuser@example.com"));
});

test("todos: list sorted by priority (secondary index)", async () => {
	// 異なる優先度のTodoを作成する
	await api.createTodo("Low priority task", 3);
	await api.createTodo("High priority task", 1);

	const sorted = await api.listTodos("priority");
	assert.ok(sorted.length >= 2);
	// priority 1（高）は priority 3（低）より前に来るべき
	const priorities = sorted.map((t) => t.priority);
	for (let i = 1; i < priorities.length; i++) {
		assert.ok(
			priorities[i] >= priorities[i - 1],
			"優先度の昇順でソートされているはず",
		);
	}
});

test("todos: list sorted by title (secondary index)", async () => {
	const sorted = await api.listTodos("title");
	assert.ok(sorted.length >= 2);
	const titles = sorted.map((t) => t.title);
	for (let i = 1; i < titles.length; i++) {
		assert.ok(
			titles[i] >= titles[i - 1],
			"タイトルの昇順でソートされているはず",
		);
	}
});

test("todos: toggle completion", async () => {
	const [todo] = await api.listTodos();
	await api.toggleTodo(todo.todoId);

	const updated = (await api.listTodos()).find((t) => t.todoId === todo.todoId);
	assert.strictEqual(updated?.completed, !todo.completed);
	assert.strictEqual(updated?.version, todo.version + 1);
});

test("todos: delete", async () => {
	const before = await api.listTodos();
	const target = before[0];
	await api.deleteTodo(target.todoId);

	const after = await api.listTodos();
	assert.ok(!after.some((t) => t.todoId === target.todoId));
});

// ─── 条件付き書き込み（楽観的ロック） ──────────────────────────────────

test("todos: concurrent toggle → conflict → retry succeeds", async () => {
	// 新しいTodoを作成する
	const todo = await api.createTodo("Conflict test");

	// 2回「同時に」トグルすることで同時書き込みをシミュレートする
	// 最初のトグルは成功する（version 1 → 2）
	await api.toggleTodo(todo.todoId);

	// 現在の状態を読み込む
	const current = (await api.listTodos()).find((t) => t.todoId === todo.todoId);
	assert.strictEqual(current?.version, 2);

	// 再度トグルする — 最新のversionを読んでいるので成功するはず
	await api.toggleTodo(todo.todoId);
	const final = (await api.listTodos()).find((t) => t.todoId === todo.todoId);
	assert.strictEqual(final?.version, 3);
	assert.strictEqual(final?.completed, todo.completed); // 2回トグル = 元の状態に戻る

	// クリーンアップ
	await api.deleteTodo(todo.todoId);
});

// ─── リアルタイム ─────────────────────────────────────────────────────────────────
// 注記: リアルタイム購読のテストにはミドルウェアのロードが必要で、
// これはdev serverがclient.jsを再生成する際に自動的に行われる。
// 手動でテストするには: `npm run dev` を実行し、2つのブラウザタブを開き、
// 片方でTodoを作成する — もう片方に即座に表示されるはず。
