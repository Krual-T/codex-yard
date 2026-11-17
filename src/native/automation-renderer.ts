/** Keep the pinned Scheduled UI. Yard creates independent runs, so its new
 * local task uses the renderer's existing cron form instead of heartbeat. */
export function adaptAutomationModule(path: string, content: Buffer): Buffer {
  if (path === '/assets/automations-page-cf5a9694ba8a.js') {
    let source = content.toString('utf8');
    for (const [before, after] of [
      ['children:[f,p]}),t[12]=f,t[13]=p,t[14]=m', 'children:[f,p,window.workbenchAutomationRecovery?.(r)]}),t[12]=f,t[13]=p,t[14]=m'],
      // The settings sidebar uses compact run rows without an expandable card.
      ['children:[ce,B,H]}),t[48]=ce', 'children:[ce,B,H,a==null&&!p?window.workbenchAutomationRecovery?.(r,true):null]}),t[48]=ce'],
    ]) {
      if (source.split(before).length !== 2) throw new Error('运行恢复适配与固定界面版本不匹配：' + path);
      source = source.replace(before, after);
    }
    return Buffer.from(source);
  }
  if (path !== '/assets/app-initial-a68277f60b93.js') return content;
  let source = content.toString('utf8');
  const replacements = [
    ['bv={cloudTeam:null,id:null,kind:`heartbeat`,name:', 'bv={cloudTeam:null,id:null,kind:`cron`,name:'],
    // Local scheduling belongs to Yard. It does not require an App account's
    // cloud access-policy response or an App feature rollout.
    ['hKt=Z(q,({get:e})=>{let t=e(s_);return t.status===`allowed`?e(by,`local`).kind===`local`?e(ug,`770071981`)?{isLoading:!0,isError:!1,isCapable:!1}:e(lg,`770071981`)?nKt(e,[`chatgpt.workspace.feature.codex-local-automation.access`]):{isLoading:!1,isError:!1,isCapable:!0}:{isLoading:!1,isError:!1,isCapable:!1}:{isLoading:t.status===`loading`,isError:t.status===`error`,isCapable:!1}})',
      'hKt=Z(q,()=>({isLoading:!1,isError:!1,isCapable:!0}))'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('定时任务适配与固定界面版本不匹配：' + path);
    source = source.replace(before, after);
  }
  return Buffer.from(source);
}
