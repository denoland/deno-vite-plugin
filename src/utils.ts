import child_process from "node:child_process";

export async function execAsync(
  cmd: string,
  options: child_process.ExecOptions,
): Promise<{ stderr: string; stdout: string }> {
  return await new Promise((resolve, reject) =>
    child_process.exec(cmd, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    })
  );
}
