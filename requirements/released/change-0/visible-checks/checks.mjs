const NORTHSTAR_ID = "00000000-0000-4000-8000-000000000201";
const BLAIR_ID = "00000000-0000-4000-8000-000000000102";

export default async function execute(context) {
  const session = await login(context.apiBaseUrl, BLAIR_ID);
  const state = {};
  const visible01 = await check("check:c0-visible-01", async (evidence) => {
    const response = await request(context.apiBaseUrl, `/organizations/${NORTHSTAR_ID}/conversations`, { cookie: session });
    equal(response.status, 200, "Northstar Conversation list must return HTTP 200.");
    const conversations = response.body?.conversations;
    assert(Array.isArray(conversations), "Conversation list response must contain a conversations array.");
    assert(conversations.length > 0, "Deterministic seed must receipt at least one Northstar Conversation.");
    for (const conversation of conversations) validateConversation(conversation, NORTHSTAR_ID);
    state.conversation = conversations[0];
    evidence.push({ kind: "http", method: "GET", path: `/organizations/${NORTHSTAR_ID}/conversations`, status: response.status, conversationCount: conversations.length });
  });
  const visible02 = await check("check:c0-visible-02", async (evidence) => {
    const conversation = requireConversation(state.conversation);
    const detail = await request(context.apiBaseUrl, `/organizations/${NORTHSTAR_ID}/conversations/${conversation.id}`, { cookie: session });
    equal(detail.status, 200, "Authorized Conversation detail must return HTTP 200.");
    validateConversation(detail.body?.conversation, NORTHSTAR_ID);
    assert(Array.isArray(detail.body?.messages), "Conversation detail must contain a messages array.");
    detail.body.messages.forEach(validateMessage);
    const content = "Visible verification reply";
    const reply = await request(context.apiBaseUrl, `/organizations/${NORTHSTAR_ID}/conversations/${conversation.id}/replies`, { cookie: session, method: "POST", body: { content } });
    assert(reply.status >= 200 && reply.status < 300, `Authorized reply must succeed, received HTTP ${reply.status}.`);
    validateMessage(reply.body?.message);
    equal(reply.body.message.content, content, "Reply response must preserve Message content.");
    await exerciseBrowser(context, evidence);
    const resolved = await request(context.apiBaseUrl, `/organizations/${NORTHSTAR_ID}/conversations/${conversation.id}/resolve`, { cookie: session, method: "POST" });
    assert(resolved.status >= 200 && resolved.status < 300, `Authorized resolve must succeed, received HTTP ${resolved.status}.`);
    validateConversation(resolved.body?.conversation, NORTHSTAR_ID);
    equal(resolved.body.conversation.status, "resolved", "Resolve response must return resolved status.");
    evidence.push({ kind: "http", detailStatus: detail.status, replyStatus: reply.status, resolveStatus: resolved.status });
  });
  const visible03 = await check("check:c0-visible-03", async (evidence) => {
    const conversation = requireConversation(state.conversation);
    const before = await request(context.apiBaseUrl, `/organizations/${NORTHSTAR_ID}/conversations/${conversation.id}`, { cookie: session });
    equal(before.status, 200, "Conversation detail before invalid reply must return HTTP 200.");
    assert(Array.isArray(before.body?.messages), "Conversation detail must contain Messages.");
    before.body.messages.forEach(validateMessage);
    assertOrdered(before.body.messages);
    const invalid = await request(context.apiBaseUrl, `/organizations/${NORTHSTAR_ID}/conversations/${conversation.id}/replies`, { cookie: session, method: "POST", body: { content: "   \n\t" } });
    equal(invalid.status, 400, "Whitespace-only reply must return HTTP 400.");
    const after = await request(context.apiBaseUrl, `/organizations/${NORTHSTAR_ID}/conversations/${conversation.id}`, { cookie: session });
    equal(after.status, 200, "Conversation detail after invalid reply must return HTTP 200.");
    assert(Array.isArray(after.body?.messages), "Conversation detail must contain Messages after invalid reply.");
    equal(after.body.messages.length, before.body.messages.length, "Invalid reply must not insert a Message.");
    assertOrdered(after.body.messages);
    evidence.push({ kind: "http", invalidReplyStatus: invalid.status, messageCountBefore: before.body.messages.length, messageCountAfter: after.body.messages.length });
  });
  return [visible01, visible02, visible03];
}

