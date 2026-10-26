#!/usr/bin/env node
import { runCli } from '../cli/index.js';

function parseArgs(argv: string[]): { root?: string; port?: number } {
  const options: { root?: string; port?: number } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root' && argv[i + 1]) {
      options.root = argv[i + 1];
      i += 1;
    } else if (arg === '--port' && argv[i + 1]) {
      options.port = Number(argv[i + 1]);
      i += 1;
    }
  }
  return options;
}

void runCli(parseArgs(process.argv.slice(2)));
