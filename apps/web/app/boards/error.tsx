"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

export default function BoardsError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Boards route failed", { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <main className="route-state" role="alert">
      <TriangleAlert size={28} />
      <h1>工作区暂时无法加载</h1>
      <p>数据仍然安全，请检查连接后重试。</p>
      <button type="button" onClick={reset}>
        <RotateCcw size={16} /> 重试
      </button>
    </main>
  );
}
