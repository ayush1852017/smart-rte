import React, { forwardRef, useRef, useSyncExternalStore } from "react";
import { foundationSchema, parseCanonicalListHtml, serializeCanonicalListHtml, type PersistedEditorDocument } from "smartrte-core/foundation";
import { canonicalAuthorityFlag, type CanonicalAuthorityContext } from "../canonicalAuthorityFlag.js";
import type { CanonicalEditorRuntime, SmartEditorChange, SmartEditorHandle } from "../canonicalEditorRuntime.js";
import { CanonicalAuthorityEditor, type CanonicalAuthorityEditorProps } from "./CanonicalAuthorityEditor.js";
import { LegacyClassicEditor, type ClassicEditorProps as LegacyClassicEditorProps } from "./ClassicEditor.js";

export type ClassicEditorProps = Omit<LegacyClassicEditorProps, "value" | "onChange"> & {
  /** Initial-only under canonical authority. Use replaceValue for external changes. */
  defaultValue?: string | PersistedEditorDocument;
  /** Legacy HTML value. Ignored after canonical construction. */
  value?: string;
  onChange?: ((change: SmartEditorChange) => void) | ((html: string) => void);
  onHtmlChange?: (html: string) => void;
  canonicalAuthority?: boolean;
  authorityContext?: CanonicalAuthorityContext;
  onRuntime?: CanonicalAuthorityEditorProps["onRuntime"];
};

/**
 * Uncontrolled by default in canonical mode. The runtime flag supplies a
 * reversible legacy path during rollout; direct prop override has precedence.
 */
export const ClassicEditor = forwardRef<SmartEditorHandle, ClassicEditorProps>(function ClassicEditor(props, ref) {
  useSyncExternalStore(
    (listener) => canonicalAuthorityFlag.subscribe(listener),
    () => canonicalAuthorityFlag.getVersion(),
    () => canonicalAuthorityFlag.getVersion(),
  );
  const enabled = canonicalAuthorityFlag.enabled(props.authorityContext, props.canonicalAuthority);
  const latestEnvelope = useRef<PersistedEditorDocument | undefined>(typeof props.defaultValue === "object" ? props.defaultValue : undefined);
  const latestHtml = useRef<string | undefined>(typeof props.defaultValue === "string" ? props.defaultValue : props.value);
  const runtime = useRef<CanonicalEditorRuntime | null>(null);
  if (!enabled) {
    if (runtime.current) {
      // Capture once at the authority boundary, not once per keystroke. This is
      // the ID-preserving rollback envelope; clean HTML remains the legacy view.
      latestEnvelope.current = runtime.current.getValue();
      latestHtml.current = serializeCanonicalListHtml(latestEnvelope.current.document, { clean: true });
      runtime.current = null;
    }
    const { defaultValue, onHtmlChange, canonicalAuthority: _canonical, authorityContext: _context, onRuntime: _runtime, ...legacy } = props;
    const value = latestEnvelope.current
      // Internal rollback HTML retains stable IDs. External callbacks receive
      // the clean representation below.
      ? serializeCanonicalListHtml(latestEnvelope.current.document, { clean: false })
      : latestHtml.current ?? (typeof props.value === "string" ? props.value : typeof defaultValue === "string" ? defaultValue : undefined);
    return <LegacyClassicEditor {...legacy as LegacyClassicEditorProps} value={value} onChange={(html) => {
      const document = parseCanonicalListHtml(html);
      latestEnvelope.current = {
        schemaVersion: foundationSchema.version,
        revision: (latestEnvelope.current?.revision || 0) + 1,
        document,
      };
      const cleanHtml = serializeCanonicalListHtml(document, { clean: true });
      latestHtml.current = cleanHtml;
      onHtmlChange?.(cleanHtml);
      const callback = props.onChange as ((html: string) => void) | undefined;
      callback?.(cleanHtml);
    }} />;
  }
  const { value, canonicalAuthority: _canonical, authorityContext: _context, table: _table, media: _media, formula: _formula,
    features: _features, plugins: _plugins, formats: _formats, formatDefinitions: _definitions, mediaManager: _manager,
    fonts: _fonts, defaultFont: _font, preserveFontFamily: _preserveFont, preserveColors: _preserveColors,
    preserveDocxStyles: _preserveDocx, theme: _theme, showFontSize: _showFontSize, ...canonical } = props;
  return <CanonicalAuthorityEditor
    {...canonical}
    ref={ref}
    defaultValue={latestEnvelope.current ?? latestHtml.current ?? props.defaultValue ?? value}
    onChange={(change) => {
      (props.onChange as ((change: SmartEditorChange) => void) | undefined)?.(change);
    }}
    onHtmlChange={(html) => { latestHtml.current = html; props.onHtmlChange?.(html); }}
    onRuntime={(value) => { runtime.current = value; props.onRuntime?.(value); }}
  />;
});
