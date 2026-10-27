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
//#region internal/person-wave3.dil.tsx
	function PersonImageTile({ images, index }) {
		const image = images[index];
		const showCount = images.length > 1 && index === (images.length >= 3 ? 2 : 0);
		return /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height: "100%",
			padding: 0,
			background: "transparent",
			border: 0,
			radius: "none",
			onClick: () => GenUI.dispatchAction({
				type: "open_image_lightbox",
				handler: "client",
				payload: {
					images,
					selected_index: index
				}
			})
		}, /* @__PURE__ */ __dil.jsx("search-image", {
			searchImage: image,
			upgradeToFullRes: true,
			alt: image.title ?? void 0,
			fit: "cover",
			width: "100%",
			height: "100%",
			radius: "none",
			hideOnFailure: true
		}, showCount && /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			height: "100%",
			align: "end",
			justify: "end",
			padding: {
				right: 3,
				bottom: 3
			},
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			padding: {
				x: 2.5,
				y: 1.5
			},
			radius: "full",
			background: "rgba(0, 0, 0, 0.32)",
			width: "fit-content"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "images",
			size: "sm",
			color: "white"
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "xs",
			weight: "medium",
			color: "white"
		}, String(images.length))))));
	}
	function PersonHero({ images, isWide }) {
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: isWide ? 384 : 200
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: "100%",
			background: {
				light: "white",
				dark: "surface"
			},
			border: {
				size: 1,
				color: "subtle"
			},
			radius: "3xl",
			clip: true
		}, images.length >= 3 ? /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			width: "100%",
			height: "100%",
			gap: "2px"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "60%",
			height: "100%",
			minWidth: 0,
			minHeight: 0
		}, /* @__PURE__ */ __dil.jsx(PersonImageTile, {
			images,
			index: 0
		})), /* @__PURE__ */ __dil.jsx("col", {
			width: "40%",
			height: "100%",
			gap: "2px"
		}, [1, 2].map((index) => /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			width: "100%",
			flex: 1,
			minWidth: 0,
			minHeight: 0
		}, /* @__PURE__ */ __dil.jsx(PersonImageTile, {
			images,
			index
		}))))) : images.length > 0 ? /* @__PURE__ */ __dil.jsx(PersonImageTile, {
			images,
			index: 0
		}) : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: "100%",
			background: "surface-secondary"
		})));
	}
	function PersonLoadingCopy({ title }) {
		return title ? /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "56%",
			height: 18,
			background: "surface-tertiary"
		}) : /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			width: "82%"
		}, [
			0,
			1,
			2
		].map((index) => /* @__PURE__ */ __dil.jsx("box", { key: index }, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 12,
			background: "surface-tertiary"
		}))));
	}
	function PersonLinkBody({ item, height }) {
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%",
			height
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("favicon", {
			url: item.url,
			size: 16
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			truncate: true,
			maxLines: 1
		}, item.link_host || item.url)), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			maxLines: 1
		}, item.title), item.snippet && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			maxLines: 2
		}, item.snippet));
	}
	function PersonMediaText({ item, overview }) {
		const isVideo = item.kind === "videos";
		const date = item.link_relative_time || item.link_date || "";
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			flex: overview ? void 0 : 1,
			minWidth: 0,
			width: overview ? "100%" : void 0,
			height: "100%",
			justify: "between"
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: overview && !isVideo ? 2 : 1,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("favicon", {
			url: isVideo ? "https://www.youtube.com" : item.url,
			size: 16
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: !overview || isVideo ? "medium" : void 0,
			color: overview && !isVideo ? "secondary" : "default",
			truncate: true,
			maxLines: 1
		}, item.link_host || (isVideo ? "YouTube" : item.url))), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			maxLines: 2
		}, item.title)), /* @__PURE__ */ __dil.jsx("text", {
			size: overview && !isVideo ? "xs" : "sm",
			color: "secondary",
			maxLines: 1
		}, isVideo ? item.video_metadata ?? "" : date));
	}
	function PersonOverviewCard({ item }) {
		if (!item) return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: "100%",
			padding: 4,
			background: "surface-soft",
			border: {
				size: 1,
				color: "default"
			},
			radius: "3xl",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%",
			height: "100%",
			justify: "between"
		}, /* @__PURE__ */ __dil.jsx(PersonLoadingCopy, { title: true }), /* @__PURE__ */ __dil.jsx(PersonLoadingCopy, { title: false })));
		return /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: item.kind !== "fact" ? item.url : void 0,
			width: "100%",
			height: "100%",
			disabled: item.kind === "fact"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height: "100%",
			padding: 4,
			background: "surface-soft",
			border: {
				size: 1,
				color: "default"
			},
			radius: "3xl",
			clip: true,
			disabled: item.kind === "fact",
			tooltip: item.kind === "videos" ? item.title : void 0,
			onClick: () => GenUI.dispatchAction(item.kind === "fact" && !item.has_link_url ? {
				type: "open_entity_detail",
				handler: "client",
				payload: {
					category: "ask_sidebar",
					query: item.action_query,
					extraParams: { context: item.action_context }
				}
			} : {
				type: "open_url",
				handler: "client",
				payload: { url: item.url }
			})
		}, item.kind === "fact" ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%",
			height: "100%",
			justify: "between"
		}, item.is_loading && !item.title ? /* @__PURE__ */ __dil.jsx(PersonLoadingCopy, { title: true }) : /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			maxLines: 2
		}, item.title), item.is_loading && !item.snippet ? /* @__PURE__ */ __dil.jsx(PersonLoadingCopy, { title: false }) : /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			maxLines: 3
		}, item.snippet)) : item.kind === "links" ? /* @__PURE__ */ __dil.jsx(PersonLinkBody, {
			item,
			height: "100%"
		}) : /* @__PURE__ */ __dil.jsx(PersonMediaText, {
			item,
			overview: true
		})));
	}
	function PersonVideoDuration({ duration }) {
		return duration ? /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			height: "100%",
			align: "start",
			justify: "end",
			padding: {
				left: 2,
				bottom: 2
			},
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: "2px",
			padding: {
				left: 1.5,
				right: 2,
				top: 1,
				bottom: 1
			},
			radius: "full",
			background: "rgba(0, 0, 0, 0.4)",
			width: "fit-content",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 16,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "white"
		}, "▶")), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "white",
			maxLines: 1
		}, duration))) : null;
	}
	function PersonSpotlightCard({ item, viewId, isWide }) {
		if (viewId === "links") return /* @__PURE__ */ __dil.jsx("box", { width: "100%" }, /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: item.url,
			width: "100%",
			height: isWide ? "auto" : 128
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height: isWide ? "auto" : 128,
			minHeight: isWide ? 108 : 128,
			maxHeight: 128,
			padding: 4,
			background: "surface-soft",
			border: {
				size: 1,
				color: "default"
			},
			radius: "3xl",
			clip: true,
			onClick: () => GenUI.dispatchAction({
				type: "open_url",
				handler: "client",
				payload: { url: item.url }
			})
		}, /* @__PURE__ */ __dil.jsx(PersonLinkBody, {
			item,
			height: isWide ? "auto" : "100%"
		}))));
		const isVideo = viewId === "videos";
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: 128
		}, /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: item.url,
			width: "100%",
			height: "100%"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height: "100%",
			padding: 4,
			background: "surface-soft",
			border: {
				size: 1,
				color: "default"
			},
			radius: "2xl",
			clip: true,
			tooltip: isVideo ? item.title : void 0,
			onClick: () => GenUI.dispatchAction({
				type: "open_url",
				handler: "client",
				payload: { url: item.url }
			})
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 4,
			width: "100%",
			height: "100%"
		}, isVideo ? /* @__PURE__ */ __dil.jsx("box", {
			height: "100%",
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 172,
			minWidth: 172,
			height: 96,
			radius: "xl",
			clip: true
		}, item.thumbnail_url ? /* @__PURE__ */ __dil.jsx("search-image", {
			searchImage: {
				content_url: item.thumbnail_url,
				thumbnail_url: item.thumbnail_url
			},
			fit: "cover",
			width: "100%",
			height: "100%",
			radius: "none",
			hideOnFailure: true
		}, /* @__PURE__ */ __dil.jsx(PersonVideoDuration, { duration: item.duration })) : /* @__PURE__ */ __dil.jsx(PersonVideoDuration, { duration: item.duration }))) : item.thumbnail_url && /* @__PURE__ */ __dil.jsx("box", {
			width: 112,
			height: "100%",
			minWidth: 112
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: "100%",
			radius: "xl",
			border: {
				size: 1,
				color: "light"
			},
			clip: true
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: item.thumbnail_url,
			fit: "cover",
			width: "100%",
			height: "100%",
			radius: "none",
			hideOnFailure: true
		}))), /* @__PURE__ */ __dil.jsx(PersonMediaText, {
			item,
			overview: false
		})))));
	}
	function ResolvedPerson({ state }) {
		const isWide = DIL.useBreakpoint("sm");
		const [activeIndex, setActiveIndex] = DIL.useState(state.spotlight_active_index);
		const activeView = activeIndex > 0 ? state.spotlight_views[activeIndex - 1] : void 0;
		const overviewReady = state.overview_items.some((item) => item.title !== "" || item.snippet !== "");
		const overviewLoading = state.fact_cards.some((card) => card.is_loading) || state.spotlight_tabs_loading;
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100vw",
			maxWidth: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%"
		}, (state.overview_items.length > 0 || state.spotlight_views.length > 0 || state.spotlight_tabs_loading) && /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			minWidth: 0,
			scrollable: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			width: "max-content"
		}, overviewReady ? /* @__PURE__ */ __dil.jsx("pressable", {
			padding: {
				x: 3,
				y: 1.5
			},
			background: activeIndex === 0 ? "surface-tertiary" : "transparent",
			border: 0,
			radius: "full",
			onClick: () => setActiveIndex(0)
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: activeIndex === 0 ? "default" : "tertiary"
		}, state.overview_label)) : /* @__PURE__ */ __dil.jsx("box", {
			width: 88,
			height: 32,
			background: "surface-secondary",
			radius: "full",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: "100%",
			background: "surface-tertiary"
		})), state.spotlight_tabs_loading && state.spotlight_views.length === 0 && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, [
			"news",
			"links",
			"videos"
		].map((id) => /* @__PURE__ */ __dil.jsx("box", {
			key: id,
			width: 64,
			height: 32,
			background: "surface-secondary",
			radius: "full",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: "100%",
			background: "surface-tertiary"
		})))), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.spotlight_views.map((view, index) => /* @__PURE__ */ __dil.jsx("pressable", {
			key: view.id,
			padding: {
				x: 3,
				y: 1.5
			},
			background: index + 1 === activeIndex ? "surface-tertiary" : "transparent",
			border: 0,
			radius: "full",
			onClick: () => setActiveIndex(index + 1)
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: index + 1 === activeIndex ? "default" : "tertiary"
		}, view.label)))))), activeIndex === 0 && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx(PersonHero, {
			images: state.image_card.images,
			isWide
		}), /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			minWidth: 0,
			scrollable: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "stretch",
			gap: 3,
			width: isWide ? "100%" : "max-content",
			padding: isWide ? { x: 0 } : { x: 4 }
		}, [
			0,
			1,
			2
		].map((index) => {
			const item = state.overview_items[index];
			if (!item && !overviewLoading) return null;
			const width = item?.kind === "fact" ? 180 : 320;
			return /* @__PURE__ */ __dil.jsx("box", {
				key: index,
				width: isWide ? "auto" : width,
				maxWidth: isWide ? void 0 : width,
				minWidth: isWide ? 0 : width,
				height: 128,
				flex: isWide ? "1 1 0%" : "0 0 auto"
			}, /* @__PURE__ */ __dil.jsx(PersonOverviewCard, { item }));
		})))), activeView && (activeView.id === "links" || activeView.id === "videos" || activeView.id === "news") && /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%"
		}, activeView.items.map((item, index) => /* @__PURE__ */ __dil.jsx(PersonSpotlightCard, {
			key: index,
			item,
			viewId: activeView.id,
			isWide
		})))));
	}
	function PersonPresentation({ componentName, widgetProps }) {
		const { state, resolutionComplete } = useResolvedComponentResult(componentName, widgetProps);
		if (!state) return resolutionComplete ? widgetProps.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 340
		});
		return /* @__PURE__ */ __dil.jsx(ResolvedPerson, { state });
	}

//#endregion
//#region PersonWidgetAlwaysTrigger.dil.tsx
	function PersonWidgetAlwaysTrigger(props) {
		return /* @__PURE__ */ __dil.jsx(PersonPresentation, {
			componentName: "PersonWidgetAlwaysTrigger",
			widgetProps: props
		});
	}

//#endregion
return PersonWidgetAlwaysTrigger;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=person-widget-always-trigger-2d917f35eb16.js.map