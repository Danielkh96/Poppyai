import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  Braces,
  Check,
  Database,
  Gauge,
  GitBranch,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  Sparkles
} from "lucide-react";

const architecture = [
  { label: "Web + API", value: "Next.js 16", icon: Braces },
  { label: "Canvas", value: "React Flow adapter", icon: GitBranch },
  { label: "Canonical data", value: "PostgreSQL + Drizzle", icon: Database },
  { label: "Durable work", value: "pg-boss worker", icon: Layers3 }
] as const;

export default function HomePage() {
  return (
    <main className="m0-page">
      <nav className="site-nav" aria-label="主要导航">
        <Link href="/" className="wordmark" aria-label="Siftloom 首页">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>Siftloom</span>
        </Link>
        <span className="m0-pill">
          <span aria-hidden="true" /> M0 foundation
        </span>
        <div className="site-nav__right">
          <a href="/api/health" className="quiet-link">
            Health
          </a>
          <Link href="/sign-in" className="nav-action">
            进入工作区 <ArrowRight size={15} />
          </Link>
        </div>
      </nav>

      <section className="m0-hero">
        <div className="m0-hero__copy">
          <span className="eyebrow">Original visual AI workspace</span>
          <h1>把零散来源，编织成可追溯答案。</h1>
          <p className="hero-lede">
            在一张持久画布上整理文档、网页、视频与笔记。只有你明确连接的来源，才会进入 AI
            上下文。
          </p>
          <div className="hero-actions">
            <Link href="/sign-in" className="primary-action">
              <Gauge size={17} /> 创建第一张 Board <ArrowRight size={16} />
            </Link>
            <span className="build-status">
              <Check size={15} /> M1 identity & boards
            </span>
          </div>
          <div className="principle-row" aria-label="产品原则">
            <span>
              <LockKeyhole size={14} /> 租户隔离
            </span>
            <span>
              <GitBranch size={14} /> 显式上下文
            </span>
            <span>
              <Sparkles size={14} /> 可验证引用
            </span>
          </div>
        </div>

        <div className="editorial-board" aria-label="Siftloom 产品视觉方向预览">
          <div className="board-grid" />
          <div className="preview-toolbar">
            <span>Q3 launch narrative</span>
            <span className="saved-dot">已保存</span>
          </div>
          <article className="preview-node preview-node--pdf">
            <span className="preview-node__kind">PDF · READY</span>
            <strong>Audience research</strong>
            <p>14 个访谈主题，带页码来源。</p>
          </article>
          <article className="preview-node preview-node--web">
            <span className="preview-node__kind">WEB · READY</span>
            <strong>Market signals</strong>
            <p>公开资料与竞争环境观察。</p>
          </article>
          <span className="preview-connector preview-connector--one" aria-hidden="true" />
          <span className="preview-connector preview-connector--two" aria-hidden="true" />
          <article className="preview-node preview-node--chat">
            <span className="preview-node__kind">SYNTHESIS · 2 SOURCES</span>
            <strong>哪些叙事最值得验证？</strong>
            <p>
              受访者更信任可量化的时间收益，且会主动比较迁移成本。 <mark>[S1]</mark>
            </p>
            <div className="source-chips">
              <span>S1 · Research</span>
              <span>S2 · Market</span>
            </div>
          </article>
          <div className="preview-note">
            <MessageSquareText size={15} /> Imported content stays data—not instructions.
          </div>
        </div>
      </section>

      <section className="m0-status" aria-label="M0 当前结果">
        <article>
          <span>01</span>
          <div>
            <strong>技术路线已冻结</strong>
            <p>便携模块化单体，Web 与 Worker 分开部署。</p>
          </div>
        </article>
        <article>
          <span>02</span>
          <div>
            <strong>风险边界已定义</strong>
            <p>浏览器、存储、抓取、队列、AI 与日志逐层隔离。</p>
          </div>
        </article>
        <article>
          <span>03</span>
          <div>
            <strong>性能夹具已固化</strong>
            <p>200 节点、300 连线、进度与流式状态。</p>
          </div>
        </article>
      </section>

      <section className="architecture-section">
        <div>
          <span className="eyebrow">Implementation baseline</span>
          <h2>一套能从 M0 长到私测版的骨架。</h2>
          <p>
            领域类型不依赖画布或 AI
            SDK；数据库是规范事实来源，外部副作用保持幂等，自动化测试默认不调用付费模型。
          </p>
        </div>
        <div className="architecture-grid">
          {architecture.map(({ label, value, icon: Icon }) => (
            <article key={label}>
              <span className="architecture-icon">
                <Icon size={18} />
              </span>
              <small>{label}</small>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="m0-next">
        <div className="m0-next__icon" aria-hidden="true">
          <Boxes size={24} />
        </div>
        <div>
          <span className="eyebrow">Next gate</span>
          <h2>M1：身份、租户与 Board 生命周期</h2>
          <p>
            真实会话、默认 workspace 与 Board 创建、重命名、归档和恢复已进入可运行路径。
          </p>
        </div>
        <Link href="/prototype/canvas" className="secondary-action">
          查看 M0 画布基准 <ArrowRight size={16} />
        </Link>
      </section>

      <footer className="site-footer">
        <span>Siftloom · working name pending legal clearance</span>
        <span>M1 / 2026-08-01</span>
      </footer>
    </main>
  );
}
