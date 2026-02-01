import React from 'react';
import { render, Box } from 'ink';
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
  limaExec,
  getSandboxVMName,
  getTemplateVMName,
  limaList,
} from '../lib/lima.js';
import { TaskList, type Task } from '../components/TaskList.js';
import { StatusLine } from '../components/StatusLine.js';
import type { SandboxConfig } from '../lib/types.js';

interface CreateOptions {
  repo?: string;
  gitUser?: string;
  gitToken?: string;
  preset?: string;
  packages?: string;
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

function CreateUI({ tasks, error }: { tasks: Task[]; error?: string }) {
  return (
    <Box flexDirection="column">
      <TaskList tasks={tasks} />
      {error && <StatusLine status="error" message={error} />}
    </Box>
  );
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

  const tasks: Task[] = [
    { label: 'Checking core template', status: 'pending' },
    { label: 'Preparing template', status: 'pending' },
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
    // Step 1: Check core template
    updateTask('running');
    rerender(<CreateUI tasks={tasks} />);

    const vms = await limaList();
    const coreVMName = getTemplateVMName('');
    if (!vms.some((vm) => vm.name === coreVMName)) {
      updateTask('failed');
      rerender(
        <CreateUI
          tasks={tasks}
          error="Core template not found. Run: arig core build"
        />
      );
      unmount();
      process.exit(1);
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
        await execa('limactl', ['copy', coreVMName, templateVMName]);
        await limaStart(templateVMName);

        // Install packages via mise
        for (const pkg of packages) {
          await limaExec(templateVMName, [
            'sudo',
            '-u',
            'agent_dev',
            'bash',
            '-c',
            `source ~/.bashrc && ~/.local/bin/mise use --global ${pkg}`,
          ]);
        }

        await execa('limactl', ['stop', templateVMName]);

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
    await execa('limactl', ['copy', templateVMName, sandboxVMName]);
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Step 4: Configure sandbox
    await limaStart(sandboxVMName);

    // Set environment variables
    if (options.gitUser && options.gitToken) {
      await limaExec(sandboxVMName, [
        'sudo',
        '-u',
        'agent_dev',
        'git',
        'config',
        '--global',
        'credential.helper',
        'store',
      ]);
    }
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Step 5: Clone repository
    await limaExec(sandboxVMName, [
      'sudo',
      '-u',
      'agent_dev',
      'bash',
      '-c',
      `cd ~/workspace && git clone ${repo} .`,
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

    // Save sandbox config
    const sandboxConfig: SandboxConfig = {
      name,
      repo,
      branch: 'main',
      packages,
      preset: options.preset,
      vm: {
        cpus: options.cpus ? parseInt(options.cpus) : config.vm.cpus,
        memory: options.memory || config.vm.memory,
        disk: options.disk || config.vm.disk,
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
