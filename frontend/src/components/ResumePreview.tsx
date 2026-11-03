"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { API_BASE, postWithRetry } from "@/lib/api";
import type { ResumeDoc } from "@/lib/types";

const A4_WIDTH = 794;   // CSS pixels at 96 dpi
const A4_HEIGHT = 1123;

/** Renders the resume in the chosen template exactly as the PDF will look, scaled to fit. */
export function ResumePreview({ resume, template }: { resume: ResumeDoc; template: string }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(0.5);
  const [height, setHeight] = useState(A4_HEIGHT);

  // Re-render shortly after edits stop, so typing stays smooth
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const form = new FormData();
        form.append("resume_json", JSON.stringify(resume));
        form.append("template", template);
        const res = await postWithRetry(`${API_BASE}/api/resume/render`, form);
        // The PDF gets its margins from @page; mimic them on screen
        if (!cancelled && res.ok) {
          setHtml((await res.text()).replace("</head>", "<style>body{padding:0.6in !important}</style></head>"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [resume, template]);

  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / A4_WIDTH));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-lg border border-line bg-white shadow-card"
         style={{ height: Math.max(height, A4_HEIGHT) * scale }}>
      <iframe
        ref={frame}
        title="Resume preview"
        srcDoc={html}
        sandbox="allow-same-origin"
        onLoad={() => {
          const doc = frame.current?.contentDocument;
          if (doc) setHeight(doc.documentElement.scrollHeight);
        }}
        className="absolute left-0 top-0 origin-top-left border-0"
        style={{ width: A4_WIDTH, height: Math.max(height, A4_HEIGHT), transform: `scale(${scale})` }}
      />
      {loading && (
        <div className="absolute right-3 top-3 rounded-md bg-surface/90 px-2 py-1 text-xs text-muted flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Updating
        </div>
      )}
    </div>
  );
}
