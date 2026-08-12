import React, { forwardRef } from "react";
import type { PersistedEditorDocument } from "smartrte-core/foundation";
import type { CanonicalAuthorityContext } from "../canonicalAuthorityFlag.js";
import type { SmartEditorChange, SmartEditorHandle } from "../canonicalEditorRuntime.js";
import type { MediaProvider } from "../mediaProvider.js";
import type { MediaPickerComponent } from "./MediaPicker.js";
import { CanonicalAuthorityEditor, type CanonicalAuthorityEditorProps } from "./CanonicalAuthorityEditor.js";

export type ClassicEditorProps = Omit<CanonicalAuthorityEditorProps, "onChange"> & {
  /** Legacy HTML value. Superseded by defaultValue; retained for source compatibility. */
  value?: string;
  onChange?: ((change: SmartEditorChange) => void) | ((html: string) => void);
  /**
   * Retained rollback-switch surface for source compatibility. There is no
   * legacy renderer left to switch to as of Phase 8b closeout (2026-08-12):
   * canonical authority is unconditionally the only implementation, and
   * these props are accepted but have no effect.
   */
  canonicalAuthority?: boolean;
  authorityContext?: CanonicalAuthorityContext;
  mediaProvider?: MediaProvider;
  mediaPicker?: MediaPickerComponent;
  onRuntime?: CanonicalAuthorityEditorProps["onRuntime"];
  // Legacy-only configuration, silently ignored under canonical authority
  // (this was already true before Phase 8b closeout — canonical mode never
  // read these). Kept accepted, not typed against the removed legacy
  // component, purely so existing call sites keep compiling.
  table?: unknown;
  media?: unknown;
  formula?: unknown;
  features?: unknown;
  plugins?: unknown;
  formats?: unknown;
  formatDefinitions?: unknown;
  mediaManager?: unknown;
  fonts?: unknown;
  defaultFont?: unknown;
  preserveFontFamily?: unknown;
  preserveColors?: unknown;
  preserveDocxStyles?: unknown;
  theme?: unknown;
  showFontSize?: unknown;
};

/**
 * Canonical authority is unconditionally the only implementation as of
 * Phase 8b closeout (2026-08-12) — the DOM-authoritative legacy rollback
 * path (LegacyClassicEditor and its four rollback bridges) was retired
 * once the Gate 13/14 replay and production-surface gates passed. This
 * wrapper remains the stable public import path and continues to accept
 * (and ignore) the legacy-only/rollback-switch props above so existing
 * call sites keep compiling.
 */
export const ClassicEditor = forwardRef<SmartEditorHandle, ClassicEditorProps>(function ClassicEditor(props, ref) {
  const { value, canonicalAuthority: _canonical, authorityContext: _context, table: _table, media: _media, formula: _formula,
    features: _features, plugins: _plugins, formats: _formats, formatDefinitions: _definitions, mediaManager: _manager,
    fonts: _fonts, defaultFont: _font, preserveFontFamily: _preserveFont, preserveColors: _preserveColors,
    preserveDocxStyles: _preserveDocx, theme: _theme, showFontSize: _showFontSize, ...canonical } = props;
  return <CanonicalAuthorityEditor
    {...canonical}
    ref={ref}
    defaultValue={props.defaultValue ?? (typeof value === "string" ? value : undefined) as string | PersistedEditorDocument | undefined}
    onChange={(change) => {
      (props.onChange as ((change: SmartEditorChange) => void) | undefined)?.(change);
    }}
  />;
});
