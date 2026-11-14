const HOST_NAME = "ollamaview.host";
const DEFAULT_OLLAMA_INSTANCE = "http://127.0.0.1:11434";
const DEFAULT_MAX_SOURCES = 5;
const DEFAULT_CONTEXT_SIZE = 4096;
const LEGACY_DEFAULT_SYSTEM_PROMPT = "You are a helpful, privacy-focused search assistant. Using the provided web search sources, write a clear, concise, and accurate overview that directly answers the user's search query. Format your response in clean Markdown (such as bullet points, bold key terms, and short sections where helpful). Synthesize key facts from the sources, stay objective, and avoid speculation. If the sources do not contain enough information to fully answer the query, briefly state what is missing and provide the best helpful answer you can.";
const DEFAULT_SYSTEM_PROMPT = `You are a precise, privacy-focused search synthesis engine. Your task is to generate a dense, objective overview that directly answers the user's query using ONLY the provided "--- SOURCE N ---" search excerpts.

### Core Rules
1. **Strict Grounding:** Base every statement exclusively on the provided sources. Never rely on prior training data, assume unstated facts, or extrapolate to fill gaps.
2. **Preserve Granularity:** Retain concrete details from the sources—such as exact numbers, units, configuration flags, function/API names, dates, versions, and proper nouns—rather than summarizing them into vague generalizations.
3. **Calibrated Claims & Contradictions:** Mirror the exact certainty of the sources. Avoid absolute language if sources describe probabilities, trade-offs, or conditions. Explicitly report conflicting viewpoints or version differences neutrally if sources disagree.
4. **High Information Density:** Start directly with a 1–2 sentence core answer or definition. Eliminate introductory filler (e.g., "Based on the provided sources..."), transitional prose, and closing meta-commentary.
5. **Formatting:** Use clean Markdown: short sections, inline code spans for technical identifiers, and bullet points starting with **Bold Key Terms:** followed by concise facts.
6. **Strict Abstention:** If the provided sources do not contain enough information to answer the query or a part of it, briefly state what is missing and stop. Do not speculate or fall back on general knowledge.`;
let rustPort = null;

// rust backend connection
function connectToRust() {
    console.log("Attempting to connect to Native Host:", HOST_NAME);
    rustPort = browser.runtime.connectNative(HOST_NAME);

    rustPort.onMessage.addListener((response) => {
        console.log("SUCCESS! Received from Rust:", response);
        browser.runtime.sendMessage({
            ...response,
            type: response.type || "RUST_REPLY"
        }).catch(err => console.warn("Sidebar not ready/open to receive backend message:", err));
    });

    rustPort.onDisconnect.addListener((port) => {
        const errorMsg = port?.error?.message || browser.runtime.lastError?.message;
        rustPort = null;
        if (errorMsg) {
            console.error("FATAL: Disconnected from Rust. Reason:", errorMsg);
            browser.runtime.sendMessage({
                type: "RUST_REPLY",
                status: "Error",
                received_query: "Connection Error",
                message: "Error: " + errorMsg
            }).catch(() => {});
        } else {
            console.warn("Rust port disconnected normally.");
        }
    });
}

function ensureRustPort() {
    if (!rustPort) {
        connectToRust();
    }
    return rustPort;
}

// handle config requests (e.g. dynamic model discovery) from sidebar.js
browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "FETCH_MODELS") {
        const ollamaInstance = (msg.ollamaInstance || DEFAULT_OLLAMA_INSTANCE).trim();
        try {
            const port = ensureRustPort();
            port.postMessage({
                action: "GET_MODELS",
                ollamaInstance: ollamaInstance
            });
        } catch (e) {
            console.error("FATAL: Failed to request models from Rust:", e);
            rustPort = null;
            browser.runtime.sendMessage({
                type: "MODELS_LIST",
                status: "Error",
                models: [],
                message: "Backend connection error: " + e.message
            }).catch(() => {});
        }
    }
});

