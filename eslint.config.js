import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/build/**', '**/tests/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: [
          './tsconfig.json',
          './packages/*/tsconfig.json',
          './apps/*/tsconfig.json',
          './scripts/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  }
);
