import { HttpError } from "./errors.js";

/**
 * Live web search through Tavily. Kept behind a small interface so another
 * provider (Brave, SearXNG, Exa) can be added without touching chat logic.
 */
export function createSearch(config, { fetchImpl = fetch } = {}) {
  async function search(query) {
    const key = config.search.tavilyKey;
    if (!key) {
      throw new HttpError(
        503,
        "search_unconfigured",
        "Live web search is not configured. Add TAVILY_API_KEY on the server."
      );
    }
    let response;
    try {
      response = await fetchImpl("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: key,
          query: String(query || "").slice(0, 500),
          search_depth: "advanced",
          max_results: config.search.maxResults,
          include_answer: false
        }),
        signal: AbortSignal.timeout(config.search.timeoutMs)
      });
    } catch (error) {
      if (error?.name === "TimeoutError") {
        throw new HttpError(504, "search_timeout", "Live web search timed out. Try again.");
      }
      throw new HttpError(502, "search_unreachable", "Could not reach the web search provider.");
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429) {
        throw new HttpError(429, "search_rate_limited", "Web search is rate-limited. Try again shortly.", {
          retryAfter: 30
        });
      }
      throw new HttpError(502, "search_error", "The web search provider returned an error.");
    }

    return (Array.isArray(data.results) ? data.results : [])
      .slice(0, config.search.maxResults)
      .map((item) => ({
        title: String(item.title || "Web result").slice(0, 250),
        url: String(item.url || ""),
        content: String(item.content || "").slice(0, 1800)
      }))
      .filter((item) => /^https?:\/\//i.test(item.url));
  }

  return { search, configured: Boolean(config.search.tavilyKey) };
}
