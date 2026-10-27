import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


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
//#region learning/speaking.dil.ts
	const REPEAT_ATTEMPT_TIMEOUT_MS = 5e3;
	const RECALL_ATTEMPT_TIMEOUT_MS = 1e4;
	const SPEAKING_SUCCESS_HIGHLIGHT_MS = 500;
	const SPEAKING_SUCCESS_FADE_MS = 500;
	function wordKey(text) {
		return text.toLowerCase().normalize("NFD").replace(/(\\p{Script=Latin})\\p{M}+/gu, "$1").replace(/[^\\p{L}\\p{N}\\p{M}]/gu, "");
	}
	function hasSpeakingSegmenter() {
		return typeof Intl !== "undefined" && typeof Intl.Segmenter === "function";
	}
	/** Keep display spans intact while comparing normalized, whole words. */
	function speakingParts(text, language) {
		if (!hasSpeakingSegmenter()) return [];
		let segmenter;
		try {
			segmenter = new Intl.Segmenter(language || void 0, { granularity: "word" });
		} catch {
			segmenter = new Intl.Segmenter(void 0, { granularity: "word" });
		}
		const parts = Array.from(segmenter.segment(text), (part) => ({
			text: part.segment,
			word: part.isWordLike ? wordKey(part.segment) || null : null
		}));
		const displayParts = [];
		for (const part of parts) {
			const previous = displayParts[displayParts.length - 1];
			const opening = part.word && previous && !previous.word ? previous.text.match(/[¿¡]+$/u)?.[0] : void 0;
			if (opening) {
				previous.text = previous.text.slice(0, -opening.length);
				if (!previous.text) displayParts.pop();
				displayParts.push({
					text: opening + part.text,
					word: part.word
				});
				continue;
			}
			const punctuation = !part.word && previous?.word ? part.text.match(/^(?:(?![¿¡])\\p{P})+/u)?.[0] : void 0;
			if (punctuation) {
				previous.text += punctuation;
				const rest = part.text.slice(punctuation.length);
				if (rest) displayParts.push({
					text: rest,
					word: null
				});
			} else if (!part.word && previous && !previous.word) previous.text += part.text;
			else displayParts.push(part);
		}
		return displayParts;
	}
	/** Every transcript is a replacement, never an additional batch of words. */
	function matchSpeakingWords(parts, transcript, language) {
		const counts = /* @__PURE__ */ new Map();
		for (const { word } of speakingParts(transcript, language)) if (word) counts.set(word, (counts.get(word) ?? 0) + 1);
		let remaining = 0;
		return {
			matched: parts.map(({ word }) => {
				if (!word) return false;
				const count = counts.get(word) ?? 0;
				if (count > 0) {
					counts.set(word, count - 1);
					return true;
				}
				remaining++;
				return false;
			}),
			complete: parts.some((part) => part.word !== null) && remaining === 0
		};
	}
	/** New occurrences count as activity even when they are not target words. */
	function hasNewSpeakingWords(previousTranscript, transcript, language) {
		if (transcript === previousTranscript) return false;
		const parts = speakingParts(transcript, language);
		return parts.some((part) => part.word !== null) && !matchSpeakingWords(parts, previousTranscript, language).complete;
	}

