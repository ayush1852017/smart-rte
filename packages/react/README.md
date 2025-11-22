# Smart RTE (Rich Text Editor) - React

[![npm version](https://img.shields.io/npm/v/smartrte-react.svg)](https://www.npmjs.com/package/smartrte-react)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A powerful, feature-rich Rich Text Editor built for React applications with support for tables, formulas (LaTeX/KaTeX), media management, and advanced text formatting.

## 🌟 Features

- **📝 Rich Text Editing**: Full-featured WYSIWYG editor with all standard formatting options
- **📊 Advanced Table Support**: Create, edit, merge, split cells, and customize tables
- **🔢 Mathematical Formulas**: LaTeX/KaTeX integration for rendering mathematical expressions
- **🖼️ Media Management**: Image upload, resize, drag-and-drop, and custom media manager integration
- **🎨 Styling Options**: Font sizes (8-96pt), text colors, background colors, and more
- **🔗 Link Management**: Easy insertion and editing of hyperlinks
- **📱 Responsive**: Works seamlessly across different screen sizes
- **⚡ Lightweight**: Minimal dependencies, optimized for performance
- **🎯 TypeScript Support**: Fully typed for better developer experience
- **🔧 Customizable**: Toggle features on/off, custom media managers, and more

## 📦 Installation

### Using npm

```bash
npm install smartrte-react
```

### Using yarn

```bash
yarn add smartrte-react
```

### Using pnpm

```bash
pnpm add smartrte-react
```

## 🚀 Quick Start

### Basic Usage

```tsx
import React, { useState } from 'react';
import { ClassicEditor } from 'smartrte-react';

function App() {
  const [content, setContent] = useState('<p>Start typing...</p>');

  return (
    <div>
      <ClassicEditor
        value={content}
        onChange={(html) => setContent(html)}
        placeholder="Type here…"
      />
    </div>
  );
}

export default App;
```

## 📚 Documentation

### Component API

#### ClassicEditor Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | `undefined` | HTML content of the editor |
| `onChange` | `(html: string) => void` | `undefined` | Callback fired when content changes |
| `placeholder` | `string` | `"Type here…"` | Placeholder text when editor is empty |
| `minHeight` | `number \| string` | `200` | Minimum height of the editor (in pixels) |
| `maxHeight` | `number \| string` | `500` | Maximum height of the editor (in pixels) |
| `readOnly` | `boolean` | `false` | Make the editor read-only |
| `table` | `boolean` | `true` | Enable/disable table functionality |
| `media` | `boolean` | `true` | Enable/disable media/image functionality |
| `formula` | `boolean` | `true` | Enable/disable formula/LaTeX functionality |
| `mediaManager` | `MediaManagerAdapter` | `undefined` | Custom media manager for handling images |

### Advanced Examples

#### Complete Example with All Features

```tsx
import React, { useState } from 'react';
import { ClassicEditor, MediaManagerAdapter } from 'smartrte-react';

// Custom media manager implementation
const customMediaManager: MediaManagerAdapter = {
  async search(query) {
    // Implement your media search logic
    const response = await fetch(`/api/media/search?q=${query.text}`);
    const data = await response.json();
    return {
      items: data.items.map(item => ({
        id: item.id,
        url: item.url,
        thumbnailUrl: item.thumbnailUrl,
        title: item.title,
      })),
    };
  },
  async upload(file) {
    // Implement your file upload logic
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/media/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await response.json();
    return {
      id: data.id,
      url: data.url,
      thumbnailUrl: data.thumbnailUrl,
      title: data.title,
    };
  },
};

function AdvancedEditor() {
  const [content, setContent] = useState('');

  return (
    <ClassicEditor
      value={content}
      onChange={(html) => {
        console.log('Content changed:', html);
        setContent(html);
      }}
      placeholder="Start editing..."
      minHeight={300}
      maxHeight={800}
      table={true}
      media={true}
      formula={true}
      mediaManager={customMediaManager}
    />
  );
}

export default AdvancedEditor;
```

#### Read-Only Mode

```tsx
import { ClassicEditor } from 'smartrte-react';

function ReadOnlyEditor({ content }) {
  return (
    <ClassicEditor
      value={content}
      readOnly={true}
      minHeight={200}
    />
  );
}
```

#### Minimal Editor (No Tables, Media, or Formulas)

```tsx
import { ClassicEditor } from 'smartrte-react';

function MinimalEditor() {
  const [content, setContent] = useState('');

  return (
    <ClassicEditor
      value={content}
      onChange={setContent}
      table={false}
      media={false}
      formula={false}
      placeholder="Simple text editor"
    />
  );
}
```

#### Next.js Integration

For Next.js applications, you may need to use dynamic imports to avoid SSR issues:

```tsx
import dynamic from 'next/dynamic';
import { useState } from 'react';

const ClassicEditor = dynamic(
  () => import('smartrte-react').then(mod => mod.ClassicEditor),
  { ssr: false }
);

export default function Page() {
  const [content, setContent] = useState('');

  return (
    <div>
      <ClassicEditor
        value={content}
        onChange={setContent}
        placeholder="Start typing..."
      />
    </div>
  );
}
```

## 🔧 Features Deep Dive

### Text Formatting

The editor supports all standard text formatting options:

- **Bold**, *Italic*, <u>Underline</u>, ~~Strikethrough~~
- Font sizes from 8pt to 96pt
- Text color and background color
- Headings (H1-H6)
- Paragraph, blockquote, code block
- Ordered and unordered lists
- Text alignment (left, center, right, justify)
- Superscript and subscript

### Tables

Full-featured table support includes:

- Create tables with custom rows and columns
- Add/delete rows and columns
- Merge and split cells
- Toggle header rows/cells
- Cell background colors
- Cell borders toggle
- Right-click context menu for table operations
- Keyboard navigation (Tab, Shift+Tab, Arrow keys)

**Keyboard Shortcuts:**
- `Tab` - Move to next cell
- `Shift+Tab` - Move to previous cell
- `Arrow keys` - Navigate between cells
- Right-click on cell - Open context menu

### Mathematical Formulas

LaTeX/KaTeX support for mathematical expressions:

```tsx
// The editor automatically loads KaTeX
// Users can insert formulas using the formula button
// Examples of supported LaTeX:
// - E=mc^2
// - \frac{a}{b}
// - \sqrt{x}
// - \sum_{i=1}^{n} x_i
```

**Required External Dependency:**

To use formulas, include KaTeX in your HTML:

```html
<!-- In your public/index.html or _app.tsx -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js"></script>
```

### Media Management

Built-in image support with optional custom media manager:

**Default behavior:**
- Local file upload
- Drag and drop images
- Image resize handles
- Right-click context menu for image operations

**Custom Media Manager Implementation:**

```typescript
import { MediaManagerAdapter, MediaItem, MediaSearchQuery } from 'smartrte-react';

const myMediaManager: MediaManagerAdapter = {
  async search(query: MediaSearchQuery) {
    // Search your media library
    return {
      items: [/* array of MediaItem */],
      hasMore: false,
      nextPage: undefined,
    };
  },
  
  async upload(file: File) {
    // Upload file to your server
    return {
      id: 'unique-id',
      url: 'https://example.com/image.jpg',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      title: 'Image title',
    };
  },
};
```

## 🎨 Styling

The editor comes with built-in styles. You can customize the appearance by wrapping it in a container:

```tsx
<div style={{
  border: '1px solid #ddd',
  borderRadius: '8px',
  overflow: 'hidden',
}}>
  <ClassicEditor
    value={content}
    onChange={setContent}
  />
</div>
```

## 🛠️ Development

### Prerequisites

- Node.js 18+ 
- pnpm 9.10.0+

### Setting Up Development Environment

1. **Clone the repository**

```bash
git clone https://github.com/ayush1852017/smart-rte.git
cd smart-rte
```

2. **Install dependencies**

```bash
pnpm install
```

3. **Build the project**

```bash
# Build TypeScript packages
pnpm build
```

4. **Run the development playground**

```bash
cd packages/react/playground
pnpm install
pnpm dev
```

The playground will be available at `http://localhost:5173`

### Project Structure

```
smart-rte/
├── packages/
│   └── react/              # Main React package (smartrte-react)
│       ├── src/
│       │   ├── components/
│       │   │   ├── ClassicEditor.tsx   # Main editor component
│       │   │   └── MediaManager.tsx    # Media management component
│       │   └── index.ts
│       ├── playground/     # Development playground
│       └── package.json
├── dart/                   # Flutter/Dart packages
│   ├── smartrte_flutter/   # Flutter WebView integration
│   └── example_app/        # Flutter example
└── package.json
```

### Building for Production

```bash
# Build the React package
cd packages/react
pnpm build

# This creates:
# - dist/index.js       - ES module
# - dist/index.d.ts     - TypeScript definitions
# - dist/embed.js       - Standalone embed bundle
```

### Running Tests

```bash
# Run vitest
pnpm test

# Run E2E tests with Playwright
pnpm e2e
```

### Running Storybook

```bash
cd packages/react
pnpm storybook
```

Storybook will be available at `http://localhost:6006`

## 📝 Publishing

### For Package Maintainers

The package is published to npm as `smartrte-react`.

```bash
# Make sure you're in packages/react
cd packages/react

# Update version in package.json
# Then publish
pnpm publish
```

The `prepublishOnly` script automatically runs `build:all` before publishing.

### Version Management

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** version for incompatible API changes
- **MINOR** version for backwards-compatible functionality
- **PATCH** version for backwards-compatible bug fixes

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/ayush1852017/smart-rte/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable
   - Your environment (browser, OS, React version)

### Suggesting Features

1. Check [existing feature requests](https://github.com/ayush1852017/smart-rte/issues?q=is%3Aissue+label%3Aenhancement)
2. Create a new issue with:
   - Clear description of the feature
   - Use cases
   - Proposed API (if applicable)

### Pull Requests

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Make** your changes
4. **Test** your changes thoroughly
5. **Commit** with clear messages (`git commit -m 'Add amazing feature'`)
6. **Push** to your fork (`git push origin feature/amazing-feature`)
7. **Open** a Pull Request

#### PR Guidelines

- Follow the existing code style
- Add tests for new features
- Update documentation
- Keep PRs focused on a single feature/fix
- Write clear commit messages

### Development Workflow

```bash
# 1. Create a feature branch
git checkout -b feature/my-feature

# 2. Make changes and test
pnpm dev  # Run playground
pnpm test # Run tests

# 3. Build to ensure no errors
pnpm build

# 4. Commit and push
git add .
git commit -m "feat: add my feature"
git push origin feature/my-feature

# 5. Create PR on GitHub
```

## 🐛 Troubleshooting

### Common Issues

#### Issue: Editor not showing/rendering

**Solution:** Make sure React and React-DOM are installed as peer dependencies:

```bash
npm install react@18 react-dom@18
```

#### Issue: Formula rendering not working

**Solution:** Ensure KaTeX is loaded in your HTML:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js"></script>
```

#### Issue: TypeScript errors

**Solution:** Make sure you have the latest type definitions:

```bash
npm install --save-dev @types/react@18 @types/react-dom@18
```

#### Issue: Build errors in Next.js

**Solution:** Use dynamic imports to disable SSR:

```tsx
const ClassicEditor = dynamic(
  () => import('smartrte-react').then(mod => mod.ClassicEditor),
  { ssr: false }
);
```

#### Issue: Images not uploading

**Solution:** Check that the `media` prop is set to `true` and implement a custom `mediaManager` if you need server-side uploads.

## 🔐 Security

### Reporting Security Issues

If you discover a security vulnerability, please email [security@yourdomain.com] instead of using the issue tracker.

### Content Sanitization

**⚠️ Important:** The editor outputs raw HTML. Always sanitize user-generated content before displaying it to prevent XSS attacks.

Recommended libraries:
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [sanitize-html](https://github.com/apostrophecms/sanitize-html)

Example:

```tsx
import DOMPurify from 'dompurify';

function DisplayContent({ html }) {
  const sanitized = DOMPurify.sanitize(html);
  return <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
}
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../../dart/smartrte_flutter/LICENSE) file for details.

```
MIT License

Copyright (c) 2025 Smart RTE Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 👥 Authors & Contributors

- **Smart RTE Team** - Initial work and maintenance

See the list of [contributors](https://github.com/ayush1852017/smart-rte/contributors) who participated in this project.

## 🙏 Acknowledgments

- [KaTeX](https://katex.org/) - For mathematical formula rendering
- [React](https://reactjs.org/) - The UI library
- [Vite](https://vitejs.dev/) - Build tool
- All our amazing [contributors](https://github.com/ayush1852017/smart-rte/contributors)

## 📞 Support

- **Documentation:** You're reading it! 📖
- **Issues:** [GitHub Issues](https://github.com/ayush1852017/smart-rte/issues)
- **Discussions:** [GitHub Discussions](https://github.com/ayush1852017/smart-rte/discussions)
- **Twitter:** [@smartrte](https://twitter.com/smartrte) (if applicable)

## 🗺️ Roadmap

### Current Version (0.1.x)

- ✅ Rich text editing
- ✅ Table support
- ✅ Formula support (LaTeX/KaTeX)
- ✅ Media management
- ✅ TypeScript support

### Upcoming Features

- 🔄 Collaborative editing
- 🔄 Undo/Redo improvements
- 🔄 Code syntax highlighting
- 🔄 Markdown import/export
- 🔄 Custom toolbar configuration
- 🔄 Mobile optimization
- 🔄 Accessibility improvements (ARIA labels, keyboard shortcuts)

## 📊 Browser Support

| Browser | Version |
|---------|---------|
| Chrome | Last 2 versions |
| Firefox | Last 2 versions |
| Safari | Last 2 versions |
| Edge | Last 2 versions |

## 🔗 Related Packages

- **smartrte-flutter** - Flutter/Dart WebView implementation

## 💡 Tips & Best Practices

1. **Performance**: For large documents, consider implementing lazy loading or pagination
2. **State Management**: Use React state or a state management library (Redux, Zustand) for complex applications
3. **Validation**: Always validate and sanitize HTML content before storing or displaying
4. **Accessibility**: Test with screen readers and keyboard navigation
5. **Mobile**: Test on mobile devices as touch interactions may differ
6. **Auto-save**: Implement auto-save functionality to prevent data loss

## 🎓 Learning Resources

### For Entry-Level Developers

1. **Getting Started with React**: [React Official Tutorial](https://react.dev/learn)
2. **Understanding Rich Text Editors**: [MDN ContentEditable](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/contenteditable)
3. **TypeScript Basics**: [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)

### For Mid-Level Developers

1. **Advanced React Patterns**: Hooks, Context, Performance Optimization
2. **Component Design**: Building reusable, maintainable components
3. **State Management**: When and how to use external state management

### For Senior Developers

1. **Architecture**: Designing scalable editor implementations
2. **Performance**: Optimization techniques for large documents
3. **Extensibility**: Building plugin systems and custom extensions
4. **Cross-platform**: Adapting the editor for different frameworks

---

**Happy Editing! 🎉**

If you find this package useful, please consider giving it a ⭐ on [GitHub](https://github.com/ayush1852017/smart-rte)!
