export { ClassicEditor } from './components/ClassicEditorAuthority.js'
export type { ClassicEditorProps } from './components/ClassicEditorAuthority.js'
export { CanonicalAuthorityEditor } from './components/CanonicalAuthorityEditor.js'
export type { CanonicalAuthorityEditorProps } from './components/CanonicalAuthorityEditor.js'
export { CanonicalEditorRuntime, createCanonicalEditorRuntime } from './canonicalEditorRuntime.js'
export type { SmartEditorChange, SmartEditorCheckpoint, SmartEditorHandle } from './canonicalEditorRuntime.js'
export type { MediaManagerAdapter, MediaItem, MediaSearchQuery } from './components/MediaManager.js'
export type { MediaFilters, MediaKind, MediaProvider, UploadOptions } from './mediaProvider.js'
export type { VersionListEntry, VersionProvider } from './versionProvider.js'
export type { DocumentVersion, CommentThread, CommentReply } from 'smartrte-core/foundation'
export type { CommentProvider } from './commentProvider.js'
export type { InlineSuggestionSummary, StructuralSuggestion, SuggestionKind } from 'smartrte-core/foundation'
export type { SuggestionProvider } from './suggestionProvider.js'
export { DefaultMediaPicker } from './components/MediaPicker.js'
export type { MediaPickerComponent, MediaPickerProps } from './components/MediaPicker.js'
export type { SrteTheme } from './theme.js'
export { SRTE_DEFAULT_CSS, ensureStyleSheet } from './theme.js'
export { DOCX_MEDIA_TYPE, exportDocxDocument, importDocxDocumentWithMammoth, smartDocumentToDocxXml, enhanceDocxTables, importStyledDocxDocument, buildPdfPrintDocument, importPdfDocument, PDF_MEDIA_TYPE, reconstructPdfPages } from 'smartrte-core/foundation'
export type { StyledDocxImportResult, PdfImportResult, PdfPageSnapshot, PdfTextItemSnapshot } from 'smartrte-core/foundation'
export { printSmartDocumentAsPdf } from './adapters/pdfPrint.js'
export { builtInFormatFidelity, getFormatFidelity } from 'smartrte-core/foundation'
export type { FeatureFidelityContract, FidelityFeature, FidelityFormat, FidelityLevel, FormatFidelityCapability, FeatureFormatCodec, DocumentFormatCodec, FormatId, FormatFidelityLevel, ParseContext, SerializeContext } from 'smartrte-core/foundation'
export type { DomTableCommand } from './adapters/domTableCommandBridge.js'
// Phase 10 plugin manifest system (packages/core/src/foundation/plugin/) -
// replaces the retired legacy pluginRuntime.ts/SmartRtePlugin system, which
// only ever drove the now-deleted LegacyClassicEditor and was inert under
// canonical authority (features/plugins/formats/mediaManager props on
// ClassicEditor were silently ignored - see the removed props' comment,
// git history, for why).
export { createPluginRegistry, resolveShortcut, builtInPlugins } from 'smartrte-core/foundation'
export type { FoundationPlugin, PluginCommand, PluginCommandContext, PluginRegistry, KeyboardShortcutContribution, ToolbarContribution, ContextMenuContribution, ClipboardContribution, RendererContribution } from 'smartrte-core/foundation'
