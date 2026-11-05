import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * 会话路径牢笼：所有“用户数据路径”必须落在会话工作目录内。
 *
 * 允许的情况：
 *   - 相对路径：按会话 cwd 解析后落在根内；
 *   - 绝对路径：解析后仍在根内；
 *   - allowUrl：http(s) URL（只有 design_capture 的 target 需要）。
 *
 * 不做 realpath 解析（避免目标不存在时误判）；符号链接越界属于已知边角，后续需要再收紧。
 */
export function normalizeRoot(root) {
  return resolve(typeof root === 'string' && root !== '' ? root : process.cwd());
}

export function isWithinRoot(root, target) {
  if (typeof root !== 'string' || typeof target !== 'string') return false;
  const base = normalizeRoot(root);
  const path = isAbsolute(target) ? resolve(target) : resolve(base, target);
  const rel = relative(base, path);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

export function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

/**
 * 校验一个用户数据路径。
 * @returns {{ok:true,path:string,url?:true,root:string}|{ok:false,error:string}}
 */
export function guardWorkspacePath(root, value, { label = '路径', allowUrl = false } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, error: `缺少${label}：需要文件或目录路径。` };
  }
  const trimmed = value.trim();
  if (isHttpUrl(trimmed)) {
    if (allowUrl) return { ok: true, path: trimmed, url: true, root: normalizeRoot(root) };
    return { ok: false, error: `路径越界：${label} 只接受会话工作目录内的本地路径，不接受 URL：${trimmed}。` };
  }
  const base = normalizeRoot(root);
  const target = isAbsolute(trimmed) ? resolve(trimmed) : resolve(base, trimmed);
  if (!isWithinRoot(base, target)) {
    return {
      ok: false,
      error: `路径越界：${label} 必须位于会话工作目录（${base}）内，收到：${trimmed}。`,
    };
  }
  return { ok: true, path: target, root: base };
}

/** 允许选项缺失；存在时按牢笼校验。 */
export function guardOptionalWorkspacePath(root, value, options = {}) {
  if (typeof value !== 'string' || value.trim() === '') return { ok: true, path: null };
  return guardWorkspacePath(root, value, options);
}

const PROBE_PATH_FLAGS = new Set([
  '--from-run',
  '--run',
  '--answer',
  '--context-file',
  '--out',
  '--ledger',
  '--from',
]);

function isFlag(value) {
  return typeof value === 'string' && value.startsWith('--');
}

/**
 * 校验 probe_measure 的 args 数组里所有已知路径 flag 的值。
 * 支持 `--flag value` 与 `--flag=value` 两种写法；未知 flag 原样放行（由 CLI 校验）。
 * @returns {{ok:true}|{ok:false,error:string}}
 */
export function guardProbeArgs(root, args) {
  if (!Array.isArray(args)) return { ok: true };
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (typeof item !== 'string') continue;
    const eq = item.indexOf('=');
    const flag = eq > 0 ? item.slice(0, eq) : item;
    if (!PROBE_PATH_FLAGS.has(flag)) continue;
    const value = eq > 0 ? item.slice(eq + 1) : args[index + 1];
    if (eq < 0) index += 1;
    if (typeof value !== 'string' || value === '' || isFlag(value)) continue;
    const guard = guardWorkspacePath(root, value, { label: flag });
    if (!guard.ok) return guard;
  }
  return { ok: true };
}
