import { LoaderCircle } from "lucide-react";

export default function BoardsLoading() {
  return (
    <main className="route-state" role="status">
      <LoaderCircle className="spin" size={26} />
      <h1>正在打开工作区…</h1>
      <p>正在验证会话并加载 Boards。</p>
    </main>
  );
}