//#endregion
//#region learning/cards/LearningSpeakCard.dil.tsx
	const { useDictation = () => void 0 } = DIL;
	const SUCCESS = "spoken";
	const SKIPPED = "skipped";
	const ACTION_HEIGHT = 48;
	const HEADER_CONTROL_SIZE = 40;
	const STOP_CONTROL_SIZE = 32;
	function LearningSpeakCard$1(props) {
		const debugVisibility = DIL.useRef(false);
		return /* @__PURE__ */ __dil.jsx(LearningExercisePager, {
			...props,
			doneButtonLabel: props.exercises[0]?.data.labels.done,
			isExerciseComplete: (_, ids) => ids.includes(SUCCESS),
			getResponse: (data, ids) => ({
				question: data.text,
				answer: ids.includes(SKIPPED) ? data.labels.skipped ?? "Skipped" : data.text
			}),
			renderExercise: (data, selection, navigation, footer) => /* @__PURE__ */ __dil.jsx(SpeakExercise, {
				...data,
				isDebugVisible: () => debugVisibility.current,
				toggleDebug: () => {
					debugVisibility.current = !debugVisibility.current;
				},
				selection,
				navigation,
				footer
			})
		});
	}
	function SpeakExercise({ text, language, mode = "repeat", sourceText, inactivityTimeoutMs, isDebugAllowed = false, isDebugVisible, toggleDebug, labels, selection, navigation, footer }) {
		const dictation = useDictation({
			...language ? { language } : {},
			context: {
				kind: "speaking_exercise",
				expectedPhrase: text
			}
		});
		const parts = DIL.useMemo(() => {
			const segmented = speakingParts(text, language);
			return segmented.length ? segmented : [{
				text,
				word: text
			}];
		}, [text, language]);
		const attempt = DIL.useRef({
			id: 0,
			phase: "idle",
			lastActivityAt: null,
			successHighlightUntil: null,
			timeoutMs: null,
			transcript: "",
			matched: [],
			error: false
		});
		const [, refresh] = DIL.useState(0);
		const update = () => refresh((value) => value + 1);
		const succeeded = selection.selectedIds.includes(SUCCESS);
		const recall = mode === "recall";
		const defaultTimeoutMs = recall ? RECALL_ATTEMPT_TIMEOUT_MS : REPEAT_ATTEMPT_TIMEOUT_MS;
		const configuredTimeoutMs = typeof inactivityTimeoutMs === "number" && Number.isFinite(inactivityTimeoutMs) && inactivityTimeoutMs > 0 ? inactivityTimeoutMs : defaultTimeoutMs;
		const attemptTimeoutMs = attempt.current.timeoutMs ?? configuredTimeoutMs;
		const active = !succeeded && attempt.current.phase === "active";
		const highlightingSuccess = succeeded && attempt.current.successHighlightUntil !== null;
		const now = DIL.useNow(active && dictation?.status !== "starting" || highlightingSuccess, highlightingSuccess ? 50 : 1e3);
		const transcript = dictation?.transcript ?? "";
		const debugVisible = isDebugVisible();
		const liveMatch = DIL.useMemo(() => matchSpeakingWords(parts, transcript, language), [
			parts,
			transcript,
			language
		]);
		const unavailable$1 = !dictation || dictation.error?.code === "integration_error" || !hasSpeakingSegmenter();
		function startAttempt(stopPlayback) {
			if (!dictation || unavailable$1 || attempt.current.phase === "active") return;
			stopPlayback();
			dictation.cancel();
			selection.setSelectedIds(() => []);
			attempt.current = {
				id: attempt.current.id + 1,
				phase: "active",
				lastActivityAt: null,
				successHighlightUntil: null,
				timeoutMs: configuredTimeoutMs,
				transcript: "",
				matched: [],
				error: false
			};
			dictation.start();
			update();
		}
		function finish(success, error = false) {
			if (attempt.current.phase !== "active") return;
			attempt.current = {
				...attempt.current,
				phase: success ? "success" : "failure",
				successHighlightUntil: success ? now + SPEAKING_SUCCESS_HIGHLIGHT_MS : null,
				error
			};
			dictation?.stop();
			if (success) selection.setSelectedIds(() => [SUCCESS]);
			update();
		}
		const renderedAttemptId = attempt.current.id;
		DIL.useEffect(() => {
			if (attempt.current.id !== renderedAttemptId) return;
			if (succeeded) {
				if (attempt.current.phase === "active") {
					attempt.current = {
						...attempt.current,
						phase: "success"
					};
					dictation?.cancel();
				}
				if (attempt.current.successHighlightUntil !== null && now >= attempt.current.successHighlightUntil) {
					attempt.current = {
						...attempt.current,
						successHighlightUntil: null
					};
					update();
				}
				return;
			}
			if (!active || !dictation) return;
			if (dictation.status === "error" || dictation.status === "idle") {
				finish(false, true);
				return;
			}
			if (dictation.status === "starting") return;
			const lastActivityAt = attempt.current.lastActivityAt ?? now;
			if (now - lastActivityAt >= attemptTimeoutMs) {
				finish(false);
				return;
			}
			attempt.current = {
				...attempt.current,
				lastActivityAt: hasNewSpeakingWords(attempt.current.transcript, dictation.transcript, language) ? now : lastActivityAt,
				transcript: dictation.transcript,
				matched: liveMatch.matched
			};
			if (liveMatch.complete) finish(true);
			else if (dictation.status === "done") finish(false);
		});
		const cancel = dictation?.cancel;
		DIL.useEffect(() => () => cancel?.(), [cancel]);
		const failed = attempt.current.phase === "failure";
		const showSkip = failed && !succeeded && selection.advanceWithAnswer !== null;
		const showPlayback = !recall || succeeded || failed && !attempt.current.error;
		const expired = attempt.current.lastActivityAt !== null && now - attempt.current.lastActivityAt >= attemptTimeoutMs;
		const matched = active && !expired ? liveMatch.matched : attempt.current.matched;
		const showMissingWords = failed && !succeeded && !attempt.current.error;
		const wordColors = parts.map(({ word }, index) => {
			if (!word) return "primary";
			if (succeeded) return highlightingSuccess ? "info" : "primary";
			if (matched[index]) return active ? "info" : "primary";
			return showMissingWords ? "danger" : "primary";
		});
		const message = succeeded ? null : unavailable$1 ? labels.unavailable : failed && attempt.current.error ? labels.error : null;
		return /* @__PURE__ */ __dil.jsx(SpeechSynthesizer, {
			text,
			language: language ?? void 0,
			source: "learning_speak_card",
			disabled: active || !showPlayback,
			controls: (speech) => /* @__PURE__ */ __dil.jsx(LearningCard, {
				icon: "voice",
				title: labels.title,
				navigation,
				footer: showSkip ? /* @__PURE__ */ __dil.jsx("row", {
					gap: 2,
					align: "center",
					justify: "end",
					wrap: "wrap"
				}, /* @__PURE__ */ __dil.jsx("pressable", {
					height: "36px",
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
					ariaLabel: labels.skip ?? "Skip",
					onClick: () => {
						if (attempt.current.phase !== "failure" || succeeded || !selection.advanceWithAnswer) return;
						attempt.current = {
							...attempt.current,
							id: attempt.current.id + 1,
							phase: "idle"
						};
						dictation?.cancel();
						speech.stop();
						selection.advanceWithAnswer([SKIPPED], (answers) => answers.every((ids) => ids.includes(SKIPPED)) ? labels.skipCompletion ?? "I'd like to skip this speaking practice. Let's continue." : void 0);
						update();
					}
				}, /* @__PURE__ */ __dil.jsx("text", {
					size: "md",
					weight: "medium",
					color: "primary"
				}, labels.skip ?? "Skip")), /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, footer)) : footer,
				divider: false,
				actions: /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, showPlayback ? /* @__PURE__ */ __dil.jsx("pressable", {
					size: HEADER_CONTROL_SIZE,
					radius: "full",
					background: "transparent",
					ariaLabel: !speech.available ? labels.playbackUnavailable : speech.status === "idle" ? labels.play : labels.stopPlayback,
					disabled: active || !speech.available,
					onClick: speech.status === "idle" ? speech.play : speech.stop
				}, /* @__PURE__ */ __dil.jsx("box", {
					height: "100%",
					align: "center",
					justify: "center",
					ariaHidden: true
				}, /* @__PURE__ */ __dil.jsx("icon", {
					name: speech.status === "idle" ? "sound-on-read-out-loud-speaker" : "stop",
					size: "xl",
					color: "secondary"
				}))) : null, isDebugAllowed ? /* @__PURE__ */ __dil.jsx("pressable", {
					size: HEADER_CONTROL_SIZE,
					radius: "full",
					align: "center",
					justify: "center",
					background: debugVisible ? "surface-tertiary" : "transparent",
					ariaLabel: debugVisible ? "Hide live transcript" : "Show live transcript",
					ariaPressed: debugVisible,
					onClick: () => {
						toggleDebug();
						update();
					}
				}, /* @__PURE__ */ __dil.jsx("box", {
					height: "100%",
					align: "center",
					justify: "center",
					ariaHidden: true
				}, /* @__PURE__ */ __dil.jsx("icon", {
					name: "bug",
					size: "xl",
					color: "secondary"
				}))) : null),
				prompt: recall ? /* @__PURE__ */ __dil.jsx("col", { gap: 4 }, /* @__PURE__ */ __dil.jsx("col", { gap: 1.5 }, /* @__PURE__ */ __dil.jsx("text", {
					size: "sm",
					color: "secondary"
				}, labels.recallInstruction), /* @__PURE__ */ __dil.jsx("text", {
					size: "xl",
					preserveWhitespace: true
				}, sourceText)), /* @__PURE__ */ __dil.jsx(SuccessTransition, {
					succeeded,
					highlighting: highlightingSuccess
				}, /* @__PURE__ */ __dil.jsx(RecallPhrase, {
					parts,
					matched,
					wordColors,
					succeeded,
					failed: showMissingWords,
					hiddenWord: labels.hiddenWord ?? ""
				}))) : /* @__PURE__ */ __dil.jsx("box", null, /* @__PURE__ */ __dil.jsx(SuccessTransition, {
					succeeded,
					highlighting: highlightingSuccess
				}, /* @__PURE__ */ __dil.jsx("text", {
					size: "xl",
					preserveWhitespace: true
				}, parts.map((part, index) => part.word ? /* @__PURE__ */ __dil.jsx("text", {
					key: index,
					inline: true,
					color: wordColors[index]
				}, part.text) : part.text))))
			}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, /* @__PURE__ */ __dil.jsx("col", {
				role: "status",
				gap: 2
			}, succeeded ? /* @__PURE__ */ __dil.jsx("row", {
				height: ACTION_HEIGHT,
				padding: {
					left: 4,
					right: 2
				},
				radius: "xl",
				background: "green-500",
				align: "center",
				justify: "between"
			}, /* @__PURE__ */ __dil.jsx("row", {
				gap: 2,
				align: "center"
			}, /* @__PURE__ */ __dil.jsx("box", { ariaHidden: true }, /* @__PURE__ */ __dil.jsx("icon", {
				name: "check-md",
				color: "white",
				size: "xl"
			})), /* @__PURE__ */ __dil.jsx("text", {
				color: "white",
				weight: "medium"
			}, labels.success)), /* @__PURE__ */ __dil.jsx("pressable", {
				size: 40,
				flex: "0 0 auto",
				radius: "full",
				background: "transparent",
				ariaLabel: labels.retry,
				disabled: unavailable$1,
				onClick: () => startAttempt(speech.stop)
			}, /* @__PURE__ */ __dil.jsx("box", {
				height: "100%",
				align: "center",
				justify: "center",
				ariaHidden: true
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: "reload",
				color: "white",
				size: "xl"
			})))) : active ? /* @__PURE__ */ __dil.jsx("row", {
				height: ACTION_HEIGHT,
				padding: {
					left: 4,
					right: 2
				},
				radius: "full",
				background: {
					light: "surface-tertiary",
					dark: "gray-300"
				},
				align: "center",
				justify: "between"
			}, /* @__PURE__ */ __dil.jsx("shimmer-text", { weight: "medium" }, dictation?.status === "starting" ? labels.starting : labels.listening), /* @__PURE__ */ __dil.jsx("pressable", {
				size: STOP_CONTROL_SIZE,
				radius: "full",
				background: {
					light: "blue-500",
					dark: "transparent"
				},
				ariaLabel: labels.stop,
				onClick: () => {
					const withinDeadline = attempt.current.lastActivityAt !== null && now - attempt.current.lastActivityAt < attemptTimeoutMs;
					if (withinDeadline) attempt.current = {
						...attempt.current,
						matched: liveMatch.matched
					};
					finish(withinDeadline && liveMatch.complete);
				}
			}, /* @__PURE__ */ __dil.jsx("box", {
				height: "100%",
				align: "center",
				justify: "center",
				ariaHidden: true
			}, /* @__PURE__ */ __dil.jsx("icon", {
				name: "stop",
				color: "white",
				size: "lg"
			})))) : /* @__PURE__ */ __dil.jsx("pressable", {
				height: ACTION_HEIGHT,
				width: "100%",
				radius: "full",
				background: {
					light: "blue-500",
					dark: "gray-975"
				},
				ariaLabel: failed ? labels.retry : labels.start,
				disabled: unavailable$1 || !parts.some((part) => part.word),
				onClick: () => startAttempt(speech.stop)
			}, /* @__PURE__ */ __dil.jsx("row", {
				height: "100%",
				align: "center",
				justify: "center",
				gap: 1.5
			}, /* @__PURE__ */ __dil.jsx("box", { ariaHidden: true }, /* @__PURE__ */ __dil.jsx("icon", {
				name: failed ? "reload" : "mic",
				color: {
					light: "white",
					dark: "gray-50"
				}
			})), /* @__PURE__ */ __dil.jsx("text", {
				color: {
					light: "white",
					dark: "gray-50"
				},
				weight: "medium"
			}, failed ? labels.retry : labels.start))), message ? /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, message) : null, speech.error ? /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				color: "secondary"
			}, labels.playbackError) : null), isDebugAllowed && debugVisible ? /* @__PURE__ */ __dil.jsx("col", {
				gap: 1.5,
				padding: 3,
				radius: "lg",
				background: "surface-tertiary"
			}, /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				weight: "medium",
				color: "secondary"
			}, "Live transcript"), /* @__PURE__ */ __dil.jsx("text", {
				size: "sm",
				preserveWhitespace: true
			}, transcript || "No transcript yet.")) : null))
		});
	}
	function SuccessTransition({ succeeded, highlighting, children }) {
		const duration = succeeded && !highlighting ? SPEAKING_SUCCESS_FADE_MS : 0;
		return /* @__PURE__ */ __dil.jsx("transition", {
			preventInitialTransition: true,
			initial: { opacity: duration ? 0 : 1 },
			enter: {
				opacity: 1,
				duration,
				delay: 0,
				timingFunction: "ease-out"
			},
			exit: {
				opacity: 0,
				duration,
				delay: 0,
				timingFunction: "ease-out"
			},
			layoutEnter: { duration: 0 },
			layoutExit: { duration: 0 },
			layoutMove: { duration: 0 }
		}, /* @__PURE__ */ __dil.jsx("box", { key: highlighting ? "success-highlight" : "phrase" }, children));
	}
	function RecallPhrase({ parts, matched, wordColors, succeeded, failed, hiddenWord }) {
		const lines = [[]];
		parts.forEach((part, index) => {
			part.text.split(/\\r\\n|\\r|\\n/).forEach((text, line) => {
				if (line > 0) lines.push([]);
				if (text) lines[lines.length - 1].push({
					text,
					index
				});
			});
		});
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 1,
			padding: {
				x: 6,
				y: 4
			},
			radius: "full",
			background: succeeded || failed ? "surface-tertiary" : "transparent",
			border: succeeded || failed ? void 0 : {
				size: 1,
				color: "strong",
				style: "dashed"
			}
		}, lines.map((line, lineIndex) => /* @__PURE__ */ __dil.jsx("row", {
			key: lineIndex,
			wrap: "wrap",
			gap: 0,
			rowGap: 1,
			align: "center"
		}, line.length === 0 ? /* @__PURE__ */ __dil.jsx("box", { ariaHidden: true }, /* @__PURE__ */ __dil.jsx("text", {
			size: "xl",
			preserveWhitespace: true
		}, "\\xA0")) : line.map(({ text, index }) => parts[index].word && !succeeded && !failed && !matched[index] ? /* @__PURE__ */ __dil.jsx("box", {
			key: index,
			radius: "xs",
			background: {
				light: "gray-200",
				dark: "gray-600"
			},
			maxWidth: "100%",
			role: "img",
			ariaLabel: hiddenWord
		}, /* @__PURE__ */ __dil.jsx("box", { ariaHidden: true }, /* @__PURE__ */ __dil.jsx("text", {
			size: "xl",
			color: "transparent",
			preserveWhitespace: true
		}, text))) : /* @__PURE__ */ __dil.jsx("text", {
			key: index,
			size: "xl",
			inline: true,
			color: wordColors[index],
			preserveWhitespace: true
		}, text)))));
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
//#region LearningSpeakCard.dil.tsx
	function LearningSpeakCard(props) {
		const { state } = useResolvedComponentResult("LearningSpeakCard", props);
		if (state) return /* @__PURE__ */ __dil.jsx(LearningSpeakCard$1, state);
		if ("progressLabels" in props) return /* @__PURE__ */ __dil.jsx(LearningSpeakCard$1, props);
		return props.fallback ?? null;
	}

//#endregion
return LearningSpeakCard;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=learning-speak-card-26df3c0ac0ee.js.map