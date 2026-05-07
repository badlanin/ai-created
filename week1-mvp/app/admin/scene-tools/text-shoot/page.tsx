"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  Upload,
  Download,
  RefreshCw,
  PenLine,
  X,
  ImageIcon,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────
 *  类型
 * ───────────────────────────────────────────────────────── */

type ShootResult = {
  result_id: string;
  result_image_url: string;
  mime_type: string;
  tokens: { prompt: number; completion: number };
};

const ASPECT_RATIOS = [
  { value: "3:4", label: "3:4 竖（推荐）" },
  { value: "2:3", label: "2:3 竖" },
  { value: "4:5", label: "4:5 竖" },
  { value: "1:1", label: "1:1 方" },
  { value: "4:3", label: "4:3 横" },
  { value: "16:9", label: "16:9 横" },
];

/** 场景描述预设（点一下塞到 textarea） */
const SCENE_PRESETS: Array<{ name: string; text: string }> = [
  {
    name: "古典柱廊一角 · 金光",
    text: "古典石质柱廊的一角：模特倚靠在一根多立克石柱旁，柱基厚重粗糙；午后金色斜光从右侧斜斜射入，柱身有暖色光斑，地面石板有长条形光影；背景柱廊纵深完全虚化为暖米色和柔和的阴影色块。85mm 长焦感，浅景深。",
  },
  {
    name: "巴洛克栏杆 · 暖夕阳",
    text: "巴洛克风格石质栏杆边：模特右手轻搭在栏杆扶手上，栏杆有古典雕花柱（balustrade），扶手处粗糙的米白色石灰岩质感；夕阳从背后斜射，栏杆边缘有金色轮廓光，背景的石质建筑外墙退到浅暖色调虚化色块。",
  },
  {
    name: "意式石阶 · 蜂蜜光",
    text: "意大利风格的石阶上：模特站在台阶中段，身侧是一段石质雕花栏杆和一只大型陶土花盆（栽着地中海植物）；蜂蜜般的金色斜光，温暖偏黄，长长的柔和阴影；背景是淡黄色的灰泥外墙和虚化的木百叶窗。",
  },
  {
    name: "拱窗白墙 · 冷柔光",
    text: "白色灰泥墙上嵌着一扇高大的拱形窗户，模特半身倚靠在窗框旁，柔和的冷光从窗户漫射进来，墙面有微微的纹理感；背景极简，只有墙面和窗的局部，画面整体偏冷调白色。",
  },
  {
    name: "热带花园 · 蕉叶光斑",
    text: "热带花园的一角：模特站在一丛大型蕉叶 / 棕榈叶旁，叶片大且层次丰富，从叶缝间漏下温暖明亮的阳光斑驳照在模特身上和地面；背景是更多的绿色虚化叶子和远处一抹蓝天的色块。",
  },
  {
    name: "复古叶纹墙 · 桃帘暖光",
    text: "室内：复古的深绿色花卉图案壁纸前，模特站在一段桃色丝质长帘旁，桃帘从右侧画面外延伸进来；钨丝灯般的暖光从右上方落下，照在墙纸的金色花纹上有光泽，画面整体复古、戏剧化。",
  },
  {
    name: "黄昏石廊 · 灯串暖光",
    text: "夕阳后的黄昏，模特站在一段陈旧石质走廊外的石板路上，头顶悬挂着暖色串灯（轻微散景），灯刚刚亮起；天空是淡紫色到深蓝的过渡，模特身上同时有夕阳余晖的暖光和灯串的暖橙色补光。",
  },
  {
    name: "湖边礁石 · 晨雾",
    text: "湖边圆润的鹅卵石滩上，模特站在水边一块大石头旁，水面平静映着浅银色的晨光；背景远处的树线柔焦成深绿色色块，画面有薄雾感，整体冷静、清透；浅景深，模特身后水面色块虚化。",
  },
];

/* ─────────────────────────────────────────────────────────
 *  页面主体
 * ───────────────────────────────────────────────────────── */

