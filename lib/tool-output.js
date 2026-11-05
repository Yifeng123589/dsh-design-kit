/**
 * DSH 0.2.x 工具输出契约。
 *
 * 0.1.x 时代 ctx.tools.register() 只要求 { name, description, parameters, execute }；
 * 0.2.1-rc.5 的 ToolRuntime.register() 会校验 definition.output：
 *   output 必须带 schema（受支持的 JSON Schema 子集）与 render(args, value) 函数，
 * 否则抛 TypeError，插件里“注册失败只告警”的容错会把 8 个工具全部静默吞掉。
 *
 * 这里统一提供 output：
 *   - schema: {}  —— 允许任意 JSON 值。各工具返回值形状不同，且多为诊断信息，
 *                    用无约束 schema 避免输出校验因新增字段而误伤。
 *   - render      —— 把返回值转成一条 text content，进入会话记录供模型回看。
 *
 * @returns {import('./tool-output.js').ToolOutput} 工具定义里的 output 字段。
 */
export function jsonOutput() {
  return {
    schema: {},
    render: (_args, value) => {
      let text;
      try {
        text = JSON.stringify(value, null, 2);
      } catch {
        text = String(value);
      }
      return [{ type: 'text', text }];
    },
  };
}
