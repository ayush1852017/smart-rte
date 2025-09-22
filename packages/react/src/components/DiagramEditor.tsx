import React, { useEffect, useRef, useState } from "react";

export function DiagramEditor({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (dataUrl: string) => void;
}) {
  const [code, setCode] = useState(
    "graph TD\nA[Start] --> B{Decision}\nB -- Yes --> C[Do thing]\nB -- No --> D[Stop]"
  );
  const [svg, setSvg] = useState<string>("");
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const loadMermaid = async (): Promise<any> => {
        // Use existing global if present
        if ((window as any).mermaid) return (window as any).mermaid;
        // Load from CDN lazily to avoid bundler resolution
        await new Promise<void>((resolve) => {
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
          s.async = true;
          s.onload = () => resolve();
          s.onerror = () => resolve();
          document.head.appendChild(s);
        });
        return (window as any).mermaid;
      };

      try {
        const mermaid = await loadMermaid();
        if (mermaid && mermaid.initialize) {
          mermaid.initialize({ startOnLoad: false });
          const { svg } = await mermaid.render("diagram-preview", code);
          if (mounted.current) setSvg(svg);
        } else {
          setSvg(
            `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='80'><text x='10' y='40' font-family='monospace'>Mermaid not available</text></svg>`
          );
        }
      } catch {
        setSvg(
          `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='80'><text x='10' y='40' font-family='monospace'>Mermaid not available</text></svg>`
        );
      }
    })();
  }, [open, code]);

  if (!open) return null;

  const toDataUrl = (svgText: string) =>
    `data:image/svg+xml;utf8,${encodeURIComponent(svgText)}`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          padding: 16,
          borderRadius: 8,
          minWidth: 520,
          maxWidth: 820,
          width: "90%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Insert diagram (Mermaid)
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={12}
            style={{ width: "100%", fontFamily: "monospace" }}
          />
          <div
            style={{ border: "1px solid #eee", padding: 8, overflow: "auto" }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            marginTop: 12,
          }}
        >
          <button onClick={onClose}>Cancel</button>
          <button onClick={() => onInsert(toDataUrl(svg || ""))}>Insert</button>
        </div>
      </div>
    </div>
  );
}
