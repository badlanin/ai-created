"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Upload,
  X,
  PlusCircle,
  PenLine,
  Image as ImageIcon,
} from "lucide-react";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useJobPolling } from "@/lib/hooks/use-job-polling";
import { Dropzone } from "@/app/_components/ui";
import { TaskViewport } from "@/app/_components/task-viewport";
import {
  TEXT_SCENE_PRESETS as STATIC_PRESETS,
  type TextScenePreset,
} from "@/lib/text-scene-presets";

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
};

// count = 这个场景出几张图（1-5，默认 1）
// N 张产品图 × 每个场景按 count 展开成 count 张 → 总 = N × sum(count)
// 多张同场景由 prompt 自动加"变体 X/N 互动差异化"hint，避免重复
type SceneEntry =
  | { id: string; type: "text"; text: string; count: number }
  | {
      id: string;
      type: "image";
      scene_id: number;
      scene_name: string;
      count: number;
    };

const ASPECT_RATIOS = [
  { value: "3:4", label: "3:4 竖（推荐）" },
  { value: "9:16", label: "9:16 竖手机" },
  { value: "1:1", label: "1:1 方" },
  { value: "16:9", label: "16:9 横" },
  { value: "4:3", label: "4:3 横" },
];

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
  const [scenes, setScenes] = useState<SceneEntry[]>([]);
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [userHint, setUserHint] = useState("");
  const [modelId, setModelId] = useState("gemini-3-pro-image-preview");
  const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("2K");

  // 提交
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 场景图选择面板（显示 / 隐藏）
  const [scenePickerOpen, setScenePickerOpen] = useState(false);

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

  // 产品图本地预览 URL 管理
  const productUrlsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    return () => {
      for (const url of productUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  function onPickProducts(files: FileList | File[] | null) {
    if (!files || (files instanceof FileList ? files.length : files.length) === 0)
      return;
    const arr: File[] = files instanceof FileList ? Array.from(files) : files;
    const newProducts: ProductFile[] = [];
    for (const f of arr) {
      if (!f.type.startsWith("image/")) continue;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const url = URL.createObjectURL(f);
      productUrlsRef.current.set(id, url);
      newProducts.push({ id, file: f, url });
    }
    setProducts((prev) => [...prev, ...newProducts]);
    setError(null);
  }

  function removeProduct(id: string) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    const url = productUrlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      productUrlsRef.current.delete(id);
    }
  }

  // 添加文字场景
  function addTextScene(initialText = "") {
    const id = `text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setScenes((prev) => [
      ...prev,
      { id, type: "text", text: initialText, count: 1 },
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
    const c = Math.max(1, Math.min(5, count));
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, count: c } : s)));
  }

  // 总数 + 软警告
  // 每张场景按它的 count 展开，total = N 张产品图 × sum(count)
  const sceneTotal = scenes.reduce((sum, s) => sum + (s.count || 1), 0);
  const totalCount = products.length * sceneTotal;
  const estCostCny = totalCount * 1.7; // Pro 4K 约 ¥1.7/张
  const showWarning = totalCount > 20;

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
    }

    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      products.forEach((p, i) => {
        fd.append(`product_image_${i}`, p.file, p.file.name);
      });
      const scenesPayload = scenes.map((s) => {
        const count = Math.max(1, Math.min(5, s.count || 1));
        if (s.type === "text")
          return { type: "text", text: s.text.trim(), count };
        return { type: "image", scene_id: s.scene_id, count };
      });
      fd.append("scenes", JSON.stringify(scenesPayload));
      fd.append("aspect_ratio", aspectRatio);
      fd.append("model", modelId);
      fd.append("image_size", imageSize);
      if (userHint.trim()) fd.append("user_hint", userHint.trim());

      const res = await fetch("/api/scene-tools", {
        method: "POST",
        body: fd,
      });
      const body = (await res.json()) as { job_id?: string; error?: string };
      if (!res.ok || !body.job_id) {
        throw new Error(body.error || res.statusText);
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
          服饰场景图
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          上传 N 张产品成片 + 选 M 个场景（文字 / 图片混搭）→ 输出 N×M 张换景成片。
          每张产品图都会和每个场景配出一张图。
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ① 产品图 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3 flex items-center justify-between">
            <span>① 产品图（{products.length}）</span>
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => onPickProducts(e.target.files)}
                className="hidden"
              />
              <span className="text-[11px] text-brand-400 hover:underline inline-flex items-center gap-0.5">
                <PlusCircle size={12} />
                添加
              </span>
            </label>
          </h2>

          {products.length === 0 ? (
            <Dropzone
              accept="image/*"
              multiple
              onFiles={(files) => onPickProducts(files)}
              icon={<Upload size={28} strokeWidth={1.6} />}
              title="拖拽 / 点击 / Ctrl+V 粘贴产品图"
              description="PNG / JPG / WebP · 限 20MB · 支持多选 · 鼠标移到此处后可粘贴剪贴板里的图"
            />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 max-h-[480px] overflow-y-auto pr-1">
                {products.map((p) => (
                  <div key={p.id} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={p.file.name}
                      className="w-full aspect-[3/4] object-cover rounded border border-border-subtle"
                    />
                    <button
                      onClick={() => removeProduct(p.id)}
                      className="absolute top-1 right-1 p-1 bg-black/60 text-white rounded hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="移除"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              {/* 已有图片后仍保留一个迷你 Dropzone 用于继续追加（拖 / 粘贴 / 点击） */}
              <div className="mt-2">
                <Dropzone
                  compact
                  accept="image/*"
                  multiple
                  onFiles={(files) => onPickProducts(files)}
                >
                  <div className="px-3 py-2 text-center text-[11px] text-fg-tertiary">
                    + 继续添加（拖拽 / 点击 / Ctrl+V 粘贴）
                  </div>
                </Dropzone>
              </div>
            </>
          )}
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
                        onClick={() => addTextScene(p.text)}
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

/* ─────────── 单条场景 entry 卡片 ─────────── */
function SceneEntryCard({
  entry,
  index,
  onRemove,
  onUpdateText,
  onUpdateCount,
  scenesLib,
}: {
  entry: SceneEntry;
  index: number;
  onRemove: () => void;
  onUpdateText: (text: string) => void;
  onUpdateCount: (count: number) => void;
  scenesLib: Scene[];
}) {
  // 数量选择子组件（1-5），文字 + 图片场景共用
  const CountPicker = (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-fg-tertiary">出图</span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onUpdateCount(n)}
            className={
              entry.count === n
                ? "w-5 h-5 rounded text-[10px] bg-brand-500 text-white font-medium"
                : "w-5 h-5 rounded text-[10px] bg-bg-base text-fg-secondary border border-border-subtle hover:bg-brand-50 hover:text-brand-600"
            }
            title={`这个场景出 ${n} 张图`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );

  if (entry.type === "text") {
    return (
      <div className="p-2 bg-bg-tertiary rounded border border-border-subtle">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-fg-secondary font-medium">
            <PenLine size={12} strokeWidth={2.2} />
            场景 {index} · 文字
          </div>
          <div className="flex items-center gap-2">
            {CountPicker}
            <button
              onClick={onRemove}
              className="text-fg-muted hover:text-danger"
              title="移除"
            >
              <X size={12} />
            </button>
          </div>
        </div>
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
      </div>
    );
  }

  // image
  const scene = scenesLib.find((s) => s.id === entry.scene_id);
  return (
    <div className="p-2 bg-bg-tertiary rounded border border-border-subtle flex items-center gap-2">
      {scene?.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={scene.image_url}
          alt={entry.scene_name}
          className="w-10 h-14 object-cover rounded border border-border-subtle"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-[11px] text-fg-secondary font-medium">
          <ImageIcon size={11} strokeWidth={2.2} />
          场景 {index} · 图片
        </div>
        <div className="text-sm font-medium text-fg-primary truncate">
          {entry.scene_name}
        </div>
        <div className="mt-0.5">{CountPicker}</div>
      </div>
      <button
        onClick={onRemove}
        className="text-fg-muted hover:text-danger self-start"
        title="移除"
      >
        <X size={14} />
      </button>
    </div>
  );
}
