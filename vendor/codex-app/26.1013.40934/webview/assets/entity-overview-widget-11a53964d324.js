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
	function EntityOverviewBody({ state, carousel = false }) {
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			height: "100%",
			gap: carousel ? 0 : 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx(EntityMosaic, {
			images: state.images,
			title: state.title,
			height: carousel ? 180 : 200,
			carousel
		}), /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			padding: {
				x: 5,
				y: 4
			},
			minWidth: 0,
			flex: carousel ? 1 : void 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "semibold",
			maxLines: 2,
			truncate: carousel
		}, state.title), state.metadata.length > 0 ? /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			minWidth: 0,
			direction: carousel ? void 0 : "row",
			scrollable: !carousel
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "stretch",
			gap: 6,
			wrap: "nowrap",
			width: carousel ? "100%" : void 0
		}, state.metadata.map((item, index) => /* @__PURE__ */ __dil.jsx("row", {
			key: index,
			width: carousel ? void 0 : 132,
			minWidth: carousel ? 0 : 132,
			flex: carousel ? 1 : void 0,
			align: "stretch",
			gap: 6,
			wrap: "nowrap"
		}, index > 0 ? /* @__PURE__ */ __dil.jsx("box", {
			width: 1,
			minWidth: 1,
			height: 48,
			background: "border-subtle"
		}) : null, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "tertiary",
			maxLines: 1,
			truncate: true
		}, item.label), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			maxLines: carousel ? 2 : 1,
			truncate: true
		}, item.value)))))) : null, state.description ? /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, /* @__PURE__ */ __dil.jsx("divider", {
			spacing: 0,
			color: "subtle"
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			maxLines: carousel ? 5 : 4,
			truncate: carousel
		}, state.description)) : null));
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
//#region EntityOverviewWidget.dil.tsx
	function EntityOverviewWidget(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("EntityOverviewWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 200
		});
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: 362
		}, /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			width: "100%",
			padding: 0,
			gap: 1,
			background: "surface"
		}, /* @__PURE__ */ __dil.jsx(EntityActionSurface, {
			action: state.click_action,
			label: "Open details for " + state.title
		}, /* @__PURE__ */ __dil.jsx(EntityOverviewBody, { state }))));
	}

//#endregion
return EntityOverviewWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=entity-overview-widget-11a53964d324.js.map