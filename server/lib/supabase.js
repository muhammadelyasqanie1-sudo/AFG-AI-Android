/**
 * Optional Supabase mirror. Local JSON remains the source of truth for the
 * app; this keeps the existing deployment's analytics table populated when
 * SUPABASE_URL / SUPABASE_ANON_KEY are present.
 */
export function createSupabaseMirror(config, { fetchImpl = fetch } = {}) {
  const enabled = Boolean(config.supabase.url && config.supabase.key);
  if (!enabled) return { enabled: false, persistChatTurn: async () => {} };

  const headers = {
    apikey: config.supabase.key,
    Authorization: "Bearer " + config.supabase.key,
    "content-type": "application/json",
    Prefer: "return=minimal"
  };

  const isUuid = (value) =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

  async function persistChatTurn({ userId, sessionId, userText, assistantText, model, language }) {
    if (!isUuid(userId) || !isUuid(sessionId)) return;
    try {
      const sessionResponse = await fetchImpl(config.supabase.url + "/rest/v1/chat_sessions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: sessionId,
          user_id: userId,
          title: String(userText || "").slice(0, 120),
          language: language === "en" ? "en" : "fa"
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (!sessionResponse.ok && sessionResponse.status !== 409) return;
      await fetchImpl(config.supabase.url + "/rest/v1/chat_messages", {
        method: "POST",
        headers,
        body: JSON.stringify([
          { session_id: sessionId, role: "user", content: String(userText).slice(0, 12000), model },
          {
            session_id: sessionId,
            role: "assistant",
            content: String(assistantText).slice(0, 24000),
            model
          }
        ]),
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      // Optional mirror: never fail a chat because analytics storage is down.
    }
  }

  return { enabled: true, persistChatTurn };
}
