import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


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
//#region EntityThumbnailList.dil.tsx
	function ThumbnailImage({ item, carousel }) {
		const image = item.image ? /* @__PURE__ */ __dil.jsx("search-image", {
			upgradeToFullRes: true,
			key: JSON.stringify([item.image.content_url, item.image.thumbnail_url]),
			searchImage: item.image,
			alt: item.name,
			fit: "cover",
			width: "100%",
			height: "100%",
			radius: "none",
			hideOnFailure: true
		}) : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: "100%",
			background: "surface-tertiary"
		});
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: "100%",
			background: "surface-secondary",
			border: {
				size: 1,
				color: "subtle"
			},
			radius: carousel ? "xl" : "lg",
			clip: true
		}, item.action_payload && (item.image || carousel) ? /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height: "100%",
			padding: 0,
			background: "transparent",
			border: 0,
			radius: "none",
			ariaLabel: item.name,
			onClick: () => {
				if (item.activation_event) GenUI.logEvent?.(item.activation_event);
				GenUI.dispatchAction({
					handler: "client",
					type: "open_entity_detail",
					payload: item.action_payload
				});
			}
		}, image) : image);
	}
	function ThumbnailName({ item, carousel }) {
		const name = /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "sm",
			weight: carousel ? "medium" : void 0,
			strong: !carousel,
			maxLines: carousel ? 2 : void 0,
			truncate: carousel,
			underline: !carousel && item.action_payload ? "dotted" : void 0
		}, item.name);
		return item.action_payload ? /* @__PURE__ */ __dil.jsx("pressable", {
			inline: !carousel,
			width: carousel ? "100%" : void 0,
			onClick: () => {
				if (item.activation_event) GenUI.logEvent?.(item.activation_event);
				GenUI.dispatchAction({
					handler: "client",
					type: "open_entity_detail",
					payload: item.action_payload
				});
			}
		}, name) : name;
	}
	function ThumbnailListRow({ item }) {
		return /* @__PURE__ */ __dil.jsx("list-item", { marker: /* @__PURE__ */ __dil.jsx(ThumbnailImage, {
			item,
			carousel: false
		}) }, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx(ThumbnailName, {
			item,
			carousel: false
		}), /* @__PURE__ */ __dil.jsx("text", { size: "sm" }, item.desc)));
	}
	function EntityThumbnailList(props) {
		const isMobile = DIL.useIsMobile();
		const { resolutionComplete, state } = useResolvedComponentResult("EntityThumbnailList", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 140
		});
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			gap: 3,
			...GenUI.logEvent ? { onVisible: () => GenUI.logEvent?.({
				event_name: "entity_thumbnail_list_widget_shown",
				statsig_event_name: "entity_thumbnail_list_widget_shown",
				event_data: {
					widget_name: "entity_thumbnail_list",
					is_carousel: state.is_carousel
				}
			}) } : {}
		}, state.title !== "" ? /* @__PURE__ */ __dil.jsx("title", { size: "sm" }, state.title) : null, state.is_carousel ? /* @__PURE__ */ __dil.jsx("carousel", {
			gap: 3,
			showArrows: !isMobile,
			flush: true
		}, state.entities.map((item, index) => /* @__PURE__ */ __dil.jsx("carousel-item", {
			key: index,
			width: 140,
			minWidth: 140,
			padding: 0,
			variant: "none"
		}, /* @__PURE__ */ __dil.jsx("col", {
			width: 140,
			minWidth: 140,
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 140,
			height: 140
		}, /* @__PURE__ */ __dil.jsx(ThumbnailImage, {
			item,
			carousel: true
		})), /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx(ThumbnailName, {
			item,
			carousel: true
		}), item.subtitle !== "" ? /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			maxLines: 1,
			truncate: true
		}, item.subtitle) : null))))) : /* @__PURE__ */ __dil.jsx("list", { maxMarkerSize: "lg" }, state.entities.map((item, index) => /* @__PURE__ */ __dil.jsx(ThumbnailListRow, {
			key: index,
			item
		}))));
	}

//#endregion
return EntityThumbnailList;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=entity-thumbnail-list-44cb490d0644.js.map