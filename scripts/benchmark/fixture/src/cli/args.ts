export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | true>;
}

/** Parses `command [positionals] [--flag value | --flag=value | --flag]`. */
export function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) {
      flags[arg.slice(2)] = rest[++i];
    } else {
      flags[arg.slice(2)] = true;
    }
  }
  return { command, positionals, flags };
}

export function intFlag(flags: ParsedArgs['flags'], name: string): number | undefined {
  const raw = flags[name];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (raw === true || !Number.isInteger(value)) {
    throw new Error(`--${name} must be an integer`);
  }
  return value;
}
