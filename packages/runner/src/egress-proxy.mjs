import http from "node:http";
import net from "node:net";

const allowedHosts = new Set(
  (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map(canonicalHost)
    .filter(Boolean),
);
const port = Number(process.env.PORT ?? "3128");

const server = http.createServer((request, response) => {
  let target;
  try {
    target = new URL(request.url ?? "");
  } catch {
    deny(response, 400, "Invalid proxy target.");
    return;
  }
  if (target.protocol !== "http:" || (target.port !== "" && target.port !== "80") || !isAllowed(target.hostname)) {
    deny(response, 403, "Proxy target is not allowed.");
    return;
  }

  const headers = { ...request.headers };
  delete headers["proxy-authorization"];
  delete headers["proxy-connection"];
  const upstream = http.request({
    hostname: target.hostname,
    port: target.port || 80,
    method: request.method,
    path: `${target.pathname}${target.search}`,
    headers,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => deny(response, 502, "Allowed proxy target was unavailable."));
  request.pipe(upstream);
});

server.on("connect", (request, client, head) => {
  const authority = request.url ?? "";
  const separator = authority.lastIndexOf(":");
  if (separator <= 0) {
    client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  const host = canonicalHost(authority.slice(0, separator));
  const targetPort = Number(authority.slice(separator + 1));
  if (!isAllowed(host) || targetPort !== 443) {
    client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }

  const upstream = net.connect(targetPort, host);
  upstream.once("connect", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.once("error", () => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
});

server.listen(port, "0.0.0.0");

function canonicalHost(value) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function isAllowed(host) {
  return host.length > 0 && allowedHosts.has(canonicalHost(host));
}

function deny(response, status, message) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}
