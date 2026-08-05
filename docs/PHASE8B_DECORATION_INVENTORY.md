# Phase 8b decoration inventory

| Projection | Canonical owner | Model child? | DOM mutation outside renderer? |
|---|---|---:|---:|
| Checklist checkbox control | `FoundationSubtreeRenderer` | No (`data-smart-ui`) | No |
| Table caption/header associations | `FoundationSubtreeRenderer` | No | No |
| Selection/caret | `ModelDomMapping` + browser Selection | No | No |
| List-level announcement | renderer live region | No (`data-smart-ui`) | No |
| Atom read-only shell | `FoundationSubtreeRenderer` | Atom projection only | No |

Legacy-only overlays (table resize handles, table selection paint, image handles,
link popover anchors, drag handles) stay inside `LegacyClassicEditor` and are not
mounted on the canonical surface. Before any is reintroduced, it must be a
renderer-owned `data-smart-ui` projection; direct mutation of editable model DOM
is prohibited.

