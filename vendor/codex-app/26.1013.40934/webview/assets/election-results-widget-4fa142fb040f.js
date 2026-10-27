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
//#region ElectionResults.dil.tsx
	function UpdatedAtLabel({ state }) {
		const now = DIL.useNow(state.updated_at != null);
		let label = state.retrieved_label;
		if (state.updated_at && state.updated_label_template) try {
			const updatedAt = new Date(state.updated_at);
			const today = new Date(now);
			const isToday = updatedAt.getFullYear() === today.getFullYear() && updatedAt.getMonth() === today.getMonth() && updatedAt.getDate() === today.getDate();
			const timestamp = new Intl.DateTimeFormat(state.locale, {
				...isToday ? {} : { dateStyle: "medium" },
				timeStyle: "short"
			}).format(updatedAt);
			label = state.updated_label_template.replace("{timestamp}", timestamp);
		} catch {}
		return /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "tertiary"
		}, label);
	}
	function ElectionResults(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("ElectionResults", props);
		const host = DIL.useAppData();
		const canRefresh = host.opGenui?.nativeServerActions?.ready === true && host.opGenui?.nativeServerActions?.refreshVisible === true;
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 480
		});
		return /* @__PURE__ */ __dil.jsx(ElectionResultsView, {
			source: state,
			canRefresh
		});
	}
	function ElectionResultsView({ source, canRefresh }) {
		const sourceKey = JSON.stringify(source);
		const [refreshed, setRefreshed] = DIL.useState(null);
		const state = refreshed?.source === sourceKey ? refreshed.state : source;
		const [expanded, setExpanded] = DIL.useState(source.expanded);
		const wide = DIL.useBreakpoint("sm");
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			padding: 5
		}, /* @__PURE__ */ __dil.jsx(ElectionResultsRefresh, {
			key: sourceKey,
			enabled: canRefresh && (state.refresh_interval_ms ?? 0) > 0,
			intervalMs: state.refresh_interval_ms ?? 0,
			onRefresh: (next) => setRefreshed({
				source: sourceKey,
				state: next
			}),
			onRefreshDisabled: () => setRefreshed({
				source: sourceKey,
				state: {
					...state,
					refresh_interval_ms: 0
				}
			})
		}), /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			justify: "between",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("title", { size: "lg" }, state.title)), state.status_label ? state.provider_status === "unofficial-partial" ? /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "end",
			gap: 1.2,
			height: 26,
			flex: "none"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 14,
			height: 14,
			background: "red-75",
			radius: "full",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 8,
			height: 8,
			background: "red-400",
			radius: "full"
		})), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "semibold",
			color: "red-400"
		}, state.status_label)) : /* @__PURE__ */ __dil.jsx("badge", {
			color: state.provider_status === "certified" ? "success" : state.provider_status === "unofficial-complete" ? "info" : "secondary",
			variant: "soft",
			size: "sm"
		}, state.status_label) : null), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.subtitle), state.geography ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.geography) : null, /* @__PURE__ */ __dil.jsx("divider", { spacing: 0 })), /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, (expanded ? state.candidates : state.candidates.slice(0, 4)).map((candidate) => /* @__PURE__ */ __dil.jsx("col", {
			key: candidate.candidate_id,
			gap: 3,
			padding: { bottom: 1 }
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			justify: "between",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "semibold"
		}, candidate.name), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "tertiary"
		}, candidate.party)), /* @__PURE__ */ __dil.jsx("col", {
			gap: .5,
			align: "end"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "semibold"
		}, candidate.share_label), /* @__PURE__ */ __dil.jsx("pressable", {
			inline: true,
			padding: 0,
			tooltip: candidate.votes_label
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "tertiary"
		}, candidate.compact_votes_label)))), /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: 8,
			radius: "full",
			background: "surface-tertiary"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: candidate.bar_width,
			height: 8,
			radius: "full",
			background: candidate.color
		}))))), state.candidates.length > 4 ? /* @__PURE__ */ __dil.jsx("box", { padding: { top: 2 } }, /* @__PURE__ */ __dil.jsx("button", {
			variant: "outline",
			size: "lg",
			block: true,
			onClick: () => setExpanded(!expanded)
		}, expanded ? state.less_label : state.more_label)) : null, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			padding: { top: 1 }
		}, /* @__PURE__ */ __dil.jsx("box", {
			direction: wide ? "row" : "col",
			align: "start",
			gap: 1,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "tertiary"
		}, state.source_label + " ", /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: state.source_url,
			inline: true
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			inline: true,
			role: "link",
			padding: 0,
			onClick: () => GenUI.openUrl(state.source_url)
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "xs",
			color: "tertiary"
		}, state.source_name)))), state.retrieved_label !== null ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, wide ? /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "tertiary"
		}, "•") : null, /* @__PURE__ */ __dil.jsx(UpdatedAtLabel, { state })) : null), state.test_label ? /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, state.test_label) : null)));
	}
	function ElectionResultsRefresh({ enabled, intervalMs, onRefresh, onRefreshDisabled }) {
		const now = DIL.useNow(enabled);
		const nextAttempt = DIL.useRef(now + intervalMs);
		const pending = DIL.useRef(false);
		const active = DIL.useRef(false);
		DIL.useEffect(() => {
			active.current = enabled;
			return () => {
				active.current = false;
			};
		}, [enabled]);
		DIL.useEffect(() => {
			if (!enabled || pending.current || now < nextAttempt.current || !GenUI.refresh) return;
			pending.current = true;
			let nextIntervalMs = intervalMs;
			GenUI.refresh().then((result) => {
				if (result.status !== "success") return;
				const response = result.response;
				if (active.current && response?.status === "success" && response.data) {
					nextIntervalMs = response.data.refresh_interval_ms ?? 0;
					if (response.data.refresh_disabled) onRefreshDisabled();
					else onRefresh(response.data);
				}
			}).catch(() => {}).finally(() => {
				pending.current = false;
				nextAttempt.current = Date.now() + nextIntervalMs;
			}).catch(() => {});
		}, [enabled, now]);
		return null;
	}

//#endregion
return ElectionResults;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=election-results-widget-4fa142fb040f.js.map