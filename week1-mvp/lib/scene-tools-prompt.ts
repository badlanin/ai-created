/**
 * Scene Tools — Framing prompt 词库（v6 加姿势型特写 + 背部参考图支持）
 *
 * v6 (2026-05)：
 *   - CLOSEUP_PRESETS 从 5 增到 9：
 *     - 原有：后背 / 侧腰 / 胸腿 / 下半身 / 颈肩
 *     - 新增（标 recommended）：抚腰 / 抚臀回眸 / 举臂背身 / 提裙侧步
 *   - 每个预设加 isBack 字段，标记"涉及背面"的预设
 *     —— 用户选了 isBack 时，前端会弹出背部参考图上传 UI
 *   - buildFramingBlock 加 hasBackReference 参数 + 背面专项 prompt 块
 *
 * v5 历史：
 *   - 占比 70-80%（之前 50%），删 long full body / floor space 远景档
 *   - FocusMode 三档：model_first / balanced / environmental
 *   - 接入材质词库（lib/materials.ts）
 */

export type FocusMode = "model_first" | "balanced" | "environmental";

const REGULAR_VARIANT_PRESETS: string[] = [
  "镜头：眼平视角 · 正面朝向 · 居中构图 · 紧凑全身（脚尖近底边，头顶距上边 ≤ 20%，无大留白）",
  "镜头：3/4 侧转身（一肩前倾） · 偏右三分构图 · 紧凑全身 · 一手倚靠场景物件（栏杆/门框/桌沿）",
  "镜头：侧面 profile · 偏左三分构图 · 紧凑全身 · 走动中或刚停下的瞬间（步幅自然）",
  "镜头：略低位仰拍（相机胸口高度） · 居中 · 3/4 身（膝盖以上） · 半坐或斜倚物件",
  "镜头：略高位俯拍（相机微高于人头） · 偏右 · 3/4 身 · 转身回眸或背身侧首",
];

