# Phase 7 security fixture inventory

| Fixture | Control proved |
|---|---|
| `javascript:alert(1)` and mixed-case variant | Dangerous scheme rejected |
| `vbscript:msgbox(1)` | Legacy executable scheme rejected |
| `data:text/html,<script>…` | Non-image data MIME rejected |
| `data:image/svg+xml,<svg onload=…>` | Executable SVG data MIME rejected |
| `file:///etc/passwd` | Local-file scheme rejected |
| URL containing a NUL byte | Malformed resource rejected |
| `data:image/png;base64,…` | Explicit safe raster data MIME accepted |
| SVG/formula source containing tags and event handlers | Rendered as text; no SVG, script, image, or frame node created |
| Hostile source passed to atom update | Command emits no operation |
| Hostile source returned by async upload | Atom becomes an error state without retaining the hostile URL |
| Oversized dimensions | Schema attribute validation rejects the atom |
| Unparseable formula/error state | Source and error remain content and are not dropped |
| Pending atom or any `blob:` source at persistence | Serialization fails loudly |

The product path uses the same sanitizer as links and foundation atom commands;
there is no second URL-policy implementation in React.

