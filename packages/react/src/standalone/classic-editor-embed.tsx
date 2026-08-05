import React, { useImperativeHandle, useRef } from "react";
import { createRoot } from "react-dom/client";
import { foundationSchema, parseCanonicalListHtml, serializeCanonicalListHtml } from "smartrte-core/foundation";
import { ClassicEditor as ClassicEditorComponent } from "../components/ClassicEditorAuthority.js";
import type { SmartEditorHandle } from "../canonicalEditorRuntime.js";
import type { MediaManagerAdapter } from "../components/MediaManager.js";
import type { SrteTheme } from "../theme.js";

type InitOptions = {
  target: HTMLElement;
  value?: string;
  placeholder?: string;
  minHeight?: number | string;
  maxHeight?: number | string;
  readOnly?: boolean;
  table?: boolean;
  media?: boolean;
  formula?: boolean;
  showFontSize?: boolean;
  // Optional: a callback to receive change events
  onChange?: (html: string) => void;
  mediaManager?: MediaManagerAdapter;
  theme?: SrteTheme;
  className?: string;
};

export type ClassicEditorController = {
  setHtml: (html: string) => void;
  getHtml: () => string;
  focus: () => void;
  blur: () => void;
  destroy: () => void;
};

function ClassicEditorHost(
  props: {
    value?: string;
    placeholder?: string;
    minHeight?: number | string;
    maxHeight?: number | string;
    readOnly?: boolean;
    table?: boolean;
    media?: boolean;
    formula?: boolean;
    showFontSize?: boolean;
    onChange?: (html: string) => void;
    mediaManager?: MediaManagerAdapter;
    theme?: SrteTheme;
    className?: string;
  },
  ref: React.Ref<ClassicEditorController>
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<SmartEditorHandle | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      setHtml(next: string) {
        const current = editorRef.current;
        if (!current) return;
        current.replaceValue({
          schemaVersion: foundationSchema.version,
          revision: current.getRevision() + 1,
          document: parseCanonicalListHtml(next || "<p></p>"),
        });
      },
      getHtml() {
        const value = editorRef.current?.getValue();
        return value ? serializeCanonicalListHtml(value.document, { clean: true }) : "";
      },
      focus() {
        const el = containerRef.current?.querySelector(
          '[contenteditable="true"]'
        ) as HTMLElement | null;
        el?.focus();
      },
      blur() {
        const el = containerRef.current?.querySelector(
          '[contenteditable="true"]'
        ) as HTMLElement | null;
        el?.blur();
      },
      destroy() {
        // No-op here; actual unmount happens in init
      },
    }),
    []
  );

  return (
    <div ref={containerRef} style={{ height: "100%", width: "100%" }}>
      <ClassicEditorComponent
        ref={editorRef}
        canonicalAuthority
        defaultValue={props.value || "<p></p>"}
        onHtmlChange={(html) => {
          props.onChange?.(html);
          try {
            // Bridge to Flutter if present
            // @ts-ignore
            const ch = (window as any).ToFlutter;
            if (ch && typeof ch.postMessage === "function") {
              ch.postMessage(JSON.stringify({ type: "change", html }));
            }
          } catch {}
        }}
        placeholder={props.placeholder}
        minHeight={props.minHeight}
        maxHeight={props.maxHeight}
        readOnly={props.readOnly}
        table={props.table}
        media={props.media}
        formula={props.formula}
        showFontSize={props.showFontSize}
        mediaManager={props.mediaManager}
        theme={props.theme}
        className={props.className}
      />
    </div>
  );
}

const ClassicEditorHostWithRef = React.forwardRef(ClassicEditorHost);

function initClassicEditor(opts: InitOptions): ClassicEditorController {
  const { target, onChange, ...rest } = opts;
  const root = createRoot(target);
  const ref = React.createRef<ClassicEditorController>();
  root.render(
    <ClassicEditorHostWithRef ref={ref} onChange={onChange} {...rest} />
  );

  const controller: ClassicEditorController = {
    setHtml: (html) => ref.current?.setHtml(html),
    getHtml: () => ref.current?.getHtml() ?? "",
    focus: () => ref.current?.focus?.(),
    blur: () => ref.current?.blur?.(),
    destroy: () => {
      try {
        root.unmount();
      } catch {}
    },
  };

  // Attach controller globally for simple bridges
  try {
    const g = window as any;
    g.SmartRTE = g.SmartRTE || {};
    g.SmartRTE.__controller = controller;
    g.SmartBridge = g.SmartBridge || {};
    if (typeof g.SmartBridge.handle !== "function") {
      g.SmartBridge.handle = (msg: any) => {
        try {
          if (!msg || typeof msg !== "object") return;
          const t = msg.type;
          if (t === "setHtml") controller.setHtml(String(msg.html ?? ""));
          else if (t === "focus") controller.focus();
          else if (t === "blur") controller.blur();
          else if (t === "getHtml") {
            const html = controller.getHtml();
            const ch = g.ToFlutter;
            if (ch && typeof ch.postMessage === "function") {
              ch.postMessage(JSON.stringify({ type: "getHtmlResult", html }));
            }
          }
        } catch {}
      };
    }
  } catch {}

  // Inform Flutter bridge we are ready
  try {
    // @ts-ignore
    const ch = (window as any).ToFlutter;
    if (ch && typeof ch.postMessage === "function") {
      ch.postMessage(JSON.stringify({ type: "ready" }));
    }
  } catch {}

  return controller;
}

// Expose a small global API: window.SmartRTE.ClassicEditor.init
declare global {
  interface Window {
    SmartRTE?: any;
  }
}

(function attachGlobal() {
  const g = window as any;
  g.SmartRTE = g.SmartRTE || {};
  g.SmartRTE.ClassicEditor = {
    init: initClassicEditor,
  };
})();
