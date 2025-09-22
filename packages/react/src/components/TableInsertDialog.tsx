import React, { useState } from "react";

interface TableInsertDialogProps {
  onInsert: (rows: number, cols: number) => void;
  onClose: () => void;
}

export const TableInsertDialog: React.FC<TableInsertDialogProps> = ({
  onInsert,
  onClose,
}) => {
  const [hoverRows, setHoverRows] = useState(0);
  const [hoverCols, setHoverCols] = useState(0);

  const maxRows = 10;
  const maxCols = 10;

  return (
    <div
      style={{
        position: "absolute",
        top: 60,
        left: 100,
        background: "#fff",
        border: "1px solid #ddd",
        padding: 12,
        zIndex: 1000,
        boxShadow: "0 4px 10px rgba(0,0,0,0.15)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${maxCols}, 20px)`,
          gap: 4,
        }}
      >
        {Array.from({ length: maxRows }).map((_, r) =>
          Array.from({ length: maxCols }).map((_, c) => {
            const active = r < hoverRows && c < hoverCols;
            return (
              <div
                key={`${r}-${c}`}
                style={{
                  width: 20,
                  height: 20,
                  border: "1px solid #ccc",
                  background: active ? "#3399ff" : "#f9f9f9",
                  cursor: "pointer",
                }}
                onMouseEnter={() => {
                  setHoverRows(r + 1);
                  setHoverCols(c + 1);
                }}
                onClick={() => {
                  onInsert(r + 1, c + 1);
                  onClose();
                }}
              />
            );
          })
        )}
      </div>
      <div style={{ marginTop: 8, textAlign: "center", fontSize: 12 }}>
        {hoverRows} × {hoverCols}
      </div>
      <button
        style={{
          marginTop: 8,
          padding: "4px 8px",
          fontSize: 12,
          cursor: "pointer",
        }}
        onClick={onClose}
      >
        Cancel
      </button>
    </div>
  );
};
