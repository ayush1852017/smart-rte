import React, { useEffect, useId, useRef, useState } from "react";
import { normalizeLinkInput } from "smartrte-core/legacy";

export interface LinkEditorApplyValue {
  href: string;
  text?: string;
  openInNewTab: boolean;
}

export interface LinkEditorPopoverProps {
  x: number;
  y: number;
  initialHref?: string;
  initialText?: string;
  initialOpenInNewTab?: boolean;
  showTextInput?: boolean;
  showOpen?: boolean;
  showRemove?: boolean;
  onApply: (value: LinkEditorApplyValue) => void;
  onOpen?: () => void;
  onRemove?: () => void;
  onCancel: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  boxSizing: "border-box",
  marginTop: 5,
  padding: "0 10px",
  border: "1px solid var(--srte-input-border)",
  borderRadius: 8,
  outline: "none",
  background: "var(--srte-input-bg)",
  color: "var(--srte-input-text)",
  font: "inherit",
};

const buttonStyle: React.CSSProperties = {
  minHeight: 36,
  padding: "0 11px",
  border: "1px solid var(--srte-input-border)",
  borderRadius: 8,
  background: "var(--srte-input-bg)",
  color: "var(--srte-menu-text)",
  cursor: "pointer",
  fontWeight: 500,
};

export function LinkEditorPopover({
  x,
  y,
  initialHref = "",
  initialText = "",
  initialOpenInNewTab = false,
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
  const [openInNewTab, setOpenInNewTab] = useState(initialOpenInNewTab);
  const [error, setError] = useState("");
  const hrefRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const errorId = useId();

  useEffect(() => {
    hrefRef.current?.focus();
    hrefRef.current?.select();
  }, []);

  const apply = () => {
    const normalized = normalizeLinkInput(href);
    if (!normalized.href) {
      setError("Enter a safe, valid web URL, email address, phone number, or page anchor.");
      return;
    }
    if (showTextInput && !text.trim()) {
      setError("Enter display text.");
      return;
    }
    onApply({
      href: normalized.href,
      text: showTextInput ? text.trim() : undefined,
      openInNewTab,
    });
  };

  return (
    <div
      data-srte-link-popover="true"
      role="dialog"
      aria-labelledby={titleId}
      style={{
        position: "fixed",
        left: Math.max(8, Math.min(x, typeof window === "undefined" ? x : window.innerWidth - 376)),
        top: Math.max(8, Math.min(y, typeof window === "undefined" ? y : window.innerHeight - 344)),
        zIndex: 70,
        width: 360,
        maxWidth: "calc(100vw - 16px)",
        boxSizing: "border-box",
        maxHeight: "calc(100vh - 16px)",
        overflowY: "auto",
        background: "var(--srte-menu-bg)",
        color: "var(--srte-menu-text)",
        border: "1px solid var(--srte-border)",
        borderRadius: 12,
        boxShadow: "var(--srte-menu-shadow)",
        padding: 14,
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          apply();
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div id={titleId} style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 650 }}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--srte-primary)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.14-1.14" />
          </svg>
          {showRemove ? "Edit link" : "Insert link"}
        </div>
        <button
          type="button"
          aria-label="Close link editor"
          title="Close"
          onClick={onCancel}
          style={{ ...buttonStyle, minWidth: 28, minHeight: 28, padding: 0, border: 0, background: "transparent", fontSize: 18 }}
        >
          ×
        </button>
      </div>

      {showTextInput && (
        <label style={{ display: "block", marginBottom: 10, fontSize: 12, fontWeight: 600 }}>
          Display text
          <input
            data-srte-link-text-input="true"
            value={text}
            autoComplete="off"
            onChange={(event) => {
              setText(event.target.value);
              setError("");
            }}
            style={inputStyle}
          />
        </label>
      )}

      <label style={{ display: "block", marginBottom: 10, fontSize: 12, fontWeight: 600 }}>
        Link destination
        <input
          ref={hrefRef}
          data-srte-link-href-input="true"
          value={href}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Paste a URL, email, phone, or #anchor"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setHref(event.target.value);
            setError("");
          }}
          style={{ ...inputStyle, borderColor: error ? "var(--srte-danger)" : "var(--srte-input-border)" }}
        />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: error ? 8 : 14, fontSize: 13, cursor: "pointer" }}>
        <input
          data-srte-link-new-tab-input="true"
          type="checkbox"
          checked={openInNewTab}
          onChange={(event) => setOpenInNewTab(event.target.checked)}
        />
        Open in a new tab
      </label>

      {error && (
        <div id={errorId} data-srte-link-error="true" role="alert" style={{ color: "var(--srte-danger)", fontSize: 12, marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        {showRemove && (
          <button type="button" onClick={onRemove} style={{ ...buttonStyle, color: "var(--srte-danger)", marginRight: "auto" }}>
            Remove link
          </button>
        )}
        {!showRemove && <span style={{ flex: 1 }} />}
        {showOpen && <button type="button" onClick={onOpen} style={buttonStyle}>Open</button>}
        <button type="button" onClick={onCancel} style={buttonStyle}>Cancel</button>
        <button
          type="button"
          onClick={apply}
          style={{ ...buttonStyle, borderColor: "var(--srte-primary)", background: "var(--srte-primary)", color: "var(--srte-on-primary)" }}
        >
          {showRemove ? "Update" : "Insert"}
        </button>
      </div>
    </div>
  );
}