async function exerciseBrowser({ chromium, webBaseUrl }, evidence) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(webBaseUrl, { waitUntil: "networkidle" });
    const identity = page.getByRole("button", { name: /Blair Chen/i });
    try {
      await identity.waitFor({ timeout: 10_000 });
    } catch {
      throw new Error(`Browser did not render Blair's identity. Page content: ${await page.locator("body").innerText()}`);
    }
    await identity.click();
    await page.getByRole("button", { name: /Northstar Support/i }).click();
    const inbox = page.getByRole("heading", { name: /support inbox/i }).locator("xpath=..");
    await inbox.getByRole("button").first().click();
    const textboxes = page.getByRole("textbox");
    await textboxes.last().fill("Browser visible verification reply");
    await page.getByRole("button", { name: /reply|send/i }).click();
    await page.getByText("Browser visible verification reply", { exact: true }).waitFor();
    await page.getByRole("button", { name: /resolve/i }).click();
    await page.getByText(/resolved/i).first().waitFor();
    evidence.push({ kind: "browser", flow: ["select-identity", "select-organization", "open-conversation", "reply", "resolve"], passed: true });
  } finally { await browser.close(); }
}
async function login(apiBaseUrl, userId) {
  const response = await fetch(`${apiBaseUrl}/test/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId }) });
  equal(response.status, 201, "Visible verification could not establish Blair's server session.");
  const cookie = response.headers.get("set-cookie"); assert(typeof cookie === "string" && cookie.length > 0, "Session response must set a cookie."); return cookie.split(";", 1)[0];
}
async function request(apiBaseUrl, path, options = {}) {
  const headers = { ...(options.cookie === undefined ? {} : { cookie: options.cookie }) }; if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${apiBaseUrl}${path}`, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text(); let body = null; if (text.length > 0) { try { body = JSON.parse(text); } catch { throw new Error(`${options.method ?? "GET"} ${path} returned non-JSON content.`); } } return { status: response.status, body };
}
async function check(checkId, body) { const evidence = []; try { await body(evidence); return { checkId, status: "passed", diagnostics: [], evidence }; } catch (error) { return { checkId, status: "failed", diagnostics: [error instanceof Error ? error.message : String(error)], evidence }; } }
function validateConversation(value, organizationId) { assert(value !== null && typeof value === "object", "Conversation must be an object."); assert(typeof value.id === "string" && value.id.length > 0, "Conversation must have a stable identifier."); equal(value.organizationId, organizationId, "Conversation must belong to the requested Organization."); assert(value.status === "open" || value.status === "resolved", "Conversation status must be open or resolved."); assert(typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt)), "Conversation must have a valid createdAt value."); }
function validateMessage(value) { assert(value !== null && typeof value === "object", "Message must be an object."); assert(typeof value.id === "string" && value.id.length > 0, "Message must have a stable identifier."); assert(typeof value.content === "string" && value.content.trim().length > 0, "Message content must be non-empty."); assert(typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt)), "Message must have a valid createdAt value."); }
function assertOrdered(messages) { for (let index = 1; index < messages.length; index += 1) { const prior = messages[index - 1]; const current = messages[index]; const chronological = prior.createdAt.localeCompare(current.createdAt); assert(chronological < 0 || (chronological === 0 && prior.id.localeCompare(current.id) <= 0), "Messages must be ordered by createdAt and then stable Message identifier."); } }
function requireConversation(value) { assert(value !== undefined, "Receive/list Check did not provide a Conversation."); return value; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function equal(actual, expected, message) { if (actual !== expected) throw new Error(`${message} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`); }
