// This example validates the package export in a Node.js environment
// Start with a basic check, using try-catch to handle ESM/CJS interop issues common in RunKit.

try {
    // Attempt standard require
    var smartRte = require('smartrte-react');
    console.log("✅ Successfully required 'smartrte-react'");
    
    if (smartRte.ClassicEditor) {
        console.log("✅ ClassicEditor component is exported.");
    } else {
        console.log("ℹ️ Package loaded, but ClassicEditor property not found directly on export.");
        console.log("Export keys:", Object.keys(smartRte));
    }
} catch (e) {
    if (e.code === 'ERR_REQUIRE_ESM') {
        console.log("⚠️ Package is ESM-only. RunKit primarily uses CommonJS `require`.");
        console.log("To use this package in a project, use `import` syntax:");
        console.log("import { ClassicEditor } from 'smartrte-react';");
    } else {
        console.error("❌ Error loading package:", e.message);
    }
}

console.log("\n---------------------------------------------------------");
console.log("NOTE: This is a React component library.");
console.log("To see it in action, use the interactive playground:");
console.log("https://codesandbox.io/s/smartrte-react-demo");
console.log("---------------------------------------------------------");
