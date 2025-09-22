import React from "react";

const COLORS: Record<string, string> = {
  info: "#e3f2fd",
  warning: "#fff8e1",
  success: "#e8f5e9",
  danger: "#ffebee",
};

export function InfoBox({
  box,
  onChange,
}: {
  box: { kind: string; text: string };
  onChange?: (next: any) => void;
}) {
  const bg = COLORS[box.kind] || COLORS.info;
  return (
    <div
      style={{
        background: bg,
        border: "1px solid #e5e7eb",
        padding: 12,
        borderRadius: 8,
        margin: "8px 0",
      }}
    >
      <select
        value={box.kind}
        onChange={(e) => onChange && onChange({ ...box, kind: e.target.value })}
        style={{ marginBottom: 8 }}
      >
        <option value="info">Blue</option>
        <option value="warning">Yellow</option>
        <option value="success">Green</option>
        <option value="danger">Red</option>
      </select>
      <div
        contentEditable
        suppressContentEditableWarning
        onInput={(e) =>
          onChange &&
          onChange({ ...box, text: (e.target as HTMLElement).innerText })
        }
      >
        {box.text}
      </div>
    </div>
  );
}
