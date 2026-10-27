import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/RestaurantMenu.dil.tsx
	function RestaurantMenu({ state }) {
		const hasLoggedImpression = DIL.useRef(false);
		const mobile = DIL.useIsMobile();
		if (!state.items.length) return null;
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			...GenUI.logEvent ? {
				onVisibleWhen: !hasLoggedImpression.current,
				onVisible: () => {
					hasLoggedImpression.current = true;
					GenUI.logEvent?.({
						event_name: "restaurant_menu_widget_shown",
						statsig_event_name: "restaurant_menu_widget_shown",
						event_data: { widget_name: "restaurant_menu" }
					});
				}
			} : {}
		}, /* @__PURE__ */ __dil.jsx("carousel", {
			gap: 3,
			showArrows: !mobile,
			flush: true
		}, state.items.map((item, index) => /* @__PURE__ */ __dil.jsx("carousel-item", {
			key: item.id,
			width: 140,
			minWidth: 140,
			height: 166,
			padding: 0,
			variant: "none"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: 140,
			minWidth: 140,
			height: 166,
			padding: 0,
			radius: "xl",
			background: "transparent",
			onClick: () => GenUI.dispatchAction({
				type: "open_image_lightbox",
				handler: "client",
				payload: {
					images: state.items,
					selected_index: index
				}
			})
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: 140
		}, /* @__PURE__ */ __dil.jsx("search-image", {
			searchImage: {
				url: item.url,
				content_url: item.image_url,
				thumbnail_url: item.image_url
			},
			alt: item.alt_text,
			width: 140,
			height: 140,
			fit: "cover",
			radius: "xl",
			hideOnFailure: true
		}), item.caption && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			maxLines: 1
		}, item.caption)))))));
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
//#region RestaurantMenuRefWidget.dil.tsx
	function RestaurantMenuRefWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("RestaurantMenuRefWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 166
		});
		return /* @__PURE__ */ __dil.jsx(RestaurantMenu, { state });
	}

//#endregion
return RestaurantMenuRefWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=restaurant-menu-ref-widget-401e96fae185.js.map