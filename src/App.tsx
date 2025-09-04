import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import { marked } from "marked";
import DOMPurify from "dompurify";

/* ---------------------- Bridge typing ---------------------- */
declare global {
  interface Window {
    api?: {
      // simple
      getRoot(): Promise<{ ok: boolean; root: string } | string>;
      askAI(prompt: string): Promise<any>; // may return string OR {ok,text}
      getMem?: () => Promise<{ ok: boolean; sys?: any; proc?: any; error?: string }>;

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
type Msg = { from: "user" | "ai"; text: string; ts?: number; durMs?: number; anim?: "appear" };
type CodeBlock = { lang: string; code: string };
type PendingExec = { id: string; command: string; cwd: string };
type Attachment = { name: string; displayPath: string; size: number; truncated: boolean; content: string; lang: string };
type AppConfig = { ROOT_DIR: string; AUTO_EXEC: boolean; PROVIDER: string; MODEL: string };

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

function MemoryBadge({ bridge }: { bridge: typeof window.api | undefined }) {
  const [text, setText] = React.useState<string>("—");

  React.useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await bridge?.getMem?.();
        if (!alive || !res?.ok) return;
        const kb = Number(res.proc?.workingSetSize ?? 0);        // process working set (KB)
        const mb = kb / 1024;
        const totalKb = Number(res.sys?.total ?? 0);             // system total (KB)
        const pct = totalKb ? (mb / (totalKb / 1024)) * 100 : 0; // process vs system (%)
        setText(`${mb.toFixed(0)} MB${pct ? ` • ${pct.toFixed(1)}%` : ""}`);
      } catch {
        if (alive) setText("—");
      }
    }
    tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [bridge]);

  return (
    <span
      className="badge"
      title="Process working set • % of system RAM"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--muted)",
        color: "var(--text)",
        fontSize: 12,
        lineHeight: 1,
      }}
    >
      RAM {text}
    </span>
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
    <div className="code-card">
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

  // Summary modal
  const [showSummary, setShowSummary] = useState(false);
  const [summaryJSON, setSummaryJSON] = useState<any | null>(null);
  const [carryoverMD, setCarryoverMD] = useState<string>("");
  const [summaryBusy, setSummaryBusy] = useState(false);

  // Thinking placeholder management
  const pendingIndexRef = useRef<number | null>(null);
  const thinkingTimerRef = useRef<number | null>(null);

  const chatRef = useRef<HTMLDivElement>(null);

  // auto-scroll
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

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
            setCfg(c.config);
            setAutoExec(c.config.AUTO_EXEC);
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
      setChat((c) => [...c, { from: "ai", text: `Attached ${name} (${fmtBytes(att.size)})`, ts: Date.now() }]);
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

  // send with thinking placeholder + graceful reveal
  async function send() {
    const q = input.trim();
    if (!q && attachments.length === 0) return;

    // Echo to chat (prompt + filenames/sizes)
    const filesLine = attachments.length ? " • " + attachments.map((a) => `${a.name} (${fmtBytes(a.size)})`).join(", ") : "";
    setChat((c) => [...c, { from: "user", text: (q || "(no prompt)") + filesLine, ts: Date.now() }]);

    // Build the model prompt with file contents
    let prompt = q || "(no prompt)";
    if (attachments.length) {
      const parts = attachments.map((att) => {
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
      setChat((c) => [...c, { from: "ai", text: "Auto-exec setup failed: " + (e?.message ?? e), ts: Date.now() }]);
    }
  }

  // manual test exec
  async function testExec() {
    try {
      if (!bridge?.requestExec) throw new Error("Preload bridge not available");
      await bridge.requestExec({ id: crypto.randomUUID(), command: "Get-ChildItem -Force", cwd: root || "." });
    } catch (err: any) {
      setChat((c) => [...c, { from: "ai", text: "Exec request error: " + (err?.message ?? String(err)), ts: Date.now() }]);
    }
  }

  async function approve(yes: boolean) {
    if (!pending) return;
    try {
      const res = await bridge!.approveExec(pending.id, yes);
      if (res?.status === "error") {
        setChat((c) => [...c, { from: "ai", text: `Execution error: ${res.error || "unknown"}`, ts: Date.now() }]);
      } else if (yes && res?.status === "done") {
        const out = [
          `Exit: ${res.code}`,
          res.stdout ? `STDOUT:\n${res.stdout}` : "",
          res.stderr ? `STDERR:\n${res.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        setChat((c) => [...c, { from: "ai", text: "```txt\n" + out + "\n```", ts: Date.now() }]);
      } else {
        setChat((c) => [...c, { from: "ai", text: "Execution rejected.", ts: Date.now() }]);
      }
    } catch (e: any) {
      setChat((c) => [...c, { from: "ai", text: "Approval error: " + (e?.message ?? e), ts: Date.now() }]);
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
      setChat((c) => [...c, { from: "ai", text: `Saved snapshots → ${base}-*.{json,md}`, ts: Date.now() }]);
    } catch (e: any) {
      setChat((c) => [...c, { from: "ai", text: "Save summary error: " + (e?.message ?? e), ts: Date.now() }]);
    }
  }

  function renderMessage(m: Msg, i: number) {
    const text = toText(m.text);
    const blocks = m.from === "ai" ? extractCodeBlocks(text) : [];
    const plain = text.replace(/```[\s\S]*?```/g, "").trim();
    const showMeta = m.from === "ai" && (m.ts || m.durMs !== undefined);
    return (
      <div className={`msg ${m.anim || ""}`} key={i}>
        <b>{m.from === "user" ? "You" : "AI"}</b>
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
            onSaved={(p) => setChat((c) => [...c, { from: "ai", text: `Saved → ${p}`, ts: Date.now() }])}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`container ${summaryBusy ? "busy" : ""}`}
      style={summaryBusy ? { filter: "grayscale(0.3) opacity(0.7)" } : undefined}
    >
      {/* Header with Summarize + Settings */}
      <div className="header">
        <div style={{ fontWeight: 600 }}>Kage 2.0</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <MemoryBadge bridge={bridge} />   {/* ← new */}
          <button
            className="icon-btn"
            onClick={summarizeNow}
            disabled={summaryBusy}
            title={summaryBusy ? "Summarizing…" : "Summarize & Save"}
            style={{ opacity: summaryBusy ? 0.6 : 1 }}
          >
            <IconSparkle />
          </button>
          
          <button className="icon-btn" onClick={openSettings} title="Settings">
            <IconGear />
          </button>
        </div>
      </div>

      {/* Chat */}
      <div className="chat" ref={chatRef}>
        {chat.length === 0 && (
          <div style={{ color: "#9ca3af" }}>
            Type a prompt, attach files (paperclip or paste), then hit Send. Open <b>Settings</b> (gear) to change the working directory
            and auto-exec.
          </div>
        )}
        {chat.map(renderMessage)}
      </div>

      {/* Input row */}
      <div className="row">
        <button className="icon-btn" onClick={importFile} title="Import file for AI">
          <IconImport />
        </button>

        {/* attached chips */}
        {attachments.length > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 8 }}>
            {attachments.map((a, idx) => (
              <span key={idx} className="badge" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                {a.name} {a.truncated ? "(truncated)" : ""}
                <button
                  className="icon-btn"
                  style={{ width: 22, height: 22, borderRadius: 6 }}
                  onClick={() => setAttachments((x) => x.filter((_, i) => i !== idx))}
                  title="Remove"
                >
                  <IconX />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="input-wrap" style={{ marginLeft: 8 }}>
          <input
            type="text"
            placeholder="Ask the model… (paste to attach)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            onPaste={onPasteToAttach}
          />
          <button className="icon-btn send-btn primary" onClick={send} title="Send">
            <IconSend />
          </button>
        </div>

        <button className="icon-btn" onClick={testExec} title="Request command approval">
          <IconArrowOut />
        </button>
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
