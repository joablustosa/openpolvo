import { desktopDeskTools, desktopPolvoCode, isElectron } from "@/lib/desktopApi";
import { submitDeskToolResult } from "@/lib/conversationsApi";

export type DeskToolCallPayload = {
  id?: string;
  tool?: string;
  name?: string;
  args?: Record<string, unknown>;
  requires_client?: boolean;
};

export async function executeDeskToolCall(input: {
  token: string;
  conversationId: string;
  workspacePath: string;
  payload: DeskToolCallPayload;
}): Promise<void> {
  const callId = String(input.payload.id ?? "").trim();
  const tool = String(input.payload.tool ?? input.payload.name ?? "").trim();
  const args = input.payload.args ?? {};
  if (!callId || !tool) return;

  let result: Record<string, unknown>;

  if (!isElectron()) {
    result = { ok: false, error: "not_electron" };
  } else {
    result = await runDeskToolIpc(tool, args, input.workspacePath);
  }

  await submitDeskToolResult(input.token, input.conversationId, {
    call_id: callId,
    workspace_path: input.workspacePath,
    result,
  });
}

async function runDeskToolIpc(
  tool: string,
  args: Record<string, unknown>,
  workspacePath: string,
): Promise<Record<string, unknown>> {
  const wp = workspacePath.trim();
  if (!wp) return { ok: false, error: "workspace_required" };

  switch (tool) {
    case "filesystem_list": {
      const r = await desktopPolvoCode.listDir({
        workspacePath: wp,
        relPath: String(args.rel_path ?? args.path ?? ""),
      });
      return r.ok
        ? { ok: true, entries: r.entries }
        : { ok: false, error: r.error ?? "list_failed" };
    }
    case "filesystem_read": {
      const r = await desktopPolvoCode.readFile({
        workspacePath: wp,
        relPath: String(args.rel_path ?? args.path ?? ""),
      });
      return r.ok
        ? { ok: true, content: r.content }
        : { ok: false, error: r.error ?? "read_failed" };
    }
    case "filesystem_write": {
      const r = await desktopPolvoCode.writeFile({
        workspacePath: wp,
        relPath: String(args.rel_path ?? args.path ?? ""),
        content: String(args.content ?? ""),
        createDirs: true,
      });
      return r.ok ? { ok: true } : { ok: false, error: r.error ?? "write_failed" };
    }
    case "terminal_run": {
      const command = String(args.command ?? "");
      if (
        typeof window !== "undefined" &&
        !window.confirm(`Executar no terminal?\n\n${command}`)
      ) {
        return { ok: false, error: "user_denied" };
      }
      const r = await desktopDeskTools.terminalRun({
        workspacePath: wp,
        command,
      });
      return {
        ok: r.ok,
        exit_code: r.exit_code,
        output: r.output,
        error: r.error,
      };
    }
    case "git_status": {
      const r = await desktopDeskTools.gitStatus({ workspacePath: wp });
      return { ok: r.ok, output: r.output, error: r.error };
    }
    case "git_diff": {
      const r = await desktopDeskTools.gitDiff({
        workspacePath: wp,
        relPath: String(args.rel_path ?? args.path ?? ""),
      });
      return { ok: r.ok, output: r.output, error: r.error };
    }
    case "git_commit": {
      const r = await desktopDeskTools.gitCommit({
        workspacePath: wp,
        message: String(args.message ?? ""),
      });
      return { ok: r.ok, output: r.output, error: r.error };
    }
    default:
      return { ok: false, error: `unknown_tool:${tool}` };
  }
}
