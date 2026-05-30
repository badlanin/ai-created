"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  Sparkles,
  Upload,
  X,
  PenLine,
  Image as ImageIcon,
  ZoomIn,
  Check,
  Crop as CropIcon,
} from "lucide-react";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useJobPolling } from "@/lib/hooks/use-job-polling";
import { Dropzone } from "@/app/_components/ui";
import { ImageCropper } from "@/app/_components/image-cropper";
import { TaskViewport } from "@/app/_components/task-viewport";
import { PageRefreshButton } from "@/app/_components/page-refresh-button";
import {
  TEXT_SCENE_PRESETS as STATIC_PRESETS,
  type TextScenePreset,
} from "@/lib/text-scene-presets";
import { CLOSEUP_PRESETS } from "@/lib/scene-tools-prompt";

// 客户端不直接 import server-only 的 type；用 string literal union 防 ts boundary 报错
type CloseupKey =
  | "back"
  | "side_waist"
  | "chest_to_thigh"
  | "lower_body_motion"
  | "neckline_shoulder";
type FocusMode = "model_first" | "balanced" | "environmental";
type PoseMode = "editorial" | "interactive";

type MaterialRow = {
  id: number;
  name: string;
  english_name: string | null;
  description: string | null;
};

/* ─────────────────────────────────────────────────────────
 *  类型
 * ───────────────────────────────────────────────────────── */

type Scene = {
  id: number;
  name: string;
  image_url: string;
  category: string | null;
  category_label: string | null;
  tags: string | null;
};

type ProductFile = {
  id: string;
  file: File;
  url: string; // local preview
  source: ProductImageSource;
  // v6: 该产品的背部参考图（可选）
  backFile?: File;
  backUrl?: string;
};

type ProductImageSource = "web" | "local";
type ProductUploadChannel = "web" | "selected" | "local";

type ScrapedImage = {
  id: string;
  url: string;
  proxyUrl: string;
  alt: string;
  width: number | null;
  height: number | null;
};

type OriginalPreview = {
  src: string;
  alt: string;
  title: string;
  revokeUrl?: boolean;
};

// 单场景输出 = count（常规变体）+ closeup_presets.length（特写多选）
// 总输出 = N 产品图 × Σ(单场景输出)
// 常规变体由 prompt 自动加镜头预设循环；特写各自固定镜头
type SceneEntry =
  | {
      id: string;
      type: "text";
      text: string;
      scene_id?: number | null;
      scene_name?: string | null;
      scene_thumb?: string | null;
      count: number;
      closeup_presets: CloseupKey[];
    }
  | {
      id: string;
      type: "image";
      scene_id: number;
      scene_name: string;
      count: number;
      closeup_presets: CloseupKey[];
    };

const FOCUS_MODES: Array<{ value: FocusMode; label: string; hint: string }> = [
  { value: "model_first", label: "🎯 模特主体", hint: "占比 70-80%（默认）" },
  { value: "balanced", label: "⚖️ 场景平衡", hint: "占比 50-60%" },
  { value: "environmental", label: "🏛️ 环境氛围", hint: "占比 30-40%" },
];

const POSE_MODES: Array<{ value: PoseMode; label: string; hint: string }> = [
  {
    value: "editorial",
    label: "🎭 杂志大片",
    hint: "随机姿势/角度/焦距组合，场景作 backdrop（默认）",
  },
  {
    value: "interactive",
    label: "🏛️ 场景互动",
    hint: "模特坐/倚/扶场景物件，5 套预设循环（v5 老行为）",
  },
];

const ASPECT_RATIOS = [
  { value: "3:4", label: "3:4 竖（推荐）" },
  { value: "2:3", label: "2:3 竖" },
  { value: "9:16", label: "9:16 竖手机" },
  { value: "1:1", label: "1:1 方" },
  { value: "16:9", label: "16:9 横" },
  { value: "4:3", label: "4:3 横" },
];

function extensionFromMime(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}

function normalizeAssetUrl(url?: string | null): string {
  if (!url) return "";
  try {
    return new URL(url, "http://local").pathname
      .replace(/^\/+/, "")
      .toLowerCase();
  } catch {
    return url.replace(/^\/+/, "").toLowerCase();
  }
}

function fileNameFromUrl(url: string, index: number, mimeType: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
  } catch {}
  return `web-product-${index + 1}.${extensionFromMime(mimeType)}`;
}

