import{n as e}from"./rolldown-runtime-2d059c5e81f4.js";var t;function n(){return(n=e((()=>{t=`(() => {
var __dilDefaultExport = (function() {


//#region shared.dil.ts
	function hasImageSource(image) {
		return Boolean(image?.content_url || image?.thumbnail_url);
	}
	function imageKey(image) {
		return image?.content_url ?? image?.thumbnail_url ?? image?.url ?? "";
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
//#region ImageGrid.dil.tsx
	function ResolvedImageGrid({ state }) {
		const isLiveActivity = useIsLiveActivity();
		const [recommendationRowsToShow, setRecommendationRowsToShow] = DIL.useState(state.recommendation_rows_to_show ?? 1);
		const isSm = DIL.useBreakpoint("sm");
		DIL.useEffect(() => {
			setRecommendationRowsToShow(state.recommendation_rows_to_show ?? 1);
		}, [state.recommendation_rows_to_show]);
		const tiles = state.tiles?.length ? state.tiles : state.rows?.flatMap((row) => row.tiles) ?? [];
		if (isLiveActivity) {
			if (!tiles.length) return null;
			return /* @__PURE__ */ __dil.jsx("box", {
				width: "100%",
				height: 64,
				radius: "4xl",
				clip: true,
				background: "transparent",
				theme: "dark"
			}, /* @__PURE__ */ __dil.jsx("row", {
				width: "100%",
				height: 64,
				align: "stretch",
				gap: "2px"
			}, tiles.slice(0, 4).map((tile, index) => /* @__PURE__ */ __dil.jsx("box", {
				key: index,
				flex: 1,
				minWidth: 0,
				height: "100%",
				clip: true,
				background: "surface-secondary"
			}, /* @__PURE__ */ __dil.jsx("image", {
				src: tile.image.thumbnail_url ?? tile.image.url ?? tile.image.content_url ?? "",
				alt: tile.image.title ?? "",
				fit: "cover",
				width: "100%",
				height: "100%",
				hideOnFailure: true
			})))));
		}
		const galleryTiles = tiles.filter((tile) => hasImageSource(tile.image));
		const galleryImages = galleryTiles.map((tile) => tile.image);
		const resolvedRows = (state.rows ?? []).map((row) => ({ tiles: row.tiles.filter((tile) => hasImageSource(tile.image)) })).filter((row) => row.tiles.length > 0);
		const rows = resolvedRows.length ? resolvedRows : galleryTiles.length ? [{ tiles: galleryTiles }] : [];
		const displayGroups = [...state.is_loading ? [state.placeholder_rows ?? []] : [], ...rows.length ? [rows] : []];
		const recommendations = (state.recommendations ?? []).filter((recommendation) => hasImageSource(recommendation.thumbnail_image));
		const initialVisibleRecommendations = isSm ? 3 : 2;
		const visibleRecommendations = recommendationRowsToShow > 1 ? recommendations : recommendations.slice(0, initialVisibleRecommendations);
		if (!state.is_loading && !galleryTiles.length) return /* @__PURE__ */ __dil.jsx("box", { height: 0 });
		return /* @__PURE__ */ __dil.jsx("col", {
			gap: 4,
			maxWidth: "100%",
			width: 760
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, displayGroups.map((displayRows, groupIndex) => /* @__PURE__ */ __dil.jsx("box", {
			key: groupIndex,
			background: "surface-primary",
			clip: true,
			radius: "2xl",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("flow", {
			columns: 1,
			gap: "2px",
			layout: "pack"
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, displayRows.map((row, rowIndex) => /* @__PURE__ */ __dil.jsx("row", {
			align: "stretch",
			aspectRatio: state.row_aspect_ratio,
			gap: "2px",
			key: rowIndex,
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, row.tiles.map((tile, tileIndex) => /* @__PURE__ */ __dil.jsx("box", {
			ariaLabel: tile.image ? void 0 : "Loading image",
			aspectRatio: tile.aspect_ratio,
			background: tile.image ? "surface-secondary" : "surface-tertiary",
			clip: true,
			flex: tile.flex_grow ?? 1,
			height: "100%",
			key: tile.gallery_index ?? tileIndex,
			minWidth: 0,
			radius: "none",
			role: tile.image ? void 0 : "status"
		}, tile.image ? /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: tile.image?.title ? \`Open \${tile.image.title}\` : "Open image",
			background: "transparent",
			disabled: !tile.image,
			height: "100%",
			onClick: () => GenUI.openImageLightbox(galleryImages, galleryTiles.findIndex((galleryTile) => tile.gallery_index === void 0 ? imageKey(galleryTile.image) === imageKey(tile.image) : galleryTile.gallery_index === tile.gallery_index)),
			radius: "none",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("search-image", {
			alt: tile.image?.title ?? "",
			fit: "cover",
			height: "100%",
			hideOnFailure: true,
			radius: "none",
			searchImage: tile.image,
			width: "100%"
		})) : /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: "100%",
			background: "surface-tertiary"
		}))))))))))), state.is_loading && state.recommendations?.length ? /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			ariaLabel: "Image search follow-ups",
			gap: 2,
			role: "list",
			width: "100%",
			wrap: "wrap"
		}, /* @__PURE__ */ __dil.jsx(__dil.Fragment, null, state.recommendations.slice(0, initialVisibleRecommendations).map((recommendation, index) => /* @__PURE__ */ __dil.jsx("box", {
			background: "surface-secondary",
			clip: true,
			flex: "0 1 auto",
			height: 40,
			key: \`\${recommendation.query}:\${index}\`,
			padding: {
				bottom: 2,
				left: 2,
				right: 4,
				top: 2
			},
			radius: "full",
			width: 156
		}, /* @__PURE__ */ __dil.jsx("box", {
			width: "100%",
			height: "100%",
			radius: "xl",
			clip: true
		}, /* @__PURE__ */ __dil.jsx("loading-block", {
			width: "100%",
			height: "100%",
			background: "surface-tertiary"
		})))))) : null, !state.is_loading && recommendations.length ? /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			ariaLabel: "Image search follow-ups",
			gap: 2,
			role: "list",
			width: "100%",
			wrap: "wrap"
		}, [...visibleRecommendations.map((recommendation, index) => /* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: recommendation.title,
			border: {
				color: "default",
				size: 1
			},
			clip: true,
			flex: "0 1 auto",
			height: 40,
			key: \`\${recommendation.query}:\${index}\`,
			onClick: () => GenUI.issueNewTurn(\`search images of \${recommendation.query}\`, { append_to_current_leaf: true }),
			padding: {
				bottom: 2,
				left: 2,
				right: 4,
				top: 2
			},
			radius: "full",
			width: "fit-content"
		}, /* @__PURE__ */ __dil.jsx("row", {
			align: "center",
			gap: 2,
			height: "100%",
			width: "100%"
		}, /* @__PURE__ */ __dil.jsx("search-image", {
			alt: recommendation.title,
			fit: "cover",
			height: 24,
			hideOnFailure: true,
			radius: "full",
			searchImage: recommendation.thumbnail_image,
			width: 24
		}), /* @__PURE__ */ __dil.jsx("box", {
			maxWidth: 200,
			minWidth: 0
		}, /* @__PURE__ */ __dil.jsx("text", {
			maxLines: 1,
			size: "sm",
			truncate: true,
			weight: "normal"
		}, recommendation.title))))), ...recommendations.length > initialVisibleRecommendations ? [/* @__PURE__ */ __dil.jsx("pressable", {
			ariaLabel: recommendationRowsToShow > 1 ? "Show fewer image search follow-ups" : "Show more image search follow-ups",
			background: "surface-secondary",
			border: {
				color: "default",
				size: 1
			},
			clip: true,
			flex: "0 1 auto",
			height: 40,
			key: "image-grid-recommendation-toggle",
			minWidth: 72,
			onClick: () => setRecommendationRowsToShow(recommendationRowsToShow > 1 ? 1 : recommendations.length + 1),
			padding: {
				bottom: 2,
				left: 4,
				right: 4,
				top: 2
			},
			radius: "full",
			width: "fit-content"
		}, /* @__PURE__ */ __dil.jsx("text", {
			maxLines: 1,
			size: "sm",
			truncate: true,
			weight: "normal"
		}, recommendationRowsToShow > 1 ? "Fewer" : "More"))] : []]) : null);
	}
	function ImageGrid(props) {
		const { resolutionComplete, state } = useResolvedComponentResult("ImageGrid", props);
		if (!state) return resolutionComplete ? props.fallback ?? /* @__PURE__ */ __dil.jsx("box", { height: 0 }) : /* @__PURE__ */ __dil.jsx("loading", { label: "Loading images" });
		return /* @__PURE__ */ __dil.jsx(ResolvedImageGrid, { state });
	}

//#endregion
return ImageGrid;
})();
return __dilDefaultExport;
})()`})))()}n();export{t as componentSource};
//# sourceMappingURL=image-grid-db5350df9968.js.map