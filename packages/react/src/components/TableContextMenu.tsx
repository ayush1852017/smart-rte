// packages/react/src/components/TableContextMenu.tsx
import React from "react";

type Props = {
  x: number;
  y: number;
  onClose: () => void;
  onBackground: (color: string) => void;
  onMerge: () => void;
  onSplit: () => void;
};

export const TableContextMenu: React.FC<Props> = ({
  x,
  y,
  onClose,
  onBackground,
  onMerge,
  onSplit,
}) => {
  return (
    <div
      style={{
        position: "fixed",
        top: y,
        left: x,
        background: "#fff",
        border: "1px solid #ddd",
        borderRadius: 4,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        zIndex: 2000,
        padding: 8,
        minWidth: 160,
      }}
      onMouseLeave={onClose}
    >
      <button onClick={() => onBackground("#f9f871")}>Highlight Yellow</button>
      <button onClick={() => onBackground("#d7f7d7")}>Highlight Green</button>
      <button onClick={() => onMerge()}>Merge Cells</button>
      <button onClick={() => onSplit()}>Split Cell</button>
    </div>
  );
};
