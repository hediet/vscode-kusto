#!/usr/bin/env node
/**
 * Build and package script for the Kusto VS Code extension.
 * 
 * This script:
 * 1. Builds the extension and webview
 * 2. Temporarily updates package.json main to point to dist/extension.js
 * 3. Creates the .vsix package (skipping prepublish since we already built)
 * 4. Restores the original package.json
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');

// Read original package.json
const originalContent = fs.readFileSync(packageJsonPath, 'utf8');
const pkg = JSON.parse(originalContent);
const originalMain = pkg.main;
const originalPrepublish = pkg.scripts['vscode:prepublish'];

try {
    console.log('📦 Building extension...');
    execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

    console.log('🔧 Updating package.json for packaging...');
    pkg.main = './dist/extension.js';
    // Remove prepublish since we already built
    delete pkg.scripts['vscode:prepublish'];
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, '\t') + '\n');

    console.log('📦 Creating VSIX package...');
    // Use --no-dependencies since Rollup already bundled our code
    // External deps will be resolved from node_modules at runtime
    execSync('vsce package --out extension.vsix --no-yarn --no-dependencies', { cwd: rootDir, stdio: 'inherit' });

    console.log('✅ Package created successfully: extension.vsix');
} catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
} finally {
    // Always restore original package.json
    console.log('🔄 Restoring package.json...');
    pkg.main = originalMain;
    pkg.scripts['vscode:prepublish'] = originalPrepublish;
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, '\t') + '\n');
}
