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
//#region internal/ReservationVoiceCard.dil.tsx
	const SvgPath = "path";
	function launch(payload) {
		GenUI.dispatchAction({
			type: "launch_ecosystem_widget",
			handler: "client",
			payload
		});
	}
	function openUrl(url) {
		GenUI.dispatchAction({
			type: "open_url",
			handler: "client",
			payload: { url }
		});
	}
	function TimeLabel({ label, unavailable = false }) {
		return /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "center",
			height: "100%",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: unavailable ? "tertiary" : "primary",
			maxLines: 1,
			size: "sm",
			textAlign: "center",
			truncate: true,
			weight: "medium"
		}, label));
	}
	function ReservationVoiceCard({ state }) {
		const card = state.voice_card;
		const group = state.groups[0];
		const hasLoggedImpression = DIL.useRef(false);
		if (!card) return null;
		const firstOption = group?.change_options[0];
		const showMore = group && group.mobile_time_slots.length > 5 && (firstOption?.launcher_payload != null || group.requested_launcher_payload != null);
		function openHeading() {
			if (firstOption) if (firstOption.launcher_payload != null) launch(firstOption.launcher_payload);
			else openUrl(firstOption.url);
			else if (group?.requested_launcher_payload != null) launch(group.requested_launcher_payload);
		}
		return /* @__PURE__ */ __dil.jsx("box", {
			width: 362,
			maxWidth: "100%",
			radius: "3xl",
			clip: true,
			...GenUI.logEvent ? {
				onVisibleWhen: !hasLoggedImpression.current,
				onVisible: () => {
					hasLoggedImpression.current = true;
					GenUI.logEvent?.({
						event_name: "reservation_time_pills_widget_shown",
						statsig_event_name: "reservation_time_pills_widget_shown",
						event_data: { widget_name: "reservation_time_pills" }
					});
				}
			} : {}
		}, /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			width: "100%",
			padding: 0,
			gap: 0,
			background: "surface"
		}, card.images.length >= 3 && /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: 200,
			background: "surface-secondary",
			radius: {
				topLeft: "3xl",
				topRight: "3xl",
				bottomRight: "none",
				bottomLeft: "none"
			},
			clip: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			width: "100%",
			height: "100%",
			gap: "1px",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "60%",
			height: "100%",
			minWidth: 0,
			minHeight: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height: "100%",
			padding: 0,
			radius: "none",
			onClick: () => GenUI.dispatchAction({
				type: "open_image_lightbox",
				handler: "client",
				payload: {
					images: card.images,
					selected_index: 0
				}
			})
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: card.images[0].image_url,
			alt: card.images[0].alt_text,
			width: "100%",
			height: "100%",
			fit: "cover",
			radius: "none",
			hideOnFailure: true
		}))), /* @__PURE__ */ __dil.jsx("col", {
			width: "40%",
			height: "100%",
			gap: "1px",
			minWidth: 0,
			minHeight: 0
		}, [1, 2].map((index) => /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			width: "100%",
			flex: 1,
			minWidth: 0,
			minHeight: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			height: "100%",
			padding: 0,
			radius: "none",
			onClick: () => GenUI.dispatchAction({
				type: "open_image_lightbox",
				handler: "client",
				payload: {
					images: card.images,
					selected_index: index
				}
			})
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: card.images[index].image_url,
			alt: card.images[index].alt_text,
			width: "100%",
			height: "100%",
			fit: "cover",
			radius: "none",
			hideOnFailure: true
		}))))))), /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			padding: {
				x: 5,
				y: 3
			},
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 1.5,
			width: "100%",
			minWidth: 0
		}, card.title && (card.click_action != null ? /* @__PURE__ */ __dil.jsx(LinkImpression, {
			action: card.click_action,
			width: "100%",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			minWidth: 0,
			padding: 0,
			radius: "md",
			onClick: () => GenUI.dispatchAction(card.click_action)
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "medium",
			underline: "dotted",
			maxLines: 2
		}, card.title))) : /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "medium",
			maxLines: 2
		}, card.title)), card.metadata_label && /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			width: "100%",
			minWidth: 0,
			wrap: "nowrap"
		}, card.has_rating && /* @__PURE__ */ __dil.jsx("text", { color: "primary" }, /* @__PURE__ */ __dil.jsx("svg", {
			viewBox: "0 0 24 24",
			width: 14,
			height: 14
		}, /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27Z",
			fill: "currentColor"
		}))), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			maxLines: 1,
			truncate: true
		}, card.metadata_label))), /* @__PURE__ */ __dil.jsx("divider", {
			spacing: 0,
			color: "subtle"
		}), group && /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: firstOption?.launcher_payload == null ? firstOption?.url : void 0,
			width: "100%",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			minWidth: 0,
			padding: 0,
			radius: "md",
			onClick: firstOption || group.requested_launcher_payload != null ? openHeading : void 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			gap: 2,
			width: "100%",
			minWidth: 0,
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			minWidth: 0,
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			maxLines: 1,
			truncate: true
		}, group.request_date_time_label), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, "·"), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "secondary",
			maxLines: 1,
			truncate: true
		}, group.party_size_label)), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 0,
			padding: { left: 1 },
			wrap: "nowrap"
		}, group.provider_logos.map((logo, index) => /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			background: "surface",
			padding: "2px",
			radius: "full"
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: logo.logo_url,
			alt: logo.name ?? group.provider_name,
			width: 20,
			height: 20,
			fit: "contain",
			radius: "full",
			hideOnFailure: true
		}))))))), group.mobile_time_slots.length > 0 ? /* @__PURE__ */ __dil.jsx("grid", {
			columns: 3,
			gap: 2
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, group.mobile_time_slots.slice(0, 5).map((slot, index) => /* @__PURE__ */ __dil.jsx("grid-item", { key: index }, slot.is_requested_unavailable ? /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			border: {
				size: 1,
				color: "subtle"
			},
			height: 40,
			justify: "center",
			minWidth: 0,
			padding: { x: 2 },
			radius: "full",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(TimeLabel, {
			label: slot.formatted_time,
			unavailable: true
		})) : /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: !slot.booking_query && !slot.launcher_payload ? slot.url : void 0,
			width: "100%",
			height: 40,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			align: "center",
			border: {
				size: 1,
				color: "default"
			},
			height: 40,
			justify: "center",
			minWidth: 0,
			padding: 0,
			radius: "full",
			width: "100%",
			clip: true,
			onClick: () => {
				if (slot.booking_query != null) GenUI.dispatchAction({
					type: "issue_new_turn",
					handler: "client",
					loadingBehavior: "none",
					payload: {
						query: slot.booking_query,
						append_to_current_leaf: true
					}
				});
				else if (slot.launcher_payload != null) launch(slot.launcher_payload);
				else openUrl(slot.url);
			}
		}, /* @__PURE__ */ __dil.jsx(TimeLabel, { label: slot.formatted_time })))))), showMore && /* @__PURE__ */ __dil.jsx("grid-item", null, /* @__PURE__ */ __dil.jsx("pressable", {
			align: "center",
			border: {
				size: 1,
				color: "default"
			},
			height: 40,
			justify: "center",
			minWidth: 0,
			padding: 0,
			radius: "full",
			width: "100%",
			clip: true,
			onClick: () => {
				const payload = firstOption?.launcher_payload != null ? firstOption.see_more_launcher_payload ?? firstOption.launcher_payload : group.see_more_launcher_payload ?? group.requested_launcher_payload;
				if (payload != null) launch(payload);
			}
		}, /* @__PURE__ */ __dil.jsx(TimeLabel, { label: state.show_more_times_label })))) : /* @__PURE__ */ __dil.jsx("col", {
			gap: 2,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, group.empty_state_label), firstOption && /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: !firstOption.launcher_payload ? firstOption.url : void 0,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			variant: "outline",
			size: "md",
			onClick: () => {
				if (firstOption.launcher_payload != null) launch(firstOption.try_again_launcher_payload ?? firstOption.launcher_payload);
				else openUrl(firstOption.url);
			}
		}, group.try_again_label)))))));
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
//#region ReservationTimePillsRefCarouselWidget.dil.tsx
	function ReservationTimePillsRefCarouselWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("ReservationTimePillsRefCarouselWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 420
		});
		return /* @__PURE__ */ __dil.jsx(ReservationCarousel, { state });
	}
	function ReservationCarousel({ state }) {
		const wide = DIL.useBreakpoint("sm");
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: "100%"
		}, /* @__PURE__ */ __dil.jsx("carousel", {
			gap: 4,
			snap: "mandatory",
			flush: true,
			showArrows: true,
			ariaLabel: state.carousel_label
		}, state.items.map((item) => /* @__PURE__ */ __dil.jsx("carousel-item", {
			key: item.refid,
			width: wide ? 362 : "84%",
			padding: 0,
			background: "transparent",
			variant: "none"
		}, /* @__PURE__ */ __dil.jsx(ReservationVoiceCard, { state: item })))));
	}

//#endregion
return ReservationTimePillsRefCarouselWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=reservation-time-pills-ref-carousel-widget-d125121962b7.js.map