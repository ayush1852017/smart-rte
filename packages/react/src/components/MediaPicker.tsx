import React, { useRef } from "react";
import type { MediaKind } from "../mediaProvider.js";

export interface MediaPickerProps {
  readonly kind: MediaKind;
  readonly onPick: (file: File) => void;
  readonly onCancel: () => void;
}

export type MediaPickerComponent = React.ComponentType<MediaPickerProps>;

const acceptFor = (kind: MediaKind): string => kind === "image" ? "image/*" : `${kind}/*`;

/** Small replaceable default; hosts can supply a library/search picker later. */
export const DefaultMediaPicker: MediaPickerComponent = ({ kind, onPick, onCancel }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return <div
    role="dialog"
    aria-label={`Choose ${kind}`}
    style={{
      position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center",
      background: "var(--srte-modal-backdrop)",
    }}
  >
    <div style={{ background: "var(--srte-modal-bg)", color: "var(--srte-modal-text)", padding: 20, borderRadius: 10, minWidth: 280 }}>
      <h3 style={{ marginTop: 0 }}>Insert {kind}</h3>
      <input
        ref={inputRef}
        autoFocus
        type="file"
        accept={acceptFor(kind)}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onPick(file);
          event.currentTarget.value = "";
        }}
      />
      <button type="button" onClick={onCancel}>Cancel</button>
    </div>
  </div>;
};
