import Fastify from "fastify";

const server = Fastify({ logger: true });

server.get("/health", async () => ({
  service: "starter-api",
  status: "ok",
}));

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

try {
  await server.listen({ host, port });
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}