// top n url scraper
async function getTopSearchResults(targetTabId, candidateLimit) {
    try {
        if (!targetTabId) return [];

        // inject scraping function
        const injectionResults = await browser.scripting.executeScript({
            target: {tabId: targetTabId},
            args: [candidateLimit],
            func: async (limit) => {
                // Google: '#search .g a:has(h3)', '#search a:has(h3)'
                // DuckDuckGo: 'a[data-testid="result-title-a"]'
                // Ecosia: '.result a.result-title', 'a[data-test-id="result-link"]'
                const selector = '#search .g a:has(h3), #search a:has(h3), a[data-testid="result-title-a"], .result a.result-title, a[data-test-id="result-link"]';
                const currentHost = window.location.hostname;

                const isExternalHost = (hostname) =>
                    hostname !== currentHost && !hostname.endsWith("." + currentHost);

                const resolveResultUrl = (href) => {
                    let parsedUrl;
                    try {
                        parsedUrl = new URL(href);
                    } catch (e) {
                        return null;
                    }
                    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
                        return null;
                    }
                    if (isExternalHost(parsedUrl.hostname)) {
                        return href;
                    }
                    // Unwrap plain redirect links (e.g. Google /url?q=... or DuckDuckGo /l/?uddg=...)
                    for (const param of ["q", "url", "uddg"]) {
                        const candidate = parsedUrl.searchParams.get(param);
                        if (candidate && (candidate.startsWith("http://") || candidate.startsWith("https://"))) {
                            try {
                                const target = new URL(candidate);
                                if (isExternalHost(target.hostname)) {
                                    return candidate;
                                }
                            } catch (e) {
                                // Ignore malformed redirect targets
                            }
                        }
                    }
                    // Pass through Google's opaque /goto?url=... redirects for the backend to resolve
                    if (parsedUrl.pathname === "/goto" && parsedUrl.searchParams.has("url")) {
                        return href;
                    }
                    return null;
                };

                const extractExternalUrls = () => {
                    const linkNodes = document.querySelectorAll(selector);
                    const found = [];
                    for (const node of linkNodes) {
                        const resolved = resolveResultUrl(node.href);
                        if (resolved && !found.includes(resolved)) {
                            found.push(resolved);
                        }
                        if (found.length >= limit) break;
                    }
                    return found;
                };

                // Wait for search pages (Google, DuckDuckGo, Ecosia) to finish mounting enough result links
                let urls = extractExternalUrls();
                const minDesired = Math.min(limit, 8);
                for (let attempt = 0; attempt < 24 && urls.length < minDesired; attempt++) {
                    await new Promise(r => setTimeout(r, 60));
                    const nextUrls = extractExternalUrls();
                    // If we already have some links and the count stabilized for several ticks after 300ms, stop early
                    if (attempt >= 6 && nextUrls.length >= 4 && nextUrls.length === urls.length) {
                        urls = nextUrls;
                        break;
                    }
                    urls = nextUrls;
                }
                return urls;
            }
        });

        if (!injectionResults || injectionResults.length === 0) return [];

        // return scraping results
        const scrapedUrls = injectionResults[0].result || [];
        console.log("Scraped URLs:", scrapedUrls);
        return scrapedUrls;

    } catch (error) {
        console.warn("Could not inject script into the current tab:", error.message);
        return [];
    }
}

async function enforceSidebarTitle(tabId, windowId) {
    if (!browser.sidebarAction.setTitle) return;
    if (!(await browser.sidebarAction.isOpen({ windowId }))) return;

    const apply = () => {
        browser.sidebarAction.setTitle({ title: "Ollamaview" }).catch(() => {});
        if (windowId !== undefined) {
            browser.sidebarAction.setTitle({ title: "Ollamaview", windowId }).catch(() => {});
        }
        if (tabId !== undefined) {
            browser.sidebarAction.setTitle({ title: "Ollamaview", tabId }).catch(() => {});
        }
    };

    apply();
    // Re-apply after other extensions (e.g. Bitwarden) finish their async tab listeners
    setTimeout(apply, 100);
    setTimeout(apply, 350);
}

