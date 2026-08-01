"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      className="quiet-button"
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        window.location.assign("/sign-in");
      }}
    >
      <LogOut size={15} /> {pending ? "正在退出…" : "退出"}
    </button>
  );
}
