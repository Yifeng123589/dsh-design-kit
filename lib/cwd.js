/**
 * 解析工具执行时的“会话工作目录”。
 *
 * DSH 0.2.x 中，相对路径应当相对会话工作目录；它由 workingDirectory 服务按
 * Session 管理（`ctx.workingDirectory.get(exec.agent.session)`）。旧接口里的
 * `exec.cwd` 是宿主进程 cwd（桌面端引导目录 = profile 目录），直接使用会让
 * `demo/xxx.html` 这类相对路径解析到 `~/.dsh/profiles/desktop/demo/...`，
 * 报“路径不存在”。
 *
 * 解析顺序：workingDirectory 服务 → exec.cwd（旧宿主 / 单元测试）→ process.cwd()。
 *
 * @param {object | null} ctx 注册工具时的插件上下文。
 * @returns {(exec: object) => string} 执行期 cwd 解析器。
 */
export function createCwdResolver(ctx) {
  return function getCwd(exec) {
    const agent = exec?.agent;
    let service;
    try {
      // Cordis 只允许读取 inject 声明的服务；没有声明时会抛，这里退回旧路径逻辑。
      service = ctx?.workingDirectory;
    } catch {
      service = undefined;
    }
    if (service !== undefined && agent?.session !== undefined && typeof service.get === 'function') {
      try {
        const directory = service.get(agent.session);
        if (typeof directory === 'string' && directory !== '') return directory;
      } catch {
        // 服务不可用（例如测试替身）时退回 exec.cwd
      }
    }
    if (typeof exec?.cwd === 'string' && exec.cwd !== '') return exec.cwd;
    return process.cwd();
  };
}
