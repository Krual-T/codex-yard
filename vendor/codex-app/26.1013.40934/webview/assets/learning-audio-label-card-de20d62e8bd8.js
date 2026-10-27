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
//#region learning/primitives/LearningAudio.dil.tsx
	function LearningAudio({ speech, labels }) {
		const wide = DIL.useBreakpoint("sm");
		const active = speech.status !== "idle";
		return /* @__PURE__ */ __dil.jsx("col", {
			width: "100%",
			align: "start",
			justify: "center",
			gap: 2
		}, /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: !speech.available ? labels.unavailable : active ? labels.stop : labels.play,
			disabled: !speech.available,
			onClick: active ? speech.stop : speech.play,
			width: "24px",
			height: wide ? "40px" : "44px",
			radius: "full",
			background: "transparent"
		}, /* @__PURE__ */ __dil.jsx("col", {
			ariaHidden: true,
			width: "100%",
			height: "100%",
			align: "center",
			justify: "center"
		}, speech.status === "loading" ? /* @__PURE__ */ __dil.jsx("loading-indicator", { size: "lg" }) : /* @__PURE__ */ __dil.jsx("icon", {
			name: active ? "stop" : "play-triangle",
			size: "2xl"
		}))), speech.error ? /* @__PURE__ */ __dil.jsx("box", { role: "status" }, /* @__PURE__ */ __dil.jsx("text", {
			size: "sm",
			color: "secondary",
			textAlign: "center"
		}, labels.error)) : null);
	}

//#endregion
//#region learning/cards/LearningAudioLabelCard.dil.tsx
	function LearningAudioLabelCard$1(props) {
		return /* @__PURE__ */ __dil.jsx(LearningExercisePager, {
			...props,
			getResponse: (data, selectedIds) => ({
				question: [data.directions, data.text].filter(Boolean).join("\\n"),
				answer: data.options.find((option) => option.id === selectedIds[0])?.label ?? ""
			}),
			renderExercise: (data, selection, navigation, footer) => /* @__PURE__ */ __dil.jsx(AudioLabelExercise, {
				...data,
				selection,
				navigation,
				footer
			})
		});
	}
	function AudioLabelExercise({ title, selection, navigation, footer, text, language, pronunciationHint, playbackSpeed, options, correctOptionId, correctLabel, incorrectLabel, audioLabels, directions }) {
		const wide = DIL.useBreakpoint("sm");
		const selectedSpeed = DIL.useRef(null);
		const [, refresh] = DIL.useState(0);
		const speed = selectedSpeed.current ?? playbackSpeed ?? 1;
		const selectedId = selection.selectedIds[0] ?? null;
		return /* @__PURE__ */ __dil.jsx(SpeechSynthesizer, {
			text,
			language: language ?? void 0,
			pronunciationHint: pronunciationHint ?? void 0,
			playbackSpeed: speed,
			source: "learning_audio_label_card",
			controls: (speech) => /* @__PURE__ */ __dil.jsx(LearningCard, {
				variant: "listening",
				icon: "headphones",
				title,
				navigation,
				footer,
				actions: /* @__PURE__ */ __dil.jsx("pressable", {
					height: wide ? "28px" : "44px",
					padding: { x: "10px" },
					radius: "full",
					background: "transparent",
					onClick: () => {
						speech.stop();
						selectedSpeed.current = speed === 1 ? .75 : speed === .75 ? .5 : 1;
						refresh((value) => value + 1);
					}
				}, /* @__PURE__ */ __dil.jsx("text", {
					size: "md",
					color: "secondary"
				}, \`\${speed}×\`)),
				divider: false,
				prompt: /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, selectedId === null && directions ? /* @__PURE__ */ __dil.jsx("text", {
					size: "md",
					color: "primary"
				}, directions) : null, selectedId !== null ? /* @__PURE__ */ __dil.jsx("text", {
					size: "md",
					color: "primary"
				}, text) : null, /* @__PURE__ */ __dil.jsx(LearningAudio, {
					speech,
					labels: audioLabels
				}))
			}, /* @__PURE__ */ __dil.jsx(LearningTextChoices, {
				variant: "list",
				options,
				selectedId,
				correctOptionId,
				correctLabel,
				incorrectLabel,
				disabled: !speech.available || Boolean(speech.error) || selectedId !== null,
				onSelect: (id) => selection.setSelectedIds((current) => current.length ? current : [id])
			}))
		});
	}

//#endregion
//#region LearningAudioLabelCard.dil.tsx
	function LearningAudioLabelCard(props) {
		const { state } = useResolvedComponentResult("LearningAudioLabelCard", props);
		if (state) return /* @__PURE__ */ __dil.jsx(LearningAudioLabelCard$1, state);
		if ("progressLabels" in props) return /* @__PURE__ */ __dil.jsx(LearningAudioLabelCard$1, props);
		return props.fallback ?? null;
	}

//#endregion
return LearningAudioLabelCard;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=learning-audio-label-card-de20d62e8bd8.js.map