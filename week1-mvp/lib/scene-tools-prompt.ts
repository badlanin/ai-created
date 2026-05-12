/**
 * Scene Tools — Shared FRAMING block（v3 主动互动版）
 *
 * 历史背景：
 *   - v1：强制 anchor 倚靠 + 85mm + f/2.0 + anti-panorama，硬约束太多，
 *         开放场景翻车
 *   - v2（2026-05）：删掉所有硬约束，"让场景决定"。结果模型默认"站中间
 *         + 不互动"的保守姿势 —— 等于浪费了场景里的家具/门/桌子/道具
 *   - v3（2026-05）：硬约束依然不要，但**主动指令模型读场景里的物件并
 *         发生互动**。互动是必须，不是选项。
 *
 * 设计原则：
 *   1. 让模型先做一步"场景物件清单"的思考（读图，识别椅子/门/桌/灯
 *      /楼梯/窗框/栏杆/植物/扶手 等可交互对象）
 *   2. 从清单里选 1-2 个发生自然互动：坐 / 倚 / 撑 / 拿 / 触摸
 *   3. 姿势是"从场景里长出来"的，不是"放到场景里"的
 *   4. 镜头 / 景深 / 取景仍由模型按场景自由判断
 *
 * 注意：变量名 FRAMING_TIGHT_SINGLE 历史遗留，语义已经从"紧凑取景"
 *      变成"自然互动"。为了避免到处改 import 不改名。
 */

export const FRAMING_TIGHT_SINGLE = `══════════════════════════════════════════════════════════
🎬 SCENE INTERACTION — pose grows from what's in the scene
══════════════════════════════════════════════════════════

STEP 1 — Read IMAGE 2 carefully and mentally list every interactive
object visible in the scene. This includes (but is not limited to):
  • Furniture: chairs, sofas, benches, ottomans, beds, stools, daybeds
  • Surfaces: tables, desks, countertops, windowsills, mantels, consoles
  • Architecture: door frames, archways, columns, railings, banisters,
    window frames, wall corners, stair edges, alcoves
  • Props on surfaces: cups, vases, books, fruit, lamps, mirrors, flowers
  • Plants / curtains / textiles that can be touched or held

STEP 2 — Choose ONE or TWO of these objects and pose the subject in
NATURAL ACTIVE INTERACTION with them. Examples (pick what fits the
specific scene in IMAGE 2):
  • Sitting on the chair / sofa / stairs, with the dress draped naturally
  • Leaning a shoulder against the door frame / wall / archway
  • Standing with one hand resting on the table / mantel / railing
  • Holding a cup / book / flower from the surface, mid-motion
  • Crossing through a doorway, one hand on the frame
  • Sitting on stairs, looking off to the side
  • Standing close to a window, one hand brushing the curtain

The pose must read as a candid moment IN that location — not a model
parachuted into the scene.

❌ AVOID:
  • Standing dead-center, arms at sides, no contact with anything
  • "Pasted in" feel — body floats, doesn't relate to scene geometry
  • Same generic standing pose across different scenes (each scene
    has different furniture / props → different natural interactions)
  • Interacting with objects that are NOT visible in IMAGE 2

══════════════════════════════════════════════════════════
🎬 CAMERA & FRAMING — let the scene decide
══════════════════════════════════════════════════════════

Choose the pose, framing, camera distance, lens feel, and depth of
field that fit THIS specific scene + interaction naturally. A real
on-location photographer would adapt per scene. Don't force a single
"correct" composition.

══════════════════════════════════════════════════════════
🔒 HARD CONSTRAINTS
══════════════════════════════════════════════════════════

- Body proportions must read as a real human at correct scale relative
  to the furniture / architecture in IMAGE 2 (a chair is ~85cm tall,
  a doorway ~210cm, a table ~75cm high — body scales must agree).
- Lighting on the subject must match the scene's color temperature,
  direction, and intensity. No "studio-lit subject pasted into dim
  scene" effect.
- The garment from IMAGE 1 is fully preserved (color, fabric, cut,
  details) — never redesign the dress to fit the scene's color palette.
- Subject's face is the same person from IMAGE 1.
- Contact points must be physically believable: hand on table = hand
  actually resting on the surface with realistic touch; sitting on
  chair = body weight visibly settled into the cushion with natural
  fabric folds where the dress meets the seat.
`;
