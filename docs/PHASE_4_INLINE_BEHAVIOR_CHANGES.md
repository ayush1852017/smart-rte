# Phase 4 Inline Behaviour-Change Catalogue

This catalogue was written before the production legacy inline path was
deleted. Shadow equivalence compares normalized structure with IDs stripped and
semantic selection offsets. It never compares operation streams.

| Area | Legacy behaviour | Canonical behaviour | Decision |
|---|---|---|---|
| Toggle over mixed coverage | Varied with DOM run boundaries. | Remove only when the complete requested scope is covered; otherwise apply to the complete scope. | Canonical rule is intentional and uniform. |
| Caret-equivalent run boundary | A DOM endpoint attached to the preceding run could make an otherwise fully marked range appear mixed. | Linear owner offsets plus backward affinity produce one deterministic scope. | Intentional; classified `expected-normalization` in shadow output. |
| Adjacent equal marks | Equivalent adjacent wrappers/runs could remain split. | Local normalization merges them after canonical mark sorting. | Serialization-only improvement. |
| Colour attributes | Browser strings (`red`, RGB, mixed-case hex) survived as distinct values. | Lowercase hex (including alpha) is stored. | Intentional canonicalization. |
| Font size/family | CSS spelling and casing survived. | Size is finite px; family names are trimmed, de-quoted, whitespace-normalized, and lowercase. | Intentional canonicalization. |
| Script exclusivity | Separate DOM handlers tried to avoid nested super/sub. | `MarkSpec.excludes` makes superscript/subscript mutually exclusive in every path. | Intentional consistency fix. |
| Link boundary typing | Browser/native behavior could extend a link. | `link.inclusive=false`; typing at the end is unlinked while typing inside remains linked. | Intentional UX contract. |
| Collapsed formatting | Some tools inserted zero-width DOM sentinels and others used browser state. | Stored marks are editor state; no invisible document content is inserted. | Intentional data-cleanliness fix. |
| Shift+Enter | Product produced `<br>` while the canonical surface stored newline text. | Both parse/render as the atomic, unmarked `hard_break` node; legacy newline canonical documents migrate on load. | Contract convergence. |
| Invalid links | Browser execution could accept unsafe schemes depending on path. | Unsafe or malformed URLs are rejected at the command boundary. | Intentional security fix. |

Marked-text composition is reconciled by tokens and preserves run boundaries.
Atom-aware composition tokenization remains owned by Phase 7.
