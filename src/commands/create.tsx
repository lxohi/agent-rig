import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { execa } from 'execa';
import { loadConfig } from '../lib/config.js';
import { loadPresets, getPreset } from '../lib/presets.js';
import {
  computePackageHash,
  loadTemplateIndex,
  saveTemplateIndex,
  findTemplateByHash,
  addTemplate,
  updateTemplateUsage,
} from '../lib/template.js';
import { saveSandboxConfig, sandboxExists } from '../lib/sandbox.js';
import {
  limaStart,
  limaStop,
  limaExec,
  limaClone,
  limaCreate,
  getSandboxVMName,
  getTemplateVMName,
  limaList,
  buildLimaConfig,
} from '../lib/lima.js';
import { PROVISION_SCRIPT } from '../lib/provision-script.js';
import { stringify as stringifyYaml } from 'yaml';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskList, type Task } from '../components/TaskList.js';
import { StatusLine } from '../components/StatusLine.js';
import type { SandboxConfig } from '../lib/types.js';

interface CreateOptions {
  repo?: string;
  gitUser?: string;
  gitToken?: string;
  gitName?: string;
  gitEmail?: string;
  baseUrl?: string;
  authToken?: string;
  preset?: string;
  packages?: string;
  savePreset?: string;
  cpus?: string;
  memory?: string;
  disk?: string;
}

async function detectGitRepo(): Promise<string | undefined> {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin']);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

async function detectGitConfig(): Promise<{ name?: string; email?: string }> {
  const result: { name?: string; email?: string } = {};
  try {
    const { stdout: name } = await execa('git', ['config', 'user.name']);
    result.name = name.trim();
  } catch {
    // Not configured
  }
  try {
    const { stdout: email } = await execa('git', ['config', 'user.email']);
    result.email = email.trim();
  } catch {
    // Not configured
  }
  return result;
}

// Convert package name from preset format (node-20) to mise format (node@20)
function toMisePackage(pkg: string): string {
  // Handle formats like: node-20, python-312, java-17
  const match = pkg.match(/^([a-z]+)-(\d+)$/);
  if (match) {
    return `${match[1]}@${match[2]}`;
  }
  // Return as-is for packages like 'uv' or already formatted 'node@20'
  return pkg;
}

function CreateUI({ tasks, error }: { tasks: Task[]; error?: string }) {
  return (
    <Box flexDirection="column">
      <TaskList tasks={tasks} />
      {error && <StatusLine status="error" message={error} />}
    </Box>
  );
}

interface ConfirmParams {
  name: string;
  repo: string;
  packages: string[];
  preset?: string;
  gitUser?: string;
  gitName?: string;
  gitEmail?: string;
  baseUrl?: string;
  authToken?: string;
  cpus: number;
  memory: string;
  disk: string;
}

function ConfirmUI({
  params,
  onConfirm,
  onCancel,
}: {
  params: ConfirmParams;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === 'y' || input === 'Y' || key.return) {
      onConfirm();
    } else if (input === 'n' || input === 'N' || key.escape) {
      onCancel();
      exit();
    }
  });

  const hasGitConfig = params.gitUser || params.gitName || params.gitEmail;
  const hasClaudeConfig = params.baseUrl || params.authToken;

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Create sandbox with the following configuration:</Text>

      {/* Basic Info */}
      <Box flexDirection="column">
        <Text bold color="cyan">  Sandbox</Text>
        <Text>    Name:      {params.name}</Text>
        <Text>    Repo:      {params.repo}</Text>
        {params.preset ? (
          <Text>    Preset:    {params.preset}</Text>
        ) : (
          <Text>    Packages:  {params.packages.length > 0 ? params.packages.join(', ') : '(none)'}</Text>
        )}
      </Box>

      {/* Git Config */}
      {hasGitConfig && (
        <Box flexDirection="column">
          <Text bold color="cyan">  Git</Text>
          {params.gitUser && <Text>    Auth:      {params.gitUser}</Text>}
          {params.gitName && <Text>    Name:      {params.gitName}</Text>}
          {params.gitEmail && <Text>    Email:     {params.gitEmail}</Text>}
        </Box>
      )}

      {/* Claude Config */}
      {hasClaudeConfig && (
        <Box flexDirection="column">
          <Text bold color="cyan">  Claude</Text>
          {params.baseUrl && <Text>    Base URL:  {params.baseUrl}</Text>}
          {params.authToken && <Text>    Token:     ********</Text>}
        </Box>
      )}

      {/* VM Config */}
      <Box flexDirection="column">
        <Text bold color="cyan">  VM Resources</Text>
        <Text>    CPUs:      {params.cpus}</Text>
        <Text>    Memory:    {params.memory}</Text>
        <Text>    Disk:      {params.disk}</Text>
      </Box>

      <Text>
        <Text dimColor>Press</Text> <Text color="green">Y</Text> <Text dimColor>to continue,</Text>{' '}
        <Text color="red">N</Text> <Text dimColor>to cancel</Text>
      </Text>
    </Box>
  );
}