export const CLOSEUP_PRESETS = [
  // ─── 原 5 个（按裁切区域分） ───
  {
    key: "back" as const,
    label: "后背特写",
    isBack: true,
    recommended: false,
    description:
      "后背特写镜头：相机正后方约 1.5m。构图框定上肩→腰部/上臀（半身），如果服装是长尾设计则可框到大腿。重点呈现：露背设计 / 后裙身褶皱走向 / 后腰剪裁 / 后颈线 / 拉链或绑带细节。模特的脸只露出后脑或被发遮，不入正脸。",
  },
  {
    key: "side_waist" as const,
    label: "侧腰特写",
    isBack: false,
    recommended: false,
    description:
      "侧腰特写镜头：相机偏侧位 ~80°。构图框定胸→大腿上段（半身侧面）。重点呈现:束腰剪裁 / 腰线曲线 / 侧身面料垂坠 / 高光走向沿身体侧面流淌。脸最多露下半（下巴+嘴），不强调正脸识别。",
  },
  {
    key: "chest_to_thigh" as const,
    label: "胸口至大腿特写",
    isBack: false,
    recommended: false,
    description:
      "胸口至大腿特写镜头：相机正前方约 1.2m。构图框定锁骨/胸口→大腿上段（半身正面）。重点呈现：颈线设计 / 胸口面料 / 腰部剪裁 / 腰部至大腿处面料垂坠和褶皱。脸只露下颌或不入镜，整个画面被服装填充。",
  },
  {
    key: "lower_body_motion" as const,
    label: "下半身动态",
    isBack: false,
    recommended: false,
    description:
      "下半身动态特写镜头：相机俯视约 30°或正面腰部高度。构图框定腰→脚（裙摆下半身）。重点呈现：裙摆飘逸 / 走动产生的褶皱与气流 / 一只手提裙的手部细节 / 开衩处的腿部线条 / 鞋面与裙摆的互动。模特身体只露下半，无脸无肩。",
  },
  {
    key: "neckline_shoulder" as const,
    label: "领口至肩特写",
    isBack: false,
    recommended: false,
    description:
      "领口至肩特写镜头：相机正前方约 0.8m，略略仰角。构图框定下颌→胸口上方（领口和肩部区域）。重点呈现：颈线设计 / 锁骨曲线 / 肩带 / 一字肩或抹胸边缘 / 领口的褶皱或装饰 / 配饰（项链、耳环）与领口的呼应。脸只露下半（嘴和下巴），不强调眼神。",
  },
  // ─── v6 新增 4 个（按姿势分，全部标 recommended） ───
  {
    key: "hand_on_waist" as const,
    label: "抚腰",
    isBack: false,
    recommended: true,
    description:
      "抚腰姿势特写：相机正前方或 3/4 侧，腰部高度。构图框定胸→大腿上段（半身）。姿势：模特单手或双手轻按腰侧（不是用力夹腰，是放松地搭着），手指自然分开，手腕略外翻露出腕骨线条。重点呈现：束腰剪裁 / 腰线曲线 / 手腕和腰部的几何关系 / 腰部面料褶皱被手部轻压形成的细微肌理变化。脸最多露下半。",
  },
  {
    key: "hand_on_hip_back" as const,
    label: "抚臀回眸",
    isBack: true,
    recommended: true,
    description:
      "抚臀回眸姿势特写：相机正后方约 1.5m 或 3/4 后位。构图框定上肩→上臀（半身背身）。姿势：模特单手或双手轻按腰侧/上臀，手肘自然外展，头部回眸侧首露出 1/3 侧脸或仅下颌轮廓。重点呈现：后背露背设计 / 后腰曲线 / 上臀廓型 / 手部在身体后侧的几何线条 / 头发自然散落至肩或半盘起。",
  },
  {
    key: "arms_overhead_back" as const,
    label: "举臂背身",
    isBack: true,
    recommended: true,
    description:
      "举臂背身姿势特写：相机正后方约 1.5m 或 3/4 后位。构图框定头顶→腰部（半身背身，举手时构图允许包含手臂）。姿势：模特双手或单手举过头/搭在后颈/扶后脑，手臂自然弯曲，肩胛骨打开，整片后背展露。重点呈现：露背设计的完整剪裁 / 后颈线 / 肩胛区域 / 抬臂时的腰线侧拉曲线 / 头发被举起或散落。脸只露后脑或侧轮廓。",
  },
  {
    key: "lift_skirt_step" as const,
    label: "提裙侧步",
    isBack: false,
    recommended: true,
    description:
      "提裙侧步姿势特写：相机偏侧位 ~70° 或正面，腰至脚高度。构图框定腰→脚（下半身侧面或半正面）。姿势：模特单手提起裙摆侧边（不是兜住，是用指尖轻捏裙边自然提起），同时侧迈一步，前脚踩稳后脚轻点。重点呈现：裙摆被提起后的褶皱走向 / 侧迈步产生的开衩或下摆飘动 / 提裙手部的指节细节 / 鞋面与裙摆边缘的关系。无脸无肩。",
  },
];

export type CloseupKey = (typeof CLOSEUP_PRESETS)[number]["key"];

/** 工具：判断某个 closeupKey 是否需要"背部参考图" */
export function isBackCloseupKey(key: CloseupKey | undefined): boolean {
  if (!key) return false;
  return CLOSEUP_PRESETS.find((p) => p.key === key)?.isBack === true;
}

function getFramingByFocus(focus: FocusMode): string {
  switch (focus) {
    case "model_first":
      return `画面焦点：模特主体（占比 70-80%）
- 模特纵向占画面 70-80%
- 头顶距上边界 ≤ 20%，全身镜头时脚尖距底边 ≤ 15%
- 服装是主体，场景是"背景"不是 co-protagonist
- 禁止：远景 / 环境镜头 / establishing shot / wide environmental shot
- 禁止：模特小到只占画面 1/3，场景占 2/3 以上`;
    case "balanced":
      return `画面焦点：场景与模特并重（占比 50-60%）
- 模特纵向占画面 50-60%（环境是叙事的一部分，但模特仍是焦点）
- 适合大气场景（廊柱 / 拱顶 / 长走廊）来表现服装的氛围
- 仍然要保证服装从画面看得清，可见至少 3/4 身`;
    case "environmental":
      return `画面焦点：环境氛围（占比 30-40%）
- 模特纵向占画面 30-40%，场景叙事 60-70%
- 适合极少用的"宣传海报 / 横屏 banner / 杂志跨页"类
- 即使占比小，光线仍然要打到服装的关键面料，否则废片`;
  }
}

export interface FramingOpts {
  focusMode: FocusMode;
  kind: "regular" | "closeup";
  variantIdx?: number;
  variantTotal?: number;
  closeupKey?: CloseupKey;
  materialDetailsText?: string;
  /** 背部参考图（IMAGE 3）是否已附在请求里。kind=closeup + isBack 时才生效 */
  hasBackReference?: boolean;
}

