import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // A leading underscore means "this argument exists because the signature
      // requires it, not because this body needs it". Two things in this codebase
      // depend on that being allowed: a Server Action's `_prev` state, which React
      // passes whether or not the action reads it, and a Bangla dictionary entry
      // that takes a count only because the English one has to inflect on it
      // (`reminders.people`). The stock rule only reports an unused argument when
      // nothing after it is used, so `_prev` slipped through on position alone —
      // this makes the convention explicit rather than lucky.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { args: "after-used", argsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
