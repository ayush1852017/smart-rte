import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { normalizeLinkInput } from "smartrte-core/legacy";

export type MediaAlign = "left" | "center" | "right" | undefined;

export interface MediaDetailsDraft {
  alt: string;
  href: string;
  openInNewTab: boolean;
  width: number | undefined;
  borderRadius: number | undefined;
  align: MediaAlign;
  licenseDescription: string;
  licenseSourceUrl: string;
  licenseType: string;
  licenseVersion: string;
  licenseAttribution: string;
}

export interface MediaDetailsPopoverProps {
  x: number;
  y: number;
  initial: MediaDetailsDraft;
  onApply: (draft: MediaDetailsDraft) => void;
  onCancel: () => void;
}

const LICENSE_TYPE_PRESETS = ["CC BY", "CC BY-SA", "CC BY-ND", "CC BY-NC", "CC BY-NC-SA", "CC BY-NC-ND", "CC0 (Public Domain)", "All rights reserved"];

const inputStyle: React.CSSProperties = {
  width: "100%", height: 34, boxSizing: "border-box", marginTop: 4, padding: "0 9px",
  border: "1px solid var(--srte-input-border)", borderRadius: 8, outline: "none",
  background: "var(--srte-input-bg)", color: "var(--srte-input-text)", font: "inherit", fontSize: 13,
};
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600 };
const buttonStyle: React.CSSProperties = {
  minHeight: 34, padding: "0 12px", border: "1px solid var(--srte-input-border)", borderRadius: 8,
  background: "var(--srte-input-bg)", color: "var(--srte-menu-text)", cursor: "pointer", fontWeight: 500, fontSize: 13,
};
const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", opacity: 0.7,
  marginTop: 4, paddingTop: 10, borderTop: "1px solid var(--srte-border)",
};

const alignButton = (current: MediaAlign, value: MediaAlign, label: string, onClick: () => void) => (
  <button
    key={label}
    type="button"
    aria-label={label}
    aria-pressed={current === value}
    onClick={onClick}
    style={{
      ...buttonStyle,
      flex: 1,
      minHeight: 32,
      padding: 0,
      background: current === value ? "var(--srte-accent-bg)" : "var(--srte-input-bg)",
      borderColor: current === value ? "var(--srte-primary)" : "var(--srte-input-border)",
      color: current === value ? "var(--srte-primary-pressed)" : "var(--srte-menu-text)",
    }}
  >
    {label}
  </button>
);

/**
 * "Media details" - replaces the crude window.prompt("Alt text") edit path
 * (docs/bugs/media-details-old-editor-field-parity.md) with a real settings
 * panel matching the old editor's own field set, following this project's
 * established compact-popover pattern (position:fixed + JS-measured
 * placement, Apply/Cancel commit - same shape as TableBorderPopover for a
 * multi-field dialog like this one, rather than LinkEditorPopover's simpler
 * live-Enter-to-apply form).
 *
 * Opened directly by an image's right-click interaction; the details panel
 * is the image editing surface, while resize handles remain available
 * independently around the selected image.
 */
