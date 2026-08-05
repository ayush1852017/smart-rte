import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  executeMarkTool,
  inlineToolDeclarations,
  setBlockAttributes,
  setBlockTypeCommand,
  type PersistedEditorDocument,
  type ClipboardDiagnosticReport,
  type SmartOperation,
  type ResolvedScope,
} from "smartrte-core/foundation";
import { ensureStyleSheet } from "../theme.js";
import {
  CanonicalEditorRuntime,
  type SmartEditorChange,
  type SmartEditorHandle,
} from "../canonicalEditorRuntime.js";

export interface CanonicalAuthorityEditorProps {
  /** Initial value only. Later replacements must use SmartEditorHandle.replaceValue. */
  defaultValue?: string | PersistedEditorDocument;
  onChange?: (change: SmartEditorChange) => void;
  /** Transitional serialization callback for hosts that still persist HTML. */
  onHtmlChange?: (html: string) => void;
  onClipboardDiagnostic?: (report: ClipboardDiagnosticReport) => void;
  placeholder?: string;
  minHeight?: number | string;
  maxHeight?: number | string;
  readOnly?: boolean;
  className?: string;
  /** Test/diagnostic hook; not part of the editing contract. */
  onRuntime?: (runtime: CanonicalEditorRuntime) => void;
}

const labels: Record<string, string> = {
  bold: "Bold", italic: "Italic", underline: "Underline", strike: "Strikethrough",
  inlineCode: "Inline code", superscript: "Superscript", subscript: "Subscript",
};

export const CanonicalAuthorityEditor = forwardRef<SmartEditorHandle, CanonicalAuthorityEditorProps>(function CanonicalAuthorityEditor({
  defaultValue,
  onChange,
  onHtmlChange,
  onClipboardDiagnostic,
  placeholder = "Type here…",
  minHeight = 200,
  maxHeight = 500,
  readOnly = false,
  className,
  onRuntime,
}, forwardedRef) {
  ensureStyleSheet();
  const rootRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<CanonicalEditorRuntime>();
  if (!runtimeRef.current) runtimeRef.current = new CanonicalEditorRuntime({ initialValue: defaultValue, onChange, onHtmlChange, onClipboardDiagnostic });
  const runtime = runtimeRef.current;
  runtime.setCallbacks(onChange, onHtmlChange);
  useImperativeHandle(forwardedRef, () => runtime, [runtime]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    runtime.mount(root);
    onRuntime?.(runtime);
    return () => runtime.unmount();
  }, [runtime, onRuntime]);

  const transactBlock = (operations: SmartOperation[]) => {
    if (!operations.length) return;
    runtime.editor.transact((builder) => {
      builder.operations.push(...operations);
      builder.setSelection(runtime.editor.selection);
    }, { source: "toolbar", addToHistory: true });
    runtime.focus();
  };
  const blockScope = () => runtime.editor.resolveScope({ want: "block-range" }) as ResolvedScope;
  const blockContext = () => ({ schema: runtime.editor.schema, positions: runtime.editor.positions });

  return <section className={`srte-root srte-canonical-authority${className ? ` ${className}` : ""}`} data-smart-authority="canonical">
    <div className="srte-toolbar" role="toolbar" aria-label="Formatting toolbar">
      {inlineToolDeclarations.filter((tool) => labels[tool.id]).map((tool) => <button
        type="button"
        key={tool.id}
        className="srte-tool-button"
        aria-label={labels[tool.id]}
        title={labels[tool.id]}
        disabled={readOnly}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { executeMarkTool(runtime.editor, tool, "toggle"); runtime.focus(); }}
      >{labels[tool.id]}</button>)}
      <select
        aria-label="Block type"
        disabled={readOnly}
        defaultValue="paragraph"
        onChange={(event) => transactBlock(setBlockTypeCommand(runtime.editor.document, blockScope(), {
          type: event.target.value === "paragraph" ? "paragraph" : event.target.value === "code_block" ? "code_block" : "heading",
          attrs: event.target.value.startsWith("heading-") ? { level: Number(event.target.value.slice(8)) } : {},
        }, blockContext()))}
      >
        <option value="paragraph">Paragraph</option>
        {Array.from({ length: 6 }, (_, index) => <option key={index + 1} value={`heading-${index + 1}`}>Heading {index + 1}</option>)}
        <option value="code_block">Code block</option>
      </select>
      {(["left", "center", "right", "justify"] as const).map((align) => <button
        key={align}
        type="button"
        className="srte-tool-button"
        aria-label={`Align ${align}`}
        disabled={readOnly}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => transactBlock(setBlockAttributes(runtime.editor.document, blockScope(), { attrs: { align } }, blockContext()))}
      >{align}</button>)}
      <button type="button" className="srte-tool-button" aria-label="Undo" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => { runtime.editor.undo(); runtime.focus(); }}>Undo</button>
      <button type="button" className="srte-tool-button" aria-label="Redo" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => { runtime.editor.redo(); runtime.focus(); }}>Redo</button>
    </div>
    <div
      ref={rootRef}
      className="srte-editor"
      data-placeholder={placeholder}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-label="Smart RTE editing surface"
      aria-multiline="true"
      style={{ minHeight, maxHeight, overflow: "auto" }}
    />
  </section>;
});
