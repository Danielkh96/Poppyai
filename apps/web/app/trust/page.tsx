import { PHASE_1_LIMITS } from "@siftloom/shared";
import { ArrowLeft, Database, FileCheck2, LifeBuoy, ShieldCheck } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "数据与使用说明" };

function contactAddress(name: "SUPPORT_EMAIL" | "PRIVACY_CONTACT_EMAIL"): string {
  return process.env[name] || "support@siftloom.local";
}

export default function TrustPage() {
  const supportEmail = contactAddress("SUPPORT_EMAIL");
  const privacyEmail = contactAddress("PRIVACY_CONTACT_EMAIL");

  return (
    <main className="trust-page" id="main-content">
      <header>
        <Link href="/boards" className="icon-button" aria-label="返回 Boards">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <span className="eyebrow">Private alpha trust center</span>
          <h1>数据、来源与支持说明</h1>
          <p>以下说明适用于 Siftloom 私测版本，并明确当前能力和处理边界。</p>
        </div>
      </header>

      <section aria-labelledby="privacy-title">
        <span aria-hidden="true">
          <ShieldCheck size={21} />
        </span>
        <div>
          <h2 id="privacy-title">隐私与 AI 供应商处理</h2>
          <p>
            Board、节点、文件、提取内容和对话属于当前工作区。服务仅把用户明确连接或本次确认的来源快照发送给已配置的
            AI 供应商；不会发送其他 Board 内容。自动化测试使用本地 Fake
            Provider，不产生付费调用。
          </p>
          <p>
            运行日志只记录不透明 ID、状态、耗时、字节数、token
            数和标准错误代码，不记录完整提示词、回答、文档正文、文件名、来源
            URL、认证信息或签名链接。
          </p>
        </div>
      </section>

      <section aria-labelledby="rights-title">
        <span aria-hidden="true">
          <FileCheck2 size={21} />
        </span>
        <div>
          <h2 id="rights-title">来源权利与远程内容</h2>
          <p>
            用户只能上传或导入自己有权处理的内容。Siftloom 不绕过登录、付费墙、DRM、robots
            控制或平台技术限制。Phase 1 的 YouTube 路径仅读取官方 API
            可提供的公开元数据；字幕不可用时会明确提示用户上传自己有权处理的文字稿。
          </p>
          <p>来源驱动回答表示“基于所选材料生成”，不代表事实已经被独立核验。</p>
        </div>
      </section>

      <section aria-labelledby="retention-title">
        <span aria-hidden="true">
          <Database size={21} />
        </span>
        <div>
          <h2 id="retention-title">保留、访问与删除</h2>
          <p>
            软删除节点可恢复 {PHASE_1_LIMITS.retention.softDeletedNodeDays}{" "}
            天。经验证的数据删除请求会立即停止访问，并计划在
            {PHASE_1_LIMITS.retention.deletionCompletionDays}{" "}
            天内从主要系统完成删除；备份最长在
            {PHASE_1_LIMITS.retention.backupExpiryDays} 天内过期。
          </p>
          <p>
            私测期间如需获取数据副本、修正账户资料或申请删除，请联系{" "}
            <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>
            。身份验证完成前不会披露或删除数据。
          </p>
        </div>
      </section>

      <section aria-labelledby="support-title">
        <span aria-hidden="true">
          <LifeBuoy size={21} />
        </span>
        <div>
          <h2 id="support-title">问题与安全事件支持</h2>
          <p>
            保存失败、任务卡住、错误引用、疑似跨工作区访问、密钥暴露或重复用量都应立即报告至{" "}
            <a href={`mailto:${supportEmail}`}>{supportEmail}</a>。请提供时间、Board
            名称和页面状态，不要通过邮件发送密钥或完整私密内容。
          </p>
        </div>
      </section>
    </main>
  );
}
