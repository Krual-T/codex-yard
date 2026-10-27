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
//#region ArtistUpcomingEventsWidget.dil.tsx
	function ArtistUpcomingEventsWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("ArtistUpcomingEventsWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 240
		});
		if (state.events.length === 0) return null;
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100vw",
			maxWidth: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("title", { size: "md" }, state.heading), state.fallback_message && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.fallback_message), /* @__PURE__ */ __dil.jsx("box", { width: "100%" }, state.events.map((event) => /* @__PURE__ */ __dil.jsx("col", {
			key: event.id,
			width: "100%",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			gap: 3,
			padding: { y: 3 },
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 56,
			height: 64,
			background: "surface-secondary",
			border: {
				size: 1,
				color: "default"
			},
			radius: "lg",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "semibold"
		}, event.month), /* @__PURE__ */ __dil.jsx("text", {
			size: "xl",
			weight: "semibold"
		}, event.day))), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("text", { weight: "semibold" }, event.venue ?? event.title), /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			wrap: "wrap"
		}, event.location && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, event.location), event.location != null && event.time != null && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, "·"), event.time && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, event.time))), event.ticket_url != null ? /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: event.ticket_url,
			inline: true
		}, /* @__PURE__ */ __dil.jsx("button", {
			color: "primary",
			variant: "outline",
			size: "sm",
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "open_url",
				payload: { url: event.ticket_url }
			})
		}, state.view_tickets_label, /* @__PURE__ */ __dil.jsx("icon", { name: "arrow-up-right" }))) : event.detail_url != null && /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: event.detail_url,
			inline: true
		}, /* @__PURE__ */ __dil.jsx("button", {
			color: "secondary",
			variant: "outline",
			size: "sm",
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "open_url",
				payload: { url: event.detail_url }
			})
		}, state.event_details_label))), /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: 1,
			background: "border"
		})))), /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary"
		}, "Concert data provided by"), /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: "https://www.jambase.com/?utm_source=chatgpt.com",
			inline: true
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			inline: true,
			ariaLabel: "Open JamBase",
			onClick: () => GenUI.dispatchAction({
				type: "open_url",
				handler: "client",
				payload: {
					url: "https://www.jambase.com/?utm_source=chatgpt.com",
					event_name: "link_widget_clicked",
					event_data: {
						widget_name: "artist_upcoming_events_widget",
						url: "https://www.jambase.com/?utm_source=chatgpt.com"
					}
				}
			})
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "xs",
			color: "secondary",
			underline: true
		}, "JamBase"))))));
	}

//#endregion
return ArtistUpcomingEventsWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=artist-upcoming-events-widget-66a2cd95de8a.js.map