async function waitForConfirmation(params: ConfirmParams): Promise<boolean> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <ConfirmUI
        params={params}
        onConfirm={() => {
          unmount();
          resolve(true);
        }}
        onCancel={() => {
          unmount();
          resolve(false);
        }}
      />
    );
  });
}

export async function createCommand(
  name: string,
  options: CreateOptions
): Promise<void> {
  // Check if sandbox already exists
  if (await sandboxExists(name)) {
    render(
      <StatusLine status="error" message={`Sandbox "${name}" already exists`} />
    );
    process.exit(1);
  }

  const config = await loadConfig();
  const presets = await loadPresets();

  // Determine packages
  let packages: string[] = [];
  if (options.preset) {
    const presetPackages = getPreset(presets, options.preset);
    if (!presetPackages) {
      render(
        <StatusLine status="error" message={`Preset "${options.preset}" not found`} />
      );
      process.exit(1);
    }
    packages = presetPackages;
  } else if (options.packages) {
    packages = options.packages.split(',').map((p) => p.trim());
  }

  // Determine repo
  const repo = options.repo || (await detectGitRepo());
  if (!repo) {
    render(
      <StatusLine
        status="error"
        message="No repository specified and not in a git directory. Use --repo to specify."
      />
    );
    process.exit(1);
  }

  // Auto-detect git config
  const detectedGit = await detectGitConfig();
  const gitName = options.gitName || detectedGit.name;
  const gitEmail = options.gitEmail || detectedGit.email;

  // Auto-detect Claude config from environment
  const baseUrl = options.baseUrl || process.env.ANTHROPIC_BASE_URL;
  const authToken = options.authToken || process.env.ANTHROPIC_AUTH_TOKEN;

  // Resolve VM configuration
  const vmCpus = options.cpus ? parseInt(options.cpus) : config.vm.cpus;
  const vmMemory = options.memory || config.vm.memory;
  const vmDisk = options.disk || config.vm.disk;

  // Confirm parameters before proceeding
  const confirmed = await waitForConfirmation({
    name,
    repo,
    packages,
    preset: options.preset,
    gitUser: options.gitUser,
    gitName,
    gitEmail,
    baseUrl,
    authToken,
    cpus: vmCpus,
    memory: vmMemory,
    disk: vmDisk,
  });

  if (!confirmed) {
    render(<StatusLine status="info" message="Cancelled" />);
    process.exit(0);
  }

  const tasks: Task[] = [
    { label: 'Preparing core template', status: 'pending' },
    { label: 'Preparing package template', status: 'pending' },
    { label: 'Creating sandbox VM', status: 'pending' },
    { label: 'Configuring sandbox', status: 'pending' },
    { label: 'Cloning repository', status: 'pending' },
    { label: 'Starting Claude Code', status: 'pending' },
  ];

  let currentTask = 0;
  const updateTask = (status: Task['status']) => {
    tasks[currentTask].status = status;
  };
  const nextTask = () => {
    updateTask('completed');
    currentTask++;
    if (currentTask < tasks.length) {
      updateTask('running');
    }
  };

  const { rerender, unmount } = render(<CreateUI tasks={tasks} />);

  try {
    // Step 1: Prepare core template (auto-build if missing)
    updateTask('running');
    rerender(<CreateUI tasks={tasks} />);

    const vms = await limaList();
    const coreVMName = getTemplateVMName('');
    if (!vms.some((vm) => vm.name === coreVMName)) {
      // Auto-build core template
      const limaConfig = buildLimaConfig({
        name: coreVMName,
        cpus: config.vm.cpus,
        memory: config.vm.memory,
        disk: config.vm.disk,
        provisionScript: PROVISION_SCRIPT,
      });

      // Write lima config to temp file
      const configPath = join(tmpdir(), `${coreVMName}.yaml`);
      await writeFile(configPath, stringifyYaml(limaConfig));

      await limaCreate(coreVMName, configPath);
      await limaStart(coreVMName);
      await limaStop(coreVMName);
    }
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Step 2: Prepare template (find or create)
    const packageHash = computePackageHash(packages);
    let templateIndex = await loadTemplateIndex();
    let templateVMName: string;

    if (packages.length === 0) {
      // Use core template directly
      templateVMName = coreVMName;
    } else {
      const existingTemplate = findTemplateByHash(templateIndex, packageHash);
      if (existingTemplate) {
        templateVMName = getTemplateVMName(packageHash);
        templateIndex = updateTemplateUsage(templateIndex, packageHash);
        await saveTemplateIndex(templateIndex);
      } else {
        // Create new template from core
        templateVMName = getTemplateVMName(packageHash);
        // Clone core and install packages
        await limaClone(coreVMName, templateVMName);
        await limaStart(templateVMName);

        // Install packages via mise
        for (const pkg of packages) {
          const misePackage = toMisePackage(pkg);
          await limaExec(templateVMName, [
            'sudo',
            '-u',
            'agent_dev',
            'bash',
            '-c',
            `source ~/.bashrc && ~/.local/bin/mise use --global ${misePackage}`,
          ]);
        }

        await limaStop(templateVMName);

        // Save to index
        templateIndex = addTemplate(templateIndex, {
          name: `template-${packageHash}`,
          hash: packageHash,
          packages,
          created: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          usageCount: 1,
        });
        await saveTemplateIndex(templateIndex);
      }
    }
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Step 3: Create sandbox VM from template
    const sandboxVMName = getSandboxVMName(name);
    await limaClone(templateVMName, sandboxVMName);
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Step 4: Configure sandbox
    await limaStart(sandboxVMName);

    // Configure git credentials (askpass script)
    if (options.gitUser && options.gitToken) {
      await limaExec(sandboxVMName, [
        'sudo',
        'bash',
        '-c',
        `cat > /home/agent_dev/bin/git-askpass.sh << 'ASKPASS'
#!/bin/bash
case "$1" in
    *Username*) echo "${options.gitUser}" ;;
    *Password*) echo "${options.gitToken}" ;;
esac
ASKPASS
chmod 755 /home/agent_dev/bin/git-askpass.sh
chown agent_dev:agent_dev /home/agent_dev/bin/git-askpass.sh`,
      ]);

      // Configure git environment
      await limaExec(sandboxVMName, [
        'sudo',
        'bash',
        '-c',
        `cat > /home/agent_dev/.bashrc.d/git.sh << 'GITENV'
export GIT_ASKPASS=$HOME/bin/git-askpass.sh
export GIT_TERMINAL_PROMPT=0
GITENV
chown agent_dev:agent_dev /home/agent_dev/.bashrc.d/git.sh`,
      ]);
    }

    // Configure git author
    if (gitName) {
      await limaExec(sandboxVMName, [
        'sudo',
        '-u',
        'agent_dev',
        'git',
        'config',
        '--global',
        'user.name',
        gitName,
      ]);
    }
    if (gitEmail) {
      await limaExec(sandboxVMName, [
        'sudo',
        '-u',
        'agent_dev',
        'git',
        'config',
        '--global',
        'user.email',
        gitEmail,
      ]);
    }

    // Configure Claude environment
    if (baseUrl || authToken) {
      const claudeEnv = [
        'export ANTHROPIC_API_KEY=""',
        baseUrl ? `export ANTHROPIC_BASE_URL="${baseUrl}"` : '',
        authToken ? `export ANTHROPIC_AUTH_TOKEN="${authToken}"` : '',
      ].filter(Boolean).join('\n');

      await limaExec(sandboxVMName, [
        'sudo',
        'bash',
        '-c',
        `cat > /home/agent_dev/.bashrc.d/claude.sh << 'CLAUDEENV'
${claudeEnv}
CLAUDEENV
chown agent_dev:agent_dev /home/agent_dev/.bashrc.d/claude.sh`,
      ]);
    }
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Step 5: Clone repository
    const cloneEnv = options.gitUser && options.gitToken
      ? 'export GIT_ASKPASS=$HOME/bin/git-askpass.sh; export GIT_TERMINAL_PROMPT=0; '
      : '';
    await limaExec(sandboxVMName, [
      'sudo',
      '-u',
      'agent_dev',
      'bash',
      '-c',
      `${cloneEnv}cd ~/workspace && git clone ${repo} .`,
    ]);
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Step 6: Start Claude Code
    await limaExec(sandboxVMName, [
      'sudo',
      '-u',
      'agent_dev',
      '/home/agent_dev/bin/start-claude.sh',
    ]);
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Save as new preset if requested
    if (options.savePreset && packages.length > 0) {
      const { presetCreateCommand } = await import('./preset.js');
      await presetCreateCommand(options.savePreset, packages.join(','));
    }

    // Save sandbox config
    const sandboxConfig: SandboxConfig = {
      name,
      repo,
      branch: 'main',
      packages,
      preset: options.preset,
      vm: {
        cpus: vmCpus,
        memory: vmMemory,
        disk: vmDisk,
      },
      git: {
        user: options.gitUser,
        token: options.gitToken ? '***' : undefined, // Don't store actual token
        name: gitName,
        email: gitEmail,
      },
      claude: {
        baseUrl,
        authToken: authToken ? '***' : undefined, // Don't store actual token
      },
      created: new Date().toISOString(),
    };
    await saveSandboxConfig(sandboxConfig);

    unmount();
    render(
      <StatusLine status="success" message={`Created sandbox "${name}"`} />
    );
  } catch (error) {
    updateTask('failed');
    rerender(<CreateUI tasks={tasks} error={String(error)} />);
    unmount();
    process.exit(1);
  }
}
