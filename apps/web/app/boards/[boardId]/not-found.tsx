import Link from "next/link";

export default function BoardNotFound() {
  return (
    <main className="route-state">
      <h1>找不到该 Board</h1>
      <p>它可能不属于当前工作区，或链接已经失效。</p>
      <Link href="/boards">返回 Boards</Link>
    </main>
  );
}
