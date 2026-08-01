import Link from "next/link";
import { ArrowLeft, Gauge, ShieldCheck } from "lucide-react";

import { createCanvasFixture } from "@siftloom/shared";
import { CanvasSurface } from "@siftloom/ui";

export const metadata = {
  title: "M0 画布基准"
};

export default function CanvasPrototypePage() {
  const graph = createCanvasFixture();

  return (
    <main className="prototype-page">
      <header className="prototype-header">
        <div className="prototype-header__identity">
          <Link href="/" aria-label="返回 M0 总览" className="icon-button">
            <ArrowLeft size={17} />
          </Link>
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <div>
            <span className="eyebrow">Siftloom / M0 spike</span>
            <h1>可追溯研究画布</h1>
          </div>
        </div>
        <div className="prototype-header__facts" aria-label="基准信息">
          <span>
            <Gauge size={14} /> 200 / 300 fixture
          </span>
          <span>
            <ShieldCheck size={14} /> library boundary active
          </span>
        </div>
      </header>
      <section className="prototype-stage" aria-label="画布性能原型">
        <CanvasSurface
          graph={graph}
          ariaLabel="Siftloom M0 画布性能原型"
          benchmarkEnabled
        />
      </section>
    </main>
  );
}
