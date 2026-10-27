import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region ../internal/quiz.dil.tsx
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
	function QuizHeader({ isDesktop, prompt, navigation, utilities }) {
		return /* @__PURE__ */ __dil.jsx("box", {
			direction: "row",
			wrap: "wrap-reverse",
			align: "end",
			minHeight: 50,
			padding: {
				left: 5,
				right: isDesktop ? 5 : 3,
				top: "10px"
			},
			rowGap: 2,
			columnGap: 4
		}, prompt, /* @__PURE__ */ __dil.jsx("row", {
			flex: "1 0 auto",
			align: "center",
			justify: "between",
			gap: 4
		}, navigation, utilities));
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
	function QuizChoiceRow({ label, pressed, interactive, disabled, onSelect, indicator, content, feedback }) {
		const children = /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 4
		}, indicator, /* @__PURE__ */ __dil.jsx("col", {
			flex: 1,
			minWidth: 0,
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("box", {
			minHeight: 32,
			justify: "center"
		}, content), feedback));
		return /* @__PURE__ */ __dil.jsx("box", { padding: { x: 2 } }, interactive ? /* @__PURE__ */ __dil.jsx("pressable", {
			minHeight: 46,
			padding: {
				x: 2,
				y: "7px"
			},
			radius: "4xl",
			variant: "ghost",
			hoverBackground: "surface-secondary",
			disabled,
			onClick: onSelect,
			ariaLabel: label,
			ariaPressed: pressed
		}, children) : /* @__PURE__ */ __dil.jsx("box", {
			minHeight: 46,
			padding: {
				x: 2,
				y: "7px"
			},
			radius: "4xl",
			role: "group",
			ariaLabel: label
		}, children));
	}

