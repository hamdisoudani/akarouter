import nextPlugin from '@next/eslint-plugin-next'
import tseslint from 'typescript-eslint'

/**
 * Native ESLint 9 flat config.
 *
 * The previous `next lint` command (Next 13-15) used the legacy `.eslintrc`
 * config format. Next 16 removed `next lint` and expects a flat config
 * (eslint.config.mjs). This file uses the native flat config API directly
 * to avoid the `FlatCompat` circular-reference bug.
 */

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'build/**',
      'dist/**',
      '**/*.config.{js,mjs,ts}',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // Relax rules that are noisy on copy-pasted or generated code.
      'react/no-unescaped-entities': 'off',
      '@next/next/no-img-element': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
)
