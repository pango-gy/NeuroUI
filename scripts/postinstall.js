/**
 * Postinstall script for AionUi
 * Handles native module installation for different environments
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Fix web-tree-sitter WASM file naming issue
// aioncli-core expects tree-sitter.wasm but the package provides web-tree-sitter.wasm
function fixTreeSitterWasm() {
  try {
    const wasmDir = path.join(__dirname, '..', 'node_modules', 'web-tree-sitter');
    const source = path.join(wasmDir, 'web-tree-sitter.wasm');
    const target = path.join(wasmDir, 'tree-sitter.wasm');

    if (fs.existsSync(source) && !fs.existsSync(target)) {
      fs.symlinkSync('web-tree-sitter.wasm', target);
      console.log('Created symlink: tree-sitter.wasm -> web-tree-sitter.wasm');
    }
  } catch (e) {
    console.warn('Failed to create tree-sitter.wasm symlink:', e.message);
  }
}

function runPostInstall() {
  try {
    // Fix WASM file naming
    fixTreeSitterWasm();

    // Check if we're in a CI environment
    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    const electronVersion = require('../package.json').devDependencies.electron.replace(/^[~^]/, '');

    console.log(`Environment: CI=${isCI}, Electron=${electronVersion}`);

    if (isCI) {
      // In CI, skip rebuilding to use prebuilt binaries for better compatibility
      // 在 CI 中跳过重建，使用预编译的二进制文件以获得更好的兼容性
      console.log('CI environment detected, skipping rebuild to use prebuilt binaries');
      console.log('Native modules will be handled by electron-forge during packaging');
    } else {
      // In local environment, use electron-builder to install dependencies
      console.log('Local environment, installing app deps');
      execSync('npx electron-builder install-app-deps', {
        stdio: 'inherit',
        env: {
          ...process.env,
          npm_config_build_from_source: 'true'
        }
      });
    }
  } catch (e) {
    console.error('Postinstall failed:', e.message);
    // Don't exit with error code to avoid breaking installation
  }
}

// Only run if this script is executed directly
if (require.main === module) {
  runPostInstall();
}

module.exports = runPostInstall;