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
//#region CareProviderSidebarWidget.dil.tsx
	function CareProviderSidebarWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("CareProviderSidebarWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 480
		});
		return /* @__PURE__ */ __dil.jsx(ProviderSidebar, { state });
	}
	function Initials({ state }) {
		return /* @__PURE__ */ __dil.jsx("box", {
			width: 48,
			height: 48,
			radius: "full",
			background: "surface-secondary",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "semibold",
			color: "secondary"
		}, state.initials));
	}
	function LocationIcon({ modality }) {
		return /* @__PURE__ */ __dil.jsx("box", {
			width: 20,
			height: 24,
			align: "center",
			justify: "center",
			flex: "0 0 auto"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: modality === "telehealth" ? "video" : "map-pin",
			size: "sm",
			color: "secondary"
		}));
	}
	function openUrl(url, eventName) {
		GenUI.dispatchAction({
			handler: "client",
			type: "open_url",
			payload: {
				url,
				event_name: eventName,
				statsig_event_name: eventName,
				event_data: {
					widget_name: "care_provider_sidebar_widget",
					partner: "zocdoc"
				}
			}
		});
	}
	function ProviderSidebar({ state }) {
		const [selectedDate, setSelectedDate] = DIL.useState(state.selected_date);
		const [monthIndex, setMonthIndex] = DIL.useState(state.selected_calendar_month_index);
		const month = state.calendar_months[monthIndex];
		const selectedDay = state.availability_days.find((day) => day.date === selectedDate);
		function changeMonth(index) {
			setMonthIndex(index);
			setSelectedDate(state.calendar_months[index].first_available_date);
		}
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100vw",
			maxWidth: "100%"
		}, /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 5
		}, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			gap: 3,
			align: "start",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("box", { padding: { top: 1 } }, state.photo_url != null ? /* @__PURE__ */ __dil.jsx("image", {
			src: state.photo_url,
			alt: state.photo_alt,
			width: 48,
			height: 48,
			radius: "full",
			fit: "cover",
			hideOnFailure: true,
			fallback: /* @__PURE__ */ __dil.jsx(Initials, { state })
		}) : /* @__PURE__ */ __dil.jsx(Initials, { state })), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "lg",
			weight: "semibold",
			maxLines: 2
		}, state.display_name_with_credentials), state.specialty_practice_label && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			maxLines: 2
		}, state.specialty_practice_label), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: .5,
			minWidth: 0,
			wrap: "nowrap"
		}, state.rating_label != null && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("icon", {
			name: "star-filled",
			size: "sm",
			color: "primary"
		}), /* @__PURE__ */ __dil.jsx("text", {
			color: "primary",
			size: "md"
		}, state.rating_label)), state.rating_label != null && state.review_count_label != null && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "md"
		}, "("), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "md"
		}, state.review_count_label), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "md"
		}, ")")), /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			flex: "0 0 auto",
			height: 20,
			justify: "center",
			width: 20
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: state.partner_logo_url,
			alt: state.partner_label,
			fit: "contain",
			hideOnFailure: true,
			radius: "full",
			width: 18,
			height: 18,
			fallback: /* @__PURE__ */ __dil.jsx("box", {
				align: "center",
				background: "#FEF04F",
				height: 18,
				justify: "center",
				radius: "full",
				width: 18
			}, /* @__PURE__ */ __dil.jsx("text", {
				color: "primary",
				size: "xs",
				weight: "semibold"
			}, "Z"))
		}))))), state.location_label && (state.location_options.length > 1 ? /* @__PURE__ */ __dil.jsx("popover", null, /* @__PURE__ */ __dil.jsx("popover-trigger", { block: true }, /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			height: 44,
			gap: 2,
			align: "center",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx(LocationIcon, { modality: state.visit_modality }), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "primary",
			maxLines: 2,
			size: "md"
		}, state.location_label)), /* @__PURE__ */ __dil.jsx("icon", {
			name: "chevron-down",
			size: "sm",
			color: "secondary"
		}))), /* @__PURE__ */ __dil.jsx("popover-content", {
			side: "bottom",
			align: "start",
			sideOffset: 4
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: 1,
			width: 320
		}, state.location_options.map((option, index) => /* @__PURE__ */ __dil.jsx(LinkImpression, {
			action: option.change_action,
			careProvider: true,
			key: index,
			disabled: option.selected,
			height: 44,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			key: index,
			align: "center",
			ariaLabel: option.accessibility_label,
			disabled: option.selected,
			height: 44,
			width: "100%",
			padding: {
				x: 2,
				y: 0
			},
			radius: "md",
			onClick: () => GenUI.dispatchAction(option.change_action)
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			height: "100%",
			justify: "start",
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx(LocationIcon, { modality: option.visit_modality }), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "primary",
			maxLines: 2,
			size: "sm"
		}, option.location_label)), option.selected && /* @__PURE__ */ __dil.jsx("icon", {
			name: "check",
			size: "sm",
			color: "primary"
		})))))))) : /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			gap: 2,
			align: "start",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx(LocationIcon, { modality: state.visit_modality }), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "primary",
			maxLines: 2
		}, state.location_label))), (state.directions_url || state.profile_url) && /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			gap: 2,
			align: "center",
			wrap: "nowrap"
		}, state.directions_url && /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: state.directions_url,
			careProvider: true,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			color: "secondary",
			variant: "outline",
			size: "md",
			onClick: () => openUrl(state.directions_url, "care_provider_sidebar_directions_clicked")
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "map-pin" }), state.directions_label))), state.profile_url && /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: state.profile_url,
			careProvider: true,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			color: "secondary",
			variant: "outline",
			size: "md",
			onClick: () => openUrl(state.profile_url, "care_provider_sidebar_profile_clicked")
		}, state.view_on_zocdoc_label, /* @__PURE__ */ __dil.jsx("icon", { name: "arrow-up-right" }))))), /* @__PURE__ */ __dil.jsx("divider", {
			spacing: 0,
			color: "subtle"
		}), state.availability_days.length > 0 ? /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			weight: "semibold"
		}, state.appointments_heading), month && /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "medium"
		}, month.display_label), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("button", {
			label: state.previous_month_label,
			size: "sm",
			color: "secondary",
			variant: "ghost",
			uniform: true,
			disabled: monthIndex === 0,
			onClick: () => changeMonth(monthIndex - 1)
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "chevron-left" })), /* @__PURE__ */ __dil.jsx("button", {
			label: state.next_month_label,
			size: "sm",
			color: "secondary",
			variant: "ghost",
			uniform: true,
			disabled: monthIndex + 1 >= state.calendar_months.length,
			onClick: () => changeMonth(monthIndex + 1)
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "chevron-right" })))), /* @__PURE__ */ __dil.jsx("grid", {
			columns: 7,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.calendar_weekday_labels.map((label, index) => /* @__PURE__ */ __dil.jsx("grid-item", { key: \`weekday-\${index}\` }, /* @__PURE__ */ __dil.jsx("caption", {
			color: "tertiary",
			size: "md",
			textAlign: "center",
			weight: "semibold"
		}, label)))), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, month.days.map((day, index) => /* @__PURE__ */ __dil.jsx("grid-item", { key: \`\${day.date}:\${index}\` }, /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			justify: "center"
		}, day.is_current_month ? /* @__PURE__ */ __dil.jsx("pressable", {
			align: "center",
			disabled: !day.is_available,
			height: 44,
			justify: "center",
			radius: "full",
			width: 44,
			ariaLabel: day.accessibility_label,
			onClick: day.is_available ? () => setSelectedDate(day.date) : void 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			background: day.is_available ? selectedDate === day.date ? "#3A83F7" : "surface" : void 0,
			height: 44,
			justify: "center",
			radius: "full",
			width: 44
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: !day.is_available ? "tertiary" : selectedDate === day.date ? "white" : "primary",
			size: "md",
			weight: day.is_available ? "medium" : "normal"
		}, day.display_label))) : /* @__PURE__ */ __dil.jsx("box", {
			height: 44,
			width: 44
		}))))))), selectedDay && /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 3
		}, selectedDay.slot_groups.map((group, index) => /* @__PURE__ */ __dil.jsx("col", {
			key: index,
			width: "100%",
			gap: 1.5
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, group.label), /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			minWidth: 0,
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("box", {
			direction: "row",
			flex: "1 1 0%",
			minWidth: 0,
			maxWidth: "100%",
			scrollable: true,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			width: "max-content",
			wrap: "nowrap"
		}, group.slots.map((slot) => /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: slot.booking_url,
			key: slot.id,
			width: 96,
			height: 40,
			careProvider: true
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			key: slot.id,
			align: "center",
			border: {
				size: 1,
				color: "default"
			},
			height: 40,
			justify: "center",
			padding: 0,
			radius: "full",
			width: 96,
			ariaLabel: slot.accessibility_label,
			onClick: () => openUrl(slot.booking_url, "care_provider_sidebar_slot_clicked")
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			height: "100%",
			justify: "center",
			padding: { x: 2 },
			width: "100%",
			wrap: "nowrap"
		}, state.visit_modality === "telehealth" && /* @__PURE__ */ __dil.jsx("icon", {
			name: "video",
			size: "sm",
			color: "primary"
		}), /* @__PURE__ */ __dil.jsx("text", {
			maxLines: 1,
			size: "sm",
			textAlign: "center",
			truncate: true,
			weight: "medium"
		}, slot.time_label)))))))))))) : /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 1
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			weight: "semibold"
		}, state.appointments_heading), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.no_appointments_label))));
	}

//#endregion
return CareProviderSidebarWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=care-provider-sidebar-widget-cbae9fdc7db9.js.map