window.__ModuleLoader__.load({
	id: "dsh-sketchpad",
	factory: (require) => {
		const React = require("react");
		const { createPortal } = require("react-dom");
		const h = React.createElement;
		const { Fragment } = React;
		const { useSyncExternalStore, useEffect, useMemo, useRef, useState } = React;

		/** 插件自己的根 Context；组件用它按需取服务（conversation / sidebarRight）。 */
		let clientCtx = null;
		const EMPTY_IDS = Object.freeze([]);

		function service(name) {
			if (clientCtx === null) return undefined;
			try {
				return clientCtx.get(name);
			} catch (error) {
				return undefined;
			}
		}

		/* ------------------------------------------------------------------ *
		 * 常量
		 * ------------------------------------------------------------------ */

		/** 右侧栏 tab 类型 id，同时也是 kind。 */
		const TAB_ID = "dsh-sketchpad";
		/**
		 * 两块画板，按打开方式分开：
		 * - float：铅笔按钮/放大弹窗，默认横版 1600x1000（约 160 万像素，在视觉模型预算内）；
		 * - pane：右侧栏停靠页，默认竖版 1000x1333，适合窄栏。
		 * 两块画板内容独立，各自挂自己的附件。
		 */
		const SURFACES = {
			float: { id: "float", width: 1600, height: 1000, widthScale: 1, liveName: "画板-浮动.png", prefix: "画板-浮动-" },
			pane: { id: "pane", width: 1000, height: 1333, widthScale: 1.45, liveName: "画板-侧栏.png", prefix: "画板-侧栏-" },
		};
		/** 三档笔宽（内部像素）。浮动窗口里约 0.6 倍显示，对应 2.4/4.2/7 CSS 像素。 */
		const STROKE_WIDTH = { thin: 4, normal: 7, thick: 12 };
		const WEIGHT_ORDER = ["thin", "normal", "thick"];
		/** 橡皮宽度相对笔宽的倍数。 */
		const ERASER_SCALE = 4;
		/** 导出时在笔画包围盒外留的白边（内部像素）。 */
		const CROP_PADDING = 26;
		/** 墨色：不用纯黑，导出并被视觉模型缩放后边缘更稳。 */
		const PALETTE = [
			{ id: "ink", value: "#101010", labelKey: "inkBlack" },
			{ id: "red", value: "#c0392b", labelKey: "inkRed" },
			{ id: "blue", value: "#1f5fbf", labelKey: "inkBlue" },
		];
		const DEFAULT_INK = PALETTE[0].value;
		const PREFS_KEY = "dsh-sketchpad.prefs.v1";

		/**
		 * 界面文案。宿主切界面语言时会同步 <html lang>，所以每次渲染都重新取一次；
		 * 除中文外一律用英文（本插件原来的文案只有中文）。
		 */
		const STRINGS = {
			zh: {
				board: "画板",
				collapseBoard: "收起画板",
				noSession: "未选择会话，画板不可用。",
				emptyHint: "空白画板 · 按住鼠标拖动书写",
				tools: "画板工具",
				pen: "水笔 (B)",
				line: "直线 (L)；按住 Shift 吸附 0/45/90 度",
				arrow: "箭头 (A)；按住 Shift 吸附 0/45/90 度",
				eraser: "橡皮 (E)",
				thin: "细笔 ([)",
				normal: "中笔",
				thick: "粗笔 (])",
				inkGroup: "笔色",
				inkBlack: "黑色",
				inkRed: "红色",
				inkBlue: "蓝色",
				undo: "撤销上一笔 (Ctrl/Cmd+Z)",
				redo: "重做 (Ctrl/Cmd+Shift+Z)",
				clearBoard: "清空画板",
				clear: "清空",
				insertAndClose: "插入到输入框并关闭画板",
				insert: "插入",
				insertToComposer: "插入到输入框",
				attachFailed: "创建附件失败",
				submittingRetry: "输入框正在提交，稍后会自动重试",
				sendingLater: "正在发送，稍后再插入",
				submittingLater: "输入框正在提交，稍后再插入",
				inserted: "已插入到输入框",
				guideDesc: "手写或画示意图，随消息一起发送",
				menuLabel: "画板",
				menuDesc: "打开画板，画完把图片挂到这条消息上",
			},
			en: {
				board: "Sketchpad",
				collapseBoard: "Collapse sketchpad",
				noSession: "No active session — the sketchpad is unavailable.",
				emptyHint: "Empty canvas · drag to draw",
				tools: "Sketchpad tools",
				pen: "Pen (B)",
				line: "Line (L); hold Shift to snap 0/45/90°",
				arrow: "Arrow (A); hold Shift to snap 0/45/90°",
				eraser: "Eraser (E)",
				thin: "Thin ([)",
				normal: "Medium",
				thick: "Thick (])",
				inkGroup: "Ink",
				inkBlack: "Black",
				inkRed: "Red",
				inkBlue: "Blue",
				undo: "Undo (Ctrl/Cmd+Z)",
				redo: "Redo (Ctrl/Cmd+Shift+Z)",
				clearBoard: "Clear canvas",
				clear: "Clear",
				insertAndClose: "Insert into the composer and close",
				insert: "Insert",
				insertToComposer: "Insert into composer",
				attachFailed: "Could not create the attachment",
				submittingRetry: "The composer is submitting; this retries automatically",
				sendingLater: "Sending — insert again in a moment",
				submittingLater: "Composer is submitting — try again in a moment",
				inserted: "Inserted into the composer",
				guideDesc: "Write or diagram by hand, then send it with your message",
				menuLabel: "Sketchpad",
				menuDesc: "Open the sketchpad and attach the drawing to your message",
			},
		};

		function prefersChinese() {
			try {
				const lang = (document.documentElement.getAttribute("lang") || "").toLowerCase();
				if (lang) return lang.indexOf("zh") === 0;
			} catch (error) { /* ignore */ }
			try {
				return String(navigator.language || "").toLowerCase().indexOf("zh") === 0;
			} catch (error) {
				return true;
			}
		}

		function t(key) {
			const table = STRINGS[prefersChinese() ? "zh" : "en"];
			return table[key] ?? STRINGS.zh[key] ?? key;
		}

		/* ------------------------------------------------------------------ *
		 * 样式
		 * ------------------------------------------------------------------ */

		const CSS = `
.dsh-sketchpad-pane{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;padding:10px 12px 12px;gap:8px;color:var(--dsw-alias-label-primary,#1a1a1a);font-size:13px;line-height:1.4}
.dsh-sketchpad-toolbar{display:flex;align-items:center;gap:3px;flex-wrap:wrap;flex:none}
.dsh-sketchpad-tool{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 3px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);font:inherit;font-size:12px;cursor:pointer;flex:none}
.dsh-sketchpad-tool:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#111)}
.dsh-sketchpad-tool[data-on="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 14%,transparent);color:var(--dsw-alias-label-primary,#111);box-shadow:none}
.dsh-sketchpad-tool:disabled{opacity:.4;cursor:default;background:transparent}
.dsh-sketchpad-sep{width:1px;height:18px;margin:0 3px;background:var(--dsw-alias-border-l3,#e3e3e3);flex:none}
.dsh-sketchpad-swatch{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);cursor:pointer;flex:none;border-radius:8px}
.dsh-sketchpad-swatch:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dsh-sketchpad-swatch[data-on="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 14%,transparent)}
.dsh-sketchpad-swatch:focus-visible{outline:2px solid var(--dsw-alias-label-primary,#111);outline-offset:1px}
.dsh-sketchpad-eraser{position:absolute;left:0;top:0;z-index:3;display:none;pointer-events:none;overflow:visible}
.dsh-sketchpad-swatches{display:inline-flex;align-items:center;gap:4px;flex:none}
.dsh-sketchpad-stage{flex:1 1 auto;min-height:120px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.dsh-sketchpad-frame{position:relative;display:inline-block;line-height:0;max-width:100%;max-height:100%}
.dsh-sketchpad-canvas{display:block;background:#fff;border:1px solid var(--dsw-alias-border-l3,#dcdcdc);border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);touch-action:none;cursor:crosshair;max-width:100%;max-height:100%;outline:none}
.dsh-sketchpad-overlay{position:absolute;left:0;top:0;width:100%;height:100%;border-radius:10px;pointer-events:none}
.dsh-sketchpad-canvas-status{position:absolute;left:10px;bottom:8px;z-index:2;display:flex;align-items:center;gap:6px;max-width:calc(100% - 20px);padding:3px 9px;border-radius:999px;background:rgba(0,0,0,.055);font-size:11px;line-height:1.4;color:rgba(0,0,0,.5);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:none}
.dsh-sketchpad-canvas-status[data-s="error"]{background:rgba(190,50,50,.08);color:rgba(160,40,40,.85)}
.dsh-sketchpad-canvas-status[data-s="error"] .dsh-sketchpad-dot{background:#d04444}
.dsh-sketchpad-dot{width:6px;height:6px;border-radius:50%;background:#3a9d63;flex:none}
.dsh-sketchpad-dot[data-s="idle"]{background:#b9b9b9}
.dsh-sketchpad-dot[data-s="dirty"]{background:#c99a2e}
.dsh-sketchpad-dot[data-s="saving"]{background:#c99a2e}
.dsh-sketchpad-dot[data-s="attaching"]{background:#c99a2e}
.dsh-sketchpad-dot[data-s="detached"]{background:#c99a2e}
.dsh-sketchpad-dot[data-s="error"]{background:#d04444}
.dsh-sketchpad-actions{flex:none;display:flex;gap:8px;align-items:center}
.dsh-sketchpad-btn{display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l3,#dcdcdc);border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;cursor:pointer;flex:1 1 0}
.dsh-sketchpad-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsh-sketchpad-btn:disabled{opacity:.45;cursor:default}
.dsh-sketchpad-btn-primary{border-color:transparent;background:var(--dsw-alias-label-primary,#1a1a1a);color:var(--dsw-alias-bg-layer-1,#fff);font-weight:600}
.dsh-sketchpad-btn-primary:hover:not(:disabled){background:var(--dsw-alias-label-primary,#1a1a1a);opacity:.88}
.dsh-sketchpad-action{display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 10px;border:1px solid var(--dsw-alias-border-l3,#dcdcdc);border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;cursor:pointer;flex:none;white-space:nowrap}
.dsh-sketchpad-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dsh-sketchpad-action:disabled{opacity:.45;cursor:default}
/* 清空：和「插入/发送」同一种胶囊；有笔画时变红（描边+文字），空画板时置灰。 */
.dsh-sketchpad-clear{display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 10px;border:1px solid transparent;border-radius:999px;background:rgba(127,127,127,.10);color:var(--dsw-alias-label-secondary,#6b6b6b);font:inherit;font-size:12px;line-height:1;cursor:pointer;flex:none;white-space:nowrap;transition:color .12s,border-color .12s,background .12s}
.dsh-sketchpad-clear:hover:not(:disabled){background:rgba(127,127,127,.18)}
.dsh-sketchpad-clear[data-armed="true"]{border-color:rgba(192,57,43,.55);color:#c0392b}
.dsh-sketchpad-clear[data-armed="true"]:hover{border-color:rgba(192,57,43,.8);background:rgba(127,127,127,.14)}
.dsh-sketchpad-clear:disabled{opacity:.45;cursor:default}
.dsh-sketchpad-clear:focus-visible{outline:2px solid var(--dsw-alias-label-primary,#111);outline-offset:1px}
.dsh-sketchpad-action-primary{border-color:transparent;background:var(--dsw-alias-label-primary,#1a1a1a);color:var(--dsw-alias-bg-layer-1,#fff);font-weight:600}
.dsh-sketchpad-action-primary:hover:not(:disabled){opacity:.88;background:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-sketchpad-float{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:48px 32px 28px;background:rgba(0,0,0,.45)}
.dsh-sketchpad-float-panel{position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:min(1040px,calc(100vw - 64px),calc((100vh - 160px) * 1.6 + 24px));height:auto;padding:10px 12px 12px;gap:6px;border:1px solid var(--dsw-alias-border-l3,#dcdcdc);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 18px 60px rgba(0,0,0,.35)}
.dsh-sketchpad-float-close{position:absolute;right:10px;top:10px;z-index:2;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);font-size:16px;line-height:1;cursor:pointer}
.dsh-sketchpad-float-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#111)}
.dsh-sketchpad-float .dsh-sketchpad-pane{padding:0;gap:6px}
.dsh-sketchpad-float .dsh-sketchpad-stage{flex:none;min-height:0}
.dsh-sketchpad-float .dsh-sketchpad-canvas{width:100%;height:auto;max-height:none}
.dsh-sketchpad-float .dsh-sketchpad-toolbar,.dsh-sketchpad-float .dsh-sketchpad-actions,.dsh-sketchpad-pane .dsh-sketchpad-toolbar,.dsh-sketchpad-pane .dsh-sketchpad-actions{width:100%;box-sizing:border-box}
`;

		let styleInjected = false;
		function ensureStyle() {
			if (styleInjected || typeof document === "undefined") return;
			styleInjected = true;
			if (document.querySelector("style[data-dsh-sketchpad]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.dshDraw = "";
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/* ------------------------------------------------------------------ *
		 * 画板状态（按 Session 分开，模块级保存，关掉右侧栏也不丢）
		 * ------------------------------------------------------------------ */

		/**
		 * 每块画板：strokes 是已完成笔画，snapshot 是最近一次的 PNG dataURL。
		 * liveId 是“当前画板”在输入框里对应的附件 id，由 composer bridge 维护。
		 */
		const boards = new Map();

		function createBoard() {
			let state = {
				strokes: [],
				redo: [],
				revision: 0,
				snapshot: null,
				liveId: null,
				syncedRevision: -1,
				detached: false,
				insertSeq: 0,
				saveSeq: 0,
				saveRevision: 0,
				clearSeq: 0,
				status: "idle",
				message: "",
			};
			const listeners = new Set();
			return {
				get() {
					return state;
				},
				set(patch) {
					state = Object.assign({}, state, patch);
					for (const listener of Array.from(listeners)) {
						try {
							listener();
						} catch (error) {
							console.error("dsh-sketchpad: board listener failed", error);
						}
					}
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
			};
		}

		function boardFor(sessionId, surface) {
			const key = `${sessionId}::${surface}`;
			let board = boards.get(key);
			if (board === undefined) {
				board = createBoard();
				boards.set(key, board);
			}
			return board;
		}

		/* ------------------------------------------------------------------ *
		 * 工具偏好：跨会话、跨画板共享；颜色和粗细记忆到 localStorage
		 * ------------------------------------------------------------------ */

		function loadPrefs() {
			const prefs = { tool: "pen", color: DEFAULT_INK, weight: "normal" };
			try {
				const raw = window.localStorage.getItem(PREFS_KEY);
				if (raw !== null) {
					const parsed = JSON.parse(raw);
					if (WEIGHT_ORDER.indexOf(parsed?.weight) !== -1) prefs.weight = parsed.weight;
					if (parsed?.color === PALETTE[0].value || parsed?.color === PALETTE[1].value || parsed?.color === PALETTE[2].value) prefs.color = parsed.color;
				}
			} catch (error) {
				/* 隐私模式/禁用存储时退回默认值。 */
			}
			return prefs;
		}

		function createPrefsStore() {
			let state = loadPrefs();
			const listeners = new Set();
			return {
				get() {
					return state;
				},
				set(patch) {
					const next = Object.assign({}, state, patch);
					if (next.color === state.color && next.weight === state.weight && next.tool === state.tool) return;
					state = next;
					try {
						window.localStorage.setItem(PREFS_KEY, JSON.stringify({ color: state.color, weight: state.weight }));
					} catch (error) {
						/* 存不下就算了，不影响当前会话。 */
					}
					for (const listener of Array.from(listeners)) {
						try {
							listener();
						} catch (error) {
							console.error("dsh-sketchpad: prefs listener failed", error);
						}
					}
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
			};
		}

		const prefsStore = createPrefsStore();

		/* ------------------------------------------------------------------ *
		 * 图片与附件工具
		 * ------------------------------------------------------------------ */

		function two(value) {
			return value < 10 ? "0" + value : String(value);
		}

		function stamp() {
			const now = new Date();
			return (
				String(now.getFullYear()) +
				two(now.getMonth() + 1) +
				two(now.getDate()) +
				"-" +
				two(now.getHours()) +
				two(now.getMinutes()) +
				two(now.getSeconds())
			);
		}

		function liveFileName(spec) {
			return spec.liveName;
		}

		function frozenFileName(spec) {
			return spec.prefix + stamp() + ".png";
		}

		/** dataURL -> File，同步完成，保证点击发送前附件已挂上。 */
		function fileFromDataUrl(dataUrl, name) {
			const comma = dataUrl.indexOf(",");
			const meta = dataUrl.slice(0, comma);
			const payload = dataUrl.slice(comma + 1);
			const mime = /data:([^;]+)/.exec(meta);
			const binary = atob(payload);
			const bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) {
				bytes[index] = binary.charCodeAt(index);
			}
			return new File([bytes], name, { type: mime === null ? "image/png" : mime[1] });
		}

		function release(conversation, id) {
			try {
				conversation.releaseDraftAttachment?.(id);
			} catch (error) {
				console.warn("dsh-sketchpad: release draft attachment failed", error);
			}
		}

		function describeError(error) {
			if (error instanceof Error && error.message !== "") return error.message;
			return String(error);
		}

		/* ------------------------------------------------------------------ *
		 * 画布绘制
		 * ------------------------------------------------------------------ */

		function setInk(context, stroke) {
			context.strokeStyle = stroke.color;
			context.fillStyle = stroke.color;
			context.lineWidth = stroke.width;
			context.lineCap = "round";
			context.lineJoin = "round";
		}

		/** 箭头两条倒刺；短线段自动收小，避免变成一坨。 */
		function paintArrowHead(context, from, to, width) {
			const dx = to[0] - from[0];
			const dy = to[1] - from[1];
			const length = Math.hypot(dx, dy);
			if (length < 8) return;
			const angle = Math.atan2(dy, dx);
			const head = Math.min(length * 0.42, Math.max(16, width * 3));
			const spread = Math.PI / 7;
			context.beginPath();
			context.moveTo(to[0] - head * Math.cos(angle - spread), to[1] - head * Math.sin(angle - spread));
			context.lineTo(to[0], to[1]);
			context.lineTo(to[0] - head * Math.cos(angle + spread), to[1] - head * Math.sin(angle + spread));
			context.stroke();
		}

		function paintStroke(context, stroke) {
			const points = stroke.points;
			if (points.length === 0) return;
			setInk(context, stroke);
			if (stroke.kind === "line" || stroke.kind === "arrow") {
				const from = points[0];
				const to = points[points.length - 1];
				context.beginPath();
				context.moveTo(from[0], from[1]);
				context.lineTo(to[0], to[1]);
				context.stroke();
				if (stroke.kind === "arrow") paintArrowHead(context, from, to, stroke.width);
				return;
			}
			if (points.length === 1) {
				context.beginPath();
				context.arc(points[0][0], points[0][1], stroke.width / 2, 0, Math.PI * 2);
				context.fill();
				return;
			}
			context.beginPath();
			context.moveTo(points[0][0], points[0][1]);
			for (let index = 1; index < points.length; index += 1) {
				context.lineTo(points[index][0], points[index][1]);
			}
			context.stroke();
		}

		function paintBoard(canvas, strokes) {
			if (canvas === null) return;
			const context = canvas.getContext("2d");
			if (context === null) return;
			context.fillStyle = "#ffffff";
			context.fillRect(0, 0, canvas.width, canvas.height);
			for (const stroke of strokes) paintStroke(context, stroke);
		}

		function segment(context, from, to, stroke) {
			setInk(context, stroke);
			context.beginPath();
			context.moveTo(from[0], from[1]);
			context.lineTo(to[0], to[1]);
			context.stroke();
		}

		function clearCanvas(canvas) {
			const context = canvas === null ? null : canvas.getContext("2d");
			if (context !== null) context.clearRect(0, 0, canvas.width, canvas.height);
		}

		/**
		 * 有笔画内容的包围盒（画布坐标）。白色笔迹是橡皮，不参与包围盒，
		 * 否则擦除后的空白会把裁切区域撑大。箭头末尾的倒刺按箭头头部尺寸放宽。
		 */
		function inkBounds(strokes) {
			let minX = Number.POSITIVE_INFINITY;
			let minY = Number.POSITIVE_INFINITY;
			let maxX = Number.NEGATIVE_INFINITY;
			let maxY = Number.NEGATIVE_INFINITY;
			for (const stroke of strokes) {
				if (stroke.color === "#ffffff" || stroke.points.length === 0) continue;
				const slack = stroke.kind === "arrow" ? Math.max(16, stroke.width * 3) : stroke.width / 2 + 1;
				for (const point of stroke.points) {
					minX = Math.min(minX, point[0] - slack);
					minY = Math.min(minY, point[1] - slack);
					maxX = Math.max(maxX, point[0] + slack);
					maxY = Math.max(maxY, point[1] + slack);
				}
			}
			if (!Number.isFinite(minX)) return null;
			return { minX, minY, maxX, maxY };
		}

		/** Shift 直线：接近 0/45/90 度时吸附，方便画坐标轴。 */
		function snapAngle(start, end, surface) {
			const dx = end[0] - start[0];
			const dy = end[1] - start[1];
			const length = Math.hypot(dx, dy);
			if (length < 2) return end;
			const angle = Math.atan2(dy, dx);
			const step = Math.PI / 4;
			const snapped = Math.round(angle / step) * step;
			if (Math.abs(angle - snapped) > (8 * Math.PI) / 180) return end;
			return [
				Math.min(surface.width, Math.max(0, start[0] + Math.cos(snapped) * length)),
				Math.min(surface.height, Math.max(0, start[1] + Math.sin(snapped) * length)),
			];
		}

		/* ------------------------------------------------------------------ *
		 * 画板 UI
		 * ------------------------------------------------------------------ */

		function DrawPane(props) {
			const { sessionId } = props;
			if (typeof sessionId !== "string") {
				return h("div", { className: "dsh-sketchpad-pane" }, t("noSession"));
			}
			return h(BoardView, { sessionId, surface: "pane" });
		}

		/** 居中的浮动画板窗口（铅笔按钮的默认打开方式，横版）。 */
		function BoardWindow(props) {
			const { sessionId, onClose } = props;
			const apiRef = useRef(null);
			/* 关闭浮窗 = 明确的保存点：先把当前画面编码挂到输入框，再关闭。 */
			function closeBoard() {
				try {
					apiRef.current?.save();
				} catch (error) {
					console.warn("dsh-sketchpad: save on close failed", error);
				}
				onClose();
			}
			/* Esc 挂在 window 上：打开浮窗后焦点可能还停在铅笔按钮上（不在画板里）。 */
			const closeRef = useRef(closeBoard);
			closeRef.current = closeBoard;
			useEffect(() => {
				function onKey(event) {
					if (event.key !== "Escape") return;
					event.preventDefault();
					event.stopPropagation();
					closeRef.current();
				}
				window.addEventListener("keydown", onKey, true);
				return () => window.removeEventListener("keydown", onKey, true);
			}, []);
			return createPortal(
				h(
					"div",
					{
						className: "dsh-sketchpad-float",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": t("board"),
						onMouseDown: (event) => {
							if (event.target === event.currentTarget) closeBoard();
						},
					},
					h(
						"div",
						{
							className: "dsh-sketchpad-float-panel",
							onDoubleClick: (event) => {
								const target = event.target;
								if (target instanceof Element && target.closest("button, canvas, input, textarea, select") !== null) return;
								closeBoard();
							},
						},
						h(
							"button",
							{
								type: "button",
								className: "dsh-sketchpad-float-close",
								"aria-label": t("collapseBoard"),
								onClick: closeBoard,
							},
							"×",
						),
						h(BoardView, {
							sessionId,
							surface: "float",
							floating: true,
							onClose: closeBoard,
							onCloseWithoutSave: onClose,
							apiRef,
						}),
					),
				),
				document.body,
			);
		}

		/** 工具条上的图标按钮：只用黑白线条（currentColor），不依赖 emoji。 */
		function Glyph(props) {
			return h(
				"svg",
				{
					viewBox: "0 0 24 24",
					width: 17,
					height: 17,
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.7,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": "true",
				},
				props.children,
			);
		}

		const GLYPHS = {
			pen: () =>
				h(Glyph, null, h("path", { d: "M4 20l1.1-4.1L16.3 4.7a2.1 2.1 0 0 1 3 3L8.1 18.9 4 20z" }), h("path", { d: "M14.4 6.6l3 3" })),
			line: () =>
				h(
					Glyph,
					null,
					h("path", { d: "M5.5 18.5L18.5 5.5" }),
					h("circle", { cx: 5.5, cy: 18.5, r: 1.6, fill: "currentColor", stroke: "none" }),
					h("circle", { cx: 18.5, cy: 5.5, r: 1.6, fill: "currentColor", stroke: "none" }),
				),
			arrow: () => h(Glyph, null, h("path", { d: "M5 19L19 5" }), h("path", { d: "M12.8 5.3L19 5l-.3 6.2" })),
			eraser: () =>
				h(
					Glyph,
					null,
					h("path", { d: "M14.8 4.6l4.6 4.6-8.8 8.8H5.4l-1.9-1.9L14.8 4.6z" }),
					h("path", { d: "M9.2 8.2l6.6 6.6" }),
					h("path", { d: "M12 18h8" }),
				),
			/* 这两条路径原本画在 y=7..22，视觉重心比 24 视框中线低 2.5，
			   和同一行的图标对不齐；整体上移 2.5 让包围盒落在 4.5..19.5。 */
			undo: () => h(Glyph, null, h("path", { d: "M9 4.5L4 9.5l5 5" }), h("path", { d: "M4 9.5h9a5 5 0 0 1 0 10h-3" })),
			redo: () => h(Glyph, null, h("path", { d: "M15 4.5l5 5-5 5" }), h("path", { d: "M20 9.5h-9a5 5 0 0 0 0 10h3" })),
		};

		function IconButton(props) {
			const { on, glyph, title, disabled, onClick } = props;
			return h(
				"button",
				{
					type: "button",
					className: "dsh-sketchpad-tool",
					"data-on": on ? "true" : "false",
					title,
					"aria-label": title,
					"aria-pressed": on ? "true" : "false",
					disabled,
					onClick,
				},
				h(GLYPHS[glyph]),
			);
		}

		/** 笔宽用实心圆示意：圆越大笔越粗。 */
		function WidthButton(props) {
			const { on, pixels, title, onClick } = props;
			return h(
				"button",
				{
					type: "button",
					className: "dsh-sketchpad-tool",
					"data-on": on ? "true" : "false",
					title,
					"aria-label": title,
					"aria-pressed": on ? "true" : "false",
					onClick,
				},
				h(
					"svg",
					{ width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": "true" },
					h("circle", { cx: 8, cy: 8, r: pixels / 2, fill: "currentColor" }),
				),
			);
		}

		function BoardView(props) {
			const { sessionId, surface = "pane", floating = false, onClose, onCloseWithoutSave, apiRef } = props;
			const spec = SURFACES[surface] ?? SURFACES.pane;
			const board = useMemo(() => boardFor(sessionId, surface), [sessionId, surface]);
			const state = useSyncExternalStore(board.subscribe, board.get, board.get);
			const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.get, prefsStore.get);

			const canvasRef = useRef(null);
			const overlayRef = useRef(null);
			const ringRef = useRef(null);
			const stageRef = useRef(null);
			const contextRef = useRef(null);
			const overlayContextRef = useRef(null);
			const draftRef = useRef(null);
			/** 起笔时缓存画布矩形：pointermove 的高频采样不再反复触发布局。 */
			const rectRef = useRef(null);
			/** 同一时刻只跟一个触点：多指同时按会把两路采样混进同一条笔画（连续折线）。 */
			const activePointerRef = useRef(null);

			const weight = prefs.weight;
			const color = prefs.color;
			const tool = prefs.tool;

			/* 主画布/预览画布的 2D context 只取一次，避免 pointermove 里反复 getContext。 */
			useEffect(() => {
				if (canvasRef.current !== null) contextRef.current = canvasRef.current.getContext("2d");
				if (overlayRef.current !== null) overlayContextRef.current = overlayRef.current.getContext("2d");
			}, []);

			/* 浮窗打开时把焦点交给画布：快捷键和 Esc 不用先点一下画布才生效。 */
			useEffect(() => {
				if (!floating) return;
				canvasRef.current?.focus({ preventScroll: true });
			}, [floating]);

			/* 把「保存当前画面」暴露给浮窗外壳，关闭时先保存再关。 */
			const saveRef = useRef(null);
			saveRef.current = save;
			useEffect(() => {
				if (apiRef === undefined || apiRef === null) return undefined;
				apiRef.current = { save: () => saveRef.current?.() };
				return () => {
					apiRef.current = null;
				};
			}, [apiRef]);

			/* 换工具/粗细时先收起橡皮圈，等指针再移动时按新尺寸出现。 */
			useEffect(() => {
				if (ringRef.current !== null) ringRef.current.style.display = "none";
			}, [tool, weight]);

			/* 画板尺寸：内部按 surface 固定，CSS 等比缩到可用区域。 */
			useEffect(() => {
				const stage = stageRef.current;
				const canvas = canvasRef.current;
				if (stage === null || canvas === null) return undefined;
				const fit = () => {
					const rect = stage.getBoundingClientRect();
					const availableWidth = Math.max(80, rect.width - 2);
					const availableHeight = Math.max(80, rect.height - 2);
					const maxWidth = floating ? 1400 : Number.POSITIVE_INFINITY;
					const scale = Math.min(availableWidth / spec.width, availableHeight / spec.height, maxWidth / spec.width);
					canvas.style.width = Math.round(spec.width * scale) + "px";
					canvas.style.height = Math.round(spec.height * scale) + "px";
				};
				fit();
				if (typeof ResizeObserver !== "function") return undefined;
				const observer = new ResizeObserver(fit);
				observer.observe(stage);
				return () => observer.disconnect();
			}, [floating, spec]);

			/* 已提交笔画变化（撤销、清空、发送后清空）时整块重绘。 */
			useEffect(() => {
				paintBoard(canvasRef.current, state.strokes);
				clearCanvas(overlayRef.current);
			}, [state.strokes]);

			function pointOf(event) {
				const canvas = canvasRef.current;
				if (canvas === null) return null;
				const rect = rectRef.current ?? canvas.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return null;
				const x = ((event.clientX - rect.left) * spec.width) / rect.width;
				const y = ((event.clientY - rect.top) * spec.height) / rect.height;
				return [Math.min(spec.width, Math.max(0, x)), Math.min(spec.height, Math.max(0, y))];
			}

			function commitStroke(stroke) {
				/* 抬笔只记笔画，不编码、不碰输入框；保存发生在关闭/插入/发送时。 */
				board.set({
					strokes: board.get().strokes.concat([stroke]),
					redo: [],
					revision: board.get().revision + 1,
					detached: false,
					status: "dirty",
					message: "",
				});
			}

			function renderPreview(start, end, style, kind) {
				const overlay = overlayRef.current;
				const context = overlayContextRef.current;
				if (overlay === null || context === null) return;
				context.clearRect(0, 0, overlay.width, overlay.height);
				paintStroke(context, {
					kind,
					points: [start, end],
					color: style.color,
					width: style.width,
				});
			}

			/** 橡皮的圆形光标：跟随指针，直径就是实际擦除直径。 */
			function hideRing() {
				if (ringRef.current !== null) ringRef.current.style.display = "none";
			}

			function updateRing(event) {
				const canvas = canvasRef.current;
				const ring = ringRef.current;
				if (canvas === null || ring === null) return;
				if (prefsStore.get().tool !== "eraser") {
					ring.style.display = "none";
					return;
				}
				const rect = draftRef.current === null ? canvas.getBoundingClientRect() : (rectRef.current ?? canvas.getBoundingClientRect());
				const x = event.clientX - rect.left;
				const y = event.clientY - rect.top;
				if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
					ring.style.display = "none";
					return;
				}
				const internal = STROKE_WIDTH[prefsStore.get().weight] * spec.widthScale * ERASER_SCALE;
				const size = Math.max(6, internal * (rect.width / spec.width));
				ring.style.width = size.toFixed(1) + "px";
				ring.style.height = size.toFixed(1) + "px";
				ring.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
				ring.style.display = "block";
			}

			function onPointerDown(event) {
				if (event.button !== 0) return;
				if (draftRef.current !== null || activePointerRef.current !== null) return;
				const point = pointOf(event);
				if (point === null) return;
				activePointerRef.current = event.pointerId;
				event.preventDefault();
				const canvas = canvasRef.current;
				try {
					rectRef.current = canvas.getBoundingClientRect();
					canvas.focus({ preventScroll: true });
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch (error) {
					/* 指针捕获只是顺滑度的增强，失败不影响画。 */
				}
				updateRing(event);
				const base = STROKE_WIDTH[weight] * spec.widthScale;
				const erasing = tool === "eraser";
				const styling = {
					width: erasing ? base * ERASER_SCALE : base,
					color: erasing ? "#ffffff" : color,
				};
				const isShape = tool === "line" || tool === "arrow";
				const straight = isShape || event.shiftKey;
				const draft = {
					start: point,
					last: point,
					points: [point],
					width: styling.width,
					color: styling.color,
					kind: isShape ? tool : straight ? "line" : "pen",
					shape: isShape,
					straight,
					snap: event.shiftKey,
					moved: false,
				};
				draftRef.current = draft;
				if (draft.kind === "pen") {
					const context = contextRef.current;
					if (context !== null) {
						setInk(context, draft);
						context.beginPath();
						context.arc(point[0], point[1], draft.width / 2, 0, Math.PI * 2);
						context.fill();
					}
				}
			}

			function onPointerMove(event) {
				/* 别的触点（第二根手指/手掌）不参与这条笔画，也不抢橡皮圆圈。 */
				if (activePointerRef.current !== null && event.pointerId !== activePointerRef.current) return;
				updateRing(event);
				const draft = draftRef.current;
				if (draft === null) return;
				const native = event.nativeEvent;
				const coalesced = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : null;
				const samples = coalesced !== null && coalesced.length > 0 ? coalesced : [native];
				const added = [];
				for (const sample of samples) {
					const point = pointOf(sample);
					if (point === null) continue;
					const last = draft.last;
					if (Math.abs(point[0] - last[0]) + Math.abs(point[1] - last[1]) < 1.2) continue;
					added.push(point);
					draft.last = point;
				}
				if (added.length === 0) return;
				draft.moved = true;
				if (draft.kind === "pen") {
					draft.points.push(...added);
					const context = contextRef.current;
					if (context !== null) {
						/* 一次 pointermove 只 stroke 一条路径，合并同帧采样点。 */
						setInk(context, draft);
						context.beginPath();
						context.moveTo(draft.points[draft.points.length - added.length - 1][0], draft.points[draft.points.length - added.length - 1][1]);
						for (const point of added) context.lineTo(point[0], point[1]);
						context.stroke();
					}
					return;
				}
				const end = draft.snap || event.shiftKey ? snapAngle(draft.start, draft.last, spec) : draft.last;
				draft.last = end;
				renderPreview(draft.start, end, draft, draft.kind);
			}

			function finishDraft() {
				const draft = draftRef.current;
				if (draft === null) return;
				draftRef.current = null;
				clearCanvas(overlayRef.current);
				const canvas = canvasRef.current;
				if (draft.kind === "pen") {
					commitStroke(
						{
							kind: "pen",
							points: draft.points,
							width: draft.width,
							color: draft.color,
						},
						canvas,
					);
					return;
				}
				const end = draft.last;
				const distance = Math.hypot(end[0] - draft.start[0], end[1] - draft.start[1]);
				if (distance < 2) {
					/* 点一下直线/箭头：落一个圆点，避免“什么都没画”。 */
					commitStroke(
						{
							kind: "pen",
							points: [draft.start],
							width: draft.width,
							color: draft.color,
						},
						canvas,
					);
					return;
				}
				const stroke = {
					kind: draft.kind,
					points: [draft.start, end],
					width: draft.width,
					color: draft.color,
				};
				const context = contextRef.current;
				if (context !== null) paintStroke(context, stroke);
				commitStroke(stroke, canvas);
			}

			function onPointerUp(event) {
				if (activePointerRef.current !== null && event.pointerId !== activePointerRef.current) return;
				activePointerRef.current = null;
				finishDraft();
			}

			function undo() {
				if (state.strokes.length === 0) return;
				draftRef.current = null;
				clearCanvas(overlayRef.current);
				const next = state.strokes.slice(0, -1);
				const dropped = state.strokes[state.strokes.length - 1];
				paintBoard(canvasRef.current, next);
				board.set({
					strokes: next,
					redo: state.redo.concat([dropped]),
					revision: state.revision + 1,
					detached: false,
					status: next.length === 0 ? "idle" : "dirty",
					message: "",
				});
			}

			function redo() {
				if (state.redo.length === 0) return;
				draftRef.current = null;
				clearCanvas(overlayRef.current);
				const restored = state.redo[state.redo.length - 1];
				const next = state.strokes.concat([restored]);
				paintBoard(canvasRef.current, next);
				board.set({
					strokes: next,
					redo: state.redo.slice(0, -1),
					revision: state.revision + 1,
					detached: false,
					status: "dirty",
					message: "",
				});
			}

			function clearBoard() {
				draftRef.current = null;
				clearCanvas(overlayRef.current);
				paintBoard(canvasRef.current, []);
				board.set({
					strokes: [],
					redo: [],
					snapshot: null,
					revision: state.revision + 1,
					clearSeq: state.clearSeq + 1,
					detached: false,
					status: "idle",
					message: "",
				});
			}

			/**
			 * 只在明确操作时编码，抬笔不再做。
			 * 按笔画包围盒裁切（四周留 CROP_PADDING 白边），小图最多放大 2.5 倍：
			 * 整块 1600x1000 直接发，视觉模型会把大留白一起缩放，字变小还白烧 token。
			 */
			function encodeSnapshot() {
				const canvas = canvasRef.current;
				if (canvas === null) return null;
				try {
					const bounds = inkBounds(board.get().strokes);
					if (bounds === null) return null;
					const left = Math.max(0, Math.floor(bounds.minX - CROP_PADDING));
					const top = Math.max(0, Math.floor(bounds.minY - CROP_PADDING));
					const right = Math.min(canvas.width, Math.ceil(bounds.maxX + CROP_PADDING));
					const bottom = Math.min(canvas.height, Math.ceil(bounds.maxY + CROP_PADDING));
					const width = right - left;
					const height = bottom - top;
					if (width < 2 || height < 2) return null;
					const scale = Math.max(1, Math.min(2.5, 900 / Math.max(width, height)));
					const out = document.createElement("canvas");
					out.width = Math.round(width * scale);
					out.height = Math.round(height * scale);
					const context = out.getContext("2d");
					if (context === null) return canvas.toDataURL("image/png");
					context.fillStyle = "#ffffff";
					context.fillRect(0, 0, out.width, out.height);
					context.drawImage(canvas, left, top, width, height, 0, 0, out.width, out.height);
					return out.toDataURL("image/png");
				} catch (error) {
					console.error("dsh-sketchpad: encode board failed", error);
					return null;
				}
			}

			function insert() {
				if (state.strokes.length === 0) return;
				const snapshot = encodeSnapshot();
				if (snapshot === null) return;
				board.set({
					snapshot,
					insertSeq: state.insertSeq + 1,
					status: "saving",
					message: "",
				});
				/* 浮窗里插入 = 锁定一张并清空，然后像关闭一样收起窗口（不额外保存一份）。 */
				if (floating && typeof onCloseWithoutSave === "function") onCloseWithoutSave();
			}

			/** 关闭浮窗时调用：只在确实有新笔画时才编码并排队保存。 */
			function save() {
				const current = board.get();
				if (current.strokes.length === 0) return false;
				if (current.liveId !== null && current.syncedRevision === current.revision && !current.detached) return true;
				const snapshot = encodeSnapshot();
				if (snapshot === null) return false;
				board.set({ snapshot, saveSeq: current.saveSeq + 1, saveRevision: current.revision, status: "saving", message: "" });
				return true;
			}

			function changeWeight(direction) {
				const current = prefsStore.get().weight;
				const index = WEIGHT_ORDER.indexOf(current);
				const nextIndex = Math.min(WEIGHT_ORDER.length - 1, Math.max(0, index + direction));
				if (nextIndex !== index) prefsStore.set({ weight: WEIGHT_ORDER[nextIndex] });
			}

			function onKeyDown(event) {
				const target = event.target;
				if (target instanceof Element && target.closest("input,textarea,[contenteditable='true']") !== null) return;
				const key = event.key;
				const command = event.ctrlKey || event.metaKey;
				if (command && key.toLowerCase() === "z") {
					event.preventDefault();
					event.stopPropagation();
					if (event.shiftKey) redo();
					else undo();
					return;
				}
				if (command && key.toLowerCase() === "y") {
					event.preventDefault();
					event.stopPropagation();
					redo();
					return;
				}
				if (command || event.altKey) return;
				switch (key) {
					case "[":
						event.preventDefault();
						changeWeight(-1);
						return;
					case "]":
						event.preventDefault();
						changeWeight(1);
						return;
					case "e":
					case "E":
						event.preventDefault();
						prefsStore.set({ tool: prefsStore.get().tool === "eraser" ? "pen" : "eraser" });
						return;
					case "b":
					case "B":
						event.preventDefault();
						prefsStore.set({ tool: "pen" });
						return;
					case "l":
					case "L":
						event.preventDefault();
						prefsStore.set({ tool: "line" });
						return;
					case "a":
					case "A":
						event.preventDefault();
						prefsStore.set({ tool: "arrow" });
						return;
					case "Escape":
						if (floating && typeof onClose === "function") {
							event.preventDefault();
							onClose();
						}
						return;
					default:
						return;
				}
			}

			const hasInk = state.strokes.length > 0;
			/* 只保留初始提示；动笔后不显示任何状态。出错时例外，避免静默失败。 */
			const failed = state.status === "error";
			const statusText = failed ? state.message || "保存失败" : t("emptyHint");
			const dotState = failed ? "error" : "idle";
			const showStatus = !hasInk || failed;

			return h(
				"div",
				{ className: "dsh-sketchpad-pane", "data-dsh-sketchpad": "", onKeyDown },
				h(
					"div",
					{ className: "dsh-sketchpad-toolbar", role: "toolbar", "aria-label": t("tools") },
					h(IconButton, {
						on: tool === "pen",
						glyph: "pen",
						title: t("pen"),
						onClick: () => prefsStore.set({ tool: "pen" }),
					}),
					h(IconButton, {
						on: tool === "line",
						glyph: "line",
						title: t("line"),
						onClick: () => prefsStore.set({ tool: "line" }),
					}),
					h(IconButton, {
						on: tool === "arrow",
						glyph: "arrow",
						title: t("arrow"),
						onClick: () => prefsStore.set({ tool: "arrow" }),
					}),
					h(IconButton, {
						on: tool === "eraser",
						glyph: "eraser",
						title: t("eraser"),
						onClick: () => prefsStore.set({ tool: "eraser" }),
					}),
					h("span", { className: "dsh-sketchpad-sep" }),
					h(WidthButton, {
						on: weight === "thin",
						pixels: 4,
						title: t("thin"),
						onClick: () => prefsStore.set({ weight: "thin" }),
					}),
					h(WidthButton, {
						on: weight === "normal",
						pixels: 7,
						title: t("normal"),
						onClick: () => prefsStore.set({ weight: "normal" }),
					}),
					h(WidthButton, {
						on: weight === "thick",
						pixels: 12,
						title: t("thick"),
						onClick: () => prefsStore.set({ weight: "thick" }),
					}),
					h("span", { className: "dsh-sketchpad-sep" }),
					h(
						"span",
						{ className: "dsh-sketchpad-swatches", role: "group", "aria-label": t("inkGroup") },
						PALETTE.map((entry) =>
							h("button", {
								key: entry.id,
								type: "button",
								className: "dsh-sketchpad-swatch",
								title: t(entry.labelKey),
								"aria-label": t(entry.labelKey),
								"data-on": color === entry.value && tool !== "eraser" ? "true" : "false",
								onClick: () => {
									const current = prefsStore.get();
									prefsStore.set({ color: entry.value, tool: current.tool === "eraser" ? "pen" : current.tool });
								},
							},
							h(
								"svg",
								{ width: 20, height: 20, viewBox: "0 0 24 24", "aria-hidden": "true" },
								h("circle", { cx: 12, cy: 12, r: 8, fill: entry.value }),
							),
							),
						),
					),
					h("span", { className: "dsh-sketchpad-sep" }),
					h(IconButton, {
						glyph: "undo",
						title: t("undo"),
						disabled: state.strokes.length === 0,
						onClick: undo,
					}),
					h(IconButton, {
						glyph: "redo",
						title: t("redo"),
						disabled: state.redo.length === 0,
						onClick: redo,
					}),
					h(
						"button",
						{
							type: "button",
							className: "dsh-sketchpad-clear",
							title: t("clearBoard"),
							"data-armed": hasInk ? "true" : "false",
							disabled: !hasInk,
							onClick: clearBoard,
						},
						t("clear"),
					),
					floating
						? h("span", { className: "dsh-sketchpad-sep" })
						: null,
					floating
						? h(
								"button",
								{
									type: "button",
									className: "dsh-sketchpad-action dsh-sketchpad-action-primary",
									title: t("insertAndClose"),
									disabled: !hasInk,
									onClick: insert,
								},
								t("insert"),
							)
						: null,
				),
				h(
					"div",
					{ className: "dsh-sketchpad-stage", ref: stageRef },
					h(
						"div",
						{ className: "dsh-sketchpad-frame" },
						h("canvas", {
							ref: canvasRef,
							className: "dsh-sketchpad-canvas",
							width: spec.width,
							height: spec.height,
							tabIndex: 0,
							"aria-label": t("board"),
							style: { cursor: tool === "eraser" ? "none" : "crosshair" },
							onPointerDown,
							onPointerMove,
							onPointerEnter: (event) => updateRing(event),
							onPointerUp,
							onPointerLeave: hideRing,
							onPointerCancel: onPointerUp,
							onContextMenu: (event) => event.preventDefault(),
						}),
						h("canvas", {
							ref: overlayRef,
							className: "dsh-sketchpad-overlay",
							width: spec.width,
							height: spec.height,
							"aria-hidden": "true",
						}),
						h(
							"svg",
							{ ref: ringRef, className: "dsh-sketchpad-eraser", viewBox: "0 0 100 100", "aria-hidden": "true" },
							h("circle", { cx: 50, cy: 50, r: 47, fill: "none", stroke: "rgba(255,255,255,.95)", strokeWidth: 3.5, vectorEffect: "non-scaling-stroke" }),
							h("circle", { cx: 50, cy: 50, r: 47, fill: "none", stroke: "rgba(0,0,0,.8)", strokeWidth: 1.5, vectorEffect: "non-scaling-stroke" }),
						),
					showStatus
						? h(
								"div",
								{ className: "dsh-sketchpad-canvas-status", "data-s": dotState, role: "status" },
								h("span", { className: "dsh-sketchpad-dot", "data-s": dotState }),
								h("span", null, statusText),
							)
						: null,
					),
				),
				floating
					? null
					: h(
					"div",
					{ className: "dsh-sketchpad-actions" },
					h(
						"button",
						{
							type: "button",
							className: "dsh-sketchpad-btn dsh-sketchpad-btn-primary",
							disabled: !hasInk,
							onClick: insert,
						},
						t("insertToComposer"),
					),
				),
			);
		}

		/* ------------------------------------------------------------------ *
		 * 输入框桥：把“当前画板”挂成附件，处理插入、删除、发送后的清空
		 * ------------------------------------------------------------------ */

		/** 每块画板一个附件桥：浮动/侧栏各自独立挂自己的「当前画板」。 */
		function makeBridge(surface) {
			return function SurfaceBridge(props) {
				if (typeof props.useInput !== "function" || props.inputActions === undefined) return null;
				return h(ComposerBridgeInner, Object.assign({ surface }, props));
			};
		}

		function ComposerBridgeInner(props) {
			const { sessionId, surface, useInput, inputActions } = props;
			const spec = SURFACES[surface];
			const board = useMemo(() => boardFor(sessionId, surface), [sessionId, surface]);
			const state = useSyncExternalStore(board.subscribe, board.get, board.get);
			const input = useInput((current) => current);

			const conversation = service("conversation");
			const previous = useRef({ ids: EMPTY_IDS, phase: "plain" });
			const lastInsert = useRef(state.insertSeq);
			const lastSave = useRef(state.saveSeq);
			const lastClear = useRef(state.clearSeq);

			const ids = input === undefined ? EMPTY_IDS : input.attachmentIds;
			const phase = input === undefined ? "plain" : input.phase;

			/* 附件从输入框里消失：区分“发送成功后清空”和“用户点 × 删除”。 */
			useEffect(() => {
				const liveId = state.liveId;
				const before = previous.current;
				if (liveId !== null && before.ids.indexOf(liveId) !== -1 && ids.indexOf(liveId) === -1) {
					/* 提交期间 phase 会离开 plain；点 × 删除时 phase 不动，靠这个区分。 */
					const sent = phase !== "plain" || before.phase !== "plain";
					if (sent) {
						/* 发送事务把草稿连同附件一起清掉了：画板也清空，避免下一条消息重复带图。 */
						board.set({
							strokes: [],
							snapshot: null,
							revision: state.revision + 1,
							liveId: null,
							syncedRevision: -1,
							detached: false,
							status: "idle",
							message: "",
						});
						previous.current = { ids, phase };
						return;
					}
					/* 用户删掉了“当前画板”这个附件：保留笔画，但不再自动附带，直到画板再次变化。 */
					board.set({ liveId: null, detached: true, status: "detached", message: "" });
				}
				previous.current = { ids, phase };
			}, [ids, phase, state.liveId, state.revision, sessionId]);

			/* 关闭浮窗时保存：把最近一次编码的画面挂成「当前画板」附件。 */
			useEffect(() => {
				if (state.saveSeq === lastSave.current) return;
				if (state.snapshot === null || conversation === undefined || sessionId === undefined) return;
				if (phase !== "plain") return; /* 提交中，等回到 plain 再补 */
				lastSave.current = state.saveSeq;
				try {
					const file = fileFromDataUrl(state.snapshot, liveFileName(spec));
					const drafts = conversation.createDrafts(sessionId, [file]);
					const created = Array.isArray(drafts) ? drafts[0] : undefined;
					if (created === undefined || created.id === undefined) throw new Error(t("attachFailed"));
					if (!inputActions.addAttachments([created.id])) {
						release(conversation, created.id);
						throw new Error(t("submittingRetry"));
					}
					const oldId = state.liveId;
					board.set({
						liveId: created.id,
						syncedRevision: state.saveRevision,
						detached: false,
						status: "saved",
						message: "",
					});
					if (oldId !== null && oldId !== created.id) {
						inputActions.removeAttachment(oldId);
						release(conversation, oldId);
					}
				} catch (error) {
					board.set({ status: "error", message: describeError(error) });
				}
			}, [state.saveSeq, state.saveRevision, phase, conversation, sessionId]);

			/* 清空画板：顺手把已经保存到输入框的「当前画板」附件也撤掉。 */
			useEffect(() => {
				if (state.clearSeq === lastClear.current) return;
				if (phase !== "plain") return;
				lastClear.current = state.clearSeq;
				const liveId = state.liveId;
				if (liveId !== null) {
					if (ids.indexOf(liveId) !== -1) inputActions.removeAttachment(liveId);
					release(conversation, liveId);
				}
				board.set({ liveId: null, syncedRevision: -1, status: "idle", message: "" });
			}, [state.clearSeq, phase, ids, conversation]);

			/* “插入”按钮：把当前画板固定成一张普通附件，然后清空画板。 */
			useEffect(() => {
				if (state.insertSeq === lastInsert.current) return;
				lastInsert.current = state.insertSeq;
				if (state.snapshot === null || conversation === undefined || sessionId === undefined) return;
				if (phase !== "plain") {
					board.set({ status: "error", message: t("sendingLater") });
					return;
				}
				try {
					const file = fileFromDataUrl(state.snapshot, frozenFileName(spec));
					const drafts = conversation.createDrafts(sessionId, [file]);
					const created = Array.isArray(drafts) ? drafts[0] : undefined;
					if (created === undefined || created.id === undefined) throw new Error(t("attachFailed"));
					if (!inputActions.addAttachments([created.id])) {
						release(conversation, created.id);
						throw new Error(t("submittingLater"));
					}
					const oldId = state.liveId;
					board.set({
						strokes: [],
						snapshot: null,
						revision: state.revision + 1,
						liveId: null,
						syncedRevision: state.revision + 1,
						detached: false,
						status: "idle",
						message: t("inserted"),
					});
					if (oldId !== null && oldId !== created.id) {
						inputActions.removeAttachment(oldId);
						release(conversation, oldId);
					}
				} catch (error) {
					board.set({ status: "error", message: describeError(error) });
				}
			}, [state.insertSeq, phase, conversation, sessionId]);

			return null;
		}

		/* ------------------------------------------------------------------ *
		 * 输入框左侧的一级入口按钮
		 * ------------------------------------------------------------------ */

		/**
		 * 「+」菜单里的那一项要能打开浮动画板，但命令不是从组件里发出的。
		 * 这里只维护一组「打开画板」的回调：DrawTrigger 挂载时登记，命令触发时调用。
		 */
		const floatOpeners = new Set();
		function requestFloatOpen() {
			for (const opener of floatOpeners) {
				try {
					opener(true);
				} catch (error) { /* ignore */ }
			}
		}

		function DrawTrigger(props) {
			const { sessionId } = props;
			const [open, setOpen] = useState(false);
			const openRef = useRef(null);
			openRef.current = openBoard;
			useEffect(() => {
				const opener = () => {
					if (openRef.current !== null) openRef.current();
				};
				floatOpeners.add(opener);
				return () => {
					floatOpeners.delete(opener);
				};
			}, []);
			function openBoard() {
				if (typeof sessionId === "string") {
					/* 每次打开都给一块新画布：上一次的笔画和「当前画板」附件不再延续。 */
					const board = boardFor(sessionId, "float");
					const current = board.get();
					if (current.strokes.length > 0 || current.redo.length > 0 || current.snapshot !== null) {
						board.set({
							strokes: [],
							redo: [],
							snapshot: null,
							revision: current.revision + 1,
							liveId: null,
							syncedRevision: -1,
							detached: false,
							status: "idle",
							message: "",
						});
					}
					setOpen(true);
					return;
				}
				/* 没有会话时退回右侧栏入口（正常输入框里一定有 sessionId）。 */
				const sidebar = service("sidebarRight");
				if (sidebar === undefined) {
					console.warn("dsh-sketchpad: sidebarRight service unavailable");
					return;
				}
				try {
					sidebar.openTab(TAB_ID);
				} catch (error) {
					console.warn("dsh-sketchpad: cannot open board tab", error);
				}
			}
			/* 入口已经收进输入框的「+」菜单，这里不再渲染按钮，只负责挂浮层。 */
			return open && typeof sessionId === "string"
				? h(BoardWindow, { sessionId, onClose: () => setOpen(false) })
				: null;
		}

		/* ------------------------------------------------------------------ *
		 * 右侧栏 tab 类型
		 * ------------------------------------------------------------------ */

		/**
		 * 「+」菜单行和右侧栏入口用的图标：和 dsh-sketch 里那个铅笔是同一枚，
		 * 两个插件在同一个菜单里长得一致。
		 */
		function pencilGlyph(props) {
			const size = (props && props.size) || 14;
			return h(
				"svg",
				{
					viewBox: "0 0 16 16",
					width: size,
					height: size,
					"aria-hidden": true,
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.6,
					strokeLinecap: "round",
					strokeLinejoin: "round",
				},
				h("path", { d: "M11.6 2.4l2 2-8.1 8.1-2.7.7.7-2.7 8.1-8.1z" }),
				h("path", { d: "M10.2 3.8l2 2" }),
			);
		}

		const TAB_DEFINITION = {
			id: TAB_ID,
			kind: TAB_ID,
			priority: "extension",
			keepMounted: true,
			title: () => t("board"),
			guide: [
				{
					id: "board",
					order: 30,
					title: () => t("board"),
					description: () => t("guideDesc"),
					icon: pencilGlyph,
				},
			],
		};

		/* ------------------------------------------------------------------ *
		 * 插件入口
		 * ------------------------------------------------------------------ */

		function apply(pluginCtx) {
			clientCtx = pluginCtx;
			ensureStyle();

			const FloatBridge = makeBridge("float");
			const PaneBridge = makeBridge("pane");

			pluginCtx.effect(() => pluginCtx.sidebarRightTabs.register(TAB_DEFINITION), "dsh-sketchpad: tab type");

			pluginCtx.slots.inject("sidebar.right.pane.tab", () =>
				pluginCtx.slots.register({ name: "sidebar.right.pane.tab", key: TAB_ID }, DrawPane),
			);

			pluginCtx.slots.inject("conversation.input.right", () => {
				pluginCtx.slots.register({ name: "conversation.input.right", id: "dsh-sketchpad-bridge-float", order: 40 }, FloatBridge);
				pluginCtx.slots.register({ name: "conversation.input.right", id: "dsh-sketchpad-bridge-pane", order: 41 }, PaneBridge);
			});

			pluginCtx.slots.inject("conversation.input.left", () =>
				pluginCtx.slots.register({ name: "conversation.input.left", id: "dsh-sketchpad-float-host", order: 30 }, DrawTrigger),
			);

			/* 输入框「+」菜单里的一项（和「文件 / 目标 / 计划」并列），
			   同时得到 /sketchpad。宿主没提供 commandUi 时静默跳过，按钮仍在。 */
			pluginCtx.inject(["commandUi"], (scope) => {
				const commands = scope.get("commandUi");
				if (commands === undefined || typeof commands.register !== "function") return;
				scope.effect(
					() =>
						commands.register({
							name: "sketchpad",
							label: () => t("menuLabel"),
							description: () => t("menuDesc"),
							icon: pencilGlyph,
							available: () => true,
							ui: { kind: "action", run: () => requestFloatOpen() },
						}),
					"dsh-sketchpad: command menu entry",
				);
			});
		}

		return { inject: ["slots", "sidebarRightTabs"], apply };
	},
});
