import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import { marked } from "marked";
import DOMPurify from "dompurify";
import CodeMirror from "@uiw/react-codemirror";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorView, lineNumbers, highlightActiveLineGutter, keymap, highlightActiveLine } from '@codemirror/view'


const cmPaneScrollTheme = EditorView.theme({
  "&": { height: "auto" },
  ".cm-scroller": { overflow: "visible" }
});
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";



/* ---------------------- Bridge typing ---------------------- */
declare global {
  interface Window {
    api?: {
      // simple
      getRoot(): Promise<{ ok: boolean; root: string } | string>;
      askAI(prompt: string): Promise<any>; // may return string OR {ok,text}
      // cancel (optional; safe if preload/main haven't added yet)
      cancelAI?: () => Promise<{ ok?: boolean; canceled?: boolean }>;

      // exec approval
      requestExec(payload: { id: string; command: string; cwd: string }): Promise<{ queued: boolean }>;
      approveExec(id: string, approved: boolean): Promise<any>;
      onExecPending?: (cb: (req: { id: string; command: string; cwd: string }) => void) => () => void;

      // files
      writeFile(rel: string, content: string): Promise<{ ok: boolean }>;
      saveAs(
        suggested: string,
        content: string
      ): Promise<{ ok?: boolean; rel?: string; path?: string; canceled?: boolean; error?: string }>;
      pickFile(): Promise<{
        ok?: boolean;
        rel?: string;
        path?: string;
        name?: string;
        size?: number;
        truncated?: boolean;
        content?: string;
        canceled?: boolean;
        error?: string;
      }>;

      // config
      getConfig?: () => Promise<{ ok: boolean; config: AppConfig; bridge: boolean; root: string }>;
      updateConfig?: (patch: Partial<AppConfig>) => Promise<{ ok: boolean; config: AppConfig }>;
      selectRoot?: () => Promise<{ ok?: boolean; root?: string; canceled?: boolean }>;
    };
  }
}

/* ---------------------- Types ---------------------- */
type Msg = { from: "user" | "ai" | "system"; text: string; ts?: number; durMs?: number; anim?: "appear" };
type CodeBlock = { lang: string; code: string };
type PendingExec = { id: string; command: string; cwd: string };
type Attachment = { name: string; displayPath: string; size: number; truncated: boolean; content: string; lang: string };
type AppConfig = {
  ROOT_DIR: string;
  AUTO_EXEC: boolean;
  PROVIDER: string;
  MODEL: string;
  // TODO(settings): when false, Enter won't send; only the button will.
  SEND_ON_ENTER?: boolean;
  UI_MODE?: "split" | "aiOnly" | "editorOnly";
};

/* ---------------------- Markdown / Highlight ---------------------- */
marked.setOptions({
  gfm: true,
  breaks: true,
  highlight(code, lang) {
    try {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
      return hljs.highlightAuto(code).value;
    } catch {
      return code;
    }
  },
});
function renderMarkdown(md: string) {
  const html = marked.parse(md) as string;
  return DOMPurify.sanitize(html);
}

