const HOST_NAME = "com.till.ollamaview";
const DEFAULT_OLLAMA_INSTANCE = "http://127.0.0.1:11434";
const DEFAULT_CONTEXT_SIZE = 4096;
const DEFAULT_SYSTEM_PROMPT = "You are a helpful, privacy-focused search assistant. Using the provided web search sources, write a clear, concise, and accurate overview that directly answers the user's search query. Format your response in clean Markdown (such as bullet points, bold key terms, and short sections where helpful). Synthesize key facts from the sources, stay objective, and avoid speculation. If the sources do not contain enough information to fully answer the query, briefly state what is missing and provide the best helpful answer you can.";
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
let maxResults = 5; // TODO: add this variable to a config page / file

async function getTopSearchResults(targetTabId) {
    try {
        if (!targetTabId) return [];

        // inject scraping function
        const injectionResults = await browser.scripting.executeScript({
            target: {tabId: targetTabId},
            args: [maxResults],
            func: async (limit) => {
                // Google: '#search .g a:has(h3)', '#search a:has(h3)'
                // DuckDuckGo: 'a[data-testid="result-title-a"]'
                // Ecosia: '.result a.result-title', 'a[data-test-id="result-link"]'
                const selector = '#search .g a:has(h3), #search a:has(h3), a[data-testid="result-title-a"], .result a.result-title, a[data-test-id="result-link"]';
                const currentHost = window.location.hostname;

                // Wait briefly for client-rendered search pages (like DuckDuckGo) to mount results
                let linkNodes = document.querySelectorAll(selector);
                for (let attempt = 0; attempt < 20 && linkNodes.length === 0; attempt++) {
                    await new Promise(r => setTimeout(r, 50));
                    linkNodes = document.querySelectorAll(selector);
                }

                let urls = [];
                for (let node of linkNodes) {
                    let href = node.href;

                    try {
                        let parsedUrl = new URL(href);

                        // filter out links back to currentHost
                        if ((parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") &&
                            parsedUrl.hostname !== currentHost &&
                            !parsedUrl.hostname.endsWith("." + currentHost)) {
                            // dedup check
                            if (!urls.includes(href)) {
                                urls.push(href);
                            }
                        }
                    } catch (e) {
                        continue; // skip malformed urls
                    }

                    if (urls.length >= limit) break;
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
                const stored = await browser.storage.local.get(["ollamaInstance", "mainModel", "contextSize", "systemPrompt"]);
                const ollamaInstance = (stored.ollamaInstance || DEFAULT_OLLAMA_INSTANCE).trim();
                const mainModel = (stored.mainModel || "").trim();
                const contextSize = Number(stored.contextSize) || DEFAULT_CONTEXT_SIZE;
                const systemPrompt = (stored.systemPrompt || DEFAULT_SYSTEM_PROMPT).trim();

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

                const urls = await getTopSearchResults(tabId);

                const payload = {
                    query: query,
                    urls: urls,
                    ollamaInstance: ollamaInstance,
                    mainModel: mainModel,
                    contextSize: contextSize,
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
