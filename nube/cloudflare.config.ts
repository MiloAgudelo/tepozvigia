import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "tepozvigia",
		compatibilityDate: "2026-10-06",
		entrypoint,
		env: {
			DB: bindings.d1({ name: "vigia-vuelos" }),
			// Bot de Telegram que manda las alertas y el chat al que escribe.
			TELEGRAM_TOKEN: bindings.secret(),
			TELEGRAM_CHAT: bindings.secret(),
		},
		domains: ["iltvuelos.miloagudelo.com"],
		triggers: [triggers.scheduled({ schedule: "*/5 * * * *" })],
	},
});
