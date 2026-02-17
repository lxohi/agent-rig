/**
 * Alias mappings: shorthand → canonical package name.
 * Users can specify either form; aliases are resolved before hashing.
 */
export const TOOL_ALIASES: Record<string, string> = {
  jvm17: 'java-17',
  jvm21: 'java-21',
  node22: 'node-22',
  node20: 'node-20',
  python312: 'python-312',
  py312: 'python-312',
};

/** All known canonical package names. */
export const KNOWN_PACKAGES = [
  'java-17',
  'java-21',
  'node-20',
  'node-22',
  'python-312',
  'uv',
];

/**
 * Resolve a package name, expanding aliases to canonical names.
 * Returns the canonical name, or the input unchanged if not an alias.
 */
export function resolveAlias(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

/**
 * Resolve a list of package names, expanding all aliases.
 * Deduplicates after resolution.
 */
export function resolveAliases(packages: string[]): string[] {
  const resolved = packages.map(resolveAlias);
  return [...new Set(resolved)];
}
