import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.eslint.json",
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            "no-console": ["error", { allow: ["error"] }],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/consistent-type-imports": "error"
        }
    },
    {
        files: ["src/tests/**/*.ts"],
        rules: {
            "@typescript-eslint/require-await": "off"
        }
    },
    {
        ignores: ["dist/**", "node_modules/**", "coverage/**", "scripts/**/*.mjs"]
    }
);
