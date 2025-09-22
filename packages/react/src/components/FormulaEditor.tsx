import React, { useEffect, useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

export function FormulaEditor({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (tex: string, block: boolean) => void;
}) {
  const [tex, setTex] = useState("a^2 + b^2 = c^2");
  const [block, setBlock] = useState(false);
  const presets: { label: string; tex: string }[] = [
    {
      label: "Quadratic Formula",
      tex: "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}",
    },
    {
      label: "Binomial Theorem",
      tex: "(a+b)^n = \\sum_{k=0}^n \\binom{n}{k} a^{n-k} b^k",
    },
    { label: "Euler's Identity", tex: "e^{i\\pi}+1=0" },
    { label: "Pythagoras", tex: "a^2 + b^2 = c^2" },
    { label: "Derivative", tex: "\\frac{d}{dx} x^n = n x^{n-1}" },
    { label: "Integral", tex: "\\int_a^b f(x)\\,dx" },
    { label: "Limit", tex: "\\lim_{x\\to 0} \\frac{\\sin x}{x} = 1" },
    {
      label: "Matrix 2x2",
      tex: "\\begin{pmatrix} a & b \\ \\ c & d \\end{pmatrix}",
    },
    { label: "Chem: Water", tex: "\\ce{H2O}" },
    { label: "Chem: Combustion", tex: "\\ce{CH4 + 2 O2 -> CO2 + 2 H2O}" },
  ];

  const palette: string[] = [
    "\\frac{a}{b}",
    "\\sqrt{x}",
    "\\int_a^b",
    "\\sum_{i=1}^n",
    "\\prod_{i=1}^n",
    "\\lim_{x\\to 0}",
    "x^{2}",
    "x_{i}",
    "\\alpha",
    "\\beta",
    "\\gamma",
    "\\Delta",
    "\\ce{H2O}",
    "\\ce{CO2}",
  ];

  useEffect(() => {
    if (!open) return;
    try {
      const el = document.getElementById("katex-preview");
      if (el)
        katex.render(tex, el, {
          throwOnError: false,
          displayMode: block,
          macros: { "\\ce": "\\mhchem" } as any,
        });
    } catch {}
  }, [open, tex, block]);

  if (!open) return null;

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
          color: "black",
          padding: 16,
          borderRadius: 8,
          minWidth: 420,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Insert formula</div>
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}
        >
          {palette.map((t) => (
            <button
              key={t}
              onClick={() => setTex((prev) => (prev ? prev + " " + t : t))}
              title={t}
            >
              {t}
            </button>
          ))}
        </div>
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}
        >
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => setTex(p.tex)}
              title={p.tex}
              style={{ fontSize: 12 }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <textarea
          value={tex}
          onChange={(e) => setTex(e.target.value)}
          rows={4}
          style={{ width: "100%", fontFamily: "monospace", marginBottom: 8 }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <input
            type="checkbox"
            checked={block}
            onChange={(e) => setBlock(e.target.checked)}
          />{" "}
          Block
        </label>
        <div
          id="katex-preview"
          style={{
            padding: 12,
            border: "1px solid #eee",
            minHeight: 40,
            marginBottom: 12,
          }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose}>Cancel</button>
          <button onClick={() => onInsert(tex, block)}>Insert</button>
        </div>
      </div>
    </div>
  );
}
