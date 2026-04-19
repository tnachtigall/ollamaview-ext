const queryDisplay = document.getElementById("queryDisplay");
const outputDiv = document.getElementById("output");

// Listen for messages from our background.js script
browser.runtime.onMessage.addListener((message) => {
    if (message.type === "THINKING") {
        queryDisplay.textContent = "Search: " + message.query;
        outputDiv.textContent = "Rust is processing...";
    } 
    else if (message.type === "RUST_REPLY") {
        outputDiv.textContent = message.text;
    }
});