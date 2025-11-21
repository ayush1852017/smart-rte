# Smart RTE - Multi-Platform Rich Text Editor

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/smartrte-react.svg)](https://www.npmjs.com/package/smartrte-react)

A powerful, cross-platform Rich Text Editor with advanced features including tables, mathematical formulas (LaTeX/KaTeX), and media management. Built with Rust core and available for Web (React) and Flutter.

## 🌟 Features

- **📝 Rich Text Editing** - Full WYSIWYG editor with standard formatting
- **📊 Advanced Tables** - Create, edit, merge/split cells with full customization
- **🔢 Mathematical Formulas** - LaTeX/KaTeX rendering support
- **🖼️ Media Management** - Image upload, resize, drag-and-drop
- **🎨 Extensive Styling** - Font sizes, colors, alignments, and more
- **⚡ High Performance** - Rust core compiled to WASM for speed
- **🔧 Highly Customizable** - Toggle features, custom media managers
- **📱 Cross-Platform** - React, Flutter, and standalone builds

## 📦 Packages

This monorepo contains multiple packages for different platforms:

### React Package (npm)

```bash
npm install smartrte-react
```

📚 **[Full React Documentation](./packages/react/README.md)**

```tsx
import { ClassicEditor } from 'smartrte-react';

function App() {
  const [content, setContent] = useState('');
  
  return (
    <ClassicEditor
      value={content}
      onChange={setContent}
      table={true}
      media={true}
      formula={true}
    />
  );
}
```

### Flutter Package

📚 **[Flutter Documentation](./dart/smartrte_flutter/README.md)**

### Standalone Embed (CDN)

```html
<script src="https://unpkg.com/@smartrte/classic-embed"></script>
<div id="editor"></div>
<script>
  window.SmartRTE.ClassicEditor.init({
    target: document.getElementById("editor"),
  });
</script>
```

📚 **[Embed Documentation](./packages/classic-embed/README.md)**

## 🏗️ Repository Structure

```
smart-rte/
├── rust/                    # Rust core library
│   ├── smart_rte_core/     # Core editor logic
│   └── smart_rte_wasm/     # WASM bindings
├── packages/
│   ├── react/              # React component (smartrte-react)
│   ├── core-wasm/          # Compiled WASM package
│   ├── classic-embed/      # Standalone browser bundle
│   └── storage-s3/         # S3 storage adapter
├── dart/
│   └── smartrte_flutter/   # Flutter package
├── apps/
│   ├── demo-next/          # Next.js demo app
│   └── docs/               # Documentation site
└── tools/                  # Build and development tools
```

## 🚀 Quick Start

### For Users (Installing the Package)

**React:**
```bash
npm install smartrte-react
```

See the [React README](./packages/react/README.md) for complete usage instructions.

**Flutter:**
```bash
flutter pub add smartrte_flutter
```

See the [Flutter README](./dart/smartrte_flutter/README.md) for usage instructions.

### For Contributors (Development Setup)

#### Prerequisites

- **Node.js** 18+ with pnpm 9.10.0+
- **Rust** with cargo
- **wasm-pack** for WASM compilation
- **Optional:** Flutter SDK for Flutter development

#### Setup Instructions

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/smart-rte.git
cd smart-rte
```

2. **Install dependencies**

```bash
pnpm install
```

3. **Build WASM core**

```bash
pnpm build:wasm
```

This compiles the Rust core to WASM and outputs to `packages/core-wasm/pkg/`

4. **Build all TypeScript packages**

```bash
pnpm build:ts
```

5. **Or build everything**

```bash
pnpm build
```

#### Development Workflow

**Run React Playground:**

```bash
cd packages/react/playground
pnpm install
pnpm dev
```

Open `http://localhost:5173` to see the editor in action.

**Run Storybook:**

```bash
cd packages/react
pnpm storybook
```

Open `http://localhost:6006` for component documentation.

**Run Tests:**

```bash
pnpm test        # Vitest unit tests
pnpm e2e         # Playwright E2E tests
```

**Build for Production:**

```bash
cd packages/react
pnpm build:all
```

This creates:
- `dist/index.js` - ES module
- `dist/index.d.ts` - TypeScript definitions  
- `dist/embed.js` - Standalone bundle

## 🛠️ Technology Stack

- **Core:** Rust (performance-critical operations)
- **Web:** 
  - React 18+
  - TypeScript
  - Vite (build tool)
  - Vitest (testing)
  - Playwright (E2E testing)
  - Storybook (component docs)
- **Mobile:** Flutter/Dart
- **Build:** 
  - pnpm (package manager)
  - wasm-pack (Rust → WASM)
  - Cargo (Rust build)

## 📖 Documentation

- **[React Package Documentation](./packages/react/README.md)** - Complete guide for React usage
- **[Flutter Package Documentation](./dart/smartrte_flutter/README.md)** - Flutter integration guide
- **[Standalone Embed Documentation](./packages/classic-embed/README.md)** - Browser script usage
- **[Contributing Guidelines](#-contributing)** - How to contribute
- **[Architecture Overview](#-architecture)** - Technical architecture

## 🏛️ Architecture

### High-Level Overview

```
┌─────────────────────────────────────┐
│     User Interfaces (UI Layer)     │
│                                     │
│  ┌─────────┐  ┌─────────┐         │
│  │  React  │  │ Flutter │  ...    │
│  └────┬────┘  └────┬────┘         │
└───────┼────────────┼───────────────┘
        │            │
┌───────┼────────────┼───────────────┐
│       │   Bindings Layer          │
│  ┌────▼────┐  ┌───▼────┐          │
│  │  WASM   │  │  FFI   │          │
│  └────┬────┘  └───┬────┘          │
└───────┼───────────┼────────────────┘
        │           │
┌───────▼───────────▼────────────────┐
│      Rust Core (Performance)       │
│                                     │
│  • Document Model                  │
│  • Operations & Transforms         │
│  • Table Logic                     │
│  • Formula Processing              │
└─────────────────────────────────────┘
```

### Key Components

1. **Rust Core** (`rust/smart_rte_core/`)
   - Document representation
   - Operation transforms
   - Core business logic
   - Compiled to WASM for web

2. **WASM Bindings** (`rust/smart_rte_wasm/`)
   - JavaScript ↔ Rust interop
   - Web worker support (future)

3. **React Components** (`packages/react/`)
   - `ClassicEditor` - Main editor component
   - `MediaManager` - Media handling
   - TypeScript definitions

4. **Flutter Package** (`dart/smartrte_flutter/`)
   - Native Flutter widgets
   - FFI bindings to Rust core

## 📝 Package Scripts

From the root directory:

```bash
pnpm build:core      # Build Rust core
pnpm build:wasm      # Compile Rust to WASM
pnpm build:ts        # Build all TypeScript packages
pnpm build           # Build everything (WASM + TS)
pnpm dev             # Alias for build
```

From `packages/react/`:

```bash
pnpm build           # Build TypeScript only
pnpm build:embed     # Build standalone bundle
pnpm build:all       # Build TS + embed
pnpm dev             # Development mode
pnpm test            # Run tests
pnpm e2e             # Run E2E tests
pnpm storybook       # Start Storybook
```

## 🤝 Contributing

We welcome contributions! Here's how:

### Reporting Issues

1. Check [existing issues](https://github.com/yourusername/smart-rte/issues)
2. Create a new issue with:
   - Clear description
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details

### Pull Requests

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add/update tests
5. Update documentation
6. Submit a PR

See the [React Package Contributing Guide](./packages/react/README.md#-contributing) for detailed guidelines.

### Development Standards

- **Code Style:** Follow existing patterns
- **TypeScript:** Use strict typing
- **Tests:** Add tests for new features
- **Documentation:** Update relevant docs
- **Commits:** Use conventional commits

## 🔒 Security

### Reporting Security Vulnerabilities

Email security issues to [security@yourdomain.com] instead of using the issue tracker.

### Content Safety

⚠️ **Always sanitize user-generated HTML** before displaying to prevent XSS attacks.

Recommended: [DOMPurify](https://github.com/cure53/DOMPurify)

## 📄 License

MIT License - see [LICENSE](./dart/smartrte_flutter/LICENSE) for details.

Copyright (c) 2025 Smart RTE Contributors

## 👥 Authors

- **Smart RTE Team** - Core development and maintenance
- See [Contributors](https://github.com/yourusername/smart-rte/contributors) for all contributors

## 🙏 Acknowledgments

- [KaTeX](https://katex.org/) - Formula rendering
- [React](https://reactjs.org/) - UI framework
- [Flutter](https://flutter.dev/) - Mobile framework
- [Rust](https://www.rust-lang.org/) - Systems programming language

## 📞 Support & Community

- **Documentation:** Check package-specific READMEs
- **Issues:** [GitHub Issues](https://github.com/yourusername/smart-rte/issues)
- **Discussions:** [GitHub Discussions](https://github.com/yourusername/smart-rte/discussions)

## 🗺️ Roadmap

### Current (v0.1.x)

- ✅ React package with full features
- ✅ Table support
- ✅ Formula support
- ✅ Media management
- ✅ TypeScript support

### Upcoming

- 🔄 Collaborative editing (CRDT)
- 🔄 Mobile-optimized UI
- 🔄 Custom toolbar configuration
- 🔄 Markdown import/export
- 🔄 Code syntax highlighting
- 🔄 Accessibility enhancements
- 🔄 Performance optimizations

## 📊 Project Status

| Package | Status | Version | NPM |
|---------|--------|---------|-----|
| smartrte-react | ✅ Stable | 0.1.9 | [@npmjs](https://www.npmjs.com/package/smartrte-react) |
| @smartrte/classic-embed | ✅ Stable | - | - |
| smartrte-flutter | 🚧 Beta | - | - |
| smart-rte-core | 🚧 Beta | - | - |

---

**Made with ❤️ by the Smart RTE Team**

If you find this project useful, please ⭐ star it on GitHub!
