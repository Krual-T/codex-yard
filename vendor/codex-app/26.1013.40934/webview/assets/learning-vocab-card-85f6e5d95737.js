import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region SpeechSynthesizer.dil.tsx
	const unavailable = {
		available: false,
		status: "idle",
		error: null,
		play: () => {},
		stop: () => {}
	};
	const { useSpeechSynthesizer = () => unavailable } = DIL;
	function SpeechSynthesizer({ controls, disabled = false, logging, playbackSpeed = 1, ...source }) {
		const speech = useSpeechSynthesizer({
			...source,
			playbackSpeed
		}, logging);
		DIL.useEffect(() => {
			if (disabled) speech.stop();
		}, [disabled, speech.stop]);
		const play = () => {
			if (!disabled) speech.play();
		};
		const stop = () => {
			if (!disabled) speech.stop();
		};
		if (controls) return controls({
			...speech,
			play,
			stop
		});
		if (!speech.available) return /* @__PURE__ */ __dil.jsx("text", null, "Audio unavailable");
		return speech.status === "idle" ? /* @__PURE__ */ __dil.jsx("button", {
			disabled,
			onClick: play
		}, "Play") : /* @__PURE__ */ __dil.jsx("button", { onClick: stop }, "Stop");
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
//#region learning/cards/LearningVocabCard.dil.tsx
	function LearningVocabCard$1(props) {
		const wide = DIL.useBreakpoint("sm");
		return /* @__PURE__ */ __dil.jsx("box", {
			width: "100vw",
			maxWidth: "100%"
		}, /* @__PURE__ */ __dil.jsx(LearningExercisePager, {
			...props,
			newTurnQuery: null,
			isExerciseComplete: () => true,
			getResponse: (data) => ({
				question: data.text,
				answer: ""
			}),
			renderExercise: (data, _selection, navigation, footer) => /* @__PURE__ */ __dil.jsx(SpeechSynthesizer, {
				text: data.text,
				language: data.language,
				pronunciationHint: data.pronunciationHint ?? void 0,
				source: "learning_vocab_card",
				controls: (speech) => {
					const playButton = /* @__PURE__ */ __dil.jsx("pressable", {
						height: wide ? "40px" : "44px",
						minWidth: "92px",
						padding: { x: 3 },
						radius: "full",
						background: "blue-400",
						align: "center",
						justify: "center",
						ariaLabel: !speech.available ? data.audioLabels.unavailable : speech.status !== "playing" ? data.audioLabels.play : data.audioLabels.stop,
						disabled: !speech.available,
						onClick: speech.status === "idle" ? speech.play : speech.stop
					}, /* @__PURE__ */ __dil.jsx("row", {
						gap: 1.5,
						align: "center"
					}, speech.status === "loading" ? /* @__PURE__ */ __dil.jsx("loading-indicator", {
						size: "lg",
						color: "white"
					}) : /* @__PURE__ */ __dil.jsx("icon", {
						name: speech.status === "idle" ? "sound-on-read-out-loud-speaker" : "stop",
						size: "2xl",
						color: "white"
					}), /* @__PURE__ */ __dil.jsx("text", {
						size: "md",
						weight: "medium",
						color: "white"
					}, speech.status !== "playing" ? data.audioLabels.play : data.audioLabels.stop)));
					return /* @__PURE__ */ __dil.jsx(LearningCard, {
						icon: "book",
						variant: "dictionary",
						title: data.title,
						navigation,
						actions: playButton,
						footer,
						prompt: /* @__PURE__ */ __dil.jsx("title", {
							size: "xl",
							weight: "normal",
							color: "primary"
						}, data.text)
					}, /* @__PURE__ */ __dil.jsx("col", { gap: 2 }, /* @__PURE__ */ __dil.jsx("text", {
						size: "md",
						color: "primary"
					}, data.translation), data.pronunciation ? /* @__PURE__ */ __dil.jsx("text", {
						size: "md",
						color: "secondary",
						italic: true
					}, data.pronunciation) : null, speech.error ? /* @__PURE__ */ __dil.jsx("box", { role: "status" }, /* @__PURE__ */ __dil.jsx("text", {
						size: "sm",
						color: "secondary"
					}, data.audioLabels.error)) : null));
				}
			})
		}));
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
//#region LearningVocabCard.dil.tsx
	function LearningVocabCard(props) {
		const { state } = useResolvedComponentResult("LearningVocabCard", props);
		if (state) return /* @__PURE__ */ __dil.jsx(LearningVocabCard$1, state);
		if ("progressLabels" in props) return /* @__PURE__ */ __dil.jsx(LearningVocabCard$1, props);
		return props.fallback ?? null;
	}

//#endregion
return LearningVocabCard;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=learning-vocab-card-85f6e5d95737.js.map