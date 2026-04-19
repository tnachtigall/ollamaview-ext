const HOST_NAME = "com.till.ollamaview";
let rustPort = null;

// 1. Establish connection to Rust
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

// 2. Listen to all tab updates
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only trigger when the page finishes loading
    if (changeInfo.status === "complete" && tab.url) {
        const url = new URL(tab.url);
        
        // TODO: Add a config file for supported search engines
        if (url.hostname.includes("duckduckgo.com") || url.hostname.includes("ecosia.org")) {
            
            // Both search engines use "?q=your+search" in their URLs
            const query = url.searchParams.get("q"); 
            
            if (query) {
                // Force the sidebar open (Firefox specific feature)
                // browser.sidebarAction.open(); 
                
                // Connect to Rust if not already connected
                if (!rustPort) connectToRust();
                
                // Tell the sidebar we are starting
                browser.runtime.sendMessage({ type: "THINKING", query: query });
                
                // Send the raw query to your Rust binary
                rustPort.postMessage({ query: query });
            }
        }
    }
});