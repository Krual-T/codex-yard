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
//#region VisualCardCarouselWidget.dil.tsx
	function VisualCardText({ item }) {
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			padding: 3,
			minWidth: 0,
			width: "100%"
		}, item.title != null && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "semibold",
			underline: item.action_payload || item.url != null ? "dotted" : void 0,
			maxLines: 2,
			truncate: true
		}, item.title), item.caption && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			maxLines: 2,
			truncate: true
		}, item.caption), item.subtitle && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			maxLines: 2,
			truncate: true
		}, item.subtitle), item.source && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			maxLines: 1,
			truncate: true
		}, item.source), item.metadata && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			color: "secondary",
			maxLines: 2,
			truncate: true
		}, item.metadata), item.reason && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			maxLines: 3,
			truncate: true
		}, item.reason), item.summary && /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			maxLines: 3,
			truncate: true
		}, item.summary));
	}
	function VisualCardView({ state }) {
		const isMobile = DIL.useIsMobile();
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("title", { size: "sm" }, state.title), /* @__PURE__ */ __dil.jsx("carousel", {
			gap: 3,
			showArrows: !isMobile
		}, state.items.map((item, index) => /* @__PURE__ */ __dil.jsx("carousel-item", {
			key: item.url ?? item.title ?? item.query ?? index,
			width: "160px",
			minWidth: "160px",
			variant: "outline",
			background: "surface",
			gap: 0,
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			aspectRatio: "2/3",
			background: "surface-secondary",
			radius: {
				topLeft: "xl",
				topRight: "xl",
				bottomRight: "none",
				bottomLeft: "none"
			},
			clip: true
		}, item.image ? /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height: "100%",
			padding: 0,
			background: "transparent",
			border: 0,
			radius: "none",
			ariaLabel: item.title ?? item.query ?? "",
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "open_image_lightbox",
				payload: {
					images: state.lightbox_images,
					selected_index: item.lightbox_index
				}
			})
		}, /* @__PURE__ */ __dil.jsx("search-image", {
			searchImage: item.image,
			upgradeToFullRes: true,
			alt: item.title ?? item.query ?? void 0,
			fit: "cover",
			width: "100%",
			height: "100%",
			radius: "none",
			hideOnFailure: true
		})) : item.image_is_loading ? /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: "100%",
			background: "surface-tertiary"
		}) : /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: "100%",
			align: "center",
			justify: "center",
			background: "surface-tertiary"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "images",
			color: "secondary"
		}))), item.action_payload != null || item.url != null ? /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: item.action_payload == null ? item.url : void 0,
			width: "100%",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			minWidth: 0,
			padding: 0,
			background: "transparent",
			border: 0,
			radius: "none",
			ariaLabel: item.title ?? item.query ?? "",
			onClick: () => GenUI.dispatchAction(item.action_payload != null ? {
				handler: "client",
				type: "open_entity_detail",
				payload: item.action_payload
			} : {
				handler: "client",
				type: "open_url",
				payload: { url: item.url }
			})
		}, /* @__PURE__ */ __dil.jsx(VisualCardText, { item }))) : /* @__PURE__ */ __dil.jsx(VisualCardText, { item })))));
	}
	function VisualCardCarouselWidget(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("VisualCardCarouselWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 350
		});
		return /* @__PURE__ */ __dil.jsx(VisualCardView, { state });
	}

//#endregion
return VisualCardCarouselWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=visual-card-carousel-widget-5b96586488e4.js.map