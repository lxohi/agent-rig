import React from 'react';
import { render, Text, Box } from 'ink';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  limaCreate,
  limaStart,
  limaStop,
  limaDelete,
  getTemplateVMName,
  buildLimaConfig,
} from '../lib/lima.js';
import { loadConfig } from '../lib/config.js';
import { TaskList, type Task } from '../components/TaskList.js';
import { StatusLine } from '../components/StatusLine.js';
import { stringify as stringifyYaml } from 'yaml';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

function CoreBuildUI({ tasks, error }: { tasks: Task[]; error?: string }) {
  return (
    <Box flexDirection="column">
      <TaskList tasks={tasks} />
      {error && <StatusLine status="error" message={error} />}
    </Box>
  );
}

export async function coreBuildCommand(options: { force?: boolean }): Promise<void> {
  const vmName = getTemplateVMName('');
  const config = await loadConfig();

  // Check if core template already exists
  if (!options.force) {
    try {
      // Check if VM exists by trying to get its status
      const { execa } = await import('execa');
      const { stdout } = await execa('limactl', ['list', '--json']);
      const vms = JSON.parse(stdout);
      if (vms.some((vm: { name: string }) => vm.name === vmName)) {
        render(
          <StatusLine
            status="info"
            message={`Core template already exists. Use --force to rebuild.`}
          />
        );
        return;
      }
    } catch {
      // VM doesn't exist, continue
    }
  }

  const tasks: Task[] = [
    { label: 'Creating Lima VM', status: 'pending' },
    { label: 'Running provisioning script', status: 'pending' },
    { label: 'Stopping VM for template', status: 'pending' },
  ];

  let currentTask = 0;
  const updateTask = (status: Task['status']) => {
    tasks[currentTask].status = status;
  };

  const { rerender, unmount } = render(<CoreBuildUI tasks={tasks} />);

  try {
    // Delete existing if force
    if (options.force) {
      try {
        await limaDelete(vmName);
      } catch {
        // Ignore if doesn't exist
      }
    }

    // Step 1: Create Lima VM
    updateTask('running');
    rerender(<CoreBuildUI tasks={tasks} />);

    const provisionScript = await readFile(
      join(__dirname, '..', 'assets', 'provision.sh'),
      'utf-8'
    );

    const limaConfig = buildLimaConfig({
      name: vmName,
      cpus: config.vm.cpus,
      memory: config.vm.memory,
      disk: config.vm.disk,
      provisionScript,
    });

    // Write lima config to temp file
    const configPath = join(tmpdir(), `${vmName}.yaml`);
    await writeFile(configPath, stringifyYaml(limaConfig));

    await limaCreate(vmName, configPath);
    updateTask('completed');
    currentTask++;

    // Step 2: Start and provision
    updateTask('running');
    rerender(<CoreBuildUI tasks={tasks} />);
    await limaStart(vmName);
    updateTask('completed');
    currentTask++;

    // Step 3: Stop for template
    updateTask('running');
    rerender(<CoreBuildUI tasks={tasks} />);
    await limaStop(vmName);
    updateTask('completed');

    rerender(<CoreBuildUI tasks={tasks} />);
    unmount();
    render(<StatusLine status="success" message="Core template built successfully" />);
  } catch (error) {
    updateTask('failed');
    rerender(<CoreBuildUI tasks={tasks} error={String(error)} />);
    unmount();
    process.exit(1);
  }
}
