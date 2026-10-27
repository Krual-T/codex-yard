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
//#region internal/TikTokVideoCard.dil.tsx
	function TikTokVideoCard({ video_id, position, platform, title, canonical_url, thumbnail_url }) {
		const eventData = {
			platform,
			video_id,
			position,
			provider: "tiktok"
		};
		const providerBadge = /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			height: "100%",
			padding: 2,
			justify: "end",
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("badge", {
			color: "rgb(0 0 0 / 40%)",
			variant: "solid"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "tiktok",
			color: "white",
			inline: true
		})));
		return /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: canonical_url,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			clip: true,
			padding: 0,
			gap: 0,
			radius: "2xl",
			background: "transparent",
			border: {
				size: 0,
				color: "transparent"
			},
			ariaLabel: \`\${title} on TikTok\`,
			onClick: () => GenUI.dispatchAction({
				type: "open_url",
				handler: "client",
				payload: {
					url: canonical_url,
					event_name: "video_carousel_outbound_clicked",
					statsig_event_name: "video_carousel_outbound_clicked",
					event_data: eventData
				}
			})
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			aspectRatio: "9/16",
			background: "surface-secondary",
			clip: true,
			...GenUI.logEvent ? { onVisible: () => GenUI.logEvent?.({
				event_name: "video_carousel_impression",
				statsig_event_name: "video_carousel_impression",
				event_data: eventData
			}) } : {}
		}, thumbnail_url ? /* @__PURE__ */ __dil.jsx("search-image", {
			searchImage: { content_url: thumbnail_url },
			alt: "",
			width: "100%",
			height: "100%",
			fit: "cover",
			fallback: /* @__PURE__ */ __dil.jsx("box", {
				width: "100%",
				height: "100%",
				background: "surface-secondary"
			})
		}, providerBadge) : providerBadge)));
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
//#region AsyncVideoCarousel.dil.tsx
	function AsyncVideoCarousel(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("AsyncVideoCarousel", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 356
		});
		if (state.is_loading && state.items.length === 0) return /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			gap: 2,
			minWidth: 0,
			clip: true
		}, [
			0,
			1,
			2,
			3
		].map((index) => /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			width: 200,
			aspectRatio: "9/16",
			flex: "none",
			radius: "2xl",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: "100%",
			duration: 1e3
		}))));
		if (!state.items.length) return null;
		return /* @__PURE__ */ __dil.jsx(ResolvedVideoCarousel, {
			key: \`\${props.__resolutionId ?? ""}:\${props.video_source_data}\`,
			carouselId: props.__resolutionId,
			items: state.items
		});
	}
	function ResolvedVideoCarousel({ carouselId, items }) {
		const isMobile = DIL.useIsMobile();
		const [failedVideoIds, setFailedVideoIds] = DIL.useState([]);
		const videos = items.filter((video) => !failedVideoIds.includes(video.provider_video_id));
		if (!videos.length) return null;
		return /* @__PURE__ */ __dil.jsx("box", { width: "100%" }, /* @__PURE__ */ __dil.jsx("carousel", {
			gap: 2,
			snap: "mandatory",
			flush: true,
			ariaLabel: videos[0].title
		}, videos.map((video, index) => /* @__PURE__ */ __dil.jsx("carousel-item", {
			key: video.provider_video_id,
			width: 200,
			padding: 0,
			radius: "2xl",
			background: "surface-secondary"
		}, video.provider === "tiktok" ? /* @__PURE__ */ __dil.jsx(TikTokVideoCard, {
			video_id: video.provider_video_id,
			position: index,
			platform: isMobile ? "mobile" : "desktop",
			title: video.title,
			canonical_url: video.canonical_url,
			thumbnail_url: video.thumbnail_url
		}) : /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			...GenUI.logEvent ? {
				onVisibleKey: index,
				onVisible: () => GenUI.logEvent?.({
					event_name: "video_carousel_impression",
					statsig_event_name: "video_carousel_impression",
					event_data: {
						carousel_id: carouselId,
						platform: isMobile ? "mobile" : "desktop",
						video_id: video.provider_video_id,
						position: index
					}
				})
			} : {}
		}, /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: video.canonical_url,
			width: "100%",
			unlessSupportedAction: "open_video_lightbox"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			clip: true,
			padding: 0,
			radius: "2xl",
			background: "transparent",
			border: {
				size: 0,
				color: "transparent"
			},
			ariaLabel: \`\${video.title} on YouTube\`,
			onClick: () => {
				const eventData = {
					carousel_id: carouselId,
					platform: isMobile ? "mobile" : "desktop",
					video_id: video.provider_video_id,
					position: index
				};
				GenUI.dispatchAction({
					type: "open_video_lightbox",
					handler: "client",
					payload: {
						video_id: video.provider_video_id,
						title: video.title,
						videos,
						event_name: "video_carousel_lightbox_opened",
						statsig_event_name: "video_carousel_lightbox_opened",
						event_data: eventData
					},
					fallbackAction: {
						type: "open_url",
						handler: "client",
						payload: {
							url: video.canonical_url,
							event_name: "video_carousel_outbound_clicked",
							statsig_event_name: "video_carousel_outbound_clicked",
							event_data: eventData
						}
					}
				});
			}
		}, /* @__PURE__ */ __dil.jsx("youtube", {
			videoId: video.provider_video_id,
			title: \`\${video.title} on YouTube\`,
			aspectRatio: "9/16",
			hoverToPlay: !isMobile,
			showDurationBadge: true,
			showThumbnail: true,
			width: "100%",
			onHover: () => GenUI.logEvent?.({
				event_name: "video_carousel_hovered",
				event_data: {
					carousel_id: carouselId,
					platform: isMobile ? "mobile" : "desktop",
					video_id: video.provider_video_id,
					position: index
				}
			}),
			onPlayerError: () => setFailedVideoIds((previous) => previous.includes(video.provider_video_id) ? previous : [...previous, video.provider_video_id])
		}))))))));
	}

//#endregion
return AsyncVideoCarousel;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=async-video-carousel-efe1bdd4be65.js.map