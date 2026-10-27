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
//#region RestaurantAvailabilityWidget.dil.tsx
	function RestaurantAvailabilityWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("RestaurantAvailabilityWidget", props);
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("loading", { label: "Loading reservations" });
		return /* @__PURE__ */ __dil.jsx(ReservationTimePillsRefWidget, {
			ref: props.ref,
			__state: state
		});
	}

//#endregion
return RestaurantAvailabilityWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=restaurant-availability-widget-6bd5e660f360.js.map