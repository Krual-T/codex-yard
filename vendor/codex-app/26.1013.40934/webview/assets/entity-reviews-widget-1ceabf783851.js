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
//#region internal/PlacesEntity.dil.tsx
	function EntityActionSurface({ action, label, children }) {
		return action ? /* @__PURE__ */ __dil.jsx(LinkImpression, {
			action,
			width: "100%",
			height: "100%"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height: "100%",
			padding: 0,
			gap: 0,
			background: "transparent",
			border: 0,
			radius: "none",
			ariaLabel: label,
			onClick: () => GenUI.dispatchAction(action)
		}, children)) : /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: "100%",
			gap: 0
		}, children);
	}

//#endregion
//#region internal/PlacesReviews.dil.tsx
	const SvgPath = "path";
	function ReviewStar({ half = false, color = "primary", size = 13 }) {
		return /* @__PURE__ */ __dil.jsx("svg", {
			viewBox: "0 0 24 24",
			size,
			color
		}, /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: half ? "M12 17.27 12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27Z" : "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27Z",
			fill: "currentColor"
		}));
	}
	function ReviewCardBody({ card }) {
		const { isDark } = DIL.useTheme();
		const logo = typeof card.provider_logo_src === "string" ? card.provider_logo_src : isDark ? card.provider_logo_src?.dark : card.provider_logo_src?.light;
		return card.kind === "summary" ? /* @__PURE__ */ __dil.jsx("col", {
			height: "100%",
			justify: "between",
			gap: 2,
			padding: 3
		}, logo ? /* @__PURE__ */ __dil.jsx("image", {
			src: logo,
			alt: card.provider ? card.provider + " logo" : "",
			width: card.provider_logo_width,
			height: 18,
			fit: "contain",
			hideOnFailure: true
		}) : null, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("text", {
			size: "xl",
			weight: "semibold",
			maxLines: 1
		}, card.rating_label), /* @__PURE__ */ __dil.jsx("row", {
			gap: .5,
			align: "center",
			wrap: "nowrap"
		}, card.stars.map((star, index) => /* @__PURE__ */ __dil.jsx(ReviewStar, {
			key: index,
			half: star.half
		}))))) : /* @__PURE__ */ __dil.jsx("col", {
			height: "100%",
			justify: "between",
			gap: 2,
			padding: 3
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "primary",
			maxLines: 4
		}, card.text), /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "center",
			wrap: "nowrap"
		}, card.stars.length > 0 ? /* @__PURE__ */ __dil.jsx("row", {
			gap: .25,
			align: "center",
			wrap: "nowrap"
		}, card.stars.map((star, index) => /* @__PURE__ */ __dil.jsx(ReviewStar, {
			key: index,
			color: star.filled ? "secondary" : "tertiary"
		}))) : null, card.time_label ? /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			maxLines: 1
		}, card.time_label) : null));
	}
	function EntityReviewsPresentation({ state }) {
		const hasLoggedImpression = DIL.useRef(false);
		const isMobile = DIL.useIsMobile();
		if (state.cards.length === 0) return null;
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			...GenUI.logEvent ? {
				onVisibleWhen: !hasLoggedImpression.current,
				onVisible: () => {
					hasLoggedImpression.current = true;
					GenUI.logEvent?.({
						event_name: "entity_reviews_widget_shown",
						statsig_event_name: "entity_reviews_widget_shown",
						event_data: { widget_name: "entity_reviews" }
					});
				}
			} : {}
		}, /* @__PURE__ */ __dil.jsx("carousel", {
			gap: 2,
			showArrows: !isMobile
		}, state.cards.map((card) => /* @__PURE__ */ __dil.jsx("carousel-item", {
			key: card.id,
			variant: "outline",
			width: card.kind === "summary" ? 128 : 220,
			minWidth: card.kind === "summary" ? 128 : 220,
			height: 128,
			radius: "2xl",
			padding: 0
		}, /* @__PURE__ */ __dil.jsx(EntityActionSurface, {
			action: card.url ? {
				handler: "client",
				type: "open_url",
				payload: { url: card.url }
			} : null,
			label: card.kind === "summary" ? (card.provider ?? "") + " " + (card.rating_label ?? "") : card.text ?? ""
		}, /* @__PURE__ */ __dil.jsx(ReviewCardBody, { card }))))));
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
//#region EntityReviewsWidget.dil.tsx
	function EntityReviewsWidget(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("EntityReviewsWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 128
		});
		return /* @__PURE__ */ __dil.jsx(EntityReviewsPresentation, { state });
	}

//#endregion
return EntityReviewsWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=entity-reviews-widget-1ceabf783851.js.map