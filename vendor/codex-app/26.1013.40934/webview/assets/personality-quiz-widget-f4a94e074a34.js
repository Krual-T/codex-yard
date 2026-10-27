import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region internal/quiz.dil.tsx
	const secondaryBackground = {
		light: "gray-0",
		dark: "gray-200"
	};
	const secondaryHoverBackground = {
		light: "gray-50",
		dark: "#2f2f2f"
	};
	const secondaryBorderColor = {
		light: "rgba(0, 0, 0, 0.15)",
		dark: "alpha-15"
	};
	function QuizFrame({ isDesktop, clip, size = "full", elevated = false, children }) {
		if (elevated) return /* @__PURE__ */ __dil.jsx("card", {
			size,
			padding: 0
		}, children);
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			border: {
				size: 1,
				color: "default"
			},
			radius: "3xl",
			background: isDesktop ? "surface-elevated" : "gray-0",
			clip
		}, children);
	}
	function QuizIconButton({ label, tooltip, disabled, onClick, children }) {
		return /* @__PURE__ */ __dil.jsx("pressable", {
			size: 36,
			padding: 0,
			radius: "full",
			variant: "ghost",
			align: "center",
			justify: "center",
			ariaLabel: label,
			tooltip,
			disabled,
			onClick
		}, children);
	}
	function QuizChoiceCard({ label, disabled, onSelect, content, variant = "pill", selected = false, media }) {
		const imageChoice = variant === "image";
		const [hovered, setHovered] = DIL.useState(false);
		DIL.useEffect(() => setHovered(false), []);
		return /* @__PURE__ */ __dil.jsx("pressable", {
			width: "100%",
			padding: 0,
			radius: imageChoice ? "xl" : "full",
			background: hovered && !disabled ? secondaryHoverBackground : secondaryBackground,
			onHover: setHovered,
			border: {
				size: imageChoice ? selected ? 2 : 0 : 1,
				color: selected ? "currentColor" : secondaryBorderColor
			},
			insetBorder: selected && !imageChoice,
			clip: true,
			ariaLabel: label,
			ariaPressed: selected,
			disabled,
			onClick: onSelect
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			width: "100%",
			height: "100%"
		}, media, /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minHeight: 42,
			border: imageChoice && !selected ? {
				x: {
					size: 1,
					color: secondaryBorderColor
				},
				bottom: {
					size: 1,
					color: secondaryBorderColor
				}
			} : 0,
			radius: imageChoice ? {
				bottomLeft: "xl",
				bottomRight: "xl"
			} : "none",
			padding: {
				x: 3,
				y: 2
			},
			align: "center",
			justify: "center"
		}, content)));
	}

