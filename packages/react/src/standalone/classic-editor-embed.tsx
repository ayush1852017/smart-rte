import React, { useImperativeHandle, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClassicEditor as ClassicEditorComponent } from "../components/ClassicEditor";
import type { MediaManagerAdapter } from "../components/MediaManager";

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
  // Optional: a callback to receive change events
  onChange?: (html: string) => void;
  mediaManager?: MediaManagerAdapter;
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
    onChange?: (html: string) => void;
    mediaManager?: MediaManagerAdapter;
  },
  ref: React.Ref<ClassicEditorController>
) {
  const [html, setHtml] = useState<string>(props.value || "");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      setHtml(next: string) {
        setHtml(next ?? "");
      },
      getHtml() {
        return (
          containerRef.current?.querySelector('[contenteditable="true"]')
            ?.innerHTML ?? html
        );
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
    [html]
  );

  return (
    <div ref={containerRef} style={{ height: "100%", width: "100%" }}>
      <ClassicEditorComponent
        value={html}
        onChange={(v) => {
          setHtml(v);
          props.onChange?.(v);
          try {
            // Bridge to Flutter if present
            // @ts-ignore
            const ch = (window as any).ToFlutter;
            if (ch && typeof ch.postMessage === "function") {
              ch.postMessage(JSON.stringify({ type: "change", html: v }));
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
        mediaManager={props.mediaManager}
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
