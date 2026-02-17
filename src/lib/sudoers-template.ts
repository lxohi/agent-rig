// Embedded sudoers drop-in template for binary distribution.
// Installed to /etc/sudoers.d/arigd-root-helper by `arig setup`.
//
// NOTE: This is embedded as a TypeScript string constant because the
// project is distributed as a compiled Bun binary (see CLAUDE.md).

export const SUDOERS_TEMPLATE = String.raw`# /etc/sudoers.d/arigd-root-helper
# Managed by arig setup — do not edit manually.
#
# Allows members of the "arig" group to invoke the root helper binary
# with only the whitelisted subcommands and only for sandbox usernames
# matching the arig_sb_* prefix.

%arig ALL=(root) NOPASSWD: /usr/local/libexec/arigd-root-helper create-user arig_sb_*
%arig ALL=(root) NOPASSWD: /usr/local/libexec/arigd-root-helper delete-user arig_sb_*
%arig ALL=(root) NOPASSWD: /usr/local/libexec/arigd-root-helper ensure-slice arig_sb_*
%arig ALL=(root) NOPASSWD: /usr/local/libexec/arigd-root-helper cleanup-resources arig_sb_*
`;

/** Path where the root helper binary is installed. */
export const ROOT_HELPER_PATH = '/usr/local/libexec/arigd-root-helper';

/** Path where the sudoers drop-in is installed. */
export const SUDOERS_DROP_IN_PATH = '/etc/sudoers.d/arigd-root-helper';

/** System group that is granted sudo access to the root helper. */
export const ARIG_GROUP = 'arig';
