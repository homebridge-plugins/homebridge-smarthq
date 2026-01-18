import antfu from '@antfu/eslint-config'

export default antfu(
  {
    ignores: ['dist', 'docs'],
    jsx: false,
    typescript: true,
    formatters: {
      markdown: true,
    },
    rules: {
      'curly': ['error', 'multi-line'],
      // 'import/extensions': ['error', 'ignorePackages'], // Temporarily disabled due to ESLint 9 compatibility
      'import/order': 0,
      'jsdoc/check-alignment': 'error',
      'jsdoc/check-line-alignment': 'error',
      'no-undef': 'error',
      'perfectionist/sort-exports': 'error',
      'perfectionist/sort-imports': 0,
      'perfectionist/sort-named-exports': 'error',
      'perfectionist/sort-named-imports': 'error',
      'sort-imports': 0,
      'style/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      'style/quote-props': ['error', 'consistent-as-needed'],
      'test/no-only-tests': 'error',
      'unicorn/no-useless-spread': 'error',
      'unused-imports/no-unused-vars': ['error', { 
        caughtErrors: 'none',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'no-new': 0, // Disable the no-new rule
      'new-cap': 0, // Disable the new-cap rule
    },
  },
)
