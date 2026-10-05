// Dependency-free Node build for Vercel, equivalent to tools/build.py.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = new URL("src/", root);
const readSource = async (name) =>
	(await readFile(new URL(name, source), "utf8")).replace(/\r\n?/g, "\n");

const shell = await readSource("shell.html");
const includes = new Map();
for (const [, name] of shell.matchAll(/@@([a-z.-]+)@@/g)) {
	let content = await readSource(name);
	if (name === "engine.js") {
		content = content.replaceAll(
			"/* @@SURFACE_MODULE@@ */",
			await readSource("surface.js"),
		);
	}
	if (/<\/script\s*>/i.test(content)) {
		throw new Error(`${name} contains a closing script tag`);
	}
	includes.set(name, content.replace(/\n+$/, ""));
}
const html = shell.replace(/@@([a-z.-]+)@@/g, (_, name) => includes.get(name));
const output = new URL("index.html", root);

if (process.argv.includes("--check")) {
	const existing = (await readFile(output, "utf8")).replace(/\r\n?/g, "\n");
	if (existing !== html) {
		throw new Error("index.html does not match source; run npm run build");
	}
	console.log("Build matches source.");
} else {
	const dist = new URL("dist/", root);
	await rm(dist, { recursive: true, force: true });
	await mkdir(dist, { recursive: true });
	await writeFile(output, html);
	await writeFile(new URL("index.html", dist), html);
	console.log(
		`Built index.html and dist/index.html: ${Buffer.byteLength(html).toLocaleString("en-US")} bytes`,
	);
}
