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

> **Note:** This extension is not yet listed on the Mozilla Add-on Market Place

### 1. Set Up the Native Backend
This extension requires the local Rust host ([`ollamaview`](https://github.com/tnachtigall/ollamaview)) and a running **Ollama** instance. Follow the [backend build & native messaging setup instructions](https://github.com/tnachtigall/ollamaview#setup) to compile `ollamaview` and register `ollamaview.host.json`.

### 2. Load the Extension
1. go to the Releases Tab of this repository and open the latest release
2. under Assets, click on the ".xpi" file
3.1 your browser should automatically prompt you to install the add-on
3.2 if not, download the file, type about:addons into your firefox url bar and drag and drop the xpi file into the browser window
4. open the newly installed extension in the sidebar and configure your ollama endpoint and model

---

See the backend repository [`ollamaview`](https://github.com/tnachtigall/ollamaview) for architecture details and model recommendations
