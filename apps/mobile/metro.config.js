// Metro config: lets the app import @bb/core from ../../packages/core (PLAN.md D13).
// No root npm workspace, so the desktop app's package.json stays untouched.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const coreRoot = path.resolve(projectRoot, '../../packages/core');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), coreRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(coreRoot, 'node_modules'),
];

module.exports = config;