//#endregion
//#region ../shared.dil.ts
	function hasImageSource(image) {
		return Boolean(image?.content_url || image?.thumbnail_url);
	}
	function useIsLiveActivity() {
		return DIL.useAppData((appData) => appData.opGenui?.surface === "live-activity");
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
//#region ../internal/quiz-media.dil.tsx
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
//#region ../internal/text-only-markdown.dil.tsx
/** Host-rendered text formatting, without link navigation or image loading. */
	function TextOnlyMarkdown({ children }) {
		return /* @__PURE__ */ __dil.jsx("text-only-markdown", null, children);
	}

//#endregion
//#region internal/learning-quiz.dil.tsx
	function mergeQuizAnswers(previous, confirmed) {
		return [...previous.filter((answer) => !confirmed.some((next) => next.index === answer.index && next.question_id === answer.question_id)), ...confirmed].sort((a, b) => a.index - b.index);
	}
	function actionProgressAttempt(action) {
		return action.payload.attempt + (action.type === "learning_quiz_restart" ? 1 : 0);
	}
	function isServerSnapshotAtLeastAsNew(incoming, current) {
		if (incoming.attempt !== current.attempt) return incoming.attempt > current.attempt;
		const incomingSequence = incoming.navigation?.sequence ?? 0;
		const currentSequence = current.navigation?.sequence ?? 0;
		if (incomingSequence !== currentSequence) return incomingSequence > currentSequence;
		return (incoming.revision ?? 0) >= (current.revision ?? 0);
	}
	function QuizUtilities({ state, componentKey }) {
		if (!state.generation_complete || !state.copy_quiz_text && state.share_button_variant !== "top_right") return null;
		return /* @__PURE__ */ __dil.jsx("row", {
			flex: "0 0 auto",
			align: "center",
			gap: "5px"
		}, state.copy_quiz_text !== "" && /* @__PURE__ */ __dil.jsx(QuizIconButton, {
			label: state.copy_quiz_label,
			onClick: () => GenUI.dispatchAction({
				handler: "client",
				type: "copy",
				payload: { value: state.copy_quiz_text }
			})
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "copy",
			size: "xl",
			color: "secondary"
		})), state.share_button_variant === "top_right" && /* @__PURE__ */ __dil.jsx("pressable", {
			size: 36,
			align: "center",
			justify: "center",
			ariaLabel: state.share_label,
			onClick: () => GenUI.dispatchAction({
				type: "share",
				handler: "client",
				payload: { component_key: componentKey }
			})
		}, /* @__PURE__ */ __dil.jsx("icon", {
			name: "share",
			size: "xl",
			color: "secondary"
		})));
	}
	function QuizLoading({ label }) {
		const isDesktop = DIL.useBreakpoint("sm");
		const isMobile = DIL.useIsMobile();
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: {
				top: "10px",
				bottom: "10px"
			}
		}, /* @__PURE__ */ __dil.jsx(QuizHeader, {
			isDesktop,
			prompt: /* @__PURE__ */ __dil.jsx("col", {
				flex: isMobile ? "999 1 380px" : "999 1 340px",
				minWidth: 0,
				gap: 0,
				padding: { bottom: 4 },
				role: "status",
				ariaLabel: label
			}, /* @__PURE__ */ __dil.jsx("box", {
				height: 26,
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("box", {
				width: "90%",
				height: 18,
				radius: "full",
				background: "alpha-10"
			})), !isDesktop && /* @__PURE__ */ __dil.jsx("box", {
				height: 26,
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("box", {
				width: "90%",
				height: 18,
				radius: "full",
				background: "alpha-10"
			}))),
			navigation: /* @__PURE__ */ __dil.jsx("row", {
				flex: "0 0 auto",
				align: "center",
				gap: "5px"
			}, /* @__PURE__ */ __dil.jsx("box", {
				size: 36,
				align: "center",
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: "chevron-left",
				size: "xl",
				color: "tertiary"
			})), /* @__PURE__ */ __dil.jsx("box", {
				width: 48,
				align: "center",
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("loading-indicator", {
				size: "sm",
				color: "secondary"
			})), /* @__PURE__ */ __dil.jsx("box", {
				size: 36,
				align: "center",
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: "chevron-right",
				size: "xl",
				color: "tertiary"
			}))),
			utilities: /* @__PURE__ */ __dil.jsx("box", {
				size: 36,
				align: "center",
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: "lightbulb",
				size: "xl",
				color: "tertiary"
			}))
		}), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, [
			"A",
			"B",
			"C",
			"D"
		].map((value) => /* @__PURE__ */ __dil.jsx("box", {
			key: value,
			padding: {
				x: 4,
				y: "7px"
			},
			minHeight: 46
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "start",
			gap: 4
		}, /* @__PURE__ */ __dil.jsx("box", {
			size: 32,
			radius: "full",
			align: "center",
			justify: "center",
			border: {
				size: 1,
				color: "strong"
			}
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			weight: "medium",
			color: "primary"
		}, value)), /* @__PURE__ */ __dil.jsx("box", {
			flex: 1,
			minHeight: 32,
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "72%",
			height: 18,
			radius: "full",
			background: "alpha-10"
		})))))), /* @__PURE__ */ __dil.jsx("box", { height: isDesktop ? 4 : 0 }), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			height: isDesktop ? 60 : 48,
			padding: { x: 5 }
		}, /* @__PURE__ */ __dil.jsx("spacer", null), /* @__PURE__ */ __dil.jsx("box", {
			width: 72,
			height: 36,
			radius: "full",
			border: {
				size: 1,
				color: "subtle"
			},
			align: "center",
			justify: "center"
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: 28,
			height: 14,
			radius: "full",
			background: "alpha-10"
		}))));
	}
	function QuizOptionRow({ option, question, state, disabled, onSelect }) {
		const hasFeedback = state.feedback_status !== "";
		const selected = state.selected_values.includes(option.value);
		const correct = question.correct_values.includes(option.value);
		const marked = hasFeedback ? correct || selected : selected;
		const wrong = state.feedback_status === "incorrect" && selected && !correct;
		const missedCorrect = hasFeedback && question.question_type === "multi_select" && correct && !selected;
		const background = hasFeedback && correct && !missedCorrect ? "green-500" : wrong ? "red-400" : !hasFeedback && selected ? "#0d0d0d" : "transparent";
		return /* @__PURE__ */ __dil.jsx(QuizChoiceRow, {
			pressed: question.question_type === "multi_select" ? selected : void 0,
			interactive: !hasFeedback,
			disabled,
			onSelect,
			indicator: /* @__PURE__ */ __dil.jsx("box", {
				size: 32,
				align: "center",
				justify: "center",
				ariaHidden: true
			}, /* @__PURE__ */ __dil.jsx("box", {
				size: marked ? 30 : 32,
				radius: "full",
				align: "center",
				justify: "center",
				background,
				border: missedCorrect ? {
					size: 2,
					color: "green-500"
				} : marked ? false : {
					size: 1,
					color: hasFeedback ? "default" : "strong"
				}
			}, question.question_type === "single_select" ? /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "medium",
				color: marked ? "white" : hasFeedback ? "secondary" : "primary"
			}, option.value) : hasFeedback && correct || !hasFeedback && selected ? /* @__PURE__ */ __dil.jsx("icon", {
				name: "check",
				size: "xl",
				color: missedCorrect ? "green-500" : "white"
			}) : wrong ? /* @__PURE__ */ __dil.jsx("icon", {
				name: "x",
				size: "xl",
				color: "white"
			}) : null)),
			content: /* @__PURE__ */ __dil.jsx(TextOnlyMarkdown, null, option.label),
			feedback: hasFeedback && (selected || correct) && /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, option.feedback)
		});
	}
	function formatReviewMessage(parts, options) {
		return parts.map((part) => typeof part === "string" ? part : options[part].label).join("");
	}
	function missedAnswerFeedback(question, answer, messages) {
		const selectedOptions = question.options.filter((option) => answer.selected_values.includes(option.value));
		const selectedCorrectOptions = selectedOptions.filter((option) => question.correct_values.includes(option.value));
		return [
			formatReviewMessage(messages.selected_answer[selectedOptions.length], selectedOptions),
			question.question_type === "multi_select" && selectedCorrectOptions.length > 0 ? formatReviewMessage(messages.selected_correct[selectedCorrectOptions.length], selectedCorrectOptions) : "",
			...selectedOptions.filter((option) => !question.correct_values.includes(option.value)).map((option) => option.feedback)
		].filter(Boolean).join(" ");
	}
	function trueFalseVerdict(question, option, state) {
		if (question.question_type !== "true_false") return "";
		return \`\${option.value === "true" ? state.true_statement_label || \`\${option.label}.\` : state.false_statement_label || \`\${option.label}.\`} \`;
	}
	function QuizResults({ componentKey, state, disabled, onRestart }) {
		const scrollResults = DIL.useBreakpoint("sm") && state.answers.length > 5;
		const nextQuizQuery = state.next_quiz_query && state.done_on_completion ? "Done with the quiz" : state.next_quiz_query;
		const canRequestNextQuiz = state.generation_complete && Boolean(nextQuizQuery?.trim());
		function requestNextQuiz() {
			if (!canRequestNextQuiz) return;
			GenUI.dispatchAction({
				handler: "client",
				type: "issue_new_turn",
				loadingBehavior: "none",
				payload: {
					query: nextQuizQuery,
					append_to_current_leaf: true,
					event_name: "chatgpt_widget_action",
					event_data: {
						widget_affordance: "OPTION",
						widget_action_target: "next_quiz",
						surface_location: "RESPONSE",
						content_reference_type: "learning_quiz"
					}
				}
			});
		}
		return /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			justify: "between",
			height: 60,
			gap: "5px",
			padding: { x: 5 }
		}, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "secondary"
		}, state.title), /* @__PURE__ */ __dil.jsx(QuizUtilities, {
			state,
			componentKey
		})), /* @__PURE__ */ __dil.jsx("box", {
			height: scrollResults ? 280 : void 0,
			scrollable: scrollResults,
			clip: !scrollResults
		}, /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, /* @__PURE__ */ __dil.jsx("box", { padding: {
			x: 5,
			top: 1,
			bottom: 4
		} }, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "semibold"
		}, state.correct_count_labels[state.correct_count] ?? \`\${state.correct_count}/\${state.questions.length}\`)), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, state.answers.map((answer) => {
			const question = state.questions[answer.index];
			if (!question) return null;
			const correctOptions = question.options.filter((option) => question.correct_values.includes(option.value));
			const messages = state.review_messages;
			const reviewMessages = !answer.is_correct && messages?.selected_answer && messages.selected_correct && messages.correct_answer ? messages : null;
			return /* @__PURE__ */ __dil.jsx("box", {
				key: answer.question_id,
				padding: {
					x: 4,
					y: "7px"
				},
				minHeight: 46
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "start",
				gap: 4
			}, /* @__PURE__ */ __dil.jsx("box", {
				size: 32,
				align: "center",
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("box", {
				size: 30,
				radius: "full",
				align: "center",
				justify: "center",
				background: answer.is_correct ? "green-500" : "red-400"
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: answer.is_correct ? "check" : "x",
				size: "xl",
				color: "white"
			}))), /* @__PURE__ */ __dil.jsx("col", {
				flex: 1,
				minWidth: 0,
				gap: 1
			}, /* @__PURE__ */ __dil.jsx(TextOnlyMarkdown, null, question.prompt), reviewMessages ? /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, question.question_type === "multi_select" ? /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, \`\${formatReviewMessage(reviewMessages.correct_answer[correctOptions.length], correctOptions)} \${correctOptions.map((option) => option.feedback || option.label).join(" ")}\`) : /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, correctOptions.map((option) => /* @__PURE__ */ __dil.jsx("box", { key: option.value }, /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, \`\${trueFalseVerdict(question, option, state)}\${option.feedback || option.label}\`)))), /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, missedAnswerFeedback(question, answer, reviewMessages))) : question.question_type === "multi_select" ? /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, correctOptions.map((option) => option.label).join(", ")) : /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, correctOptions.map((option) => /* @__PURE__ */ __dil.jsx("box", { key: option.value }, /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, option.feedback)))))));
		})))), /* @__PURE__ */ __dil.jsx("row", {
			justify: "between",
			align: "center",
			gap: 3,
			padding: {
				x: 5,
				y: 4
			}
		}, /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			color: "secondary",
			variant: "outline",
			disabled,
			onClick: onRestart
		}, state.restart_label), canRequestNextQuiz && /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			onClick: requestNextQuiz
		}, state.next_quiz_label)));
	}
	function ResolvedLearningQuiz({ componentKey, state: incomingServerState, actionsReady, allowLocalAnswers, canRetryGeneration = false, visible = true }) {
		const isLiveActivity = useIsLiveActivity();
		const latestServerState = DIL.useRef(incomingServerState);
		let serverState = latestServerState.current;
		if (isServerSnapshotAtLeastAsNew(incomingServerState, serverState)) {
			const answers = incomingServerState.attempt === latestServerState.current.attempt ? mergeQuizAnswers(latestServerState.current.answers, incomingServerState.answers) : incomingServerState.answers;
			serverState = answers.length > incomingServerState.answers.length ? {
				...incomingServerState,
				answers,
				correct_count: answers.filter((answer$1) => answer$1.is_correct).length
			} : incomingServerState;
		}
		const [localProgress, setProgress] = DIL.useState(null);
		const savedProgress = {
			attempt: serverState.attempt,
			revision: serverState.revision ?? 0,
			navigation_sequence: serverState.navigation?.sequence ?? 0,
			current_index: serverState.navigation?.current_index ?? (serverState.phase === "results" ? serverState.questions.length : serverState.current_index),
			answers: serverState.answers,
			correct_count: serverState.correct_count,
			selected_values: serverState.navigation ? [] : serverState.selected_values,
			hint_open: serverState.navigation ? false : serverState.hint_open
		};
		let progress = localProgress && localProgress.attempt >= serverState.attempt ? localProgress : savedProgress;
		if (localProgress && localProgress.attempt === serverState.attempt) {
			const answers = mergeQuizAnswers(localProgress.answers, serverState.answers);
			progress = {
				...localProgress,
				revision: localProgress.revision === void 0 ? void 0 : Math.max(localProgress.revision, serverState.revision ?? 0),
				answers,
				correct_count: answers.filter((answer$1) => answer$1.is_correct).length
			};
			if ((savedProgress.navigation_sequence ?? 0) > (localProgress.navigation_sequence ?? 0)) progress = {
				...progress,
				navigation_sequence: savedProgress.navigation_sequence,
				current_index: savedProgress.current_index,
				selected_values: [],
				hint_open: false
			};
		}
		DIL.useEffect(() => {
			if (localProgress && serverState.attempt > localProgress.attempt || progress.attempt === serverState.attempt && (progress.navigation_sequence ?? 0) > (localProgress?.navigation_sequence ?? 0)) setProgress(progress);
		}, [
			serverState.attempt,
			localProgress?.attempt,
			progress.navigation_sequence,
			localProgress?.navigation_sequence
		]);
		const isDesktop = DIL.useBreakpoint("sm");
		const isMobile = DIL.useIsMobile();
		const [dismissed, setDismissed] = DIL.useState(false);
		const [failedAction, setFailedAction] = DIL.useState(null);
		const requestSequence = DIL.useRef(0);
		const latestAttempt = DIL.useRef(progress.attempt);
		DIL.useEffect(() => {
			latestServerState.current = serverState;
			latestAttempt.current = progress.attempt;
		}, [serverState, progress.attempt]);
		function actionIsConfirmed(action) {
			const confirmed = latestServerState.current;
			if (confirmed.attempt > action.payload.attempt) return true;
			if (confirmed.attempt !== action.payload.attempt || action.type === "learning_quiz_restart") return false;
			return confirmed.answers.some((answer$1) => answer$1.index === action.payload.question_index);
		}
		DIL.useEffect(() => {
			if (failedAction && (actionProgressAttempt(failedAction) < progress.attempt || actionIsConfirmed(failedAction))) setFailedAction(null);
		}, [
			progress.attempt,
			serverState,
			failedAction
		]);
		const nextRevision = Math.max(progress.revision ?? 0, serverState.revision ?? 0) + 1;
		function updateProgress(next) {
			setProgress({
				...next,
				revision: nextRevision
			});
		}
		const canInteract = actionsReady || allowLocalAnswers || !serverState.generation_complete;
		const canRestart = canInteract && !failedAction?.deferred;
		const index = progress.current_index;
		const currentQuestion = serverState.questions[index];
		const answer = progress.answers.find((value) => value.index === index && value.question_id === currentQuestion?.id);
		const selectedValues = answer?.selected_values ?? progress.selected_values;
		const state = {
			...serverState,
			...progress,
			current_index: index,
			phase: serverState.phase === "error" || serverState.phase === "loading" ? serverState.phase : currentQuestion ? "quiz" : serverState.generation_complete ? "results" : "loading",
			selected_values: selectedValues,
			feedback_status: answer ? answer.is_correct ? "correct" : "incorrect" : ""
		};
		async function submitAction(type, values = []) {
			if (!canInteract) return;
			if (type === "restart" && !canRestart) return;
			if (type === "answer" && (!currentQuestion || answer || values.length === 0)) return;
			const priorAnswers = progress.answers;
			const attempt = progress.attempt;
			if (type === "restart") updateProgress({
				attempt: attempt + 1,
				current_index: 0,
				answers: [],
				correct_count: 0,
				selected_values: [],
				hint_open: false
			});
			else if (currentQuestion) {
				const isCorrect = values.length === currentQuestion.correct_values.length && values.every((value) => currentQuestion.correct_values.includes(value));
				updateProgress({
					...progress,
					answers: [...priorAnswers, {
						index,
						question_id: currentQuestion.id,
						selected_values: values,
						is_correct: isCorrect
					}],
					correct_count: progress.correct_count + (isCorrect ? 1 : 0),
					selected_values: values
				});
			}
			const action = {
				type: type === "answer" ? "learning_quiz_answer" : "learning_quiz_restart",
				payload: {
					attempt,
					revision: nextRevision,
					prior_answers: priorAnswers,
					...type === "answer" ? {
						question_index: index,
						selected_values: values
					} : {}
				}
			};
			if (failedAction?.deferred && !allowLocalAnswers) setFailedAction({
				...action,
				deferred: true
			});
			else await deliverAction(action);
		}
		async function deliverAction(action) {
			if (!actionsReady || !serverState.generation_complete) {
				if (!allowLocalAnswers) setFailedAction({
					...action,
					deferred: true
				});
				return;
			}
			const requestId = ++requestSequence.current;
			setFailedAction(null);
			let failed = false;
			let statusMessage;
			try {
				const result = await GenUI.dispatchAction({
					handler: "server",
					type: action.type,
					payload: action.payload
				});
				if (result && typeof result === "object" && "status" in result && result.status === "error") {
					failed = true;
					if ("statusMessage" in result && typeof result.statusMessage === "string") statusMessage = result.statusMessage;
				}
			} catch {
				failed = true;
			}
			if (requestSequence.current !== requestId || latestAttempt.current > actionProgressAttempt(action) || actionIsConfirmed(action)) return;
			if (failed) setFailedAction({
				...action,
				statusMessage
			});
		}
		function selectOption(value) {
			if (!canInteract || !currentQuestion || answer) return;
			const values = currentQuestion.question_type === "multi_select" ? selectedValues.includes(value) ? selectedValues.filter((selected) => selected !== value) : [...selectedValues, value] : [value];
			if (currentQuestion.question_type === "multi_select") updateProgress({
				...progress,
				selected_values: values
			});
			else return submitAction("answer", values);
		}
		function navigate(nextIndex) {
			updateProgress({
				...progress,
				current_index: nextIndex,
				selected_values: [],
				hint_open: false
			});
		}
		const [mediaRetries, setMediaRetries] = DIL.useState({});
		const waitingToFlush = actionsReady && serverState.generation_complete && !!failedAction?.deferred;
		const now = DIL.useNow?.(waitingToFlush) ?? 0;
		const flushStartedAt = DIL.useRef(null);
		DIL.useEffect(() => {
			if (!waitingToFlush || !failedAction?.deferred) {
				flushStartedAt.current = null;
				return;
			}
			if (flushStartedAt.current === null) flushStartedAt.current = now;
			if (typeof DIL.useNow === "function" && now - flushStartedAt.current < 5e3) return;
			flushStartedAt.current = null;
			setFailedAction(null);
			if (!allowLocalAnswers && actionProgressAttempt(failedAction) >= progress.attempt && !actionIsConfirmed(failedAction)) deliverAction({
				type: failedAction.type,
				payload: failedAction.payload
			});
		}, [
			waitingToFlush,
			failedAction,
			progress.attempt,
			allowLocalAnswers,
			now
		]);
		const [presentedAttempt, setPresentedAttempt] = DIL.useState(null);
		const shouldLogPresentation = visible && !isLiveActivity && state.phase === "quiz" && state.answers.length === 0 && presentedAttempt !== state.attempt;
		function logPresentation() {
			if (!shouldLogPresentation) return;
			setPresentedAttempt(state.attempt);
			GenUI.logEvent?.({
				event_name: "chatgpt_learning_quiz_presented",
				statsig_event_name: "chatgpt_learning_quiz_presented",
				event_data: {
					question_count: state.questions.length,
					attempt_bucket: state.attempt === 0 ? "first" : state.attempt === 1 ? "second" : "third_plus"
				}
			});
		}
		const canRetry = canRetryGeneration && state.generation_complete && Boolean(state.retry_query?.trim());
		const celebration = DIL.useRef({
			completedAttempt: state.phase === "results" ? state.attempt : null,
			triggerAttempt: null
		});
		const perfectScore = state.phase === "results" && state.questions.length > 0 && state.correct_count === state.questions.length;
		const celebrationAttempt = visible && !isLiveActivity && (perfectScore && celebration.current.completedAttempt !== state.attempt || celebration.current.triggerAttempt === state.attempt) ? state.attempt : null;
		DIL.useEffect(() => {
			if (state.phase === "results") celebration.current.completedAttempt = state.attempt;
			celebration.current.triggerAttempt = celebrationAttempt;
		}, [
			state.phase,
			state.attempt,
			celebrationAttempt
		]);
		const question = state.questions[state.current_index];
		const hintOpen = state.hint_open;
		const showHint = Boolean(question?.hint);
		const hasFeedback = state.feedback_status !== "";
		const loading = state.phase === "loading" || state.phase === "quiz" && !question && !state.generation_complete;
		if (!visible) return null;
		if (isLiveActivity) {
			if (state.dismissed || dismissed) return null;
			return /* @__PURE__ */ __dil.jsx("box", {
				width: "100%",
				padding: 2,
				theme: "dark",
				background: "surface"
			}, /* @__PURE__ */ __dil.jsx("col", {
				gap: .5,
				width: "100%"
			}, /* @__PURE__ */ __dil.jsx("row", {
				align: "center",
				justify: "between",
				width: "100%",
				gap: 2
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				color: "secondary",
				truncate: true
			}, state.title), state.phase === "quiz" && /* @__PURE__ */ __dil.jsx("text", {
				size: "xs",
				weight: "medium"
			}, state.current_index + 1, "/", state.questions.length)), state.phase === "error" ? /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "medium",
				truncate: true
			}, state.error_label) : loading ? /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary",
				truncate: true
			}, state.loading_label) : state.phase === "results" ? /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "medium"
			}, state.correct_count, "/", state.questions.length) : question ? /* @__PURE__ */ __dil.jsx("box", {
				width: "100%",
				maxHeight: 36,
				clip: true
			}, /* @__PURE__ */ __dil.jsx("text", { preserveWhitespace: true }, question.prompt)) : null));
		}
		if (state.phase === "error" && (state.dismissed || dismissed)) return null;
		if (state.phase === "quiz" && !question && !loading) return null;
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			gap: 0
		}, /* @__PURE__ */ __dil.jsx("celebration", { trigger: celebrationAttempt === null ? null : String(celebrationAttempt) }), /* @__PURE__ */ __dil.jsx(QuizFrame, {
			isDesktop,
			clip: false
		}, state.phase === "error" ? /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			padding: 5,
			align: "start"
		}, /* @__PURE__ */ __dil.jsx("box", { role: "status" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			weight: "medium",
			color: "secondary"
		}, state.error_label)), /* @__PURE__ */ __dil.jsx("row", {
			gap: 2,
			align: "center",
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			disabled: !canRetry,
			onClick: () => {
				if (!canRetry) return;
				return GenUI.dispatchAction({
					handler: "client",
					type: "issue_new_turn",
					loadingBehavior: "none",
					payload: {
						query: state.retry_query,
						append_to_current_leaf: true,
						event_name: "chatgpt_widget_action",
						event_data: {
							widget_affordance: "OPTION",
							widget_action_target: "quiz_generation",
							widget_action_value: "retry",
							surface_location: "RESPONSE",
							content_reference_type: "learning_quiz"
						}
					}
				});
			}
		}, state.retry_label), /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			variant: "ghost",
			onClick: () => setDismissed(true)
		}, state.dismiss_label))) : loading ? /* @__PURE__ */ __dil.jsx(QuizLoading, { label: state.loading_label }) : state.phase === "results" ? /* @__PURE__ */ __dil.jsx(QuizResults, {
			componentKey,
			state,
			disabled: !canRestart,
			onRestart: () => submitAction("restart")
		}) : question ? /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, (question.image || question.image_is_loading) && /* @__PURE__ */ __dil.jsx("box", {
			height: 140,
			width: "100%",
			ariaHidden: true
		}, /* @__PURE__ */ __dil.jsx(QuizMedia, {
			image: question.image,
			loading: question.image_is_loading === true,
			height: 152,
			alt: "",
			identity: \`question:\${question.id}\`,
			retries: mediaRetries,
			onRetryChange: (key, download) => setMediaRetries((previous) => ({
				...previous,
				[key]: download
			})),
			radius: {
				topLeft: "24px",
				topRight: "24px",
				bottomLeft: "none",
				bottomRight: "none"
			}
		})), /* @__PURE__ */ __dil.jsx("col", {
			gap: 0,
			padding: {
				top: "10px",
				bottom: "10px"
			}
		}, /* @__PURE__ */ __dil.jsx("box", {
			key: state.attempt,
			onVisible: logPresentation,
			onVisibleWhen: shouldLogPresentation
		}, /* @__PURE__ */ __dil.jsx(QuizHeader, {
			isDesktop,
			prompt: /* @__PURE__ */ __dil.jsx("col", {
				flex: isMobile ? "999 1 380px" : "999 1 340px",
				minWidth: 0,
				gap: 0,
				padding: { bottom: hintOpen ? 2 : 4 }
			}, /* @__PURE__ */ __dil.jsx(TextOnlyMarkdown, null, question.prompt), hintOpen && question.hint && /* @__PURE__ */ __dil.jsx("box", { padding: { top: 1.5 } }, /* @__PURE__ */ __dil.jsx("text", {
				size: "md",
				color: "secondary"
			}, question.hint))),
			navigation: /* @__PURE__ */ __dil.jsx("row", {
				flex: "0 0 auto",
				align: "center",
				gap: "5px"
			}, /* @__PURE__ */ __dil.jsx(QuizIconButton, {
				disabled: state.current_index === 0,
				onClick: () => navigate(state.current_index - 1),
				label: state.previous_question_label
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: "chevron-left",
				size: "xl",
				color: state.current_index === 0 ? "alpha-35" : "secondary"
			})), state.generation_complete && /* @__PURE__ */ __dil.jsx("box", {
				width: "max-content",
				minWidth: 48,
				align: "center",
				justify: "center"
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, state.question_progress_labels[state.current_index])), /* @__PURE__ */ __dil.jsx(QuizIconButton, {
				disabled: !hasFeedback,
				onClick: () => navigate(state.current_index + 1),
				label: state.next_question_label
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: "chevron-right",
				size: "xl",
				color: hasFeedback && state.answers.length > state.current_index ? "secondary" : "alpha-35"
			}))),
			utilities: /* @__PURE__ */ __dil.jsx("row", {
				flex: "0 0 auto",
				align: "center",
				gap: "5px"
			}, showHint && /* @__PURE__ */ __dil.jsx(QuizIconButton, {
				label: state.hint_label,
				tooltip: isMobile ? void 0 : state.hint_label,
				onClick: () => updateProgress({
					...progress,
					selected_values: state.selected_values,
					hint_open: !hintOpen
				})
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: hintOpen ? "lightbulb-22-filled" : "lightbulb",
				size: "xl",
				color: hintOpen ? "primary" : "secondary"
			})), /* @__PURE__ */ __dil.jsx(QuizUtilities, {
				state,
				componentKey
			}))
		})), /* @__PURE__ */ __dil.jsx("col", { gap: 0 }, question.options.map((option) => /* @__PURE__ */ __dil.jsx(QuizOptionRow, {
			key: option.value,
			option,
			question,
			state,
			disabled: !canInteract || hasFeedback,
			onSelect: () => selectOption(option.value)
		}))), /* @__PURE__ */ __dil.jsx("box", { height: isDesktop ? 4 : 0 }), /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			height: isDesktop ? 60 : 48,
			padding: {
				left: 5,
				right: 6
			}
		}, question.question_type === "multi_select" && !hasFeedback && /* @__PURE__ */ __dil.jsx("text", {
			size: "md",
			color: "secondary"
		}, state.select_all_that_apply_label), /* @__PURE__ */ __dil.jsx("spacer", null), /* @__PURE__ */ __dil.jsx("button", {
			size: "lg",
			color: "secondary",
			variant: "outline",
			disabled: !hasFeedback && (!canInteract || question.question_type !== "multi_select" || state.selected_values.length === 0),
			onClick: () => hasFeedback ? navigate(state.current_index + 1) : submitAction("answer", state.selected_values)
		}, question.question_type === "multi_select" && !hasFeedback && state.selected_values.length > 0 ? state.submit_answer_label : state.advance_label)))) : null), failedAction && !failedAction.deferred && actionProgressAttempt(failedAction) === progress.attempt && !actionIsConfirmed(failedAction) && /* @__PURE__ */ __dil.jsx("row", {
			role: "alert",
			gap: 3,
			align: "center",
			padding: { top: 3 }
		}, failedAction.statusMessage && /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary"
		}, failedAction.statusMessage), /* @__PURE__ */ __dil.jsx("button", {
			size: "sm",
			variant: "outline",
			disabled: !canInteract,
			onClick: () => deliverAction(failedAction)
		}, state.retry_label)), state.generation_complete && state.share_button_variant === "bottom" && !state.dismissed && (state.phase === "quiz" || state.phase === "results") && /* @__PURE__ */ __dil.jsx("box", { padding: { top: 3 } }, /* @__PURE__ */ __dil.jsx("button", {
			variant: "soft",
			block: true,
			onClick: () => GenUI.dispatchAction({
				type: "share",
				handler: "client",
				payload: { component_key: componentKey }
			})
		}, /* @__PURE__ */ __dil.jsx("icon", { name: "share" }), state.share_label)));
	}

//#endregion
//#region LearningQuiz.dil.tsx
	function LearningQuiz(props) {
		const componentKey = DIL.useAppData((appData$1) => typeof props.__resolutionId === "string" && appData$1.opGenui?.componentResults?.[props.__resolutionId] != null ? props.__resolutionId : componentDataKey("LearningQuiz", props));
		const canShare = DIL.useAppData((appData$1) => appData$1.opGenui?.supportedClientActions?.includes("share") === true);
		const canRetryGeneration = DIL.useAppData((appData$1) => appData$1.opGenui?.supportedClientActions?.includes("issue_new_turn") === true);
		const { state, resolutionComplete } = useResolvedComponentResult("LearningQuiz", props.__resolutionId ? {
			...props,
			__state: void 0
		} : props);
		const appData = DIL.useAppData();
		const isShared = appData.opGenui?.isShared === true;
		const isDesktop = DIL.useBreakpoint("sm");
		if (!state) {
			if (resolutionComplete) return props.fallback ?? null;
			return /* @__PURE__ */ __dil.jsx(QuizFrame, { isDesktop }, /* @__PURE__ */ __dil.jsx(QuizLoading, null));
		}
		const supportedQuestions = state.questions.every((question) => [
			"single_select",
			"multi_select",
			"true_false"
		].includes(question.question_type));
		return /* @__PURE__ */ __dil.jsx(ResolvedLearningQuiz, {
			componentKey,
			canRetryGeneration: canRetryGeneration && !isShared,
			state: {
				...state,
				phase: supportedQuestions ? state.phase : "error",
				share_button_variant: canShare ? state.share_button_variant : "none",
				next_quiz_query: isShared ? void 0 : state.next_quiz_query,
				retry_query: isShared ? void 0 : state.retry_query
			},
			allowLocalAnswers: isShared && supportedQuestions,
			actionsReady: supportedQuestions && appData.opGenui?.nativeServerActions?.ready === true
		});
	}

//#endregion
return LearningQuiz;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=learning-quiz-ab5882cf8875.js.map