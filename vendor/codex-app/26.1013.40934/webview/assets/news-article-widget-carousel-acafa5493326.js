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
//#region NewsArticleWidgetCarousel.dil.tsx
	function ResolvedNewsCarousel({ state }) {
		const isSm = DIL.useBreakpoint("sm");
		const isMobile = DIL.useIsMobile();
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("box", {
			minWidth: 0,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("carousel", {
			gap: 3,
			showArrows: !isMobile
		}, state.items.map((item) => /* @__PURE__ */ __dil.jsx("carousel-item", {
			key: item.ref,
			width: isSm ? 342 : "84%",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: item.url,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			ariaLabel: \`Open \${item.title}\`,
			onClick: () => GenUI.dispatchAction({
				type: "open_url",
				handler: "client",
				payload: {
					url: item.url,
					event_name: "news_article_widget_carousel_item_clicked",
					event_data: {
						widget_name: "news_article_widget_carousel",
						ref: item.ref,
						url: item.url,
						domain: item.domain
					}
				}
			})
		}, /* @__PURE__ */ __dil.jsx("card", {
			width: "100%",
			size: "sm",
			padding: 4,
			gap: 4,
			shadow: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			minWidth: 0,
			align: "start",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			minWidth: 0,
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("favicon", {
			url: item.url,
			size: 20
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			truncate: true,
			maxLines: 1
		}, item.source_label)), /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			maxLines: 3
		}, item.title)), item.thumbnail_url && /* @__PURE__ */ __dil.jsx("image", {
			src: item.thumbnail_url,
			alt: item.title,
			width: 100,
			height: 100,
			radius: "lg",
			fit: "cover",
			hideOnFailure: true
		})), item.snippet && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("divider", null), /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 1
		}, item.date_label && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary"
		}, item.date_label), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "prose",
			maxLines: 4
		}, item.snippet)))))))))));
	}
	function NewsArticleWidgetCarousel(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("NewsArticleWidgetCarousel", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 220
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedNewsCarousel, { state });
	}

//#endregion
return NewsArticleWidgetCarousel;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=news-article-widget-carousel-acafa5493326.js.map