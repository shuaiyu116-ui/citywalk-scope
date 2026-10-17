'use strict';

const fs = require('node:fs');

// Small local-development loader; platform environment variables take priority.
function loadLocalEnv(file, env = process.env) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(env, match[1])) continue;
    env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

module.exports = { loadLocalEnv };
