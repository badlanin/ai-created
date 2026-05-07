/**
 * Scene Tools — Shared FRAMING block
 *
 * 历史上这个文件曾包含 5 个 scene-tools 子工具的 prompt builder
 * （background-swap / poster / social-snap / replicate / text-shoot），
 * 在收敛重构后这 5 个工具被合并成一个统一的"服饰场景图"，
 * 那 5 个 builder 已删除（见 lib/scene-prompt.ts 是新工具的 builder）。
 *
 * 此文件唯一保留的是 FRAMING_TIGHT_SINGLE —— batch-photo 的 worker
 * handler 还在用它给场景 item 注入"紧凑取景 + 浅景深"指令。
 */

/** 单人紧凑构图（85mm 长焦感 + 浅景深）。export 给 batch-photo / scene-tools 复用。 */
export const FRAMING_TIGHT_SINGLE = `══════════════════════════════════════════════════════════
🎯 FRAMING & SCALE — the scene plate is ATMOSPHERE REFERENCE, not a canvas to fill
══════════════════════════════════════════════════════════

CRITICAL: the scene plate (IMAGE 2) is a reference for atmosphere, light,
materials, palette — NOT a canvas you must reproduce edge-to-edge.

▸ MENTALLY CROP a tight local region of the scene around the subject.
  Place her near ONE tangible anchor object she can lean on / stand
  beside (a column base, a railing section, a window ledge, a planter,
  a stair edge, a wall corner, a doorway frame). Show only that local
  fragment in the output — NOT the whole corridor, NOT the whole
  building, NOT the whole garden.

▸ BODY-TO-OBJECT SCALE — body height MUST read as a real human relative
  to visible reference objects:
    • a Doric column is ~80cm wide  → torso similar width
    • a baluster railing is ~90cm tall → at hip-to-waist height
    • a window ledge is ~95cm high → at hip height
    • a doorway is ~210cm tall → head reaches ~80% of the doorway
  Avoid the "tiny doll in giant architecture" mistake.

▸ LENS — 85mm portrait telephoto feel. NOT wide-angle. NO 24mm
  architectural-vista distortion. Compressed front-to-back perspective,
  intimate not panoramic.

▸ DEPTH OF FIELD — shallow (f/2.0–f/2.8 feel). Subject + immediate
  anchor stay tack-sharp. Background recedes into smooth creamy bokeh
  (color blocks and soft shapes), NOT crisp architectural detail.

▸ ALLOW ARCHITECTURE TO EXTEND OUT OF FRAME — one column may go off
  the top edge, one wall may go off the side. Out-of-frame signals
  intimacy. A clean fully-bounded establishing shot is WRONG here.

❌ DO NOT recreate the entire scene plate. NO panorama. NO full corridor
   view. NO sweeping vista. NO full-building reveal. NO 6-7-people-wide
   ground area. The plate is a mood board, not a blueprint.
`;
