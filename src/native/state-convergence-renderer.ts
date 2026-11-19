/** Keep version-specific edits at this boundary; upstream assets stay intact. */
export function adaptStateConvergence(path: string, content: Buffer): Buffer {
  if (path !== '/assets/app-initial-a68277f60b93.js') return content;
  const edits = [
    // Local/SSH capability is supplied by the connected backend. Cloud hosts
    // retain their own feature gate; temporary threads retain local intent.
    ['u=r=>t.getConversation(r)?.ephemeral!==!0&&(i?og(e,`1189013788`):og(e,`2120612410`)&&Oc(n(),`threadQueue`))',
      'u=r=>t.getConversation(r)?.ephemeral!==!0&&(i?og(e,`1189013788`):Oc(n(),`threadQueue`))'],
    ['canEnqueue:(e,t)=>!i||d(e,t)&&t.context.requiresLocalPreparation',
      'canEnqueue:(e,t)=>d(e,t)&&t.context.requiresLocalPreparation'],
    ['loadMessages=async(e,t=!1)=>{if(this.disposed)return;this.#m(e)??await this.#_();let n=this.#h(e);n!=null&&(t||n.read(e)==null)&&await n.load(e),this.disposed||this.#b(e)}',
      'loadMessages=async(e,t=!1)=>{if(this.disposed)return;this.#m(e)??await this.#_();let n=this.#h(e),r=this.deferAutomaticTurns(e);try{n!=null&&(t||n.read(e)==null)&&await n.load(e);if(n!=null&&!this.disposed&&!this.running.has(e)&&this.options.getStreamRole(e)?.role===`owner`)await window.workbenchStateConvergence.migrateQueuedFollowUps({hostId:this.options.hostId,threadId:e,queue:n,read:()=>this.#m(e)??[],update:t=>this.#v(e,t,`owner`),isSame:(e,t)=>(0,gS.default)(e,t),canMigrate:t=>!this.#g(t),isCurrent:t=>!this.disposed&&!this.running.has(e)&&this.options.getStreamRole(e)?.role===`owner`&&this.#m(e)?.some(e=>(0,gS.default)(e,t))===!0,wasAccepted:t=>this.options.wasMessageAccepted(e,t),isNotSent:e=>e instanceof $b||e instanceof ex&&e.delivery.stage===`not-sent`});this.disposed||this.#b(e)}finally{r[Symbol.dispose]()}}'],
    ['_D=Ig(`pull-request-attachment-records-v3`,void 0)',
      '_D=nc(q,window.workbenchStateConvergence.legacyAttachmentRecords())'],
    ['let a=qh(n,e.hostId),o=[],s=[],c=null;do{t.throwIfAborted();let n=await a.sendRequest(`thread/attachment/list`',
      'let a=qh(n,e.hostId),o=[],s=[],c=null;await window.workbenchStateConvergence.migrateAttachments(e,(e,t)=>a.sendRequest(e,t),e=>{let t=e.url==null?null:lw(e.url);return t==null?null:{identityKey:hw(t.pullRequest),payload:{url:t.provider===`gitlab`?fw(t.pullRequest):uw(t.pullRequest),root:e.root??null,headBranch:e.headBranch??null}}});do{t.throwIfAborted();let n=await a.sendRequest(`thread/attachment/list`'],
    ['function nMn(e){Th(tMn(e),[])}',
      'function nMn(e){window.workbenchStateConvergence.writeRemoteSummaries(e,[])}'],
    ['for(let n of wh(tMn(t),[]))e.setConversation(o3t(n)),e.ensureRecentConversationId(n.conversationId);e.addAnyConversationMetaCallback(e=>{Th(tMn(t),e.filter',
      'for(let n of window.workbenchStateConvergence.readRemoteSummaries(t))e.setConversation(o3t(n)),e.ensureRecentConversationId(n.conversationId);e.addAnyConversationMetaCallback(e=>{window.workbenchStateConvergence.writeRemoteSummaries(t,e.filter'],
    ['Lxo=Ig(Fxo,{})', 'Lxo=nc(q,{})'],
    ['BFl=Ig(`heartbeat-thread-permissions-by-id`,{})', 'BFl=nc(q,{})'],
    // The host preference remains a creation/recent-choice preference. Once a
    // thread exists, its resumed settings determine the effective permissions.
    ['be=rSo(i,L,R,pe,o),xe=be??ye', 'be=I?rSo(i,L,R,pe,o):null,xe=be??ye'],
  ];
  let source = content.toString('utf8');
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error('状态归属适配与固定界面版本不匹配：' + path);
    source = source.replace(before, after);
  }
  return Buffer.from(source);
}
