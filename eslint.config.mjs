// eslint-config-next 16 ships a native flat config, so no FlatCompat shim.
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      '.npm-cache/**',
      '.localdata/**',
      'next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...nextCoreWebVitals,
  {
    // Pin the React version explicitly: eslint-plugin-react's auto-detection
    // uses an ESLint 9 API that was removed in ESLint 10.
    settings: { react: { version: '19.3.0' } },
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Tool inputs and Supabase rows are genuinely dynamic at the boundary;
      // they are validated by zod before anything downstream touches them.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
);
