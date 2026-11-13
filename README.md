# ollamaview-ext

Local, zero-telemetry AI search overview for **Firefox** and Gecko-based browsers (**LibreWolf**, **Zen**, **Waterfox**, **Floorp**), powered directly by your local **Ollama** instance.

This extension acts as a frontend for the native messaging host [`ollamaview`](https://github.com/tnachtigall/ollamaview)

When the sidebar is open on your search engine, the extension extracts organic search result URLs and passes them to the local Rust native host, streaming back a grounded, cited Markdown overview. When the sidebar is closed, the extension remains completely inactive.

---

## Features

- **Strictly Passive & Private:** Zero cloud APIs, zero telemetry, and no background scraping when the sidebar is closed.
- **Organic Results Only:** Ignores ads and search-engine AI blocks, scrapes only external organic links.
- **Native Theme & Localization:** Automatically syncs with your Firefox/Gecko theme.
- **Clickable Citations & Rich Markdown:** Renders response as Markdown with inline source citation badges and a reference list.

---

## Installation

> **Note:** This extension is not yet signed or published on Mozilla Add-ons (AMO) and can currently only be loaded as a temporary add-on.

### 1. Set Up the Native Backend
This extension requires the local Rust host ([`ollamaview`](https://github.com/tnachtigall/ollamaview)) and a running **Ollama** instance. Follow the [backend build & native messaging setup instructions](https://github.com/tnachtigall/ollamaview#setup) to compile `ollamaview` and register `ollamaview.host.json`.

### 2. Load the Extension
1. Clone this repository:
   ```bash
   git clone https://github.com/tnachtigall/ollamaview-ext.git
   ```
2. Open `about:debugging#/runtime/this-firefox` in your browser.
3. Click **Load Temporary Add-on...** and select `manifest.json` inside `ollamaview-ext`.
4. Open the extension in the sidebar, click **⚙ Config**, click **Fetch** next to your Ollama endpoint, and pick your model (e.g., `gemma4:12B`).

---

See the backend repository [`ollamaview` repository](https://github.com/tnachtigall/ollamaview) for architecture details and model recommendations
