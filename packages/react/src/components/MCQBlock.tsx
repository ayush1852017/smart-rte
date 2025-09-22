import React from "react";

type MCQOption = { text: string; correct?: boolean };

export function MCQBlock({
  block,
  onChange,
}: {
  block: { question: string; options: MCQOption[]; multiple?: boolean };
  onChange?: (next: any) => void;
}) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        padding: 12,
        borderRadius: 8,
        margin: "8px 0",
      }}
    >
      <div
        contentEditable
        suppressContentEditableWarning
        style={{ fontWeight: 600, marginBottom: 8 }}
        onInput={(e) =>
          onChange &&
          onChange({ ...block, question: (e.target as HTMLElement).innerText })
        }
      >
        {block.question}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {block.options.map((opt, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <input
              type={block.multiple ? "checkbox" : "radio"}
              checked={!!opt.correct}
              onChange={(e) =>
                onChange &&
                onChange({
                  ...block,
                  options: block.options.map((o, idx) =>
                    idx === i
                      ? { ...o, correct: e.target.checked }
                      : block.multiple
                      ? o
                      : { ...o, correct: false }
                  ),
                })
              }
            />
            <div
              contentEditable
              suppressContentEditableWarning
              style={{ flex: 1, borderBottom: "1px dashed #ddd" }}
              onInput={(e) =>
                onChange &&
                onChange({
                  ...block,
                  options: block.options.map((o, idx) =>
                    idx === i
                      ? { ...o, text: (e.target as HTMLElement).innerText }
                      : o
                  ),
                })
              }
            >
              {opt.text}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
