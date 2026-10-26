#!/usr/bin/env node
import { runCli, runNew } from '../cli/index.js';

interface ParsedArgs {
  command: 'edit' | 'new';
  root?: string;
  port?: number;
  name?: string;
  title?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const first = argv[0];
  const command: ParsedArgs['command'] = first === 'new' ? 'new' : 'edit';
  const rest = command === 'new' ? argv.slice(1) : argv;
  const options: ParsedArgs = { command };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--root' && rest[i + 1]) {
      options.root = rest[i + 1];
      i += 1;
    } else if (arg === '--port' && rest[i + 1]) {
      options.port = Number(rest[i + 1]);
      i += 1;
    } else if (arg === '--title' && rest[i + 1]) {
      options.title = rest[i + 1];
      i += 1;
    } else if (!arg.startsWith('-') && !options.name) {
      // `jiesu new my-page`：第一个位置参数就是项目名
      options.name = arg;
    }
  }
  return options;
}

const args = parseArgs(process.argv.slice(2));

if (args.command === 'new') {
  const result = runNew({ cwd: process.cwd(), name: args.name, title: args.title });
  if (!result.ok) process.exitCode = 1;
} else {
  void runCli({ root: args.root, port: args.port });
}
