# smartrte_flutter

Smart RTE Classic Editor widget for Flutter using webview_flutter.

## Features

- Rich-text editing powered by the Smart RTE web editor
- Insert images, tables, and formulas
- Image context menu with alignment, alt text, width, radius, link, replace
- Two-way binding via a lightweight JavaScript bridge

## Usage

```dart
ClassicEditor(
  initialHtml: '<p>Hello</p>',
  onHtmlChange: (html) { /* save */ },
  onReady: () {},
)
```

## License

See LICENSE.