// Keep sidebar header title synced when switching or opening tabs
browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
    enforceSidebarTitle(tabId, windowId);
});

// listen to all tab updates (async)
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tab.active && (changeInfo.status === "complete" || changeInfo.title)) {
        enforceSidebarTitle(tabId, tab.windowId);
    }

    if (changeInfo.status === "complete" && tab.url && tab.active) {
        // Stay out of the user's way: do nothing unless the sidebar was manually opened first
        const isSidebarOpen = await browser.sidebarAction.isOpen({ windowId: tab.windowId });
        if (!isSidebarOpen) {
            return;
        }

        let url;
        try {
            url = new URL(tab.url);
        } catch (e) {
            return;
        }

        if (url.hostname.includes("duckduckgo.com") || url.hostname.includes("ecosia.org") || url.hostname.includes("google.com")) {
            const query = url.searchParams.get("q");

            if (query) {
                const stored = await browser.storage.local.get([
                    "ollamaInstance",
                    "mainModel",
                    "responseLanguage",
                    "thinkingMode",
                    "includeCitations",
                    "maxSources",
                    "contextSize",
                    "queryExpansion",
                    "helperModel",
                    "systemPrompt"
                ]);
                const ollamaInstance = (stored.ollamaInstance || DEFAULT_OLLAMA_INSTANCE).trim();
                const mainModel = (stored.mainModel || "").trim();
                const responseLanguage = (stored.responseLanguage || "auto").trim();
                const thinkingMode = Boolean(stored.thinkingMode);
                const includeCitations = stored.includeCitations !== undefined ? Boolean(stored.includeCitations) : true;
                const maxSources = Math.min(8, Math.max(2, Number(stored.maxSources) || DEFAULT_MAX_SOURCES));
                const contextSize = Number(stored.contextSize) || DEFAULT_CONTEXT_SIZE;
                const queryExpansion = Boolean(stored.queryExpansion);
                const helperModel = (stored.helperModel || mainModel).trim();
                const rawStoredPrompt = (stored.systemPrompt || "").trim();
                const systemPrompt = (!rawStoredPrompt || rawStoredPrompt === LEGACY_DEFAULT_SYSTEM_PROMPT)
                    ? DEFAULT_SYSTEM_PROMPT
                    : rawStoredPrompt;

                if (!mainModel) {
                    browser.runtime.sendMessage({
                        type: "RUST_REPLY",
                        status: "Error",
                        received_query: query,
                        message: "No Ollama model selected. Open Config above to set your endpoint and select a model."
                    }).catch(() => {});
                    return;
                }

                try {
                    ensureRustPort();
                } catch (e) {
                    console.error("FATAL: connectToRust crashed:", e);
                    return;
                }

                // Safely send the message to the sidebar.
                // We catch the error if the sidebar isn't open so it doesn't halt the script.
                browser.runtime.sendMessage({ type: "THINKING", query: query })
                    .catch(err => console.warn("Sidebar not ready/open to receive THINKING state."));

                // Scrape extra fallback URLs in case sites block scrapers, return cookie stubs, or time out
                const urls = await getTopSearchResults(tabId, maxSources + 5);

                const payload = {
                    query: query,
                    urls: urls,
                    ollamaInstance: ollamaInstance,
                    mainModel: mainModel,
                    responseLanguage: responseLanguage,
                    thinkingMode: thinkingMode,
                    includeCitations: includeCitations,
                    maxSources: maxSources,
                    contextSize: contextSize,
                    queryExpansion: queryExpansion,
                    helperModel: helperModel,
                    systemPrompt: systemPrompt
                };
                console.log("Sending exact payload to Rust:", JSON.stringify(payload));

                try {
                    rustPort.postMessage(payload);
                } catch (e) {
                    console.error("FATAL: Failed to send to Rust:", e.message);
                    rustPort = null;
                    browser.runtime.sendMessage({
                        type: "RUST_REPLY",
                        status: "Error",
                        received_query: query,
                        message: "Error sending request to backend: " + e.message
                    }).catch(() => {});
                }
            }
        }
    }
});
