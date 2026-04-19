const queryDisplay = document.getElementById("queryDisplay");
const outputDiv = document.getElementById("output");

// Listen for messages from our background.js script
browser.runtime.onMessage.addListener((response) => {
    if (response && response.type === "RUST_REPLY") {
        outputDiv.textContent = response.message;
        queryDisplay.textContent = response.received_query;
    }
    else if (response && response.type === "THINKING") {
        outputDiv.textContent = "Rust is processing...";
        queryDisplay.textContent = "Search: " + response.query;
    }
    else {
        // Fallback for debugging if it's still a simple string
        outputDiv.textContent = typeof response === 'string' ? response : JSON.stringify(response);
    }
});