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
//#region internal/text-only-markdown.dil.tsx
/** Host-rendered text formatting, without link navigation or image loading. */
	function TextOnlyMarkdown({ children }) {
		return /* @__PURE__ */ __dil.jsx("text-only-markdown", null, children);
	}

//#endregion
//#region shared.dil.ts
	function useIsLiveActivity() {
		return DIL.useAppData((appData) => appData.opGenui?.surface === "live-activity");
	}
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
//#region internal/reddit.dil.tsx
	function RedditView({ state }) {
		const isWide = DIL.useBreakpoint("md");
		const isLiveActivity = useIsLiveActivity();
		function logQuoteImpression(item) {
			GenUI.logEvent?.({
				event_name: "reddit_quote_shown",
				event_data: {
					source_url: item.source_url,
					refid: item.refid,
					widget_name: state.widget_name,
					surface: "widget"
				}
			});
		}
		if (isLiveActivity) {
			const item = state.items[0];
			if (!item) return null;
			return /* @__PURE__ */ __dil.jsx("box", {
				theme: "dark",
				background: "surface"
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "stretch",
				width: "100%",
				gap: 2,
				padding: 2,
				...GenUI.logEvent ? { onVisible: () => logQuoteImpression(item) } : {}
			}, /* @__PURE__ */ __dil.jsx("box", {
				width: 3,
				minWidth: 3,
				background: "orange-500",
				radius: "full"
			}), /* @__PURE__ */ __dil.jsx("col", {
				gap: .5,
				minWidth: 0,
				flex: 1
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary",
				truncate: true
			}, item.subreddit ?? "Reddit"), /* @__PURE__ */ __dil.jsx("box", {
				width: "100%",
				maxHeight: 36,
				clip: true
			}, /* @__PURE__ */ __dil.jsx(TextOnlyMarkdown, null, item.quote)))));
		}
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			minWidth: 0,
			align: "stretch",
			gap: "24px",
			direction: isWide ? "row" : "col"
		}, state.items.map((item, index) => /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: item.source_url ?? "https://www.reddit.com",
			key: \`\${item.refid}:\${index}\`,
			width: "100%",
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			key: \`\${item.refid}:\${index}\`,
			width: "100%",
			minWidth: 0,
			flex: 1,
			onClick: () => GenUI.dispatchAction({
				type: "open_url",
				handler: "client",
				payload: {
					url: item.source_url ?? "https://www.reddit.com",
					event_name: "reddit_quote_clicked",
					event_data: {
						widget_name: state.widget_name ?? "reddit",
						refid: item.refid,
						source_url: item.source_url,
						subreddit: item.subreddit
					}
				}
			})
		}, /* @__PURE__ */ __dil.jsx("box", {
			direction: "row",
			width: "100%",
			height: "100%",
			align: "stretch",
			gap: "16px",
			...GenUI.logEvent ? { onVisible: () => logQuoteImpression(item) } : {}
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 4,
			minWidth: 4,
			background: {
				light: "gray-100",
				dark: "gray-300"
			},
			radius: "full"
		}), /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			minWidth: 0,
			flex: 1
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("favicon", {
			url: item.source_url ?? "https://www.reddit.com",
			size: 16
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "prose"
		}, "Reddit"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary"
		}, "•"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary",
			truncate: true,
			maxLines: 1
		}, item.subreddit ?? "Reddit"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, "›")), /* @__PURE__ */ __dil.jsx(TextOnlyMarkdown, null, item.quote)))))));
	}

//#endregion
//#region Reddit.dil.tsx
	function Reddit(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("Reddit", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 120
		});
		return /* @__PURE__ */ __dil.jsx(RedditView, { state });
	}

//#endregion
return Reddit;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=reddit-1de1a85e25de.js.map