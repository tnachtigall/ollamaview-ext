const HOST_NAME = "com.till.ollamaview";
let rustPort = null;

// rust backend connection
function connectToRust() {
    console.log("Attempting to connect to Native Host:", HOST_NAME);
    rustPort = browser.runtime.connectNative(HOST_NAME);

    rustPort.onMessage.addListener((response) => {
        console.log("SUCCESS! Received from Rust:", response);
        browser.runtime.sendMessage({
            ...response,
            type: "RUST_REPLY"
        });
    });

    rustPort.onDisconnect.addListener((_) => {
        rustPort = null;
        if (browser.runtime.lastError) {
            console.error("FATAL: Disconnected from Rust. Reason:", browser.runtime.lastError.message);
            browser.runtime.sendMessage({ type: "RUST_REPLY", text: "Error: " + browser.runtime.lastError.message });
        } else {
            console.warn("Rust port disconnected normally.");
        }
    });
}

// top n url scraper
let maxResults = 5; // TODO: add this variable to a config page / file

async function getTopSearchResults(targetTabId) {
    try {
        if (!targetTabId) return [];

        // inject scraping function
        const injectionResults = await browser.scripting.executeScript({
            target: {tabId: targetTabId},
            args: [maxResults],
            func: (limit) => {
                // Google: '#search .g a'
                // DuckDuckGo: 'a[data-testid="result-title-a"]'
                // ecosia: '.result a.result-title'
                const linkNodes = document.querySelectorAll('#search .g a:has(h3), a[data-testid="result-title-a"], .result a.result-title');
                const currentHost = window.location.hostname;

                let urls = [];
                for (let node of linkNodes) {
                    let href = node.href;

                    try {
                        let parsedUrl = new URL(href);

                        // filter out links back to curentHost
                        if ((parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") &&
                            parsedUrl.hostname !== currentHost) {
                            // dedup check
                            if (!urls.includes(href)) {
                                urls.push(href);
                            }
                        }
                    } catch (e) {
                        continue; //skip malformed urls
                    }

                    if (urls.length >= limit) break;
                }
                return urls;
            }
        });

        if (!injectionResults || injectionResults.length === 0) return [];

        // return scraping results
        const scrapedUrls = injectionResults[0].result;
        console.log("Scraped URLs:", scrapedUrls);
        return scrapedUrls;

    } catch (error) {
        console.warn("Could not inject script into the current tab:", error.message);
        return [];
    }
}

// listen to all tab updates (async)
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {

    if (changeInfo.status === "complete" && tab.url) {
        const url = new URL(tab.url);

        // TODO: Add more supported search engines
        if (url.hostname.includes("duckduckgo.com") || url.hostname.includes("ecosia.org") || url.hostname.includes("google.com")) {

            const query = url.searchParams.get("q");

            if (query) {
                // connect to rust backend if not already connected
                if (!rustPort) connectToRust();

                // send message to sidebar
                browser.runtime.sendMessage({ type: "THINKING", query: query });

                // scrape top n urls
                const urls = await getTopSearchResults(tabId);

                // send query and results to rust backend
                rustPort.postMessage({ query: query, urls: urls });
            }
        }
    }
});