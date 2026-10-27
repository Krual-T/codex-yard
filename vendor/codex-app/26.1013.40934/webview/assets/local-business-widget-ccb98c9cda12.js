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
	function EntityMosaic({ images, title, height = 200, carousel = false }) {
		if (images.length === 0) return null;
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height,
			background: "surface-secondary",
			radius: carousel ? "none" : {
				topLeft: "3xl",
				topRight: "3xl",
				bottomLeft: "none",
				bottomRight: "none"
			},
			clip: true
		}, images.length === 1 ? /* @__PURE__ */ __dil.jsx("search-image", {
			searchImage: images[0],
			upgradeToFullRes: true,
			alt: title,
			fit: "cover",
			width: "100%",
			height: "100%",
			radius: "none",
			hideOnFailure: true
		}) : images.length === 2 || carousel ? /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			width: "100%",
			height: "100%",
			gap: "1px",
			wrap: "nowrap"
		}, images.slice(0, 2).map((image, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			flex: 1,
			height: "100%",
			minWidth: 0,
			minHeight: 0
		}, /* @__PURE__ */ __dil.jsx("search-image", {
			searchImage: image,
			upgradeToFullRes: true,
			alt: title,
			fit: "cover",
			width: "100%",
			height: "100%",
			radius: "none",
			hideOnFailure: true
		})))) : /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			width: "100%",
			height: "100%",
			gap: "1px",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: 3,
			height: "100%",
			minWidth: 0,
			minHeight: 0
		}, /* @__PURE__ */ __dil.jsx("search-image", {
			searchImage: images[0],
			upgradeToFullRes: true,
			alt: title,
			fit: "cover",
			width: "100%",
			height: "100%",
			radius: "none",
			hideOnFailure: true
		})), /* @__PURE__ */ __dil.jsx("col", {
			flex: 2,
			height: "100%",
			gap: "1px",
			minWidth: 0,
			minHeight: 0
		}, images.slice(1, 3).map((image, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			width: "100%",
			flex: 1,
			minWidth: 0,
			minHeight: 0
		}, /* @__PURE__ */ __dil.jsx("search-image", {
			searchImage: image,
			upgradeToFullRes: true,
			alt: title,
			fit: "cover",
			width: "100%",
			height: "100%",
			radius: "none",
			hideOnFailure: true
		}))))));
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
//#region LocalBusinessWidget.dil.tsx
	function BusinessLink({ url, label, primary = false }) {
		return url ? /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			color: primary ? "primary" : "secondary",
			variant: primary ? "solid" : "outline",
			size: "md",
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "open_url",
				payload: { url }
			})
		}, label))) : null;
	}
	function LocalBusinessWidget(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("LocalBusinessWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 200
		});
		const hasMetadata = state.rating != null || state.category != null || state.price != null || state.open_status != null;
		const hasLinks = Boolean(state.directions_url || state.website_url || state.phone_url);
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: 362
		}, /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			width: "100%",
			padding: 0,
			gap: 0,
			background: "surface"
		}, /* @__PURE__ */ __dil.jsx(EntityActionSurface, {
			action: state.click_action,
			label: "Open business details for " + state.title
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(EntityMosaic, {
			images: state.images,
			title: state.title
		}), /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			padding: {
				x: 5,
				top: 4,
				bottom: hasLinks ? 3 : 4
			},
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			maxLines: 2
		}, state.title), hasMetadata ? /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			gap: 2,
			rowGap: 1,
			align: "center",
			justify: "between",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center",
			minWidth: 0,
			maxWidth: "100%",
			wrap: "nowrap",
			flex: 1
		}, state.rating != null ? /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center",
			width: "max-content",
			wrap: "nowrap",
			flex: "none"
		}, /* @__PURE__ */ __dil.jsx(ReviewStar, { size: 16 }), /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "md"
		}, Math.round(state.rating * 10) / 10)) : null, state.category && state.rating != null ? /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "md",
			color: "secondary"
		}, "·") : null, state.category ? /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			maxLines: 1,
			truncate: true
		}, state.category) : null, state.price ? /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center",
			width: "max-content",
			maxWidth: "100%",
			wrap: "nowrap",
			flex: "none"
		}, state.rating != null || state.category ? /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "md",
			color: "secondary"
		}, "·") : null, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			maxLines: 1,
			truncate: true
		}, state.price)) : null), state.open_status ? /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center",
			minWidth: "max-content",
			wrap: "nowrap",
			flex: "none"
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "md",
			color: state.is_open ? "success" : "secondary"
		}, state.open_status), state.hours_detail ? /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "md"
		}, state.hours_detail) : null) : null) : null))), hasLinks ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			padding: {
				x: 5,
				top: 0,
				bottom: 4
			}
		}, /* @__PURE__ */ __dil.jsx("divider", {
			spacing: 0,
			color: "subtle"
		}), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx(BusinessLink, {
			url: state.directions_url,
			label: state.directions_label,
			primary: true
		}), /* @__PURE__ */ __dil.jsx(BusinessLink, {
			url: state.website_url,
			label: state.website_label
		}), /* @__PURE__ */ __dil.jsx(BusinessLink, {
			url: state.phone_url,
			label: state.call_label
		}))) : null));
	}

//#endregion
return LocalBusinessWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=local-business-widget-ccb98c9cda12.js.map