// 文字场景预设已搬到 lib/text-scene-presets.ts，跟 batch-photo 共享。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _LEGACY_DROP_TEXT_SCENE_PRESETS: Array<{ name: string; text: string }> = [
  {
    name: "粉墙金桌 · 半身",
    text: "纯净粉色法式墙面，两扇粉色高门带方框雕花线 + 黑色把手；近景左下是一张小型大理石圆桌（巴洛克金色雕花桌脚），桌上一束粉白玫瑰；浅米色木地板。柔和窗光从画面右侧漫射，墙面有微妙的明暗渐变。",
  },
  {
    name: "象牙白法式套间",
    text: "象牙白色法式套间，墙面有 dado 雕花镶边和金线描边；房间一角放一把路易十四金边扶手椅（米色织锦缎面），椅旁摆一只白瓷小桌灯；地板是浅色拼花橡木。柔和暖光从落地窗漫射进来，整体色调奶白 + 金 + 淡香槟。",
  },
  {
    name: "粉色阳光浴室",
    text: "玫瑰粉色法式洗手间一角：粉色墙面 + 白色大理石洗手台 + 古铜色细脚水龙头 + 圆形金边镜；窗户透进柔和的午后阳光，台面摆一只小型陶瓷花瓶插粉色野花。色调粉白 + 古铜金 + 镜面反光。浅景深。",
  },

  // ───── 古典宫廷 / 油画墙 ─────
  {
    name: "宫廷油画楼梯",
    text: "气派的欧式宫廷楼梯：黑色大理石台阶 + 中央铺一条蓝金图案地毯（深蓝底 + 金色巴洛克花纹 + 希腊回纹镶边）；两侧白色大理石栏杆，瓶状车削立柱整齐排列；墙面奶白色，密集挂着十多幅金边油画（人物肖像 / 山水 / 帆船 / 骏马交错）；左侧高窗带米白色厚重窗帘和绳带流苏。柔和漫射窗光，调性庄重古典。85mm 长焦，背景油画微微柔焦。",
  },
  {
    name: "金边油画墙 · 楼梯转角",
    text: "庄园楼梯转角平台：奶白色墙面挂满金边古典油画（家族肖像 + 风景 + 帆船 + 马），左侧高大长窗带米白色厚帘 + 绳带流苏；右侧绿植衬托。脚下是大理石楼梯，瓶柱栏杆延伸进画面。柔和窗光从左侧斜射，色调奶白 + 古金 + 绿植深绿。",
  },
  {
    name: "黄墙金椅 · 油画一角",
    text: "暖鹅黄色复古墙面（带 wainscoting 白色护墙板），墙上挂一幅金边古典版画；近景放一把法式金边扶手椅（米色花卉锦缎椅面），椅前铺一条波斯纹样地毯；背景是一扇半开的白色法式门。光线柔和暖调，画面有 19 世纪沙龙感。",
  },
  {
    name: "宫廷长廊 · 大窗暖光",
    text: "古典宫廷长廊：左侧一排高大落地长窗 + 米白色厚帘和绳带流苏，柔和金色暖光从窗外漫射进来；右侧是奶白色墙面挂金边油画；地面是浅色大理石拼花。背景虚化退到远处的拱门口。85mm 长焦，浅景深。",
  },

  // ───── 复古沙龙 / 卧室 ─────
  {
    name: "条纹椅 · 洛可可一角",
    text: "洛可可室内一角：背景是大幅花卉图案的窗帘墙（淡粉米黄底 + 粉色玫瑰 + 绿叶），中景是一把金色雕花框架的条纹软包扶手椅（粉绿米黄竖条纹缎面）；左侧是一张圆形米色大理石小桌（巴洛克金色雕花桌脚），桌上一只粉色陶瓷台灯 + 白瓷茶具 + 水果；右侧是一扇半开的白色法式门，门外漏出花纹墙纸。地面深色大理石。光线柔和漫射，色调粉米 + 金 + 深绿。",
  },
  {
    name: "蓝白条纹卧室",
    text: "复古法式卧室：墙面是淡淡的蓝白竖条纹墙纸；中央一张米色扣花软包大床（木雕床头 + 床尾凳），白色厚被铺好 + 米色 / 浅绿色花卉抱枕；床头墙挂一幅金边古典油画；地面铺米色花卉纹样地毯。柔和窗光从画面右侧漫射进来。",
  },
  {
    name: "复古起居室 · 暖灯",
    text: "复古沙龙起居室：墙面是温暖的米黄涂料 + 多幅金边古典油画交错挂；中景是一组米色软包扶手椅 + 茶几 + 桌灯（柔和暖灯光）；背景是一扇带厚重窗帘的高窗，深色木地板上铺旧波斯地毯。色调暖米 + 古金 + 红木。85mm 浅景深。",
  },
  {
    name: "扶手椅 · 黄墙油画",
    text: "暖黄涂料墙面（带白色护墙板和金线描边）；墙上挂一幅黑边古典版画；近景放一把路易十四风格的金色雕花扶手椅（米白花纹锦缎椅面），椅前是一条波斯花纹地毯；地板是深色橡木。柔和漫射窗光从画面右侧射入。",
  },

  // ───── 庄园 / 楼梯 / 木地板 ─────
  {
    name: "白栏杆楼梯 · 蓝金毯",
    text: "庄园楼梯中段：黑色大理石台阶 + 中央铺一条蓝底金色巴洛克花纹地毯（带希腊回纹边）；两侧白色大理石栏杆，瓶状车削立柱；扶手宽厚光滑。背景是奶白色墙面挂多幅金边油画，左侧高窗带米色厚帘和绳带流苏。柔和侧光从窗外漫射。",
  },
  {
    name: "楼梯扶手 · 半身近景",
    text: "白色大理石楼梯扶手旁：粗壮扶手 + 瓶状立柱栏杆；背景奶白墙面密集挂金边古典油画（肖像 + 风景）；脚下是蓝金巴洛克花纹地毯铺在黑色台阶上。柔和窗光从左侧漫射，背景油画虚化成温暖色块。85mm 长焦。",
  },
  {
    name: "黑铁艺楼梯 · 拱窗",
    text: "白色 stucco 灰泥墙 + 黑色铁艺装饰栏杆楼梯（铁艺纹样精致），台阶是浅色大理石；墙上嵌一扇拱形深木格子窗；地中海地中海南欧风。柔和漫射光从拱窗透入，整体调性干净简约。",
  },
  {
    name: "胡桃木门厅",
    text: "深胡桃木质双扇大门（带方框雕花线条 + 黑色细把手），夹在浅色 stucco 石墙之间；门前是浅米色石板地面 + 一道窄阶。色调暖棕木 + 暖米石。柔和漫射光，南欧老建筑的入口感。",
  },

  // ───── 地中海 / 半室外 / 阳台 ─────
  {
    name: "红墙阳台 · 海景棕榈",
    text: "地中海风格阳台一角：红色（chili red）灰泥外墙 + 黑色铁艺栏杆，栏杆纹样精致；远景是蓝色海湾 + 棕榈树 + 远山小镇。地板是浅米色瓷砖 + 旁边一片矮草坪。光线明亮但柔和，色调红 + 蓝 + 绿。",
  },
  {
    name: "棕榈阳台 · 远山",
    text: "高地阳台：白色矮墙 + 大叶棕榈树框住前景，墙下是修剪整齐的灌木绿篱；远景是远山城市的房屋点点 + 蓝天云朵；地面是赤陶红砖。光线明亮，调性度假 + 慵懒。",
  },
  {
    name: "拱廊半户外 · 黄墙",
    text: "南欧拱形廊道：淡蜂蜜黄色灰泥外墙 + 木质门窗 + 一列拱形开口可看到远处天空；地板是浅色石板。柔和暖光斜射，廊柱投下长条阴影；调性是托斯卡纳乡村庄园。85mm 长焦。",
  },
  {
    name: "白拱廊 · 海风",
    text: "白色 stucco 拱廊：地中海风的连续白色圆拱框住远处的海景 / 棕榈；地板是赤陶红砖；阳光强烈但被白墙反射柔化。色调白 + 蓝 + 绿；干净海边度假感。",
  },

  // ───── 户外花园 / 庄园 ─────
  {
    name: "几何花园 · 喷泉",
    text: "意式几何花园：背景是修剪整齐的拱形绿篱迷宫 + 远处的柏树尖；中景是一座圆形古典石质喷泉（带雕花石盆 + 中央雕像）；前景是平整的绿草坪。傍晚柔和的暖金光，背景天空淡蓝带云。色调绿 + 米石 + 暖金。",
  },
  {
    name: "庄园草坪 · 阶梯",
    text: "英式庄园草坪：远景是一栋米色石质庄园建筑 + 法式落地长窗 + 拱门；中景是宽阔修剪整齐的绿草坪 + 一道矮石阶；前景是石板路 + 一只大型石质花盆。柔和漫射光，调性优雅古典。",
  },
  {
    name: "花园拱门 · 玫瑰墙",
    text: "户外花园拱形通道：拱门由茂密的粉色 / 白色玫瑰藤蔓覆盖 + 绿叶环绕，下方铺浅色石板小径；阳光从拱门外漏入形成明亮焦点。色调粉 + 白 + 绿；童话浪漫感。",
  },
  {
    name: "陶土花盆 · 石阶",
    text: "南欧石阶一角：浅色石阶 + 旁边一只巨大的赤陶红色陶土花盆（盆里种橄榄或柏树）；背景是浅黄色 stucco 外墙 + 一扇深木百叶窗。柔和暖金侧光，色调赤陶 + 浅黄 + 深木。",
  },

  // ───── 极简 / 棚拍 / 木质 ─────
  {
    name: "米色拱形墙",
    text: "极简米色拱形墙：浅暖米色（接近 #E8D9C4）的灰泥墙面，带两个并排的拱形凹陷装饰；地面是哑光暖米色水磨石。柔和漫射光从画面左侧漫入，墙面有微妙的明暗渐变。色调单一柔和，调性极简棚拍 + 法式氛围。",
  },
  {
    name: "暖米拱凹 · 阴影",
    text: "暖米色 stucco 拱形凹陷墙面：单一拱形凹陷构成主背景，墙面接近 #E8D5C0；地面是同色调哑光水泥地。光线从画面左前方斜射，在拱形凹陷内形成柔和的阴影渐变；调性极简、温柔、留白多。",
  },
  {
    name: "木质画室 · 大窗",
    text: "木质画室一角：浅暖色实木板墙 + 落地大窗（窗框白色），柔和的画室散射光从窗外漫入；窗下放一张木质工作台 + 一两件简约陶艺道具；地板是浅色实木地板。色调暖木 + 白 + 米；自然质朴。",
  },
  {
    name: "白墙木地板 · 落地窗",
    text: "极简室内：纯净白色 stucco 灰泥墙 + 一扇高大的落地窗（米色厚窗帘半开），柔和午后的窗光斜射进来；地板是浅色橡木拼花；墙根靠一盆翠绿散尾葵。色调白 + 浅木 + 一点植物绿。",
  },
];

/* ─────────────────────────────────────────────────────────
 *  页面
 * ───────────────────────────────────────────────────────── */

