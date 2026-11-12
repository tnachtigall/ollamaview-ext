
const DEFAULT_OLLAMA_INSTANCE = "http://127.0.0.1:11434";
const DEFAULT_MAX_SOURCES = 5;
const DEFAULT_CONTEXT_SIZE = 4096;
const DEFAULT_SYSTEM_PROMPT = "You are a helpful, privacy-focused search assistant. Using the provided web search sources, write a clear, concise, and accurate overview that directly answers the user's search query. Format your response in clean Markdown (such as bullet points, bold key terms, and short sections where helpful). Synthesize key facts from the sources, stay objective, and avoid speculation. If the sources do not contain enough information to fully answer the query, briefly state what is missing and provide the best helpful answer you can.";

const queryDisplay = document.getElementById("queryDisplay");
const outputDiv = document.getElementById("output");
const configToggleBtn = document.getElementById("configToggleBtn");
const configPanel = document.getElementById("configPanel");
const ollamaEndpointInput = document.getElementById("ollamaEndpoint");
const fetchModelsBtn = document.getElementById("fetchModelsBtn");
const modelSelect = document.getElementById("modelSelect");
const thinkingModeInput = document.getElementById("thinkingMode");
const advancedToggleInput = document.getElementById("advancedToggle");
const advancedSection = document.getElementById("advancedSection");
const maxSourcesInput = document.getElementById("maxSources");
const maxSourcesValue = document.getElementById("maxSourcesValue");
const contextSizeInput = document.getElementById("contextSize");
const contextSizeValue = document.getElementById("contextSizeValue");
const systemPromptInput = document.getElementById("systemPrompt");
const resetPromptBtn = document.getElementById("resetPromptBtn");
const saveConfigBtn = document.getElementById("saveConfigBtn");
const configStatus = document.getElementById("configStatus");

let savedModel = "";

// --- Firefox Theme Synchronization ---
function applyFirefoxTheme(theme) {
    const root = document.documentElement;
    const colors = theme && theme.colors ? theme.colors : null;

    const props = ["--bg", "--fg", "--muted", "--surface", "--input-bg", "--input-fg", "--border", "--accent"];
    if (!colors) {
        props.forEach(p => root.style.removeProperty(p));
        return;
    }

    const bg = colors.sidebar || colors.ntp_background || colors.frame;
    const fg = colors.sidebar_text || colors.ntp_text || colors.toolbar_text;
    const surface = colors.popup || colors.toolbar || colors.toolbar_field;
    const inputBg = colors.toolbar_field || colors.popup || bg;
    const inputFg = colors.toolbar_field_text || colors.popup_text || fg;
    const border = colors.sidebar_border || colors.toolbar_field_border || colors.popup_border;
    const accent = colors.sidebar_highlight || colors.button_background_active || colors.tab_line;

    if (bg) root.style.setProperty("--bg", bg);
    if (fg) {
        root.style.setProperty("--fg", fg);
        root.style.setProperty("--muted", `color-mix(in srgb, ${fg} 70%, transparent)`);
    }
    if (surface) {
        root.style.setProperty("--surface", surface);
    } else if (bg && fg) {
        root.style.setProperty("--surface", `color-mix(in srgb, ${bg} 92%, ${fg})`);
    }
    if (inputBg) root.style.setProperty("--input-bg", inputBg);
    if (inputFg) root.style.setProperty("--input-fg", inputFg);
    if (border) {
        root.style.setProperty("--border", border);
    } else if (fg) {
        root.style.setProperty("--border", `color-mix(in srgb, ${fg} 22%, transparent)`);
    }
    if (accent) root.style.setProperty("--accent", accent);
}

if (typeof browser !== "undefined" && browser.sidebarAction && browser.sidebarAction.setTitle) {
    browser.sidebarAction.setTitle({ title: "Ollamaview" }).catch(() => {});
}

if (typeof browser !== "undefined" && browser.theme) {
    browser.theme.getCurrent().then(applyFirefoxTheme).catch(() => {});
    if (browser.theme.onUpdated) {
        browser.theme.onUpdated.addListener(({ theme }) => applyFirefoxTheme(theme));
    }
}

