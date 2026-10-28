/** @jsxRuntime classic */
import type { ComponentType, ReactNode, Ref } from 'react';

type MessageDescriptor = { id: string; defaultMessage: string; description: string; values?: { count: number } };
type ReviewStats = { rejectedCount: number };
export type AssistantMemoryCitation = { path: string; lineStart: number; lineEnd: number; note: string };
type FocusEvent = { preventDefault: () => void };

export type AssistantMessageOverflowProps<AutoReviewStats extends ReviewStats, HookStats, Citation extends AssistantMemoryCitation> = {
  autoReviewStats?: AutoReviewStats | null;
  hookStats?: HookStats | null;
  memoryCitationEntries: Citation[];
  renderUsedSkillsDetails?: (close: () => void) => ReactNode;
  forkDisabled: boolean;
  forkLabel: string;
  isForking: boolean;
  onFork?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export type AssistantMessageOverflowDependencies<AutoReviewStats extends ReviewStats, HookStats, Asset> = {
  useIntl: () => { formatMessage: (message: MessageDescriptor) => string };
  MenuButton: ComponentType<{ ref?: Ref<HTMLButtonElement>; label: string; size: 'xs' }>;
  Menu: ComponentType<{ side: 'top'; open: boolean; onOpenChange: (open: boolean) => void;
    onCloseAutoFocus: (event: FocusEvent) => void; triggerButton: ReactNode; children: ReactNode }>;
  MenuItem: ComponentType<{ leftIcon?: ReactNode; leftIconAsset?: Asset; 'aria-label'?: string; 'aria-busy'?: boolean;
    disabled?: boolean; onSelect: () => void; children: ReactNode }>;
  BranchIcon: ComponentType;
  ReviewIcon: ComponentType;
  hookAsset: Asset;
  memoryAsset: Asset;
  skillAsset: Asset;
  FormattedMessage: ComponentType<MessageDescriptor>;
  Modal: ComponentType<{ autoFocusCloseButton: true; open: boolean; onOpenChange: (open: boolean) => void;
    size: 'wide' | 'xwideTall'; contentProps: { 'aria-describedby': undefined; onCloseAutoFocus: (event: FocusEvent) => void };
    children: ReactNode }>;
  AutoReviewDetails: ComponentType<{ stats: AutoReviewStats }>;
  HookDetails: ComponentType<{ stats: HookStats }>;
  DialogContainer: ComponentType<{ className: string; children: ReactNode }>;
  DialogSection: ComponentType<{ children: ReactNode }>;
  DialogHeader: ComponentType<{ title: ReactNode }>;
  DialogTitle: ComponentType<{ className: string; children: ReactNode }>;
};

export function createAssistantMessageOverflowComponent<AutoReviewStats extends ReviewStats, HookStats, Citation extends AssistantMemoryCitation, Asset>(
  React: typeof import('react'),
  dependencies: AssistantMessageOverflowDependencies<AutoReviewStats, HookStats, Asset>,
): ComponentType<AssistantMessageOverflowProps<AutoReviewStats, HookStats, Citation>> {
  const { useIntl, MenuButton, Menu, MenuItem, BranchIcon, ReviewIcon, hookAsset, memoryAsset, skillAsset,
    FormattedMessage, Modal, AutoReviewDetails, HookDetails, DialogContainer, DialogSection, DialogHeader, DialogTitle } = dependencies;
  return function AssistantMessageOverflow({ autoReviewStats, hookStats, memoryCitationEntries, renderUsedSkillsDetails,
    forkDisabled, forkLabel, isForking, onFork, open, onOpenChange }: AssistantMessageOverflowProps<AutoReviewStats, HookStats, Citation>) {
    const intl = useIntl();
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const [details, setDetails] = React.useState<'autoReview' | 'hooks' | 'memory' | 'skills' | null>(null);
    const showAutoReview = autoReviewStats?.rejectedCount === 0;
    if (onFork == null && !showAutoReview && hookStats == null && memoryCitationEntries.length === 0 && renderUsedSkillsDetails == null) return null;
    return <>
      <Menu side="top" open={open} onOpenChange={onOpenChange} onCloseAutoFocus={event => { if (details != null) event.preventDefault(); }}
        triggerButton={<MenuButton ref={triggerRef} label={intl.formatMessage({ id: 'assistantMessageContent.moreActions', defaultMessage: 'More actions', description: 'Accessible label for the overflow menu beneath a Codex response, containing branching and details about the turn' })} size="xs" />}>
        {onFork == null ? null : <MenuItem leftIcon={<BranchIcon />} aria-label={forkLabel} aria-busy={isForking || undefined}
          disabled={forkDisabled || isForking} onSelect={onFork}><FormattedMessage id="assistantMessageContent.branchInNewChatTooltip" defaultMessage="Branch in new chat" description="Tooltip for the button beneath an assistant message that branches the conversation into a new chat" /></MenuItem>}
        {showAutoReview ? <MenuItem leftIcon={<ReviewIcon />} onSelect={() => setDetails('autoReview')}><FormattedMessage id="assistantMessage.autoReviewStats.title" defaultMessage="Auto-review stats" description="Title for the auto-review stats dialog" /></MenuItem> : null}
        {hookStats == null ? null : <MenuItem leftIconAsset={hookAsset} onSelect={() => setDetails('hooks')}><FormattedMessage id="assistantMessage.hookStats.dialogTitle" defaultMessage="Hook stats" description="Title of the dialog showing hook runs for one completed turn" /></MenuItem>}
        {memoryCitationEntries.length === 0 ? null : <MenuItem leftIconAsset={memoryAsset} onSelect={() => setDetails('memory')}><FormattedMessage id="assistantMessage.memoryCitations.summary" defaultMessage="{count, plural, one {1 memory citation} other {# memory citations}}" description="Label for citations that explain which memory files informed an assistant message" values={{ count: memoryCitationEntries.length }} /></MenuItem>}
        {renderUsedSkillsDetails == null ? null : <MenuItem leftIconAsset={skillAsset} onSelect={() => setDetails('skills')}><FormattedMessage id="assistantMessage.usedSkills.label" defaultMessage="Skills" description="Accessible label for the indicator listing skills used in an assistant turn" /></MenuItem>}
      </Menu>
      <Modal autoFocusCloseButton={true} open={details != null} onOpenChange={value => { if (!value) setDetails(null); }}
        size={details === 'autoReview' || details === 'hooks' ? 'xwideTall' : 'wide'}
        contentProps={{ 'aria-describedby': undefined, onCloseAutoFocus: event => { event.preventDefault(); triggerRef.current?.focus(); } }}>
        {details === 'autoReview' && autoReviewStats != null ? <AutoReviewDetails stats={autoReviewStats} /> : null}
        {details === 'hooks' && hookStats != null ? <HookDetails stats={hookStats} /> : null}
        {details === 'memory' || details === 'skills' ? <DialogContainer className="select-none">
          <DialogSection><DialogHeader title={<DialogTitle className="contents">{details === 'memory'
            ? <FormattedMessage id="assistantMessage.memoryCitations.tooltipTitle" defaultMessage="Memories cited" description="Title for the list of memory citations in an assistant message tooltip" />
            : <FormattedMessage id="assistantMessage.usedSkills.title" defaultMessage="Skills" description="Title for the tooltip listing skills used in an assistant turn" />}</DialogTitle>} /></DialogSection>
          <DialogSection>{details === 'skills' ? renderUsedSkillsDetails?.(() => setDetails(null))
            : <ul className="flex min-w-0 list-disc flex-col gap-1 ps-4 text-secondary">{memoryCitationEntries.map((entry, index) => <li className="min-w-0" key={`${entry.path}:${entry.lineStart}-${entry.lineEnd}:${index}`}>{entry.note}</li>)}</ul>}</DialogSection>
        </DialogContainer> : null}
      </Modal>
    </>;
  };
}
