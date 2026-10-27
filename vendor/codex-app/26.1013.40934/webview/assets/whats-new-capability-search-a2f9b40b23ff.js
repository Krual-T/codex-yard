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
//#region AskUserLocation.dil.tsx
	const SvgPath = "path";
	function LocationPin() {
		return /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, /* @__PURE__ */ __dil.jsx("svg", {
			width: 24,
			height: 24,
			viewBox: "0 0 24 24"
		}, /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M12 9.25C10.8954 9.25 10 10.1454 10 11.25C10 12.3546 10.8954 13.25 12 13.25C13.1046 13.25 14 12.3546 14 11.25C14 10.1454 13.1046 9.25 12 9.25ZM8 11.25C8 9.04086 9.79086 7.25 12 7.25C14.2091 7.25 16 9.04086 16 11.25C16 13.4591 14.2091 15.25 12 15.25C9.79086 15.25 8 13.4591 8 11.25Z",
			fill: "currentColor"
		}), /* @__PURE__ */ __dil.jsx(SvgPath, {
			d: "M12.4258 22.6548C12.1561 22.7817 11.8432 22.7814 11.5736 22.6545C11.5355 22.6366 11.4978 22.618 11.4601 22.5993C11.3914 22.5652 11.2932 22.5156 11.1698 22.4508C10.9231 22.3212 10.5748 22.1306 10.1586 21.8817C9.32846 21.3852 8.21721 20.6503 7.10105 19.6983C4.9064 17.8264 2.5 14.9472 2.5 11.25C2.5 6.00329 6.75329 1.75 12 1.75C17.2467 1.75 21.5 6.00329 21.5 11.25C21.5 14.9472 19.0936 17.8264 16.8989 19.6983C15.7828 20.6503 14.6715 21.3852 13.8414 21.8817C13.4252 22.1306 13.0769 22.3212 12.8302 22.4508C12.6965 22.521 12.5623 22.5903 12.4258 22.6548ZM4.5 11.25C4.5 14.0528 6.3436 16.4236 8.39895 18.1767C9.40779 19.0372 10.4215 19.7085 11.1851 20.1652C11.5113 20.3602 11.7897 20.5149 12 20.6273C12.2103 20.5149 12.4887 20.3602 12.8149 20.1652C13.5785 19.7085 14.5922 19.0372 15.6011 18.1767C17.6564 16.4236 19.5 14.9472 19.5 11.25C19.5 7.10786 16.1421 3.75 12 3.75C7.85786 3.75 4.5 7.10786 4.5 11.25Z",
			fill: "currentColor"
		})));
	}
	function AskUserLocation(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("AskUserLocation", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 130
		});
		return /* @__PURE__ */ __dil.jsx(LocationRequest, { state });
	}
	function LocationRequest({ state }) {
		const wide = DIL.useBreakpoint("sm");
		const [dismissed, setDismissed] = DIL.useState(state.dismissed ?? false);
		if (dismissed) return null;
		return /* @__PURE__ */ __dil.jsx("card", {
			size: "full",
			variant: "soft",
			background: "transparent",
			radius: 0,
			padding: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			align: wide ? "center" : "stretch",
			direction: wide ? "row" : "col",
			gap: 4,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: wide ? "center" : "start",
			gap: wide ? 3 : 1,
			flex: wide ? "auto" : void 0,
			minWidth: 0,
			width: wide ? void 0 : "100%"
		}, /* @__PURE__ */ __dil.jsx(LocationPin, null), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "primary"
		}, state.title), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "normal",
			color: "secondary"
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "sm",
			weight: "normal",
			color: "secondary"
		}, \`\${state.description} \`), /* @__PURE__ */ __dil.jsx(LinkImpression, {
			url: state.learn_more_url,
			inline: true,
			width: "fit-content"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			inline: true,
			align: "start",
			width: "fit-content",
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "open_url",
				payload: { url: state.learn_more_url }
			})
		}, /* @__PURE__ */ __dil.jsx("text", {
			inline: true,
			size: "sm",
			weight: "normal",
			color: "#0285FF"
		}, state.learn_more_label)))))), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			justify: wide ? "end" : "start",
			width: wide ? "fit-content" : "100%"
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: wide ? "0 0 auto" : 1,
			width: wide ? "fit-content" : "100%"
		}, /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			color: "secondary",
			variant: "outline",
			size: "lg",
			pill: true,
			onClick: () => setDismissed(true)
		}, state.not_now_label)), /* @__PURE__ */ __dil.jsx("box", {
			flex: wide ? "0 0 auto" : 1,
			width: wide ? "fit-content" : "100%"
		}, /* @__PURE__ */ __dil.jsx("button", {
			block: true,
			color: "primary",
			variant: "solid",
			size: "lg",
			pill: true,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "request_location_permission",
				payload: {}
			})
		}, state.turn_on_label)))));
	}

//#endregion
//#region ReservationTimePillsRefWidget.dil.tsx
	function getValidLauncherPayload(payload, group) {
		if (payload == null) return void 0;
		const reference = payload.__reservation_launcher_ref;
		if (reference !== void 0) {
			if (typeof reference !== "number" || !Number.isInteger(reference) || reference < 0) return;
			const template = group?.launcher_payloads?.[reference];
			if (template == null) return void 0;
			const toolInput$1 = template.toolInput;
			if (typeof toolInput$1 !== "object" || toolInput$1 === null || Array.isArray(toolInput$1)) return;
			payload = {
				...template,
				toolInput: {
					...toolInput$1,
					..."time" in payload ? { time: payload.time } : {},
					..."selected_time" in payload ? { selected_time: payload.selected_time } : {}
				}
			};
		}
		const logging = payload.logging;
		const toolInput = payload.toolInput;
		const viewParams = payload.viewParams;
		if (typeof payload.appUri !== "string" || !payload.appUri.trim() || typeof payload.template !== "string" || !payload.template.trim() || payload.mode !== "modal" && payload.mode !== "fullscreen" || typeof payload.toolName !== "string" || !payload.toolName.trim() || typeof toolInput !== "object" || toolInput === null || Array.isArray(toolInput) || typeof logging !== "object" || logging === null || Array.isArray(logging) || logging.surface !== "search_results" || logging.intentType !== "reservation" || logging.entityType !== "place" || typeof logging.entityId !== "string" || logging.entrypointType !== "button" && logging.entrypointType !== "widget" || typeof logging.entrypointLabel !== "string" || viewParams != null && (typeof viewParams !== "object" || Array.isArray(viewParams)) || payload.conversationId != null && typeof payload.conversationId !== "string") return;
		return payload;
	}
	function getLauncherPayload(option, action, group) {
		if (action === "see_more") return getValidLauncherPayload(option.see_more_launcher_payload, group) ?? getValidLauncherPayload(option.launcher_payload, group);
		if (action === "try_again") return getValidLauncherPayload(option.try_again_launcher_payload, group) ?? getValidLauncherPayload(option.launcher_payload, group);
		return getValidLauncherPayload(option.launcher_payload, group);
	}
	function getSelectedTime(option) {
		const startDateTimeMatch = option.start_date_time?.match(/T(\\d{2}):(\\d{2})/);
		if (startDateTimeMatch) return \`\${startDateTimeMatch[1]}:\${startDateTimeMatch[2]}\`;
		const formattedTimeMatch = option.formatted_time?.match(/^(\\d{1,2}):(\\d{2})\\s*(AM|PM)$/i);
		if (!formattedTimeMatch) return;
		const hour = Number(formattedTimeMatch[1]) % 12 + (formattedTimeMatch[3].toUpperCase() === "PM" ? 12 : 0);
		return \`\${String(hour).padStart(2, "0")}:\${formattedTimeMatch[2]}\`;
	}
	function reservationLauncherPayload(option, action, group) {
		const directPayload = getLauncherPayload(option, action, group);
		const providerName = option.provider_name?.trim().toLowerCase();
		const matchingProviderOption = providerName ? [...group?.change_options ?? [], ...group?.times ?? []].find((candidate) => candidate.provider_name?.trim().toLowerCase() === providerName && getLauncherPayload(candidate, action, group) != null) : void 0;
		const fallbackPayload = matchingProviderOption ? getLauncherPayload(matchingProviderOption, action, group) : group && providerName === group.provider_name.trim().toLowerCase() ? getValidLauncherPayload(group.requested_launcher_payload, group) : void 0;
		let payload = directPayload ?? fallbackPayload;
		if (!directPayload && payload) {
			const selectedTime = getSelectedTime(option);
			const toolInput = payload.toolInput;
			if (selectedTime && typeof toolInput === "object" && toolInput !== null) payload = {
				...payload,
				toolInput: {
					...toolInput,
					selected_time: selectedTime
				}
			};
		}
		return payload;
	}
	function reservationLinkUrl(option, action = "book", group) {
		if (action === "book" && typeof option.booking_query === "string" && option.booking_query.trim()) return;
		try {
			return reservationLauncherPayload(option, action, group) ? void 0 : option.url;
		} catch {
			return;
		}
	}
	function openReservationOption(option, action = "book", group) {
		const bookingQuery = typeof option.booking_query === "string" ? option.booking_query.trim() : void 0;
		if (action === "book" && bookingQuery) {
			GenUI.dispatchAction({
				handler: "client",
				loadingBehavior: "none",
				payload: {
					query: bookingQuery,
					append_to_current_leaf: true
				},
				type: "issue_new_turn"
			});
			return;
		}
		const payload = reservationLauncherPayload(option, action, group);
		if (payload) GenUI.dispatchAction({
			handler: "client",
			payload,
			type: "launch_ecosystem_widget"
		});
		else if (option.url) GenUI.openUrl(option.url);
	}
	function ProviderLogo({ group, providerName }) {
		const logo = group.provider_logos?.find((item) => item.name === providerName);
		return logo ? /* @__PURE__ */ __dil.jsx("image", {
			alt: logo.name ?? group.provider_name,
			fit: "contain",
			height: 20,
			hideOnFailure: true,
			src: logo.logo_url,
			width: 20
		}) : null;
	}
	function TimePill({ label, onClick }) {
		return /* @__PURE__ */ __dil.jsx("pressable", {
			align: "center",
			ariaLabel: label,
			border: {
				color: "default",
				size: 1
			},
			clip: true,
			flex: "0 0 auto",
			height: 32,
			justify: "center",
			minWidth: 96,
			onClick,
			padding: { x: 3 },
			radius: "full"
		}, /* @__PURE__ */ __dil.jsx("text", {
			maxLines: 1,
			size: "sm",
			truncate: true,
			weight: "medium"
		}, label));
	}
	function ProviderOptions({ action = "book", group, label, options }) {
		if (options.length === 1) return /* @__PURE__ */ __dil.jsx(LinkImpression, {
			inline: true,
			url: reservationLinkUrl(options[0], action, group)
		}, /* @__PURE__ */ __dil.jsx(TimePill, {
			label,
			onClick: () => openReservationOption(options[0], action, group)
		}));
		if (!options.length) return null;
		return /* @__PURE__ */ __dil.jsx("popover", null, /* @__PURE__ */ __dil.jsx("popover-trigger", null, /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			border: {
				color: "default",
				size: 1
			},
			clip: true,
			flex: "0 0 auto",
			height: 32,
			justify: "center",
			minWidth: 96,
			padding: { x: 3 },
			radius: "full"
		}, /* @__PURE__ */ __dil.jsx("text", {
			maxLines: 1,
			size: "sm",
			truncate: true,
			weight: "medium"
		}, label))), /* @__PURE__ */ __dil.jsx("popover-content", {
			align: "center",
			side: "bottom",
			sideOffset: 4
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			minWidth: 140,
			padding: 1
		}, options.map((option, index) => {
			const providerName = option.provider_name ?? group.provider_name;
			return /* @__PURE__ */ __dil.jsx(LinkImpression, {
				inline: true,
				key: \`\${providerName}:\${index}\`,
				url: reservationLinkUrl(option, action, group),
				height: 32,
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("pressable", {
				align: "center",
				ariaLabel: providerName,
				height: 32,
				key: \`\${providerName}:\${index}\`,
				onClick: () => openReservationOption(option, action, group),
				padding: { x: 2 },
				radius: "md",
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				gap: 2,
				wrap: "nowrap",
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx(ProviderLogo, {
				group,
				providerName
			}), /* @__PURE__ */ __dil.jsx("text", {
				maxLines: 1,
				size: "sm",
				truncate: true
			}, providerName))));
		}))));
	}
	function ReservationGroupHeading({ group, isVoice }) {
		const options = group.change_options ?? [];
		const partySize = /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			maxLines: 1,
			size: "sm",
			truncate: true
		}, group.party_size_label);
		return /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			flex: "1 1 auto",
			gap: 1,
			minWidth: 0,
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("text", {
			maxLines: 1,
			size: "sm",
			truncate: true,
			weight: "medium"
		}, isVoice ? group.request_date_time_label ?? group.request_date_label : group.request_date_label), /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			size: "sm"
		}, "•"), options.length === 1 ? /* @__PURE__ */ __dil.jsx(LinkImpression, {
			inline: true,
			url: reservationLinkUrl(options[0], "book", group),
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: group.party_size_label,
			minWidth: 0,
			onClick: () => openReservationOption(options[0], "book", group),
			padding: 0,
			radius: "md"
		}, partySize)) : options.length > 1 ? /* @__PURE__ */ __dil.jsx("popover", null, /* @__PURE__ */ __dil.jsx("popover-trigger", null, partySize), /* @__PURE__ */ __dil.jsx("popover-content", {
			align: "start",
			side: "bottom",
			sideOffset: 4
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			minWidth: 140,
			padding: 1
		}, options.map((option, index) => {
			const providerName = option.provider_name ?? group.provider_name;
			return /* @__PURE__ */ __dil.jsx(LinkImpression, {
				inline: true,
				key: \`\${providerName}:\${index}\`,
				url: reservationLinkUrl(option, "book", group),
				height: 32,
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("pressable", {
				align: "center",
				ariaLabel: providerName,
				height: 32,
				key: \`\${providerName}:\${index}\`,
				onClick: () => openReservationOption(option, "book", group),
				padding: { x: 2 },
				radius: "md",
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				gap: 2,
				width: "100%",
				wrap: "nowrap"
			}, /* @__PURE__ */ __dil.jsx(ProviderLogo, {
				group,
				providerName
			}), /* @__PURE__ */ __dil.jsx("text", {
				maxLines: 1,
				size: "sm",
				truncate: true
			}, providerName))));
		})))) : isVoice && group.requested_launcher_payload ? /* @__PURE__ */ __dil.jsx(LinkImpression, {
			inline: true,
			url: reservationLinkUrl({ launcher_payload: group.requested_launcher_payload }, "book", group),
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: group.party_size_label,
			minWidth: 0,
			onClick: () => openReservationOption({ launcher_payload: group.requested_launcher_payload }, "book", group),
			padding: 0,
			radius: "md"
		}, partySize)) : partySize);
	}
	function SlotOptions({ group, onSelectSeating, seatingOptionsEnabled, slot }) {
		if (slot.is_requested_unavailable) return /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			border: {
				color: "subtle",
				size: 1
			},
			flex: "0 0 auto",
			height: 32,
			justify: "center",
			minWidth: 96,
			padding: { x: 3 },
			radius: "full"
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "tertiary",
			maxLines: 1,
			size: "sm",
			truncate: true
		}, slot.formatted_time));
		if (slot.is_more_options) {
			const options$1 = group.change_options ?? [];
			if (options$1.length) return /* @__PURE__ */ __dil.jsx(ProviderOptions, {
				action: "see_more",
				group,
				label: slot.formatted_time,
				options: options$1
			});
			return /* @__PURE__ */ __dil.jsx(LinkImpression, {
				inline: true,
				url: reservationLinkUrl({
					launcher_payload: group.see_more_launcher_payload ?? group.requested_launcher_payload ?? slot.launcher_payload,
					url: slot.url
				}, "see_more", group)
			}, /* @__PURE__ */ __dil.jsx(TimePill, {
				label: slot.formatted_time,
				onClick: () => openReservationOption({
					launcher_payload: group.see_more_launcher_payload ?? group.requested_launcher_payload ?? slot.launcher_payload,
					url: slot.url
				}, "see_more", group)
			}));
		}
		if (seatingOptionsEnabled && (slot.seating_options?.length ?? 0) > 1) return /* @__PURE__ */ __dil.jsx(TimePill, {
			label: slot.formatted_time,
			onClick: onSelectSeating
		});
		const options = slot.provider_times ?? [];
		const bookingOption = slot.launcher_payload ? slot : options[0] ?? slot;
		if (options.length > 1) return /* @__PURE__ */ __dil.jsx(ProviderOptions, {
			group,
			label: slot.formatted_time,
			options
		});
		return /* @__PURE__ */ __dil.jsx(LinkImpression, {
			inline: true,
			url: reservationLinkUrl(bookingOption, "book", group)
		}, /* @__PURE__ */ __dil.jsx(TimePill, {
			label: slot.formatted_time,
			onClick: () => openReservationOption(bookingOption, "book", group)
		}));
	}
	function SelectedSeatingOptions({ group, onDismiss, slot }) {
		return /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			width: "max-content",
			wrap: "nowrap"
		}, [/* @__PURE__ */ __dil.jsx(TimePill, {
			key: "selected-time",
			label: slot.formatted_time,
			onClick: onDismiss
		}), ...(slot.seating_options ?? []).map((option) => /* @__PURE__ */ __dil.jsx(ProviderOptions, {
			group,
			key: option.label,
			label: option.label,
			options: option.provider_times
		}))]);
	}
	function ReservationGroupView({ group, isDesktop, isVoice, onSelectSlot, selectedSlotKey, seatingOptionsEnabled, showMoreTimesLabel }) {
		const preferredSlots = isDesktop && !isVoice ? group.time_slots : group.mobile_time_slots;
		const alternateSlots = isDesktop && !isVoice ? group.mobile_time_slots : group.time_slots;
		const allSlots = preferredSlots?.length ? preferredSlots : alternateSlots?.length ? alternateSlots : (group.times ?? []).map((time, index) => ({
			...time,
			formatted_time: time.formatted_time ?? "",
			slot_key: \`\${group.group_key}:\${index}\`
		}));
		const slots = isVoice ? allSlots.slice(0, 5) : allSlots;
		const moreTimesOption = group.change_options?.find((option) => getLauncherPayload(option, "see_more", group) != null || option.url);
		const showMoreTimes = isVoice && allSlots.length > 5 && showMoreTimesLabel && (moreTimesOption != null || group.requested_launcher_payload != null);
		const selectedSlot = selectedSlotKey ? slots.find((slot) => slot.slot_key === selectedSlotKey) : void 0;
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			justify: "between",
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx(ReservationGroupHeading, {
			group,
			isVoice
		}), (group.provider_logos?.length ?? 0) > 0 ? /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 1,
			wrap: "nowrap"
		}, (group.provider_logos ?? []).map((logo, index) => /* @__PURE__ */ __dil.jsx("box", { key: \`\${logo.logo_url}:\${index}\` }, /* @__PURE__ */ __dil.jsx("image", {
			alt: logo.name ?? group.provider_name,
			fit: "contain",
			height: 20,
			hideOnFailure: true,
			radius: "full",
			src: logo.logo_url,
			width: 20
		})))) : null), slots.length && (group.times?.length ?? 0) > 0 ? /* @__PURE__ */ __dil.jsx("box", {
			direction: "row",
			minWidth: 0,
			scrollable: true,
			width: "100%"
		}, selectedSlot && seatingOptionsEnabled ? /* @__PURE__ */ __dil.jsx(SelectedSeatingOptions, {
			group,
			onDismiss: () => onSelectSlot(""),
			slot: selectedSlot
		}) : /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			width: "max-content",
			wrap: "nowrap"
		}, [...slots.map((slot, index) => /* @__PURE__ */ __dil.jsx(SlotOptions, {
			group,
			key: slot.slot_key || \`\${slot.formatted_time}:\${index}\`,
			onSelectSeating: () => onSelectSlot(slot.slot_key ?? ""),
			seatingOptionsEnabled,
			slot
		})), ...showMoreTimes ? [/* @__PURE__ */ __dil.jsx(LinkImpression, {
			inline: true,
			key: "show-more-times",
			url: moreTimesOption ? reservationLinkUrl(moreTimesOption, "see_more", group) : void 0
		}, /* @__PURE__ */ __dil.jsx(TimePill, {
			key: "show-more-times",
			label: showMoreTimesLabel,
			onClick: () => moreTimesOption ? openReservationOption(moreTimesOption, "see_more", group) : openReservationOption({ launcher_payload: group.see_more_launcher_payload ?? group.requested_launcher_payload }, "see_more", group)
		}))] : []])) : /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			background: "surface-secondary",
			gap: 2,
			justify: "between",
			padding: 2,
			radius: "lg",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			color: "danger",
			maxLines: 2,
			size: "sm"
		}, group.empty_state_label), (group.change_options?.length ?? 0) > 0 ? /* @__PURE__ */ __dil.jsx(ProviderOptions, {
			action: "try_again",
			group,
			label: group.try_again_label,
			options: group.change_options ?? []
		}) : null));
	}
	function VoiceGalleryImage({ card, image, images, index }) {
		const imageUrl = image.image_url ?? image.content_url;
		if (!imageUrl) return null;
		return /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: image.alt_text ?? card.title ?? "",
			height: "100%",
			onClick: () => GenUI.openImageLightbox(images, index),
			radius: "none",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("image", {
			alt: image.alt_text ?? card.title ?? "",
			fit: "cover",
			height: "100%",
			hideOnFailure: true,
			radius: "none",
			src: imageUrl,
			width: "100%"
		}));
	}
	function VoiceGallery({ card }) {
		const images = card.images ?? [];
		if (images.length < 3) return null;
		return /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			height: 200,
			width: "100%",
			wrap: "nowrap"
		}, /* @__PURE__ */ __dil.jsx("box", {
			height: "100%",
			minWidth: 0,
			width: "60%"
		}, /* @__PURE__ */ __dil.jsx(VoiceGalleryImage, {
			card,
			image: images[0],
			images,
			index: 0
		})), /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			height: "100%",
			minWidth: 0,
			width: "40%"
		}, images.slice(1, 3).map((image, index) => /* @__PURE__ */ __dil.jsx("box", {
			flex: "1 1 0",
			key: index,
			minHeight: 0,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(VoiceGalleryImage, {
			card,
			image,
			images,
			index: index + 1
		})))));
	}
	function VoiceCard({ card }) {
		const image = card.images?.[0];
		const imageUrl = image?.content_url ?? image?.image_url;
		const hasGallery = (card.images?.length ?? 0) >= 3;
		const content = /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 3,
			width: "100%",
			wrap: "nowrap"
		}, imageUrl && !hasGallery ? /* @__PURE__ */ __dil.jsx("image", {
			alt: image?.alt_text ?? card.title ?? "",
			fit: "cover",
			height: 64,
			hideOnFailure: true,
			radius: "lg",
			src: imageUrl,
			width: 64
		}) : null, /* @__PURE__ */ __dil.jsx("col", {
			flex: "1 1 auto",
			gap: 1,
			minWidth: 0
		}, card.title ? /* @__PURE__ */ __dil.jsx("text", {
			maxLines: 1,
			size: "md",
			truncate: true,
			weight: "semibold"
		}, card.title) : null, card.metadata_label ? /* @__PURE__ */ __dil.jsx("text", {
			color: "secondary",
			maxLines: 2,
			size: "sm"
		}, card.metadata_label) : null));
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(VoiceGallery, { card }), card.click_action ? /* @__PURE__ */ __dil.jsx(LinkImpression, {
			action: card.click_action,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: card.title ?? card.metadata_label ?? "",
			onClick: () => GenUI.dispatchAction(card.click_action),
			width: "100%"
		}, content)) : content);
	}
	function ResolvedReservationTimePills({ state }) {
		const collapsedCount = state.collapsed_groups_to_show ?? 3;
		const initialVisibleCount = state.groups_to_show ?? collapsedCount;
		const expandedCount = Math.min(state.expanded_groups_to_show ?? state.groups.length, state.groups.length);
		const visibleCountResetKey = \`\${state.groups[0]?.group_key ?? ""}:\${initialVisibleCount}\`;
		const [visibleCount, setVisibleCount] = DIL.useState(initialVisibleCount);
		const [lastVisibleCountResetKey, setLastVisibleCountResetKey] = DIL.useState(visibleCountResetKey);
		const [selectedGroupKey, setSelectedGroupKey] = DIL.useState("");
		const [selectedSlotKey, setSelectedSlotKey] = DIL.useState("");
		const hasLoggedImpression = DIL.useRef(false);
		const isDesktop = DIL.useBreakpoint("sm");
		const isVoice = state.rendering_mode === "voice";
		DIL.useEffect(() => {
			if (lastVisibleCountResetKey !== visibleCountResetKey) {
				setVisibleCount(initialVisibleCount);
				setLastVisibleCountResetKey(visibleCountResetKey);
			}
		}, [
			initialVisibleCount,
			lastVisibleCountResetKey,
			visibleCountResetKey
		]);
		if (!state.groups.length) return null;
		return /* @__PURE__ */ __dil.jsx("box", {
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
			} : {},
			gap: 4,
			maxWidth: state.rendering_mode === "voice" ? 420 : "100%",
			padding: 0,
			width: "100%"
		}, isVoice && state.voice_card ? /* @__PURE__ */ __dil.jsx(VoiceCard, { card: state.voice_card }) : null, /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			width: "100%"
		}, state.groups.slice(0, isVoice ? 1 : visibleCount).map((group, index) => /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			key: group.group_key,
			width: "100%"
		}, index > 0 ? /* @__PURE__ */ __dil.jsx("divider", null) : null, /* @__PURE__ */ __dil.jsx(ReservationGroupView, {
			group,
			isDesktop,
			isVoice,
			onSelectSlot: (slotKey) => {
				setSelectedGroupKey(slotKey ? group.group_key : "");
				setSelectedSlotKey(slotKey);
			},
			seatingOptionsEnabled: state.seating_options_enabled ?? false,
			selectedSlotKey: selectedGroupKey === group.group_key ? selectedSlotKey : "",
			showMoreTimesLabel: state.show_more_times_label ?? ""
		})))), !isVoice && expandedCount > collapsedCount ? /* @__PURE__ */ __dil.jsx("pressable", {
			align: "center",
			ariaLabel: visibleCount < expandedCount ? state.see_more_dates_label : state.show_fewer_dates_label,
			border: {
				color: "default",
				size: 1
			},
			height: 36,
			justify: "center",
			onClick: () => setVisibleCount(visibleCount < expandedCount ? expandedCount : collapsedCount),
			radius: "md",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium"
		}, visibleCount < expandedCount ? state.see_more_dates_label : state.show_fewer_dates_label)) : null);
	}
	function ReservationTimePillsRefWidget(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("ReservationTimePillsRefWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading", { label: "Loading reservations" });
		return /* @__PURE__ */ __dil.jsx(ResolvedReservationTimePills, { state });
	}

//#endregion
//#region WhatsNewCapabilitySearch.dil.tsx
	function WhatsNewCapabilitySearch(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("WhatsNewCapabilitySearch", props.__resolutionId ? {
			...props,
			__state: void 0
		} : props);
		const host = DIL.useAppData((data) => data.opGenui);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 100
		});
		const can = (type) => !state.is_streaming && (type === "open_url" || type === "issue_new_turn" || type === "request_location_permission" || (type === "open_entity_detail" ? host?.entityActions?.ready === true : host?.supportedClientActions?.includes(type) === true));
		const locationState = state.location_widget?.initialState;
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			width: "100%"
		}, state.intro !== "" && /* @__PURE__ */ __dil.jsx("box", { padding: { bottom: 4 } }, /* @__PURE__ */ __dil.jsx("text", null, state.intro)), (state.location_prompt !== "" || state.offer_precise_location) && /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			width: "100%",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			wrap: "wrap",
			align: "center",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "map-pin",
			size: "sm",
			color: "secondary"
		}), /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, state.location_variant === "button" ? state.search_location || state.location_prompt : state.location_prompt), state.offer_precise_location && (state.location_variant === "button" || !locationState || !can("request_location_permission")) && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, "·"), /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: state.inline_location_label,
			disabled: !can("request_location_permission"),
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "request_location_permission",
				payload: {}
			})
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			underline: "dotted"
		}, state.inline_location_label)))), state.offer_precise_location && state.location_variant === "widget" && locationState && can("request_location_permission") && /* @__PURE__ */ __dil.jsx(AskUserLocation, { __state: locationState })), state.is_streaming && state.tabs.length === 0 && /* @__PURE__ */ __dil.jsx("box", {
			role: "status",
			padding: { y: 4 }
		}, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 48
		})), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.tabs.map((item) => {
			const venue = item.venue;
			const reservation = item.reservation_widget?.initialState;
			const action = venue?.url ? {
				handler: "client",
				type: "open_url",
				payload: {
					url: venue.url,
					require_safe_url_confirmation: true
				}
			} : {
				handler: "client",
				type: "issue_new_turn",
				payload: {
					query: item.prompt,
					append_to_current_leaf: true
				}
			};
			return /* @__PURE__ */ __dil.jsx("animate", {
				key: item.id,
				preventInitialTransition: !state.animate_reveal,
				initial: {
					opacity: 0,
					translateY: 4
				},
				enter: {
					opacity: 1,
					translateY: 0,
					duration: 180
				}
			}, /* @__PURE__ */ __dil.jsx("col", {
				gap: 2,
				padding: {
					top: 4,
					bottom: 0
				},
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("col", {
				gap: 3,
				width: "100%"
			}, !venue && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("title", {
				size: "lg",
				weight: "semibold"
			}, item.title), /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, item.example_label)), item.notes.length > 0 && /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("list", {
				marker: "number",
				gap: 3
			}, item.notes.map((note, index) => /* @__PURE__ */ __dil.jsx("list-item", { key: index }, /* @__PURE__ */ __dil.jsx("text", null, note)))), item.cta_prompt && /* @__PURE__ */ __dil.jsx("row", null, /* @__PURE__ */ __dil.jsx("button", {
				color: "primary",
				variant: "solid",
				size: "md",
				pill: true,
				disabled: !can("issue_new_turn"),
				onClick: () => GenUI.issueNewTurn(item.cta_prompt ?? "", { append_to_current_leaf: true })
			}, item.cta_label))), venue && /* @__PURE__ */ __dil.jsx("col", {
				gap: 3,
				minWidth: 0
			}, /* @__PURE__ */ __dil.jsx("row", {
				gap: 3,
				align: "start",
				wrap: "nowrap",
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("col", {
				gap: 2,
				flex: 1,
				minWidth: 0
			}, /* @__PURE__ */ __dil.jsx(LinkImpression, {
				action: item.venue_click_action,
				disabled: !item.venue_click_action || !can(item.venue_click_action.type)
			}, /* @__PURE__ */ __dil.jsx("pressable", {
				ariaLabel: venue.name,
				disabled: !item.venue_click_action || !can(item.venue_click_action.type),
				onClick: () => item.venue_click_action && GenUI.dispatchAction(item.venue_click_action)
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "lg",
				weight: "semibold",
				underline: "dotted"
			}, venue.name))), /* @__PURE__ */ __dil.jsx("text", null, venue.detail), /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, venue.address)), (!item.native_map || item.show_source_image) && /* @__PURE__ */ __dil.jsx("box", {
				width: 80,
				height: 80,
				minWidth: 80,
				background: "surface-secondary",
				radius: "lg",
				align: "center",
				justify: "center",
				clip: true
			}, item.search_image ? /* @__PURE__ */ __dil.jsx("search-image", {
				searchImage: item.search_image,
				alt: venue.name,
				width: 80,
				height: 80,
				fit: "cover",
				radius: "lg",
				hideOnFailure: true,
				fallback: /* @__PURE__ */ __dil.jsx("icon", {
					name: "map-pin",
					size: "lg",
					color: "secondary"
				})
			}) : /* @__PURE__ */ __dil.jsx("icon", {
				name: "map-pin",
				size: "lg",
				color: "secondary"
			}))), item.native_map && /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, state.native_map_unavailable_label ?? "Map preview isn’t available here."), !item.reservation_widget && !item.enrichment_pending && /* @__PURE__ */ __dil.jsx("row", null, /* @__PURE__ */ __dil.jsx(LinkImpression, {
				action,
				inline: true,
				disabled: !can(action.type)
			}, /* @__PURE__ */ __dil.jsx("button", {
				color: "primary",
				variant: "solid",
				size: "md",
				pill: true,
				disabled: !can(action.type),
				onClick: () => GenUI.dispatchAction(action)
			}, item.cta_label))), reservation && /* @__PURE__ */ __dil.jsx(ReservationTimePillsRefWidget, {
				ref: venue.business_ref ?? "",
				__state: reservation
			}), item.enrichment_pending && /* @__PURE__ */ __dil.jsx("box", {
				role: "status",
				padding: { y: 2 }
			}, /* @__PURE__ */ __dil.jsx("loading-block", {
				width: "100%",
				height: 48
			})), !item.enrichment_pending && item.footer !== "" && /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, item.footer))), item.sources.length > 0 && /* @__PURE__ */ __dil.jsx("row", {
				gap: 3,
				wrap: "wrap"
			}, item.sources.map((source) => /* @__PURE__ */ __dil.jsx(LinkImpression, {
				url: source.url,
				inline: true,
				key: source.url,
				disabled: !can("open_url")
			}, /* @__PURE__ */ __dil.jsx("pressable", {
				key: source.url,
				inline: true,
				disabled: !can("open_url"),
				onClick: () => GenUI.dispatchAction({
					handler: "client",
					type: "open_url",
					payload: {
						url: source.url,
						require_safe_url_confirmation: true
					}
				})
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary"
			}, source.source_label))))), !venue && item.footer !== "" && /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, item.footer)));
		})));
	}

//#endregion
return WhatsNewCapabilitySearch;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=whats-new-capability-search-a2f9b40b23ff.js.map