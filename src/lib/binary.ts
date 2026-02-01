import { stat, access, constants } from 'node:fs/promises';

export async function isValidBinary(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    if (stats.size === 0) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
