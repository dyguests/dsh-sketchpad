# Changelog

## Unreleased

- **入口收进「+」菜单**：在输入框「+」菜单里注册一项（`commandUi` 的 action），同时得到 `/sketchpad`；
  输入框左侧原来那个铅笔按钮已经去掉。宿主没有 `commandUi` 时退化为只有右侧栏入口。
- **中英文**：所有界面文案进了一本字典，按 `<html lang>` 选择，切换语言即时生效。
- **选中态**：工具、笔宽、色板三处统一成一层淡色底（品牌色 14%），不再用反色胶囊，
  色板也不再画圆环。
- **重做**：撤销右边加了镜像图标（`Cmd/Ctrl+Shift+Z`、`Ctrl+Y`）；撤销掉的一笔进 redo 栈，
  落新笔或清空时清空该栈。
- **浮层尺寸**：遮罩上方留 48px 让开窗口按钮；面板宽度取 `min(1040px, 视口宽 - 64px, (视口高 - 160px) × 1.6 + 24px)`，
  高度跟着画布走 —— 窗口再大，浮层也不会撑出多余的空白。
- **每次打开都是新画布**：打开浮层时重置笔画、redo 栈和快照，并断开 `liveId`，
  下一次关闭会存成新附件，不覆盖上一张。

---

## 0.1.0 — first public release

- Floating landscape canvas and a separate portrait canvas in the right sidebar.
- Pen, line, arrow and eraser with a round eraser cursor; three widths and three inks; Shift snapping.
- Explicit save model: a PNG is encoded only on close or Insert, never while drawing.
- Export is cropped to the ink bounding box with a 26 px margin and upscaled up to 2.5× for small sketches.
- Undo, immediate clear, one-pointer lock, global `Esc`, and a single empty-board hint.
- Images are attached through the host's draft-attachment API; no send method is wrapped and no network request is made.