/* ---------------------- Helpers ---------------------- */
function extractCodeBlocks(md: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const re = /```([a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) blocks.push({ lang: (m[1] || "").trim(), code: m[2] ?? "" });
  return blocks;
}
function defaultFilenameFor(block: CodeBlock, index: number) {
  const extMap: Record<string, string> = {
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
function fmtClock(ts?: number) {
  return ts ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";
}
function cmLangForFilename(name?: string) {
  const ext = (name?.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "js":  return javascript();
    case "jsx": return javascript({ jsx: true });
    case "ts":  return javascript({ typescript: true });
    case "tsx": return javascript({ typescript: true, jsx: true });
    case "html":
    case "htm": return html();
    case "css": return css();
    case "json": return json();
    case "md":
    case "markdown": return markdown();
    case "py":  return python();
    case "sh":  return StreamLanguage.define(shell);
    case "ps1": return StreamLanguage.define(shell); // fallback: use shell for PowerShell
    default:    return []; // plain text
  }
}



const cmTheme = EditorView.theme({
  "&": { backgroundColor: "var(--panel)", color: "var(--text)", height: "100%" },
  ".cm-gutters": { backgroundColor: "var(--panel)", color: "var(--sub)", borderRight: "1px solid var(--border)" },
  ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.04)" },
});

function fmtBytes(n: number) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

/* HOTFIX: normalize any value to a string before using .replace etc. */
function toText(v: any): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v.text === "string") return v.text;
  try {
    return "```json\n" + JSON.stringify(v, null, 2) + "\n```";
  } catch {
    return String(v);
  }
}

/* Auto-exec helpers */
const LANG_EXT: Record<string, string> = { powershell: "ps1", ps: "ps1", bash: "sh", sh: "sh", python: "py", py: "py" };
function langToExt(lang?: string) {
  return LANG_EXT[(lang || "").toLowerCase()] || "txt";
}
function execCmdFor(ext: string, relPath: string) {
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
function serializeTranscript(chat: Msg[]): string {
  const lines: string[] = [];
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
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M9 9h10v10H9z" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
function IconSave() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M8 7h6v4H8zM8 21v-6h8v6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function IconSend() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M3 11l18-8-8 18-2-7-8-3z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function IconArrowOut() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M7 17l10-10M9 7h8v8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function IconImport() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 20h16M12 4v10m0 0l4-4m-4 4l-4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconPaperclip() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M21 8.5l-9.19 9.19a5 5 0 01-7.07-7.07L12.1 3.16a3.5 3.5 0 014.95 4.95L9.4 15.76a2 2 0 01-2.83-2.83L15 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconX() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconGear() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm8 4a8 8 0 0 0-.16-1.6l2.02-1.56-2-3.46-2.44.98A7.97 7.97 0 0 0 14.6 4l-.6-2.6h-4l-.6 2.6A7.97 7.97 0 0 0 6.58 6.36l-2.44-.98-2 3.46 2.02 1.56A7.99 7.99 0 0 0 4 12c0 .55.06 1.1.16 1.6l-2.02 1.56 2 3.46 2.44-.98A7.97 7.97 0 0 0 9.4 20l.6 2.6h4l.6-2.6a7.97 7.97 0 0 0 3.42-2.36l2.44.98 2-3.46-2.02-1.56c.1-.5.16-1.05.16-1.6z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}
function IconFolderPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2v12z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M12 12v6M9 15h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IconSparkle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
/* -------------------- end Icons -------------------- */

/* --------- New: Stop Icon + Model/Platform Badge --------- */
function IconStop() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="6" y="6" width="12" height="12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function IconEye({ dimmed = false }: { dimmed?: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
      <ellipse
        cx="12" cy="12"
        rx="9" ry="6"
        stroke={dimmed ? "#787878" : "currentColor"}
        strokeWidth="1.5"
        fill="none"
      />
      <circle
        cx="12" cy="12"
        r="2.6"
        fill={dimmed ? "#787878" : "currentColor"}
        opacity={dimmed ? 0.35 : 1}
      />
    </svg>
  );
}

function IconEyeOff() {
  // Dimmed eye with a line through it
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
      {/* Eye shape */}
      <ellipse
        cx="12" cy="12"
        rx="9" ry="6"
        stroke="#787878"
        strokeWidth="1.5"
        fill="none"
        opacity={0.55}
      />
      {/* Pupil */}
      <circle
        cx="12" cy="12"
        r="2.7"
        fill="#787878"
        opacity={0.26}
      />
      {/* Strike-through line */}
      <line x1="5" y1="19" x2="19" y2="5" stroke="#ba2626" strokeWidth="2" />
    </svg>
  );
}

function textColorOn(bg: string) {
  // simple luminance check for black/white text
  const hex = bg.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.54 ? "#111827" : "#ffffff";
}

function colorForProvider(p: string) {
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

function colorForModel(m: string) {
  const key = m.toLowerCase();
  if (key.includes("gpt-4o")) return "#0ea5e9"; // sky
  if (key.includes("gpt-4")) return "#22c55e";  // green
  if (key.includes("gpt-3")) return "#f59e0b";  // amber
  if (key.includes("claude")) return "#a855f7"; // purple
  return "#4b5563"; // default gray
}

function ProviderBadge({ provider, onClick }: { provider: string; onClick?: () => void }) {
  const label =
    provider.toLowerCase() === "openai"
      ? "ChatGPT"
      : provider.charAt(0).toUpperCase() + provider.slice(1);
  const bg = colorForProvider(provider);
  const fg = textColorOn(bg);
  return (
    <button
      className="badge"
      onClick={onClick}
      style={{
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
      }}
      title="Change provider/model"
    >
      {label}
    </button>
  );
}


function ModelBadge({ model, onClick }: { model: string; onClick?: () => void }) {
  const bg = colorForModel(model || "unknown");
  const fg = textColorOn(bg);
  return (
    <button
      className="badge"
      onClick={onClick}
      style={{
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
      }}
      title="Change provider/model"
    >
      {model || "unknown"}
    </button>
  );
}



/* ---------------------- CodeCard ---------------------- */
function CodeCard({
  block,
  index,
  onSaved,
}: {
  block: CodeBlock;
  index: number;
  onSaved: (relOrPath: string) => void;
}) {
  const suggested = defaultFilenameFor(block, index);
  const highlighted = useMemo(() => {
    try {
      if (block.lang && hljs.getLanguage(block.lang)) return hljs.highlight(block.code, { language: block.lang }).value;
      return hljs.highlightAuto(block.code).value;
    } catch {
      return hljs.escapeHTML(block.code);
    }
  }, [block]);

  async function copy() {
    await navigator.clipboard.writeText(block.code);
  }
  async function save() {
    const res = await window.api!.saveAs(suggested, block.code);
    if (res?.ok) onSaved(res.rel || (res as any).path || suggested);
  }

  return (
    <div className="code-card" tabIndex={0}>
      <div className="lang-chip">{(block.lang || "code").toLowerCase()}</div>
      <div className="floating-actions">
        <button className="icon-btn ghost" onClick={copy} title="Copy">
          <IconCopy />
        </button>
        <button className="icon-btn ghost" onClick={save} title="Save">
          <IconSave />
        </button>
      </div>
      <pre>
        <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}

/* ---------------------- App ---------------------- */
export default function App() {
  const bridge = useMemo(() => (typeof window !== "undefined" ? window.api : undefined), []);
  const [root, setRoot] = useState<string>("");
  const [chat, setChat] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PendingExec | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [autoExec, setAutoExec] = useState<boolean>(true);

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  type ViewMode = "split" | "aiOnly" | "editorOnly";
const [viewMode, setViewMode] = useState<ViewMode>("aiOnly");
  const bootingRef = useRef(true);
  // Back-compat: if legacy code references paneMode, alias to viewMode
  const paneMode: ViewMode = viewMode;

  const containerStyle = useMemo<React.CSSProperties>(() => {
        // In split mode, don't override any layout the app already has.
        if (viewMode === "split") return {};
        // For single-pane modes, keep it simple and full-width.
        return { display: "grid", gridTemplateColumns: "1fr", height: "100%" };
      }, [viewMode]);

const aiPaneStyle = useMemo<React.CSSProperties>(() => {
        return viewMode === "editorOnly" ? { display: "none" } : {};
      }, [viewMode]);

const editorPaneStyle = useMemo<React.CSSProperties>(() => {
        return viewMode === "aiOnly" ? { display: "none" } : {};
      }, [viewMode]);

const dividerStyle = useMemo<React.CSSProperties>(() => {
        return viewMode === "split" ? {} : { display: "none" };
      }, [viewMode]);
    // Source/Model switching
  type AISourceInfo = { id: "openai" | "chatly" | "v0"; label: string; envVar: string; hasKey: boolean; supported: boolean; models: string[] };
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [sources, setSources] = useState<AISourceInfo[]>([]);
  const [selProvider, setSelProvider] = useState<string>("openai");
  const [selModel, setSelModel] = useState<string>("gpt-4o-mini");
  // ——— Editor pane state ———
  const [editorTab, setEditorTab] = useState<"view" | "edit">("view");
  const [showEditorConsole, setShowEditorConsole] = useState(false);
  const [editorLogs, setEditorLogs] = useState<Array<{ level: "log"|"warn"|"error"; message: string }>>([]);
  const webviewRef = useRef<any>(null); // Electron.WebviewTag; 'any' to avoid type friction

  // Where to load in the Editor "View" tab:
  const editorURL = (cfg?.EDITOR_URL as string) || "http://localhost:3000";

  // First-run walkthrough if a selected provider is missing keys
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  // --- Editor file state ---
  const [edFile, setEdFile] = useState<{ rel: string; abs: string; fileURL?: string } | null>(null);
  const [edText, setEdText] = useState<string>("");
  const [edDirty, setEdDirty] = useState<boolean>(false);
  const [edViewAvailable, setEdViewAvailable] = useState<boolean>(false);
  

// Editor focus ref
const editorViewRef = useRef<any>(null);
const focusEditor = useCallback(() => {
  try { editorViewRef.current?.focus?.(); } catch {}
  try {
    const el = document.querySelector('.cm-editor [contenteditable="true"]') as HTMLElement | null;
    el?.focus();
  } catch {}
}, []);

const [edPreviewType, setEdPreviewType] = useState<"none" | "file" | "md">("none");
  

// --- Multi-tab editor state ---
type EditorTab = {
  id: string;
  title: string;
  file: { rel: string; abs: string; fileURL?: string } | null;
  text: string;
  dirty: boolean;
  previewType: "none" | "file" | "md";
  viewAvailable: boolean;
};

const initialTabId = useMemo(() => crypto.randomUUID(), []);
const [edTabs, setEdTabs] = useState<EditorTab[]>([{
  id: initialTabId,
  title: "Untitled",
  file: null,
  text: "",
  dirty: false,
  previewType: "none",
  viewAvailable: false,
}]);
const [activeTabId, setActiveTabId] = useState<string>(initialTabId);

// Share the open buffer with the AI when sending
  const [shareOpenFile, setShareOpenFile] = useState<boolean>(false);
  // code editor refs
  const edGutterRef = useRef<HTMLDivElement | null>(null);
  const edTextRef = useRef<HTMLTextAreaElement | null>(null);
  const [edLineCount, setEdLineCount] = useState<number>(1);
  useEffect(() => {
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
    } else {
      // Fallback: just default to OpenAI entries
      setSources([{ id: "openai", label: "ChatGPT", envVar: "OPENAI_API_KEY", hasKey: true, supported: true, models: ["gpt-4o-mini","gpt-4o","gpt-4.1-mini","gpt-4.1"] }]);
      setSelProvider(cfg?.PROVIDER || "openai");
      setSelModel(cfg?.MODEL || "gpt-4o-mini");
      setShowSourceModal(true);
    }
  }

  async function saveSourceModel() {
    if (!cfg) return;
    const next = { ...cfg, PROVIDER: selProvider, MODEL: selModel };
    const res = await bridge!.updateConfig?.(next);
    if (res?.ok) {
      setCfg(res.config);
      setShowSourceModal(false);
    }
  }

  // Utility: is current cfg provider usable?
  async function ensureProviderReady(): Promise<boolean> {
    const data = await bridge?.getAISources?.();
    if (!data?.ok) return true; // don't block if unknown
    const src = (data.sources as AISourceInfo[]).find(s => s.id === (cfg?.PROVIDER || "openai"));
    if (!src) return true;
    if (src.supported && src.hasKey) return true;
    // Block and show walkthrough
    setShowWalkthrough(true);
    return false;
  }


  // Summary modal
  const [showSummary, setShowSummary] = useState(false);
  const [summaryJSON, setSummaryJSON] = useState<any | null>(null);
  const [carryoverMD, setCarryoverMD] = useState<string>("");
  const [summaryBusy, setSummaryBusy] = useState(false);

  // Thinking placeholder management
  const pendingIndexRef = useRef<number | null>(null);
  const thinkingTimerRef = useRef<number | null>(null);

  // New: send/stop toggle & local cancel guard
  const [isAsking, setIsAsking] = useState(false);
  const requestIdRef = useRef(0);

  const chatRef = useRef<HTMLDivElement>(null);

  // keep chat pinned to bottom unless the user scrolls up
  const shouldStickRef = useRef(true);

  const handleChatScroll = useCallback(() => {
    const el = chatRef.current;
    if (!el) return;
    const threshold = 64; // px from bottom counts as "at bottom"
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldStickRef.current = distance <= threshold;
  }, []);

  function scrollToBottom() {
    const el = chatRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }


  // auto-scroll when messages change, but only if user is near the bottom
  useEffect(() => {
    if (shouldStickRef.current) scrollToBottom();
  }, [chat]);

  // also react to DOM changes (code highlight growth, reveal animations)
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const mo = new MutationObserver(() => {
      if (shouldStickRef.current) scrollToBottom();
    });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, []);


  // initial root + config load
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await bridge?.getRoot?.();
        const rt = typeof r === "string" ? r : r?.root ?? "(no bridge)";
        if (mounted) setRoot(rt);

        const c = await bridge?.getConfig?.();
        if (c?.ok) {
          if (mounted) {
            
            setViewMode((c.config as any).UI_MODE ?? "aiOnly");
            if (c.root && c.root !== rt) setRoot(c.root);
          }
        }
      } catch {
        if (mounted) setRoot("(bridge error)");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [bridge]);

  // exec pending event (optional)
  useEffect(() => {
    const off = bridge?.onExecPending?.((req) => setPending(req));
    return () => {
      if (off) off();
    };
  }, [bridge]);

  useEffect(() => {
    const off = bridge?.onMenu?.((cmd) => {
      if (cmd === "openSettings") openSettings();
      else if (cmd === "summarize") summarizeNow();
      else if (cmd === "stop") cancelAsk();
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
      if (typeof off === "function") off();
    };
  }, [bridge]);
  useEffect(() => {
  const off = bridge?.onMenu?.(async (cmd: string) => {
    if (cmd === "toggleEditorConsole") {
      setShowEditorConsole((v) => !v);
    } else if (cmd === "file:open") {
      const res = await bridge?.openEditorFile?.();
      if (res?.ok) {
        await openResultAsTab(res);
        if (!bootingRef.current && viewMode === "aiOnly") { setViewMode("split"); try { await bridge?.updateConfig?.({ UI_MODE: "split" } as any); } catch {} }
        return;

        setEdFile({ rel: res.rel, abs: res.abs, fileURL: res.fileURL });
        setEdText(res.content);
        setEdDirty(false);
        if (res.previewable) {
          // Decide preview type:
          if (/\.(md|markdown)$/i.test(res.rel)) {
            setEdPreviewType("md");
          } else {
            setEdPreviewType("file");
          }
          setEdViewAvailable(true);
          setEditorTab("view");
        } else {
          setEdPreviewType("none");
          setEdViewAvailable(false);
          setEditorTab("edit");
        }
      }
    } else if (cmd === "file:save") { if (!edFile) return; const ok = await bridge?.saveEditorFile?.(edFile.rel, edText); if (ok?.ok) { setEdDirty(false); setEdTabs(ts => ts.map(t => t.id === activeTabId ? { ...t, dirty: false } : t)); } } else if (cmd === "file:saveAs") {
      const res = await bridge?.saveEditorFileAs?.(edFile?.rel, edText);
      if (res?.ok) {
        setEdFile({ rel: res.rel, abs: res.abs, fileURL: res.fileURL });
        setEdTabs(ts => ts.map(t => t.id === activeTabId ? { ...t, file: { rel: res.rel, abs: res.abs, fileURL: res.fileURL }, dirty: false, previewType: (res.previewable ? (/\.(md|markdown)$/i.test(res.rel) ? "md" : "file") : "none"), viewAvailable: !!res.previewable } : t));
        setEdDirty(false);
        if (res.previewable) {
          if (/\.(md|markdown)$/i.test(res.rel)) setEdPreviewType("md");
          else setEdPreviewType("file");
          setEdViewAvailable(true);
        } else {
          setEdPreviewType("none");
          setEdViewAvailable(false);
        }
      }
    }
  });
  return () => { if (typeof off === "function") off(); };
}, [bridge, edFile, edText]);


// --- Tab helpers ---


useEffect(() => {
  const t = edTabs.find(x => x.id === activeTabId);
  if (t) {
    // Keep editor/view mode in sync with tab's previewability
    setEditorTab(t.previewType !== "none" ? "view" : "edit");
  }
}, [activeTabId, edTabs]);

// Ensure the correct pane is visible immediately after a file loads
useEffect(() => {
  if (edPreviewType !== "none") setEditorTab("view");
  else setEditorTab("edit");
}, [edFile?.rel, edPreviewType]);




const findTab = (id: string) => edTabs.find(t => t.id === id);
const findTabByRel = (rel: string) => edTabs.find(t => t.file?.rel === rel);
const basename = (p: string) => { try { return p.split(/[\\/]/).pop() || p; } catch { return p; } };

function syncFromTab(t: EditorTab) {
  setEdFile(t.file);
  setEdText(t.text);
  setEdDirty(t.dirty);
  setEdPreviewType(t.previewType);
  setEdViewAvailable(t.viewAvailable);
}

function activateTab(id: string) {
  const t = findTab(id);
  if (!t) return;
  setActiveTabId(id);
  syncFromTab(t);
}

async function openResultAsTab(res: any) {
  if (!res?.ok) return;
  const existing = res?.rel ? findTabByRel(res.rel) : undefined;
  if (existing) { activateTab(existing.id); setEditorTab(existing.previewType !== "none" ? "view" : "edit"); setTimeout(() => focusEditor(), 0); return; }
  const t: EditorTab = {
    id: crypto.randomUUID(),
    title: basename(res.rel || "Untitled"),
    file: { rel: res.rel, abs: res.abs, fileURL: res.fileURL },
    text: res.content ?? "",
    dirty: false,
    previewType: (res.previewable ? (/\.(md|markdown)$/i.test(res.rel) ? "md" : "file") : "none"),
    viewAvailable: !!res.previewable,
  };
  setEdTabs(ts => [...ts, t]);
  setActiveTabId(t.id);
  syncFromTab(t);
  setTimeout(() => focusEditor(), 0);
}

async function closeTabWithSave(id: string) {
  const t0 = findTab(id);
  if (!t0) return;
  let t = t0;

  // If dirty, prompt Save / Save As with suggested name
  if (t.dirty) {
    const ask = window.confirm(`Save changes to ${t.file?.rel || "Untitled.txt"}?`);
    if (!ask) {
      // user chose No: close without saving
      setEdTabs(ts => ts.filter(x => x.id !== id));
      if (id === activeTabId) {
        setTimeout(() => {
          setEdTabs(ts => {
            if (ts.length === 0) {
              const u: EditorTab = { id: crypto.randomUUID(), title: "Untitled", file: null, text: "", dirty: false, previewType: "none", viewAvailable: false };
              setActiveTabId(u.id);
              syncFromTab(u);
              return [u];
            }
            const next = ts[ts.length - 1];
            setActiveTabId(next.id);
            syncFromTab(next);
            return ts;
          });
        });
      }
      return;
    }

    const suggested = t.file?.rel || "Untitled.txt";
    const res = await bridge?.saveEditorFileAs?.(suggested, t.text);
    if (!res?.ok) return; // user cancelled
    const updated: EditorTab = {
      ...t,
      file: { rel: res.rel, abs: res.abs, fileURL: res.fileURL },
      dirty: false,
      previewType: (res.previewable ? (/\.(md|markdown)$/i.test(res.rel) ? "md" : "file") : "none"),
      viewAvailable: !!res.previewable,
    };
    setEdTabs(ts => ts.map(x => x.id === t.id ? updated : x));
    if (t.id === activeTabId) syncFromTab(updated);
    t = updated;
  }

  // Remove the tab
  setEdTabs(ts => ts.filter(x => x.id !== id));
  // If it was active, activate another or create Untitled
  if (id === activeTabId) {
    setTimeout(() => {
      setEdTabs(ts => {
        if (ts.length === 0) {
          const u: EditorTab = {
            id: crypto.randomUUID(),
            title: "Untitled",
            file: null, text: "", dirty: false, previewType: "none", viewAvailable: false
          };
          setActiveTabId(u.id);
          syncFromTab(u);
          return [u];
        }
        const next = ts[ts.length - 1];
        setActiveTabId(next.id);
        syncFromTab(next);
        return ts;
      });
    });
  }
}

// Mirror active tab into single-buffer state at mount
useEffect(() => {
  const t = edTabs.find(t => t.id === activeTabId);
  if (t) syncFromTab(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);





  useEffect(() => {
    const wv = webviewRef.current as any;
    if (!wv) return;

    // Collect console messages
    const onConsole = (e: any) => {
      const level: number = e.level; // 0=log, 1=warn, 2=error per Electron docs
      const map: any = { 0: "log", 1: "warn", 2: "error" };
      setEditorLogs((logs) => [
        ...logs,
        { level: map[level] || "log", message: String(e.message) },
      ]);
    };
    const onCrashed = (_e: any) => {
      setEditorLogs((logs) => [...logs, { level: "error", message: "Webview crashed" }]);
    };
    const onFailLoad = (_e: any) => {
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
      } catch {}
    };
  }, [editorTab, editorURL]);

  // Paste handler: turn pasted text into a jailed temp file + attachment
  const onPasteToAttach = useCallback(
    async (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData?.getData("text");
      if (!text) return;
      e.preventDefault(); // don't paste into input; treat as attachment

      const fence = text.match(/```([a-z0-9_-]+)?/i);
      const inferred = fence?.[1]?.toLowerCase() || (/#|```|^ {0,3}[-*+]\s|\d+\.\s|^#+\s/m.test(text) ? "md" : "txt");
      const langMap: Record<string, string> = {
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
      const ext =
        inferred === "md"
          ? "md"
          : lang && ["powershell", "bash", "python"].includes(lang)
          ? ({ powershell: "ps1", bash: "sh", python: "py" } as any)[lang]
          : inferred;

      const rel = `temp/paste-${Date.now()}.${ext || "txt"}`;
      try {
        await bridge?.writeFile?.(rel, text);
      } catch {}

      const name = `clipboard.${ext || "txt"}`;
      const att: Attachment = {
        name,
        displayPath: rel,
        size: text.length,
        truncated: false,
        content: text,
        lang: lang || "",
      };
      setAttachments((a) => [...a, att]);
      setChat((c) => [...c, { from: "system", text: `Attached ${name} (${fmtBytes(att.size)})`, ts: Date.now() }]);
    },
    [bridge]
  );

  // Import file (attach only)
  const importFile = useCallback(async () => {
    if (!bridge?.pickFile) {
      setChat((c) => [...c, { from: "ai", text: "PickFile bridge not available", ts: Date.now() }]);
      return;
    }
    const res = await bridge.pickFile();
    if (!res?.ok || !res.content) return;
    const ext = (res.name?.split(".").pop() || "txt").toLowerCase();
    const map: Record<string, string> = {
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
  useEffect(() => {
  const off = bridge?.onMenu?.(async (cmd: string) => {
    if (!cmd?.startsWith("ui:")) return;
    const next =
      cmd === "ui:aiOnly" ? "aiOnly" :
      cmd === "ui:editorOnly" ? "editorOnly" :
      "split" as ViewMode;
    setViewMode(next);
    // persist to config
    try { await bridge?.updateConfig?.({ UI_MODE: next } as any); } catch {}
  });
  return () => { if (typeof off === "function") off(); };
}, [bridge]);
  

  // send with thinking placeholder + graceful reveal
  async function send() {
    const q = input.trim();
    if (!q && attachments.length === 0) return;
    // Block and show walkthrough if selected provider lacks a key/support
    const ready = await ensureProviderReady();
    if (!ready) return;

    setIsAsking(true);
    const myId = ++requestIdRef.current;

    // Merge editor buffer if sharing is on (uses UNSAVED text so AI sees latest)
    let allAtts = attachments;
    if (shareOpenFile && (edText?.length || edFile)) {
      const ext = (edFile?.rel?.split(".").pop() || "txt").toLowerCase();
      const map: Record<string, string> = {
        ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", json: "json",
        yml: "yaml", yaml: "yaml", html: "html", css: "css",
        ps1: "powershell", sh: "bash", py: "python", md: "md", txt: ""
      };
      const lang = map[ext] || "";
      const name = edFile?.rel || "untitled.txt";
      const virt: Attachment = {
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
    if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    thinkingTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - t0;
      setChat((c) => {
        const i = pendingIndexRef.current;
        if (i == null || i >= c.length) return c;
        const copy = c.slice();
        copy[i] = { ...copy[i], text: `Thinking: ${fmtDuration(elapsed)}` };
        return copy;
      });
    }, 300) as unknown as number;

    try {
      if (!bridge?.askAI) throw new Error("Preload bridge not available");
      const a = await bridge.askAI(prompt);
      // If canceled or superseded, ignore this response
      if (myId !== requestIdRef.current) return;

      const t1 = Date.now();
      const aiText = toText(a) || "(no text)";

      clearInterval(thinkingTimerRef.current!);
      setChat((c) => {
        const i = pendingIndexRef.current;
        const payload = { from: "ai", text: aiText, ts: t1, durMs: t1 - t0, anim: "appear" } as Msg;
        if (i == null || i >= c.length) return [...c, payload];
        const copy = c.slice();
        copy[i] = payload;
        return copy;
      });

      await maybeAutoExec(aiText);
    } catch (err: any) {
      // If canceled or superseded, ignore error UI
      if (myId !== requestIdRef.current) return;

      const t1 = Date.now();
      clearInterval(thinkingTimerRef.current!);
      setChat((c) => {
        const i = pendingIndexRef.current;
        const payload = {
          from: "ai",
          text: "Error: " + (err?.message ?? String(err)),
          ts: t1,
          durMs: t1 - t0,
          anim: "appear",
        } as Msg;
        if (i == null || i >= c.length) return [...c, payload];
        const copy = c.slice();
        copy[i] = payload;
        return copy;
      });
    } finally {
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
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
      setChat((c) => {
        const i = pendingIndexRef.current;
        const t = Date.now();
        if (i == null || i >= c.length) return [...c, { from: "ai", text: "Canceled.", ts: t, anim: "appear" }];
        const copy = c.slice();
        copy[i] = { from: "ai", text: "Canceled.", ts: t, anim: "appear" } as any;
        return copy;
      });
    } finally {
      pendingIndexRef.current = null;
      setIsAsking(false);
    }
  }

  // optional auto-exec on code reply
  async function maybeAutoExec(aiText: string) {
    if (!autoExec) return;
    const blocks = extractCodeBlocks(aiText);
    if (!blocks.length) return;
    const b = blocks[0];
    const ext = langToExt(b.lang);
    if (!ext || ext === "txt") return;
    const rel = `temp/ai-snippet-${Date.now()}.${ext}`;
    try {
      await bridge!.writeFile(rel, b.code);
      const cmd = execCmdFor(ext, rel);
      if (!cmd) return;
      await bridge!.requestExec({ id: crypto.randomUUID(), command: cmd, cwd: root || "." });
      // modal shown via onExecPending
    } catch (e: any) {
      setChat((c) => [...c, { from: "system", text: "Auto-exec setup failed: " + (e?.message ?? e), ts: Date.now() }]);
    }
  }

  // manual test exec
  async function testExec() {
    try {
      if (!bridge?.requestExec) throw new Error("Preload bridge not available");
      await bridge.requestExec({ id: crypto.randomUUID(), command: "Get-ChildItem -Force", cwd: root || "." });
    } catch (err: any) {
      setChat((c) => [...c, { from: "system", text: "Exec request error: " + (err?.message ?? String(err)), ts: Date.now() }]);
    }
  }

  async function approve(yes: boolean) {
    if (!pending) return;
    try {
      const res = await bridge!.approveExec(pending.id, yes);
      if (res?.status === "error") {
        setChat((c) => [...c, { from: "system", text: `Execution error: ${res.error || "unknown"}`, ts: Date.now() }]);
      } else if (yes && res?.status === "done") {
        const out = [
          `Exit: ${res.code}`,
          res.stdout ? `STDOUT:\n${res.stdout}` : "",
          res.stderr ? `STDERR:\n${res.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        setChat((c) => [...c, { from: "system", text: "```txt\n" + out + "\n```", ts: Date.now() }]);
      } else {
        setChat((c) => [...c, { from: "system", text: "Execution rejected.", ts: Date.now() }]);
      }
    } catch (e: any) {
      setChat((c) => [...c, { from: "system", text: "Approval error: " + (e?.message ?? e), ts: Date.now() }]);
    } finally {
      setPending(null);
    }
  }

  // settings
  async function openSettings() {
    const res = await bridge!.getConfig?.();
    if (res?.ok) {
      setCfg(res.config);
      setShowSettings(true);
    }
  }
  async function saveSettings() {
    if (!cfg) return;
    const res = await bridge!.updateConfig?.(cfg);
    if (res?.ok) {
      setCfg(res.config);
      setAutoExec(res.config.AUTO_EXEC);
      setRoot(res.config.ROOT_DIR);
      setShowSettings(false);
    }
  }
  async function chooseRootInSettings() {
    const res = await bridge!.selectRoot?.();
    if (res?.ok && cfg) setCfg({ ...cfg, ROOT_DIR: res.root! });
  }

  // summarize
  async function summarizeNow() {
    try {
      setSummaryBusy(true);
      const transcript = serializeTranscript(chat);
      const prompt = `${SUMMARIZER_PROMPT}\n\nTRANSCRIPT:\n${transcript}`;
      if (!bridge?.askAI) throw new Error("Bridge askAI unavailable");
      const raw = await bridge.askAI(prompt);
      const txt = toText(raw);
      const jsonStart = txt.indexOf("{");
      const jsonEnd = txt.lastIndexOf("}");
      if (jsonStart < 0 || jsonEnd < 0) throw new Error("No JSON in summary");
      const parsed = JSON.parse(txt.slice(jsonStart, jsonEnd + 1));
      setSummaryJSON(parsed);
      setCarryoverMD(parsed.carryover_md || "");
      setShowSummary(true);
    } catch (e: any) {
      setChat((c) => [...c, { from: "ai", text: "Summary error: " + (e?.message ?? e), ts: Date.now() }]);
    } finally {
      setSummaryBusy(false);
    }
  }
  async function saveSummaryFiles() {
    if (!summaryJSON) return;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `snapshots/${ts}`;
    try {
      await bridge!.writeFile(`${base}-snapshot.json`, JSON.stringify(summaryJSON, null, 2));
      await bridge!.writeFile(`${base}-carryover.md`, carryoverMD || "");
      setChat((c) => [...c, { from: "system", text: `Saved snapshots → ${base}-*.{json,md}`, ts: Date.now() }]);
    } catch (e: any) {
      setChat((c) => [...c, { from: "system", text: "Save summary error: " + (e?.message ?? e), ts: Date.now() }]);
    }
  }

  function renderMessage(m: Msg, i: number) {
    const text = toText(m.text);
    const blocks = m.from !== "user" ? extractCodeBlocks(text) : [];
    const plain = text.replace(/```[\s\S]*?```/g, "").trim();
    const showMeta = m.from === "ai" && (m.ts || m.durMs !== undefined);
    return (
      <div className={`msg ${m.anim || ""}`} key={i}>
        <b>{m.from === "user" ? "You" : m.from === "system" ? "System" : "AI"}</b>
        {showMeta && (
          <span style={{ marginLeft: 8, color: "#9ca3af", fontSize: 12 }}>
            {fmtClock(m.ts)}
            {m.durMs !== undefined ? ` • ${fmtDuration(m.durMs)}` : ""}
          </span>
        )}{" "}
        <span dangerouslySetInnerHTML={{ __html: renderMarkdown(plain || (blocks.length ? "" : text)) }} />
        {blocks.map((b, idx) => (
          <CodeCard
            key={`${i}-${idx}`}
            block={b}
            index={idx}
            onSaved={(p) => setChat((c) => [...c, { from: "system", text: `Saved → ${p}`, ts: Date.now() }])}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`container ${summaryBusy ? "busy" : ""}`}
      style={{
        ...(summaryBusy ? { filter: "grayscale(0.3) opacity(0.7)" } : null),
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
      }}
    >

      {/* Header with Summarize + Settings */}
      <div className="main-split" style={containerStyle}>
  {/* ─────────── LEFT: AI pane ─────────── */}
  <section className="ai-pane" style={aiPaneStyle}>
    {/* Header now sits OUTSIDE the scroller (top row of the grid) */}
    <div className="header">
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600 }}>
        Kage 2.0
        {!!cfg && (
          <React.Fragment>
            <ProviderBadge provider={cfg.PROVIDER || "openai"} onClick={openSourceModal} />
            <ModelBadge model={cfg.MODEL || "gpt-4o-mini"} onClick={openSourceModal} />
          </React.Fragment>
        )}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button className="icon-btn" onClick={openSettings} title="Settings">
          <IconGear />
        </button>
        <button
        className="icon-btn"
        style={{ marginRight: 2, background: "none" }}
        aria-label={shareOpenFile ? "AI can see the buffer" : "AI cannot see the buffer"}
        title={shareOpenFile ? "AI can see the text (click to hide)" : "AI cannot see (click to let AI see this file when asking)"}
        onClick={() => setShareOpenFile(v => !v)}
      >
        {shareOpenFile ? <IconEye /> : <IconEyeOff />}
      </button>
      </div>
    </div>

    {/* Middle row = the ONLY scroller */}
    <div
      className="ai-scroll"
      ref={chatRef}
      onScroll={handleChatScroll}
    >
      <div className="chat">
        {chat.map((m, i) => renderMessage(m, i))}
      </div>
    </div>

    {/* Bottom row = input bar (not sticky now; just pinned by the grid) */}
    <div className="row">
      <button className="icon-btn" onClick={importFile} title="Attach file">
        <IconPaperclip />
      </button>

      <div
        className="input-wrap"
        style={{
          marginLeft: 8,
          display: "grid",
          gridTemplateColumns: "1fr 36px",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <input
          type="text"
          placeholder="Ask the model… (paste to attach)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((cfg?.SEND_ON_ENTER ?? true) && e.key === "Enter") send();
          }}
          onPaste={onPasteToAttach}
          style={{ minWidth: 0 }}
        />
        {!isAsking ? (
          <button className="icon-btn send-btn primary" onClick={send} title="Send" style={{ width: 32, height: 32 }}>
            <IconSend />
          </button>
        ) : (
          <button className="icon-btn danger" onClick={cancelAsk} title="Stop" style={{ width: 32, height: 32 }}>
            <IconStop />
          </button>
        )}
      </div>
    </div>
  </section>


  {/* Divider */}
  <div className="split-divider" style={dividerStyle} />

  {/* ─────────── RIGHT: Editor pane ─────────── */}
<section className="editor-pane" style={editorPaneStyle}>
  <div className="editor-header" style={{ paddingBottom: 0, marginBottom: 0 }}>
    <div className="editor-tabs" style={{display: "flex", gap: 6, padding: "4px 6px 0 6px", border: "none", borderBottom: "none", borderTopLeftRadius: 8, borderTopRightRadius: 8, background: "transparent", marginBottom: -1}}>
  {edTabs.map(t => (
    <div
      key={t.id}
      className={`tab ${t.id === activeTabId ? "active" : ""}`}
      onClick={() => activateTab(t.id)}
      title={t.file?.rel || t.title}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 5px 0 5px", cursor: "pointer", border: "1px solid var(--border)", borderBottom: "none", borderTopLeftRadius: 6, borderTopRightRadius: 6, background: (t.id === activeTabId ? "var(--panel-2)" : "transparent"), boxShadow: (t.id === activeTabId ? "inset 0 -2px 0 0 var(--panel)" : "none"), fontSize: "72%" }}
    >
      <span className="tab-title" style={{ userSelect: "none" }}>
        {(t.file?.rel ? (t.file.rel.split(/[\\/]/).pop() || t.title) : t.title)}{t.dirty ? "*" : ""}
      </span>
      <button
        className="tab-close"
        onClick={(e) => { e.stopPropagation(); closeTabWithSave(t.id); }}
        title="Close tab"
        style={{ border: "none", background: "transparent", fontWeight: 700, cursor: "pointer", fontSize: "90%", lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  ))}
</div>

    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
    </div>

  </div>

  <div className="editor-body">
    {editorTab === "view" ? (
      edPreviewType === "md" ? (
        <div className="editor-view" style={{ overflow: "auto", padding: 0 }}>
          <div
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(edText) as string) }}
          />
        </div>
      ) : (
        <div className="editor-view">
          <webview
            ref={webviewRef}
            className="editor-webview"
            src={edFile?.fileURL || editorURL}
            allowpopups="true"
          />
        </div>
      )
    ) : (
      <div className="editor-view">
        <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <CodeMirror
            value={edText}
           
            theme={[oneDark, cmTheme]}
            extensions={[
              lineNumbers(),
              highlightActiveLineGutter(),
              history(),
              highlightActiveLine(),
              highlightSelectionMatches(),
              keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
              cmLangForFilename(edFile?.rel),
            ]}
            onCreateEditor={(view) => { editorViewRef.current = view; setTimeout(() => view.focus(), 0); }} onChange={(val) => { setEdText(val); setEdDirty(true); setEdTabs(ts => ts.map(t => t.id === activeTabId ? { ...t, text: val, dirty: true } : t)); }}
            basicSetup={false}
          />
        </div>
      </div>

    )}

    {showEditorConsole && (
      <div className="editor-console">
        {editorLogs.length === 0 ? (
          <div className="log" style={{ opacity: 0.7 }}>Console is empty.</div>
        ) : (
          editorLogs.map((l, i) => (
            <div key={i} className={`log ${l.level}`}>
              [{l.level.toUpperCase()}] {l.message}
            </div>
          ))
        )}
      </div>
    )}
  </div>
</section>


</div>


      {/* Approval modal */}
      {pending && (
        <div className="modal-backdrop" onClick={() => setPending(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>Approve Command</header>
            <div className="body">
              <p style={{ color: "#9ca3af", marginTop: 0 }}>CWD</p>
              <pre>{pending.cwd}</pre>
              <p style={{ color: "#9ca3af" }}>Command</p>
              <pre>{pending.command}</pre>
            </div>
            <div className="row-btns">
              <button className="icon-btn danger" onClick={() => approve(false)} title="Reject">
                ✖
              </button>
              <button className="icon-btn ok" onClick={() => approve(true)} title="Approve">
                ✔
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && cfg && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>Settings</header>
            <div className="body" style={{ display: "grid", gap: 12 }}>
              <div>
                <div style={{ color: "var(--sub)", marginBottom: 4 }}>Working directory</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <code
                    style={{
                      background: "#0b1020",
                      padding: "6px 8px",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {cfg.ROOT_DIR || root}
                  </code>
                  <button className="icon-btn" onClick={async () => await chooseRootInSettings()} title="Change root">
                    <IconFolderPlus />
                  </button>
                </div>
              </div>
              <div className="field-row" style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "center" }}>
                <label style={{ color: "var(--sub)" }}>Editor URL</label>
                <input
                  type="text"
                  value={cfg?.EDITOR_URL || "http://localhost:3000"}
                  onChange={(e) => setCfg((c) => c ? { ...c, EDITOR_URL: e.target.value } : c)}
                  onBlur={async (e) => {
                    const next = { ...(cfg as any), EDITOR_URL: e.target.value };
                    const res = await bridge!.updateConfig?.(next);
                    if (res?.ok) setCfg(res.config);
                  }}
                  placeholder="http://localhost:3000"
                />
              </div>
              <div className="field-row" style={{ display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 10, alignItems: "center" }}>
                <label style={{ color: "var(--sub)" }}>AI Source/Model</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="mono" style={{ opacity: 0.9 }}>
                    {(cfg.PROVIDER || "openai")} / {(cfg.MODEL || "gpt-4o-mini")}
                  </span>
                </div>
                <button className="icon-btn" onClick={openSourceModal} title="Change Source/Model">
                  Change…
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  id="autoexec"
                  type="checkbox"
                  checked={cfg.AUTO_EXEC}
                  onChange={(e) => setCfg({ ...cfg, AUTO_EXEC: e.target.checked })}
                />
                <label htmlFor="autoexec">Auto-execute AI code (with approval)</label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ color: "var(--sub)", marginBottom: 4 }}>AI Provider</div>
                  <select
                    value={cfg.PROVIDER}
                    onChange={(e) => setCfg({ ...cfg, PROVIDER: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px",
                      background: "var(--muted)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                    }}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="azure">Azure (future)</option>
                    <option value="anthropic">Anthropic (future)</option>
                    <option value="local">Local (future)</option>
                  </select>
                </div>
                <div>
                  <div style={{ color: "var(--sub)", marginBottom: 4 }}>Model</div>
                  <input
                    type="text"
                    value={cfg.MODEL}
                    onChange={(e) => setCfg({ ...cfg, MODEL: e.target.value })}
                    placeholder="e.g. gpt-4.1-mini"
                    style={{
                      width: "100%",
                      padding: "8px",
                      background: "var(--muted)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                    }}
                  />
                </div>
              </div>

              <div style={{ color: "var(--sub)" }}>Bridge: {bridge ? "OK" : "Missing"}</div>
            </div>
            <div className="row-btns">
              <button className="icon-btn" onClick={() => setShowSettings(false)}>
                Cancel
              </button>
              <button className="icon-btn ok" onClick={saveSettings}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Source/Model switcher modal */}
      {showSourceModal && (
        <div className="modal-backdrop" onClick={() => setShowSourceModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>Change Source & Model</header>
            <div className="body" style={{ display: "grid", gap: 12 }}>
              {(sources || []).map((s) => {
                const disabled = !s.hasKey || !s.supported;
                return (
                  <div key={s.id} style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr auto",
                    gap: 10,
                    opacity: disabled ? 0.5 : 1,
                    alignItems: "center",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 10,
                    background: "var(--panel)",
                  }}>
                    <div style={{ fontWeight: 600 }}>{s.label}</div>
                    <select
                      disabled={disabled}
                      value={s.id === selProvider ? selModel : (s.models?.[0] || "")}
                      onChange={(e) => {
                        if (s.id === selProvider) setSelModel(e.target.value);
                      }}
                      style={{
                        width: "100%",
                        padding: 8,
                        background: "var(--muted)",
                        color: "var(--text)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                      }}
                    >
                      {(s.models?.length ? s.models : ["(no models)"]).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="radio"
                        name="provider"
                        disabled={disabled}
                        checked={selProvider === s.id}
                        onChange={() => {
                          setSelProvider(s.id);
                          if (s.models?.length) setSelModel(s.models[0]);
                        }}
                        title={disabled ? (!s.supported ? "Not supported yet" : `Missing ${s.envVar}`) : "Select source"}
                      />
                      <span style={{ fontSize: 12, color: "var(--sub)" }}>
                        {disabled ? (!s.supported ? "Not supported yet" : `Missing ${s.envVar}`) : "Available"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="row-btns">
              <button className="icon-btn" onClick={() => setShowSourceModal(false)}>Cancel</button>
              <button className="icon-btn ok" onClick={saveSourceModel} disabled={!sources.length}>Save Default</button>
            </div>
          </div>
        </div>
      )}

      {/* Walkthrough for missing API key */}
      {showWalkthrough && (
        <div className="modal-backdrop" onClick={() => setShowWalkthrough(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>Set up your API key</header>
            <div className="body" style={{ display: "grid", gap: 12 }}>
              <p>The selected source isn’t ready yet. You’ll need to set an environment variable with your API key:</p>
              <ul>
                <li><b>ChatGPT (OpenAI):</b> set <code>OPENAI_API_KEY</code></li>
                <li><b>Chatly:</b> set <code>CHATLY_API_KEY</code></li>
                <li><b>v0.dev:</b> set <code>V0_API_KEY</code> (or <code>VERCEL_V0_API_KEY</code>)</li>
              </ul>
              <p>After updating your <code>.env.local</code>, restart the app.</p>
              <p><i>TODO:</i> full walkthrough: docs link + copyable CLI to create <code>.env.local</code>.</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="icon-btn ok" onClick={() => { setShowWalkthrough(false); openSourceModal(); }}>
                  Open Source/Model Picker
                </button>
                <button className="icon-btn" onClick={() => setShowWalkthrough(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary modal */}
      {showSummary && (
        <div className="modal-backdrop" onClick={() => setShowSummary(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>Carryover Summary</header>
            <div className="body" style={{ display: "grid", gap: 12, maxHeight: "60vh", overflowY: "auto" }}>
              <div style={{ color: "var(--sub)" }}>Carryover (paste this into a new chat):</div>
              <pre style={{ whiteSpace: "pre-wrap" }}>{carryoverMD}</pre>
              {summaryJSON && (
                <>
                  <div style={{ color: "var(--sub)" }}>Decisions</div>
                  <ul>{(summaryJSON.decisions || []).map((d: string, i: number) => <li key={i}>{d}</li>)}</ul>
                  <div style={{ color: "var(--sub)" }}>Open issues</div>
                  <ul>{(summaryJSON.open_issues || []).map((d: string, i: number) => <li key={i}>{d}</li>)}</ul>
                  <div style={{ color: "var(--sub)" }}>IPC</div>
                  <code>{JSON.stringify(summaryJSON.ipc || [], null, 2)}</code>
                </>
              )}
            </div>
            <div className="row-btns">
              <button className="icon-btn" onClick={() => navigator.clipboard.writeText(carryoverMD || "")}>
                Copy carryover
              </button>
              <button className="icon-btn ok" onClick={saveSummaryFiles}>
                Save files
              </button>
              <button className="icon-btn" onClick={() => setShowSummary(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top-most overlay while summarizing (inline styles so it works without extra CSS) */}
      {summaryBusy && (
        <div
          aria-busy="true"
          aria-live="polite"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(5,8,16,0.6)",
            backdropFilter: "blur(2px)",
            zIndex: 9999,
            display: "grid",
            placeItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              border: "3px solid rgba(255,255,255,0.2)",
              borderTopColor: "#60a5fa",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <div style={{ color: "#e5e7eb", fontWeight: 600, letterSpacing: 0.2 }}>Summarizing…</div>
          {/* keyframes shim */}
          <style>
            {`@keyframes spin { to { transform: rotate(360deg); } }`}
          </style>
        </div>
      )}
    </div>
  );
}


// Mark boot complete after first render\nuseEffect(() => { bootingRef.current = false; }, []);
