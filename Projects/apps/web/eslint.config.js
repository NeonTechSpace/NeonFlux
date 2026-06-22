// @ts-check

import eslintReact from '@eslint-react/eslint-plugin';
import queryPlugin from '@tanstack/eslint-plugin-query';
import routerPlugin from '@tanstack/eslint-plugin-router';
import vitest from '@vitest/eslint-plugin';
import { tanstackConfig } from '@tanstack/eslint-config';
import eslintConfigPrettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import testingLibrary from 'eslint-plugin-testing-library';

const testFiles = ['**/*.{test,spec}.{ts,tsx}'];

export default [
    {
        ignores: [
            '.tanstack/**',
            '.nitro/**',
            '.source/**',
            '.vinxi/**',
            '.output/**',
            'dist/**',
            'eslint.config.js',
            'node_modules/**',
            'prettier.config.js',
            'src/routeTree.gen.ts',
        ],
    },
    reactHooks.configs.flat['recommended-latest'],
    eslintReact.configs['recommended-typescript'],
    jsxA11y.configs.recommended,
    ...routerPlugin.configs['flat/recommended'],
    ...queryPlugin.configs['flat/recommended'],
    ...tanstackConfig,
    {
        ...vitest.configs.env,
        files: testFiles,
    },
    {
        ...vitest.configs.recommended,
        files: testFiles,
    },
    {
        ...testingLibrary.configs['flat/react'],
        files: testFiles,
    },
    {
        rules: {
            '@eslint-react/error-boundaries': 'off',
            '@eslint-react/exhaustive-deps': 'off',
            '@eslint-react/purity': 'off',
            '@eslint-react/rules-of-hooks': 'off',
            '@eslint-react/set-state-in-effect': 'off',
            '@eslint-react/set-state-in-render': 'off',
            '@eslint-react/static-components': 'off',
            '@eslint-react/unsupported-syntax': 'off',
            '@eslint-react/use-memo': 'off',
            '@typescript-eslint/array-type': 'off',
            '@typescript-eslint/require-await': 'off',
            'import/no-cycle': 'off',
            'import/order': 'off',
            'pnpm/json-enforce-catalog': 'off',
            'sort-imports': 'off',
        },
    },
    eslintConfigPrettier,
];
