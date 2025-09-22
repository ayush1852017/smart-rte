module.exports = {
  root: false,
  env: { browser: true, node: true, es2022: true },
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
  ],
  settings: { react: { version: "detect" } },
  rules: {
    "no-console": ["warn", { allow: ["warn", "error"] }],
  },
};
