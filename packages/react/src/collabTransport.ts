import type { SmartSelection, SmartTransaction } from "smartrte-core/foundation";

/**
 * A remote collaborator's live cursor/selection, mirroring
 * `DocumentVersion`'s "reuse the existing shape, add nothing new" approach:
 * `selection` is the same `SmartSelection` the editor already tracks
 * locally, so it can be mapped through a rebase with the exact same
 * `mapOperation`-based machinery the annotation-range and comment
 * primitives already use (`FoundationTransactionMap`), not a bespoke
 * position type needing its own mapping logic.
 *
 * This is a data shape only - rendering a remote cursor from this
 * (a colored caret, a name label, etc.) is host/UI work, the same boundary
 * `MediaProvider` draws around actual upload UI: the package defines what
 * a presence update *is*, not how it looks on screen.
 */
export interface PresenceUpdate {
  readonly authorId: string;
  readonly selection?: SmartSelection;
  readonly lastActiveAt: number;
}

/**
 * Host-owned realtime transport boundary, mirroring `MediaProvider`'s and
 * `VersionProvider`'s shape and contract: the host implements the actual
 * connection (WebSocket, WebRTC, long-polling, whatever - nothing here
 * assumes a specific transport), the package never holds a socket or
 * server credential itself. There is deliberately no shipped default
 * implementation, exactly like `MediaProvider`/`VersionProvider` - when a
 * host doesn't supply one, the editor behaves exactly as it does today:
 * single-writer, `dispatch()`'s rebase path is never triggered because
 * `baseRevision` always matches (see `FoundationEditor.dispatch`).
 *
 * This interface is Phase 12b-client's contract only - no implementation
 * of it ships from this package. The actual server/socket work
 * (12b-server/transport) is a separate effort building *against* this
 * contract, not part of it.
 */
export interface CollabTransport {
  /**
   * Submit a local transaction. `accepted: false` (e.g. a server-side
   * permissions check failing) is a distinct outcome from a rebase
   * conflict - see `revision`, present only when accepted, for the
   * transaction's resulting revision as recorded by the transport's own
   * source of truth.
   */
  sendTransaction(transaction: SmartTransaction): Promise<{ accepted: boolean; revision?: number }>;
  /** Fires for every transaction the transport delivers from another author, in commit order. Returns an unsubscribe function. */
  onRemoteTransaction(handler: (transaction: SmartTransaction, revision: number) => void): () => void;
  /** Fires whenever another author's presence changes (selection moved, went idle, etc.). Returns an unsubscribe function. */
  onPresenceUpdate(handler: (presence: PresenceUpdate) => void): () => void;
  /** Broadcast this client's own presence. Fire-and-forget - unlike sendTransaction, presence has no durability or ordering guarantee to report back. */
  sendPresence(update: PresenceUpdate): void;
  /**
   * Transactions committed since `sinceRevision`, oldest first - what a
   * client needs to catch up after a disconnect, or what
   * `FoundationEditor.dispatch`'s own rebase path would ask for if this
   * editor's local revision log had already evicted that far back (see
   * `FoundationEditorOptions.revisionLogLimit`). An empty array means
   * nothing has changed since; the transport signaling "that revision no
   * longer exists" (e.g. server-side history compaction) is a
   * transport-specific error, not modeled here.
   */
  getRevisionHistory(sinceRevision: number): Promise<readonly SmartTransaction[]>;
}