export function buildFramingBlock(opts: FramingOpts): string {
  const {
    focusMode,
    kind,
    variantIdx,
    variantTotal,
    closeupKey,
    materialDetailsText,
    hasBackReference,
  } = opts;

  let cameraBlock = "";
  if (kind === "closeup") {
    const preset = CLOSEUP_PRESETS.find((p) => p.key === closeupKey);
    if (!preset) throw new Error(`未知 closeup preset key: ${closeupKey}`);
    cameraBlock = `本张是「${preset.label}」特写镜头。\n${preset.description}`;
  } else {
    const idx = Math.max(1, variantIdx ?? 1);
    const total = Math.max(1, variantTotal ?? 1);
    if (total > 1) {
      const preset =
        REGULAR_VARIANT_PRESETS[(idx - 1) % REGULAR_VARIANT_PRESETS.length];
      cameraBlock = `本张是第 ${idx}/${total} 张常规变体。\n${preset}。\n在这个镜头基础上让模特按场景物件自由互动（坐 / 倚 / 撑 / 拿 / 走），但镜头角度 / 朝向 / 距离 / 构图必须严格按上面预设走，不要回退到"正面眼平居中全身"基准。`;
    } else {
      cameraBlock = `镜头：${REGULAR_VARIANT_PRESETS[0]}（单张时用基准预设）。`;
    }
  }

  const consistencyBlock =
    kind === "closeup"
      ? `══════════════════════════════════════════════════════════
🔒 一致性约束（特写模式）
══════════════════════════════════════════════════════════

- 服装颜色 / 面料 / 剪裁 / 装饰 100% 复刻 IMAGE 1（特写下衣物的所有细节肉眼可见，绝不能改）
- 模特肤色 / 发色 / 身材曲线必须一致（即使脸没入镜）
- 多变体之间光线 / 色调必须一致（同一个 photo shoot）
- 脸面部识别度可放宽（特写本来就不强调脸；但若入镜则脸必须是 IMAGE 1 同一人）`
      : `══════════════════════════════════════════════════════════
🔒 一致性约束（常规变体）
══════════════════════════════════════════════════════════

- 模特脸：identity / features / 肤色 / 化妆基线 必须 100% 一致
- 模特头发：颜色 / 长度 / 样式 必须 100% 一致
- 服装：颜色 / 面料 / 剪裁 / 长度 / 领口 / 袖型 / 所有细节 必须 100% 一致
  （IMAGE 1 里的款式是最终态，不要按场景"再设计"它）
- 多变体之间光线情绪必须一致（看起来是同一组 photo shoot 不是无关合辑）`;

  const closeupOpticsBlock =
    kind === "closeup"
      ? `\n══════════════════════════════════════════════════════════
🎯 特写光学约束
══════════════════════════════════════════════════════════

- 大光圈 f/1.4 ~ f/2.0 浅景深
- 背景纯虚化（bokeh）：场景仅作色调氛围和环境光提示，物体形状彻底糊掉
- 主体面料质感清晰锐利（focus plane 在服装本身)
- 光打到服装关键面料区域，呈现该面料应有的光感（缎面看高光、蕾丝看镂空、雪纺看半透 etc.）

⚠️ 重要：背景虚化但仍来自原场景。同一个场景的常规变体 + 特写镜头必须是
"同一地点、同一时段、同一光线方向"，特写只是镜头拉近 + 加大光圈虚化，
不是换场景或换光线。`
      : "";

  // 背部参考图专项约束（仅当 kind=closeup + isBack + hasBackReference 时启用）
  const isBack =
    kind === "closeup" && closeupKey
      ? CLOSEUP_PRESETS.find((p) => p.key === closeupKey)?.isBack === true
      : false;
  const backReferenceBlock =
    isBack && hasBackReference
      ? `\n══════════════════════════════════════════════════════════
🔁 背部参考图（IMAGE 3）专项约束
══════════════════════════════════════════════════════════

请求中第 3 张图（IMAGE 3）是这件服装的官方背部参考图。本张特写是背面取向，
所有背部细节必须严格按 IMAGE 3 还原：

- 露背设计（U 型 / V 型 / 方型 / 全开 / 镂空形状）100% 按 IMAGE 3
- 后腰剪裁、绑带、蝴蝶结、拉链位置 100% 按 IMAGE 3
- 后片刺绣 / 蕾丝 / 钉珠图案、密度、走向 100% 按 IMAGE 3
- 后裙身褶皱方向 / 拼接缝位 100% 按 IMAGE 3
- 后片面料肌理（缎面光感 / 蕾丝镂空 / 雪纺垂坠）100% 按 IMAGE 3

⚠️ 严禁根据 IMAGE 1（正面图）推测背部 —— 必须以 IMAGE 3 为唯一权威。
模特的身材曲线 / 肤色 / 发色仍以 IMAGE 1 为准，IMAGE 3 仅提供"衣物背面"。`
      : isBack && !hasBackReference
        ? `\n══════════════════════════════════════════════════════════
⚠️ 背部参考图未提供
══════════════════════════════════════════════════════════

本张是背面特写但没有背部参考图。请基于 IMAGE 1 的款式合理推测背部，但：
- 避免编造不存在的剪裁 / 装饰 / 镂空形状
- 默认背部是闭合的（除非 IMAGE 1 正面明示了露背设计）
- 优先用"含蓄保守"的背面，避免猜错。`
        : "";

  const materialBlock = materialDetailsText
    ? `\n══════════════════════════════════════════════════════════
🧵 服装材质（按词库精确刻画）
══════════════════════════════════════════════════════════

${materialDetailsText}

${
  kind === "closeup"
    ? "⚠️ 特写模式下，上面的 visual_traits / light_behavior / texture_rules 必须在画面里清晰可辨——观者应能从特写图一眼判断出面料类型。"
    : "请按上面材质规则准确刻画衣物的视觉特征、光线行为和纹理质感。"
}`
    : "";

  const productMainImageBlock =
    kind === "closeup"
      ? ""
      : `\n══════════════════════════════════════════════════════════
📐 这是商品主图
══════════════════════════════════════════════════════════

输出是服装产品图，DRESS 是主角，场景是 backdrop。

${getFramingByFocus(focusMode)}

✅ 允许：紧凑全身 / 3/4 身 / 一张 waist-up 半身（5 张里最多 1 张）
❌ 禁止：纯脸特写 / 纯手特写 / 只露半截裙摆的局部裁切 / 隐藏正面服装的纯背身（背身允许但要可见服装轮廓）`;

  const interactionBlock =
    kind === "closeup"
      ? ""
      : `\n══════════════════════════════════════════════════════════
🎬 读场景，自然互动
══════════════════════════════════════════════════════════

读 IMAGE 2 / 场景描述，心里列出可互动物件：家具（椅、沙发、长凳、楼梯、脚凳）/
表面（桌、壁炉、窗台）/ 建筑（门框、拱门、柱子、栏杆、扶手、墙角）/ 道具（杯、书、花、植物、窗帘）。

模特应自然地与其中 1-2 件互动——坐 / 倚 / 撑 / 走中 / 拿——避免"傻站中间不动"默认值。`;

  const hardConstraints = `\n══════════════════════════════════════════════════════════
🔒 硬约束（不可违反）
══════════════════════════════════════════════════════════

- 身体比例 = 真人尺度（椅子 ~85cm，门 ~210cm，桌子 ~75cm —— 模特身高与之对应）
- 模特身上的光 = 场景的光（色温和方向一致，不允许"棚拍主体贴到暗场景"）
- 模特是 IMAGE 1 同一人，服装一模一样
- 接触点物理可信（手扶桌 = 真实压住；坐 = 体重沉入坐面）`;

  return [
    cameraBlock,
    productMainImageBlock,
    closeupOpticsBlock,
    interactionBlock,
    consistencyBlock,
    backReferenceBlock,
    materialBlock,
    hardConstraints,
  ]
    .filter(Boolean)
    .join("\n");
}

/** @deprecated 用 buildFramingBlock() 替代 */
export const FRAMING_TIGHT_SINGLE = buildFramingBlock({
  focusMode: "model_first",
  kind: "regular",
  variantIdx: 1,
  variantTotal: 1,
});

/** @deprecated 改用 buildFramingBlock({ kind: "regular", variantIdx, variantTotal }) */
export function getVariantCameraHint(
  variantIdx: number,
  variantTotal: number,
): string {
  if (variantTotal <= 1) return "";
  const preset =
    REGULAR_VARIANT_PRESETS[(variantIdx - 1) % REGULAR_VARIANT_PRESETS.length];
  return `本张是第 ${variantIdx}/${variantTotal} 张变体。${preset}。`;
}
