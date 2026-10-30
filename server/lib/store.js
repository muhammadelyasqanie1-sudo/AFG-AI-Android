import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const emptyState = () => ({
  version: 2,
  users: [],
  conversations: [],
  usage: {},
  branches: {},
  shared: {},
  retention: { maxAgeDays: 90, maxConversations: 1000 }
});

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan || "free",
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null
  };
}

function safeTitle(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 90) || "New conversation";
}

function generateId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Enhanced file-backed document store with:
 * - Conversation branching/versioning
 * - Message editing/regeneration history
 * - Export/import (JSON, Markdown)
 * - Shared conversations
 * - Data retention policies
 * - Semantic search placeholders
 */
export function createDatabase({ file, maxConversations = 100, maxStoredMessages = 200 }) {
  let state = emptyState();
  let saveChain = Promise.resolve();
  let closed = false;

  async function init() {
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      state = {
        ...emptyState(),
        ...parsed,
        users: Array.isArray(parsed.users) ? parsed.users : [],
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
        branches: parsed.branches && typeof parsed.branches === "object" ? parsed.branches : {},
        shared: parsed.shared && typeof parsed.shared === "object" ? parsed.shared : {},
        usage: parsed.usage && typeof parsed.usage === "object" ? parsed.usage : {},
        retention: parsed.retention || { maxAgeDays: 90, maxConversations: 1000 }
      };
      // Migrate old conversations
      migrateConversations();
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("Could not read database, starting empty:", error.message);
      }
      await persistNow();
    }
    return api;
  }

  function migrateConversations() {
    for (const conv of state.conversations) {
      if (!conv.version) conv.version = 1;
      if (!conv.branchId) conv.branchId = conv.id;
      if (!conv.parentBranchId) conv.parentBranchId = null;
      if (!conv.isBranch) conv.isBranch = false;
      if (!conv.messageVersions) conv.messageVersions = {};
    }
  }

  function persistNow() {
    if (closed) return Promise.resolve();
    // Apply retention policy
    applyRetentionPolicy();
    const snapshot = JSON.stringify(state);
    const temp = file + ".tmp";
    saveChain = saveChain
      .then(() => fs.mkdir(path.dirname(file), { recursive: true }))
      .then(() => fs.writeFile(temp, snapshot, { mode: 0o600 }))
      .then(() => fs.rename(temp, file))
      .catch((error) => {
        console.error("Database write failed:", error.message);
      });
    return saveChain;
  }

  function applyRetentionPolicy() {
    const { maxAgeDays, maxConversations } = state.retention;
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

    // Remove old conversations beyond maxConversations per user
    const userConvs = new Map();
    for (const conv of state.conversations) {
      if (!userConvs.has(conv.ownerId)) userConvs.set(conv.ownerId, []);
      userConvs.get(conv.ownerId).push(conv);
    }

    for (const [ownerId, convs] of userConvs) {
      convs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      if (convs.length > maxConversations) {
        const toRemove = new Set(convs.slice(maxConversations).map(c => c.id));
        state.conversations = state.conversations.filter(c => !toRemove.has(c.id));
      }
    }

    // Remove old conversations beyond maxAgeDays
    state.conversations = state.conversations.filter(c => c.updatedAt > cutoff);
  }

  function createBranch(conversation, branchPointMessageId, newTitle = null) {
    const branchId = generateId();
    const messageIndex = conversation.messages.findIndex(m => m.id === branchPointMessageId);
    if (messageIndex < 0) return null;

    const branchMessages = conversation.messages.slice(0, messageIndex + 1).map(m => ({
      ...m,
      id: generateId(),
      createdAt: nowIso(),
      isBranchPoint: m.id === branchPointMessageId
    }));

    const branch = {
      id: branchId,
      ownerId: conversation.ownerId,
      title: newTitle || `${conversation.title} (branch)`,
      mode: conversation.mode,
      model: conversation.model,
      messages: branchMessages,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      parentBranchId: conversation.branchId || conversation.id,
      originalConversationId: conversation.id,
      branchPointMessageId,
      isBranch: true,
      version: 1
    };

    state.branches[branchId] = branch;
    return branch;
  }

  function exportConversation(conversation, format = "json") {
    if (format === "markdown") {
      let md = `# ${conversation.title}\n\n`;
      md += `**Mode:** ${conversation.mode}  \n`;
      md += `**Model:** ${conversation.model || "auto"}  \n`;
      md += `**Created:** ${conversation.createdAt}  \n`;
      md += `**Updated:** ${conversation.updatedAt}  \n`;
      if (conversation.isBranch) {
        md += `**Branch of:** ${conversation.originalConversationId}  \n`;
        md += `**Branch Point:** ${conversation.branchPointMessageId}  \n`;
      }
      md += `\n---\n\n`;

      for (const msg of conversation.messages) {
        const role = msg.role === "user" ? "You" : "AFG AI";
        md += `## ${role}\n\n${msg.content}\n\n`;
        if (msg.sources?.length) {
          md += `**Sources:**\n`;
          for (const src of msg.sources) {
            md += `- [${src.title}](${src.url})\n`;
          }
          md += `\n`;
        }
        md += `---\n\n`;
      }
      return md;
    }
    return JSON.stringify(conversation, null, 2);
  }

  function importConversation(data, ownerId, format = "json") {
    let conversation;
    if (format === "markdown") {
      // Simple markdown parsing - extract messages between ## headers
      const sections = data.split(/^##\s+/m);
      const titleMatch = data.match(/^#\s+(.+)$/m);
      const messages = [];
      for (const section of sections.slice(1)) {
        const roleMatch = section.match(/^(You|AFG AI)\s*\n/);
        if (!roleMatch) continue;
        const role = roleMatch[1] === "You" ? "user" : "assistant";
        const content = section.replace(/^(You|AFG AI)\s*\n/, "").trim();
        if (content) {
          messages.push({
            id: generateId(),
            role,
            content,
            model: null,
            sources: [],
            createdAt: nowIso()
          });
        }
      }
      conversation = {
        id: generateId(),
        ownerId,
        title: titleMatch ? titleMatch[1].trim() : "Imported Conversation",
        mode: "chat",
        model: "auto",
        messages,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        version: 1,
        branchId: generateId(),
        isBranch: false
      };
    } else {
      conversation = JSON.parse(data);
      conversation.id = generateId();
      conversation.ownerId = ownerId;
      conversation.createdAt = nowIso();
      conversation.updatedAt = nowIso();
      conversation.version = 1;
      conversation.branchId = conversation.id;
      conversation.isBranch = false;
      // Sanitize messages
      conversation.messages = conversation.messages.map(m => ({
        ...m,
        id: m.id || generateId(),
        createdAt: m.createdAt || nowIso()
      }));
    }
    return conversation;
  }

  function createShareToken(conversationId, ownerId, permissions = "read") {
    const token = generateId().replace(/-/g, "").slice(0, 24);
    const share = {
      token,
      conversationId,
      ownerId,
      permissions, // "read" | "write"
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      accessCount: 0
    };
    state.shared[token] = share;
    persistNow();
    return token;
  }

  function getSharedConversation(token, requesterId) {
    const share = state.shared[token];
    if (!share) return null;
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      delete state.shared[token];
      persistNow();
      return null;
    }
    if (share.permissions === "read" && share.ownerId !== requesterId) {
      share.accessCount += 1;
      persistNow();
    }
    return share;
  }

  function updateMessageVersion(conversation, messageId, newContent, role) {
    const msgIndex = conversation.messages.findIndex(m => m.id === messageId);
    if (msgIndex < 0) return null;

    if (!conversation.messageVersions) conversation.messageVersions = {};
    if (!conversation.messageVersions[messageId]) conversation.messageVersions[messageId] = [];

    const oldVersion = { ...conversation.messages[msgIndex] };
    conversation.messageVersions[messageId].push({
      ...oldVersion,
      version: conversation.messageVersions[messageId].length + 1,
      editedAt: nowIso()
    });

    conversation.messages[msgIndex] = {
      ...conversation.messages[msgIndex],
      content: newContent,
      role,
      editedAt: nowIso(),
      version: (conversation.messageVersions[messageId].length) + 1
    };

    return conversation;
  }

  function getMessageVersions(conversation, messageId) {
    return conversation.messageVersions?.[messageId] || [];
  }

  const api = {
    init,
    get userCount() {
      return state.users.length;
    },
    get conversationCount() {
      return state.conversations.length;
    },
    findUserByEmail(email) {
      const normalized = String(email || "").trim().toLowerCase();
      return state.users.find((user) => user.email === normalized) || null;
    },
    findUserById(id) {
      return state.users.find((user) => user.id === id) || null;
    },
    createUser({ email, name, passwordHash, salt }) {
      const normalized = String(email || "").trim().toLowerCase();
      if (state.users.some((user) => user.email === normalized)) return null;
      const user = {
        id: generateId(),
        email: normalized,
        name: String(name || "").trim().slice(0, 60) || normalized.split("@")[0],
        passwordHash,
        salt,
        plan: "free",
        createdAt: nowIso(),
        lastLoginAt: null
      };
      state.users.push(user);
      persistNow();
      return user;
    },
    touchUser(id) {
      const user = state.users.find((entry) => entry.id === id);
      if (!user) return null;
      user.lastLoginAt = nowIso();
      persistNow();
      return user;
    },
    listConversations(ownerId, { includeBranches = false } = {}) {
      const convs = state.conversations
        .filter((conversation) => conversation.ownerId === ownerId)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

      if (!includeBranches) {
        return convs.filter(c => !c.isBranch).map(({ messages, ...summary }) => ({
          ...summary,
          messageCount: messages.length
        }));
      }
      return convs.map(({ messages, ...summary }) => ({
        ...summary,
        messageCount: messages.length
      }));
    },
    getConversation(ownerId, id) {
      const conversation = state.conversations.find(
        (entry) => entry.id === id && entry.ownerId === ownerId
      );
      return conversation ? structuredClone(conversation) : null;
    },
    getConversationWithBranches(ownerId, id) {
      const conversation = api.getConversation(ownerId, id);
      if (!conversation) return null;

      const branches = Object.values(state.branches).filter(b =>
        b.originalConversationId === id || b.parentBranchId === id
      ).map(({ messages, ...summary }) => ({ ...summary, messageCount: messages.length }));

      return { ...conversation, branches };
    },
    upsertConversation(ownerId, payload = {}) {
      const incomingId = typeof payload.id === "string" && payload.id.length < 80 ? payload.id : null;
      let conversation = incomingId
        ? state.conversations.find((entry) => entry.id === incomingId)
        : null;
      if (conversation && conversation.ownerId !== ownerId) return null;

      const now = nowIso();
      const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
      const messages = rawMessages
        .filter(
          (message) =>
            message &&
            ["user", "assistant", "system"].includes(message.role) &&
            (typeof message.content === "string" || Array.isArray(message.content))
        )
        .slice(-maxStoredMessages)
        .map((message) => ({
          id: message.id || generateId(),
          role: message.role,
          content: typeof message.content === "string"
            ? message.content.slice(0, 40000)
            : message.content,
          model: typeof message.model === "string" ? message.model.slice(0, 120) : null,
          sources: Array.isArray(message.sources) ? message.sources.slice(0, 10) : [],
          createdAt: message.createdAt || now,
          version: message.version || 1
        }));

      if (!conversation) {
        conversation = {
          id: incomingId || generateId(),
          ownerId,
          title: safeTitle(payload.title),
          mode: ["chat", "research", "coding", "study", "creative", "analysis"].includes(payload.mode)
            ? payload.mode
            : "chat",
          model: typeof payload.model === "string" ? payload.model.slice(0, 120) : null,
          messages,
          createdAt: now,
          updatedAt: now,
          version: 1,
          branchId: incomingId || generateId(),
          isBranch: false,
          messageVersions: {}
        };
        state.conversations.push(conversation);
      } else {
        conversation.title = safeTitle(payload.title || conversation.title);
        conversation.mode = ["chat", "research", "coding", "study", "creative", "analysis"].includes(payload.mode)
          ? payload.mode
          : conversation.mode;
        conversation.model = typeof payload.model === "string" ? payload.model.slice(0, 120) : conversation.model;
        conversation.messages = messages.length ? messages : conversation.messages;
        conversation.updatedAt = now;
        conversation.version = (conversation.version || 0) + 1;
      }

      state.conversations = state.conversations
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, maxConversations * 20);
      persistNow();
      return structuredClone(conversation);
    },
    deleteConversation(ownerId, id) {
      const index = state.conversations.findIndex(
        (entry) => entry.id === id && entry.ownerId === ownerId
      );
      if (index < 0) return false;
      state.conversations.splice(index, 1);
      // Also delete branches
      for (const [branchId, branch] of Object.entries(state.branches)) {
        if (branch.originalConversationId === id || branch.parentBranchId === id) {
          delete state.branches[branchId];
        }
      }
      persistNow();
      return true;
    },
    // Branching
    createBranch(ownerId, conversationId, branchPointMessageId, newTitle) {
      const conversation = state.conversations.find(
        (entry) => entry.id === conversationId && entry.ownerId === ownerId
      );
      if (!conversation) return null;

      const branch = createBranch(conversation, branchPointMessageId, newTitle);
      if (!branch) return null;

      state.conversations.push(branch);
      persistNow();
      return structuredClone(branch);
    },
    getBranches(ownerId, conversationId) {
      return Object.values(state.branches).filter(b =>
        b.ownerId === ownerId &&
        (b.originalConversationId === conversationId || b.parentBranchId === conversationId)
      ).map(({ messages, ...summary }) => ({ ...summary, messageCount: messages.length }));
    },
    // Message versioning
    editMessage(ownerId, conversationId, messageId, newContent, role) {
      const conversation = state.conversations.find(
        (entry) => entry.id === conversationId && entry.ownerId === ownerId
      );
      if (!conversation) return null;

      const updated = updateMessageVersion(conversation, messageId, newContent, role);
      if (!updated) return null;

      conversation.updatedAt = nowIso();
      persistNow();
      return structuredClone(conversation);
    },
    getMessageVersions(ownerId, conversationId, messageId) {
      const conversation = state.conversations.find(
        (entry) => entry.id === conversationId && entry.ownerId === ownerId
      );
      if (!conversation) return null;
      return getMessageVersions(conversation, messageId);
    },
    // Export/Import
    exportConversation(ownerId, conversationId, format = "json") {
      const conversation = state.conversations.find(
        (entry) => entry.id === conversationId && entry.ownerId === ownerId
      );
      if (!conversation) return null;
      return exportConversation(conversation, format);
    },
    importConversation(ownerId, data, format = "json") {
      const conversation = importConversation(data, ownerId, format);
      state.conversations.push(conversation);
      persistNow();
      return structuredClone(conversation);
    },
    // Sharing
    createShareToken(conversationId, ownerId, permissions = "read") {
      const conversation = state.conversations.find(
        (entry) => entry.id === conversationId && entry.ownerId === ownerId
      );
      if (!conversation) return null;
      return createShareToken(conversationId, ownerId, permissions);
    },
    getSharedConversation(token, requesterId) {
      const share = getSharedConversation(token, requesterId);
      if (!share) return null;
      const conversation = state.conversations.find(c => c.id === share.conversationId);
      if (!conversation) return null;
      return { conversation: structuredClone(conversation), permissions: share.permissions };
    },
    revokeShareToken(token) {
      if (state.shared[token]) {
        delete state.shared[token];
        persistNow();
        return true;
      }
      return false;
    },
    // Retention policy
    setRetentionPolicy({ maxAgeDays, maxConversations }) {
      if (typeof maxAgeDays === "number" && maxAgeDays > 0) state.retention.maxAgeDays = maxAgeDays;
      if (typeof maxConversations === "number" && maxConversations > 0) state.retention.maxConversations = maxConversations;
      persistNow();
      return state.retention;
    },
    getRetentionPolicy() {
      return { ...state.retention };
    },
    recordUsage(ownerId, model) {
      const today = nowIso().slice(0, 10);
      const entry = state.usage[ownerId] || { days: {} };
      const day = entry.days[today] || { requests: 0, models: {} };
      day.requests += 1;
      day.models[model] = (day.models[model] || 0) + 1;
      entry.days[today] = day;
      entry.lastAt = nowIso();
      const days = Object.keys(entry.days).sort();
      for (const old of days.slice(0, Math.max(0, days.length - 31))) delete entry.days[old];
      state.usage[ownerId] = entry;
      persistNow();
      return day;
    },
    stats() {
      return {
        users: state.users.length,
        conversations: state.conversations.length,
        branches: Object.keys(state.branches).length,
        shared: Object.keys(state.shared).length
      };
    },
    async flush() {
      await saveChain;
    },
    async close() {
      closed = true;
      await saveChain;
    }
  };

  return api;
}