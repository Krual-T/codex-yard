import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region learning/primitives/LearningExercisePager.dil.tsx
	function LearningExercisePager({ exercises, previousLabel, nextLabel, nextButtonLabel, progressLabels, newTurnQuery, doneButtonLabel, renderExercise, getResponse, isExerciseComplete = (_, selectedIds$1) => selectedIds$1.length > 0 }) {
		const instanceId = DIL.useId();
		const [viewState, setViewState] = DIL.useState({
			currentId: null,
			answers: {}
		});
		const currentViewState = DIL.useRef(viewState);
		currentViewState.current = viewState;
		const updateViewState = (next) => {
			currentViewState.current = next;
			setViewState(next);
		};
		const index = Math.max(0, exercises.findIndex((exercise$1) => exercise$1.id === viewState.currentId));
		const exercise = exercises[index];
		if (!exercise) return null;
		const answer = viewState.answers[exercise.id];
		const selectedIds = answer?.revision === exercise.revision ? answer.selectedIds : [];
		const canAdvance = index < exercises.length - 1 && isExerciseComplete(exercise.data, selectedIds);
		const revision = JSON.stringify(exercises.map((item) => [item.id, item.revision]));
		const showDone = Boolean(doneButtonLabel && newTurnQuery && index === exercises.length - 1);
		const canFinish = isExerciseComplete(exercise.data, selectedIds) && viewState.submittedRevision !== revision;
		const submitAnswers = (answers, query = newTurnQuery) => {
			const responses = exercises.flatMap((item, itemIndex) => {
				const exerciseAnswer = answers[item.id];
				if (exerciseAnswer?.revision !== item.revision || !exerciseAnswer.selectedIds.length) return [];
				const response = getResponse(item.data, exerciseAnswer.selectedIds);
				return [\`\${itemIndex + 1}. \${response.question}\\n→ \${response.answer}\`];
			});
			GenUI.issueNewTurn([query, ...responses].join("\\n\\n"), {
				append_to_current_leaf: true,
				followup_metadata: {}
			});
		};
		const finish = () => {
			const current = currentViewState.current;
			const currentAnswer = current.answers[exercise.id];
			if (!showDone || current.submittedRevision === revision || currentAnswer?.revision !== exercise.revision || !isExerciseComplete(exercise.data, currentAnswer.selectedIds)) return;
			updateViewState({
				...current,
				submittedRevision: revision
			});
			submitAnswers(current.answers);
		};
		const navigate = (nextIndex) => {
			if (nextIndex > index && !canAdvance) return;
			const next = exercises[nextIndex];
			if (next) updateViewState({
				...currentViewState.current,
				currentId: next.id
			});
		};
		const advanceWithAnswer = (nextIds, getCompletionQuery) => {
			const current = currentViewState.current;
			if ((exercises.find((item) => item.id === current.currentId) ?? exercises[0])?.id !== exercise.id) return;
			const next = exercises[index + 1];
			if (!next && (!newTurnQuery || current.submittedRevision === revision)) return;
			const answers = {
				...current.answers,
				[exercise.id]: {
					revision: exercise.revision,
					selectedIds: nextIds
				}
			};
			updateViewState({
				...current,
				answers,
				...next ? { currentId: next.id } : { submittedRevision: revision }
			});
			if (!next) {
				const completionQuery = getCompletionQuery?.(exercises.map((item) => {
					const exerciseAnswer = answers[item.id];
					return exerciseAnswer?.revision === item.revision ? exerciseAnswer.selectedIds : [];
				}));
				submitAnswers(answers, completionQuery);
			}
		};
		const navigation = exercises.length > 1 ? /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 0,
			flex: "0 0 auto"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			size: 24,
			radius: "full",
			background: "transparent",
			ariaLabel: previousLabel,
			disabled: index === 0,
			onClick: () => navigate(index - 1)
		}, /* @__PURE__ */ __dil.jsx("box", {
			height: "100%",
			align: "center",
			justify: "center",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "chevron-left",
			size: "2xl",
			color: index === 0 ? {
				light: "alpha-70",
				dark: "alpha-35"
			} : "secondary"
		}))), /* @__PURE__ */ __dil.jsx("box", {
			role: "status",
			minWidth: 40,
			height: "24px",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, progressLabels[index])), /* @__PURE__ */ __dil.jsx("pressable", {
			size: 24,
			radius: "full",
			background: "transparent",
			ariaLabel: nextLabel,
			disabled: !canAdvance,
			onClick: () => navigate(index + 1)
		}, /* @__PURE__ */ __dil.jsx("box", {
			height: "100%",
			align: "center",
			justify: "center",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "chevron-right",
			size: "2xl",
			color: canAdvance ? "secondary" : {
				light: "alpha-70",
				dark: "alpha-35"
			}
		})))) : null;
		return /* @__PURE__ */ __dil.jsx("box", {
			key: \`\${instanceId}:\${exercise.id}:\${exercise.revision}\`,
			width: "100vw",
			maxWidth: "100%"
		}, renderExercise(exercise.data, {
			selectedIds,
			advanceWithAnswer: index < exercises.length - 1 || newTurnQuery && viewState.submittedRevision !== revision ? advanceWithAnswer : null,
			setSelectedIds: (update) => {
				const current = currentViewState.current;
				const previous = current.answers[exercise.id];
				const ids = previous?.revision === exercise.revision ? previous.selectedIds : [];
				const nextIds = update(ids);
				const answers = {
					...current.answers,
					[exercise.id]: {
						revision: exercise.revision,
						selectedIds: nextIds
					}
				};
				updateViewState({
					...current,
					answers
				});
				if (newTurnQuery && !doneButtonLabel && index === exercises.length - 1 && !isExerciseComplete(exercise.data, ids) && isExerciseComplete(exercise.data, nextIds)) submitAnswers(answers);
			}
		}, navigation, exercises.length > 1 || showDone ? /* @__PURE__ */ __dil.jsx("row", {
			justify: "end",
			minHeight: "36px"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			height: "36px",
			ariaLabel: showDone ? doneButtonLabel : nextButtonLabel ?? nextLabel,
			padding: { x: 3.5 },
			radius: "full",
			background: "transparent",
			border: {
				size: 1,
				color: {
					light: "alpha-10",
					dark: "alpha-15"
				}
			},
			align: "center",
			justify: "center",
			disabled: showDone ? !canFinish : !canAdvance,
			onClick: showDone ? finish : () => navigate(index + 1)
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "medium",
			color: "primary"
		}, showDone ? doneButtonLabel : nextButtonLabel ?? nextLabel))) : null));
	}

//#endregion
//#region learning/primitives/LearningCard.dil.tsx
	function LearningCard({ icon, title, directions, prompt, children, navigation, actions, footer, divider = true, variant = "practice" }) {
		const wide = DIL.useBreakpoint("sm");
		const dictionary = variant === "dictionary";
		const completion = variant === "completion" || variant === "translation";
		const translation = variant === "translation";
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			maxWidth: "100%",
			padding: {
				x: dictionary && !wide ? 4.5 : 5,
				top: dictionary ? wide ? 4 : 3 : 5,
				bottom: dictionary && !wide ? 4.5 : 5
			},
			gap: variant === "dictionary" || variant === "practice" || variant === "listening" ? 4 : 2,
			radius: variant === "listening" ? "32px" : completion || variant === "dictionary" && navigation ? "24px" : "28px",
			background: wide ? {
				light: "gray-25",
				dark: "surface"
			} : "surface",
			border: {
				size: .5,
				color: {
					light: "strong",
					dark: "alpha-05"
				}
			},
			role: "group",
			ariaLabel: title,
			disableAutoSpacing: true
		}, /* @__PURE__ */ __dil.jsx("row", {
			minHeight: dictionary || wide ? "40px" : "44px",
			gap: 2,
			align: "center",
			justify: "between",
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("row", {
			gap: 1.5,
			align: "center",
			flex: "1 1 auto",
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			ariaHidden: true,
			flex: "0 0 auto"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: icon,
			size: variant === "dictionary" ? "2xl" : "xl",
			color: "secondary"
		})), /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "secondary",
			weight: "medium"
		}, title)), /* @__PURE__ */ __dil.jsx("row", {
			gap: 1,
			align: "center",
			flex: "0 0 auto",
			height: dictionary ? "40px" : void 0
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, actions))), /* @__PURE__ */ __dil.jsx("col", { gap: completion || variant === "choice" || variant === "listening" ? 2 : 4 }, directions ? /* @__PURE__ */ __dil.jsx("box", { padding: translation ? { y: 1 } : void 0 }, /* @__PURE__ */ __dil.jsx("text", {
			size: translation ? "md" : "sm",
			color: translation ? "primary" : "secondary"
		}, directions)) : null, completion ? /* @__PURE__ */ __dil.jsx("box", { padding: translation ? { top: 2 } : { y: 1 } }, prompt) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, prompt), completion ? /* @__PURE__ */ __dil.jsx("col", {
			gap: "15px",
			padding: { top: 3 }
		}, divider ? /* @__PURE__ */ __dil.jsx("box", {
			height: "1px",
			background: "alpha-05",
			role: "separator"
		}) : null, /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, children)) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, divider ? /* @__PURE__ */ __dil.jsx("box", {
			height: "1px",
			background: "alpha-05",
			role: "separator"
		}) : null, variant === "dictionary" ? /* @__PURE__ */ __dil.jsx("box", { padding: { top: 1 } }, children) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, children))), navigation || footer ? /* @__PURE__ */ __dil.jsx("row", {
			padding: {
				x: dictionary && !wide ? .5 : void 0,
				top: variant === "dictionary" || variant === "practice" || variant === "listening" ? 1 : 3
			},
			align: "center",
			justify: "between",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("col", {
			minHeight: wide ? void 0 : "44px",
			justify: "center"
		}, navigation), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, footer)) : null);
	}

//#endregion
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
	function hasImageSource(image) {
		return Boolean(image?.content_url || image?.thumbnail_url);
	}
	function imageKey(image) {
		return image?.content_url ?? image?.thumbnail_url ?? image?.url ?? "";
	}
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
//#region internal/image-shopping.dil.ts
	function imageShoppingAvailable(data) {
		return data.opGenui?.supportedClientActions?.includes("open_shop_image_sidebar") ?? false;
	}
	/** Only trusted native image components supply this separate image control. */
	function imageShoppingAction(image, componentName, componentKey, available) {
		if (!available || image?.shop_eligible !== true || !imageKey(image)) return void 0;
		return {
			label: "Shop",
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "open_shop_image_sidebar",
				payload: {
					component_name: componentName,
					component_key: componentKey,
					image_key: imageKey(image)
				}
			})
		};
	}

//#endregion
//#region AsyncImage.dil.tsx
	function isPixelDimension(value) {
		if (typeof value === "number") return Number.isFinite(value) && value >= 0;
		return typeof value === "string" && /^\\d+(?:\\.\\d+)?(?:px)?$/.test(value.trim());
	}
	function normalizedDimension(value) {
		return typeof value === "string" && /^\\d+(?:\\.\\d+)?$/.test(value.trim()) ? Number(value) : value;
	}
	function unresolvedAspectWidth(maxHeight, aspectRatio) {
		const [width, height = 1] = aspectRatio.split(/[/:]/).map(Number);
		return Number.parseFloat(String(maxHeight)) * width / height;
	}
	function containsSource(value, src) {
		if (value === src) return true;
		if (value === null || typeof value !== "object") return false;
		return Object.values(value).some((child) => containsSource(child, src));
	}
	function directImages(props, sourceAllowed) {
		if (!sourceAllowed || !props.src || props.query != null || props.ref != null) return [];
		return [{
			url: props.src,
			content_url: props.src,
			thumbnail_url: props.src,
			title: props.alt ?? ""
		}];
	}
	function ImageContent(props) {
		return /* @__PURE__ */ __dil.jsx("search-image", props);
	}
	function AsyncImage(props) {
		const interactive = props.interactive !== false;
		const canShopImage = DIL.useAppData(imageShoppingAvailable);
		const sourceAllowed = DIL.useAppData((appData) => Boolean(props.src) && containsSource(appData.opGenui?.modelDataBindings, props.src));
		const resolved = useResolvedComponentResult("AsyncImage", props);
		const isDirect = "src" in props;
		const state = isDirect ? void 0 : resolved.state;
		const resolutionComplete = isDirect || resolved.resolutionComplete;
		const isLoading = state?.is_loading ?? !resolutionComplete;
		const images = isDirect ? directImages(props, sourceAllowed) : state?.images ?? [];
		const image = images[0];
		const alt = props.alt ?? image?.title ?? "";
		const actionDescription = props.alt || image?.title;
		const hasImage = hasImageSource(image);
		const isProduct = image?.refs?.some((ref) => ref.ref_type === "product");
		const needsLocalSizing = state == null;
		const frameMaxWidth = state?.frame_max_width ?? normalizedDimension(props.maxWidth) ?? (needsLocalSizing ? "100%" : void 0);
		const frameAspectRatio = state?.frame_aspect_ratio ?? props.aspectRatio;
		const presentation = state?.presentation;
		const hasAuthoredDimensions = props.width != null || props.height != null;
		const authoredMaxHeight = isPixelDimension(props.maxHeight) ? normalizedDimension(props.maxHeight) : void 0;
		const localMaxHeight = needsLocalSizing && !hasAuthoredDimensions ? authoredMaxHeight : void 0;
		const unresolvedSize = frameAspectRatio == null ? localMaxHeight : void 0;
		const unresolvedWidth = localMaxHeight != null && frameAspectRatio != null ? unresolvedAspectWidth(localMaxHeight, frameAspectRatio) : unresolvedSize;
		const fallbackElement = props.fallback ?? /* @__PURE__ */ __dil.jsx("box", {
			align: "center",
			ariaLabel: "Image unavailable",
			background: "surface-tertiary",
			height: "100%",
			justify: "center",
			role: "img",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			color: "tertiary",
			name: "image-square",
			size: "lg"
		}));
		const imageElement = /* @__PURE__ */ __dil.jsx(ImageContent, {
			key: isDirect ? props.src : void 0,
			alt,
			aspectRatio: frameAspectRatio,
			attributionOverlay: isDirect ? false : interactive ? true : "always",
			background: isProduct ? "#f3f3f3" : void 0,
			bitmapBlendMode: isProduct ? "darken" : void 0,
			contentCropFit: props.fit,
			containOutsideAspectRatio: isProduct && props.fit == null ? {
				min: .6,
				max: 1.8
			} : void 0,
			fallback: fallbackElement,
			fit: props.fit ?? (isProduct ? "cover" : state?.image_fit ?? (isDirect && frameAspectRatio == null ? "contain" : "cover")),
			height: "100%",
			hideOnFailure: true,
			hoverZoom: true,
			minHeight: isProduct ? 0 : void 0,
			position: isProduct ? "center" : void 0,
			radius: "none",
			saveTarget: isDirect ? void 0 : image,
			searchImage: image,
			secondaryAction: isDirect ? void 0 : imageShoppingAction(image, "AsyncImage", props.__resolutionId ?? componentDataKey("AsyncImage", props), canShopImage),
			width: "100%"
		}, interactive ? /* @__PURE__ */ __dil.jsx(LinkImpression, {
			action: state?.default_on_click_action,
			disabled: isLoading,
			width: "100%",
			height: "100%"
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: actionDescription ? \`Open \${actionDescription}\` : "Open image",
			background: "transparent",
			disabled: isLoading,
			height: "100%",
			onClick: () => state?.default_on_click_action ? GenUI.dispatchAction(state.default_on_click_action) : GenUI.openImageLightbox(images, 0),
			radius: "none",
			width: "100%"
		})) : null);
		return /* @__PURE__ */ __dil.jsx("box", {
			imageObservation: !isLoading && !hasImage ? "unavailable" : "active",
			ariaLabel: isLoading ? "Loading image" : void 0,
			aspectRatio: frameAspectRatio,
			background: "surface-tertiary",
			border: (presentation?.frame ?? props.frame ?? true) && !isLoading && hasImage ? {
				color: "subtle",
				size: 1
			} : void 0,
			clip: true,
			flex: isPixelDimension(frameMaxWidth) ? "0 0 auto" : void 0,
			height: state?.frame_height ?? normalizedDimension(props.height) ?? (props.width != null || frameAspectRatio != null ? void 0 : unresolvedSize),
			maxHeight: (state?.max_height !== void 0 ? state.max_height ?? void 0 : authoredMaxHeight) ?? (isProduct ? "100%" : void 0),
			maxWidth: frameMaxWidth,
			minHeight: presentation?.min_height ?? props.minHeight,
			minWidth: presentation?.min_width ?? props.minWidth ?? 0,
			radius: presentation?.radius ?? props.radius ?? "xl",
			role: isLoading ? "status" : void 0,
			width: state?.frame_width ?? normalizedDimension(props.width) ?? unresolvedWidth ?? "100%"
		}, !isLoading && !hasImage ? fallbackElement : imageElement);
	}

//#endregion
//#region learning/primitives/LearningImage.dil.tsx
	function LearningImage({ src, alt, images = [], isLoading = false }) {
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			height: 177,
			radius: "2xl",
			background: {
				light: "alpha-04",
				dark: "gray-300"
			},
			align: "center",
			justify: "center",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 192,
			maxWidth: "100%",
			height: 128
		}, src ? /* @__PURE__ */ __dil.jsx("image", {
			src,
			alt,
			width: "100%",
			height: "100%",
			fit: "contain",
			fallback: /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, alt)
		}) : /* @__PURE__ */ __dil.jsx(AsyncImage, {
			alt,
			__state: {
				images,
				is_loading: isLoading
			},
			width: "100%",
			height: "100%",
			fit: "contain",
			frame: false,
			radius: "none",
			fallback: /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, alt)
		})));
	}

//#endregion
//#region learning/primitives/LearningChoicePill.dil.tsx
	function LearningChoicePill({ label, selected, result, order, disabled, onSelect }) {
		const status = result?.status;
		const resultColor = status === "correct" ? "success" : status === "incorrect" ? "danger" : void 0;
		const dimmed = (disabled || selected) && !status;
		const pill = /* @__PURE__ */ __dil.jsx("row", {
			minHeight: "40px",
			maxWidth: "100%",
			padding: { x: 4 },
			gap: 2,
			align: "center",
			justify: "center",
			radius: "full",
			background: resultColor ?? (dimmed ? {
				light: "alpha-01",
				dark: "alpha-04"
			} : {
				light: "alpha-04",
				dark: "alpha-10"
			}),
			border: resultColor ? {
				size: 1,
				color: resultColor
			} : void 0
		}, result ? /* @__PURE__ */ __dil.jsx("box", {
			role: "img",
			ariaLabel: result.label,
			flex: "0 0 auto"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: status === "correct" ? "check" : "x",
			size: "md",
			color: resultColor
		})) : null, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			textAlign: "center",
			color: dimmed ? "alpha-35" : "primary"
		}, label));
		return /* @__PURE__ */ __dil.jsx("pressable", {
			maxWidth: "100%",
			background: "transparent",
			radius: "full",
			ariaPressed: selected,
			ariaLabel: result ? \`\${result.label} \${label}\` : order !== void 0 ? \`\${order}. \${label}\` : label,
			onClick: () => {
				if (!disabled && !selected) onSelect();
			}
		}, pill);
	}

//#endregion
//#region learning/primitives/LearningTextChoices.dil.tsx
	function LearningTextChoices({ options, selectedId, correctOptionId, correctLabel, incorrectLabel, disabled = false, showResults = true, justify = "start", variant = "pills", onSelect }) {
		const wide = DIL.useBreakpoint("sm");
		const choices = options.map((option, index) => {
			const selected = option.id === selectedId;
			const result = showResults && selectedId !== null && correctOptionId ? option.id === correctOptionId ? {
				status: "correct",
				label: correctLabel
			} : selected ? {
				status: "incorrect",
				label: incorrectLabel
			} : void 0 : void 0;
			const locked = disabled || selectedId !== null;
			if (variant === "pills") return /* @__PURE__ */ __dil.jsx(LearningChoicePill, {
				key: option.id,
				label: option.label,
				selected,
				result,
				disabled: locked,
				onSelect: () => onSelect(option.id)
			});
			const color = result?.status === "correct" ? "green-500" : result ? "red-400" : void 0;
			return /* @__PURE__ */ __dil.jsx("pressable", {
				key: option.id,
				width: "100%",
				minHeight: 56,
				radius: "8px",
				background: "transparent",
				ariaLabel: result ? \`\${result.label} \${option.label}\` : option.label,
				ariaPressed: selected,
				onClick: () => {
					if (!locked) onSelect(option.id);
				}
			}, /* @__PURE__ */ __dil.jsx("row", {
				gap: wide ? 4 : 2.5,
				align: "center",
				padding: { y: "15px" }
			}, /* @__PURE__ */ __dil.jsx("box", {
				size: 24,
				flex: "0 0 auto",
				radius: "full",
				align: "center",
				justify: "center",
				background: color ?? (selected ? "info" : "transparent"),
				border: {
					size: 1,
					color: "alpha-05"
				},
				role: result ? "img" : void 0,
				ariaLabel: result?.label
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: result ? "white" : "primary"
			}, String.fromCharCode(65 + index))), /* @__PURE__ */ __dil.jsx("col", {
				flex: "1 1 auto",
				minWidth: 0,
				gap: "3px"
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "md",
				color: "primary"
			}, option.label), result && option.feedback ? /* @__PURE__ */ __dil.jsx("text", {
				size: "md",
				color: "secondary"
			}, option.feedback) : null)));
		});
		return variant === "list" ? /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, choices) : /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			justify,
			align: "center",
			wrap: "wrap"
		}, choices);
	}

//#endregion
//#region learning/cards/LearningImageLabelCard.dil.tsx
	function LearningImageLabelCard$1(props) {
		return /* @__PURE__ */ __dil.jsx(LearningExercisePager, {
			...props,
			getResponse: (data, selectedIds) => ({
				question: [data.directions, data.image.alt].filter(Boolean).join("\\n"),
				answer: data.options.find((option) => option.id === selectedIds[0])?.label ?? ""
			}),
			renderExercise: (data, selection, navigation, footer) => /* @__PURE__ */ __dil.jsx(ImageLabelExercise, {
				...data,
				selection,
				navigation,
				footer
			})
		});
	}
	function ImageLabelExercise({ title, selection, navigation, footer, image, options, correctOptionId, correctLabel, incorrectLabel, directions }) {
		const selectedId = selection.selectedIds[0] ?? null;
		const imagePending = !image.src && Boolean(image.isLoading);
		const imageUnavailable = !image.src && !image.images?.length;
		return /* @__PURE__ */ __dil.jsx(LearningCard, {
			icon: "eye",
			variant: "choice",
			title,
			navigation,
			footer,
			directions,
			divider: false,
			prompt: /* @__PURE__ */ __dil.jsx(LearningImage, {
				...image,
				isLoading: imagePending
			})
		}, /* @__PURE__ */ __dil.jsx(LearningTextChoices, {
			variant: "list",
			options,
			selectedId,
			correctOptionId,
			correctLabel,
			incorrectLabel,
			disabled: selectedId !== null || imagePending || imageUnavailable,
			onSelect: (id) => selection.setSelectedIds((current) => current.length ? current : [id])
		}));
	}

//#endregion
//#region LearningImageLabelCard.dil.tsx
	function LearningImageLabelCard(props) {
		const { state } = useResolvedComponentResult("LearningImageLabelCard", props);
		if (state) return /* @__PURE__ */ __dil.jsx(LearningImageLabelCard$1, state);
		if ("progressLabels" in props) return /* @__PURE__ */ __dil.jsx(LearningImageLabelCard$1, props);
		return props.fallback ?? null;
	}

//#endregion
return LearningImageLabelCard;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=learning-image-label-card-63fe66acff66.js.map