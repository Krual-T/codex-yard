export const rendererComponentsPath = '/renderer-components.js';

/** Explicit seams in App 26.1013.40934. The upstream files stay intact.
 * Their existing callers initialize React/services and continue to own state.
 * Each wrapper creates its authored child once, inside the same React tree. */
export function adaptMigratedRendererModule(path: string, content: Buffer): Buffer {
  if (path !== '/assets/app-initial-a68277f60b93.js'
      && path !== '/assets/collapsible-user-message-content-636c4ff1e0ff.js'
      && path !== '/assets/app-primary-f5ea123a0407.js'
      && path !== '/assets/app-shared-61271c39e3c5.js'
      && path !== '/assets/user-message-58a6f09045c4.js'
      && path !== '/assets/user-message-attachments-9d0c60d2f476.js'
      && path !== '/assets/general-settings-8997e171b11a.js'
      && path !== '/assets/appearance-settings-deb0b7565185.js'
      && path !== '/assets/settings-page-25f8fd08b293.js') return content;
  let source = content.toString('utf8');
  let prefix: string;
  if (path === '/assets/app-initial-a68277f60b93.js') {
    prefix = `import{createRelativeTimeComponent as __yardCreateRelativeTime,createTaskRowComponent as __yardCreateTaskRow,createSidebarConversationRowComponent as __yardCreateConversationRow,createSidebarStatusBadgeComponent as __yardCreateBadge,createMarkdownCodeBlockComponent as __yardCreateMarkdownCodeBlock,createMermaidLoadingPlaceholderComponent as __yardCreateMermaidPlaceholder,createMainComposerViewComponent as __yardCreateComposerView,createComposerControllerProvider as __yardCreateComposerProvider}from"${rendererComponentsPath}";let __yardRelativeTime,__yardTaskRow,__yardConversationRow,__yardBadge,__yardMarkdownCodeBlock,__yardMermaidPlaceholder,__yardComposerView,__yardComposerProvider;\n`;
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
    source = replacePinnedFunction(path, source,
      'function y_d(e){let t=(0,b_d.c)(101),',
      't[99]=Ie,t[100]=Le):Le=t[100],Le}',
      'function y_d(e){return(0,M9.jsx)(__yardComposerView??=__yardCreateComposerView(x_d,{MotionContext:Xsr,PresentationContext:Lk,Parts:Uk,Editor:n_d,Surface:Qgd,LegacyDictation:O4u,RealtimeVoice:Bgd,DictationControls:h_d,mergeRefs:Bc,classNames:Wc}),e)}');
    source = replacePinnedFunction(path, source,
      'function BSd(e){let t=(0,VSd.c)(45),',
      't[42]=V,t[43]=ae,t[44]=oe):oe=t[44],oe}',
      'function BSd(e){return(0,USd.jsx)(__yardComposerProvider??=__yardCreateComposerProvider(U9,{ControllerContext:ncr,useEnterBehavior:()=>oa(Ua.composerEnterBehavior),usePlainTextMode:()=>oa(Ua.composerPlainTextMode),useIsHydrating:ie,flushSync:HSd.flushSync,createController:xUu,documentFromText:lq,createTextSelection:(doc,anchor,head)=>$s.create(doc,anchor,head)}),e)}');
  } else if (path === '/assets/collapsible-user-message-content-636c4ff1e0ff.js') {
    prefix = `import{createCollapsibleUserMessageContentComponent as __yardCreateMessageContent}from"${rendererComponentsPath}";let __yardMessageContent;\n`;
    source = replacePinnedFunction(path, source,
      'function C(e){', 'n[57]=Q,n[58]=$):$=n[58],$}',
      'function C(e){return(0,D.jsx)(__yardMessageContent??=__yardCreateMessageContent(E,{useIsPrinting:()=>ee(x),useTextContentMeasurement:r,registerThreadFindTarget:re,CodeBlockPreviewContext:ne,Button:t,FormattedMessage:a,ChevronDown:te,classNames:m}),e)}');
  } else if (path === '/assets/app-primary-f5ea123a0407.js') {
    prefix = `import{createHomeComposerLayoutComponent as __yardCreateHomeComposerLayout,createComposerDraftScopeComponent as __yardCreateDraftScope,createComposerSubmitControls as __yardCreateSubmitControls,createComposerQueueEditControls as __yardCreateQueueEdit}from"${rendererComponentsPath}";let __yardHomeComposerLayout,__yardDraftScope,__yardSubmitControls,__yardQueueEdit;\n`;
    source = replacePinnedFunction(path, source,
      'function RBt(e){', 't[17]=T,t[18]=O,t[19]=k):k=t[19],k}',
      'function RBt(e){return(0,K9.jsx)(__yardHomeComposerLayout??=__yardCreateHomeComposerLayout(G9,{useSidebarOpen:()=>Y(ape),useSidebarWidth:()=>Y(xLe),useMediaQuery:$l,sidebarBreakpoint:tMe,useLocation:Sf,useIsWorkMode:()=>Rv()===$h,useVoiceRequest:()=>Y(nle),matchMissionControl:e=>hc(`/mission-control`,e),isTemporaryChat:te,useFeatureFlag:bS,ModelPickerScope:bV,ScopeProvider:Jf,KeyboardShortcuts:cRt,LegacyLayout:MBt,ModeToggleWrapper:yj,WorkHomePage:GBt,StandardLayout:BBt,prepareTaskSuggestionDestination:zBt}),e)}');
    const composerStart = 'function Mpt(e){let t=(0,wZ.c)(251),';
    const composerEnd = 't[249]=er,t[250]=J):J=t[250],J}';
    const composerFrom = source.indexOf(composerStart);
    let composer = source.slice(composerFrom, source.indexOf(composerEnd, composerFrom) + composerEnd.length);
    // Restore only Mpt's draft/provider and root composition. Its remaining
    // application hooks and the original local/cloud controller stay upstream.
    composer = replacePinnedFunction(path, composer, 'let ct=st,lt;', 'let pt=ft,mt;', 'let ct=st,mt;');
    composer = replacePinnedFunction(path, composer, 'let Mn=ct??void 0,Nn;', 'let Wn;', 'let Wn;');
    composer = replacePinnedFunction(path, composer, 'let er;t[233]!==le', composerEnd,
      'return(0,EZ.jsx)(__yardDraftScope??=__yardCreateDraftScope(TZ,{ComposerProvider:wEe,EnvironmentSetup:Rpt,WorkspaceBanner:Nse,WorkspaceFooter:AZe,SettingsError:NZe,isClientThreadId:el,hasProtectedDraft:Sre,getSnapshot:s=>s.get(GSe),getDocument:fh,getPersistedText:s=>s.get(iC),serializeDocument:nb,isPrompt:kD,writeDocument:oNe,preserveDocument:Iae}),{scope:He,draftKey:ot,conversationId:ct,isWorkspaceStarter:nt,rootClassName:jn,surfacePlacement:Ne,showSurface:je,plainTextMode:it,defaultPrompt:he,composerController:le,onPlainTextChange:G,aboveComposerContent:o,aboveComposerContentLayout:Se,hotkeyWindowHomeFooterControls:fe,workSettingsQuery:tn,composer:$n})}');
    source = replacePinnedFunction(path, source, composerStart, composerEnd, composer);
    source = replacePinnedFunction(path, source,
      'function cut(e){let t=(0,MX.c)(31),',
      't[29]===_?D=t[30]:(D=()=>_(),t[29]=_,t[30]=D),D}',
      'function cut(e){return(__yardSubmitControls??=__yardCreateSubmitControls(NX,{useComposerScope:()=>lr(iD),useComposerController:gm,useShortcut:qD,useStableEvent:wf,isShortcut:LS,getEnterBehavior:s=>sa(s.get,va.composerEnterBehavior),isMultilineDocument:Txe}))(e)}');
    source = replacePinnedFunction(path, source,
      'function alt(e){let t=(0,clt.c)(51),', 't[49]=E,t[50]=N):N=t[50],N}',
      'function alt(e){return(__yardQueueEdit??=__yardCreateQueueEdit(ult,{useScope:()=>lr(iD),useController:gm,usePastedTextAttachments:()=>Y(Cw),clearAttachments:_Ne,closeHistory:ad,updatePrompt:T_,setComposerField:Ab,setSharedThreadAttachments:(s,a)=>s.set(gT,a),generatedPastedPaths:w_e,normalizeFiles:IT,normalizePastedText:Bse,deduplicateComments:c=>(0,llt.default)(c,mNe),clearMcpContext:Ub,queuedMcpContext:(s,m)=>xfe(m,s.get(ak)),restoreSubmittedMcpContext:bae,getDraft:s=>s.get(Ny),restoreDraft:Xb,getPresentationSuggestion:s=>s.get(Qb),setPresentationSuggestion:Pb,captureChanges:(s,a)=>ut(s,a).changes,applyChanges:DLe,runUndoable:ire,formatUndoLabel:Se,setEditHistoryStatus:Wte,trackEditHistory:Dpe,clearEditHistory:kRe,cleanupDraftAttachments:gNe,cleanupQueuedAttachments:B_,recordSend:vze,maxPastedTextCharacters:wu,editUndoExpiryMs:dlt}))(e)}');
  } else if (path === '/assets/app-shared-61271c39e3c5.js') {
    prefix = `import{createCodeBlockFrameComponent as __yardCreateCodeFrame}from"${rendererComponentsPath}";let __yardCodeFrame;\n`;
    source = replacePinnedFunction(path, source,
      'function zzn(e){let t=(0,Hzn.c)(79),',
      't[77]=K,t[78]=De):De=t[78],De}',
      'function zzn(e){return(0,K9.jsx)(__yardCodeFrame??=__yardCreateCodeFrame(Uzn,{useIsDark:o2,useIntl:EO,normalizeLanguage:Bwn,CopyButton:lLn,Tooltip:I2,Button:I1,FormattedMessage:FO,LatexPreview:Mzn,WrapEnabledIcon:gzn,WrapDisabledIcon:pzn,WrappedIcon:X0,UnwrappedIcon:Y0,CodeIcon:Z0,copyToClipboard:lCn,styles:U9,classNames:X}),e)}');
  } else if (path === '/assets/user-message-58a6f09045c4.js') {
    prefix = `import{createUserMessageBodyComponent as __yardCreateUserMessageBody,createUserMessageComponent as __yardCreateUserMessage}from"${rendererComponentsPath}";let __yardUserMessageBody,__yardUserMessage;\n`;
    source = replacePinnedFunction(path, source,
      'function yt(e){let t=(0,bt.c)(18),',
      't[13]=o,t[14]=u,t[15]=y,t[16]=r,t[17]=ee):ee=t[17],ee}',
      'function yt(e){return(0,xt.jsx)(__yardUserMessageBody??=__yardCreateUserMessageBody(oe(),{useExternalLinkConversationId:()=>{let e=d(Ie),t=oe().useMemo(()=>({name:`browser.in-app`}),[]),n=c(I,t);return n.isCapable?P(e.value)??void 0:void 0},CollapsibleContent:G,Markdown:U}),e)}');
    source = replacePinnedFunction(path, source,
      'function Rt(e){let n=(0,Vt.c)(171),',
      'n[166]=Tt,n[167]=Et,n[168]=X,n[169]=It,n[170]=Lt):Lt=n[170],Lt}',
      'function Rt(e){return(0,$.jsx)(__yardUserMessage??=__yardCreateUserMessage(Ht,{useScope:()=>d(Ie),getThreadId:e=>qe(e.value),useIsAeonFormatted:(e,t)=>c(e&&nt,t),useCurrentUser:e=>g(e?we:null),useEditDraft:e=>c(tt,e),setEditDraft:(e,t,n)=>e.set(tt,t,n),useEditingDisabled:()=>g(He),isEditingDisabled:e=>e.get(He),useIntl:m,useAnalytics:()=>g(De),normalizeMessage:Ne,isPlanImplementationRequest:lt,getCopyContent:Bt,toPlainText:Xe,copyToClipboard:me,UserMessageBody:yt,Editor:Ct,Button:t,Tooltip:_e,FormattedMessage:u,Timestamp:ft,HookStatsButton:mt,CopyIcon:E,CopiedIcon:he,EditIcon:pe,styles:Q,classNames:C}),e)}');
  } else if (path === '/assets/user-message-attachments-9d0c60d2f476.js') {
    prefix = `import{createUserMessageFileAttachmentComponent as __yardCreateUserMessageFile,createUserMessageImageListComponent as __yardCreateUserMessageImages,createUserMessageImageComponent as __yardCreateUserMessageImage}from"${rendererComponentsPath}";let __yardUserMessageFile,__yardUserMessageImages,__yardUserMessageImage;\n`;
    source = replacePinnedFunction(path, source,
      'function gn(e){let t=(0,xn.c)(60),',
      't[50]=n.endLine,t[51]=n.startLine,t[52]=r,t[53]=i,t[54]=f,t[55]=m,t[56]=h,t[57]=x,t[58]=S,t[59]=C):C=t[59],C}',
      'function gn(e){return(0,$.jsx)(__yardUserMessageFile??=__yardCreateUserMessageFile(Q,{useScope:()=>d(Ge),FileCard:ot,PastedTextCard:ct,FileContextMenu:Dt,openUploadedFile:z,openSharedThread:L,openFile:Xe,isDirectory:s,getPreviewKind:Je,isSidePanelFile:Pe,isSidePanelMedia:We,formatLabel:St,formatLineInfo:bn}),e)}');
    source = replacePinnedFunction(path, source,
      'function pn(e){let t=(0,xn.c)(18),',
      't[16]===u?d=t[17]:(d=(0,$.jsx)($.Fragment,{children:u}),t[16]=u,t[17]=d),d}',
      'function pn(e){return(0,$.jsx)(__yardUserMessageImages??=__yardCreateUserMessageImages(Q,{ImageAttachment:fn}),e)}');
    source = replacePinnedFunction(path, source,
      'function fn(e){let t=(0,xn.c)(110),',
      't[101]=E,t[102]=T,t[103]=w,t[104]=me,t[105]=I,t[106]=F,t[107]=Ve,t[108]=Be,t[109]=We):We=t[109],We}',
      'function fn(e){return(0,$.jsx)(__yardUserMessageImage??=__yardCreateUserMessageImage(Q,{useScope:()=>d(tt),useIntl:g,useImageClient:_e,useConversationHostId:e=>i(Ke,e),useDisableImageOverlay:()=>_(_t),useReducedMotion:C,useResolvedImage:Re,useImageOverlayEnabled:e=>ut(`2983946247`,e).get(`image_overlay_enabled`,false),isAssetPointer:Ae,getLocalImagePath:U,resolveLocalImage:Ne,getDurableIdentity:(e,t,n,r)=>{let i=e.value.routeKind===`local-thread`&&e.value.conversationId===t?e.get(He):null;return r==null&&i!=null?Ee(i,n):void 0},openImageEditor:Ue,openAnimatedOverlay:qe,recordImagePreview:ke,parseChatGptConversationId:je,getImageContextMenu:kt,ImageContextMenu:be,ImageDialog:gt,ImageOverlay:Sn,LoadingIcon:ue,AssetIcon:c,editAsset:r,FormattedMessage:l}),e)}');
  } else if (path === '/assets/general-settings-8997e171b11a.js') {
    prefix = `import{createGeneralSettingsComponents as __yardCreateGeneralSettings,createAppearancePreferencesComponent as __yardCreateAppearancePreferences,createThemeVariantsComponent as __yardCreateThemeVariants,createThemeFormComponent as __yardCreateThemeForm,createAppearanceControlComponents as __yardCreateAppearanceControls}from"${rendererComponentsPath}";let __yardGeneralSettings,__yardAppearancePreferences,__yardThemeVariants,__yardThemeForm,__yardAppearanceControls;\n`;
    source = replacePinnedFunction(path, source,
      'function Js(){', 'e[5]=n,e[6]=a),a}',
      'function Js(){return(0,$.jsx)(__yardGeneralSettings??=__yardCreateGeneralSettings(Lc,{Page:dr,PageTitle:lr,ToysBoundary:Mn,Toys:zo,Group:U,Rows:rt,FormattedMessage:M,composerGroupTitle:W.composerGroupTitle,notificationsTitle:W.notifications,appName:Pt,getWindowsShell:()=>_.windowsShell,useAnySettingsAccess:()=>L(Qr),useLocalAccess:()=>L(Vr),useLocalOrWorkLocalAccess:()=>L(mr),useHostId:()=>L(Dr),useFeatureFlag:Yn,useImportFeatureFlag:()=>Yn(zi),useImportDismissed:()=>L(kn),rows:{AccessSettings:To,FullAccessSettings:vo,ProjectlessWorkspace:Ts,DefaultOpenTarget:lc,AgentEnvironment:pc,TerminalShell:fc,Language:gc,MenuBar:cc,CloseConfirmation:ls,AdditionalPreference:Mo,WindowsStartup:sc,BottomPanelControl:Cc,TerminalLocation:wc,PreventSleep:Fc,AutoArchive:is,ChatHistoryCompression:js,ServiceTier:Hs,AmbientSuggestions:Ko,ImportSettings:hs,OpenSourceLicenses:Qs,Plugins:Xi,DesktopBeta:$s,InAppUpdates:ec,MessagePredictions:aa,EducationalTips:$i,LiteralText:ac,ContextUsage:Oc,EnterBehavior:Pc,FollowUpBehavior:Dc,PopoutWindow:ic,Notifications:Ki}}).GeneralSettings,{})}');
    source = replacePinnedFunction(path, source,
      'function tc(e){', 'n[28]=C,n[29]=m,n[30]=w):w=n[30],w}',
      'function tc(e){return(0,$.jsx)(__yardAppearancePreferences??=__yardCreateAppearancePreferences(Lc,{Group:U,Rows:rt,FormattedMessage:M,Row:V,Toggle:Le,Button:t,ExpandedIcon:ee,CollapsedIcon:s,ResetAdvanced:Xo,Mode:yc,ThemeVariants:Qa,UiFontSize:jc,ConditionalTextSetting:la,CodeFontSize:Mc,ReducedMotion:Ec,ConditionalDisplaySettings:ua,DiffMarkers:Tc,PointerCursors:bc,DockIcon:xc,FontSmoothing:Nc,useLocalAccess:()=>L(Vr)}),e)}');
    source = replacePinnedFunction(path, source,
      'function Qa(e){', 't[3]=n,t[4]=s,t[5]=l,t[6]=u):u=t[6],u}',
      'function Qa(e){return(0,X.jsx)(__yardThemeVariants??=__yardCreateThemeVariants(po,{useCurrentVariant:()=>Kr(Pr()),useBackdropSupport:$r,ThemeVariantSettings:$a}),e)}');
    source = replacePinnedFunction(path, source,
      'function $a(e){', 'theme:E,value:E.contrast,onChange:e=>{T({contrast:e})}}),label:p})]})}',
      'function $a(e){return(0,X.jsx)(__yardThemeForm??=__yardCreateThemeForm(po,{useThemeSettings:hn,useIntl:I,useToastGetter:()=>{let s=N(R);return()=>s.get(qe)},copyToClipboard:at,messages:Y,FormattedMessage:M,FormSection:eo,Row:V,Toggle:Le,Tooltip:dt,Button:t,ImportIcon:Ne,CopyIcon:Ce,ImportDialog:to,CodeThemePicker:no,AccentPicker:La,ColorPicker:Da,FontPicker:Ka,ContrastSlider:co}),e)}');
    const appearanceControls = '__yardAppearanceControls??=__yardCreateAppearanceControls(Lc,{useIntl:I,useThemeMode:()=>F(Ke.theme),useSaveThemeMode:()=>{let s=N(R);return v=>D(s,Ke.theme,v,{optimistic:false})},useFontSize:k=>F(k===`ui`?Ke.sansFontSize:Ke.codeFontSize),useSaveFontSize:()=>{let s=N(R);return(k,v)=>D(s,k===`ui`?Ke.sansFontSize:Ke.codeFontSize,v)},isValidFontSize:(k,v)=>(k===`ui`?Ke.sansFontSize:Ke.codeFontSize).schema.safeParse(v).success,fontSizeLimits:{ui:nt.sans,code:nt.code},messages:Y,FormattedMessage:M,Row:V,Input:ir,Tooltip:dt,SystemLightPreview:wa,SystemDarkPreview:Sa,LightPreview:ba,DarkPreview:va,classNames:tt})';
    source = replacePinnedFunction(path, source,
      'function yc(){', 'e[8]=o,e[9]=s,e[10]=c):c=e[10],c}',
      `function yc(){return(0,$.jsx)((${appearanceControls}).Mode,{})}`);
    source = replacePinnedFunction(path, source,
      'function jc(){', 'description:`Unit label for sans font size setting`}),e[18]=n,e[19]=h);let g;e[20]===h?g=e[21]:(g=(0,$.jsx)(`span`,{className:`text-sm text-secondary`,children:h}),e[20]=h,e[21]=g);let _;return e[22]!==g||e[23]!==m?(_=(0,$.jsx)(V,{label:s,description:c,control:(0,$.jsxs)(`div`,{className:`flex items-center gap-2`,children:[m,g]})}),e[22]=g,e[23]=m,e[24]=_):_=e[24],_}',
      `function jc(){return(0,$.jsx)((${appearanceControls}).UiFontSize,{})}`);
    source = replacePinnedFunction(path, source,
      'function Mc(){', 'description:`Unit label for code font size setting`}),e[18]=n,e[19]=h);let g;e[20]===h?g=e[21]:(g=(0,$.jsx)(`span`,{className:`text-sm text-secondary`,children:h}),e[20]=h,e[21]=g);let _;return e[22]!==g||e[23]!==m?(_=(0,$.jsx)(V,{label:s,description:c,control:(0,$.jsxs)(`div`,{className:`flex items-center gap-2`,children:[m,g]})}),e[22]=g,e[23]=m,e[24]=_):_=e[24],_}',
      `function Mc(){return(0,$.jsx)((${appearanceControls}).CodeFontSize,{})}`);
  } else if (path === '/assets/appearance-settings-deb0b7565185.js') {
    prefix = `import{createAppearanceSettingsComponent as __yardCreateAppearanceSettings}from"${rendererComponentsPath}";let __yardAppearanceSettings;\n`;
    source = replacePinnedFunction(path, source,
      'function f(){', 'e[1]=r,e[2]=i,e[3]=s):s=e[3],s}',
      'function f(){return(0,h.jsx)(__yardAppearanceSettings??=__yardCreateAppearanceSettings(m,{OutletContext:c,PageTitle:a,Page:o,AppearancePreferences:u}),{})}');
  } else {
    prefix = `import{createSettingsPageComponent as __yardCreateSettingsPage}from"${rendererComponentsPath}";let __yardSettingsPage;\n`;
    source = replacePinnedFunction(path, source,
      'function _i(){let e=(0,Ci.c)(143),',
      'e[139]=Je,e[140]=nt,e[141]=it,e[142]=at):at=e[142],at}',
      'function _i(){return(0,$.jsx)(__yardSettingsPage??=__yardCreateSettingsPage(wi,{useSettingsActions:()=>{let e=ee(re);return wi.useMemo(()=>({prepareHostNavigation:t=>mn(e,t),discardChanges:t=>xi(e,t),trackProfileVisit:()=>Wt(e,c,{source:`settings_page`}),updateLegacyContentRect:t=>e.set(Ie,t==null?null:Pe(t))}),[e])},useCodexMicroDeviceModel:()=>ne(We),useIntl:te,useNavigate:a,useLocation:pe,useHostSelection:ve,useSectionMatch:()=>ie(`/settings/:section/*`),useToolMatch:()=>ie(g),useAvailableTool:e=>f(On,e),normalizeUsageTab:Gt,isLocalHost:e=>Rt(e).kind===`local`,useVisibleSettings:Cn,useReturnPath:()=>ne(De),useLayout:e=>f(kt,e),useHasUnsavedChanges:()=>ne(Ze).size>0,shouldNavigateBack:In,resolveSection:Sr,sectionPath:Ae,localHostId:le,useResizeObserver:u,registerSettingsCommand:e=>Ke(`settings`,e,{isActive:bi}),HostDropdown:Fn,LocalIcon:Yn,LoadingSection:ft,SectionTitle:pt,CloudPreferencesError:Un,SectionContainer:Ct,Outlet:oe,Redirect:ue,DocumentTitle:gn,Sidebar:Br,Content:vt,Shell:an,UnsavedChangesDialog:jn}),{})}');
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