// --- Safe DOM Markdown Renderer ---
function appendInlineMarkdown(parent, text) {
    // Tokenize inline code, links, bold+italic, bold, italic, and strikethrough
    const tokenRegex = /(`[^`]+`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*\*([^*]+)\*\*\*)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)|(~~([^~]+)~~)/g;
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        if (match[1]) {
            const code = document.createElement("code");
            code.textContent = match[1].slice(1, -1);
            parent.appendChild(code);
        } else if (match[2]) {
            const a = document.createElement("a");
            a.href = match[4];
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            appendInlineMarkdown(a, match[3]);
            parent.appendChild(a);
        } else if (match[5]) {
            const strong = document.createElement("strong");
            const em = document.createElement("em");
            appendInlineMarkdown(em, match[6]);
            strong.appendChild(em);
            parent.appendChild(strong);
        } else if (match[7] || match[9]) {
            const strong = document.createElement("strong");
            appendInlineMarkdown(strong, match[8] || match[10]);
            parent.appendChild(strong);
        } else if (match[11] || match[13]) {
            const em = document.createElement("em");
            appendInlineMarkdown(em, match[12] || match[14]);
            parent.appendChild(em);
        } else if (match[15]) {
            const del = document.createElement("del");
            appendInlineMarkdown(del, match[16]);
            parent.appendChild(del);
        }

        lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < text.length) {
        parent.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
}

function parseTableRow(line) {
    let trimmed = line.trim();
    if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
    if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
    return trimmed.split("|").map(cell => cell.trim());
}

function renderMarkdown(container, markdown) {
    container.replaceChildren();
    if (!markdown) return;

    const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip empty lines
        if (!trimmed) {
            i++;
            continue;
        }

        // Fenced code blocks (```)
        if (trimmed.startsWith("```")) {
            const codeLines = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith("```")) {
                codeLines.push(lines[i]);
                i++;
            }
            if (i < lines.length) i++; // skip closing ```
            const pre = document.createElement("pre");
            const code = document.createElement("code");
            code.textContent = codeLines.join("\n");
            pre.appendChild(code);
            container.appendChild(pre);
            continue;
        }

        // Horizontal rule
        if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
            container.appendChild(document.createElement("hr"));
            i++;
            continue;
        }

        // Headings (# to ######)
        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const h = document.createElement(`h${level}`);
            appendInlineMarkdown(h, headingMatch[2]);
            container.appendChild(h);
            i++;
            continue;
        }

        // GFM Tables
        if (
            trimmed.includes("|") &&
            i + 1 < lines.length &&
            /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[i + 1])
        ) {
            const headers = parseTableRow(line);
            i += 2; // skip header and separator row
            const wrap = document.createElement("div");
            wrap.className = "table-wrap";
            const table = document.createElement("table");
            const thead = document.createElement("thead");
            const trHead = document.createElement("tr");
            headers.forEach(hText => {
                const th = document.createElement("th");
                appendInlineMarkdown(th, hText);
                trHead.appendChild(th);
            });
            thead.appendChild(trHead);
            table.appendChild(thead);

            const tbody = document.createElement("tbody");
            while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim() !== "") {
                const cells = parseTableRow(lines[i]);
                const tr = document.createElement("tr");
                cells.forEach(cText => {
                    const td = document.createElement("td");
                    appendInlineMarkdown(td, cText);
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
                i++;
            }
            table.appendChild(tbody);
            wrap.appendChild(table);
            container.appendChild(wrap);
            continue;
        }

        // Blockquotes (> ...)
        if (trimmed.startsWith(">")) {
            const quoteLines = [];
            while (i < lines.length && lines[i].trim().startsWith(">")) {
                quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
                i++;
            }
            const bq = document.createElement("blockquote");
            appendInlineMarkdown(bq, quoteLines.join(" "));
            container.appendChild(bq);
            continue;
        }

        // Unordered or Ordered Lists
        const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
        const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
        if (ulMatch || olMatch) {
            const isOrdered = Boolean(olMatch);
            const listEl = document.createElement(isOrdered ? "ol" : "ul");
            const itemPattern = isOrdered ? /^(\s*)\d+\.\s+(.+)$/ : /^(\s*)[-*+]\s+(.+)$/;

            while (i < lines.length) {
                const m = lines[i].match(itemPattern);
                if (!m) break;
                const li = document.createElement("li");
                appendInlineMarkdown(li, m[2]);
                listEl.appendChild(li);
                i++;
            }
            container.appendChild(listEl);
            continue;
        }

        // Paragraph
        const paraLines = [];
        while (
            i < lines.length &&
            lines[i].trim() !== "" &&
            !lines[i].trim().startsWith("```") &&
            !lines[i].trim().startsWith(">") &&
            !/^(#{1,6})\s+/.test(lines[i].trim()) &&
            !/^(?:---+|\*\*\*+|___+)$/.test(lines[i].trim()) &&
            !/^(\s*)(?:[-*+]|\d+\.)\s+/.test(lines[i])
        ) {
            paraLines.push(lines[i].trim());
            i++;
        }
        if (paraLines.length > 0) {
            const p = document.createElement("p");
            appendInlineMarkdown(p, paraLines.join(" "));
            container.appendChild(p);
        } else {
            i++;
        }
    }
}

