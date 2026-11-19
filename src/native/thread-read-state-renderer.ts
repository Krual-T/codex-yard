/** Adapt only the pinned UI's read-state store and chronological sidebar
 * comparator. Durable marks come from app-server; explicit manual order stays. */
export function adaptThreadReadState(path: string, content: Buffer): Buffer {
  if (path !== '/assets/app-initial-a68277f60b93.js') return content;
  const edits = [
    ['function oIn(e,t){return{isReady:()=>!0,has:t=>wh(eE,{})[e]?.includes(t)===!0,set:(n,r)=>{let i=wh(eE,{}),a=sIn(i,{hostId:e,threadId:n,hasUnreadTurn:r});a!==i&&(Th(eE,a),t.threadReadStateChanged({hostId:e,conversationId:n,hasUnreadTurn:r}).catch(e=>Lo.warning(`Failed to broadcast thread read state`,{safe:{},sensitive:{error:e}})))},subscribe:t=>QT(`thread-read-state-changed`,({params:n})=>{if(n.hostId!==e)return;let r=Qr(n.conversationId);Th(eE,sIn(wh(eE,{}),{hostId:e,threadId:r,hasUnreadTurn:n.hasUnreadTurn})),t({threadId:r,hasUnreadTurn:n.hasUnreadTurn})})}}',
      'function oIn(e,t){return window.workbenchThreadReadState.forHost(e,e=>Lo.warning(`会话未读状态保存失败`,{id:`yard-thread-read-state`,description:e.message,safe:{},sensitive:{error:e}}))}'],
    ['read(){return this.#e==null?wh(eE,{}):this.#n}',
      'read(){return this.#e==null?window.workbenchThreadReadState.snapshot():this.#n}'],
    ['this.#e==null?Oh(eE,{},e.listener):this.subscribeStatus(e.listener)',
      'this.#e==null?window.workbenchThreadReadState.subscribe(e.listener):this.subscribeStatus(e.listener)'],
    ['this.#m=Oh(eE,{},e=>{let t=this.#h;this.#h=e,this.#S(t,e)})',
      'this.#m=window.workbenchThreadReadState.subscribe(e=>{let t=this.#h;this.#h=e,this.#S(t,e)})'],
    ['$G=H(q,(e,{get:t,scope:n})=>{let r=',
      '$G=H(q,(e,{get:t,scope:n})=>{t(ZHi);let r='],
    ['.sort((t,n)=>e(n.item.key)-e(t.item.key)||t.index-n.index)',
      '.sort((t,n)=>window.workbenchThreadReadState.priority(t.item.key)-window.workbenchThreadReadState.priority(n.item.key)||e(n.item.key)-e(t.item.key)||t.index-n.index)'],
    ['function Rfa(e,t){return e.map((e,n)=>({index:n,item:e,timestamp:t(e.key)})).sort((e,t)=>t.timestamp-e.timestamp||e.index-t.index)',
      'function Rfa(e,t){return e.map((e,n)=>({index:n,item:e,timestamp:t(e.key)})).sort((e,t)=>window.workbenchThreadReadState.priority(e.item.key)-window.workbenchThreadReadState.priority(t.item.key)||t.timestamp-e.timestamp||e.index-t.index)'],
    ['.sort((e,t)=>t.entry.recencyAt-e.entry.recencyAt||e.index-t.index)',
      '.sort((e,t)=>window.workbenchThreadReadState.priority(e.entry.key)-window.workbenchThreadReadState.priority(t.entry.key)||t.entry.recencyAt-e.entry.recencyAt||e.index-t.index)'],
    ['function l6c(e,t){return t.recencyAt-e.recencyAt}',
      'function l6c(e,t){return window.workbenchThreadReadState.priority(e.threadKey)-window.workbenchThreadReadState.priority(t.threadKey)||t.recencyAt-e.recencyAt}'],
  ];
  let source = content.toString('utf8');
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error('会话未读与排序适配与固定界面版本不匹配：' + path);
    source = source.replace(before, after);
  }
  return Buffer.from(source);
}
