/** @type {import('prettier').Config} */
const config = {
    arrowParens: 'always',
    bracketSameLine: true,
    bracketSpacing: true,
    endOfLine: 'auto',
    jsxSingleQuote: true,
    plugins: ['prettier-plugin-tailwindcss'],
    printWidth: 120,
    proseWrap: 'preserve',
    quoteProps: 'as-needed',
    semi: true,
    singleQuote: true,
    tabWidth: 4,
    trailingComma: 'es5',
    useTabs: false,
};

export default config;