export function MediaDetailsPopover({ x, y, initial, onApply, onCancel }: MediaDetailsPopoverProps) {
  const [draft, setDraft] = useState<MediaDetailsDraft>(initial);
  const [licenseTypeCustom, setLicenseTypeCustom] = useState(!!initial.licenseType && !LICENSE_TYPE_PRESETS.includes(initial.licenseType));
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const margin = 8;
    const { width, height } = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const overflowsRight = x + width > viewportWidth - margin;
    const left = overflowsRight ? x - width : x;
    const clampedLeft = Math.min(Math.max(margin, left), Math.max(margin, viewportWidth - width - margin));
    const overflowsBottom = y + height > viewportHeight - margin;
    const top = overflowsBottom ? Math.max(margin, y - height) : y;
    const clampedTop = Math.min(Math.max(margin, top), Math.max(margin, viewportHeight - height - margin));
    setPlacement({ left: clampedLeft, top: clampedTop });
  }, [x, y]);

  useEffect(() => {
    const dismissIfOutside = (event: Event) => {
      const target = event.target as Node;
      const elementTarget = target instanceof Element ? target : target.parentElement;
      // Resize handles live outside this dialog and must receive their own
      // pointer gesture without the editor closing on the first pointerdown.
      if (elementTarget?.closest("[data-srte-media-resize-handle-direction]")) return;
      if (!rootRef.current?.contains(target)) onCancelRef.current();
    };
    window.addEventListener("pointerdown", dismissIfOutside, true);
    window.addEventListener("mousedown", dismissIfOutside, true);
    return () => {
      window.removeEventListener("pointerdown", dismissIfOutside, true);
      window.removeEventListener("mousedown", dismissIfOutside, true);
    };
  }, []);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCancelRef.current(); };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, []);

  const update = (patch: Partial<MediaDetailsDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const apply = () => {
    if (!draft.alt.trim()) { setError("Enter alt text."); return; }
    const trimmedHref = draft.href.trim();
    if (!trimmedHref) { onApply({ ...draft, href: "" }); return; }
    const normalized = normalizeLinkInput(trimmedHref);
    if (!normalized.href) { setError("Enter a safe, valid web URL, email address, phone number, or page anchor for the link, or clear it."); return; }
    onApply({ ...draft, href: normalized.href });
  };

  return (
    <div
      ref={rootRef}
      data-srte-media-details-popover="true"
      role="dialog"
      aria-label="Media details"
      style={{
        position: "fixed",
        left: placement?.left ?? x,
        top: placement?.top ?? y,
        visibility: placement ? "visible" : "hidden",
        zIndex: 72,
        width: 320,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "calc(100vh - 16px)",
        overflowY: "auto",
        boxSizing: "border-box",
        background: "var(--srte-menu-bg)",
        color: "var(--srte-menu-text)",
        border: "1px solid var(--srte-border)",
        borderRadius: 12,
        boxShadow: "var(--srte-menu-shadow)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 650 }}>Media details</div>
        <button type="button" aria-label="Close media details" onClick={onCancel} style={{ ...buttonStyle, minWidth: 26, minHeight: 26, padding: 0, border: 0, background: "transparent", fontSize: 18 }}>×</button>
      </div>

      <label style={labelStyle}>
        Alt text
        <input
          data-srte-media-alt-input="true"
          value={draft.alt}
          onChange={(event) => { update({ alt: event.target.value }); setError(""); }}
          style={{ ...inputStyle, borderColor: error ? "var(--srte-danger)" : "var(--srte-input-border)" }}
        />
      </label>
      {error && <div role="alert" style={{ color: "var(--srte-danger)", fontSize: 12 }}>{error}</div>}

      <label style={labelStyle}>
        Link
        <input
          data-srte-media-href-input="true"
          value={draft.href}
          placeholder="Paste a URL"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => { update({ href: event.target.value }); setError(""); }}
          style={{ ...inputStyle, borderColor: error ? "var(--srte-danger)" : "var(--srte-input-border)" }}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input
          data-srte-media-new-tab-input="true"
          type="checkbox"
          checked={draft.openInNewTab}
          disabled={!draft.href.trim()}
          onChange={(event) => update({ openInNewTab: event.target.checked })}
        />
        Open in a new tab
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ ...labelStyle, flex: 1 }}>
          Width (px)
          <input
            data-srte-media-width-input="true"
            type="number"
            min={16}
            value={draft.width ?? ""}
            onChange={(event) => update({ width: event.target.value === "" ? undefined : Math.max(16, Number(event.target.value)) })}
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, flex: 1 }}>
          Corner radius (px)
          <input
            data-srte-media-radius-input="true"
            type="number"
            min={0}
            value={draft.borderRadius ?? ""}
            onChange={(event) => update({ borderRadius: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value)) })}
            style={inputStyle}
          />
        </label>
      </div>

      <div style={labelStyle}>
        Align
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          {alignButton(draft.align, undefined, "None", () => update({ align: undefined }))}
          {alignButton(draft.align, "left", "Left", () => update({ align: "left" }))}
          {alignButton(draft.align, "center", "Center", () => update({ align: "center" }))}
          {alignButton(draft.align, "right", "Right", () => update({ align: "right" }))}
        </div>
      </div>

      <div style={sectionHeaderStyle}>License</div>
      <label style={labelStyle}>
        Description
        <input data-srte-media-license-description-input="true" value={draft.licenseDescription} onChange={(event) => update({ licenseDescription: event.target.value })} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Source URL
        <input data-srte-media-license-source-input="true" value={draft.licenseSourceUrl} onChange={(event) => update({ licenseSourceUrl: event.target.value })} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Type
        <select
          data-srte-media-license-type-select="true"
          value={licenseTypeCustom ? "custom" : draft.licenseType}
          onChange={(event) => {
            if (event.target.value === "custom") { setLicenseTypeCustom(true); return; }
            setLicenseTypeCustom(false);
            update({ licenseType: event.target.value });
          }}
          style={selectStyle}
        >
          <option value="">(none)</option>
          {LICENSE_TYPE_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
          <option value="custom">Custom…</option>
        </select>
        {licenseTypeCustom && (
          <input
            data-srte-media-license-type-custom-input="true"
            value={draft.licenseType}
            placeholder="License type"
            onChange={(event) => update({ licenseType: event.target.value })}
            style={inputStyle}
          />
        )}
      </label>
      <label style={labelStyle}>
        Version
        <input data-srte-media-license-version-input="true" value={draft.licenseVersion} onChange={(event) => update({ licenseVersion: event.target.value })} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Attribution
        <input data-srte-media-license-attribution-input="true" value={draft.licenseAttribution} onChange={(event) => update({ licenseAttribution: event.target.value })} style={inputStyle} />
      </label>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 7, marginTop: 4 }}>
        <button type="button" onClick={onCancel} style={buttonStyle}>Cancel</button>
        <button
          type="button"
          onClick={apply}
          style={{ ...buttonStyle, borderColor: "var(--srte-primary)", background: "var(--srte-primary)", color: "var(--srte-on-primary)" }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
