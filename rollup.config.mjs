import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import copy from 'rollup-plugin-copy';

export default {
	input: 'src/extension.ts',
	output: {
		file: 'dist/extension.js',
		format: 'cjs',
		sourcemap: true,
		exports: 'named',
		// Ensure proper CommonJS interop
		interop: 'auto',
	},
	external: [
		// VS Code API is provided by the runtime
		'vscode',
		// Node.js built-ins
		'path',
		'fs',
		'os',
		'crypto',
		'util',
		'events',
		'stream',
		'http',
		'https',
		'url',
		'net',
		'tls',
		'zlib',
		'buffer',
		'child_process',
		'worker_threads',
		'assert',
		'querystring',
		'string_decoder',
		'punycode',
		// Dependencies that should remain external
		'@kusto/language-service-next',
		'@azure/identity',
		'@azure/identity-vscode',
		'azure-kusto-data',
		'@vscode/observables',
		'ws',
		'devtools-protocol',
		// Hot reload - only used in dev, eliminated in prod
		'@hediet/node-reload',
		'@hediet/node-reload/node',
	],
	plugins: [
		replace({
			preventAssignment: true,
			values: {
				'process.env.KUSTO_HOT_RELOAD': JSON.stringify('false'),
			},
		}),
		resolve({
			preferBuiltins: true,
			extensions: ['.ts', '.js'],
		}),
		commonjs(),
		typescript({
			tsconfig: './tsconfig.json',
			compilerOptions: {
				// Override for bundling
				module: 'ESNext',
				declaration: false,
				declarationMap: false,
			},
			exclude: ['**/*.test.ts', '**/*.test.tsx'],
		}),
		copy({
			targets: [
				// Webview is built separately by Vite, no copy needed
				// syntaxes and other static files are referenced from root
			],
			hook: 'writeBundle',
		}),
	],
	onwarn(warning, warn) {
		// Suppress "this is undefined" warnings from some dependencies
		if (warning.code === 'THIS_IS_UNDEFINED') return;
		// Suppress circular dependency warnings from known packages
		if (warning.code === 'CIRCULAR_DEPENDENCY') return;
		warn(warning);
	},
};
