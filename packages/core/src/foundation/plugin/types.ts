import type { SmartDocument, SmartOperation, SmartSchema } from "../types.js";
import type { PositionLookup, ResolvedScope, ScopeKind } from "../scope/types.js";
import type { NormalizerRegistration } from "../types.js";
import type { SchemaContribution } from "../schemaBuilder.js";
import type { SourceNormalizer } from "../clipboard/types.js";
import type { FeatureFormatCodec } from "../formats/codec.js";

/**
 * Shared by every existing per-family command context
 * (TableCommandContext, BlockCommandContext, MarkCommandContext,
 * ListCommand's CommandContext, AtomCommandContext) - all five are this
 * exact shape today, just independently named. A PluginCommand's `run`
 * accepts this directly; no existing command function needs to change.
 */
export interface PluginCommandContext {
  readonly schema: SmartSchema;
  readonly positions: PositionLookup;
}

export interface CommandExample {
  readonly description: string;
  readonly params: unknown;
  readonly expectedOutcome?: string;
}

export interface OptionSpec {
  readonly description: string;
  readonly required?: boolean;
}

/**
 * Wraps the existing per-family command function shape
 * `(document, scope, params, ctx) => SmartOperation[]` with the metadata
 * Phase 10's doc generation needs. `run` is exactly what every existing
 * TableCommand/BlockCommand/MarkCommand/ListCommand/AtomCommand already is -
 * converting a family to a plugin wraps its existing commands, it does not
 * rewrite them.
 */
export interface PluginCommand<P = unknown> {
  readonly id: string;
  readonly run: (document: SmartDocument, scope: ResolvedScope, params: P, ctx: PluginCommandContext) => SmartOperation[];
  /** Required, not optional - enforced at the type level and by a non-empty-string lint check. */
  readonly description: string;
  readonly examples?: readonly CommandExample[];
  readonly options?: Record<string, OptionSpec>;
}

/**
 * A command registry is necessarily heterogeneous - each entry's own
 * params type (MarkApplyParams, TableRowParams, ...) is narrower than the
 * `unknown` a dynamic-dispatch-by-id lookup can statically guarantee.
 * definePluginCommand narrows the unsafe cast this requires to one place:
 * wrap an existing, already-typed command function (TableCommand<P>,
 * MarkCommand<P>, ...) as-is - the underlying function is never rewritten,
 * only its params type is erased at the registry boundary, the same way
 * every extensible command-by-id system needs to (callers are responsible
 * for passing the right params shape for a given command id; `options`
 * documents that shape for humans/doc-gen, it is not statically enforced).
 */
export const definePluginCommand = <P>(command: {
  readonly id: string;
  readonly run: (document: SmartDocument, scope: ResolvedScope, params: P, ctx: PluginCommandContext) => SmartOperation[];
  readonly description: string;
  readonly examples?: readonly CommandExample[];
  readonly options?: Record<string, OptionSpec>;
}): PluginCommand => command as PluginCommand;

/**
 * A keyboard shortcut declares the ScopeKind(s) (scope/types.ts's existing,
 * already-tested taxonomy - inline-range/block-range/list-selection/
 * table-grid/atomic-node/container-tree/mixed/empty) it applies to, so the
 * dispatcher can pick the handler whose declared scope matches the resolved
 * scope at the cursor instead of hardcoding precedence per key the way
 * surface/input.ts's Tab handling does today. `priority` breaks a genuine
 * tie between two handlers declaring the same scope kind for the same key;
 * registration order breaks a tie in `priority`.
 */
export interface KeyboardShortcutContribution {
  readonly id: string;
  readonly commandId: string;
  /** Fixed params for commands parameterized at the call site (e.g. mark.toggle's markType) - one command, many bindings. */
  readonly params?: unknown;
  readonly key: string;
  readonly primary?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly scopeKinds: readonly ScopeKind[];
  readonly priority?: number;
}

export interface ToolbarContribution {
  readonly id: string;
  readonly commandId: string;
  readonly params?: unknown;
  readonly label: string;
  readonly order?: number;
}

/**
 * Unlike ToolbarContribution, a context menu is scope-gated: right-clicking
 * a table cell shouldn't offer "Clear formatting", and selecting text
 * shouldn't offer "Delete row". `scopeKinds` mirrors
 * KeyboardShortcutContribution's field - the same declared-metadata
 * contract, checked by resolving `scopeKinds[0]` and requiring the actual
 * resolved scope to match it exactly (see resolveContextMenuItems in
 * packages/react's CanonicalAuthorityEditor, which plays the same role
 * surface/input.ts's resolveShortcut plays for keyboard shortcuts).
 */
export interface ContextMenuContribution {
  readonly id: string;
  readonly commandId: string;
  readonly params?: unknown;
  readonly label: string;
  readonly order?: number;
  readonly scopeKinds: readonly ScopeKind[];
}

export interface ClipboardContribution {
  readonly normalizers?: readonly SourceNormalizer[];
  readonly priority?: number;
}

export interface RendererContribution {
  /** Node type -> a project-defined render descriptor; the DOM renderer layer resolves the actual function. */
  readonly nodeRenderers?: Record<string, unknown>;
  readonly priority?: number;
}

/**
 * The unit of ownership for one editor feature. Registering a list of these
 * (see registry.ts's createPluginRegistry) produces the SmartSchema,
 * command lookup, and normalizer/clipboard/renderer/toolbar/contextMenu
 * registrations a FoundationEditor is built from - replacing the static,
 * module-load-time spread `foundationSchema` used before Phase 10.
 */
export interface FoundationPlugin {
  readonly id: string;
  readonly version: string;
  readonly requires?: readonly string[];
  readonly optional?: readonly string[];
  /** Higher wins on a genuine tie; registration order breaks a tie in this. */
  readonly priority?: number;
  readonly schema?: SchemaContribution;
  readonly commands: Record<string, PluginCommand>;
  readonly normalizers?: readonly NormalizerRegistration[];
  readonly keyboardShortcuts?: readonly KeyboardShortcutContribution[];
  readonly clipboard?: ClipboardContribution;
  readonly renderer?: RendererContribution;
  readonly toolbar?: readonly ToolbarContribution[];
  readonly contextMenu?: readonly ContextMenuContribution[];
  readonly formats?: Record<string, FeatureFormatCodec>;
}
