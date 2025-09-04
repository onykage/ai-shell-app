import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import "./styles.css"
import 'highlight.js/styles/github-dark.css'

window.addEventListener("error", e => {
  const el = document.getElementById("fatal"); if (!el) return;
  el.textContent = String(e.error?.stack || e.message || e);
  (el as HTMLElement).style.display = "block";
});
window.addEventListener("unhandledrejection", e => {
  const el = document.getElementById("fatal"); if (!el) return;
  el.textContent = String((e as any).reason?.stack || (e as any).reason || e);
  (el as HTMLElement).style.display = "block";
});

createRoot(document.getElementById('root')!).render(<App />)
