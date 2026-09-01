import { pool, query } from "./client";

const HTTPBIN_TEMPLATE_DAG = {
  nodes: [
    {
      id: "trigger.http_webhook",
      type: "trigger.http_webhook",
      label: "HTTP webhook",
      config: {},
    },
    {
      id: "agent.summarize",
      type: "agent.summarize",
      label: "Summarize",
      config: {
        system_prompt:
          "Summarize the incoming JSON payload in a few sentences. Then use tools if needed.",
      },
    },
    {
      id: "tool.http_request",
      type: "tool.http_request",
      label: "POST to httpbin",
      config: {
        url: "https://httpbin.org/post",
        method: "POST",
        json: '{"source":"ai-workflow-automation-platform"}',
      },
    },
  ],
  edges: [
    { id: "e1", from_: "trigger.http_webhook", to: "agent.summarize", condition: null },
    { id: "e2", from_: "agent.summarize", to: "tool.http_request", condition: null },
  ],
};

const SLACK_TEMPLATE_DAG = {
  nodes: [
    {
      id: "trigger.http_webhook",
      type: "trigger.http_webhook",
      label: "HTTP webhook",
      config: {},
    },
    {
      id: "agent.plan_and_execute",
      type: "agent.plan_and_execute",
      label: "Draft message",
      config: {
        system_prompt:
          "Turn the incoming payload into a short Slack-ready status message. Do not call tools; just write the message.",
      },
    },
    {
      id: "tool.slack_send_message",
      type: "tool.slack_send_message",
      label: "Send Slack message",
      config: {
        channel: "#general",
        text: "",
      },
    },
  ],
  edges: [
    { id: "e1", from_: "trigger.http_webhook", to: "agent.plan_and_execute", condition: null },
    { id: "e2", from_: "agent.plan_and_execute", to: "tool.slack_send_message", condition: null },
  ],
};

async function seed() {
  const templates = [
    {
      id: "tpl-webhook-summarize-http",
      slug: "webhook-summarize-httpbin",
      name: "Webhook → summarize → HTTP",
      description:
        "Accept a webhook payload, summarize it with an agent, then POST the result to httpbin.",
      category: "http",
      dagJson: HTTPBIN_TEMPLATE_DAG,
    },
    {
      id: "tpl-webhook-agent-slack",
      slug: "webhook-agent-slack",
      name: "Webhook → agent → Slack",
      description:
        "Accept a webhook payload, draft a short message, and post it to Slack (needs Slack OAuth or SLACK_BOT_TOKEN).",
      category: "slack",
      dagJson: SLACK_TEMPLATE_DAG,
    },
  ];

  try {
    for (const tpl of templates) {
      await query(
        `
          insert into workflow_templates (id, name, slug, description, category, dag_json)
          values ($1, $2, $3, $4, $5, $6)
          on conflict (id) do update
            set name = excluded.name,
                slug = excluded.slug,
                description = excluded.description,
                category = excluded.category,
                dag_json = excluded.dag_json
        `,
        [tpl.id, tpl.name, tpl.slug, tpl.description, tpl.category, tpl.dagJson]
      );
    }

    console.log("Template seed completed successfully");
    await pool.end();
  } catch (err) {
    console.error("Seed failed", err);
    await pool.end();
    process.exit(1);
  }
}

void seed();
