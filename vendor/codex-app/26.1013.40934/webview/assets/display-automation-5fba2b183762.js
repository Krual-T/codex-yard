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
//#region internal/LinkImpression.dil.tsx
/** Observe the rendered link without invoking its click action. */
	function LinkImpression({ url, action, careProvider, disabled, unlessSupportedAction, children, ...boxProps }) {
		const opGenui = DIL.useAppData((data) => data.opGenui);
		const shownUrls = DIL.useRef([]);
		const payload = action?.payload;
		const actionUrl = action?.type === "open_url" && (action.handler === void 0 || action.handler === "client") && !(typeof payload === "object" && payload !== null && "action" in payload && typeof payload.action === "string" && payload.action !== "open_url") && typeof payload === "object" && payload !== null && "url" in payload && typeof payload.url === "string" ? payload.url : void 0;
		const destination = action ? actionUrl : url;
		if (disabled || unlessSupportedAction && opGenui?.supportedClientActions?.includes(unlessSupportedAction) || typeof destination !== "string" || !destination.trim() || !opGenui?.supportedClientActions?.includes("genui_link_impressions")) return /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, children);
		const linkType = opGenui.linkMetadataByUrl?.[destination.trim()]?.linkType;
		if (linkType !== void 0 && typeof linkType !== "string") return /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, children);
		return /* @__PURE__ */ __dil.jsx("box", {
			...boxProps,
			onVisibleKey: destination,
			onVisible: () => {
				if (shownUrls.current.includes(destination)) return;
				const careOrigin = careProvider ? /^(https?):\\/\\/(?:[^\\\\/?#]*@)?([^\\\\/?#]+)/i.exec(destination.trim()) : null;
				if (careProvider && !careOrigin) return;
				const telemetryUrl = careOrigin ? \`\${careOrigin[1]}://\${careOrigin[2]}\` : destination;
				shownUrls.current = [...shownUrls.current, destination];
				GenUI.dispatchAction({
					handler: "client",
					type: "log_event",
					payload: {
						event_name: "genui_link_shown",
						event_data: {
							url: telemetryUrl,
							is_care_provider_link: careProvider,
							link_type: linkType?.toLowerCase() ?? "general_external"
						}
					}
				});
			}
		}, children);
	}

//#endregion
//#region internal/automation-widgets.dil.tsx
	function AutomationResourceCardView({ item }) {
		const [hovered, setHovered] = DIL.useState(false);
		const { isDark } = DIL.useTheme();
		const showNewUI = item.show_new_pill_and_widget_ui === true;
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: showNewUI ? "fit-content" : "100%",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("card", {
			variant: showNewUI ? void 0 : "soft",
			radius: showNewUI ? "24px" : "16px",
			width: "100%",
			padding: 0,
			gap: 0,
			background: showNewUI ? "surface-elevated" : "surface-secondary",
			shadow: true,
			shadowStyle: showNewUI ? isDark ? "0 0 0 1px var(--color-border)" : "0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 16px 0 rgba(0, 0, 0, 0.05)" : void 0
		}, /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: item.url,
			width: "100%",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			padding: showNewUI ? {
				x: 4,
				y: 3
			} : 3,
			minWidth: 0,
			minHeight: showNewUI ? 70 : void 0,
			align: showNewUI ? "stretch" : void 0,
			radius: showNewUI ? "24px" : void 0,
			variant: showNewUI ? "ghost" : void 0,
			background: showNewUI ? void 0 : hovered ? "surface-tertiary" : "transparent",
			onHover: showNewUI ? void 0 : setHovered,
			ariaLabel: \`\${item.title}, \${item.schedule_label}\`,
			onClick: () => GenUI.openUrl(item.url)
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			gap: showNewUI ? 2 : 2.5,
			align: "center",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: showNewUI ? 36 : void 0,
			width: showNewUI ? void 0 : 40,
			height: showNewUI ? void 0 : 40,
			flex: "none",
			align: "center",
			justify: "center",
			radius: showNewUI ? void 0 : "8px",
			background: showNewUI ? void 0 : "surface",
			ariaHidden: true
		}, item.emoji ? /* @__PURE__ */ __dil.jsx("text", {
			size: "xl",
			fontSize: 24,
			lineHeight: 32
		}, item.emoji) : /* @__PURE__ */ __dil.jsx("svg", {
			width: 24,
			height: 24,
			viewBox: "0 0 24 24",
			color: "secondary"
		}, /* @__PURE__ */ __dil.jsx("path", { d: "M12 6.25C12.4142 6.25003 12.75 6.58581 12.75 7V11.793C12.75 12.1244 12.6182 12.4424 12.3838 12.6768L10.0303 15.0303C9.73739 15.3232 9.26262 15.3231 8.96973 15.0303C8.67683 14.7374 8.67683 14.2626 8.96973 13.9697L11.25 11.6895V7C11.25 6.58579 11.5858 6.25 12 6.25Z" }), /* @__PURE__ */ __dil.jsx("path", { d: "M12 2.25C17.3848 2.25 21.75 6.61522 21.75 12C21.75 17.3848 17.3848 21.75 12 21.75C6.61522 21.75 2.25 17.3848 2.25 12C2.25 6.61522 6.61522 2.25 12 2.25ZM12 3.75C7.44365 3.75 3.75 7.44365 3.75 12C3.75 16.5563 7.44365 20.25 12 20.25C16.5563 20.25 20.25 16.5563 20.25 12C20.25 7.44365 16.5563 3.75 12 3.75Z" }))), /* @__PURE__ */ __dil.jsx("col", {
			gap: showNewUI ? .5 : 0,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: showNewUI ? void 0 : "medium",
			color: showNewUI ? void 0 : "primary",
			lineHeight: 24,
			truncate: true
		}, item.title), /* @__PURE__ */ __dil.jsx("text", {
			size: showNewUI ? "sm" : "md",
			fontSize: showNewUI ? void 0 : 15,
			lineHeight: showNewUI ? void 0 : 22.5,
			color: showNewUI ? "tertiary" : "secondary",
			truncate: true
		}, item.schedule_label)), showNewUI ? /* @__PURE__ */ __dil.jsx("box", {
			flex: "none",
			align: "center",
			justify: "center",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "pencil",
			size: "2xl",
			color: "tertiary"
		})) : item.open_label ? /* @__PURE__ */ __dil.jsx("box", {
			flex: "none",
			height: 36,
			padding: { x: 2 },
			align: "center",
			justify: "center",
			radius: "8px",
			border: {
				size: 1,
				color: "default"
			}
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "primary",
			lineHeight: 18
		}, item.open_label)) : null)))));
	}

//#endregion
//#region DisplayAutomation.dil.tsx
	function DisplayAutomation(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("DisplayAutomation", props);
		const [submitted, setSubmitted] = DIL.useState(false);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 70.5,
			radius: "16px"
		});
		const prompt = state.prompt ?? "";
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 3,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx(AutomationResourceCardView, { item: state }), state.show_new_pill_and_widget_ui && prompt.trim() ? /* @__PURE__ */ __dil.jsx("button", {
			variant: "outline",
			color: "primary",
			size: "xl",
			disabled: submitted,
			onClick: () => {
				if (submitted) return;
				setSubmitted(true);
				GenUI.issueNewTurn(prompt);
			}
		}, state.run_now_label) : null);
	}

//#endregion
return DisplayAutomation;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=display-automation-5fba2b183762.js.map