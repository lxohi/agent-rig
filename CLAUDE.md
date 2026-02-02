# Project Guidelines

## Git Commit Rules

- Git commit messages must NOT contain any references to Claude, Claude Code, Anthropic, or "Co-Authored-By" lines mentioning coding agents
- Keep commit messages clean and focused on the changes themselves

## Binary Distribution Rules

This project is distributed as a compiled Bun binary. Asset files cannot be read from the filesystem at runtime in compiled binaries.

**When adding new asset files (scripts, templates, etc.):**
1. Do NOT use `readFile()` with `__dirname` or `import.meta.url` to load assets
2. Instead, embed the content as a TypeScript string constant in `src/lib/`
3. Example: `src/assets/provision.sh` is embedded in `src/lib/provision-script.ts`

**Pattern to follow:**
```typescript
// src/lib/my-asset.ts
export const MY_ASSET_CONTENT = `
... file content here ...
`;
```

Then import and use the constant instead of reading from disk.
