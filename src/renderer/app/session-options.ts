import type { ThreadSettingsResponse } from '../../../lib/codex-protocol.ts';
import type { SubmitOptions } from '../workbench-contract.ts';

/** A resume/settings notification supplies the backend's authoritative session defaults. */
export function sessionOptions(settings: ThreadSettingsResponse): SubmitOptions {
  const mode = typeof settings.collaborationMode === 'string' ? settings.collaborationMode : settings.collaborationMode?.mode;
  const sandboxMode = settings.sandbox?.type === 'dangerFullAccess' ? 'danger-full-access' :
    settings.sandbox?.type === 'workspaceWrite' ? 'workspace-write' : settings.sandbox?.type === 'readOnly' ? 'read-only' : undefined;
  return {
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.reasoningEffort !== undefined ? { effort: settings.reasoningEffort } : {}),
    ...(settings.approvalPolicy ? { approvalPolicy: settings.approvalPolicy } : {}),
    ...(settings.approvalsReviewer ? { approvalsReviewer: settings.approvalsReviewer } : {}),
    ...(settings.activePermissionProfile?.id ? { permissionProfileId: settings.activePermissionProfile.id } : {}),
    ...(sandboxMode ? { sandboxMode } : {}),
    ...(settings.serviceTier !== undefined ? { serviceTier: settings.serviceTier } : {}),
    ...(mode === 'default' || mode === 'plan' ? { mode } : {}),
  };
}
