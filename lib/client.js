// dsh-design-kit client: 在对话里把 probe_shortlist_preview 的候选渲染成三栏 iframe 预览。
// 选择后把结构化动作作为一条普通用户消息发回会话，agent 再调用 probe_shortlist_ui_action 落账。
// 运行于 DSH Web 客户端；ModuleLoader 注册格式与官方 client 插件一致。
(function () {
  window.__ModuleLoader__.load({
    id: 'dsh-design-kit',
    factory: (require) => {
      const React = require('react');
      const h = React.createElement;

      const CSS = `
.dsk-card{--dsk-line:var(--dsw-alias-border-l2,#d8d8d8);--dsk-bg:var(--dsw-alias-bg-base,#fff);--dsk-ink:var(--dsw-alias-label-primary,#1a1a1a);--dsk-muted:var(--dsw-alias-label-tertiary,#777);--dsk-accent:var(--dsw-alias-state-business-primary,#4d6bfe);display:flex;flex-direction:column;gap:10px;border:1px solid var(--dsk-line);border-radius:12px;background:var(--dsk-bg);color:var(--dsk-ink);padding:12px;margin:6px 0;max-width:100%;box-sizing:border-box}
.dsk-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.dsk-head strong{font-size:13px}
.dsk-meta{font-size:12px;color:var(--dsk-muted)}
.dsk-hint{font-size:12px;color:var(--dsk-muted);margin:0;line-height:18px}
.dsk-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
@media(max-width:760px){.dsk-grid{grid-template-columns:1fr;max-width:380px}}
.dsk-col{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsk-frame{border:1px solid var(--dsk-line);border-radius:8px;overflow:hidden;background:#f4f2ec;aspect-ratio:3/4;width:100%}
.dsk-frame iframe{width:100%;height:100%;border:0;display:block;background:#fff}
.dsk-frame-empty{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:12px;color:var(--dsk-muted);padding:12px;text-align:center;box-sizing:border-box}
.dsk-row{display:flex;align-items:center;gap:8px;min-height:26px}
.dsk-badge{font-family:var(--ds-font-family-code,monospace);font-size:12px;color:var(--dsk-muted);flex:none}
.dsk-status{font-size:11px;color:var(--dsk-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsk-actions{display:flex;gap:6px;flex-wrap:wrap}
.dsk-btn{font:inherit;font-size:12px;line-height:20px;padding:2px 9px;border-radius:999px;border:1px solid var(--dsk-line);background:transparent;color:var(--dsk-ink);cursor:pointer}
.dsk-btn:hover{border-color:var(--dsk-accent)}
.dsk-btn[data-active=true]{border-color:var(--dsk-accent);color:var(--dsk-accent);background:color-mix(in srgb,var(--dsk-accent) 8%,transparent)}
.dsk-btn:disabled{opacity:.45;cursor:not-allowed}
.dsk-btn-primary{border-color:var(--dsk-accent);color:var(--dsk-accent)}
.dsk-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}
.dsk-chip{font:inherit;font-size:11px;line-height:18px;padding:1px 7px;border-radius:999px;border:1px dashed var(--dsk-line);background:transparent;color:var(--dsk-muted);cursor:pointer}
.dsk-chip[data-active=true]{border-style:solid;border-color:var(--dsk-accent);color:var(--dsk-accent)}
.dsk-chip:hover{border-color:var(--dsk-accent)}
.dsk-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid var(--dsk-line);padding-top:8px}
.dsk-submit{font:inherit;font-size:12px;line-height:22px;padding:3px 12px;border-radius:999px;border:1px solid var(--dsk-accent);background:var(--dsk-accent);color:#fff;cursor:pointer}
.dsk-submit:disabled{opacity:.4;cursor:not-allowed}
.dsk-error{color:var(--dsw-alias-state-error-primary,#b42318);font-size:12px}
.dsk-ok{color:var(--dsw-alias-state-success-primary,#067647);font-size:12px}
`.trim();

      function reasonButton(label, active, onClick, key) {
        return h(
          'button',
          { key, type: 'button', className: 'dsk-chip', 'data-active': active ? 'true' : 'false', onClick },
          label,
        );
      }

      function parseResult(block) {
        if (!block || typeof block !== 'object' || !Array.isArray(block.content)) return null;
        const part = block.content.find((item) => item && item.type === 'text' && typeof item.text === 'string');
        if (!part) return null;
        try {
          return JSON.parse(part.text);
        } catch {
          return null;
        }
      }

      // B5：工具返回 gzip+base64，客户端解压再投 iframe；兼容旧的 raw html 字段。
      async function decodeCandidateHtml(candidate) {
        if (typeof candidate?.html === 'string') return candidate.html;
        if (candidate?.htmlEncoding !== 'gzip+base64' || typeof candidate.htmlGzip !== 'string') return '';
        if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持 DecompressionStream');
        const binary = atob(candidate.htmlGzip);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return await new Response(stream).text();
      }

      function ShortlistPreviewCard(props) {
        const data = parseResult(props.block);
        const [roundSel, setRoundSel] = React.useState({});
        const [finalSel, setFinalSel] = React.useState(null); // {kind:'candidate',pos} | {kind:'none'}
        const [rejectReasons, setRejectReasons] = React.useState({});
        const [busy, setBusy] = React.useState(false);
        const [sent, setSent] = React.useState(false);
        const [error, setError] = React.useState('');
        const [frames, setFrames] = React.useState({});
        const cardRef = React.useRef(null);
        const chips = data?.ok && Array.isArray(data.reasonChips) ? data.reasonChips : [];

        React.useEffect(() => {
          if (!data || data.ok !== true) return undefined;
          let active = true;
          (async () => {
            const decoded = {};
            for (const candidate of data.candidates ?? []) {
              try {
                decoded[candidate.pos] = await decodeCandidateHtml(candidate);
              } catch {
                decoded[candidate.pos] = '';
              }
            }
            if (active) setFrames(decoded);
          })();
          return () => {
            active = false;
          };
        }, [data]);

        // DSH 会把工具调用折进“过程/活动”组；卡片在里面但父组默认折叠。
        // 挂载后自动展开最近的过程组，并把卡片滚进视口。
        React.useEffect(() => {
          if (!data || data.ok !== true || typeof document === 'undefined') return undefined;
          const timer = setTimeout(() => {
            const root = cardRef.current;
            if (!root) return;
            let node = root.parentElement;
            while (node && node !== document.body) {
              const header = node.querySelector('button[data-process-activity][aria-expanded="false"]');
              if (header) {
                header.click();
                break;
              }
              node = node.parentElement;
            }
            setTimeout(() => {
              root.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 180);
          }, 300);
          return () => clearTimeout(timer);
        }, [data?.uiToken]);

        if (!data) {
          return h(
            'div',
            { className: 'dsk-card' },
            h('style', null, CSS),
            h('div', { className: 'dsk-hint' }, props.phase === 'running' || props.phase === 'preparing'
              ? '正在读取三个候选的预览…'
              : '这个卡片还没有可显示的预览数据。'),
          );
        }
        if (data.ok !== true) {
          return h(
            'div',
            { className: 'dsk-card' },
            h('style', null, CSS),
            h('div', { className: 'dsk-error' }, data.error || '预览数据无效。'),
          );
        }

        const letters = ['A', 'B', 'C'];
        const candidates = data.candidates ?? [];

        function pickRound(pos, action) {
          setRoundSel((prev) => {
            const next = { ...prev };
            if (action === 'defer') {
              for (const key of Object.keys(next)) if (next[key].action === 'defer') delete next[key];
            }
            next[pos] = { action, ...(action === 'eliminate' ? { reasonId: next[pos]?.reasonId } : {}) };
            return next;
          });
        }

        function setReason(pos, reasonId) {
          setRoundSel((prev) => ({ ...prev, [pos]: { action: 'eliminate', reasonId } }));
        }

        function roundValid() {
          return candidates.every((candidate) => {
            const item = roundSel[candidate.pos];
            return item && (item.action === 'defer' || (item.action === 'eliminate' && item.reasonId));
          });
        }

        function finalValid() {
          if (!finalSel) return false;
          if (finalSel.kind === 'candidate') return true;
          return Object.values(rejectReasons).some(Boolean);
        }

        async function send(payload) {
          if (typeof props.sendUserMessage !== 'function') {
            setError('宿主没有提供会话通道，无法把选择发回对话。');
            return;
          }
          setBusy(true);
          setError('');
          try {
            await props.sendUserMessage('[probe-shortlist-ui] ' + JSON.stringify(payload));
            setSent(true);
          } catch (err) {
            setError('发送失败：' + (err && err.message ? err.message : String(err)));
          } finally {
            setBusy(false);
          }
        }

        function submitRound() {
          const decisions = candidates
            .map((candidate) => {
              const item = roundSel[candidate.pos];
              if (!item) return null;
              return {
                pos: candidate.pos,
                action: item.action,
                ...(item.action === 'eliminate' ? { reasonId: item.reasonId } : {}),
              };
            })
            .filter(Boolean);
          void send({
            schema: 'shortlist-ui-action/1',
            kind: 'decide',
            run: data.run,
            round: data.round,
            decisions,
            uiToken: data.uiToken,
          });
        }

        function submitFinal() {
          const choice =
            finalSel.kind === 'candidate'
              ? { kind: 'candidate', pos: finalSel.pos }
              : { kind: 'none', reasonIds: Object.keys(rejectReasons).filter((id) => rejectReasons[id]) };
          void send({ schema: 'shortlist-ui-action/1', kind: 'final', run: data.run, choice, uiToken: data.uiToken });
        }

        const meta = data.mode === 'final'
          ? '终选 · 待定 ' + data.pendingCount + '/3'
          : '第 ' + data.round + ' 轮 · 待定 ' + data.pendingCount + '/3 · 已生成 ' + data.generated + '/12';

        return h(
          'section',
          { className: 'dsk-card', 'aria-label': '方向粗选三栏预览', ref: cardRef },
          h('style', null, CSS),
          h(
            'div',
            { className: 'dsk-head' },
            h('strong', null, data.mode === 'final' ? '方向终选' : '方向粗选'),
            h('span', { className: 'dsk-meta' }, data.relationLabel || ''),
            h('span', { className: 'dsk-meta' }, meta),
          ),
          h('p', { className: 'dsk-hint' }, data.hint || ''),
          h(
            'div',
            { className: 'dsk-grid' },
            candidates.slice(0, 3).map((candidate, index) => {
              const letter = letters[index] ?? String(index + 1);
              const sel = roundSel[candidate.pos];
              return h(
                'article',
                { className: 'dsk-col', key: candidate.pos },
                h(
                  'div',
                  { className: 'dsk-frame' },
                  // A12：sandbox="" = 静态预览、不执行脚本。需要交互请让用户走 round-1.html 旧流程。
                  frames[candidate.pos]
                    ? h('iframe', {
                        title: '候选 ' + letter,
                        srcDoc: frames[candidate.pos],
                        sandbox: '',
                        loading: 'lazy',
                      })
                    : h('div', { className: 'dsk-frame-empty' }, '预览解码中…'),
                ),
                h(
                  'div',
                  { className: 'dsk-row' },
                  h('span', { className: 'dsk-badge' }, '候选 ' + letter),
                  h(
                    'span',
                    { className: 'dsk-status' },
                    data.mode === 'final'
                      ? finalSel?.kind === 'candidate' && finalSel.pos === candidate.pos
                        ? '已选择'
                        : ''
                      : sel?.action === 'defer'
                        ? '待定'
                        : sel?.action === 'eliminate'
                          ? '删除'
                          : '',
                  ),
                ),
                data.mode === 'final'
                  ? h(
                      'div',
                      { className: 'dsk-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsk-btn dsk-btn-primary',
                          'data-active': finalSel?.kind === 'candidate' && finalSel.pos === candidate.pos ? 'true' : 'false',
                          disabled: busy || sent,
                          onClick: () => setFinalSel({ kind: 'candidate', pos: candidate.pos }),
                        },
                        '选它',
                      ),
                    )
                  : h(
                      'div',
                      { className: 'dsk-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsk-btn',
                          'data-active': sel?.action === 'eliminate' ? 'true' : 'false',
                          disabled: busy || sent,
                          onClick: () => pickRound(candidate.pos, 'eliminate'),
                        },
                        '删除',
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsk-btn',
                          'data-active': sel?.action === 'defer' ? 'true' : 'false',
                          disabled: busy || sent,
                          onClick: () => pickRound(candidate.pos, 'defer'),
                        },
                        '待定',
                      ),
                      sel?.action === 'eliminate'
                        ? h(
                            'div',
                            { className: 'dsk-chips' },
                            chips.map((chip) =>
                              reasonButton(chip.label, sel.reasonId === chip.id, () => setReason(candidate.pos, chip.id), chip.id),
                            ),
                          )
                        : null,
                    ),
              );
            }),
          ),
          data.mode === 'final'
            ? h(
                'div',
                { className: 'dsk-actions' },
                h(
                  'button',
                  { type: 'button', className: 'dsk-btn', 'data-active': finalSel?.kind === 'none' ? 'true' : 'false', disabled: busy || sent, onClick: () => setFinalSel({ kind: 'none' }) },
                  '都不行',
                ),
              )
            : null,
          data.mode === 'final'
            ? h(
                'div',
                { className: 'dsk-chips' },
                chips.map((chip) =>
                  reasonButton(chip.label, !!rejectReasons[chip.id], () => {
                    setFinalSel({ kind: 'none' });
                    setRejectReasons((prev) => ({ ...prev, [chip.id]: !prev[chip.id] }));
                  }, chip.id),
                ),
              )
            : null,
          h(
            'div',
            { className: 'dsk-foot' },
            sent
              ? h('span', { className: 'dsk-ok' }, '已发送到对话，等 agent 落账后继续。')
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsk-submit',
                    disabled: busy || (data.mode === 'final' ? !finalValid() : !roundValid()),
                    onClick: data.mode === 'final' ? submitFinal : submitRound,
                  },
                  busy ? '发送中…' : data.mode === 'final' ? '提交终选' : '提交本轮',
                ),
            h('span', { className: 'dsk-hint' }, data.mode === 'final' ? '三选一，或「都不行」并选理由' : '3 个都要有决策；待定全轮最多 1 个'),
          ),
          error ? h('div', { className: 'dsk-error' }, error) : null,
        );
      }

      function apply(ctx) {
        ctx.slots.inject('tool.call.toolview', () =>
          ctx.slots.register(
            {
              name: 'tool.call.toolview',
              key: 'probe_shortlist_preview',
              inject: (sessionId) => ({
                sendUserMessage: async (text) => {
                  const actx = ctx.sessions.scope(sessionId);
                  if (!actx) throw new Error('session scope unavailable');
                  const conversation = actx.get('conversation');
                  if (!conversation) throw new Error('conversation service unavailable');
                  await conversation.send(text);
                },
              }),
            },
            ShortlistPreviewCard,
          ),
        );
      }

      return { inject: ['slots', 'sessions'], apply, ShortlistPreviewCard };
    },
  });
})();
