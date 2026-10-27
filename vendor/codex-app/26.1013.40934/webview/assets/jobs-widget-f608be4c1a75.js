import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


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
//#region JobsWidget.dil.tsx
	function JobsWidget(props) {
		const isDesktop = DIL.useBreakpoint("sm");
		const { resolutionComplete, state } = useResolvedComponentResult("JobsWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 220
		});
		const labels = {
			linkedin: "Apply on LinkedIn",
			indeed: "Apply on Indeed",
			upwork: "Apply on Upwork",
			ziprecruiter: "Apply on ZipRecruiter"
		};
		const metadata = [
			{
				label: "Location",
				value: state.location,
				icon: "map-pin"
			},
			{
				label: "Pay",
				value: state.salary,
				icon: "banknote"
			},
			{
				label: "Term",
				value: state.employment_type,
				icon: "briefcase"
			}
		].filter((item) => item.value != null);
		const heading = /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			gap: isDesktop ? "4px" : "6px",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: isDesktop ? "6px" : "4px"
		}, state.company_logo_url != null && /* @__PURE__ */ __dil.jsx("image", {
			src: state.company_logo_url,
			alt: state.company != null ? \`\${state.company} logo\` : "",
			fit: "contain",
			hideOnFailure: true,
			radius: "sm",
			width: 20,
			height: 20
		}), state.company != null && /* @__PURE__ */ __dil.jsx("text", {
			color: "primary",
			maxLines: 1,
			size: "sm",
			truncate: true,
			weight: "medium"
		}, state.company)), /* @__PURE__ */ __dil.jsx("title", {
			color: "primary",
			size: "lg",
			weight: "medium"
		}, state.title));
		const apply = /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: state.apply_url_with_tracking,
			width: isDesktop ? "fit-content" : "100%"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			align: "center",
			background: "gray-1000",
			justify: "center",
			width: isDesktop ? "fit-content" : "100%",
			padding: {
				x: 3,
				y: isDesktop ? 2 : 2.5
			},
			radius: "full",
			onClick: () => GenUI.dispatchAction({
				type: "open_url",
				handler: "client",
				payload: {
					url: state.apply_url_with_tracking,
					event_name: "jobs_widget_apply_clicked",
					statsig_event_name: "jobs_widget_apply_clicked",
					event_data: {
						widget_name: "jobs_widget",
						provider: state.source
					}
				}
			})
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "gray-0",
			maxLines: 1,
			size: "sm",
			weight: "medium",
			textAlign: "center"
		}, labels[state.source] ?? "Apply")));
		return /* @__PURE__ */ __dil.jsx("card", {
			background: "surface-elevated",
			gap: 0,
			onVisible: () => GenUI.dispatchAction({
				type: "log_event",
				handler: "client",
				payload: {
					event_name: "jobs_widget_impression",
					statsig_event_name: "jobs_widget_impression",
					event_data: {
						widget_name: "jobs_widget",
						provider: state.source
					}
				}
			}),
			padding: isDesktop ? 6 : 5,
			size: "full"
		}, /* @__PURE__ */ __dil.jsx("col", { gap: isDesktop ? 2.5 : 3 }, isDesktop ? /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 3,
			justify: "between",
			wrap: "nowrap"
		}, heading, apply) : heading, /* @__PURE__ */ __dil.jsx("box", { padding: isDesktop ? { y: 1 } : 0 }, /* @__PURE__ */ __dil.jsx("box", {
			background: "border",
			height: 1
		})), (metadata.length > 0 || state.role_summary != null) && /* @__PURE__ */ __dil.jsx("col", { gap: isDesktop ? 2 : 3 }, metadata.length > 0 && /* @__PURE__ */ __dil.jsx("row", {
			align: isDesktop ? "center" : "start",
			gap: 4,
			wrap: isDesktop ? "wrap" : "nowrap"
		}, metadata.map((item) => isDesktop ? /* @__PURE__ */ __dil.jsx("row", {
			key: item.label,
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: item.icon,
			color: "secondary",
			size: "md"
		}), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "xs",
			weight: "normal"
		}, item.value)) : /* @__PURE__ */ __dil.jsx("col", {
			key: item.label,
			flex: 1,
			gap: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "tertiary",
			size: "sm",
			weight: "normal"
		}, item.label), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm",
			weight: "normal"
		}, item.value)))), !isDesktop && state.role_summary != null && /* @__PURE__ */ __dil.jsx("box", {
			background: "border",
			height: 1
		}), state.role_summary != null && /* @__PURE__ */ __dil.jsx("text", {
			color: "primary",
			size: "md"
		}, state.role_summary)), !isDesktop && apply));
	}

//#endregion
return JobsWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=jobs-widget-f608be4c1a75.js.map