function setConfigStatus(text, isError = false) {
    configStatus.textContent = text;
    configStatus.style.color = isError ? "var(--error)" : "var(--muted)";
}

function populateModelsDropdown(models, preferredModel) {
    modelSelect.replaceChildren();
    if (!models || models.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "-- No models available --";
        modelSelect.appendChild(opt);
        return "";
    }

    for (const modelName of models) {
        const opt = document.createElement("option");
        opt.value = modelName;
        opt.textContent = modelName;
        modelSelect.appendChild(opt);
    }

    if (preferredModel && models.includes(preferredModel)) {
        modelSelect.value = preferredModel;
    } else {
        modelSelect.value = models[0];
    }
    return modelSelect.value;
}

function requestModels(endpoint) {
    const cleanEndpoint = (endpoint || DEFAULT_OLLAMA_INSTANCE).trim();
    ollamaEndpointInput.value = cleanEndpoint;
    setConfigStatus("Querying models...");
    browser.runtime.sendMessage({
        type: "FETCH_MODELS",
        ollamaInstance: cleanEndpoint
    }).catch(err => {
        setConfigStatus("Failed to contact background script: " + err.message, true);
    });
}

function formatSourcesLabel(val) {
    const n = Number(val) || DEFAULT_MAX_SOURCES;
    const maxVal = Number(maxSourcesInput.max) || 8;
    let tier = "Balanced";
    if (n <= 3) tier = "Focused";
    else if (n <= 5) tier = "Balanced";
    else if (n < maxVal) tier = "Broad";
    else tier = "Max Breadth";
    return `${n} sources (${tier})`;
}

function formatContextLabel(val) {
    const n = Number(val) || DEFAULT_CONTEXT_SIZE;
    let tier = "Balanced";
    if (n <= 2048) tier = "Fastest";
    else if (n <= 4096) tier = "Balanced";
    else if (n <= 6144) tier = "Deep";
    else tier = "Max Depth";
    return `${n} tokens (${tier})`;
}

async function saveConfig() {
    const ollamaInstance = (ollamaEndpointInput.value || DEFAULT_OLLAMA_INSTANCE).trim();
    const mainModel = (modelSelect.value || "").trim();
    const thinkingMode = Boolean(thinkingModeInput.checked);
    const advancedMode = Boolean(advancedToggleInput.checked);
    const maxSources = Math.min(8, Math.max(2, Number(maxSourcesInput.value) || DEFAULT_MAX_SOURCES));
    const contextSize = Math.min(8192, Math.max(2048, Number(contextSizeInput.value) || DEFAULT_CONTEXT_SIZE));
    const systemPrompt = (systemPromptInput.value || "").trim() || DEFAULT_SYSTEM_PROMPT;
    systemPromptInput.value = systemPrompt;
    maxSourcesValue.textContent = formatSourcesLabel(maxSources);
    contextSizeValue.textContent = formatContextLabel(contextSize);
    savedModel = mainModel;
    await browser.storage.local.set({
        ollamaInstance,
        mainModel,
        thinkingMode,
        advancedMode,
        maxSources,
        contextSize,
        systemPrompt
    });
    setConfigStatus(mainModel ? `Saved (${mainModel})` : "Saved config");
}

configToggleBtn.addEventListener("click", () => {
    configPanel.classList.toggle("open");
});

fetchModelsBtn.addEventListener("click", () => {
    requestModels(ollamaEndpointInput.value);
});

ollamaEndpointInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        requestModels(ollamaEndpointInput.value);
    }
});

modelSelect.addEventListener("change", () => {
    saveConfig();
});

