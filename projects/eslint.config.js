import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';
import n from 'eslint-plugin-n';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typedParserOptions = {
    project: './tsconfig.eslint.json',
    tsconfigRootDir: import.meta.dirname,
};

const nodeLanguageOptions = {
    ecmaVersion: 'latest',
    sourceType: 'module',
    globals: {
        ...globals.node,
        ...globals.es2024,
    },
    parserOptions: typedParserOptions,
};

export default defineConfig([
    {
        ignores: [
            '**/dist/**',
            '**/coverage/**',
            '**/.vitest/**',
            'node_modules/**',
            'apps/web/**',
            '**/data/**',
            '**/.local/**',
            'packages/db/drizzle/**',
        ],
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
            reportUnusedInlineConfigs: 'error',
        },
    },
    js.configs.recommended,
    n.configs['flat/recommended-module'],
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        files: ['**/*.{js,ts,tsx}'],
        languageOptions: nodeLanguageOptions,
        settings: {
            node: {
                version: '>=24.16.0',
                tryExtensions: ['.js', '.ts', '.tsx', '.json'],
            },
        },
        rules: {
            curly: ['error', 'all'],
            eqeqeq: ['error', 'always'],
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'no-duplicate-imports': 'error',
            'object-shorthand': ['error', 'always'],
            'prefer-template': 'error',
            'n/no-missing-import': 'off',
            'n/no-process-exit': 'off',
            'n/no-unpublished-import': 'off',
            '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
            '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
            '@typescript-eslint/consistent-type-imports': [
                'error',
                {
                    prefer: 'type-imports',
                    fixStyle: 'inline-type-imports',
                },
            ],
            '@typescript-eslint/no-confusing-void-expression': 'off',
            '@typescript-eslint/no-import-type-side-effects': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
        },
    },
    {
        files: ['**/*.{test,spec}.ts'],
        rules: {
            'n/no-extraneous-import': 'off',
        },
    },
    {
        files: ['**/*.{test,spec}.ts'],
        ...vitest.configs.recommended,
        languageOptions: {
            ...nodeLanguageOptions,
            globals: {
                ...nodeLanguageOptions.globals,
                ...globals.vitest,
            },
        },
    },
    eslintConfigPrettier,
]);
