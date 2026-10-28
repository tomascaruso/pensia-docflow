import { buildApp } from "./app.js";

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? "127.0.0.1";
const app = buildApp();
await app.listen({ port, host });
console.log(`pensia-docflow-api escuchando en http://${host}:${port}`);
