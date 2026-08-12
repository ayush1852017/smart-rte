export interface CanonicalAuthorityContext {
  tenantId?: string;
  documentId?: string;
}

export interface CanonicalAuthorityFlagSnapshot {
  global: boolean;
  tenants: Readonly<Record<string, boolean>>;
  documents: Readonly<Record<string, boolean>>;
}

/**
 * Runtime rollback switch. Resolution order is direct component override,
 * document, tenant, then global. Promoted on (canonical authority is the
 * default) after the Phase 8b replay and production-surface gates passed;
 * this remains a rollback switch, not a feature flag pending removal.
 */
class CanonicalAuthorityFlag {
  private globalEnabled = true;
  private tenants = new Map<string, boolean>();
  private documents = new Map<string, boolean>();
  private listeners = new Set<() => void>();
  private version = 0;
  private changed(): void { this.version += 1; this.listeners.forEach((listener) => listener()); }

  enabled(context: CanonicalAuthorityContext = {}, direct?: boolean): boolean {
    if (direct !== undefined) return direct;
    if (context.documentId && this.documents.has(context.documentId)) return this.documents.get(context.documentId)!;
    if (context.tenantId && this.tenants.has(context.tenantId)) return this.tenants.get(context.tenantId)!;
    return this.globalEnabled;
  }

  setGlobal(enabled: boolean): void { if (this.globalEnabled !== enabled) { this.globalEnabled = enabled; this.changed(); } }
  setTenant(tenantId: string, enabled: boolean | null): void {
    if (enabled === null) this.tenants.delete(tenantId); else this.tenants.set(tenantId, enabled);
    this.changed();
  }
  setDocument(documentId: string, enabled: boolean | null): void {
    if (enabled === null) this.documents.delete(documentId); else this.documents.set(documentId, enabled);
    this.changed();
  }
  snapshot(): CanonicalAuthorityFlagSnapshot {
    return { global: this.globalEnabled, tenants: Object.fromEntries(this.tenants), documents: Object.fromEntries(this.documents) };
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getVersion(): number { return this.version; }
  reset(): void { this.globalEnabled = false; this.tenants.clear(); this.documents.clear(); this.changed(); }
}

export const canonicalAuthorityFlag = new CanonicalAuthorityFlag();
