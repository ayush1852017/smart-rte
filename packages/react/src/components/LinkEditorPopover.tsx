import React, { useEffect, useRef, useState } from "react";
import { normalizeLinkInput } from "smartrte-core";

export interface LinkEditorApplyValue {
  href: string;
  text?: string;
}

export interface LinkEditorPopoverProps {
  x: number;
  y: number;
  initialHref?: string;
  initialText?: string;
  showTextInput?: boolean;
  showOpen?: boolean;
  showRemove?: boolean;
  onApply: (value: LinkEditorApplyValue) => void;
  onOpen?: () => void;
  onRemove?: () => void;
  onCancel: () => void;
}

export function LinkEditorPopover({
  x,
  y,
  initialHref = "",
  initialText = "",
  showTextInput = false,
  showOpen = false,
  showRemove = false,
  onApply,
  onOpen,
  onRemove,
  onCancel,
}: LinkEditorPopoverProps) {
  const [href, setHref] = useState(initialHref);
  const [text, setText] = useState(initialText);
  const [error, setError] = useState("");
  const hrefRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    hrefRef.current?.focus();
    hrefRef.current?.select();
  }, []);

  const apply = () => {
    const normalized = normalizeLinkInput(href);
    if (!normalized.href) {
      setError("Enter a safe web URL, email address, phone number, or anchor.");
      return;
    }
    if (showTextInput && !text.trim()) {
      setError("Enter display text.");
      return;
    }
    onApply({ href: normalized.href, text: showTextInput ? text.trim() : undefined });
  };

  return (
    <div
      data-srte-link-popover="true"
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 70,
        width: 300,
        background: "var(--srte-menu-bg)",
        border: "1px solid var(--srte-border)",
        borderRadius: 8,
        boxShadow: "0 10px 30px rgba(15, 23, 42, 0.18)",
        padding: 10,
      }}
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
        if (event.key === "Enter") {
          event.preventDefault();
          apply();
        }
      }}
    >
      {showTextInput && (
        <label style={{ display: "block", marginBottom: 8, fontSize: 12, color: "var(--srte-muted-text)" }}>
          Text
          <input
            data-srte-link-text-input="true"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError("");
            }}
            style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 4 }}
          />
        </label>
      )}
      <label style={{ display: "block", marginBottom: 8, fontSize: 12, color: "var(--srte-muted-text)" }}>
        Link
        <input
          ref={hrefRef}
          data-srte-link-href-input="true"
          value={href}
          placeholder="URL, email, or phone"
          onChange={(event) => {
            setHref(event.target.value);
            setError("");
          }}
          style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 4 }}
        />
      </label>
      {error && (
        <div data-srte-link-error="true" style={{ color: "#b91c1c", fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {showOpen && <button type="button" onClick={onOpen}>Open</button>}
        {showRemove && <button type="button" onClick={onRemove}>Remove</button>}
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={apply}>Save</button>
      </div>
    </div>
  );
}
