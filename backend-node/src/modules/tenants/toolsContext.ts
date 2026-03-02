import { env } from "../../config/env";
import { getSlackTokenForTenant } from "../integrations/slack";

export interface SlackToolsConfig {
  botToken: string;
  defaultChannel: string;
}

export interface ToolsContext {
  slack?: SlackToolsConfig;
}

export async function getToolsContextForTenant(tenantId: string): Promise<ToolsContext> {
  const ctx: ToolsContext = {};

  const slackToken = await getSlackTokenForTenant(tenantId);
  if (slackToken) {
    ctx.slack = {
      botToken: slackToken,
      defaultChannel: env.SLACK_DEFAULT_CHANNEL,
    };
  }

  return ctx;
}