export default function TextShootPage() {
  // 表单
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sceneText, setSceneText] = useState("");
  const [poseText, setPoseText] = useState("");
  const [userHint, setUserHint] = useState("");
  const [aspectRatio, setAspectRatio] = useState("3:4");

  // 状态
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ShootResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 原片本地预览
  useEffect(() => {
    if (!sourceFile) {
      setSourceUrl(null);
      return;
    }
    const url = URL.createObjectURL(sourceFile);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sourceFile]);

  function onPickSource(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      setError("请上传图片格式（PNG / JPG / WebP）");
      return;
    }
    setSourceFile(file);
    setError(null);
    setResult(null);
  }

  async function handleSubmit() {
    if (!sourceFile) {
      setError("请先上传原片");
      return;
    }
    if (!sceneText.trim()) {
      setError("请填写场景描述");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("source_image", sourceFile);
      fd.append("scene_text", sceneText.trim());
      fd.append("aspect_ratio", aspectRatio);
      if (poseText.trim()) fd.append("pose_text", poseText.trim());
      if (userHint.trim()) fd.append("user_hint", userHint.trim());

      const res = await fetch("/api/scene-tools/text-shoot", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || res.statusText);
      }
      const data = (await res.json()) as ShootResult;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // 估价 ~ ¥1.7（Pro 4K）
  const estCostCny =
    result &&
    (
      ((result.tokens.prompt * 2 + result.tokens.completion * 120) /
        1_000_000) *
      6.83
    ).toFixed(2);

  return (
    <main className="max-w-7xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-fg-primary flex items-center gap-2">
          <PenLine size={20} className="text-brand-400" strokeWidth={2.2} />
          文字模式 · 场景由文字驱动（独立测试功能）
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          上传一张已有的模特+服装成片 → 用文字描述你想要的场景 → 模型完全自由发挥构图、光线、姿势重新拍。
          没有 plate 约束，所以不会有"硬塞全景"或"画幅不匹配"的问题。
        </p>
        <p className="mt-1 text-[11px] text-fg-muted">
          单次成本约 ¥1.7（Pro 模型 + 4K）。30-90 秒出图。⚠️ 同一段文字多次出图不会完全一致——这是文字驱动的本质，适合做单张氛围片，不太适合做系列产品图的统一外观。
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger-bg)] border border-[rgba(239,68,68,0.3)] text-danger text-sm rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左：原片 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ① 上传原片
          </h2>
          {sourceUrl ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sourceUrl}
                alt="原片预览"
                className="w-full rounded border border-border-subtle"
                style={{ maxHeight: 480, objectFit: "contain" }}
              />
              <button
                onClick={() => {
                  setSourceFile(null);
                  setResult(null);
                }}
                className="absolute top-2 right-2 px-2 py-1 bg-black/70 text-white text-xs rounded hover:bg-black/90 inline-flex items-center gap-1"
              >
                <X size={12} />
                重选
              </button>
            </div>
          ) : (
            <label className="block">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onPickSource(e.target.files)}
                className="hidden"
              />
              <div className="border border-dashed border-border-default rounded p-8 text-center cursor-pointer hover:border-brand-400 hover:bg-bg-hover transition-colors">
                <Upload
                  size={28}
                  strokeWidth={1.6}
                  className="text-fg-tertiary mx-auto mb-2"
                />
                <div className="text-sm text-fg-primary">点击上传原片</div>
                <div className="text-[11px] text-fg-muted mt-1">
                  PNG / JPG / WebP · 限 20MB
                </div>
                <div className="text-[10px] text-fg-muted mt-2">
                  推荐：批量摄影出过的纯色背景成片
                </div>
              </div>
            </label>
          )}
        </section>

        {/* 中：场景描述 + 姿势 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ② 写场景描述
          </h2>

          {/* 预设按钮 */}
          <div className="mb-3">
            <div className="text-[11px] text-fg-tertiary mb-1.5">
              预设（点一下塞进描述框）：
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SCENE_PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => setSceneText(p.text)}
                  className="px-2 py-1 text-[11px] rounded border border-border-subtle bg-bg-tertiary text-fg-secondary hover:border-brand-400 hover:text-brand-400 transition-colors"
                  title={p.text.slice(0, 100)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={sceneText}
            onChange={(e) => setSceneText(e.target.value.slice(0, 500))}
            placeholder="例如：古典柱廊的一角，模特倚靠柱基，午后金光斜射，浅景深..."
            rows={8}
            className="input text-sm w-full resize-none"
          />
          <div className="text-[10px] text-fg-muted mt-1 flex justify-between">
            <span>越具体越好（位置、光线、时间、焦段、景深都可以写）</span>
            <span>{sceneText.length}/500</span>
          </div>

          {/* 可选姿势 */}
          <div className="mt-3">
            <label className="block text-[11px] text-fg-tertiary mb-1">
              姿势引导（可选）
            </label>
            <textarea
              value={poseText}
              onChange={(e) => setPoseText(e.target.value.slice(0, 200))}
              placeholder="例如：侧身倚柱，左手撩头发，眼神望向远方"
              rows={2}
              className="input text-sm w-full resize-none"
            />
            <div className="text-[10px] text-fg-muted mt-1 text-right">
              {poseText.length}/200
            </div>
          </div>
        </section>

        {/* 右：参数 + 提交 + 结果 */}
        <section className="bg-bg-secondary rounded-lg border border-border-subtle p-5">
          <h2 className="text-sm font-semibold text-fg-primary mb-3">
            ③ 生成
          </h2>

          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-[11px] text-fg-tertiary mb-1">
                输出比例
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
                额外创意提示（可选）
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

            <button
              onClick={handleSubmit}
              disabled={submitting || !sourceFile || !sceneText.trim()}
              className="btn btn-primary w-full"
            >
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  生成中… 30-90 秒
                </>
              ) : (
                <>
                  <Sparkles size={14} strokeWidth={2.2} />
                  开始生成
                </>
              )}
            </button>
          </div>

          {/* 结果 */}
          {result ? (
            <div className="space-y-3 border-t border-border-subtle pt-3">
              <div className="bg-bg-tertiary rounded border border-border-subtle overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.result_image_url}
                  alt="文字模式结果"
                  className="w-full h-auto"
                  style={{ maxHeight: 480, objectFit: "contain" }}
                />
              </div>
              <div className="text-[11px] text-fg-muted">
                tokens {result.tokens.prompt}/{result.tokens.completion} · ¥
                {estCostCny}
              </div>
              <div className="flex gap-2">
                <a
                  href={result.result_image_url}
                  download={`text_shoot_${result.result_id}.png`}
                  className="btn btn-primary btn-sm flex-1"
                >
                  <Download size={12} strokeWidth={2.2} />
                  下载
                </a>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="btn btn-secondary btn-sm flex-1"
                >
                  <RefreshCw size={12} strokeWidth={2.2} />
                  重生成（同提示词）
                </button>
              </div>
            </div>
          ) : !submitting ? (
            <div className="text-[11px] text-fg-muted p-3 border border-dashed border-border-default rounded text-center">
              <ImageIcon
                size={20}
                className="text-fg-tertiary mx-auto mb-1"
                strokeWidth={1.6}
              />
              出图后预览在这里
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
