export const rendererComponentsPath = '/renderer-components.js';

/** Explicit seams in App 26.1013.40934. The upstream files stay intact.
 * Their existing callers initialize React/services and continue to own state.
 * Each wrapper creates its authored child once, inside the same React tree. */
export function adaptMigratedRendererModule(path: string, content: Buffer): Buffer {
  if (path !== '/assets/app-initial-a68277f60b93.js'
      && path !== '/assets/collapsible-user-message-content-636c4ff1e0ff.js'
      && path !== '/assets/app-primary-f5ea123a0407.js'
      && path !== '/assets/app-shared-61271c39e3c5.js') return content;
  let source = content.toString('utf8');
  let prefix: string;
  if (path === '/assets/app-initial-a68277f60b93.js') {
    prefix = `import{createRelativeTimeComponent as __yardCreateRelativeTime,createTaskRowComponent as __yardCreateTaskRow,createSidebarConversationRowComponent as __yardCreateConversationRow,createSidebarStatusBadgeComponent as __yardCreateBadge,createMarkdownCodeBlockComponent as __yardCreateMarkdownCodeBlock,createMermaidLoadingPlaceholderComponent as __yardCreateMermaidPlaceholder}from"${rendererComponentsPath}";let __yardRelativeTime,__yardTaskRow,__yardConversationRow,__yardBadge,__yardMarkdownCodeBlock,__yardMermaidPlaceholder;\n`;
    source = replacePinnedFunction(path, source,
      'function YEc(e){',
      '(l=(0,eDc.jsx)(ZEc,{dateString:n,now:c,dayBasis:o}),t[6]=n,t[7]=o,t[8]=c,t[9]=l):l=t[9],l}',
      'function YEc(e){return(0,eDc.jsx)(__yardRelativeTime??=__yardCreateRelativeTime(AIa,{useNow:vIa,useIntl:ca,getRelativeUnit:VEc,FormattedMessage:W}),e)}');
    source = replacePinnedFunction(path, source,
      'function GTc(e){',
      't[272]=fee,t[273]=pee,t[274]=Or,t[275]=mee):mee=t[275],mee}',
      'function GTc(e){return(0,O2.jsx)(__yardTaskRow??=__yardCreateTaskRow(cEc,{classNames:Wc,useAtomValue:G,cloudEnvironmentAtom:oR,productModeAtom:iR,isPlatform:uMs,focusApp:Cc,isFileTransfer:E2o,onFileDragLeave:KTc,isImmediateHoverTarget:tEc,pulseRef:Nc,actionRailClassName:dEc,endRailClassName:fEc,inlineTitleSuffixClassName:UTc.inlineTitleSuffix,endIconWidth:pEc,endIconGap:mEc,endIconPadding:hEc,errorAsset:dae,RowRoot:eTc,Indent:iTc,AnimatedTitle:zwc,TitleContent:$Io,InlineBadges:JTc,EndBadges:ZTc,Metadata:nEc,EnvironmentIcon:jTc,StatusIndicator:w2,StatusPill:XTc,ArchiveAction:iEc,ArchiveConfirm:rEc,ActionRail:FTc,PinnedIcon:Q$,DefaultPinIcon:zwe,Icon:Pi,FormattedMessage:W,Tooltip:Sl}),e)}');
    source = replacePinnedFunction(path, source,
      'function vEc(e){',
      't[13]=i,t[14]=l,t[15]=u,t[16]=d):d=t[16],d}',
      'function vEc(e){return(0,bEc.jsx)(__yardConversationRow??=__yardCreateConversationRow(cEc,{TaskRow:GTc,AnimatedTitle:zwc,classNames:Wc}),e)}');
    source = replacePinnedFunction(path, source,
      'function hzc(e){',
      't[8]=n.tooltipContent,t[9]=c,t[10]=l):l=t[10],l}',
      'function hzc(e){return(0,vzc.jsx)(__yardBadge??=__yardCreateBadge(_zc,{Tooltip:Sl,classNames:Wc}),e)}');
    source = replacePinnedFunction(path, source,
      'function Ard(e){let t=(0,Prd.c)(54),',
      't[52]=O,t[53]=F):F=t[53],F}',
      'function Ard(e){return(0,Q7.jsx)(__yardMarkdownCodeBlock??=__yardCreateMarkdownCodeBlock(Frd,{useLanguageLabel:e=>{let t=ca();return e==null?void 0:YMe(e,t)?.label},CodeBlockPreviewContext:Ord,DefaultCodeSnippet:dEe,MermaidPlaceholder:trd,isMermaidDiagram:Cte,isDeferredCodeBlock:owe,styles:z7}),e)}');
    source = replacePinnedFunction(path, source,
      'function trd(e){let t=(0,nrd.c)(5),',
      'description:`Shimmering status text shown while a Mermaid diagram response is waiting to render`})})}),t[4]=i):i=t[4],i}',
      'function trd(e){return(0,rrd.jsx)(__yardMermaidPlaceholder??=__yardCreateMermaidPlaceholder(Ts(),{useIntl:ca,Skeleton:aJo,ShimmeringStatus:Znd,FormattedMessage:W}),e)}');
  } else if (path === '/assets/collapsible-user-message-content-636c4ff1e0ff.js') {
    prefix = `import{createCollapsibleUserMessageContentComponent as __yardCreateMessageContent}from"${rendererComponentsPath}";let __yardMessageContent;\n`;
    source = replacePinnedFunction(path, source,
      'function C(e){', 'n[57]=Q,n[58]=$):$=n[58],$}',
      'function C(e){return(0,D.jsx)(__yardMessageContent??=__yardCreateMessageContent(E,{useIsPrinting:()=>ee(x),useTextContentMeasurement:r,registerThreadFindTarget:re,CodeBlockPreviewContext:ne,Button:t,FormattedMessage:a,ChevronDown:te,classNames:m}),e)}');
  } else if (path === '/assets/app-primary-f5ea123a0407.js') {
    prefix = `import{createHomeComposerLayoutComponent as __yardCreateHomeComposerLayout}from"${rendererComponentsPath}";let __yardHomeComposerLayout;\n`;
    source = replacePinnedFunction(path, source,
      'function RBt(e){', 't[17]=T,t[18]=O,t[19]=k):k=t[19],k}',
      'function RBt(e){return(0,K9.jsx)(__yardHomeComposerLayout??=__yardCreateHomeComposerLayout(G9,{useSidebarOpen:()=>Y(ape),useSidebarWidth:()=>Y(xLe),useMediaQuery:$l,sidebarBreakpoint:tMe,useLocation:Sf,useIsWorkMode:()=>Rv()===$h,useVoiceRequest:()=>Y(nle),matchMissionControl:e=>hc(`/mission-control`,e),isTemporaryChat:te,useFeatureFlag:bS,ModelPickerScope:bV,ScopeProvider:Jf,KeyboardShortcuts:cRt,LegacyLayout:MBt,ModeToggleWrapper:yj,WorkHomePage:GBt,StandardLayout:BBt,prepareTaskSuggestionDestination:zBt}),e)}');
  } else {
    prefix = `import{createCodeBlockFrameComponent as __yardCreateCodeFrame}from"${rendererComponentsPath}";let __yardCodeFrame;\n`;
    source = replacePinnedFunction(path, source,
      'function zzn(e){let t=(0,Hzn.c)(79),',
      't[77]=K,t[78]=De):De=t[78],De}',
      'function zzn(e){return(0,K9.jsx)(__yardCodeFrame??=__yardCreateCodeFrame(Uzn,{useIsDark:o2,useIntl:EO,normalizeLanguage:Bwn,CopyButton:lLn,Tooltip:I2,Button:I1,FormattedMessage:FO,LatexPreview:Mzn,WrapEnabledIcon:gzn,WrapDisabledIcon:pzn,WrappedIcon:X0,UnwrappedIcon:Y0,CodeIcon:Z0,copyToClipboard:lCn,styles:U9,classNames:X}),e)}');
  }
  return Buffer.from(prefix + source);
}

function replacePinnedFunction(path: string, source: string, start: string, end: string, replacement: string): string {
  const from = source.indexOf(start);
  const endAt = source.indexOf(end);
  if (from < 0 || endAt < from + start.length || source.lastIndexOf(start) !== from
      || source.lastIndexOf(end) !== endAt) {
    throw new Error('React migration does not match the pinned renderer: ' + path);
  }
  const to = endAt + end.length;
  return source.slice(0, from) + replacement + source.slice(to);
}
