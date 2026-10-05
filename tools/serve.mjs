// Local preview serves only the deployable HTML, never the source tree.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		port: { type: "string", default: process.env.PORT || "3000" },
		host: { type: "string", default: "127.0.0.1" },
	},
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error("Port must be an integer from 1 to 65535");
}
const output = new URL("../dist/index.html", import.meta.url);
await readFile(output); // Fail before listening when the build is missing.

const server = createServer(async (request, response) => {
	const pathname = new URL(request.url, "http://localhost").pathname;
	if (request.method !== "GET" && request.method !== "HEAD") {
		response.writeHead(405, { Allow: "GET, HEAD" }).end();
		return;
	}
	if (pathname === "/favicon.ico") {
		response.writeHead(204).end();
		return;
	}
	if (pathname !== "/" && pathname !== "/index.html") {
		response
			.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
			.end("Not found");
		return;
	}
	try {
		const html = await readFile(output);
		response.writeHead(200, {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			"Content-Length": html.length,
		});
		response.end(request.method === "HEAD" ? undefined : html);
	} catch {
		response.writeHead(500).end("Build unavailable; run npm run build");
	}
});
server.on("error", (error) => {
	console.error(error.message);
	process.exitCode = 1;
});
server.listen(port, values.host, () => {
	console.log(`TIDELINE preview: http://${values.host}:${port}`);
});
