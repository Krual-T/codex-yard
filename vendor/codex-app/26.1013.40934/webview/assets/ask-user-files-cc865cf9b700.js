import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region shared.dil.ts
	function useResolvedComponentResult(componentName, props) {
		const opGenui = DIL.useAppData((appData) => appData.opGenui);
		if (props.__state !== void 0) return {
			status: "resolved",
			resolutionComplete: true,
			state: props.__state
		};
		const key = componentDataKey(componentName, props);
		const result = (typeof props.__resolutionId === "string" ? opGenui?.componentResults?.[props.__resolutionId] : void 0) ?? opGenui?.componentResults?.[key];
		if (isComponentResultEnvelope(result)) {
			if (result.status === "pending") return {
				status: "pending",
				resolutionComplete: false,
				state: void 0
			};
			return result.status === "resolved" ? {
				status: "resolved",
				resolutionComplete: true,
				state: result.state
			} : {
				status: "failed",
				resolutionComplete: true,
				state: void 0
			};
		}
		const legacyState = opGenui?.componentData?.[key];
		if (legacyState !== void 0) return {
			status: "resolved",
			resolutionComplete: true,
			state: legacyState
		};
		if (opGenui?.componentResults !== void 0) return {
			status: "failed",
			resolutionComplete: true,
			state: void 0
		};
		if (opGenui?.componentData !== void 0) return {
			status: "resolved",
			resolutionComplete: true,
			state: void 0
		};
		return {
			status: "pending",
			resolutionComplete: false,
			state: void 0
		};
	}
	function isComponentResultEnvelope(value) {
		if (typeof value !== "object" || value == null || Array.isArray(value)) return false;
		const result = value;
		if (result.status === "pending") return true;
		if (result.status === "resolved") return typeof result.state === "object" && result.state != null && !Array.isArray(result.state);
		return result.status === "failed" && (result.code === "component_unavailable" || result.code === "tool_failed" || result.code === "invalid_tool_result") && typeof result.retryable === "boolean";
	}
	function componentDataKey(componentName, props) {
		return JSON.stringify([componentName, normalizeComponentProps(props)]);
	}
	function normalizeComponentProps(props) {
		const normalized = {};
		for (const key of Object.keys(props).sort()) {
			if (key === "__resolutionId" || key === "__state" || key === "children" || key === "fallback") continue;
			const value = normalizeComponentValue(props[key]);
			if (value !== void 0) normalized[key] = value;
		}
		return normalized;
	}
	function normalizeComponentValue(value) {
		if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
		if (Array.isArray(value)) return value.map(normalizeComponentValue);
		if (typeof value === "object") {
			const normalized = {};
			for (const key of Object.keys(value).sort()) {
				const nestedValue = normalizeComponentValue(value[key]);
				if (nestedValue !== void 0) normalized[key] = nestedValue;
			}
			return normalized;
		}
	}

//#endregion
//#region AskUserFiles.dil.tsx
	function AskUserFiles(props) {
		const supportedClientActions = DIL.useAppData((data) => data.opGenui?.supportedClientActions);
		const { state, resolutionComplete } = useResolvedComponentResult("AskUserFiles", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: 180,
			height: 40
		});
		if (!state.show_upload_cta) return null;
		const isFile = state.kind === "file";
		const uploadAction = isFile ? "request_file_upload" : "request_media_upload";
		const uploadAvailable = supportedClientActions?.includes(uploadAction);
		const uploadEnabled = uploadAvailable ?? true;
		const label = isFile ? state.file_label : state.kind === "video" ? state.video_label : state.kind === "media" ? state.media_label : state.photo_label;
		return /* @__PURE__ */ __dil.jsx("box", {
			align: "start",
			...GenUI.logEvent ? {
				onVisibleWhen: uploadAvailable === true,
				onVisible: () => GenUI.logEvent?.({ event_data: {
					requested_kind: state.kind,
					elicitation_metadata: {
						elicitation_type: "file_upload",
						stage: "shown"
					}
				} })
			} : {}
		}, /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			variant: "outline",
			color: "primary",
			disabled: !uploadEnabled,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: uploadAction,
				payload: {
					event_name: "ChatgptWebPhotoUploadActionClicked",
					statsig_event_name: "chatgpt_web_photo_upload_action_clicked",
					event_data: {
						requested_kind: state.kind,
						impression_event: "chatgpt_web_photo_upload_action_enabled_impression",
						elicitation_metadata: {
							elicitation_type: "file_upload",
							stage: "interacted",
							action: "accept"
						}
					}
				}
			})
		}, /* @__PURE__ */ __dil.jsx("icon", { name: isFile ? "paperclip" : state.kind === "video" ? "video" : "image" }), label));
	}

//#endregion
return AskUserFiles;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=ask-user-files-cc865cf9b700.js.map