thinkingModeInput.addEventListener("change", () => {
    saveConfig();
});

advancedToggleInput.addEventListener("change", () => {
    advancedSection.classList.toggle("open", advancedToggleInput.checked);
    saveConfig();
});

resetPromptBtn.addEventListener("click", () => {
    systemPromptInput.value = DEFAULT_SYSTEM_PROMPT;
    saveConfig();
});

maxSourcesInput.addEventListener("input", () => {
    maxSourcesValue.textContent = formatSourcesLabel(maxSourcesInput.value);
});

maxSourcesInput.addEventListener("change", () => {
    saveConfig();
});

contextSizeInput.addEventListener("input", () => {
    contextSizeValue.textContent = formatContextLabel(contextSizeInput.value);
});

contextSizeInput.addEventListener("change", () => {
    saveConfig();
});

saveConfigBtn.addEventListener("click", () => {
    saveConfig();
});

// Initialize config state on sidebar load
(async function initConfig() {
    const stored = await browser.storage.local.get([
        "ollamaInstance",
        "mainModel",
        "thinkingMode",
        "advancedMode",
        "maxSources",
        "contextSize",
        "systemPrompt"
    ]);
    const endpoint = stored.ollamaInstance || DEFAULT_OLLAMA_INSTANCE;
    const thinkingMode = Boolean(stored.thinkingMode);
    const advancedMode = Boolean(stored.advancedMode);
    const maxSources = Math.min(8, Math.max(2, Number(stored.maxSources) || DEFAULT_MAX_SOURCES));
    const contextSize = Math.min(8192, Math.max(2048, Number(stored.contextSize) || DEFAULT_CONTEXT_SIZE));
    const systemPrompt = (stored.systemPrompt && stored.systemPrompt.trim())
        ? stored.systemPrompt
        : DEFAULT_SYSTEM_PROMPT;
    savedModel = stored.mainModel || "";
    ollamaEndpointInput.value = endpoint;
    thinkingModeInput.checked = thinkingMode;
    advancedToggleInput.checked = advancedMode;
    advancedSection.classList.toggle("open", advancedMode);
    maxSourcesInput.value = maxSources;
    maxSourcesValue.textContent = formatSourcesLabel(maxSources);
    contextSizeInput.value = contextSize;
    contextSizeValue.textContent = formatContextLabel(contextSize);
    systemPromptInput.value = systemPrompt;

    if (!stored.systemPrompt || !stored.contextSize || !stored.maxSources) {
        await browser.storage.local.set({ systemPrompt, maxSources, contextSize, thinkingMode, advancedMode });
    }

    if (!savedModel) {
        configPanel.classList.add("open");
    }

    requestModels(endpoint);
})();

let pendingMarkdown = null;
let rafScheduled = false;

function scheduleMarkdownRender(text) {
    pendingMarkdown = text;
    if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(() => {
            rafScheduled = false;
            if (pendingMarkdown !== null) {
                renderMarkdown(outputDiv, pendingMarkdown);
                pendingMarkdown = null;
            }
        });
    }
}

// listen for messages from background.js script
browser.runtime.onMessage.addListener(async (response) => {
    if (!response) return;

    if (response.type === "MODELS_LIST") {
        const models = response.models || [];
        const isError = response.status === "Error";
        const selected = populateModelsDropdown(models, savedModel);
        setConfigStatus(response.message || (models.length ? `Loaded ${models.length} model(s)` : "No models found"), isError);

        // Auto-save first available model if none was previously saved
        if (selected && selected !== savedModel) {
            savedModel = selected;
            await browser.storage.local.set({
                ollamaInstance: (ollamaEndpointInput.value || DEFAULT_OLLAMA_INSTANCE).trim(),
                mainModel: selected
            });
        }
    }
    else if (response.type === "RUST_REPLY") {
        const msg = response.message ?? response.text ?? "";
        scheduleMarkdownRender(msg);
        if (response.received_query) {
            queryDisplay.textContent = "Search: " + response.received_query;
        }
    }
    else if (response.type === "THINKING") {
        scheduleMarkdownRender("*Generating overview...*");
        queryDisplay.textContent = "Search: " + response.query;
    }
    else {
        // Fallback for debugging if it's still a simple string
        const fallback = typeof response === "string" ? response : JSON.stringify(response);
        renderMarkdown(outputDiv, fallback);
    }
});
