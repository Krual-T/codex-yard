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
//#region CareProviderResultsWidget.dil.tsx
	function LocationLabel({ location }) {
		return /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			flex: 1,
			gap: .5,
			minWidth: 0,
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("text", {
			maxLines: 1,
			size: "xs",
			truncate: true,
			weight: "medium"
		}, location.location_label), location.distance_label != null && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "xs"
		}, "•"), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			maxLines: 1,
			size: "xs",
			truncate: true
		}, location.distance_label)));
	}
	function availabilityDays(location) {
		return location.combined_patient_status_availability_days ?? location.availability_days;
	}
	function patientStatusSlotKey(location, date, slot) {
		return \`\${location.candidate_id}:\${date}:\${slot.slot_id}\`;
	}
	function openCareBooking(bookingUrl, partner) {
		GenUI.dispatchAction({
			type: "open_url",
			handler: "client",
			payload: {
				url: bookingUrl,
				event_name: "chatgpt_widget_action",
				statsig_event_name: "care_provider_slot_clicked",
				event_data: {
					widget_name: "care_provider_results_widget",
					widget_action_target: "booking_appointment",
					widget_affordance: "OPTION",
					surface_location: "RESPONSE",
					content_reference_type: "care_provider_results",
					partner
				}
			}
		});
	}
	function BookingTimePills({ date, location, slots, selectedSlotKey, onSelectSlot }) {
		const hasSelectedSlot = slots.some((slot) => (slot.booking_options?.length ?? 0) > 1 && patientStatusSlotKey(location, date, slot) === selectedSlotKey);
		return /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			minWidth: 0,
			scrollable: true,
			width: "100%",
			wrap: "nowrap"
		}, slots.map((slot) => {
			const slotKey = patientStatusSlotKey(location, date, slot);
			const hasChoices = (slot.booking_options?.length ?? 0) > 1;
			const selected = hasSelectedSlot && selectedSlotKey === slotKey;
			if (hasSelectedSlot && !selected) return null;
			return /* @__PURE__ */ __dil.jsx("row", {
				key: slot.slot_id,
				align: "center",
				flex: "none",
				gap: 2,
				width: "max-content",
				wrap: "nowrap"
			}, /* @__PURE__ */ __dil.jsx(LinkImpression, {
				url: !hasChoices ? slot.booking_url : void 0,
				width: selected ? 144 : 112,
				height: 40,
				flex: "none",
				careProvider: true
			}, /* @__PURE__ */ __dil.jsx("pressable", {
				align: "center",
				border: {
					size: 1,
					color: selected ? "primary" : "default"
				},
				flex: "none",
				height: 40,
				justify: "center",
				padding: 0,
				radius: "full",
				width: selected ? 144 : 112,
				ariaLabel: hasChoices ? (selected ? slot.dismiss_patient_status_accessibility_label : slot.choose_patient_status_accessibility_label) ?? slot.accessibility_label : slot.accessibility_label,
				ariaPressed: hasChoices ? selected : void 0,
				onClick: () => {
					if (hasChoices) onSelectSlot(selected ? "" : slotKey);
					else openCareBooking(slot.booking_url, location.partner);
				}
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				gap: 1,
				height: "100%",
				justify: "center",
				padding: { x: 2 },
				width: "100%"
			}, selected && /* @__PURE__ */ __dil.jsx("icon", {
				name: "x",
				size: "sm",
				color: "primary"
			}), location.visit_modality === "telehealth" && /* @__PURE__ */ __dil.jsx("icon", {
				name: "video",
				size: "sm",
				color: "primary"
			}), /* @__PURE__ */ __dil.jsx("text", {
				maxLines: 1,
				size: "sm",
				textAlign: "center",
				truncate: true,
				weight: "medium"
			}, slot.display_label)))), selected && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, (slot.booking_options ?? []).map((option) => /* @__PURE__ */ __dil.jsx(LinkImpression, {
				url: option.booking_url,
				key: option.patient_status,
				width: "max-content",
				height: 40,
				flex: "none",
				minWidth: 112,
				careProvider: true
			}, /* @__PURE__ */ __dil.jsx("pressable", {
				key: option.patient_status,
				align: "center",
				ariaLabel: option.accessibility_label,
				border: {
					size: 1,
					color: "default"
				},
				flex: "none",
				height: 40,
				justify: "center",
				minWidth: 112,
				padding: { x: 3 },
				radius: "full",
				width: "max-content",
				onClick: () => openCareBooking(option.booking_url, location.partner)
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				height: "100%",
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				textAlign: "center",
				weight: "medium"
			}, option.label)))))));
		}));
	}
	function ResolvedCare({ state }) {
		const [localProvidersToShow, setProvidersToShow] = DIL.useState(void 0);
		const providersToShow = localProvidersToShow ?? state.providers_to_show;
		const [localSelectedProviderId, setSelectedProviderId] = DIL.useState(void 0);
		const selectedProviderId = localSelectedProviderId ?? state.selected_provider_id;
		const [localSelectedDate, setSelectedDate] = DIL.useState(void 0);
		const selectedDate = localSelectedDate ?? state.selected_date;
		const [selectedPatientStatusSlotKey, setSelectedPatientStatusSlotKey] = DIL.useState("");
		const hasLoggedImpression = DIL.useRef(false);
		if (!state.should_render) return null;
		return /* @__PURE__ */ __dil.jsx("box", {
			padding: { x: 1 },
			width: "40rem",
			maxWidth: "100%",
			...GenUI.logEvent ? {
				onVisibleWhen: !hasLoggedImpression.current,
				onVisible: () => {
					hasLoggedImpression.current = true;
					GenUI.logEvent?.({
						event_name: "care_provider_results_impression",
						statsig_event_name: "care_provider_results_impression",
						event_data: {
							widget_name: "care_provider_results_widget",
							status: state.status,
							has_bookable_slots: state.has_bookable_slots
						}
					});
				}
			} : {}
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			width: "100%"
		}, (state.status === "empty" || state.status === "error") && /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "lg",
			weight: "semibold"
		}, state.title), state.subtitle != null && /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, state.subtitle)), state.status === "empty" && /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			background: "surface-secondary",
			gap: 2,
			padding: {
				x: 5,
				y: 6
			},
			radius: "xl",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "map-pin",
			size: "lg",
			color: "secondary"
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "semibold"
		}, state.empty_title), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm",
			textAlign: "center"
		}, state.empty_message)), state.status === "error" && /* @__PURE__ */ __dil.jsx("col", {
			align: "center",
			background: "surface-secondary",
			gap: 2,
			padding: {
				x: 5,
				y: 6
			},
			radius: "xl",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "semibold"
		}, state.error_title), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm",
			textAlign: "center"
		}, state.error_message), /* @__PURE__ */ __dil.jsx("button", {
			variant: "outline",
			onClick: () => GenUI.issueNewTurn(state.retry_query)
		}, state.retry_label)), (state.status === "ok" || state.status === "partial") && /* @__PURE__ */ __dil.jsx("col", {
			gap: 8,
			width: "100%"
		}, state.status === "partial" && state.partial_notice != null && /* @__PURE__ */ __dil.jsx("box", {
			background: "surface-secondary",
			padding: {
				x: 3,
				y: 2
			},
			radius: "lg",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, state.partial_notice)), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.providers.slice(0, providersToShow).map((provider) => /* @__PURE__ */ __dil.jsx("col", {
			key: provider.candidate_id,
			gap: 4,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 3,
			width: "100%",
			wrap: "nowrap"
		}, provider.photo_url != null ? /* @__PURE__ */ __dil.jsx("image", {
			src: provider.photo_url,
			alt: provider.photo_alt,
			fit: "cover",
			hideOnFailure: true,
			radius: "full",
			width: 48,
			height: 48,
			fallback: /* @__PURE__ */ __dil.jsx("box", {
				align: "center",
				background: "surface-secondary",
				height: 48,
				justify: "center",
				radius: "full",
				width: 48
			}, /* @__PURE__ */ __dil.jsx("text", {
				color: "secondary",
				size: "sm",
				weight: "medium"
			}, provider.initials))
		}) : /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			background: "surface-secondary",
			height: 48,
			justify: "center",
			radius: "full",
			width: 48
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm",
			weight: "medium"
		}, provider.initials)), /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			gap: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			minWidth: 0,
			wrap: "nowrap"
		}, provider.name_click_action != null ? /* @__PURE__ */ __dil.jsx(LinkImpression, {
			action: provider.name_click_action,
			flex: 1,
			minWidth: 0,
			careProvider: true
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			flex: 1,
			minWidth: 0,
			ariaLabel: provider.profile_accessibility_label,
			onClick: () => GenUI.dispatchAction(provider.name_click_action)
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "primary",
			maxLines: 1,
			size: "xl",
			truncate: true,
			underline: "dotted",
			weight: "medium"
		}, provider.display_name_with_credentials_and_specialty))) : /* @__PURE__ */ __dil.jsx("box", { flex: 1 }, /* @__PURE__ */ __dil.jsx("text", {
			color: "primary",
			maxLines: 1,
			size: "xl",
			truncate: true,
			underline: "dotted",
			weight: "medium"
		}, provider.display_name_with_credentials_and_specialty))), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: .5,
			minWidth: 0,
			wrap: "nowrap"
		}, provider.rating_label != null && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("icon", {
			name: "star-filled",
			size: "sm",
			color: "primary"
		}), /* @__PURE__ */ __dil.jsx("text", {
			color: "primary",
			size: "md"
		}, provider.rating_label)), provider.rating_label != null && provider.review_count_label != null && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "md"
		}, "("), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "md"
		}, provider.review_count_label), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "md"
		}, ")")), provider.locations[0]?.partner_logo_url != null && /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			flex: "none",
			height: 20,
			justify: "center",
			width: 20
		}, /* @__PURE__ */ __dil.jsx("image", {
			src: provider.locations[0].partner_logo_url,
			alt: provider.locations[0].partner_label,
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
		})), provider.in_network_label != null && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, (provider.rating_label != null || provider.locations[0]?.partner_logo_url != null) && /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, "•"), /* @__PURE__ */ __dil.jsx("text", {
			color: provider.in_network === true ? "#3A83F7" : "secondary",
			size: "sm"
		}, provider.in_network_label))))), provider.summary != null && /* @__PURE__ */ __dil.jsx("text", {
			color: "primary",
			maxLines: 4,
			size: "md"
		}, provider.summary), /* @__PURE__ */ __dil.jsx("col", {
			border: {
				size: 1,
				color: "default"
			},
			gap: 4,
			padding: 5,
			radius: "4xl",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, provider.locations.map((location) => /* @__PURE__ */ __dil.jsx("col", {
			key: location.candidate_id,
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			justify: "between",
			minWidth: 0,
			width: "100%",
			wrap: "nowrap"
		}, provider.locations.length > 1 && location.location_click_action != null ? /* @__PURE__ */ __dil.jsx(LinkImpression, {
			action: location.location_click_action,
			height: 44,
			flex: 1,
			minWidth: 0,
			careProvider: true
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			flex: 1,
			height: 44,
			minWidth: 0,
			padding: 0,
			radius: "md",
			ariaLabel: location.location_accessibility_label ?? void 0,
			onClick: () => {
				setSelectedPatientStatusSlotKey("");
				GenUI.dispatchAction(location.location_click_action);
			}
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			height: "100%",
			minWidth: 0,
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			flex: "none",
			height: 20,
			justify: "center",
			width: 20
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: location.visit_modality === "telehealth" ? "video" : "map-pin",
			size: "sm",
			color: "secondary"
		})), /* @__PURE__ */ __dil.jsx(LocationLabel, { location })))) : /* @__PURE__ */ __dil.jsx(LocationLabel, { location })), availabilityDays(location).length > 0 ? /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 3,
			minWidth: 0,
			scrollable: true,
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, availabilityDays(location).map((day) => /* @__PURE__ */ __dil.jsx("pressable", {
			key: day.date,
			align: "start",
			border: {
				size: 1,
				color: "default"
			},
			flex: "none",
			height: 59,
			justify: "center",
			minWidth: 118,
			padding: {
				x: 3.5,
				y: 1
			},
			radius: "2xl",
			width: "max-content",
			ariaLabel: day.accessibility_label,
			background: selectedProviderId === location.candidate_id && selectedDate === day.date ? {
				light: "alpha-08",
				dark: "alpha-12"
			} : "transparent",
			onClick: () => {
				const deselect = selectedProviderId === location.candidate_id && selectedDate === day.date;
				setSelectedProviderId(deselect ? "" : location.candidate_id);
				setSelectedDate(deselect ? "" : day.date);
				setSelectedPatientStatusSlotKey("");
				GenUI.dispatchAction({
					type: "log_event",
					handler: "client",
					payload: {
						event_name: "care_provider_day_clicked",
						statsig_event_name: "care_provider_day_clicked",
						event_data: {
							widget_name: "care_provider_results_widget",
							partner: location.partner
						}
					}
				});
			}
		}, /* @__PURE__ */ __dil.jsx("col", {
			align: "start",
			gap: 1,
			height: "100%",
			justify: "center",
			width: "max-content"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			textAlign: "start",
			weight: "semibold"
		}, day.display_label), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "xs",
			textAlign: "start"
		}, day.appointment_count_label)))))), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, availabilityDays(location).map((day) => selectedProviderId === location.candidate_id && selectedDate === day.date && /* @__PURE__ */ __dil.jsx("col", {
			key: day.date,
			gap: 2,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, day.slot_groups.map((group, groupIndex) => /* @__PURE__ */ __dil.jsx("col", {
			key: groupIndex,
			gap: 1,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("caption", {
			color: "secondary",
			size: "sm"
		}, group.label), /* @__PURE__ */ __dil.jsx(BookingTimePills, {
			date: day.date,
			location,
			slots: group.slots,
			selectedSlotKey: selectedPatientStatusSlotKey,
			onSelectSlot: setSelectedPatientStatusSlotKey
		})))))))) : /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, state.no_availability_label)))))))), state.expanded_providers_to_show > providersToShow ? /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			variant: "outline",
			onClick: () => setProvidersToShow(state.expanded_providers_to_show)
		}, state.show_more_label) : state.has_more_results && /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			variant: "outline",
			onClick: () => GenUI.issueNewTurn(state.more_results_query, { followup_metadata: { care_provider_cursor: typeof state.next_cursor === "string" ? state.next_cursor : null } })
		}, state.more_results_label))));
	}
	function CareProviderResultsWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("CareProviderResultsWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : null;
		return /* @__PURE__ */ __dil.jsx(ResolvedCare, { state });
	}

//#endregion
return CareProviderResultsWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=care-provider-results-widget-45b1c5592ab4.js.map