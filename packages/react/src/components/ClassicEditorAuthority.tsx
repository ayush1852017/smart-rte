import React, { forwardRef } from "react";
import type { PersistedEditorDocument } from "smartrte-core/foundation";
import type { SmartEditorHandle } from "../canonicalEditorRuntime.js";
import type { MediaProvider } from "../mediaProvider.js";
import type { MediaPickerComponent } from "./MediaPicker.js";
import { CanonicalAuthorityEditor, type CanonicalAuthorityEditorProps } from "./CanonicalAuthorityEditor.js";

export type ClassicEditorProps = Omit<CanonicalAuthorityEditorProps, "onChange" | "onHtmlChange"> & {
  /** Legacy HTML value. Superseded by defaultValue; retained for source compatibility. */
  value?: string;
  /**
   * Legacy-compat: always fires with a plain HTML string, matching every
   * real pre-canonical caller's actual usage (e.g. Sootr's
   * RichTextEditor.tsx: `onChange: (html: string) => void`, used directly
   * as form state and passed to autosave/upload-on-save pipelines expecting
   * a string). This used to be typed as a union also accepting the new
   * canonical `SmartEditorChange` object, but the implementation only ever
   * invoked it with that object regardless of which shape the caller's
   * function actually expected - a real, live bug (a legacy caller
   * expecting a string got an object with no type error), not just an
   * imprecise type. Fixed by wiring this to the existing debounced HTML
   * serialization (`onHtmlChange`, ~250ms after the last edit - see
   * canonicalEditorRuntime.ts's `scheduleHtmlChange`) instead of the
   * per-transaction `onChange`, since that's the mechanism already built
   * for exactly this purpose. Callers who need the structured
   * per-transaction event should use `CanonicalAuthorityEditorProps`
   * directly, not this legacy-compat surface.
   */
  onChange?: (html: string) => void;
  mediaProvider?: MediaProvider;
  mediaPicker?: MediaPickerComponent;
  onRuntime?: CanonicalAuthorityEditorProps["onRuntime"];
  // Legacy-only configuration, silently ignored under canonical authority
  // (this was already true before Phase 8b closeout — canonical mode never
  // read these). Kept accepted, not typed against the removed legacy
  // component, purely so existing call sites keep compiling.
  //
  // `features`/`plugins`/`formats`/`formatDefinitions`/`mediaManager` (the
  // legacy pluginRuntime.ts/SmartRtePlugin surface) were removed here in
  // Phase 10, which retired that system entirely - see
  // docs/PLUGIN_ARCHITECTURE.md and the new createPluginRegistry-based
  // system exported from packages/core/src/foundation/plugin/. A caller
  // still passing these legacy props now gets a type error surfacing the
  // rename, rather than a silent no-op.
  /**
   * `table={false}` selects the "simple" capability preset (see
   * capabilityPresets.ts) unless `preset` is also explicitly given, in
   * which case `preset` wins. This is the one legacy toggle real callers
   * actually vary - Sootr's MCQ/Anomaly/PYEQ editors all pass
   * `enableTable={false}` (see docs/SOOTR_MIGRATION_READINESS.md gap #3);
   * nothing in this project's history has ever needed `media`/`formula` to
   * vary independently of each other (both are owned by the single "atom"
   * plugin today), so those two remain accepted-but-ignored, same as
   * before.
   */
  table?: boolean;
  media?: unknown;
  formula?: unknown;
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
 * path (LegacyClassicEditor, its four rollback bridges, and the
 * canonicalAuthorityFlag rollback switch itself) was retired once the
 * Gate 13/14 replay and production-surface gates passed. This wrapper
 * remains the stable public import path and continues to accept (and
 * ignore) legacy-only configuration props below so existing call sites
 * keep compiling.
 */
export const ClassicEditor = forwardRef<SmartEditorHandle, ClassicEditorProps>(function ClassicEditor(props, ref) {
  const { value, onChange, table, preset, media: _media, formula: _formula,
    fonts: _fonts, defaultFont: _font, preserveFontFamily: _preserveFont, preserveColors: _preserveColors,
    preserveDocxStyles: _preserveDocx, theme: _theme, showFontSize: _showFontSize, ...canonical } = props;
  return <CanonicalAuthorityEditor
    {...canonical}
    ref={ref}
    defaultValue={props.defaultValue ?? (typeof value === "string" ? value : undefined) as string | PersistedEditorDocument | undefined}
    preset={preset ?? (table === false ? "simple" : "full")}
    onHtmlChange={onChange}
  />;
});