//#endregion
//#region shared.dil.ts
	function hasImageSource(image) {
		return Boolean(image?.content_url || image?.thumbnail_url);
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
//#region internal/quiz-media.dil.tsx
/** Shared browser-download recovery. Image search remains owned by the server. */
	function QuizMedia({ image, loading, height, alt, identity = "", retry = true, radius = "lg", background = "surface-secondary", retries, onRetryChange, onLoad, onError }) {
		const sourceKey = JSON.stringify([
			identity,
			image?.content_url ?? "",
			image?.thumbnail_url ?? ""
		]);
		const initialDownload = {
			key: sourceKey,
			status: "pending",
			attempt: 0
		};
		const [download, setLocalDownload] = DIL.useState(initialDownload);
		const persistedRetries = retries !== void 0 && onRetryChange !== void 0;
		const active = persistedRetries ? retries[sourceKey] ?? initialDownload : download.key === sourceKey ? download : initialDownload;
		function setDownload(next) {
			if (persistedRetries) onRetryChange(sourceKey, next);
			else setLocalDownload(next);
		}
		const attemptKey = \`\${sourceKey}:\${active.attempt}\`;
		const latestAttempt = DIL.useRef(attemptKey);
		latestAttempt.current = attemptKey;
		const now = DIL.useNow(retry && hasImageSource(image) && (active.status === "pending" || active.status === "failed"));
		const nextTick = DIL.useRef({
			key: sourceKey,
			at: now
		});
		if (nextTick.current.key !== sourceKey) nextTick.current = {
			key: sourceKey,
			at: now
		};
		DIL.useEffect(() => {
			if (!retry || !hasImageSource(image) || active.status === "loaded" || active.status === "stopped" || now < nextTick.current.at) return;
			nextTick.current = {
				key: sourceKey,
				at: now + 15e3
			};
			if (active.deadline === void 0) setDownload({
				...active,
				deadline: now + 18e4
			});
			else if (now >= active.deadline) setDownload({
				...active,
				status: "stopped"
			});
			else if (active.status === "failed") setDownload({
				...active,
				status: "pending",
				attempt: active.attempt + 1
			});
		}, [
			active.key,
			active.status,
			active.attempt,
			active.deadline,
			now,
			retry,
			persistedRetries
		]);
		const fallback = /* @__PURE__ */ __dil.jsx("box", {
			height,
			width: "100%",
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "images",
			color: "secondary"
		}));
		return /* @__PURE__ */ __dil.jsx("box", {
			height,
			width: "100%",
			radius,
			clip: true,
			background
		}, hasImageSource(image) ? /* @__PURE__ */ __dil.jsx("search-image", {
			key: attemptKey,
			searchImage: image,
			upgradeToFullRes: true,
			alt,
			width: "100%",
			height,
			fit: "cover",
			radius: "none",
			fallback,
			onLoad: () => {
				if (latestAttempt.current !== attemptKey) return;
				setDownload({
					...active,
					status: "loaded"
				});
				onLoad?.();
			},
			onError: () => {
				if (latestAttempt.current !== attemptKey) return;
				setDownload({
					...active,
					status: retry && active.status !== "stopped" ? "failed" : "stopped"
				});
				onError?.();
			}
		}) : loading ? /* @__PURE__ */ __dil.jsx("loading-block", {
			height,
			width: "100%",
			label: alt
		}) : fallback);
	}

//#endregion
//#region PersonalityQuizWidget.dil.tsx
	function compareProgress(incoming, current) {
		const readiness = (state) => state.result_status === "complete" && state.result ? state.result.image_is_loading === true ? 2 : 3 : state.result_status === "error" ? 1 : 0;
		return incoming.progress_revision - current.progress_revision || incoming.saved_revision - current.saved_revision || readiness(incoming) - readiness(current);
	}
	function progressFromState(state) {
		return {
			current_index: state.current_index,
			answers: state.answers,
			started: state.started,
			progress_revision: state.progress_revision
		};
	}
	function acknowledgmentFromState(state) {
		return {
			...progressFromState(state),
			saved_revision: state.saved_revision,
			phase: state.phase,
			result: state.result,
			result_status: state.result_status,
			result_copy_text: state.result_copy_text
		};
	}
	function shouldRetainProgress(incoming, current) {
		return !current || compareProgress(incoming, current) >= 0 && JSON.stringify(incoming) !== JSON.stringify(current);
	}
	function acknowledgmentFromResponse(value) {
		if (typeof value !== "object" || value === null) return null;
		const result = value;
		const data = result.response?.data;
		const state = data?.widget_state;
		if (result.status !== "success" || !state || typeof data?.revision !== "number" || !Number.isSafeInteger(data.revision) || data.revision < 0 || state.saved_revision !== data.revision || state.progress_revision !== data.revision) return null;
		return acknowledgmentFromState(state);
	}
	function headingText(value) {
		return value.replaceAll("\\r", " ").replaceAll("\\n", " ");
	}
	function QuizStatus({ label, skeleton = false }) {
		return /* @__PURE__ */ __dil.jsx("box", {
			role: "status",
			ariaLabel: label,
			ariaLive: "polite",
			ariaAtomic: true
		}, skeleton ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 180,
			radius: "lg",
			background: "alpha-20"
		}), /* @__PURE__ */ __dil.jsx("loading-block", {
			background: "alpha-20",
			width: "80%",
			height: 28,
			radius: "full"
		}), /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("loading-block", {
			background: "alpha-20",
			width: "100%",
			height: 16,
			radius: "full"
		}), /* @__PURE__ */ __dil.jsx("loading-block", {
			background: "alpha-20",
			width: "60%",
			height: 16,
			radius: "full"
		})), /* @__PURE__ */ __dil.jsx("loading-block", {
			background: "alpha-20",
			width: "100%",
			height: 36,
			radius: "full"
		})) : label ? /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, label) : null);
	}
	function ShareQuiz({ label, isMobile, pending, onShare }) {
		return /* @__PURE__ */ __dil.jsx(QuizIconButton, {
			label,
			tooltip: isMobile ? void 0 : label,
			disabled: pending,
			onClick: onShare
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "share",
			size: "xl",
			color: "secondary"
		}));
	}
	function CreateQuiz({ state }) {
		return /* @__PURE__ */ __dil.jsx("button", {
			color: "primary",
			variant: "outline",
			block: true,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "prefill_composer",
				payload: { prompt: state.create_quiz_prompt }
			})
		}, state.owner_create_quiz_label ?? state.create_quiz_label);
	}
	function PersonalityResult({ approvedImageURLs, state, progress, canInteract, clientActions, sharePending, onShare, onRetry, onRetake }) {
		const isMobile = DIL.useIsMobile();
		const acknowledged = state.saved_revision >= progress.progress_revision;
		const result = acknowledged ? state.result : null;
		const serverReady = state.result_status === "complete" && result !== null && !result.image_is_loading;
		const hasImage = hasImageSource(result?.image);
		const imageKey = hasImage ? \`\${progress.progress_revision}:\${result?.image?.content_url ?? ""}:\${result?.image?.thumbnail_url ?? ""}\` : "";
		const [imageState, setImageState] = DIL.useState({
			key: "",
			failed: false
		});
		const imageSettled = imageKey !== "" && imageState.key === imageKey;
		const ready = serverReady && (!hasImage || imageSettled);
		const celebrate = DIL.useRef(!serverReady);
		const now = DIL.useNow(!ready);
		const [wait, setWait] = DIL.useState({
			revision: progress.progress_revision,
			startedAt: now
		});
		const [imageWait, setImageWait] = DIL.useState({
			key: "",
			startedAt: now
		});
		const admittedImageKey = DIL.useRef("");
		const imageCanLoad = admittedImageKey.current === imageKey || approvedImageURLs === void 0 || [result?.image?.content_url, result?.image?.thumbnail_url].some((url) => Boolean(url && approvedImageURLs.includes(url)));
		if (serverReady && hasImage && imageCanLoad) admittedImageKey.current = imageKey;
		const currentImageKey = DIL.useRef(imageKey);
		currentImageKey.current = imageKey;
		DIL.useEffect(() => {
			if (wait.revision !== progress.progress_revision) setWait({
				revision: progress.progress_revision,
				startedAt: now
			});
		}, [
			wait.revision,
			progress.progress_revision,
			now
		]);
		DIL.useEffect(() => {
			if (serverReady && hasImage && imageCanLoad && imageWait.key !== imageKey) setImageWait({
				key: imageKey,
				startedAt: now
			});
			else if (serverReady && hasImage && imageCanLoad && !imageSettled && now - imageWait.startedAt >= 15e3) setImageState({
				key: imageKey,
				failed: true
			});
		}, [
			serverReady,
			hasImage,
			imageCanLoad,
			imageKey,
			imageWait.key,
			imageWait.startedAt,
			imageSettled,
			now
		]);
		const failed = acknowledged && state.result_status === "error";
		const waitExpired = wait.revision === progress.progress_revision && now - wait.startedAt >= 45e3;
		return /* @__PURE__ */ __dil.jsx("celebration", { trigger: ready && celebrate.current ? String(progress.progress_revision) : null }, /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			padding: 4
		}, !ready ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			align: "start"
		}, failed ? /* @__PURE__ */ __dil.jsx(QuizStatus, { label: state.result_error_label }) : /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			role: "status",
			ariaLive: "polite",
			ariaAtomic: true,
			ariaLabel: state.result_loading_label
		}, /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 180,
			radius: "lg",
			background: "alpha-20"
		}), /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "75%",
			height: 32,
			background: "alpha-20",
			radius: "full"
		}), /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 16,
			background: "alpha-20",
			radius: "full"
		}), /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "80%",
			height: 16,
			background: "alpha-20",
			radius: "full"
		})), /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 48,
			background: "alpha-20",
			radius: "lg"
		}), /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 16,
			background: "alpha-20",
			radius: "full"
		}), /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 16,
			background: "alpha-20",
			radius: "full"
		}), /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "70%",
			height: 16,
			background: "alpha-20",
			radius: "full"
		})))), failed || waitExpired ? /* @__PURE__ */ __dil.jsx("button", {
			color: "primary",
			variant: "outline",
			disabled: !canInteract,
			onClick: onRetry
		}, state.result_retry_label) : null) : null, serverReady && result ? /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, hasImage && imageCanLoad && !(imageSettled && imageState.failed) ? /* @__PURE__ */ __dil.jsx("box", {
			height: ready ? void 0 : 0,
			clip: !ready,
			ariaHidden: !ready
		}, /* @__PURE__ */ __dil.jsx(QuizMedia, {
			key: imageKey,
			identity: imageKey,
			image: result.image,
			loading: false,
			height: 180,
			alt: result.name,
			retry: false,
			onLoad: () => {
				if (currentImageKey.current === imageKey) setImageState({
					key: imageKey,
					failed: false
				});
			},
			onError: () => {
				if (currentImageKey.current === imageKey) setImageState({
					key: imageKey,
					failed: true
				});
			}
		})) : null, ready ? /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("title", { size: "xl" }, headingText(result.name)), /* @__PURE__ */ __dil.jsx("text", null, result.description)), clientActions.includes("copy") ? /* @__PURE__ */ __dil.jsx(QuizIconButton, {
			label: state.copy_result_label,
			tooltip: isMobile ? void 0 : state.copy_result_label,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "copy",
				payload: { value: state.result_copy_text }
			})
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "copy",
			size: "xl",
			color: "secondary"
		})) : null), result.quote ? /* @__PURE__ */ __dil.jsx("box", {
			padding: 3,
			radius: "lg",
			background: "surface-secondary",
			role: "blockquote"
		}, /* @__PURE__ */ __dil.jsx("text", null, \`“\${result.quote}”\`)) : null, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, result.result_paragraphs.map((paragraph, index) => /* @__PURE__ */ __dil.jsx("text", {
			key: index,
			size: "sm",
			color: "secondary"
		}, paragraph))), /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, clientActions.includes("personality_quiz_share_options") && state.share_result_label ? /* @__PURE__ */ __dil.jsx("button", {
			color: "primary",
			block: true,
			disabled: sharePending,
			onClick: onShare
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "share" }), state.share_result_label) : null, /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("box", { flex: "1 1 180px" }, /* @__PURE__ */ __dil.jsx("button", {
			color: "primary",
			variant: "outline",
			block: true,
			disabled: !canInteract,
			onClick: onRetake
		}, state.is_share_preview ? state.retake_label : state.owner_retake_label ?? state.retake_label)), clientActions.includes("prefill_composer") ? /* @__PURE__ */ __dil.jsx("box", { flex: "1 1 180px" }, /* @__PURE__ */ __dil.jsx(CreateQuiz, { state })) : null))) : null) : null));
	}
	function ResolvedPersonalityQuiz({ approvedImageURLs, state: serverState, componentKey, canInteract, clientActions }) {
		const isMobile = DIL.useIsMobile();
		const [localProgress, setLocalProgress] = DIL.useState(null);
		const [acknowledgment, setAcknowledgment] = DIL.useState(null);
		const state = acknowledgment && !serverState.generation_error && serverState.phase !== "error" && compareProgress(acknowledgment, serverState) > 0 ? {
			...serverState,
			...acknowledgment
		} : serverState;
		const progress = localProgress && (localProgress.progress_revision > state.progress_revision || localProgress.progress_revision === state.progress_revision && state.saved_revision < localProgress.progress_revision) ? localProgress : progressFromState(state);
		const latestProgress = DIL.useRef(progress);
		latestProgress.current = progress;
		const question = state.questions[progress.current_index];
		const hasGenerationError = state.generation_error || state.phase === "error";
		const loading = state.phase === "loading" || !state.generation_complete && progress.started && !question;
		const startLoading = !canInteract && !state.generation_complete;
		const startLoadingLabel = state.start_loading_label ?? state.loading_label;
		DIL.useEffect(() => {
			if (serverState.saved_revision !== serverState.progress_revision) return;
			const incoming = acknowledgmentFromState(serverState);
			if (!shouldRetainProgress(incoming, acknowledgment)) return;
			setAcknowledgment((previous) => shouldRetainProgress(incoming, previous) ? incoming : previous);
		}, [serverState, acknowledgment]);
		async function saveProgress(next) {
			let response;
			try {
				response = await GenUI.dispatchAction({
					handler: "server",
					type: "personality_quiz_save_progress",
					payload: {
						answers: next.answers.map((answer) => answer.id),
						current_index: next.current_index,
						started: next.started,
						revision: next.progress_revision
					}
				});
			} catch {
				response = { status: "error" };
			}
			try {
				if (typeof response === "object" && response !== null && "status" in response && response.status === "error" && latestProgress.current.progress_revision === next.progress_revision) setFailedRevision(next.progress_revision);
				const acknowledged = acknowledgmentFromResponse(response);
				if (acknowledged) setAcknowledgment((previous) => shouldRetainProgress(acknowledged, previous) ? acknowledged : previous);
			} catch {}
		}
		function updateProgress(updates, expectedRevision = progress.progress_revision) {
			const current = latestProgress.current;
			if (!canInteract || hasGenerationError || current.progress_revision !== expectedRevision) return;
			const next = {
				...current,
				...updates,
				progress_revision: current.progress_revision + 1
			};
			latestProgress.current = next;
			setLocalProgress(next);
			saveProgress(next);
		}
		function selectOption(option, optionIndex) {
			if (!question || latestProgress.current.current_index !== progress.current_index) return;
			const answer = {
				id: option.id,
				question_id: question.id,
				option_index: optionIndex
			};
			const answers = progress.answers.map((previous) => previous.question_id === question.id ? answer : previous);
			if (progress.current_index >= progress.answers.length) answers.push(answer);
			updateProgress({
				answers,
				current_index: progress.current_index + 1,
				started: true
			});
		}
		const hasQuestionBanner = !hasGenerationError && !loading && progress.started && question?.layout === "image_prompt";
		const canShare = state.generation_complete && clientActions.includes("personality_quiz_share_options");
		const completed = state.generation_complete && progress.started && progress.current_index >= state.questions.length;
		const [failedRevision, setFailedRevision] = DIL.useState(null);
		const [mediaRetries, setMediaRetries] = DIL.useState({});
		const onMediaRetryChange = (key, download) => setMediaRetries((previous) => ({
			...previous,
			[key]: download
		}));
		const [sharePending, setSharePending] = DIL.useState(false);
		DIL.useEffect(() => setSharePending(false), []);
		async function share(mode) {
			if (!canShare || sharePending) return;
			setSharePending(true);
			try {
				await GenUI.dispatchAction({
					handler: "client",
					type: "share",
					payload: {
						component_key: componentKey,
						share_options: {
							kind: "personality_quiz",
							mode,
							expected_revision: latestProgress.current.progress_revision
						}
					}
				});
			} catch {} finally {
				setSharePending(false);
			}
		}
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: "100%",
			align: "center",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 0,
			height: 0,
			clip: true,
			ariaHidden: true
		}, !state.is_shared_quiz && !hasGenerationError && !completed && state.questions.flatMap((preloadQuestion) => (preloadQuestion.layout === "image_prompt" ? [preloadQuestion] : preloadQuestion.layout === "image_grid" ? preloadQuestion.options.slice(0, 4) : []).map((media) => media.image ? /* @__PURE__ */ __dil.jsx("search-image", {
			key: \`\${preloadQuestion.id}:\${media.id}\`,
			searchImage: media.image,
			preload: true,
			upgradeToFullRes: true,
			width: 0,
			height: 0,
			alt: ""
		}) : null))), /* @__PURE__ */ __dil.jsx("box", {
			width: state.card_size === "sm" ? 360 : state.card_size === "md" ? 440 : state.card_size === "lg" ? 560 : "100vw",
			maxWidth: "100%",
			padding: 0,
			border: hasQuestionBanner ? 0 : {
				size: 1,
				color: "default"
			},
			background: "surface-elevated",
			radius: "3xl",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, hasQuestionBanner && question ? /* @__PURE__ */ __dil.jsx(QuizMedia, {
			image: question.image,
			loading: question.image_is_loading ?? false,
			height: 152,
			radius: "none",
			alt: question.prompt,
			identity: \`question:\${question.id}\`,
			retries: mediaRetries,
			onRetryChange: onMediaRetryChange
		}) : null, /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			border: hasQuestionBanner ? {
				x: {
					size: 1,
					color: "default"
				},
				bottom: {
					size: 1,
					color: "default"
				}
			} : 0,
			radius: hasQuestionBanner ? {
				bottomLeft: "3xl",
				bottomRight: "3xl"
			} : "none",
			padding: completed && !hasGenerationError && !loading ? 0 : {
				x: 4,
				top: hasQuestionBanner ? 3 : 4,
				bottom: 4
			}
		}, !hasGenerationError && !completed && failedRevision === progress.progress_revision && state.saved_revision < progress.progress_revision ? /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "center"
		}, /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, state.progress_error_label), /* @__PURE__ */ __dil.jsx("button", {
			disabled: !canInteract,
			onClick: () => updateProgress({})
		}, state.retry_label)) : null, hasGenerationError ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 3,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx(QuizStatus, { label: state.error_label }), /* @__PURE__ */ __dil.jsx("button", {
			color: "primary",
			disabled: !clientActions.includes("issue_new_turn"),
			onClick: () => GenUI.issueNewTurn(state.retry_query, { append_to_current_leaf: true })
		}, state.retry_label)) : loading ? /* @__PURE__ */ __dil.jsx(QuizStatus, {
			label: progress.started ? state.loading_label : startLoadingLabel,
			skeleton: true
		}) : !progress.started ? /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, state.banner_image ? /* @__PURE__ */ __dil.jsx(QuizMedia, {
			image: state.banner_image,
			loading: state.banner_image_is_loading,
			height: 180,
			alt: state.theme,
			identity: "banner",
			retries: mediaRetries,
			onRetryChange: onMediaRetryChange
		}) : state.banner_image_is_loading ? /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: 180,
			radius: "lg",
			background: "alpha-20"
		}) : null, /* @__PURE__ */ __dil.jsx("col", { gap: 1 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 3
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("title", { size: "xl" }, headingText(state.title))), canShare ? /* @__PURE__ */ __dil.jsx(ShareQuiz, {
			label: state.share_label,
			isMobile,
			pending: sharePending,
			onShare: () => void share("quiz")
		}) : null), /* @__PURE__ */ __dil.jsx("text", { color: "secondary" }, \`\${state.question_count_label} \${state.intro_description}\`)), /* @__PURE__ */ __dil.jsx("box", {
			role: startLoading ? "status" : void 0,
			ariaLive: "polite",
			ariaAtomic: true
		}, /* @__PURE__ */ __dil.jsx("button", {
			color: "primary",
			block: true,
			disabled: !canInteract,
			onClick: () => updateProgress({ started: true })
		}, startLoading ? /* @__PURE__ */ __dil.jsx("shimmer-text", { color: "inherit" }, startLoadingLabel) : state.start_label))) : question ? /* @__PURE__ */ __dil.jsx("col", { gap: 3 }, /* @__PURE__ */ __dil.jsx("box", {
			direction: "row",
			wrap: "wrap-reverse",
			align: "start",
			rowGap: 2,
			columnGap: 4
		}, /* @__PURE__ */ __dil.jsx("box", {
			flex: isMobile ? "999 1 380px" : "999 1 340px",
			minWidth: 0,
			role: "status",
			ariaLive: "polite",
			ariaAtomic: true,
			ariaLabel: state.question_accessibility_labels[progress.current_index]
		}, /* @__PURE__ */ __dil.jsx("title", {
			size: "md",
			textAlign: "center"
		}, headingText(question.prompt))), /* @__PURE__ */ __dil.jsx("row", {
			width: "100%",
			flex: "1 0 auto",
			align: "center",
			justify: "between",
			gap: 4
		}, /* @__PURE__ */ __dil.jsx("row", {
			flex: "0 0 auto",
			align: "center",
			gap: "5px"
		}, /* @__PURE__ */ __dil.jsx(QuizIconButton, {
			label: state.previous_question_label,
			disabled: !canInteract,
			onClick: () => updateProgress(progress.current_index > 0 ? { current_index: progress.current_index - 1 } : { started: false })
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "chevron-left",
			size: "xl",
			color: "secondary"
		})), /* @__PURE__ */ __dil.jsx("box", {
			width: 48,
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("caption", {
			size: "md",
			color: "secondary"
		}, state.question_progress_labels[progress.current_index])), /* @__PURE__ */ __dil.jsx(QuizIconButton, {
			label: state.generation_complete && progress.current_index === state.questions.length - 1 ? state.see_result_label : state.next_question_label,
			disabled: !canInteract || progress.current_index >= progress.answers.length,
			onClick: () => updateProgress({ current_index: progress.current_index + 1 })
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "chevron-right",
			size: "xl",
			color: progress.current_index < progress.answers.length ? "secondary" : "alpha-35"
		}))), canShare ? /* @__PURE__ */ __dil.jsx(ShareQuiz, {
			label: state.share_label,
			isMobile,
			pending: sharePending,
			onShare: () => void share("quiz")
		}) : null)), /* @__PURE__ */ __dil.jsx("grid", {
			columns: question.layout === "image_grid" ? 2 : 1,
			gap: 2
		}, question.options.map((option, optionIndex) => /* @__PURE__ */ __dil.jsx(QuizChoiceCard, {
			key: option.id,
			variant: question.layout === "image_grid" ? "image" : "pill",
			label: option.label,
			selected: progress.answers.some((answer) => answer.question_id === question.id && answer.id === option.id),
			disabled: !canInteract,
			onSelect: () => selectOption(option, optionIndex),
			content: /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "primary",
				weight: "medium",
				width: "100%",
				textAlign: "center"
			}, option.label),
			media: question.layout === "image_grid" ? /* @__PURE__ */ __dil.jsx(QuizMedia, {
				image: option.image,
				loading: option.image_is_loading ?? false,
				height: 144,
				radius: "none",
				background: "surface-tertiary",
				alt: option.label,
				identity: \`choice:\${question.id}:\${option.id}\`,
				retries: mediaRetries,
				onRetryChange: onMediaRetryChange
			}) : void 0
		})))) : completed ? /* @__PURE__ */ __dil.jsx(PersonalityResult, {
			approvedImageURLs,
			state,
			progress,
			canInteract,
			clientActions,
			sharePending,
			onShare: () => void share("result"),
			onRetry: () => updateProgress({}),
			onRetake: () => updateProgress({
				answers: [],
				current_index: 0,
				started: false
			})
		}) : /* @__PURE__ */ __dil.jsx(QuizStatus, {
			label: state.loading_label,
			skeleton: true
		})))));
	}
	function PersonalityQuizWidget(props) {
		const { state, resolutionComplete } = useResolvedComponentResult("PersonalityQuizWidget", props.__resolutionId ? {
			...props,
			__state: void 0
		} : props);
		const appData = DIL.useAppData();
		const componentKey = typeof props.__resolutionId === "string" && appData.opGenui?.componentResults?.[props.__resolutionId] != null ? props.__resolutionId : componentDataKey("PersonalityQuizWidget", props);
		const envelope = appData.opGenui?.componentResults?.[componentKey];
		const approvedImageURLs = appData.opGenui?.nativeServerActions?.imageApprovalRequired === true ? envelope?.status === "resolved" && envelope.componentName === "PersonalityQuizWidget" && Array.isArray(envelope.safe_urls) ? envelope.safe_urls : [] : void 0;
		const isDesktop = DIL.useBreakpoint("sm");
		if (!state) return resolutionComplete ? props.fallback ?? null : /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			maxWidth: "100%",
			align: "center"
		}, /* @__PURE__ */ __dil.jsx(QuizFrame, {
			isDesktop,
			size: "md",
			clip: true,
			elevated: true
		}, /* @__PURE__ */ __dil.jsx("box", { padding: 4 }, /* @__PURE__ */ __dil.jsx(QuizStatus, { skeleton: true }))));
		return /* @__PURE__ */ __dil.jsx(ResolvedPersonalityQuiz, {
			approvedImageURLs,
			state,
			componentKey,
			canInteract: appData.opGenui?.nativeServerActions?.ready === true,
			clientActions: appData.opGenui?.supportedClientActions ?? []
		});
	}

//#endregion
return PersonalityQuizWidget;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=personality-quiz-widget-f4a94e074a34.js.map