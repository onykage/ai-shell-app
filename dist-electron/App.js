"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = App;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const highlight_js_1 = require("highlight.js");
require("highlight.js/styles/github-dark.css");
const marked_1 = require("marked");
const dompurify_1 = require("dompurify");
const react_codemirror_1 = require("@uiw/react-codemirror");
const commands_1 = require("@codemirror/commands");
const view_1 = require("@codemirror/view");
const cmPaneScrollTheme = view_1.EditorView.theme({
    "&": { height: "auto" },
    ".cm-scroller": { overflow: "visible" }
});
const search_1 = require("@codemirror/search");
const theme_one_dark_1 = require("@codemirror/theme-one-dark");
const lang_javascript_1 = require("@codemirror/lang-javascript");
const lang_html_1 = require("@codemirror/lang-html");
const lang_css_1 = require("@codemirror/lang-css");
const lang_json_1 = require("@codemirror/lang-json");
const lang_markdown_1 = require("@codemirror/lang-markdown");
const lang_python_1 = require("@codemirror/lang-python");
const language_1 = require("@codemirror/language");
const shell_1 = require("@codemirror/legacy-modes/mode/shell");
/* ---------------------- Markdown / Highlight ---------------------- */
marked_1.marked.setOptions({
    gfm: true,
    breaks: true,
    highlight(code, lang) {
        try {
            if (lang && highlight_js_1.default.getLanguage(lang))
                return highlight_js_1.default.highlight(code, { language: lang }).value;
            return highlight_js_1.default.highlightAuto(code).value;
        }
        catch {
            return code;
        }
    },
});
function renderMarkdown(md) {
    const html = marked_1.marked.parse(md);
    return dompurify_1.default.sanitize(html);
}
/* ---------------------- Helpers ---------------------- */
function extractCodeBlocks(md) {
    const blocks = [];
    const re = /```([a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(md)) !== null)
        blocks.push({ lang: (m[1] || "").trim(), code: m[2] ?? "" });
    return blocks;
}
function defaultFilenameFor(block, index) {
    const extMap = {
        typescript: "ts",
        ts: "ts",
        javascript: "js",
        js: "js",
        jsx: "jsx",
        tsx: "tsx",
        json: "json",
        yaml: "yml",
        yml: "yml",
        html: "html",
        css: "css",
        powershell: "ps1",
        ps: "ps1",
        bash: "sh",
        sh: "sh",
        python: "py",
        py: "py",
    };
    const ext = extMap[block.lang?.toLowerCase() ?? ""] || "txt";
    return `snippets/snippet-${index + 1}.${ext}`;
}
function fmtDuration(ms = 0) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}
function fmtClock(ts) {
    return ts ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";
}
function cmLangForFilename(name) {
    const ext = (name?.split(".").pop() || "").toLowerCase();
    switch (ext) {
        case "js": return (0, lang_javascript_1.javascript)();
        case "jsx": return (0, lang_javascript_1.javascript)({ jsx: true });
        case "ts": return (0, lang_javascript_1.javascript)({ typescript: true });
        case "tsx": return (0, lang_javascript_1.javascript)({ typescript: true, jsx: true });
        case "html":
        case "htm": return (0, lang_html_1.html)();
        case "css": return (0, lang_css_1.css)();
        case "json": return (0, lang_json_1.json)();
        case "md":
        case "markdown": return (0, lang_markdown_1.markdown)();
        case "py": return (0, lang_python_1.python)();
        case "sh": return language_1.StreamLanguage.define(shell_1.shell);
        case "ps1": return language_1.StreamLanguage.define(shell_1.shell); // fallback: use shell for PowerShell
        default: return []; // plain text
    }
}
const cmTheme = view_1.EditorView.theme({
    "&": { backgroundColor: "var(--panel)", color: "var(--text)", height: "100%" },
    ".cm-gutters": { backgroundColor: "var(--panel)", color: "var(--sub)", borderRight: "1px solid var(--border)" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.04)" },
});
function fmtBytes(n) {
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
/* HOTFIX: normalize any value to a string before using .replace etc. */
function toText(v) {
    if (typeof v === "string")
        return v;
    if (v == null)
        return "";
    if (typeof v.text === "string")
        return v.text;
    try {
        return "```json\n" + JSON.stringify(v, null, 2) + "\n```";
    }
    catch {
        return String(v);
    }
}
/* Auto-exec helpers */
const LANG_EXT = { powershell: "ps1", ps: "ps1", bash: "sh", sh: "sh", python: "py", py: "py" };
function langToExt(lang) {
    return LANG_EXT[(lang || "").toLowerCase()] || "txt";
}
function execCmdFor(ext, relPath) {
    switch (ext) {
        case "ps1":
            return `powershell -NoProfile -ExecutionPolicy Bypass -File "${relPath}"`;
        case "sh":
            return `bash "${relPath}"`;
        case "py":
            return `python "${relPath}"`;
        default:
            return "";
    }
}
/* ---- Summarizer helpers ---- */
const MAX_TRANSCRIPT_CHARS = 15000; // keep summary prompt compact
function serializeTranscript(chat) {
    const lines = [];
    let total = 0;
    for (let i = Math.max(0, chat.length - 300); i < chat.length; i++) {
        const m = chat[i];
        const role = m.from === "user" ? "USER" : "AI";
        const t = toText(m.text);
        const line = `\n[${role}] ${t}\n`;
        total += line.length;
        lines.push(line);
        while (total > MAX_TRANSCRIPT_CHARS && lines.length > 1) {
            total -= lines[0].length;
            lines.shift();
        }
    }
    return lines.join("");
}
const SUMMARIZER_PROMPT = `
You are a senior engineer creating a concise carryover for continuing development in a new chat.

Return STRICT JSON with keys:
- "carryover_md": a 150-250 word Markdown block the user can paste into a new chat to restore context.
- "decisions": bullet list of important decisions made.
- "open_issues": bullet list of unresolved items/to-dos.
- "ipc": array of IPC channel names currently in use.
- "files": array of notable files changed/touched.

Do not include any extra prose outside the JSON.
`;
/* ---------------------- Icons ---------------------- */
function IconCopy() {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", children: [(0, jsx_runtime_1.jsx)("path", { d: "M9 9h10v10H9z", stroke: "currentColor", strokeWidth: "1.5" }), (0, jsx_runtime_1.jsx)("path", { d: "M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1", stroke: "currentColor", strokeWidth: "1.5" })] }));
}
function IconSave() {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", children: [(0, jsx_runtime_1.jsx)("path", { d: "M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z", stroke: "currentColor", strokeWidth: "1.5" }), (0, jsx_runtime_1.jsx)("path", { d: "M8 7h6v4H8zM8 21v-6h8v6", stroke: "currentColor", strokeWidth: "1.5" })] }));
}
function IconSend() {
    return ((0, jsx_runtime_1.jsx)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", children: (0, jsx_runtime_1.jsx)("path", { d: "M3 11l18-8-8 18-2-7-8-3z", stroke: "currentColor", strokeWidth: "1.5" }) }));
}
function IconArrowOut() {
    return ((0, jsx_runtime_1.jsx)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", children: (0, jsx_runtime_1.jsx)("path", { d: "M7 17l10-10M9 7h8v8", stroke: "currentColor", strokeWidth: "1.5" }) }));
}
function IconImport() {
    return ((0, jsx_runtime_1.jsx)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", children: (0, jsx_runtime_1.jsx)("path", { d: "M4 20h16M12 4v10m0 0l4-4m-4 4l-4-4", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
function IconPaperclip() {
    return ((0, jsx_runtime_1.jsx)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", children: (0, jsx_runtime_1.jsx)("path", { d: "M21 8.5l-9.19 9.19a5 5 0 01-7.07-7.07L12.1 3.16a3.5 3.5 0 014.95 4.95L9.4 15.76a2 2 0 01-2.83-2.83L15 4.5", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
function IconX() {
    return ((0, jsx_runtime_1.jsx)("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", children: (0, jsx_runtime_1.jsx)("path", { d: "M6 6l12 12M18 6L6 18", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" }) }));
}
function IconGear() {
    return ((0, jsx_runtime_1.jsx)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", children: (0, jsx_runtime_1.jsx)("path", { d: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm8 4a8 8 0 0 0-.16-1.6l2.02-1.56-2-3.46-2.44.98A7.97 7.97 0 0 0 14.6 4l-.6-2.6h-4l-.6 2.6A7.97 7.97 0 0 0 6.58 6.36l-2.44-.98-2 3.46 2.02 1.56A7.99 7.99 0 0 0 4 12c0 .55.06 1.1.16 1.6l-2.02 1.56 2 3.46 2.44-.98A7.97 7.97 0 0 0 9.4 20l.6 2.6h4l.6-2.6a7.97 7.97 0 0 0 3.42-2.36l2.44.98 2-3.46-2.02-1.56c.1-.5.16-1.05.16-1.6z", stroke: "currentColor", strokeWidth: "1.2" }) }));
}
function IconFolderPlus() {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", children: [(0, jsx_runtime_1.jsx)("path", { d: "M3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2v12z", stroke: "currentColor", strokeWidth: "1.5" }), (0, jsx_runtime_1.jsx)("path", { d: "M12 12v6M9 15h6", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" })] }));
}
function IconSparkle() {
    return ((0, jsx_runtime_1.jsx)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", children: (0, jsx_runtime_1.jsx)("path", { d: "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z", stroke: "currentColor", strokeWidth: "1.2" }) }));
}
/* -------------------- end Icons -------------------- */
/* --------- New: Stop Icon + Model/Platform Badge --------- */
function IconStop() {
    return ((0, jsx_runtime_1.jsx)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", children: (0, jsx_runtime_1.jsx)("rect", { x: "6", y: "6", width: "12", height: "12", stroke: "currentColor", strokeWidth: "1.5" }) }));
}
function IconEye({ dimmed = false }) {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: "21", height: "21", viewBox: "0 0 24 24", fill: "none", children: [(0, jsx_runtime_1.jsx)("ellipse", { cx: "12", cy: "12", rx: "9", ry: "6", stroke: dimmed ? "#787878" : "currentColor", strokeWidth: "1.5", fill: "none" }), (0, jsx_runtime_1.jsx)("circle", { cx: "12", cy: "12", r: "2.6", fill: dimmed ? "#787878" : "currentColor", opacity: dimmed ? 0.35 : 1 })] }));
}
function IconEyeOff() {
    // Dimmed eye with a line through it
    return ((0, jsx_runtime_1.jsxs)("svg", { width: "21", height: "21", viewBox: "0 0 24 24", fill: "none", children: [(0, jsx_runtime_1.jsx)("ellipse", { cx: "12", cy: "12", rx: "9", ry: "6", stroke: "#787878", strokeWidth: "1.5", fill: "none", opacity: 0.55 }), (0, jsx_runtime_1.jsx)("circle", { cx: "12", cy: "12", r: "2.7", fill: "#787878", opacity: 0.26 }), (0, jsx_runtime_1.jsx)("line", { x1: "5", y1: "19", x2: "19", y2: "5", stroke: "#ba2626", strokeWidth: "2" })] }));
}
function textColorOn(bg) {
    // simple luminance check for black/white text
    const hex = bg.replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.54 ? "#111827" : "#ffffff";
}
function colorForProvider(p) {
    switch (p.toLowerCase()) {
        case "openai":
            return "#10a37f"; // ChatGPT green
        case "anthropic":
            return "#8b5cf6"; // purple
        case "azure":
            return "#0078d4"; // azure blue
        case "local":
            return "#6b7280"; // gray
        default:
            return "#374151"; // slate
    }
}
function colorForModel(m) {
    const key = m.toLowerCase();
    if (key.includes("gpt-4o"))
        return "#0ea5e9"; // sky
    if (key.includes("gpt-4"))
        return "#22c55e"; // green
    if (key.includes("gpt-3"))
        return "#f59e0b"; // amber
    if (key.includes("claude"))
        return "#a855f7"; // purple
    return "#4b5563"; // default gray
}
function ProviderBadge({ provider, onClick }) {
    const label = provider.toLowerCase() === "openai"
        ? "ChatGPT"
        : provider.charAt(0).toUpperCase() + provider.slice(1);
    const bg = colorForProvider(provider);
    const fg = textColorOn(bg);
    return ((0, jsx_runtime_1.jsx)("button", { className: "badge", onClick: onClick, style: {
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 8px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: bg,
            color: fg,
            fontSize: 12,
            lineHeight: 1,
            userSelect: "none",
            cursor: "pointer",
        }, title: "Change provider/model", children: label }));
}
function ModelBadge({ model, onClick }) {
    const bg = colorForModel(model || "unknown");
    const fg = textColorOn(bg);
    return ((0, jsx_runtime_1.jsx)("button", { className: "badge", onClick: onClick, style: {
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 8px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: bg,
            color: fg,
            fontSize: 12,
            lineHeight: 1,
            userSelect: "none",
            cursor: "pointer",
        }, title: "Change provider/model", children: model || "unknown" }));
}
/* ---------------------- CodeCard ---------------------- */
function CodeCard({ block, index, onSaved, }) {
    const suggested = defaultFilenameFor(block, index);
    const highlighted = (0, react_1.useMemo)(() => {
        try {
            if (block.lang && highlight_js_1.default.getLanguage(block.lang))
                return highlight_js_1.default.highlight(block.code, { language: block.lang }).value;
            return highlight_js_1.default.highlightAuto(block.code).value;
        }
        catch {
            return highlight_js_1.default.escapeHTML(block.code);
        }
    }, [block]);
    async function copy() {
        await navigator.clipboard.writeText(block.code);
    }
    async function save() {
        const res = await window.api.saveAs(suggested, block.code);
        if (res?.ok)
            onSaved(res.rel || res.path || suggested);
    }
    return ((0, jsx_runtime_1.jsxs)("div", { className: "code-card", tabIndex: 0, children: [(0, jsx_runtime_1.jsx)("div", { className: "lang-chip", children: (block.lang || "code").toLowerCase() }), (0, jsx_runtime_1.jsxs)("div", { className: "floating-actions", children: [(0, jsx_runtime_1.jsx)("button", { className: "icon-btn ghost", onClick: copy, title: "Copy", children: (0, jsx_runtime_1.jsx)(IconCopy, {}) }), (0, jsx_runtime_1.jsx)("button", { className: "icon-btn ghost", onClick: save, title: "Save", children: (0, jsx_runtime_1.jsx)(IconSave, {}) })] }), (0, jsx_runtime_1.jsx)("pre", { children: (0, jsx_runtime_1.jsx)("code", { className: "hljs", dangerouslySetInnerHTML: { __html: highlighted } }) })] }));
}
/* ---------------------- App ---------------------- */
function App() {
    const bridge = (0, react_1.useMemo)(() => (typeof window !== "undefined" ? window.api : undefined), []);
    const [root, setRoot] = (0, react_1.useState)("");
    const [chat, setChat] = (0, react_1.useState)([]);
    const [input, setInput] = (0, react_1.useState)("");
    const [pending, setPending] = (0, react_1.useState)(null);
    const [attachments, setAttachments] = (0, react_1.useState)([]);
    const [autoExec, setAutoExec] = (0, react_1.useState)(true);
    // Settings modal
    const [showSettings, setShowSettings] = (0, react_1.useState)(false);
    const [cfg, setCfg] = (0, react_1.useState)(null);
    const [viewMode, setViewMode] = (0, react_1.useState)("aiOnly");
    // Back-compat: if legacy code references paneMode, alias to viewMode
    const paneMode = viewMode;
    const containerStyle = (0, react_1.useMemo)(() => {
        // In split mode, don't override any layout the app already has.
        if (viewMode === "split")
            return {};
        // For single-pane modes, keep it simple and full-width.
        return { display: "grid", gridTemplateColumns: "1fr", height: "100%" };
    }, [viewMode]);
    const aiPaneStyle = (0, react_1.useMemo)(() => {
        return viewMode === "editorOnly" ? { display: "none" } : {};
    }, [viewMode]);
    const editorPaneStyle = (0, react_1.useMemo)(() => {
        return viewMode === "aiOnly" ? { display: "none" } : {};
    }, [viewMode]);
    const dividerStyle = (0, react_1.useMemo)(() => {
        return viewMode === "split" ? {} : { display: "none" };
    }, [viewMode]);
    const [showSourceModal, setShowSourceModal] = (0, react_1.useState)(false);
    const [sources, setSources] = (0, react_1.useState)([]);
    const [selProvider, setSelProvider] = (0, react_1.useState)("openai");
    const [selModel, setSelModel] = (0, react_1.useState)("gpt-4o-mini");
    // ——— Editor pane state ———
    const [editorTab, setEditorTab] = (0, react_1.useState)("view");
    const [showEditorConsole, setShowEditorConsole] = (0, react_1.useState)(false);
    const [editorLogs, setEditorLogs] = (0, react_1.useState)([]);
    const webviewRef = (0, react_1.useRef)(null); // Electron.WebviewTag; 'any' to avoid type friction
    // Where to load in the Editor "View" tab:
    const editorURL = cfg?.EDITOR_URL || "http://localhost:3000";
    // First-run walkthrough if a selected provider is missing keys
    const [showWalkthrough, setShowWalkthrough] = (0, react_1.useState)(false);
    // --- Editor file state ---
    const [edFile, setEdFile] = (0, react_1.useState)(null);
    const [edText, setEdText] = (0, react_1.useState)("");
    const [edDirty, setEdDirty] = (0, react_1.useState)(false);
    const [edViewAvailable, setEdViewAvailable] = (0, react_1.useState)(false);
    const [edPreviewType, setEdPreviewType] = (0, react_1.useState)("none");
    // Share the open buffer with the AI when sending
    const [shareOpenFile, setShareOpenFile] = (0, react_1.useState)(false);
    // code editor refs
    const edGutterRef = (0, react_1.useRef)(null);
    const edTextRef = (0, react_1.useRef)(null);
    const [edLineCount, setEdLineCount] = (0, react_1.useState)(1);
    (0, react_1.useEffect)(() => {
        setEdLineCount(Math.max(1, edText.split("\n").length));
    }, [edText]);
    const syncGutterScroll = () => {
        if (edGutterRef.current && edTextRef.current) {
            edGutterRef.current.scrollTop = edTextRef.current.scrollTop;
        }
    };
    async function openSourceModal() {
        const data = await bridge?.getAISources?.();
        if (data?.ok) {
            setSources(data.sources || []);
            setSelProvider(cfg?.PROVIDER || "openai");
            setSelModel(cfg?.MODEL || "gpt-4o-mini");
            setShowSourceModal(true);
        }
        else {
            // Fallback: just default to OpenAI entries
            setSources([{ id: "openai", label: "ChatGPT", envVar: "OPENAI_API_KEY", hasKey: true, supported: true, models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"] }]);
            setSelProvider(cfg?.PROVIDER || "openai");
            setSelModel(cfg?.MODEL || "gpt-4o-mini");
            setShowSourceModal(true);
        }
    }
    async function saveSourceModel() {
        if (!cfg)
            return;
        const next = { ...cfg, PROVIDER: selProvider, MODEL: selModel };
        const res = await bridge.updateConfig?.(next);
        if (res?.ok) {
            setCfg(res.config);
            setShowSourceModal(false);
        }
    }
    // Utility: is current cfg provider usable?
    async function ensureProviderReady() {
        const data = await bridge?.getAISources?.();
        if (!data?.ok)
            return true; // don't block if unknown
        const src = data.sources.find(s => s.id === (cfg?.PROVIDER || "openai"));
        if (!src)
            return true;
        if (src.supported && src.hasKey)
            return true;
        // Block and show walkthrough
        setShowWalkthrough(true);
        return false;
    }
    // Summary modal
    const [showSummary, setShowSummary] = (0, react_1.useState)(false);
    const [summaryJSON, setSummaryJSON] = (0, react_1.useState)(null);
    const [carryoverMD, setCarryoverMD] = (0, react_1.useState)("");
    const [summaryBusy, setSummaryBusy] = (0, react_1.useState)(false);
    // Thinking placeholder management
    const pendingIndexRef = (0, react_1.useRef)(null);
    const thinkingTimerRef = (0, react_1.useRef)(null);
    // New: send/stop toggle & local cancel guard
    const [isAsking, setIsAsking] = (0, react_1.useState)(false);
    const requestIdRef = (0, react_1.useRef)(0);
    const chatRef = (0, react_1.useRef)(null);
    // keep chat pinned to bottom unless the user scrolls up
    const shouldStickRef = (0, react_1.useRef)(true);
    const handleChatScroll = (0, react_1.useCallback)(() => {
        const el = chatRef.current;
        if (!el)
            return;
        const threshold = 64; // px from bottom counts as "at bottom"
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        shouldStickRef.current = distance <= threshold;
    }, []);
    function scrollToBottom() {
        const el = chatRef.current;
        if (!el)
            return;
        el.scrollTop = el.scrollHeight;
    }
    // auto-scroll when messages change, but only if user is near the bottom
    (0, react_1.useEffect)(() => {
        if (shouldStickRef.current)
            scrollToBottom();
    }, [chat]);
    // also react to DOM changes (code highlight growth, reveal animations)
    (0, react_1.useEffect)(() => {
        const el = chatRef.current;
        if (!el)
            return;
        const mo = new MutationObserver(() => {
            if (shouldStickRef.current)
                scrollToBottom();
        });
        mo.observe(el, { childList: true, subtree: true, characterData: true });
        return () => mo.disconnect();
    }, []);
    // initial root + config load
    (0, react_1.useEffect)(() => {
        let mounted = true;
        (async () => {
            try {
                const r = await bridge?.getRoot?.();
                const rt = typeof r === "string" ? r : r?.root ?? "(no bridge)";
                if (mounted)
                    setRoot(rt);
                const c = await bridge?.getConfig?.();
                if (c?.ok) {
                    if (mounted) {
                        setViewMode(c.config.UI_MODE ?? "aiOnly");
                        if (c.root && c.root !== rt)
                            setRoot(c.root);
                    }
                }
            }
            catch {
                if (mounted)
                    setRoot("(bridge error)");
            }
        })();
        return () => {
            mounted = false;
        };
    }, [bridge]);
    // exec pending event (optional)
    (0, react_1.useEffect)(() => {
        const off = bridge?.onExecPending?.((req) => setPending(req));
        return () => {
            if (off)
                off();
        };
    }, [bridge]);
    (0, react_1.useEffect)(() => {
        const off = bridge?.onMenu?.((cmd) => {
            if (cmd === "openSettings")
                openSettings();
            else if (cmd === "summarize")
                summarizeNow();
            else if (cmd === "stop")
                cancelAsk();
            else if (cmd === "reloadConfigAfterRootPick") {
                // re-pull config so badges and root reflect the change
                bridge?.getConfig?.().then((res) => {
                    if (res?.ok) {
                        setCfg(res.config);
                        setRoot(res.root || res.config.ROOT_DIR || "");
                    }
                });
            }
        });
        return () => {
            if (typeof off === "function")
                off();
        };
    }, [bridge]);
    (0, react_1.useEffect)(() => {
        const off = bridge?.onMenu?.(async (cmd) => {
            if (cmd === "toggleEditorConsole") {
                setShowEditorConsole((v) => !v);
            }
            else if (cmd === "file:open") {
                const res = await bridge?.openEditorFile?.();
                if (res?.ok) {
                    setEdFile({ rel: res.rel, abs: res.abs, fileURL: res.fileURL });
                    setEdText(res.content);
                    setEdDirty(false);
                    if (res.previewable) {
                        // Decide preview type:
                        if (/\.(md|markdown)$/i.test(res.rel)) {
                            setEdPreviewType("md");
                        }
                        else {
                            setEdPreviewType("file");
                        }
                        setEdViewAvailable(true);
                        setEditorTab("view");
                    }
                    else {
                        setEdPreviewType("none");
                        setEdViewAvailable(false);
                        setEditorTab("edit");
                    }
                }
            }
            else if (cmd === "file:save") {
                if (!edFile)
                    return;
                const ok = await bridge?.saveEditorFile?.(edFile.rel, edText);
                if (ok?.ok)
                    setEdDirty(false);
            }
            else if (cmd === "file:saveAs") {
                const res = await bridge?.saveEditorFileAs?.(edFile?.rel, edText);
                if (res?.ok) {
                    setEdFile({ rel: res.rel, abs: res.abs, fileURL: res.fileURL });
                    setEdDirty(false);
                    if (res.previewable) {
                        if (/\.(md|markdown)$/i.test(res.rel))
                            setEdPreviewType("md");
                        else
                            setEdPreviewType("file");
                        setEdViewAvailable(true);
                    }
                    else {
                        setEdPreviewType("none");
                        setEdViewAvailable(false);
                    }
                }
            }
        });
        return () => { if (typeof off === "function")
            off(); };
    }, [bridge, edFile, edText]);
    (0, react_1.useEffect)(() => {
        const wv = webviewRef.current;
        if (!wv)
            return;
        // Collect console messages
        const onConsole = (e) => {
            const level = e.level; // 0=log, 1=warn, 2=error per Electron docs
            const map = { 0: "log", 1: "warn", 2: "error" };
            setEditorLogs((logs) => [
                ...logs,
                { level: map[level] || "log", message: String(e.message) },
            ]);
        };
        const onCrashed = (_e) => {
            setEditorLogs((logs) => [...logs, { level: "error", message: "Webview crashed" }]);
        };
        const onFailLoad = (_e) => {
            setEditorLogs((logs) => [...logs, { level: "error", message: "Failed to load editor URL" }]);
        };
        wv.addEventListener("console-message", onConsole);
        wv.addEventListener("crashed", onCrashed);
        wv.addEventListener("did-fail-load", onFailLoad);
        return () => {
            try {
                wv.removeEventListener("console-message", onConsole);
                wv.removeEventListener("crashed", onCrashed);
                wv.removeEventListener("did-fail-load", onFailLoad);
            }
            catch { }
        };
    }, [editorTab, editorURL]);
    // Paste handler: turn pasted text into a jailed temp file + attachment
    const onPasteToAttach = (0, react_1.useCallback)(async (e) => {
        const text = e.clipboardData?.getData("text");
        if (!text)
            return;
        e.preventDefault(); // don't paste into input; treat as attachment
        const fence = text.match(/```([a-z0-9_-]+)?/i);
        const inferred = fence?.[1]?.toLowerCase() || (/#|```|^ {0,3}[-*+]\s|\d+\.\s|^#+\s/m.test(text) ? "md" : "txt");
        const langMap = {
            ts: "ts",
            tsx: "tsx",
            js: "js",
            jsx: "jsx",
            json: "json",
            yml: "yaml",
            yaml: "yaml",
            html: "html",
            css: "css",
            ps1: "powershell",
            sh: "bash",
            py: "python",
            md: "md",
            txt: "",
        };
        const lang = langMap[inferred] ?? "";
        const ext = inferred === "md"
            ? "md"
            : lang && ["powershell", "bash", "python"].includes(lang)
                ? { powershell: "ps1", bash: "sh", python: "py" }[lang]
                : inferred;
        const rel = `temp/paste-${Date.now()}.${ext || "txt"}`;
        try {
            await bridge?.writeFile?.(rel, text);
        }
        catch { }
        const name = `clipboard.${ext || "txt"}`;
        const att = {
            name,
            displayPath: rel,
            size: text.length,
            truncated: false,
            content: text,
            lang: lang || "",
        };
        setAttachments((a) => [...a, att]);
        setChat((c) => [...c, { from: "system", text: `Attached ${name} (${fmtBytes(att.size)})`, ts: Date.now() }]);
    }, [bridge]);
    // Import file (attach only)
    const importFile = (0, react_1.useCallback)(async () => {
        if (!bridge?.pickFile) {
            setChat((c) => [...c, { from: "ai", text: "PickFile bridge not available", ts: Date.now() }]);
            return;
        }
        const res = await bridge.pickFile();
        if (!res?.ok || !res.content)
            return;
        const ext = (res.name?.split(".").pop() || "txt").toLowerCase();
        const map = {
            ts: "ts",
            tsx: "tsx",
            js: "js",
            jsx: "jsx",
            json: "json",
            yml: "yaml",
            yaml: "yaml",
            html: "html",
            css: "css",
            ps1: "powershell",
            sh: "bash",
            py: "python",
            md: "md",
            txt: "",
        };
        const lang = map[ext] ?? ext;
        const displayPath = res.rel || res.path || res.name || "file";
        setAttachments((a) => [
            ...a,
            {
                name: res.name || "file",
                displayPath,
                size: res.size || res.content.length,
                truncated: !!res.truncated,
                content: res.content,
                lang,
            },
        ]);
    }, [bridge]);
    (0, react_1.useEffect)(() => {
        const off = bridge?.onMenu?.(async (cmd) => {
            if (!cmd?.startsWith("ui:"))
                return;
            const next = cmd === "ui:aiOnly" ? "aiOnly" :
                cmd === "ui:editorOnly" ? "editorOnly" :
                    "split";
            setViewMode(next);
            // persist to config
            try {
                await bridge?.updateConfig?.({ UI_MODE: next });
            }
            catch { }
        });
        return () => { if (typeof off === "function")
            off(); };
    }, [bridge]);
    // send with thinking placeholder + graceful reveal
    async function send() {
        const q = input.trim();
        if (!q && attachments.length === 0)
            return;
        // Block and show walkthrough if selected provider lacks a key/support
        const ready = await ensureProviderReady();
        if (!ready)
            return;
        setIsAsking(true);
        const myId = ++requestIdRef.current;
        // Merge editor buffer if sharing is on (uses UNSAVED text so AI sees latest)
        let allAtts = attachments;
        if (shareOpenFile && (edText?.length || edFile)) {
            const ext = (edFile?.rel?.split(".").pop() || "txt").toLowerCase();
            const map = {
                ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", json: "json",
                yml: "yaml", yaml: "yaml", html: "html", css: "css",
                ps1: "powershell", sh: "bash", py: "python", md: "md", txt: ""
            };
            const lang = map[ext] || "";
            const name = edFile?.rel || "untitled.txt";
            const virt = {
                name,
                displayPath: name,
                size: edText.length,
                truncated: false,
                content: edText,
                lang
            };
            allAtts = [...attachments, virt];
        }
        // Echo to chat (prompt + filenames/sizes)
        const filesLine = allAtts.length ? " • " + allAtts.map((a) => `${a.name} (${fmtBytes(a.size)})`).join(", ") : "";
        setChat((c) => [...c, { from: "user", text: (q || "(no prompt)") + filesLine, ts: Date.now() }]);
        // Build the model prompt with file contents
        let prompt = q || "(no prompt)";
        if (allAtts.length) {
            const parts = allAtts.map((att) => {
                const header = `Attached ${att.displayPath} (${att.size} bytes)` + (att.truncated ? " [truncated]" : "");
                return `${header}\n\n\`\`\`${att.lang}\n${att.content}\n\`\`\``;
            });
            prompt += `\n\n---\n${parts.join("\n\n---\n")}`;
        }
        setInput("");
        setAttachments([]);
        const t0 = Date.now();
        // Insert "Thinking…" placeholder
        setChat((c) => {
            pendingIndexRef.current = c.length;
            return [...c, { from: "ai", text: "Thinking: 0s", ts: Date.now() }];
        });
        if (thinkingTimerRef.current)
            clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = window.setInterval(() => {
            const elapsed = Date.now() - t0;
            setChat((c) => {
                const i = pendingIndexRef.current;
                if (i == null || i >= c.length)
                    return c;
                const copy = c.slice();
                copy[i] = { ...copy[i], text: `Thinking: ${fmtDuration(elapsed)}` };
                return copy;
            });
        }, 300);
        try {
            if (!bridge?.askAI)
                throw new Error("Preload bridge not available");
            const a = await bridge.askAI(prompt);
            // If canceled or superseded, ignore this response
            if (myId !== requestIdRef.current)
                return;
            const t1 = Date.now();
            const aiText = toText(a) || "(no text)";
            clearInterval(thinkingTimerRef.current);
            setChat((c) => {
                const i = pendingIndexRef.current;
                const payload = { from: "ai", text: aiText, ts: t1, durMs: t1 - t0, anim: "appear" };
                if (i == null || i >= c.length)
                    return [...c, payload];
                const copy = c.slice();
                copy[i] = payload;
                return copy;
            });
            await maybeAutoExec(aiText);
        }
        catch (err) {
            // If canceled or superseded, ignore error UI
            if (myId !== requestIdRef.current)
                return;
            const t1 = Date.now();
            clearInterval(thinkingTimerRef.current);
            setChat((c) => {
                const i = pendingIndexRef.current;
                const payload = {
                    from: "ai",
                    text: "Error: " + (err?.message ?? String(err)),
                    ts: t1,
                    durMs: t1 - t0,
                    anim: "appear",
                };
                if (i == null || i >= c.length)
                    return [...c, payload];
                const copy = c.slice();
                copy[i] = payload;
                return copy;
            });
        }
        finally {
            pendingIndexRef.current = null;
            setIsAsking(false);
        }
    }
    // Cancel current ask (UI-level guard; also calls main if available)
    async function cancelAsk() {
        try {
            // bump local token so any pending response is ignored
            requestIdRef.current++;
            await bridge?.cancelAI?.();
            if (thinkingTimerRef.current)
                clearInterval(thinkingTimerRef.current);
            setChat((c) => {
                const i = pendingIndexRef.current;
                const t = Date.now();
                if (i == null || i >= c.length)
                    return [...c, { from: "ai", text: "Canceled.", ts: t, anim: "appear" }];
                const copy = c.slice();
                copy[i] = { from: "ai", text: "Canceled.", ts: t, anim: "appear" };
                return copy;
            });
        }
        finally {
            pendingIndexRef.current = null;
            setIsAsking(false);
        }
    }
    // optional auto-exec on code reply
    async function maybeAutoExec(aiText) {
        if (!autoExec)
            return;
        const blocks = extractCodeBlocks(aiText);
        if (!blocks.length)
            return;
        const b = blocks[0];
        const ext = langToExt(b.lang);
        if (!ext || ext === "txt")
            return;
        const rel = `temp/ai-snippet-${Date.now()}.${ext}`;
        try {
            await bridge.writeFile(rel, b.code);
            const cmd = execCmdFor(ext, rel);
            if (!cmd)
                return;
            await bridge.requestExec({ id: crypto.randomUUID(), command: cmd, cwd: root || "." });
            // modal shown via onExecPending
        }
        catch (e) {
            setChat((c) => [...c, { from: "system", text: "Auto-exec setup failed: " + (e?.message ?? e), ts: Date.now() }]);
        }
    }
    // manual test exec
    async function testExec() {
        try {
            if (!bridge?.requestExec)
                throw new Error("Preload bridge not available");
            await bridge.requestExec({ id: crypto.randomUUID(), command: "Get-ChildItem -Force", cwd: root || "." });
        }
        catch (err) {
            setChat((c) => [...c, { from: "system", text: "Exec request error: " + (err?.message ?? String(err)), ts: Date.now() }]);
        }
    }
    async function approve(yes) {
        if (!pending)
            return;
        try {
            const res = await bridge.approveExec(pending.id, yes);
            if (res?.status === "error") {
                setChat((c) => [...c, { from: "system", text: `Execution error: ${res.error || "unknown"}`, ts: Date.now() }]);
            }
            else if (yes && res?.status === "done") {
                const out = [
                    `Exit: ${res.code}`,
                    res.stdout ? `STDOUT:\n${res.stdout}` : "",
                    res.stderr ? `STDERR:\n${res.stderr}` : "",
                ]
                    .filter(Boolean)
                    .join("\n\n");
                setChat((c) => [...c, { from: "system", text: "```txt\n" + out + "\n```", ts: Date.now() }]);
            }
            else {
                setChat((c) => [...c, { from: "system", text: "Execution rejected.", ts: Date.now() }]);
            }
        }
        catch (e) {
            setChat((c) => [...c, { from: "system", text: "Approval error: " + (e?.message ?? e), ts: Date.now() }]);
        }
        finally {
            setPending(null);
        }
    }
    // settings
    async function openSettings() {
        const res = await bridge.getConfig?.();
        if (res?.ok) {
            setCfg(res.config);
            setShowSettings(true);
        }
    }
    async function saveSettings() {
        if (!cfg)
            return;
        const res = await bridge.updateConfig?.(cfg);
        if (res?.ok) {
            setCfg(res.config);
            setAutoExec(res.config.AUTO_EXEC);
            setRoot(res.config.ROOT_DIR);
            setShowSettings(false);
        }
    }
    async function chooseRootInSettings() {
        const res = await bridge.selectRoot?.();
        if (res?.ok && cfg)
            setCfg({ ...cfg, ROOT_DIR: res.root });
    }
    // summarize
    async function summarizeNow() {
        try {
            setSummaryBusy(true);
            const transcript = serializeTranscript(chat);
            const prompt = `${SUMMARIZER_PROMPT}\n\nTRANSCRIPT:\n${transcript}`;
            if (!bridge?.askAI)
                throw new Error("Bridge askAI unavailable");
            const raw = await bridge.askAI(prompt);
            const txt = toText(raw);
            const jsonStart = txt.indexOf("{");
            const jsonEnd = txt.lastIndexOf("}");
            if (jsonStart < 0 || jsonEnd < 0)
                throw new Error("No JSON in summary");
            const parsed = JSON.parse(txt.slice(jsonStart, jsonEnd + 1));
            setSummaryJSON(parsed);
            setCarryoverMD(parsed.carryover_md || "");
            setShowSummary(true);
        }
        catch (e) {
            setChat((c) => [...c, { from: "ai", text: "Summary error: " + (e?.message ?? e), ts: Date.now() }]);
        }
        finally {
            setSummaryBusy(false);
        }
    }
    async function saveSummaryFiles() {
        if (!summaryJSON)
            return;
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const base = `snapshots/${ts}`;
        try {
            await bridge.writeFile(`${base}-snapshot.json`, JSON.stringify(summaryJSON, null, 2));
            await bridge.writeFile(`${base}-carryover.md`, carryoverMD || "");
            setChat((c) => [...c, { from: "system", text: `Saved snapshots → ${base}-*.{json,md}`, ts: Date.now() }]);
        }
        catch (e) {
            setChat((c) => [...c, { from: "system", text: "Save summary error: " + (e?.message ?? e), ts: Date.now() }]);
        }
    }
    function renderMessage(m, i) {
        const text = toText(m.text);
        const blocks = m.from !== "user" ? extractCodeBlocks(text) : [];
        const plain = text.replace(/```[\s\S]*?```/g, "").trim();
        const showMeta = m.from === "ai" && (m.ts || m.durMs !== undefined);
        return ((0, jsx_runtime_1.jsxs)("div", { className: `msg ${m.anim || ""}`, children: [(0, jsx_runtime_1.jsx)("b", { children: m.from === "user" ? "You" : m.from === "system" ? "System" : "AI" }), showMeta && ((0, jsx_runtime_1.jsxs)("span", { style: { marginLeft: 8, color: "#9ca3af", fontSize: 12 }, children: [fmtClock(m.ts), m.durMs !== undefined ? ` • ${fmtDuration(m.durMs)}` : ""] })), " ", (0, jsx_runtime_1.jsx)("span", { dangerouslySetInnerHTML: { __html: renderMarkdown(plain || (blocks.length ? "" : text)) } }), blocks.map((b, idx) => ((0, jsx_runtime_1.jsx)(CodeCard, { block: b, index: idx, onSaved: (p) => setChat((c) => [...c, { from: "system", text: `Saved → ${p}`, ts: Date.now() }]) }, `${i}-${idx}`)))] }, i));
    }
    return ((0, jsx_runtime_1.jsxs)("div", { className: `container ${summaryBusy ? "busy" : ""}`, style: {
            ...(summaryBusy ? { filter: "grayscale(0.3) opacity(0.7)" } : null),
            display: "flex",
            flexDirection: "column",
            minHeight: "100vh",
        }, children: [(0, jsx_runtime_1.jsxs)("div", { className: "main-split", style: containerStyle, children: [(0, jsx_runtime_1.jsxs)("section", { className: "ai-pane", style: aiPaneStyle, children: [(0, jsx_runtime_1.jsxs)("div", { className: "header", children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, fontWeight: 600 }, children: ["Kage 2.0", !!cfg && ((0, jsx_runtime_1.jsxs)(react_1.default.Fragment, { children: [(0, jsx_runtime_1.jsx)(ProviderBadge, { provider: cfg.PROVIDER || "openai", onClick: openSourceModal }), (0, jsx_runtime_1.jsx)(ModelBadge, { model: cfg.MODEL || "gpt-4o-mini", onClick: openSourceModal })] }))] }), (0, jsx_runtime_1.jsxs)("div", { style: { marginLeft: "auto", display: "flex", gap: 8 }, children: [(0, jsx_runtime_1.jsx)("button", { className: "icon-btn", onClick: openSettings, title: "Settings", children: (0, jsx_runtime_1.jsx)(IconGear, {}) }), (0, jsx_runtime_1.jsx)("button", { className: "icon-btn", style: { marginRight: 2, background: "none" }, "aria-label": shareOpenFile ? "AI can see the buffer" : "AI cannot see the buffer", title: shareOpenFile ? "AI can see the text (click to hide)" : "AI cannot see (click to let AI see this file when asking)", onClick: () => setShareOpenFile(v => !v), children: shareOpenFile ? (0, jsx_runtime_1.jsx)(IconEye, {}) : (0, jsx_runtime_1.jsx)(IconEyeOff, {}) })] })] }), (0, jsx_runtime_1.jsx)("div", { className: "ai-scroll", ref: chatRef, onScroll: handleChatScroll, children: (0, jsx_runtime_1.jsx)("div", { className: "chat", children: chat.map((m, i) => renderMessage(m, i)) }) }), (0, jsx_runtime_1.jsxs)("div", { className: "row", children: [(0, jsx_runtime_1.jsx)("button", { className: "icon-btn", onClick: importFile, title: "Attach file", children: (0, jsx_runtime_1.jsx)(IconPaperclip, {}) }), (0, jsx_runtime_1.jsxs)("div", { className: "input-wrap", style: {
                                            marginLeft: 8,
                                            display: "grid",
                                            gridTemplateColumns: "1fr 36px",
                                            alignItems: "center",
                                            gap: 8,
                                            minWidth: 0,
                                        }, children: [(0, jsx_runtime_1.jsx)("input", { type: "text", placeholder: "Ask the model\u2026 (paste to attach)", value: input, onChange: (e) => setInput(e.target.value), onKeyDown: (e) => {
                                                    if ((cfg?.SEND_ON_ENTER ?? true) && e.key === "Enter")
                                                        send();
                                                }, onPaste: onPasteToAttach, style: { minWidth: 0 } }), !isAsking ? ((0, jsx_runtime_1.jsx)("button", { className: "icon-btn send-btn primary", onClick: send, title: "Send", style: { width: 32, height: 32 }, children: (0, jsx_runtime_1.jsx)(IconSend, {}) })) : ((0, jsx_runtime_1.jsx)("button", { className: "icon-btn danger", onClick: cancelAsk, title: "Stop", style: { width: 32, height: 32 }, children: (0, jsx_runtime_1.jsx)(IconStop, {}) }))] })] })] }), (0, jsx_runtime_1.jsx)("div", { className: "split-divider", style: dividerStyle }), (0, jsx_runtime_1.jsxs)("section", { className: "editor-pane", style: editorPaneStyle, children: [(0, jsx_runtime_1.jsxs)("div", { className: "editor-header", children: [(0, jsx_runtime_1.jsxs)("div", { className: "editor-tabs", children: [(0, jsx_runtime_1.jsx)("button", { className: `${editorTab === "view" ? "active" : ""} ${!edViewAvailable ? "disabled" : ""}`, onClick: () => edViewAvailable && setEditorTab("view"), title: edViewAvailable ? "Preview file" : "No preview available for this file type", children: "View" }), (0, jsx_runtime_1.jsx)("button", { className: editorTab === "edit" ? "active" : "", onClick: () => setEditorTab("edit"), title: "Edit file", children: "Edit" })] }), (0, jsx_runtime_1.jsx)("div", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }, children: (0, jsx_runtime_1.jsxs)("div", { style: { fontSize: 12, opacity: 0.8 }, className: "mono", children: [edFile?.rel || editorURL, edDirty ? " • UNSAVED" : ""] }) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "editor-body", children: [editorTab === "view" ? (edPreviewType === "md" ? ((0, jsx_runtime_1.jsx)("div", { className: "editor-view", style: { overflow: "auto", padding: 0 }, children: (0, jsx_runtime_1.jsx)("div", { dangerouslySetInnerHTML: { __html: dompurify_1.default.sanitize(marked_1.marked.parse(edText)) } }) })) : ((0, jsx_runtime_1.jsx)("div", { className: "editor-view", children: (0, jsx_runtime_1.jsx)("webview", { ref: webviewRef, className: "editor-webview", src: edFile?.fileURL || editorURL, allowpopups: "true" }) }))) : ((0, jsx_runtime_1.jsx)("div", { className: "editor-view", children: (0, jsx_runtime_1.jsx)("div", { style: { height: "100%", display: "flex", flexDirection: "column" }, children: (0, jsx_runtime_1.jsx)(react_codemirror_1.default, { value: edText, theme: [theme_one_dark_1.oneDark, cmTheme], extensions: [
                                                    (0, view_1.lineNumbers)(),
                                                    (0, view_1.highlightActiveLineGutter)(),
                                                    (0, commands_1.history)(),
                                                    (0, view_1.highlightActiveLine)(),
                                                    (0, search_1.highlightSelectionMatches)(),
                                                    view_1.keymap.of([...commands_1.defaultKeymap, ...commands_1.historyKeymap, ...search_1.searchKeymap]),
                                                    cmLangForFilename(edFile?.rel),
                                                ], onChange: (val) => { setEdText(val); setEdDirty(true); }, basicSetup: false }) }) })), showEditorConsole && ((0, jsx_runtime_1.jsx)("div", { className: "editor-console", children: editorLogs.length === 0 ? ((0, jsx_runtime_1.jsx)("div", { className: "log", style: { opacity: 0.7 }, children: "Console is empty." })) : (editorLogs.map((l, i) => ((0, jsx_runtime_1.jsxs)("div", { className: `log ${l.level}`, children: ["[", l.level.toUpperCase(), "] ", l.message] }, i)))) }))] })] })] }), pending && ((0, jsx_runtime_1.jsx)("div", { className: "modal-backdrop", onClick: () => setPending(null), children: (0, jsx_runtime_1.jsxs)("div", { className: "modal", onClick: (e) => e.stopPropagation(), children: [(0, jsx_runtime_1.jsx)("header", { children: "Approve Command" }), (0, jsx_runtime_1.jsxs)("div", { className: "body", children: [(0, jsx_runtime_1.jsx)("p", { style: { color: "#9ca3af", marginTop: 0 }, children: "CWD" }), (0, jsx_runtime_1.jsx)("pre", { children: pending.cwd }), (0, jsx_runtime_1.jsx)("p", { style: { color: "#9ca3af" }, children: "Command" }), (0, jsx_runtime_1.jsx)("pre", { children: pending.command })] }), (0, jsx_runtime_1.jsxs)("div", { className: "row-btns", children: [(0, jsx_runtime_1.jsx)("button", { className: "icon-btn danger", onClick: () => approve(false), title: "Reject", children: "\u2716" }), (0, jsx_runtime_1.jsx)("button", { className: "icon-btn ok", onClick: () => approve(true), title: "Approve", children: "\u2714" })] })] }) })), showSettings && cfg && ((0, jsx_runtime_1.jsx)("div", { className: "modal-backdrop", onClick: () => setShowSettings(false), children: (0, jsx_runtime_1.jsxs)("div", { className: "modal", onClick: (e) => e.stopPropagation(), children: [(0, jsx_runtime_1.jsx)("header", { children: "Settings" }), (0, jsx_runtime_1.jsxs)("div", { className: "body", style: { display: "grid", gap: 12 }, children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { style: { color: "var(--sub)", marginBottom: 4 }, children: "Working directory" }), (0, jsx_runtime_1.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [(0, jsx_runtime_1.jsx)("code", { style: {
                                                        background: "#0b1020",
                                                        padding: "6px 8px",
                                                        border: "1px solid var(--border)",
                                                        borderRadius: 8,
                                                        flex: 1,
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                    }, children: cfg.ROOT_DIR || root }), (0, jsx_runtime_1.jsx)("button", { className: "icon-btn", onClick: async () => await chooseRootInSettings(), title: "Change root", children: (0, jsx_runtime_1.jsx)(IconFolderPlus, {}) })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "field-row", style: { display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "center" }, children: [(0, jsx_runtime_1.jsx)("label", { style: { color: "var(--sub)" }, children: "Editor URL" }), (0, jsx_runtime_1.jsx)("input", { type: "text", value: cfg?.EDITOR_URL || "http://localhost:3000", onChange: (e) => setCfg((c) => c ? { ...c, EDITOR_URL: e.target.value } : c), onBlur: async (e) => {
                                                const next = { ...cfg, EDITOR_URL: e.target.value };
                                                const res = await bridge.updateConfig?.(next);
                                                if (res?.ok)
                                                    setCfg(res.config);
                                            }, placeholder: "http://localhost:3000" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "field-row", style: { display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 10, alignItems: "center" }, children: [(0, jsx_runtime_1.jsx)("label", { style: { color: "var(--sub)" }, children: "AI Source/Model" }), (0, jsx_runtime_1.jsx)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: (0, jsx_runtime_1.jsxs)("span", { className: "mono", style: { opacity: 0.9 }, children: [(cfg.PROVIDER || "openai"), " / ", (cfg.MODEL || "gpt-4o-mini")] }) }), (0, jsx_runtime_1.jsx)("button", { className: "icon-btn", onClick: openSourceModal, title: "Change Source/Model", children: "Change\u2026" })] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [(0, jsx_runtime_1.jsx)("input", { id: "autoexec", type: "checkbox", checked: cfg.AUTO_EXEC, onChange: (e) => setCfg({ ...cfg, AUTO_EXEC: e.target.checked }) }), (0, jsx_runtime_1.jsx)("label", { htmlFor: "autoexec", children: "Auto-execute AI code (with approval)" })] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }, children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { style: { color: "var(--sub)", marginBottom: 4 }, children: "AI Provider" }), (0, jsx_runtime_1.jsxs)("select", { value: cfg.PROVIDER, onChange: (e) => setCfg({ ...cfg, PROVIDER: e.target.value }), style: {
                                                        width: "100%",
                                                        padding: "8px",
                                                        background: "var(--muted)",
                                                        color: "var(--text)",
                                                        border: "1px solid var(--border)",
                                                        borderRadius: 8,
                                                    }, children: [(0, jsx_runtime_1.jsx)("option", { value: "openai", children: "OpenAI" }), (0, jsx_runtime_1.jsx)("option", { value: "azure", children: "Azure (future)" }), (0, jsx_runtime_1.jsx)("option", { value: "anthropic", children: "Anthropic (future)" }), (0, jsx_runtime_1.jsx)("option", { value: "local", children: "Local (future)" })] })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { style: { color: "var(--sub)", marginBottom: 4 }, children: "Model" }), (0, jsx_runtime_1.jsx)("input", { type: "text", value: cfg.MODEL, onChange: (e) => setCfg({ ...cfg, MODEL: e.target.value }), placeholder: "e.g. gpt-4.1-mini", style: {
                                                        width: "100%",
                                                        padding: "8px",
                                                        background: "var(--muted)",
                                                        color: "var(--text)",
                                                        border: "1px solid var(--border)",
                                                        borderRadius: 8,
                                                    } })] })] }), (0, jsx_runtime_1.jsxs)("div", { style: { color: "var(--sub)" }, children: ["Bridge: ", bridge ? "OK" : "Missing"] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "row-btns", children: [(0, jsx_runtime_1.jsx)("button", { className: "icon-btn", onClick: () => setShowSettings(false), children: "Cancel" }), (0, jsx_runtime_1.jsx)("button", { className: "icon-btn ok", onClick: saveSettings, children: "Save" })] })] }) })), showSourceModal && ((0, jsx_runtime_1.jsx)("div", { className: "modal-backdrop", onClick: () => setShowSourceModal(false), children: (0, jsx_runtime_1.jsxs)("div", { className: "modal", onClick: (e) => e.stopPropagation(), children: [(0, jsx_runtime_1.jsx)("header", { children: "Change Source & Model" }), (0, jsx_runtime_1.jsx)("div", { className: "body", style: { display: "grid", gap: 12 }, children: (sources || []).map((s) => {
                                const disabled = !s.hasKey || !s.supported;
                                return ((0, jsx_runtime_1.jsxs)("div", { style: {
                                        display: "grid",
                                        gridTemplateColumns: "1fr 1fr auto",
                                        gap: 10,
                                        opacity: disabled ? 0.5 : 1,
                                        alignItems: "center",
                                        border: "1px solid var(--border)",
                                        borderRadius: 10,
                                        padding: 10,
                                        background: "var(--panel)",
                                    }, children: [(0, jsx_runtime_1.jsx)("div", { style: { fontWeight: 600 }, children: s.label }), (0, jsx_runtime_1.jsx)("select", { disabled: disabled, value: s.id === selProvider ? selModel : (s.models?.[0] || ""), onChange: (e) => {
                                                if (s.id === selProvider)
                                                    setSelModel(e.target.value);
                                            }, style: {
                                                width: "100%",
                                                padding: 8,
                                                background: "var(--muted)",
                                                color: "var(--text)",
                                                border: "1px solid var(--border)",
                                                borderRadius: 8,
                                            }, children: (s.models?.length ? s.models : ["(no models)"]).map((m) => ((0, jsx_runtime_1.jsx)("option", { value: m, children: m }, m))) }), (0, jsx_runtime_1.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [(0, jsx_runtime_1.jsx)("input", { type: "radio", name: "provider", disabled: disabled, checked: selProvider === s.id, onChange: () => {
                                                        setSelProvider(s.id);
                                                        if (s.models?.length)
                                                            setSelModel(s.models[0]);
                                                    }, title: disabled ? (!s.supported ? "Not supported yet" : `Missing ${s.envVar}`) : "Select source" }), (0, jsx_runtime_1.jsx)("span", { style: { fontSize: 12, color: "var(--sub)" }, children: disabled ? (!s.supported ? "Not supported yet" : `Missing ${s.envVar}`) : "Available" })] })] }, s.id));
                            }) }), (0, jsx_runtime_1.jsxs)("div", { className: "row-btns", children: [(0, jsx_runtime_1.jsx)("button", { className: "icon-btn", onClick: () => setShowSourceModal(false), children: "Cancel" }), (0, jsx_runtime_1.jsx)("button", { className: "icon-btn ok", onClick: saveSourceModel, disabled: !sources.length, children: "Save Default" })] })] }) })), showWalkthrough && ((0, jsx_runtime_1.jsx)("div", { className: "modal-backdrop", onClick: () => setShowWalkthrough(false), children: (0, jsx_runtime_1.jsxs)("div", { className: "modal", onClick: (e) => e.stopPropagation(), children: [(0, jsx_runtime_1.jsx)("header", { children: "Set up your API key" }), (0, jsx_runtime_1.jsxs)("div", { className: "body", style: { display: "grid", gap: 12 }, children: [(0, jsx_runtime_1.jsx)("p", { children: "The selected source isn\u2019t ready yet. You\u2019ll need to set an environment variable with your API key:" }), (0, jsx_runtime_1.jsxs)("ul", { children: [(0, jsx_runtime_1.jsxs)("li", { children: [(0, jsx_runtime_1.jsx)("b", { children: "ChatGPT (OpenAI):" }), " set ", (0, jsx_runtime_1.jsx)("code", { children: "OPENAI_API_KEY" })] }), (0, jsx_runtime_1.jsxs)("li", { children: [(0, jsx_runtime_1.jsx)("b", { children: "Chatly:" }), " set ", (0, jsx_runtime_1.jsx)("code", { children: "CHATLY_API_KEY" })] }), (0, jsx_runtime_1.jsxs)("li", { children: [(0, jsx_runtime_1.jsx)("b", { children: "v0.dev:" }), " set ", (0, jsx_runtime_1.jsx)("code", { children: "V0_API_KEY" }), " (or ", (0, jsx_runtime_1.jsx)("code", { children: "VERCEL_V0_API_KEY" }), ")"] })] }), (0, jsx_runtime_1.jsxs)("p", { children: ["After updating your ", (0, jsx_runtime_1.jsx)("code", { children: ".env.local" }), ", restart the app."] }), (0, jsx_runtime_1.jsxs)("p", { children: [(0, jsx_runtime_1.jsx)("i", { children: "TODO:" }), " full walkthrough: docs link + copyable CLI to create ", (0, jsx_runtime_1.jsx)("code", { children: ".env.local" }), "."] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [(0, jsx_runtime_1.jsx)("button", { className: "icon-btn ok", onClick: () => { setShowWalkthrough(false); openSourceModal(); }, children: "Open Source/Model Picker" }), (0, jsx_runtime_1.jsx)("button", { className: "icon-btn", onClick: () => setShowWalkthrough(false), children: "Close" })] })] })] }) })), showSummary && ((0, jsx_runtime_1.jsx)("div", { className: "modal-backdrop", onClick: () => setShowSummary(false), children: (0, jsx_runtime_1.jsxs)("div", { className: "modal", onClick: (e) => e.stopPropagation(), children: [(0, jsx_runtime_1.jsx)("header", { children: "Carryover Summary" }), (0, jsx_runtime_1.jsxs)("div", { className: "body", style: { display: "grid", gap: 12, maxHeight: "60vh", overflowY: "auto" }, children: [(0, jsx_runtime_1.jsx)("div", { style: { color: "var(--sub)" }, children: "Carryover (paste this into a new chat):" }), (0, jsx_runtime_1.jsx)("pre", { style: { whiteSpace: "pre-wrap" }, children: carryoverMD }), summaryJSON && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("div", { style: { color: "var(--sub)" }, children: "Decisions" }), (0, jsx_runtime_1.jsx)("ul", { children: (summaryJSON.decisions || []).map((d, i) => (0, jsx_runtime_1.jsx)("li", { children: d }, i)) }), (0, jsx_runtime_1.jsx)("div", { style: { color: "var(--sub)" }, children: "Open issues" }), (0, jsx_runtime_1.jsx)("ul", { children: (summaryJSON.open_issues || []).map((d, i) => (0, jsx_runtime_1.jsx)("li", { children: d }, i)) }), (0, jsx_runtime_1.jsx)("div", { style: { color: "var(--sub)" }, children: "IPC" }), (0, jsx_runtime_1.jsx)("code", { children: JSON.stringify(summaryJSON.ipc || [], null, 2) })] }))] }), (0, jsx_runtime_1.jsxs)("div", { className: "row-btns", children: [(0, jsx_runtime_1.jsx)("button", { className: "icon-btn", onClick: () => navigator.clipboard.writeText(carryoverMD || ""), children: "Copy carryover" }), (0, jsx_runtime_1.jsx)("button", { className: "icon-btn ok", onClick: saveSummaryFiles, children: "Save files" }), (0, jsx_runtime_1.jsx)("button", { className: "icon-btn", onClick: () => setShowSummary(false), children: "Close" })] })] }) })), summaryBusy && ((0, jsx_runtime_1.jsxs)("div", { "aria-busy": "true", "aria-live": "polite", style: {
                    position: "fixed",
                    inset: 0,
                    background: "rgba(5,8,16,0.6)",
                    backdropFilter: "blur(2px)",
                    zIndex: 9999,
                    display: "grid",
                    placeItems: "center",
                    gap: 12,
                }, children: [(0, jsx_runtime_1.jsx)("div", { style: {
                            width: 32,
                            height: 32,
                            border: "3px solid rgba(255,255,255,0.2)",
                            borderTopColor: "#60a5fa",
                            borderRadius: "50%",
                            animation: "spin 0.8s linear infinite",
                        } }), (0, jsx_runtime_1.jsx)("div", { style: { color: "#e5e7eb", fontWeight: 600, letterSpacing: 0.2 }, children: "Summarizing\u2026" }), (0, jsx_runtime_1.jsx)("style", { children: `@keyframes spin { to { transform: rotate(360deg); } }` })] }))] }));
}
