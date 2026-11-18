// @bb/core must run in Hermes. Node built-ins and Node globals are banned in src/ (PLAN.md D10).
// Pure-JS dependencies (zod, fflate, @noble/*) are allowed.
import tseslint from 'typescript-eslint';

const NODE_BUILTINS = [
  'assert', 'buffer', 'child_process', 'crypto', 'dns', 'events', 'fs', 'fs/promises', 'http', 'https',
  'net', 'os', 'path', 'process', 'stream', 'string_decoder', 'tls', 'url', 'util', 'worker_threads', 'zlib',
];

export default tseslint.config(
  { ignores: ['node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: NODE_BUILTINS.map((name) => ({ name, message: 'Node built-ins are not available in Hermes. Use the injected Platform adapter.' })),
        patterns: [{ group: ['node:*'], message: 'Node built-ins are not available in Hermes. Use the injected Platform adapter.' },
                   { group: ['react-native', 'react-native/*', 'expo', 'expo-*'], message: '@bb/core must not depend on React Native or Expo.' }],
      }],
      'no-restricted-globals': ['error',
        { name: 'Buffer', message: 'Use Uint8Array + Platform.bytes.' },
        { name: 'process', message: 'No process in Hermes; pass config explicitly.' },
        { name: '__dirname', message: 'Not available in Hermes.' },
        { name: 'require', message: 'Use ES imports.' },
      ],
    },
  },
);