export default function SceneToolsPage() {
  const user = useCurrentUser();

  // 数据
  const [scenesLib, setScenesLib] = useState<Scene[]>([]);

  // 数据：AI 模型列表（从 /api/ai-models 拉）
  const [models, setModels] = useState<
    Array<{ model_id: string; label: string; badge?: string | null }>
  >([]);

  // 表单
  const [products, setProducts] = useState<ProductFile[]>([]);
  const [openProductChannel, setOpenProductChannel] =
    useState<ProductUploadChannel | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapedImages, setScrapedImages] = useState<ScrapedImage[]>([]);
  const [selectedScrapedUrls, setSelectedScrapedUrls] = useState<Set<string>>(
    new Set(),
  );
  const [savingScraped, setSavingScraped] = useState(false);
  const [originalPreview, setOriginalPreview] =
    useState<OriginalPreview | null>(null);
  const [croppingProductId, setCroppingProductId] = useState<string | null>(
    null,
  );
  const [scenes, setScenes] = useState<SceneEntry[]>([]);
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [userHint, setUserHint] = useState("");
  const [modelId, setModelId] = useState("gemini-3-pro-image-preview");
  const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("1K");
  const [focusMode, setFocusMode] = useState<FocusMode>("model_first");
  const [poseMode, setPoseMode] = useState<PoseMode>("editorial");

  // 材质（首次产品图上传后自动调 /api/analyze → /api/materials/match 拿匹配结果）
  const [allMaterials, setAllMaterials] = useState<MaterialRow[]>([]);
  const [matchedMaterialIds, setMatchedMaterialIds] = useState<number[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzedFingerprint, setAnalyzedFingerprint] = useState<string | null>(
    null,
  );

  // 提交
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 场景图选择面板（显示 / 隐藏）
  const [scenePickerOpen, setScenePickerOpen] = useState(false);
  const scrapedClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // 文字场景预设（从 /api/text-scenes 拉，admin 可在 admin/scenes 里编辑）
  // API 拉不到则回退到 lib 里 hardcoded 的 28 条（提供首次部署兜底）
  const [textScenePresets, setTextScenePresets] = useState<TextScenePreset[]>(
    STATIC_PRESETS,
  );

  // 加载场景库 + 模型列表 + 文字场景预设
  useEffect(() => {
    fetch("/api/text-scenes")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TextScenePreset[] | null) => {
        if (Array.isArray(data) && data.length > 0) {
          setTextScenePresets(data);
        }
      })
      .catch(() => {
        /* 拉不到就用 STATIC_PRESETS */
      });
    fetch("/api/scenes")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Scene[]) => setScenesLib(data))
      .catch(() => {});
    fetch("/api/ai-models?category=image_gen")
      .then((r) => (r.ok ? r.json() : []))
      .then(
        (
          data: Array<{
            model_id: string;
            label: string;
            badge?: string | null;
            is_default?: 0 | 1;
          }>,
        ) => {
          setModels(data);
          const def = data.find((m) => m.is_default === 1) || data[0];
          if (def) setModelId(def.model_id);
        },
      )
      .catch(() => {});
  }, []);

  // ─── prefill：从 /tasks 跳过来时 ?prefill_job=xxx 反填该 job 的 params ───
  const searchParams = useSearchParams();
  const prefillJobId = searchParams?.get("prefill_job");
  const [prefillBanner, setPrefillBanner] = useState<string | null>(null);
  useEffect(() => {
    if (!prefillJobId) return;
    fetch(`/api/jobs/${prefillJobId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.job) return;
        let params: Record<string, unknown> = {};
        try {
          params =
            typeof data.job.params === "string"
              ? JSON.parse(data.job.params)
              : data.job.params || {};
        } catch {
          return;
        }
        // aspect / imageSize / userHint
        if (typeof params.aspect_ratio === "string")
          setAspectRatio(params.aspect_ratio);
        if (
          params.image_size === "1K" ||
          params.image_size === "2K" ||
          params.image_size === "4K"
        )
          setImageSize(params.image_size);
        if (typeof params.user_hint === "string")
          setUserHint(params.user_hint || "");
        if (typeof data.job.model === "string") setModelId(data.job.model);
        if (
          params.focus_mode === "model_first" ||
          params.focus_mode === "balanced" ||
          params.focus_mode === "environmental"
        )
          setFocusMode(params.focus_mode);
        if (
          params.pose_mode === "editorial" ||
          params.pose_mode === "interactive"
        )
          setPoseMode(params.pose_mode);
        if (Array.isArray(params.material_ids))
          setMatchedMaterialIds(
            (params.material_ids as unknown[])
              .map((x) => Number(x))
              .filter((x) => Number.isFinite(x) && x > 0),
          );
        // scenes 反填：直接从 scenes payload 里读 count + closeup_presets
        type ScenePayload = {
          type: "text" | "image";
          text?: string;
          scene_id?: number;
          scene_name?: string;
          scene_thumb?: string;
          count?: number;
          closeup_presets?: string[];
        };
        const scenesRaw = (params.scenes as ScenePayload[]) || [];
        const prefilled: SceneEntry[] = scenesRaw.map((s, idx) => {
          const count =
            typeof s.count === "number" ? Math.max(0, Math.min(5, s.count)) : 1;
          const closeup_presets = (s.closeup_presets || []).filter(
            (k): k is CloseupKey =>
              k === "back" ||
              k === "side_waist" ||
              k === "chest_to_thigh" ||
              k === "lower_body_motion" ||
              k === "neckline_shoulder",
          );
          const id = `prefill-${idx}-${Date.now()}`;
          if (s.type === "image" && typeof s.scene_id === "number") {
            return {
              id,
              type: "image",
              scene_id: s.scene_id,
              scene_name: s.scene_name || `场景#${s.scene_id}`,
              count,
              closeup_presets,
            };
          }
          return {
            id,
            type: "text",
            text: s.text || "",
            scene_id:
              typeof s.scene_id === "number" && Number.isFinite(s.scene_id)
                ? s.scene_id
                : null,
            scene_name: s.scene_name || null,
            scene_thumb: s.scene_thumb || null,
            count,
            closeup_presets,
          };
        });
        if (prefilled.length > 0) setScenes(prefilled);
        setPrefillBanner(
          `已从老任务 #${prefillJobId.slice(0, 8)} 预填参数（场景 / 比例 / 画质 / 模型 / 追加指令）。产品图请重新上传后再提交。`,
        );
      })
      .catch(() => {});
  }, [prefillJobId]);

  // 产品图本地预览 URL 管理
  const productUrlsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    return () => {
      for (const url of productUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    if (!originalPreview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOriginalPreview(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [originalPreview]);

  useEffect(() => {
    return () => {
      if (originalPreview?.revokeUrl) URL.revokeObjectURL(originalPreview.src);
    };
  }, [originalPreview]);

  useEffect(() => {
    return () => {
      if (scrapedClickTimerRef.current) {
        clearTimeout(scrapedClickTimerRef.current);
      }
    };
  }, []);

  // ─── 首次上传产品图后自动解析面料 + 匹配材质词库 ───
  // 用第一张产品图跑 /api/analyze → 拿到 garment_attrs.面料材质 字段 →
  // POST 到 /api/materials/match 拿匹配到的材质 ID 列表 → 存到 state，
  // 提交时一并传给后端。fingerprint = 第一张图的 file name+size，
  // 避免重复 analyze 同一张图。用户可手动改（材质多选 UI 在第 ③ 列）。
  useEffect(() => {
    if (products.length === 0) {
      setMatchedMaterialIds([]);
      setAnalyzedFingerprint(null);
      return;
    }
    const first = products[0];
    const fp = `${first.file.name}::${first.file.size}`;
    if (fp === analyzedFingerprint) return;
    let cancelled = false;
    (async () => {
      setAnalyzing(true);
      try {
        // 1. 调 /api/analyze 解析款式
        const fd = new FormData();
        fd.append("image0", first.file, first.file.name);
        const r1 = await fetch("/api/analyze", { method: "POST", body: fd });
        if (!r1.ok) throw new Error("analyze failed");
        const attrs = (await r1.json()) as Record<string, unknown>;
        const fabricText = String(attrs["面料材质"] || "");
        if (!fabricText.trim()) {
          if (!cancelled) setMatchedMaterialIds([]);
          return;
        }
        // 2. 用面料文本调 /api/materials/match
        const r2 = await fetch("/api/materials/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: fabricText }),
        });
        if (!r2.ok) throw new Error("match failed");
        const data = (await r2.json()) as {
          matched: MaterialRow[];
          all: MaterialRow[];
        };
        if (cancelled) return;
        setAllMaterials(data.all || []);
        setMatchedMaterialIds((data.matched || []).map((m) => m.id));
      } catch {
        // 解析失败不阻断流程（拿不到材质也能跑，prompt 会让模型自己看图）
        if (!cancelled) setMatchedMaterialIds([]);
      } finally {
        if (!cancelled) {
          setAnalyzedFingerprint(fp);
          setAnalyzing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [products, analyzedFingerprint]);

  function addProductFiles(files: File[], source: ProductImageSource) {
    if (files.length === 0) return;
    const newProducts: ProductFile[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const url = URL.createObjectURL(f);
      productUrlsRef.current.set(id, url);
      newProducts.push({ id, file: f, url, source });
    }
    if (newProducts.length === 0) return;
    setProducts((prev) => [...prev, ...newProducts]);
    setOpenProductChannel(source === "web" ? "selected" : "local");
    setError(null);
  }

  function onPickProducts(files: FileList | File[] | null) {
    if (!files || (files instanceof FileList ? files.length : files.length) === 0)
      return;
    const arr: File[] = files instanceof FileList ? Array.from(files) : files;
    addProductFiles(arr, "local");
  }

  function removeProduct(id: string) {
    setProducts((prev) => {
      const p = prev.find((x) => x.id === id);
      if (p?.backUrl) URL.revokeObjectURL(p.backUrl);
      return prev.filter((x) => x.id !== id);
    });
    const url = productUrlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      productUrlsRef.current.delete(id);
    }
  }

  function toggleProductChannel(channel: ProductUploadChannel) {
    setOpenProductChannel((prev) => (prev === channel ? null : channel));
  }

  async function handleScrapeImages() {
    const url = sourceUrl.trim();
    if (!url) {
      setError("请先输入网页 URL");
      return;
    }

    setScrapeLoading(true);
    setSelectedScrapedUrls(new Set());
    setError(null);
    try {
      const res = await fetch("/api/scrape-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as {
        images?: ScrapedImage[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "抓取失败");
      const images = data.images || [];
      setScrapedImages(images);
      if (images.length === 0) setError("没有抓取到可用图片");
    } catch (e) {
      setScrapedImages([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScrapeLoading(false);
    }
  }

  function toggleScrapedImage(url: string) {
    setSelectedScrapedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function scheduleScrapedImageSelect(url: string) {
    if (scrapedClickTimerRef.current) {
      clearTimeout(scrapedClickTimerRef.current);
    }
    scrapedClickTimerRef.current = setTimeout(() => {
      toggleScrapedImage(url);
      scrapedClickTimerRef.current = null;
    }, 220);
  }

  function cancelScrapedImageSelect() {
    if (!scrapedClickTimerRef.current) return;
    clearTimeout(scrapedClickTimerRef.current);
    scrapedClickTimerRef.current = null;
  }

  function openOriginalPreview(preview: OriginalPreview) {
    setOriginalPreview(preview);
  }

  function openProductPreview(product: ProductFile, title: string) {
    openOriginalPreview({
      src: product.url,
      alt: product.file.name || title,
      title,
    });
  }

  function confirmProductCrop(productId: string, blob: Blob) {
    const current = products.find((p) => p.id === productId);
    if (!current) {
      setCroppingProductId(null);
      return;
    }

    const mimeType = blob.type || current.file.type || "image/png";
    const ext = extensionFromMime(mimeType);
    const baseName = current.file.name.replace(/\.[^.]+$/, "") || "product";
    const file = new File([blob], `${baseName}-cropped.${ext}`, {
      type: mimeType,
    });
    const url = URL.createObjectURL(file);
    const oldUrl = productUrlsRef.current.get(productId);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    productUrlsRef.current.set(productId, url);
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId
          ? {
              ...p,
              file,
              url,
            }
          : p,
      ),
    );
    setAnalyzedFingerprint(null);
    setCroppingProductId(null);
  }

  async function addSelectedScrapedImagesToProducts() {
    const selected = scrapedImages.filter((img) =>
      selectedScrapedUrls.has(img.url),
    );
    if (selected.length === 0) {
      setError("请先选择网页图片");
      return;
    }

    setSavingScraped(true);
    setError(null);
    try {
      const downloaded: File[] = [];
      for (const img of selected) {
        const res = await fetch(img.proxyUrl);
        if (!res.ok) continue;
        const mimeType = res.headers.get("content-type") || "image/jpeg";
        const blob = await res.blob();
        downloaded.push(
          new File(
            [blob],
            fileNameFromUrl(img.url, downloaded.length, mimeType),
            { type: mimeType },
          ),
        );
      }
      if (downloaded.length === 0) {
        setError("选中的网页图片无法下载");
        return;
      }
      addProductFiles(downloaded, "web");
      setSelectedScrapedUrls((prev) => {
        const next = new Set(prev);
        for (const img of selected) next.delete(img.url);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingScraped(false);
    }
  }

  // v6: 给某个产品添加 / 替换 / 移除背部参考图
  function setProductBackRef(productId: string, file: File) {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId) return p;
        if (p.backUrl) URL.revokeObjectURL(p.backUrl);
        const backUrl = URL.createObjectURL(file);
        return { ...p, backFile: file, backUrl };
      }),
    );
  }

  function removeProductBackRef(productId: string) {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId) return p;
        if (p.backUrl) URL.revokeObjectURL(p.backUrl);
        return { ...p, backFile: undefined, backUrl: undefined };
      }),
    );
  }

  // 添加文字场景
  function addTextScene(
    initialText = "",
    referenceScene?: Scene | null,
    referenceThumb?: string | null,
  ) {
    const id = `text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setScenes((prev) => [
      ...prev,
      {
        id,
        type: "text",
        text: initialText,
        scene_id: referenceScene?.id ?? null,
        scene_name: referenceScene?.name ?? null,
        scene_thumb: referenceThumb ?? referenceScene?.image_url ?? null,
        count: 1,
        closeup_presets: [],
      },
    ]);
  }

  // 添加图片场景
  function addImageScene(scene: Scene) {
    const id = `image-${scene.id}-${Date.now().toString(36)}`;
    if (scenes.some((s) => s.type === "image" && s.scene_id === scene.id)) {
      // 已加过这张图，跳过
      return;
    }
    setScenes((prev) => [
      ...prev,
      {
        id,
        type: "image",
        scene_id: scene.id,
        scene_name: scene.name,
        count: 1,
        closeup_presets: [],
      },
    ]);
  }

  function removeScene(id: string) {
    setScenes((prev) => prev.filter((s) => s.id !== id));
  }

  function updateTextScene(id: string, text: string) {
    setScenes((prev) =>
      prev.map((s) =>
        s.id === id && s.type === "text" ? { ...s, text } : s,
      ),
    );
  }

  function updateSceneCount(id: string, count: number) {
    // 允许 0（用户只想要特写镜头，没常规变体）
    const c = Math.max(0, Math.min(5, count));
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, count: c } : s)));
  }

  function toggleSceneCloseup(id: string, key: CloseupKey) {
    setScenes((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const has = s.closeup_presets.includes(key);
        const next = has
          ? s.closeup_presets.filter((k) => k !== key)
          : [...s.closeup_presets, key];
        return { ...s, closeup_presets: next };
      }),
    );
  }

  function toggleMaterial(matId: number) {
    setMatchedMaterialIds((prev) =>
      prev.includes(matId) ? prev.filter((x) => x !== matId) : [...prev, matId],
    );
  }

  // 总数 + 软警告
  // 单场景输出 = count（常规变体）+ closeup_presets.length（特写多选）
  // total = N 产品图 × Σ(单场景输出)
  const sceneTotal = scenes.reduce(
    (sum, s) => sum + (s.count || 0) + (s.closeup_presets?.length || 0),
    0,
  );
  const totalCount = products.length * sceneTotal;
  const estCostCny = totalCount * 1.7; // Pro 4K 约 ¥1.7/张
  const showWarning = totalCount > 20;

  // v6: 任意场景勾选了"背面"系特写时，提示用户上传背部参考图
  const BACK_KEYS = new Set<string>([
    "back",
    "hand_on_hip_back",
    "arms_overhead_back",
  ]);
  const needsBackRef = scenes.some((s) =>
    s.closeup_presets.some((k) => BACK_KEYS.has(k)),
  );
  const selectedProducts = products.filter((p) => p.source === "web");
  const localProducts = products.filter((p) => p.source === "local");
  const croppingProduct =
    croppingProductId !== null
      ? products.find((p) => p.id === croppingProductId) || null
      : null;

  const canSubmit =
    !submitting && products.length > 0 && scenes.length > 0 && !activeJobId;

  // ─── 提交 ───
  async function handleSubmit() {
    if (!canSubmit) return;
    if (showWarning) {
      const ok = confirm(
        `预计出 ${totalCount} 张图（${products.length} 产品 × ${sceneTotal} 场景变体），约花费 ¥${estCostCny.toFixed(2)}。\n\n确认提交？`,
      );
      if (!ok) return;
    }
    // 文字场景必须有内容
    for (const s of scenes) {
      if (s.type === "text" && !s.text.trim()) {
        setError("有空的文字场景，请填写或删除");
        return;
      }
      const total = (s.count || 0) + (s.closeup_presets?.length || 0);
      if (total === 0) {
        setError("有场景没有勾选张数也没有特写镜头，请删除或加张数");
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      products.forEach((p, i) => {
        fd.append(`product_image_${i}`, p.file, p.file.name);
        // v6: 该产品如果上传了背部参考图，跟着同一个 idx 传
        if (p.backFile) {
          fd.append(`back_reference_image_${i}`, p.backFile, p.backFile.name);
        }
      });
      const scenesPayload = scenes.map((s) => {
        const count = Math.max(0, Math.min(5, s.count || 0));
        const closeup_presets = (s.closeup_presets || []).slice(0, 5);
        if (s.type === "text")
          return {
            type: "text",
            text: s.text.trim(),
            scene_id: s.scene_id ?? null,
            scene_name: s.scene_name ?? null,
            scene_thumb: s.scene_thumb ?? null,
            count,
            closeup_presets,
          };
        return {
          type: "image",
          scene_id: s.scene_id,
          count,
          closeup_presets,
        };
      });
      fd.append("scenes", JSON.stringify(scenesPayload));
      fd.append("aspect_ratio", aspectRatio);
      fd.append("model", modelId);
      fd.append("image_size", imageSize);
      fd.append("focus_mode", focusMode);
      fd.append("pose_mode", poseMode);
      fd.append("material_ids", JSON.stringify(matchedMaterialIds));
      if (userHint.trim()) fd.append("user_hint", userHint.trim());

      const res = await fetch("/api/scene-tools", {
        method: "POST",
        body: fd,
      });
      // 兜底：体大被 Caddy 截断（413）时 body 是空的，res.json() 会爆
      // "Unexpected end of JSON input"。这里先 text() 再尝试 parse，给出友好提示
      const raw = await res.text();
      let body: { job_id?: string; error?: string } = {};
      try {
        if (raw) body = JSON.parse(raw);
      } catch {
        if (res.status === 413) {
          throw new Error(
            "上传内容超过服务器限制（200MB）。请减少产品图数量或压缩后重试。",
          );
        }
        throw new Error(
          `服务器返回异常（${res.status} ${res.statusText}）：${raw.slice(0, 200) || "(空响应)"}`,
        );
      }
      if (!res.ok || !body.job_id) {
        throw new Error(body.error || res.statusText || `HTTP ${res.status}`);
      }
      setActiveJobId(body.job_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // ─── 轮询 job ───
  const polled = useJobPolling(activeJobId, {
    onFinished: () => {
      // 完成后让用户在这里看见，job 数据 still on screen
    },
  });
  const job = polled.data?.job;

  // 场景按 category 分组（图片场景库选择面板用）
  const sceneGroups = useMemo(() => {
    const groups = new Map<string, Scene[]>();
    for (const s of scenesLib) {
      const key = s.category_label || "未分类";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return Array.from(groups.entries()).map(([key, items]) => ({ key, items }));
  }, [scenesLib]);

  const sceneByAssetUrl = useMemo(() => {
    const map = new Map<string, Scene>();
    for (const scene of scenesLib) {
      map.set(normalizeAssetUrl(scene.image_url), scene);
    }
    return map;
  }, [scenesLib]);

  function findSceneForTextPreset(preset: TextScenePreset): Scene | null {
    return sceneByAssetUrl.get(normalizeAssetUrl(preset.thumb)) ?? null;
  }

  if (!user) return null;

  // 任务进行 / 完成时全屏切换到 TaskViewport，跟 batch-photo 一致
  // 用户可以"返回配置"重新看表单，或"开始新任务"清空 active job
  if (activeJobId && polled.data) {
    return (
      <TaskViewport
        job={polled.data.job}
        items={polled.data.items}
        nextTokenReadyAtMs={polled.data.next_token_ready_at_ms}
        serverTimeMs={polled.data.server_time_ms}
        onBackToForm={() => setActiveJobId(null)}
        onStartNew={() => {
          // 不清空已选场景 / 产品图，只是回到表单准备下一次提交
          setActiveJobId(null);
        }}
        zipPrefix="scene_tools"
      />
    );
  }

  return (
    <main className="max-w-7xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-fg-primary flex items-center gap-2">
          <Sparkles size={20} className="text-brand-400" strokeWidth={2.2} />
          <span>服饰场景图</span>
          <PageRefreshButton />
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          上传产品图 + 选场景（每个场景独立配「常规变体张数 + 特写镜头多选」）→ 输出 N 产品 × Σ(每场景张数 + 特写数) 张图。
          首张产品图会自动识别面料并配上材质词库。
        </p>
      </header>

      {prefillBanner && (
        <div className="mb-4 p-3 rounded text-[12px] bg-[var(--brand-50-bg)] border border-brand-200 text-brand-700 flex items-start justify-between gap-3">
          <span>📥 {prefillBanner}</span>
          <button
            onClick={() => setPrefillBanner(null)}
            className="text-brand-500 hover:text-brand-700 shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ① 产品图 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-1 flex items-center justify-between">
            <span>① 产品图（{products.length}）</span>
          </h2>
          <div className="text-[12px] text-fg-tertiary mb-3">
            网页已选 / 本地上传 · 任选一种来源
          </div>

          <div className="border-t border-border-subtle">
            <ProductUploadChannelPanel
              title="网页"
              count={scrapedImages.length}
              open={openProductChannel === "web"}
              onToggle={() => toggleProductChannel("web")}
            >
              <div className="space-y-3">
                <div className="p-3 rounded-md border border-dashed border-[rgba(16,185,129,0.35)] bg-[var(--success-bg)]">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="url"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleScrapeImages();
                        }
                      }}
                      placeholder="https://example.com/product-page"
                      className="input h-9 flex-1 bg-bg-primary text-[12px]"
                    />
                    <button
                      type="button"
                      onClick={handleScrapeImages}
                      disabled={scrapeLoading || !sourceUrl.trim()}
                      className="btn btn-primary btn-sm sm:w-[84px]"
                    >
                      {scrapeLoading ? "抓取中..." : "抓取"}
                    </button>
                  </div>
                </div>

                {scrapedImages.length > 0 ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 max-h-[360px] overflow-y-auto pr-1">
                      {scrapedImages.map((img, i) => {
                        const active = selectedScrapedUrls.has(img.url);
                        return (
                          <button
                            key={img.url}
                            type="button"
                            onClick={() => scheduleScrapedImageSelect(img.url)}
                            onDoubleClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              cancelScrapedImageSelect();
                              openOriginalPreview({
                                src: img.proxyUrl,
                                alt: img.alt || `网页图片 ${i + 1}`,
                                title: `网页图片 ${i + 1}`,
                              });
                            }}
                            title="单击选中，双击查看原尺寸"
                            className={`relative min-h-[150px] rounded-md bg-bg-tertiary border p-2 flex items-center justify-center transition-colors ${
                              active
                                ? "border-[var(--success)]"
                                : "border-border-subtle hover:border-border-default"
                            }`}
                          >
                            <span
                              className="absolute top-1 left-1 z-10 w-5 h-5 rounded text-white text-[10px] flex items-center justify-center"
                              style={{ background: "rgba(0, 0, 0, 0.6)" }}
                            >
                              {i + 1}
                            </span>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.proxyUrl}
                              alt={img.alt || `网页图片 ${i + 1}`}
                              loading="lazy"
                              decoding="async"
                              draggable={false}
                              className="block max-h-[220px] w-auto max-w-full rounded object-contain"
                            />
                            {active ? (
                              <span
                                className="absolute top-1 right-1 w-5 h-5 rounded-full text-white flex items-center justify-center"
                                style={{ background: "var(--success)" }}
                              >
                                <Check size={13} strokeWidth={3} />
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={addSelectedScrapedImagesToProducts}
                      disabled={savingScraped || selectedScrapedUrls.size === 0}
                      className="btn btn-primary btn-sm"
                    >
                      {savingScraped
                        ? "添加中..."
                        : `添加到已选${
                            selectedScrapedUrls.size
                              ? `（${selectedScrapedUrls.size}）`
                              : ""
                          }`}
                    </button>
                  </>
                ) : null}
              </div>
            </ProductUploadChannelPanel>

            <ProductUploadChannelPanel
              title="已选"
              count={selectedProducts.length}
              open={openProductChannel === "selected"}
              onToggle={() => toggleProductChannel("selected")}
            >
              {selectedProducts.length > 0 ? (
                <>
                  {needsBackRef && (
                    <div className="mb-2 p-2 rounded text-[10px] bg-[var(--brand-50-bg)] border border-brand-200 text-brand-700">
                      📷 检测到你选了背面相关的特写镜头（后背 / 抚臀回眸 / 举臂背身）。建议给每件产品上传一张「背部参考图」——模型会根据它精准还原背部细节（露背、绑带、刺绣）。不传也能跑，但背部细节模型会猜。
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2 max-h-[480px] overflow-y-auto pr-1">
                    {selectedProducts.map((p) => {
                      const idx = products.findIndex((item) => item.id === p.id);
                      return (
                        <SceneProductCard
                          key={p.id}
                          product={p}
                          index={idx >= 0 ? idx : 0}
                          needsBackRef={needsBackRef}
                          onRemove={() => removeProduct(p.id)}
                          onStartCrop={() => setCroppingProductId(p.id)}
                          onSetBackRef={(file) => setProductBackRef(p.id, file)}
                          onRemoveBackRef={() => removeProductBackRef(p.id)}
                          onPreview={() =>
                            openProductPreview(
                              p,
                              `已选产品图 P${idx >= 0 ? idx + 1 : 1}`,
                            )
                          }
                        />
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="text-[12px] text-fg-tertiary p-3 rounded-md border border-dashed border-border-default bg-bg-tertiary">
                  暂无已选图片，可从「网页」添加。
                </div>
              )}
            </ProductUploadChannelPanel>

            <ProductUploadChannelPanel
              title="本地"
              count={localProducts.length}
              open={openProductChannel === "local"}
              onToggle={() => toggleProductChannel("local")}
            >
              <div className="space-y-3">
                <Dropzone
                  compact={localProducts.length > 0}
                  accept="image/*"
                  multiple
                  onFiles={(files) => onPickProducts(files)}
                  icon={<Upload size={28} strokeWidth={1.6} />}
                  title="拖拽 / 点击 / Ctrl+V 粘贴产品图"
                  description="PNG / JPG / WebP · 限 20MB · 支持多选 · 鼠标移到此处后可粘贴剪贴板里的图"
                >
                  {localProducts.length > 0 ? (
                    <div className="px-3 py-2 text-center text-[11px] text-fg-tertiary">
                      + 继续添加（拖拽 / 点击 / Ctrl+V 粘贴）
                    </div>
                  ) : null}
                </Dropzone>

                {localProducts.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2 max-h-[360px] overflow-y-auto pr-1">
                    {localProducts.map((p) => {
                      const idx = products.findIndex((item) => item.id === p.id);
                      return (
                        <SceneProductCard
                          key={p.id}
                          product={p}
                          index={idx >= 0 ? idx : 0}
                          needsBackRef={needsBackRef}
                          onRemove={() => removeProduct(p.id)}
                          onStartCrop={() => setCroppingProductId(p.id)}
                          onSetBackRef={(file) => setProductBackRef(p.id, file)}
                          onRemoveBackRef={() => removeProductBackRef(p.id)}
                          onPreview={() =>
                            openProductPreview(
                              p,
                              `本地产品图 P${idx >= 0 ? idx + 1 : 1}`,
                            )
                          }
                        />
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </ProductUploadChannelPanel>
          </div>
        </section>

        {/* ② 场景列表 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ② 选场景（{scenes.length}）
          </h2>

          {/* 添加按钮 */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => addTextScene()}
              className="flex-1 px-3 py-2 text-xs border border-border-default rounded hover:border-brand-400 hover:bg-bg-hover inline-flex items-center justify-center gap-1.5"
            >
              <PenLine size={14} strokeWidth={2} />
              加文字场景
            </button>
            <button
              onClick={() => setScenePickerOpen(true)}
              className="flex-1 px-3 py-2 text-xs border border-border-default rounded hover:border-brand-400 hover:bg-bg-hover inline-flex items-center justify-center gap-1.5"
            >
              <ImageIcon size={14} strokeWidth={2} />
              加图片场景
            </button>
          </div>

          {/* 已加场景 */}
          {scenes.length === 0 ? (
            <div className="text-[11px] text-fg-muted p-3 border border-dashed border-border-default rounded text-center">
              还没加场景。点击上方按钮添加文字描述或选场景图。
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {scenes.map((s, idx) => (
                <SceneEntryCard
                  key={s.id}
                  entry={s}
                  index={idx + 1}
                  onRemove={() => removeScene(s.id)}
                  onUpdateText={(t) => updateTextScene(s.id, t)}
                  onUpdateCount={(n) => updateSceneCount(s.id, n)}
                  onToggleCloseup={(k) => toggleSceneCloseup(s.id, k)}
                  scenesLib={scenesLib}
                />
              ))}
            </div>
          )}

          {/* 文字场景预设网格（按 group 折叠 + 缩略图 + 名字） */}
          <div className="mt-3 pt-3 border-t border-border-subtle">
            <div className="text-[11px] text-fg-tertiary mb-2">
              文字场景预设（点缩略图直接追加为新文字场景）
            </div>
            {(() => {
              const groups = new Map<string, TextScenePreset[]>();
              for (const p of textScenePresets) {
                if (!groups.has(p.group)) groups.set(p.group, []);
                groups.get(p.group)!.push(p);
              }
              return Array.from(groups.entries()).map(([groupName, list]) => (
                <div key={groupName} className="mb-2">
                  <div className="text-[10px] text-fg-muted mb-1">
                    {groupName}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {list.map((p) => (
                      <button
                        key={p.name}
                        onClick={() =>
                          addTextScene(p.text, findSceneForTextPreset(p), p.thumb)
                        }
                        className="group relative aspect-[3/4] rounded overflow-hidden border border-border-subtle hover:border-brand-400 hover:shadow-md transition-all bg-bg-tertiary"
                        title={p.text.slice(0, 100)}
                      >
                        {p.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.thumb}
                            alt={p.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] text-fg-muted">
                            无图
                          </div>
                        )}
                        {findSceneForTextPreset(p) && (
                          <div className="absolute left-1 top-1 px-1 py-0.5 rounded bg-brand-500 text-[9px] text-white">
                            带图
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 px-1 py-1 bg-gradient-to-t from-black/80 to-transparent">
                          <div className="text-[10px] font-medium text-white truncate leading-tight">
                            {p.name}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        </section>

        {/* ③ 参数 + 提交 + 进度 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ③ 生成
          </h2>

          <div className="space-y-3 mb-4">
            {/* 模型选择 */}
            <div>
              <label className="block text-[11px] text-fg-tertiary mb-1">
                模型
              </label>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="input select text-sm h-9"
              >
                {models.length === 0 ? (
                  <option value="gemini-3-pro-image-preview">
                    Nano Banana Pro
                  </option>
                ) : (
                  models.map((m) => (
                    <option key={m.model_id} value={m.model_id}>
                      {m.label}
                      {m.badge ? ` · ${m.badge}` : ""}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* 比例 + 画质 横排 */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-fg-tertiary mb-1">
                  比例
                </label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="input select text-sm h-9"
                >
                  {ASPECT_RATIOS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-fg-tertiary mb-1">
                  画质
                </label>
                <select
                  value={imageSize}
                  onChange={(e) =>
                    setImageSize(e.target.value as "1K" | "2K" | "4K")
                  }
                  className="input select text-sm h-9"
                >
                  <option value="1K">1K（最便宜）</option>
                  <option value="2K">2K（性价比）</option>
                  <option value="4K">4K（最佳）</option>
                </select>
              </div>
            </div>

            {/* 画面焦点（全局，控制"常规变体"占比；不影响特写镜头） */}
            <div>
              <label className="block text-[11px] text-fg-tertiary mb-1">
                画面焦点（常规变体占比；不影响特写镜头）
              </label>
              <div className="grid grid-cols-3 gap-1">
                {FOCUS_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setFocusMode(m.value)}
                    className={
                      focusMode === m.value
                        ? "px-1.5 py-1.5 rounded text-[10px] bg-brand-500 text-white font-medium"
                        : "px-1.5 py-1.5 rounded text-[10px] bg-bg-base text-fg-secondary border border-border-subtle hover:bg-brand-50 hover:text-brand-600"
                    }
                    title={m.hint}
                  >
                    <div>{m.label}</div>
                    <div
                      className={
                        focusMode === m.value
                          ? "text-[9px] opacity-80"
                          : "text-[9px] text-fg-muted"
                      }
                    >
                      {m.hint}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* v7: 姿势模式开关 */}
            <div>
              <label className="block text-[11px] text-fg-tertiary mb-1">
                姿势模式（控制常规变体的姿势生成逻辑）
              </label>
              <div className="grid grid-cols-2 gap-1">
                {POSE_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setPoseMode(m.value)}
                    className={
                      poseMode === m.value
                        ? "px-1.5 py-1.5 rounded text-[10px] bg-brand-500 text-white font-medium"
                        : "px-1.5 py-1.5 rounded text-[10px] bg-bg-base text-fg-secondary border border-border-subtle hover:bg-brand-50 hover:text-brand-600"
                    }
                    title={m.hint}
                  >
                    <div>{m.label}</div>
                    <div
                      className={
                        poseMode === m.value
                          ? "text-[9px] opacity-80"
                          : "text-[9px] text-fg-muted"
                      }
                    >
                      {m.hint.split("，")[0]}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 材质（首次上传后自动匹配，可手动改） */}
            {(allMaterials.length > 0 || analyzing) && (
              <div>
                <label className="block text-[11px] text-fg-tertiary mb-1">
                  服装材质
                  {analyzing && (
                    <span className="ml-2 text-fg-muted">分析中…</span>
                  )}
                  {!analyzing && matchedMaterialIds.length > 0 && (
                    <span className="ml-2 text-brand-500">
                      已识别 {matchedMaterialIds.length} 种
                    </span>
                  )}
                </label>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {allMaterials.map((m) => {
                    const on = matchedMaterialIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleMaterial(m.id)}
                        className={
                          on
                            ? "px-2 py-0.5 rounded text-[10px] bg-brand-500 text-white"
                            : "px-2 py-0.5 rounded text-[10px] bg-bg-base text-fg-secondary border border-border-subtle hover:bg-brand-50 hover:text-brand-600"
                        }
                        title={m.description || m.name}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
                <div className="text-[9px] text-fg-muted mt-1">
                  自动从第一张产品图识别面料。点 tag 可手动增删。特写镜头时按选中材质的"光线特性 / 纹理规则"精确刻画。
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] text-fg-tertiary mb-1">
                额外提示（可选）
              </label>
              <textarea
                value={userHint}
                onChange={(e) => setUserHint(e.target.value.slice(0, 200))}
                placeholder="例如：略带胶片颗粒，蓝调时刻"
                rows={2}
                className="input text-sm w-full resize-none"
              />
              <div className="text-[10px] text-fg-muted mt-1 text-right">
                {userHint.length}/200
              </div>
            </div>

            {/* 总数预估 */}
            {totalCount > 0 && (
              <div
                className={`p-2.5 rounded text-[11px] ${
                  showWarning
                    ? "bg-[var(--warn-bg)] border border-amber-200 text-warn"
                    : "bg-bg-tertiary border border-border-subtle text-fg-secondary"
                }`}
              >
                {showWarning && "⚠️ "}
                共出 <strong>{totalCount}</strong> 张图（{products.length}{" "}
                产品 × {sceneTotal} 场景变体
                {sceneTotal !== scenes.length
                  ? `，${scenes.length} 个场景`
                  : ""}
                ）· 预计约 <strong>¥{estCostCny.toFixed(2)}</strong>
                {showWarning && " · 数量较大，建议确认后再提交"}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="btn btn-primary w-full"
            >
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  提交中…
                </>
              ) : activeJobId ? (
                <>正在出图…</>
              ) : (
                <>
                  <Sparkles size={14} strokeWidth={2.2} />
                  开始生成
                </>
              )}
            </button>
          </div>

          {/* 进度展示 */}
          {/* 进度展示 */}
          {activeJobId && job && (
            <div className="border-t border-border-subtle pt-3 space-y-2">
              <div className="text-[12px] text-fg-secondary">
                进度：{job.completed_count + job.failed_count + job.canceled_count}{" "}
                / {job.total_count}（成功 {job.completed_count}，失败{" "}
                {job.failed_count}）
              </div>
              <div className="w-full h-2 bg-bg-tertiary rounded overflow-hidden">
                <div
                  className="h-full bg-brand-400 transition-all duration-300"
                  style={{
                    width: `${
                      job.total_count > 0
                        ? ((job.completed_count + job.failed_count) /
                            job.total_count) *
                          100
                        : 0
                    }%`,
                  }}
                />
              </div>
              {(job.status === "completed" ||
                job.status === "failed" ||
                job.status === "canceled") && (
                <div className="flex gap-2">
                  <a
                    href="/history"
                    className="btn btn-secondary btn-sm flex-1"
                  >
                    查看结果（去历史记录）
                  </a>
                  <button
                    onClick={() => setActiveJobId(null)}
                    className="btn btn-secondary btn-sm"
                  >
                    新建任务
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {croppingProduct ? (
        <ImageCropper
          imageSrc={croppingProduct.url}
          initialAspect={0}
          onConfirm={(blob) => confirmProductCrop(croppingProduct.id, blob)}
          onCancel={() => setCroppingProductId(null)}
        />
      ) : null}

      {originalPreview ? (
        <div
          className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm"
          onClick={() => setOriginalPreview(null)}
        >
          <div
            className="absolute left-4 right-4 top-3 z-10 flex items-center justify-between gap-3 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {originalPreview.title}
              </div>
              <div className="text-[11px] text-white/60">
                原尺寸预览 · Esc 关闭
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOriginalPreview(null)}
              className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
              aria-label="关闭原尺寸预览"
            >
              <X size={18} strokeWidth={2.2} />
            </button>
          </div>
          <div className="absolute inset-x-0 bottom-0 top-14 overflow-auto p-6">
            <div className="min-w-max min-h-full flex items-start justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={originalPreview.src}
                alt={originalPreview.alt}
                className="block max-w-none h-auto rounded-md bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
                draggable={false}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* 场景图选择面板（modal） */}
      {scenePickerOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setScenePickerOpen(false)}
        >
          <div
            className="bg-bg-secondary rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="p-4 border-b border-border-subtle flex justify-between items-center">
              <h3 className="text-sm font-semibold">选场景图</h3>
              <button
                onClick={() => setScenePickerOpen(false)}
                className="text-fg-tertiary hover:text-fg-primary"
              >
                <X size={18} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {sceneGroups.length === 0 ? (
                <div className="text-sm text-fg-tertiary text-center py-12">
                  场景库为空，去{" "}
                  <a
                    href="/admin/scenes"
                    className="text-brand-400 underline"
                  >
                    /admin/scenes
                  </a>{" "}
                  添加
                </div>
              ) : (
                sceneGroups.map((g) => (
                  <div key={g.key}>
                    <h4 className="text-xs font-semibold text-fg-secondary mb-2">
                      {g.key} · {g.items.length} 张
                    </h4>
                    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
                      {g.items.map((s) => {
                        const added = scenes.some(
                          (sc) =>
                            sc.type === "image" && sc.scene_id === s.id,
                        );
                        return (
                          <button
                            key={s.id}
                            onClick={() => {
                              if (!added) addImageScene(s);
                            }}
                            disabled={added}
                            className={`relative rounded border overflow-hidden transition-all ${
                              added
                                ? "border-brand-400 opacity-60 cursor-not-allowed"
                                : "border-border-subtle hover:border-brand-400"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={s.image_url}
                              alt={s.name}
                              className="w-full aspect-[3/4] object-cover"
                            />
                            <div className="px-1 py-0.5 text-[10px] text-fg-secondary truncate text-center">
                              {s.name}
                            </div>
                            {added && (
                              <div className="absolute top-1 right-1 px-1 py-0.5 text-[10px] bg-brand-400 text-white rounded">
                                已加
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
            <footer className="p-3 border-t border-border-subtle flex justify-end gap-2">
              <button
                onClick={() => setScenePickerOpen(false)}
                className="btn btn-primary btn-sm"
              >
                完成
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}

/* ─────────── 产品图上传通道 ─────────── */

function ProductUploadChannelPanel({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full h-10 flex items-center gap-2 text-left text-[13px] text-fg-secondary hover:text-fg-primary"
      >
        <span className="w-4 text-fg-tertiary">{open ? "▾" : "▸"}</span>
        <span className="font-medium">{title}</span>
        <span className="ml-1 px-2 py-0.5 rounded-full bg-bg-tertiary border border-border-subtle text-[11px] text-fg-tertiary">
          {count}
        </span>
      </button>
      {open ? <div className="pb-3 pl-6">{children}</div> : null}
    </div>
  );
}

function SceneProductCard({
  product,
  index,
  needsBackRef,
  onRemove,
  onStartCrop,
  onSetBackRef,
  onRemoveBackRef,
  onPreview,
}: {
  product: ProductFile;
  index: number;
  needsBackRef: boolean;
  onRemove: () => void;
  onStartCrop: () => void;
  onSetBackRef: (file: File) => void;
  onRemoveBackRef: () => void;
  onPreview: () => void;
}) {
  return (
    <div
      className="relative group"
      onDoubleClick={onPreview}
      title="双击查看原尺寸"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={product.url}
        alt={product.file.name}
        className="w-full aspect-[3/4] object-cover rounded border border-border-subtle"
      />
      <div className="absolute top-1 left-1 px-1 py-0.5 text-[9px] bg-black/60 text-white rounded">
        P{index + 1}
      </div>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStartCrop();
          }}
          className="w-[72px] justify-center px-2.5 py-1 bg-white/95 hover:bg-white text-[11px] text-gray-900 rounded flex items-center gap-1"
        >
          <CropIcon size={11} strokeWidth={2.2} />
          裁剪
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="w-[72px] justify-center px-2.5 py-1 text-[11px] text-white rounded flex items-center gap-1"
          style={{ background: "var(--danger)" }}
        >
          <X size={11} strokeWidth={2.2} />
          删除
        </button>
      </div>
      {needsBackRef && (
        <div className="absolute bottom-1 left-1 right-1">
          {product.backUrl ? (
            <div className="relative group/back">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={product.backUrl}
                alt="back ref"
                className="w-full h-8 object-cover rounded border-2 border-brand-400"
                title="背部参考图（已上传）"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveBackRef();
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                className="absolute -top-1 -right-1 p-0.5 bg-danger text-white rounded-full opacity-0 group-hover/back:opacity-100"
                title="移除背部参考图"
              >
                <X size={10} />
              </button>
            </div>
          ) : (
            <label
              className="block w-full px-1 py-1 text-[9px] text-center bg-black/70 text-white rounded cursor-pointer hover:bg-black/90 border border-brand-300/50"
              title="上传该产品的背部参考图"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              + 背部参考图
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onSetBackRef(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────── 单条场景 entry 卡片 ─────────── */
function SceneEntryCard({
  entry,
  index,
  onRemove,
  onUpdateText,
  onUpdateCount,
  onToggleCloseup,
  scenesLib,
}: {
  entry: SceneEntry;
  index: number;
  onRemove: () => void;
  onUpdateText: (text: string) => void;
  onUpdateCount: (count: number) => void;
  onToggleCloseup: (key: CloseupKey) => void;
  scenesLib: Scene[];
}) {
  const sceneTotal = (entry.count || 0) + (entry.closeup_presets?.length || 0);
  const textReferenceScene =
    entry.type === "text" && entry.scene_id
      ? scenesLib.find((s) => s.id === entry.scene_id) || null
      : null;
  const textReferenceThumb =
    textReferenceScene?.image_url ||
    (entry.type === "text" ? entry.scene_thumb : null);
  const textReferenceName =
    textReferenceScene?.name || (entry.type === "text" ? entry.scene_name : null);

  // 常规张数选择（0-5；0 = 只要特写）
  const CountPicker = (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-fg-tertiary">常规</span>
      <div className="flex gap-0.5">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onUpdateCount(n)}
            className={
              entry.count === n
                ? "w-5 h-5 rounded text-[10px] bg-brand-500 text-white font-medium"
                : "w-5 h-5 rounded text-[10px] bg-bg-base text-fg-secondary border border-border-subtle hover:bg-brand-50 hover:text-brand-600"
            }
            title={
              n === 0
                ? "不出常规变体（只出特写）"
                : `常规变体 ${n} 张（自动循环 5 种镜头预设）`
            }
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );

  // 特写镜头多选
  const CloseupPicker = (
    <div className="flex items-start gap-1.5">
      <span className="text-[10px] text-fg-tertiary inline-flex items-center gap-0.5 pt-0.5 shrink-0">
        <ZoomIn size={10} />
        特写
      </span>
      <div className="flex flex-wrap gap-0.5 flex-1">
        {CLOSEUP_PRESETS.map((p) => {
          const on = entry.closeup_presets.includes(p.key as CloseupKey);
          const isRecommended = (p as { recommended?: boolean }).recommended;
          const isBack = (p as { isBack?: boolean }).isBack;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onToggleCloseup(p.key as CloseupKey)}
              className={
                on
                  ? "px-1.5 py-0.5 rounded text-[10px] bg-brand-500 text-white inline-flex items-center gap-0.5"
                  : "px-1.5 py-0.5 rounded text-[10px] bg-bg-base text-fg-secondary border border-border-subtle hover:bg-brand-50 hover:text-brand-600 inline-flex items-center gap-0.5"
              }
              title={
                p.description.slice(0, 80) +
                (isBack ? "（背面镜头，建议上传背部参考图）" : "")
              }
            >
              {p.label}
              {isRecommended && (
                <span className="text-[8px] opacity-80">★</span>
              )}
              {isBack && (
                <span className="text-[8px] opacity-70">🔁</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  // 子总数 hint
  const SubTotal =
    sceneTotal > 0 ? (
      <div className="text-[10px] text-fg-muted">
        本场景共出{" "}
        <strong className="text-fg-secondary">{sceneTotal}</strong> 张
        {entry.count > 0 && `（常规 ${entry.count}`}
        {entry.count > 0 && entry.closeup_presets.length > 0 && " + "}
        {entry.closeup_presets.length > 0 &&
          `特写 ${entry.closeup_presets.length}`}
        {(entry.count > 0 || entry.closeup_presets.length > 0) && "）"}
      </div>
    ) : (
      <div className="text-[10px] text-warn">⚠️ 至少要 1 张常规或 1 个特写</div>
    );

  if (entry.type === "text") {
    return (
      <div className="p-2 bg-bg-tertiary rounded border border-border-subtle">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-fg-secondary font-medium">
            <PenLine size={12} strokeWidth={2.2} />
            场景 {index} · 文字
          </div>
          <button
            onClick={onRemove}
            className="text-fg-muted hover:text-danger"
            title="移除"
          >
            <X size={12} />
          </button>
        </div>
        {textReferenceThumb && (
          <div className="mb-1.5 flex items-center gap-2 rounded border border-border-subtle bg-bg-base p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={textReferenceThumb}
              alt={textReferenceName || "scene reference"}
              className="h-12 w-9 rounded object-cover"
            />
            <div className="min-w-0">
              <div className="text-[10px] text-fg-tertiary">参考图</div>
              <div className="truncate text-xs text-fg-secondary">
                {textReferenceName || "预设缩略图"}
              </div>
            </div>
          </div>
        )}
        <textarea
          value={entry.text}
          onChange={(e) => onUpdateText(e.target.value.slice(0, 500))}
          placeholder="例如：古典柱廊一角，午后金光斜射，浅景深..."
          rows={3}
          className="input text-xs w-full resize-none"
        />
        <div className="text-[10px] text-fg-muted mt-0.5 flex justify-between">
          <span>姿势由模型按场景描述自然生成</span>
          <span>{entry.text.length}/500</span>
        </div>
        <div className="mt-1.5 space-y-1">
          {CountPicker}
          {CloseupPicker}
          {SubTotal}
        </div>
      </div>
    );
  }

  // image
  const scene = scenesLib.find((s) => s.id === entry.scene_id);
  return (
    <div className="p-2 bg-bg-tertiary rounded border border-border-subtle">
      <div className="flex items-start gap-2">
        {scene?.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={scene.image_url}
            alt={entry.scene_name}
            className="w-10 h-14 object-cover rounded border border-border-subtle shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <div className="text-[11px] text-fg-secondary font-medium inline-flex items-center gap-1">
              <ImageIcon size={11} strokeWidth={2.2} />
              场景 {index} · 图片
            </div>
            <button
              onClick={onRemove}
              className="text-fg-muted hover:text-danger"
              title="移除"
            >
              <X size={12} />
            </button>
          </div>
          <div className="text-sm font-medium text-fg-primary truncate">
            {entry.scene_name}
          </div>
        </div>
      </div>
      <div className="mt-1.5 space-y-1">
        {CountPicker}
        {CloseupPicker}
        {SubTotal}
      </div>
    </div>
  );
}
