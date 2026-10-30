import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDatabase, publicUser } from "../server/lib/store.js";

async function withDb(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afg-store-"));
  const file = path.join(dir, "db.json");
  const db = createDatabase({ file, maxConversations: 100, maxStoredMessages: 200 });
  await db.init();
  try {
    await run(db, file);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("users are unique by normalized email and never expose hashes", async () => {
  await withDb(async (db) => {
    const user = db.createUser({ email: "A@B.CO", name: "A", passwordHash: "hash", salt: "salt" });
    assert.equal(user.email, "a@b.co");
    assert.equal(db.createUser({ email: "a@b.co", name: "B", passwordHash: "h", salt: "s" }), null);
    assert.equal(db.findUserByEmail(" a@b.co ")?.id, user.id);
    const safe = publicUser(user);
    assert.equal(safe.passwordHash, undefined);
    assert.equal(safe.salt, undefined);
  });
});

test("conversations are isolated by owner and survive a restart", async () => {
  await withDb(async (db, file) => {
    const owner = "user-a";
    const created = db.upsertConversation(owner, {
      title: "  Hello   world  ",
      mode: "coding",
      messages: [{ role: "user", content: "write code" }]
    });
    assert.equal(created.title, "Hello world");
    assert.equal(db.getConversation("user-b", created.id), null);
    assert.equal(db.upsertConversation("user-b", { id: created.id, messages: [] }), null);
    assert.equal(db.listConversations(owner).length, 1);
    assert.equal(db.listConversations(owner)[0].messageCount, 1);

    await db.flush();
    const raw = JSON.parse(await readFile(file, "utf8"));
    assert.equal(raw.conversations.length, 1);

    const reopened = createDatabase({ file, maxConversations: 100, maxStoredMessages: 200 });
    await reopened.init();
    assert.equal(reopened.getConversation(owner, created.id).messages[0].content, "write code");
    await reopened.close();
  });
});

test("message and conversation limits are enforced", async () => {
  await withDb(async (db) => {
    const messages = Array.from({ length: 260 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: "message " + index
    }));
    const conversation = db.upsertConversation("owner", { messages });
    assert.equal(conversation.messages.length, 200);
    assert.equal(conversation.messages[0].content, "message 60");
  });
});

test("deleting a conversation only affects its owner", async () => {
  await withDb(async (db) => {
    const conversation = db.upsertConversation("owner", { messages: [] });
    assert.equal(db.deleteConversation("other", conversation.id), false);
    assert.equal(db.deleteConversation("owner", conversation.id), true);
    assert.equal(db.getConversation("owner", conversation.id), null);
  });
});

test("usage counters keep a bounded daily history", async () => {
  await withDb(async (db) => {
    db.recordUsage("owner", "model-a");
    db.recordUsage("owner", "model-a");
    const day = db.recordUsage("owner", "model-b");
    assert.equal(day.requests, 3);
    assert.equal(day.models["model-a"], 2);
    assert.equal(db.stats().users, 0);
  });
});
