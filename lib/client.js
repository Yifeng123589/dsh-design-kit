// dsh-design-kit client: 在对话里把 probe_shortlist_preview 的候选渲染成三栏 iframe 预览。
// 选择后把结构化动作作为一条普通用户消息发回会话，agent 再调用 probe_shortlist_ui_action 落账。
// 运行于 DSH Web 客户端；ModuleLoader 注册格式与官方 client 插件一致。
(function () {
  window.__ModuleLoader__.load({
    id: 'dsh-design-kit',
    factory: (require) => {
      const React = require('react');
      const { createPortal } = require('react-dom');
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
.dsk-note{width:100%;box-sizing:border-box;font:inherit;font-size:12px;line-height:18px;padding:4px 8px;border-radius:6px;border:1px solid var(--dsk-line);background:transparent;color:var(--dsk-ink);margin-top:4px}
.dsk-note::placeholder{color:var(--dsk-muted)}
.dsk-note:focus{outline:none;border-color:var(--dsk-accent)}
.dsk-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid var(--dsk-line);padding-top:8px}
.dsk-submit{font:inherit;font-size:12px;line-height:22px;padding:3px 12px;border-radius:999px;border:1px solid var(--dsk-accent);background:var(--dsk-accent);color:#fff;cursor:pointer}
.dsk-submit:disabled{opacity:.4;cursor:not-allowed}
.dsk-error{color:var(--dsw-alias-state-error-primary,#b42318);font-size:12px}
.dsk-ok{color:var(--dsw-alias-state-success-primary,#067647);font-size:12px}
.dsk-launch{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--dsk-line);border-radius:10px;background:var(--dsk-bg);padding:10px 12px;margin:6px 0}
.dsk-launch strong{font-size:13px}
.dsk-launch .dsk-btn{flex:none}
.dsk-overlay{position:fixed;inset:0;z-index:1000;display:flex;justify-content:flex-end;background:#0006;padding:12px;box-sizing:border-box}
.dsk-wb{--dsk-line:var(--dsw-alias-border-l2,#d8d8d8);--dsk-bg:var(--dsw-alias-bg-base,#fff);--dsk-ink:var(--dsw-alias-label-primary,#1a1a1a);--dsk-muted:var(--dsw-alias-label-tertiary,#777);--dsk-accent:var(--dsw-alias-state-business-primary,#4d6bfe);width:min(960px,100%);height:100%;max-height:100dvh;display:flex;flex-direction:column;background:var(--dsk-bg);color:var(--dsk-ink);border:1px solid var(--dsk-line);border-radius:14px;box-shadow:0 18px 70px #0003;overflow:hidden}
.dsk-wb-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--dsk-line);flex:none}
.dsk-wb-title{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.dsk-wb-title strong{font-size:15px}
.dsk-wb-body{flex:1;min-height:0;overflow:auto;padding:14px 18px 18px}
.dsk-wb-body .dsk-card{border:0;background:transparent;margin:0;padding:0}
.dsk-wb-close{font:inherit;font-size:12px;line-height:22px;padding:2px 10px;border-radius:999px;border:1px solid var(--dsk-line);background:transparent;color:var(--dsk-ink);cursor:pointer}
.dsk-wb-close:hover{border-color:var(--dsk-accent)}
.dsk-tray{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsk-line);padding-top:8px}
.dsk-tray h3{font-size:12px;margin:0;font-weight:600}
.dsk-mini{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}
@media(max-width:760px){.dsk-overlay{padding:0}.dsk-wb{width:100%;border-radius:0;border:0}.dsk-wb-body{padding:10px 12px 14px}.dsk-launch{align-items:flex-start;flex-direction:column}}
`.trim();

      // 独立工作台状态：toolview 负责把 payload 投进来，shell.overlay 负责渲染。
      // 这样候选卡不再受“过程/活动”折叠组影响。流水线的滑动窗、喜欢和特征也画在这一层。
      const workbench = { open: false, data: null, send: null, listeners: new Set() };

      function workbenchSnapshot() {
        return { open: workbench.open, data: workbench.data, send: workbench.send };
      }

      function emitWorkbench() {
        for (const listener of workbench.listeners) listener();
      }

      function useWorkbench() {
        const [snapshot, setSnapshot] = React.useState(workbenchSnapshot);
        React.useEffect(() => {
          const listener = () => setSnapshot(workbenchSnapshot());
          workbench.listeners.add(listener);
          return () => workbench.listeners.delete(listener);
        }, []);
        return snapshot;
      }

      function openWorkbench(data, send) {
        if (!data || data.ok !== true) return;
        workbench.data = data;
        if (typeof send === 'function') workbench.send = send;
        workbench.open = true;
        emitWorkbench();
      }

      function closeWorkbench() {
        workbench.open = false;
        workbench.data = null;
        emitWorkbench();
      }

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

      function workbenchModeLabel(data) {
        if (!data) return '';
        if (data.mode === 'final') return '方向终选';
        if (data.mode === 'pool') {
          const size = data.poolSize ?? (Array.isArray(data.pool) ? data.pool.length : 0);
          return '粗选流水线 · 窗 ' + (data.windowSize || 3) + ' / 池 ' + size;
        }
        return '第 ' + data.round + ' 轮 · 三方向粗选';
      }

      const TRAIT_KINDS = [
        { id: 'typography', label: '字体' },
        { id: 'palette', label: '配色' },
        { id: 'layout', label: '版式' },
        { id: 'graphic', label: '图形' },
      ];

      function PoolWorkbench(props) {
        const data = props.data;
        const pool = Array.isArray(data.pool) ? data.pool : [];
        const chips = Array.isArray(data.reasonChips) ? data.reasonChips : [];
        const [seen, setSeen] = React.useState(Array.isArray(data.seenIds) ? data.seenIds : []);
        const [shortlist, setShortlist] = React.useState(Array.isArray(data.savedShortlist) ? data.savedShortlist : []);
        const [likes, setLikes] = React.useState(Array.isArray(data.savedLikes) ? data.savedLikes : []);
        const [traits, setTraits] = React.useState(Array.isArray(data.savedTraits) ? data.savedTraits : []);
        const [eliminated, setEliminated] = React.useState(Array.isArray(data.savedEliminated) ? data.savedEliminated : []);
        const [passed, setPassed] = React.useState(Array.isArray(data.savedPassed) ? data.savedPassed : []);
        const [armDelete, setArmDelete] = React.useState(null);
        const [deleteNotes, setDeleteNotes] = React.useState({});
        const [traitFor, setTraitFor] = React.useState(null);
        const [traitKind, setTraitKind] = React.useState('typography');
        const [traitText, setTraitText] = React.useState('');
        const [draft, setDraft] = React.useState(typeof data.savedDraft === 'string' ? data.savedDraft : '');
        const [pick, setPick] = React.useState(null);
        const [frames, setFrames] = React.useState({});
        const [busy, setBusy] = React.useState(false);
        const [sent, setSent] = React.useState(false);
        const [expired, setExpired] = React.useState(false);
        const [error, setError] = React.useState('');

        React.useEffect(() => {
          let active = true;
          (async () => {
            const decoded = {};
            for (const candidate of pool) {
              try {
                decoded[candidate.id] = await decodeCandidateHtml(candidate);
              } catch {
                decoded[candidate.id] = '';
              }
            }
            if (active) setFrames(decoded);
          })();
          return () => {
            active = false;
          };
        }, [data.uiToken]);

        React.useEffect(() => {
          const expiresAt = Date.parse(data?.uiTokenExpiresAt ?? '');
          if (!Number.isFinite(expiresAt)) return undefined;
          const tick = () => setExpired(Date.now() >= expiresAt);
          tick();
          const timer = setInterval(tick, 30_000);
          return () => clearInterval(timer);
        }, [data?.uiTokenExpiresAt]);

        const seenSet = new Set(seen);
        const windowCards = pool.filter((item) => !seenSet.has(item.id)).slice(0, 3);
        const byId = (id) => pool.find((item) => item.id === id);

        function leave(id) {
          setSeen((prev) => (prev.includes(id) || prev.length >= 12 ? prev : prev.concat(id)));
        }

        function toggleLike(id) {
          setLikes((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : prev.concat(id)));
        }

        function likesRecord() {
          return {
            schema: 'shortlist-likes/1',
            runId: data.runId,
            likes: likes.map((candidateId) => ({ candidateId })),
            traits,
            shortlist: shortlist.map((candidateId) => {
              const item = byId(candidateId);
              return { candidateId, htmlPath: item ? item.htmlPath : '', poolIndex: item ? item.pos : null };
            }),
            draft: draft.trim(),
            seen,
            eliminated,
            passed,
          };
        }

        function saveTrait(candidateId) {
          const text = traitText.trim();
          if (text === '') {
            setError('收藏特征需要一句说明');
            return;
          }
          setTraits((prev) => prev.concat({ candidateId, kind: traitKind, text }));
          setTraitText('');
          setTraitFor(null);
          setError('');
        }

        async function send(payload) {
          if (expired) {
            setError('预览已过期（30 分钟），请让 agent 重新调用 probe_shortlist_preview。');
            return;
          }
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

        const keptFinal = shortlist.length >= 1 && pick !== null;
        const draftFinal = draft.trim() !== '' && traits.length >= 1;
        const priorTraits = Array.isArray(data.likedTraits) ? data.likedTraits : [];

        return h(
          'section',
          { className: 'dsk-card', 'aria-label': '粗选流水线滑动窗', 'data-pool-window': 'true' },
          h('style', null, CSS),
          h(
            'div',
            { className: 'dsk-head' },
            h('strong', null, '粗选流水线'),
            h('span', { className: 'dsk-meta' }, '已看 ' + seen.length + '/' + Math.min(pool.length, 12) + ' · 短名单 ' + shortlist.length + '/3 · 特征 ' + traits.length),
          ),
          h('p', { className: 'dsk-hint' }, data.hint || '删除或路过后，这张离开，池里的下一张补进窗口。不必先待定。'),
          priorTraits.length
            ? h('p', { className: 'dsk-hint' }, 'likedTraits：' + priorTraits.map((trait) => trait.kind + ' ' + trait.text).join('；'))
            : null,
          h(
            'div',
            { className: 'dsk-grid' },
            windowCards.map((candidate, index) => {
              const letter = ['A', 'B', 'C'][index];
              return h(
                'article',
                { className: 'dsk-col', key: candidate.id },
                h(
                  'div',
                  { className: 'dsk-frame' },
                  frames[candidate.id]
                    ? h('iframe', { title: '候选 ' + letter, srcDoc: frames[candidate.id], sandbox: '', loading: 'lazy' })
                    : h('div', { className: 'dsk-frame-empty' }, '预览解码中…'),
                ),
                h('div', { className: 'dsk-row' }, h('span', { className: 'dsk-badge' }, '候选 ' + letter)),
                h(
                  'div',
                  { className: 'dsk-actions' },
                  h('button', { type: 'button', className: 'dsk-btn', disabled: busy || sent || expired, onClick: () => setArmDelete(candidate.id) }, '删除'),
                  h('button', {
                    type: 'button',
                    className: 'dsk-btn',
                    disabled: busy || sent || expired,
                    onClick: () => {
                      setPassed((prev) => (prev.includes(candidate.id) ? prev : prev.concat(candidate.id)));
                      leave(candidate.id);
                      setArmDelete(null);
                    },
                  }, '路过'),
                  h('button', {
                    type: 'button',
                    className: 'dsk-btn',
                    disabled: busy || sent || expired || shortlist.length >= 3,
                    onClick: () => {
                      if (shortlist.length >= 3) {
                        setError('短名单最多 3 张整页');
                        return;
                      }
                      setShortlist((prev) => (prev.includes(candidate.id) ? prev : prev.concat(candidate.id)));
                      leave(candidate.id);
                    },
                  }, '收藏整页'),
                  h('button', {
                    type: 'button',
                    className: 'dsk-btn',
                    'data-active': likes.includes(candidate.id) ? 'true' : 'false',
                    disabled: busy || sent || expired,
                    onClick: () => toggleLike(candidate.id),
                  }, '喜欢'),
                  h('button', { type: 'button', className: 'dsk-btn', disabled: busy || sent || expired, onClick: () => setTraitFor(candidate.id) }, '收藏特征'),
                ),
                armDelete === candidate.id
                  ? h(
                      'div',
                      { className: 'dsk-chips' },
                      chips.map((chip) => reasonButton(chip.label, false, () => {
                        const note = (deleteNotes[candidate.id] || '').trim();
                        setEliminated((prev) => prev.concat({ candidateId: candidate.id, reasonId: chip.id, ...(note ? { note } : {}) }));
                        leave(candidate.id);
                        setArmDelete(null);
                      }, chip.id)),
                    )
                  : null,
                armDelete === candidate.id
                  ? h('input', {
                      type: 'text',
                      className: 'dsk-note',
                      placeholder: '补充理由（可选）',
                      'aria-label': '候选 ' + letter + ' 的补充删除理由',
                      value: deleteNotes[candidate.id] || '',
                      maxLength: 160,
                      disabled: busy || sent || expired,
                      onChange: (event) => {
                        const value = event.target.value;
                        setDeleteNotes((prev) => ({ ...prev, [candidate.id]: value }));
                      },
                    })
                  : null,
              );
            }),
          ),
          windowCards.length === 0 ? h('p', { className: 'dsk-hint' }, '这 12 张都看过了。可以提交终选，或先收藏特征。') : null,
          h(
            'div',
            { className: 'dsk-tray' },
            h('h3', null, '短名单'),
            shortlist.length === 0 ? h('p', { className: 'dsk-hint' }, '还没有整页收藏。可以只路过，不必每轮待定。') : null,
            ...shortlist.map((id, index) => h(
              'div',
              { className: 'dsk-mini', key: 'keep-' + id },
              h('span', null, '整页 ' + (index + 1)),
              h('button', {
                type: 'button',
                className: 'dsk-btn',
                'data-active': pick === index ? 'true' : 'false',
                disabled: busy || sent || expired,
                onClick: () => setPick(index),
              }, '选它终选'),
              h('button', { type: 'button', className: 'dsk-btn', disabled: busy || sent || expired, onClick: () => setTraitFor(id) }, '收藏特征'),
            )),
          ),
          h(
            'div',
            { className: 'dsk-tray' },
            h('h3', null, '已离开，仍可收藏特征'),
            ...seen.filter((id) => !shortlist.includes(id)).map((id) => h(
              'div',
              { className: 'dsk-mini', key: 'gone-' + id },
              h('span', null, eliminated.some((item) => item.candidateId === id) ? '已删' : '已路过'),
              h('button', {
                type: 'button',
                className: 'dsk-btn',
                'data-active': likes.includes(id) ? 'true' : 'false',
                disabled: busy || sent || expired,
                onClick: () => toggleLike(id),
              }, '喜欢'),
              h('button', { type: 'button', className: 'dsk-btn', disabled: busy || sent || expired, onClick: () => setTraitFor(id) }, '收藏特征'),
            )),
          ),
          traitFor
            ? h(
                'div',
                { className: 'dsk-tray' },
                h('h3', null, '收藏特征'),
                h(
                  'div',
                  { className: 'dsk-chips' },
                  TRAIT_KINDS.map((kind) => reasonButton(kind.label, traitKind === kind.id, () => setTraitKind(kind.id), kind.id)),
                ),
                h('input', {
                  type: 'text',
                  className: 'dsk-note',
                  placeholder: '想留下的字体、配色、版式或图形',
                  'aria-label': '特征说明',
                  value: traitText,
                  maxLength: 160,
                  disabled: busy || sent || expired,
                  onChange: (event) => setTraitText(event.target.value),
                }),
                h('button', { type: 'button', className: 'dsk-btn', disabled: busy || sent || expired, onClick: () => saveTrait(traitFor) }, '保存特征'),
              )
            : null,
          h('input', {
            type: 'text',
            className: 'dsk-note',
            placeholder: '声明底稿（没有整页收藏时，终选需要这一句）',
            'aria-label': '声明底稿',
            value: draft,
            maxLength: 160,
            disabled: busy || sent || expired,
            onChange: (event) => setDraft(event.target.value),
          }),
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
                    disabled: busy || expired || seen.length === 0,
                    onClick: () => {
                      void send({
                        schema: 'shortlist-ui-action/1',
                        kind: 'pipeline',
                        run: data.run,
                        uiToken: data.uiToken,
                        record: likesRecord(),
                      });
                    },
                  },
                  expired ? '预览已过期' : busy ? '发送中…' : '提交进度',
                ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsk-btn dsk-btn-primary',
                disabled: busy || sent || expired || !(keptFinal || draftFinal),
                onClick: () => {
                  const choice = keptFinal
                    ? { kind: 'shortlist', pos: pick + 1 }
                    : { kind: 'draft', draft: draft.trim() };
                  void send({
                    schema: 'shortlist-ui-action/1',
                    kind: 'final',
                    run: data.run,
                    uiToken: data.uiToken,
                    choice,
                    record: likesRecord(),
                  });
                },
              },
              '提交终选',
            ),
          ),
          shortlist.length < 1 && traits.length < 1
            ? h('p', { className: 'dsk-hint' }, '特征袋空且无短名单时不能终选。')
            : null,
          error ? h('div', { className: 'dsk-error' }, error) : null,
        );
      }

      function ShortlistPreviewCard(props) {
        const data = parseResult(props.block);
        const embedded = props.embedded === true;
        const workbenchState = useWorkbench();
        const [roundSel, setRoundSel] = React.useState({});
        const [roundNotes, setRoundNotes] = React.useState({});
        const [finalSel, setFinalSel] = React.useState(null); // {kind:'candidate',pos} | {kind:'none'}
        const [rejectReasons, setRejectReasons] = React.useState({});
        const [finalNote, setFinalNote] = React.useState('');
        const [busy, setBusy] = React.useState(false);
        const [sent, setSent] = React.useState(false);
        const [expired, setExpired] = React.useState(false);
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

        // 令牌有 30 分钟有效期；到点后面板只读，提示重新预览，避免“点了才报错”。
        // 卡片数据一到就打开独立工作台；内联卡片退化为“已打开”的轻提示。
        React.useEffect(() => {
          if (!embedded && data && data.ok === true) {
            openWorkbench(data, props.sendUserMessage);
          }
        }, [embedded, data?.uiToken]);

        React.useEffect(() => {
          const expiresAt = Date.parse(data?.uiTokenExpiresAt ?? '');
          if (!Number.isFinite(expiresAt)) return undefined;
          const tick = () => setExpired(Date.now() >= expiresAt);
          tick();
          const timer = setInterval(tick, 30_000);
          return () => clearInterval(timer);
        }, [data?.uiTokenExpiresAt]);

        // DSH 会把工具调用折进“过程/活动”组；卡片在里面但父组默认折叠。
        // 挂载后自动展开最近的过程组，并把卡片滚进视口。
        React.useEffect(() => {
          if (embedded || !data || data.ok !== true || typeof document === 'undefined') return undefined;
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

        if (!embedded && (data.mode === 'pool' || (workbenchState.open && workbenchState.data?.uiToken === data.uiToken))) {
          return h(
            'div',
            { className: 'dsk-launch' },
            h(
              'div',
              null,
              h('strong', null, 'Design Kit 工作台已打开'),
              h('div', { className: 'dsk-meta' }, workbenchModeLabel(data)),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsk-btn',
                onClick: () => openWorkbench(data, props.sendUserMessage),
              },
              '重新打开',
            ),
          );
        }

        if (embedded && data.mode === 'pool') {
          return h(PoolWorkbench, { data, sendUserMessage: props.sendUserMessage });
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
          if (expired) {
            setError('预览已过期（30 分钟），请让 agent 重新调用 probe_shortlist_preview。');
            return;
          }
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
              const note = typeof roundNotes[candidate.pos] === 'string' ? roundNotes[candidate.pos].trim() : '';
              return {
                pos: candidate.pos,
                action: item.action,
                ...(item.action === 'eliminate' ? { reasonId: item.reasonId } : {}),
                ...(item.action === 'eliminate' && note ? { note } : {}),
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
          const note = finalNote.trim();
          const choice =
            finalSel.kind === 'candidate'
              ? { kind: 'candidate', pos: finalSel.pos }
              : {
                  kind: 'none',
                  reasonIds: Object.keys(rejectReasons).filter((id) => rejectReasons[id]),
                  ...(note ? { note } : {}),
                };
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
                          disabled: busy || sent || expired,
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
                          disabled: busy || sent || expired,
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
                          disabled: busy || sent || expired,
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
                      sel?.action === 'eliminate'
                        ? h('input', {
                            type: 'text',
                            className: 'dsk-note',
                            value: roundNotes[candidate.pos] || '',
                            maxLength: 160,
                            placeholder: '补充理由（可选）',
                            'aria-label': '候选 ' + letter + ' 的补充删除理由',
                            disabled: busy || sent || expired,
                            onChange: (event) => {
                              const value = event.target.value;
                              setRoundNotes((prev) => ({ ...prev, [candidate.pos]: value }));
                            },
                          })
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
                  { type: 'button', className: 'dsk-btn', 'data-active': finalSel?.kind === 'none' ? 'true' : 'false', disabled: busy || sent || expired, onClick: () => setFinalSel({ kind: 'none' }) },
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
          data.mode === 'final' && finalSel?.kind === 'none'
            ? h('input', {
                type: 'text',
                className: 'dsk-note',
                value: finalNote,
                maxLength: 160,
                placeholder: '补充理由（可选）',
                'aria-label': '都不行的补充删除理由',
                disabled: busy || sent || expired,
                onChange: (event) => setFinalNote(event.target.value),
              })
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
                    disabled: busy || expired || (data.mode === 'final' ? !finalValid() : !roundValid()),
                    onClick: data.mode === 'final' ? submitFinal : submitRound,
                  },
                  expired ? '预览已过期' : busy ? '发送中…' : data.mode === 'final' ? '提交终选' : '提交本轮',
                ),
            h('span', { className: 'dsk-hint' }, data.mode === 'final' ? '三选一，或「都不行」并选理由' : '3 个都要有决策；待定全轮最多 1 个'),
          ),
          expired && !sent
            ? h('div', { className: 'dsk-error' }, '预览已过期（30 分钟）。请让 agent 重新调用 probe_shortlist_preview。')
            : null,
          error ? h('div', { className: 'dsk-error' }, error) : null,
        );
      }

      function DesignKitOverlay() {
        const state = useWorkbench();

        React.useEffect(() => {
          if (!state.open) return undefined;
          const previousOverflow = document.body.style.overflow;
          document.body.style.overflow = 'hidden';
          const onKeyDown = (event) => {
            if (event.key === 'Escape') closeWorkbench();
          };
          window.addEventListener('keydown', onKeyDown);
          return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', onKeyDown);
          };
        }, [state.open]);

        if (!state.open || !state.data) return null;
        const block = { content: [{ type: 'text', text: JSON.stringify(state.data) }] };
        return createPortal(
          h(
            'div',
            {
              className: 'dsk-overlay',
              onMouseDown: (event) => {
                if (event.target === event.currentTarget) closeWorkbench();
              },
            },
          h(
            'section',
            {
              className: 'dsk-wb',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': 'Design Kit 方向工作台',
            },
            h(
              'header',
              { className: 'dsk-wb-head' },
              h(
                'div',
                { className: 'dsk-wb-title' },
                h('strong', null, 'Design Kit'),
                h(
                  'span',
                  { className: 'dsk-meta' },
                  workbenchModeLabel(state.data),
                ),
              ),
              h('button', { type: 'button', className: 'dsk-wb-close', onClick: closeWorkbench }, '回到对话'),
            ),
            h(
              'div',
              { className: 'dsk-wb-body' },
              h(ShortlistPreviewCard, {
                block,
                embedded: true,
                sendUserMessage: async (text) => {
                  await state.send(text);
                  closeWorkbench();
                },
              }),
            ),
          ),
          ),
          document.body,
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
        // shell.overlay 是宿主提供的全屏浮层槽；旧宿主没有时静默降级为内联卡片。
        try {
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register(
              { name: 'shell.overlay', id: 'dsh-design-kit-workbench' },
              DesignKitOverlay,
            ),
          );
        } catch {
          // ignore: 旧宿主仅保留 toolview 内联卡
        }
      }

      return { inject: ['slots', 'sessions'], apply, ShortlistPreviewCard, DesignKitOverlay };
    },
  });
})();
