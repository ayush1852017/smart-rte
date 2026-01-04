const { ClassicEditor } = require('smartrte-react');

// Basic usage demonstration for Node environment
// Note: ClassicEditor is a React component and requires a DOM environment (like a browser) to fully render.
// This example demonstrates verifying the module export.

console.log("Smart RTE React Loaded Successfully!");
console.log("The package exports the following:");
console.log("- ClassicEditor:", typeof ClassicEditor);

if (typeof ClassicEditor === 'function') {
    console.log("✅ ClassicEditor component is available.");
} else {
    console.error("❌ ClassicEditor component check failed.");
}

console.log("\nTo test the editor interactively, please visit our online playground (link in README) or use CodeSandbox.");
