import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BASH_COMPLETION = `
_arig_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "\${prev}" in
    arig)
      COMPREPLY=($(compgen -W "create list info start stop destroy attach ssh exec core template preset completions" -- "\${cur}"))
      return 0
      ;;
    start|stop|destroy|attach|ssh|exec|info)
      local sandboxes=$(arig list 2>/dev/null | tail -n +2 | awk '{print $1}')
      COMPREPLY=($(compgen -W "\${sandboxes}" -- "\${cur}"))
      return 0
      ;;
    --preset)
      local presets=$(arig preset list 2>/dev/null | tail -n +2 | awk '{print $1}')
      COMPREPLY=($(compgen -W "\${presets}" -- "\${cur}"))
      return 0
      ;;
    core)
      COMPREPLY=($(compgen -W "build" -- "\${cur}"))
      return 0
      ;;
    template)
      COMPREPLY=($(compgen -W "list prune" -- "\${cur}"))
      return 0
      ;;
    preset)
      COMPREPLY=($(compgen -W "list create delete" -- "\${cur}"))
      return 0
      ;;
    completions)
      COMPREPLY=($(compgen -W "install bash zsh" -- "\${cur}"))
      return 0
      ;;
  esac
}
complete -F _arig_completions arig
`;

const ZSH_COMPLETION = `
#compdef arig

_arig() {
  local -a commands sandboxes presets

  commands=(
    'create:Create a new sandbox'
    'list:List all sandboxes'
    'info:Show sandbox info'
    'start:Start a sandbox'
    'stop:Stop a sandbox'
    'destroy:Delete a sandbox'
    'attach:Attach to Claude session'
    'ssh:SSH into sandbox'
    'exec:Execute command'
    'core:Core template management'
    'template:Template management'
    'preset:Preset management'
    'completions:Shell completions'
  )

  _arguments -C \\
    '1: :->command' \\
    '*: :->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case $words[2] in
        start|stop|destroy|attach|ssh|exec|info)
          sandboxes=(\${(f)"$(arig list 2>/dev/null | tail -n +2 | awk '{print $1}')"})
          _describe 'sandbox' sandboxes
          ;;
        create)
          _arguments \\
            '--repo[Git repository URL]:url:' \\
            '--preset[Use preset]:preset:->presets' \\
            '--packages[Packages]:packages:' \\
            '--cpus[CPU cores]:cpus:' \\
            '--memory[Memory]:memory:' \\
            '--disk[Disk size]:disk:'
          ;;
      esac
      ;;
  esac
}

_arig
`;

export async function completionsBashCommand(): Promise<void> {
  console.log(BASH_COMPLETION);
}

export async function completionsZshCommand(): Promise<void> {
  console.log(ZSH_COMPLETION);
}

export async function completionsInstallCommand(): Promise<void> {
  const shell = process.env.SHELL || '/bin/bash';

  if (shell.includes('zsh')) {
    const completionDir = join(homedir(), '.zsh', 'completions');
    await mkdir(completionDir, { recursive: true });
    const completionFile = join(completionDir, '_arig');
    await writeFile(completionFile, ZSH_COMPLETION);
    console.log(`Installed zsh completions to ${completionFile}`);
    console.log('Add to your .zshrc: fpath=(~/.zsh/completions $fpath)');
  } else {
    const completionDir = join(homedir(), '.bash_completion.d');
    await mkdir(completionDir, { recursive: true });
    const completionFile = join(completionDir, 'arig');
    await writeFile(completionFile, BASH_COMPLETION);
    console.log(`Installed bash completions to ${completionFile}`);
    console.log('Add to your .bashrc: source ~/.bash_completion.d/arig');
  }
}
