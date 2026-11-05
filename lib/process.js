import { spawn } from 'node:child_process';

/**
 * 异步子进程 runner：收集 stdout/stderr，超时杀进程，绝不 reject。
 *
 * A2：长任务（deck 导出/渲染、probe CLI、capture 等）不再用 spawnSync 堵住宿主事件循环。
 * 取消语义：调用方没有中断句柄；超过 timeoutMs 会 kill 直接子进程并返回 timedOut=true。
 * Windows 下只杀直接子进程（不保证杀整棵进程树），真正的取消 API 留到后续加。
 *
 * @returns {Promise<{exitCode:number,stdout:string,stderr:string,spawnError:string|null,timedOut:boolean}>}
 */
export function runProcessAsync(command, args = [], options = {}) {
  const {
    cwd = process.cwd(),
    timeoutMs = 120_000,
    env = {},
    maxBuffer = 32 * 1024 * 1024,
  } = options;

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      });
    } catch (error) {
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: '',
        spawnError: String(error && error.message ? error.message : error),
        timedOut: false,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve({
        exitCode: typeof result.exitCode === 'number' ? result.exitCode : 1,
        stdout,
        stderr,
        spawnError: result.spawnError ?? null,
        timedOut,
      });
    };

    const append = (target, chunk) => {
      const next = target + chunk.toString('utf8');
      if (next.length > maxBuffer) {
        try {
          child.kill('SIGKILL');
        } catch {
          // 忽略 kill 失败；close/error 会收尾
        }
        return next.slice(-maxBuffer);
      }
      return next;
    };

    child.stdout?.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on('error', (error) => {
      finish({ exitCode: 1, spawnError: String(error && error.message ? error.message : error) });
    });
    child.on('close', (code) => {
      finish({ exitCode: typeof code === 'number' ? code : 1 });
    });

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGKILL');
        } catch {
          // 忽略 kill 失败；close/error 会收尾
        }
      }, timeoutMs);
      // 不阻止宿主退出
      timer.unref?.();
    }
  });
}
