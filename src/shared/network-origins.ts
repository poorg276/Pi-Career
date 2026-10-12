export const toolOrigins = new Set([
	"https://api.tavily.com",
	"https://geocoding-api.open-meteo.com",
	"https://api.open-meteo.com",
]);
export function allowedProxyOrigin(value: unknown): value is string {
	return (
		typeof value === "string" &&
		(toolOrigins.has(value) ||
			value === "https://auth.openai.com" ||
			value === "https://chatgpt.com")
	);
}
